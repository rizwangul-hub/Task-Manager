import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** @type {import('@whiskeysockets/baileys').WASocket | null} */
let sock = null;
let reconnectTimer = null;
let initializing = false;
let stopped = false;

const processCleanup = () => {
  if (!sock) return;
  try {
    sock.ev.removeAllListeners();
    sock.ws?.close();
  } catch {
    // The connection may already be closed during process shutdown.
  }
  sock = null;
};

process.once('SIGINT', processCleanup);
process.once('SIGTERM', processCleanup);
process.once('beforeExit', processCleanup);

export const normalizeWhatsAppPhoneNumber = (target) => {
  let digits = String(target || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('03') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  } else if (digits.startsWith('07') && digits.length === 11) {
    digits = `44${digits.slice(1)}`;
  } else if (digits.startsWith('920') || digits.startsWith('440')) {
    digits = digits.slice(0, 2) + digits.slice(3);
  }

  return /^\d{7,15}$/.test(digits) ? digits : '';
};

let lastSuccessfulSendAt = null;
let lastError = null;

export const getWhatsAppDiagnostics = () => {
  const isConnected = Boolean(sock && sock.user && sock.ws?.readyState === 1);
  return {
    provider: 'Baileys (WhatsApp Web Multi-Device)',
    connectionStatus: isConnected ? 'connected' : stopped ? 'stopped' : initializing ? 'connecting' : 'disconnected',
    sendingCapabilityStatus: isConnected ? 'ready' : 'unavailable',
    lastSuccessfulSendAt,
    lastError: lastError ? String(lastError).replace(/[0-9a-fA-F]{24,}/g, '[REDACTED_ID]') : null,
    authenticatedUser: sock?.user?.id ? sock.user.id.replace(/:.*@/, '@') : null
  };
};

export const initWhatsAppListener = async () => {
  if (initializing) return sock;
  if (stopped) return null;
  if (process.env.ENABLE_WHATSAPP === 'false' || process.env.WHATSAPP_ENABLED === 'false') {
    logger.info('[WA] Baileys outbound connection disabled via configuration flag.');
    return null;
  }

  if (sock) {
    logger.warn('[WA] Active socket detected on init; replacing stale connection.');
    sock.ev.removeAllListeners();
    sock.ws?.close();
    sock = null;
  }

  initializing = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP.authInfoPath);
    const newSock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async () => ({ conversation: '' })
    });
    sock = newSock;

    newSock.ev.on('creds.update', () => {
      void saveCreds().catch((error) => {
        logger.error('[WA] Failed to persist Baileys credentials:', error);
      });
    });

    // Listen for message receipt updates (delivery / read receipts)
    newSock.ev.on('messages.update', async (updates) => {
      try {
        const { TaskWhatsAppNotification, TASK_WHATSAPP_STATUSES } = await import(
          '../models/taskWhatsAppNotification.model.js'
        );
        for (const update of updates) {
          const messageId = update.key?.id;
          // Status 3 = DELIVERY_ACK / delivered
          if (messageId && update.update?.status === 3) {
            await TaskWhatsAppNotification.updateOne(
              { providerMessageId: messageId, status: TASK_WHATSAPP_STATUSES.SENT },
              { $set: { status: TASK_WHATSAPP_STATUSES.DELIVERED, deliveredAt: new Date() } }
            );
            logger.info(`[WA_DELIVERY_RECEIPT] Message ${messageId} delivery confirmed by WhatsApp recipient.`);
          }
        }
      } catch (err) {
        logger.error('[WA_DELIVERY_RECEIPT] Failed to persist a WhatsApp delivery receipt:', err);
      }
    });

    newSock.ev.on('connection.update', (update) => {
      if (update.qr) {
        logger.info('[WA] Scan the QR code below to connect outbound WhatsApp notifications:');
        qrcode.generate(update.qr, { small: true });
      }

      if (update.connection === 'open') {
        logger.info('[WA] Baileys connected for outbound task assignment notifications.');
      }

      if (update.connection === 'close') {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        sock = null;

        if (isLoggedOut || stopped) {
          logger.warn('[WA] Baileys logged out. Re-authenticate before sending notifications.');
          return;
        }

        if (!reconnectTimer) {
          logger.warn(`[WA] Disconnected (status ${statusCode ?? 'unknown'}); reconnecting in 5 s.`);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void initWhatsAppListener().catch((error) => {
              logger.error('[WA] Outbound connection retry failed:', error);
            });
          }, 5000);
          reconnectTimer.unref?.();
        }
      }
    });

    return newSock;
  } catch (error) {
    sock = null;
    throw error;
  } finally {
    initializing = false;
  }
};

export const closeWhatsAppListener = async () => {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const activeSocket = sock;
  sock = null;
  if (!activeSocket) return;

  try {
    activeSocket.ev.removeAllListeners();
    activeSocket.ws?.close();
    activeSocket.end?.(new Error('[WA] Outbound connection shutdown requested.'));
  } catch {
    // The connection may already be closed during shutdown.
  }
};

/**
 * Sends a message to an explicit JID or resolves an international phone number
 * to its registered WhatsApp JID before sending.
 */
export async function sendWhatsAppTaskNotification(target, messageText, { taskTitle = '' } = {}) {
  if (!sock || !sock.user || sock.ws?.readyState !== 1) {
    logger.warn('[WA_OUTBOUND] Cannot send: Baileys socket is not authenticated and connected.');
    return { success: false, reason: 'Socket not connected' };
  }

  if (typeof target !== 'string' || !target.trim()) {
    logger.warn('[WA_OUTBOUND] Cannot send: WhatsApp recipient is not configured.');
    return { success: false, reason: 'Recipient not configured' };
  }
  if (typeof messageText !== 'string' || !messageText.trim()) {
    logger.warn('[WA_OUTBOUND] Cannot send: message text is empty.');
    return { success: false, reason: 'Message text is empty' };
  }

  try {
    const trimmedTarget = target.trim();
    let targetJid;
    if (trimmedTarget.endsWith('@g.us') || trimmedTarget.endsWith('@s.whatsapp.net')) {
      if (!/^\d+@(g\.us|s\.whatsapp\.net)$/.test(trimmedTarget)) {
        logger.warn('[WA_OUTBOUND] Cannot send: WhatsApp JID is invalid.');
        return { success: false, reason: 'Invalid WhatsApp JID' };
      }
      targetJid = trimmedTarget;
    } else {
      const cleanDigits = normalizeWhatsAppPhoneNumber(trimmedTarget);
      if (!cleanDigits) {
        logger.warn('[WA_OUTBOUND] Cannot send: phone number is invalid.');
        return { success: false, reason: 'Invalid phone number' };
      }

      logger.info(`[WA_OUTBOUND] Verifying contact with Baileys for task "${taskTitle || 'task assignment'}".`);
      const matches = await sock.onWhatsApp(cleanDigits);
      const registeredAccount = matches?.find((match) => match?.exists && match?.jid);
      if (!registeredAccount) {
        logger.warn(`[WA_OUTBOUND] Number ${cleanDigits} is not registered on WhatsApp.`);
        return { success: false, reason: 'Number not on WhatsApp' };
      }
      targetJid = registeredAccount.jid;
    }

    const sent = await sock.sendMessage(targetJid, { text: messageText.trim() });
    lastSuccessfulSendAt = new Date();
    lastError = null;
    logger.info(`[WA_OUTBOUND_SUCCESS] Notification accepted by Baileys for ${targetJid}`);
    return { success: true, messageId: sent?.key?.id };
  } catch (error) {
    lastError = error.message || String(error);
    logger.error(`[WA_OUTBOUND_ERROR] Failed to send WhatsApp notification: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export async function sendWhatsAppMessage(targetJid, messageText) {
  const result = await sendWhatsAppTaskNotification(targetJid, messageText);
  return result.success;
}

export const whatsappListenerInternals = {
  normalizeWhatsAppPhoneNumber
};

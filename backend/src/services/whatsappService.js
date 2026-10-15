import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { ingestWhatsAppMessage } from '../controllers/whatsappWebhook.controller.js';
import { Task } from '../models/task.model.js';
import { logger } from '../utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_MEDIA_BYTES = env.WHATSAPP.maxMediaBytes;

/**
 * Pino logger at 'silent' level.
 * Completely suppresses Baileys internal Bad MAC, decrypt, and SessionError spam.
 */
const baileysLogger = pino({ level: 'silent' });

// ─── Module-level singleton state ─────────────────────────────────────────────
/** @type {import('@whiskeysockets/baileys').WASocket | null} */
let sock = null;
let reconnectTimer = null;
let initializing = false;
let stopped = false;
const inFlightMessageIds = new Set();

// ─── Process signal cleanup (registered once at module load) ──────────────────
// Fires before the server-level SIGINT/SIGTERM handlers have a chance to call
// closeWhatsAppListener(), ensuring the WS is torn down during --watch restarts
// even when the process is killed before the HTTP server is fully up.
const processCleanup = () => {
  if (!sock) return;
  try {
    sock.ev.removeAllListeners();
    sock.ws?.close();
  } catch {
    // silent — the socket may already be gone
  }
  sock = null;
};

process.once('SIGINT', processCleanup);
process.once('SIGTERM', processCleanup);
process.once('beforeExit', processCleanup);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Unwrap ephemeral or view-once wrapper layers to reach the real message content. */
export const getUnwrappedContent = (msg) => {
  let content = msg?.message || msg || {};
  let iterations = 0;
  while (content && iterations < 5) {
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
    } else if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
    } else if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
    } else if (content.documentWithCaptionMessage?.message) {
      content = content.documentWithCaptionMessage.message;
    } else {
      break;
    }
    iterations += 1;
  }
  return content;
};

/** Deep Caption & Text Extractor across all WhatsApp message wrappers. */
export const extractFullMessageText = (msg) => {
  if (!msg) return '';
  const m = msg.message || msg;

  // Unwrap ephemeral, view-once, or document-with-caption containers
  const content = getUnwrappedContent(m);

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.documentMessage?.fileName ||
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    content.documentWithCaptionMessage?.message?.documentMessage?.fileName ||
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.documentMessage?.fileName ||
    '';

  return String(text || '').trim();
};

/** Extract media object (image, document, video, etc.) from unwrapped content. */
export const getMediaObject = (content) => {
  if (!content || typeof content !== 'object') return null;
  return (
    content.imageMessage ||
    content.documentMessage ||
    content.videoMessage ||
    content.audioMessage ||
    content.stickerMessage ||
    null
  );
};

const getMessageText = (content) => extractFullMessageText(content);
const extractMessageText = (message) => extractFullMessageText(message);

/** Map message keywords to a group title for task categorisation. */
const getGroupTitle = (text) => {
  const content = String(text || '').toLowerCase();
  if (/\b(pcn|ticket|penalty|dartford|fine)\b/.test(content)) return 'Penalty Charge Notice';
  if (/\b(bridging|loan)\b/.test(content)) return 'Jasmine Work - Bridging Loan';
  if (/\b(stamp\s+duty|refund)\b/.test(content)) return 'Stamp Duty Refund';
  return 'General Tasks';
};

/** Build a safe filename for a downloaded WhatsApp media attachment. */
const getMediaFileName = (messageId, mimeType = 'image/jpeg') => {
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const safeId = String(messageId || Date.now()).replace(/[^a-z0-9_-]/gi, '');
  return `whatsapp-${safeId}.${extension}`;
};

/** Parse the configured WhatsApp group allowlist. */
const getAllowedGroups = () => {
  const raw = process.env.PIXX_WHATSAPP_GROUP_ID ||
    process.env.WHATSAPP_GROUP_ID ||
    env.WHATSAPP.groupId ||
    '';
  if (raw.trim().toLowerCase() === 'all' || !raw.trim()) return ['all'];
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
};

const getConfiguredGroupId = () => getAllowedGroups().join(',');

const isAllowAllGroups = () => getAllowedGroups().includes('all');

/** Determine whether an incoming group message is permitted for processing */
const isTargetGroup = (remoteJid) => {
  const allowed = getAllowedGroups();
  if (allowed.includes('all')) return true;
  return allowed.includes(remoteJid);
};

const shouldIgnoreJid = (jid) =>
  typeof jid !== 'string' || jid.endsWith('@lid') || jid.endsWith('@broadcast');

const shouldProcessMessage = (message) => {
  const jid = message?.key?.remoteJid;
  return Boolean(
    message?.key?.id &&
    !shouldIgnoreJid(jid) &&
    jid.endsWith('@g.us') &&
    isTargetGroup(jid)
  );
};

/**
 * Returns true for Bad MAC / decrypt errors that are expected noise from
 * historical or status messages — these should not be logged as real errors.
 */
const isExpectedHistoryDecryptError = (error, message, upsertType) => {
  const errorMessage = error instanceof Error ? error.message : String(error || '');
  if (!/bad mac|decrypt|sessionerror/i.test(errorMessage)) return false;

  const remoteJid = message?.key?.remoteJid || '';
  // Expected if: not a live notify, came from status broadcasts, LID, or not a group
  return (
    upsertType !== 'notify' ||
    remoteJid === 'status@broadcast' ||
    remoteJid.endsWith('@lid') ||
    !remoteJid.endsWith('@g.us')
  );
};

/** Silently tear down an existing socket before creating a replacement. */
const teardownSocket = (existingSocket) => {
  if (!existingSocket) return;
  try {
    existingSocket.ev.removeAllListeners();
    existingSocket.ws?.close();
    existingSocket.end?.();
  } catch {
    // silent — socket may already be closed
  }
};

/** Download and buffer media (image, document, video), enforcing the byte-size limit. */
const downloadMediaBuffer = async (message, content, sockRef) => {
  // Baileys requires the message object to directly contain the media field (imageMessage, documentMessage, etc.)
  const directMessage = {
    key: message.key,
    message: content
  };

  const buffer = await downloadMediaMessage(
    directMessage,
    'buffer',
    {},
    { logger: baileysLogger, reuploadRequest: sockRef?.updateMediaMessage }
  );
  const mediaBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (mediaBuffer.length > MAX_MEDIA_BYTES) {
    throw new Error(
      `WhatsApp media exceeds the configured ${MAX_MEDIA_BYTES}-byte limit.`
    );
  }
  return mediaBuffer;
};

// ─── Core message handler ─────────────────────────────────────────────────────

const handleMessage = async (activeSock, message) => {
  const remoteJid = message.key?.remoteJid || '';

  if (!shouldProcessMessage(message)) return;

  const messageId = message.key.id;

  // Deduplicate: skip if already processing or already saved to DB
  if (
    inFlightMessageIds.has(messageId) ||
    await Task.exists({ whatsappMessageId: messageId })
  ) return;

  inFlightMessageIds.add(messageId);
  try {
    const content = getUnwrappedContent(message);
    if (!content) return;

    const rawText = extractFullMessageText(message);
    const senderName = message.pushName || '';
    const senderPhone = String(message.key.participant || '')
      .replace(/:\d+@/, '@')
      .replace(/@s\.whatsapp\.net$/, '');

    // 1. Text & Media Fallbacks: If text is empty or '[Media/No Text]', set a sensible default title
    const hasMeaningfulText = rawText &&
      rawText !== '[Media/No Text]' &&
      rawText !== '[Media/Image]' &&
      rawText !== '[Media]';

    const cleanText = hasMeaningfulText ? rawText : '';
    const finalTitle = cleanText
      ? cleanText.split(/\r?\n/, 1)[0]?.slice(0, 80).trim()
      : `WhatsApp Media from ${senderName || senderPhone || 'Member'} - ${new Date().toLocaleTimeString()}`;

    const mediaObj = getMediaObject(content);
    const media = [];

    if (mediaObj) {
      try {
        const mediaBuffer = await downloadMediaBuffer(message, content, activeSock);
        const mimeType = mediaObj.mimetype || (content.imageMessage ? 'image/jpeg' : 'application/pdf');
        const fileName = mediaObj.fileName || getMediaFileName(messageId, mimeType);

        media.push({
          id: messageId,
          base64: mediaBuffer.toString('base64'),
          mimeType,
          fileName
        });
        console.log(`📎 [WA_MEDIA] Successfully downloaded media: ${fileName} (${mimeType}, ${mediaBuffer.length} bytes)`);
      } catch (err) {
        console.error(`❌ [WA_MEDIA_ERROR] Failed to download media attachment for ${messageId}:`, err.message);
      }
    }

    const timestamp = message.messageTimestamp
      ? new Date(Number(message.messageTimestamp) * 1000)
      : new Date();

    console.log('[WA_INTAKE] Passing message to task parser...', {
      id: messageId,
      finalTitle,
      hasMedia: media.length > 0
    });

    await ingestWhatsAppMessage(
      {
        id: messageId,
        groupId: remoteJid,
        senderPhone,
        senderName,
        timestamp,
        text: cleanText,
        media
      },
      'baileys',
      {
        groupTitle: getGroupTitle(cleanText || finalTitle),
        title: finalTitle,
        fallbackTitle: finalTitle
      }
    );
  } finally {
    inFlightMessageIds.delete(messageId);
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise (or re-initialise) the Baileys WhatsApp listener.
 *
 * Safe to call multiple times:
 *  - If an active socket already exists it is torn down first.
 *  - The `initializing` guard prevents concurrent init races.
 *  - `stopped` prevents reconnects after an intentional shutdown.
 */
export const initWhatsAppListener = async () => {
  if (initializing) return sock;
  if (stopped) return null;
  if (process.env.ENABLE_WHATSAPP === 'false' || process.env.WHATSAPP_ENABLED === 'false') {
    logger.info('[WA] Baileys listener disabled via configuration flag.');
    return null;
  }

  // ── Tear down any ghost socket from a previous --watch restart ──────────────
  if (sock) {
    logger.warn('[WA] Active socket detected on init — tearing down stale connection.');
    teardownSocket(sock);
    sock = null;
  }

  initializing = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP.authInfoPath);

    const newSock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      markOnlineOnConnect: false,     // prevent WhatsApp marking the account as online
      syncFullHistory: false,         // do not request full chat history on connect
      shouldIgnoreJid,
      /**
       * getMessage stub required by Baileys to resolve retry receipts.
       * Without this, Baileys re-requests every undecryptable message
       * indefinitely, creating a Bad MAC decryption storm on reconnect.
       */
      getMessage: async (_key) => ({ conversation: '' })
    });

    sock = newSock;

    // ── Credential persistence ──────────────────────────────────────────────
    newSock.ev.on('creds.update', () => {
      void saveCreds().catch((err) => {
        logger.error('[WA] Failed to persist Baileys credentials:', err);
      });
    });

    // ── Connection lifecycle ────────────────────────────────────────────────
    newSock.ev.on('connection.update', (update) => {
      if (update.qr) {
        logger.info('[WA] Scan the QR code below to connect the WhatsApp task listener:');
        qrcode.generate(update.qr, { small: true });
      }

      if (update.connection === 'open') {
        logger.info(`[INFO] [WA] Listening for tasks across ${getAllowedGroups().length} designated group(s).`);
      }

      if (update.connection === 'close') {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        // Always null the module ref when the connection closes
        sock = null;

        if (isLoggedOut || stopped) {
          logger.warn('[WA] Baileys logged out. Clear auth_info_baileys and restart to re-authenticate.');
          return;
        }

        if (!reconnectTimer) {
          logger.warn(`[WA] Disconnected (status ${statusCode ?? 'unknown'}) — reconnecting in 5 s.`);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void initWhatsAppListener().catch((err) => {
              logger.error('[WA] Reconnection attempt failed:', err);
            });
          }, 5000);
          // Allow the process to exit without waiting for the timer
          reconnectTimer.unref?.();
        }
      }
    });

    // ── Incoming messages ───────────────────────────────────────────────────
    newSock.ev.on('messages.upsert', async ({ type, messages = [] }) => {
      console.log(`[WA_RAW_EVENT] Received ${messages.length} message(s), type: ${type}`);
      if (type !== 'notify') return;

      for (const msg of messages) {
        const jid = msg.key?.remoteJid || '';
        if (jid.endsWith('@g.us')) {
          const text = extractFullMessageText(msg);
          const hasMedia = Boolean(getMediaObject(getUnwrappedContent(msg)));
          console.log('🎯 [TARGET GROUP MESSAGE RECEIVED]:', {
            jid,
            sender: msg.pushName || msg.key?.participant || 'Self',
            fromMe: msg.key?.fromMe,
            text: text || (hasMedia ? '[Media Attached]' : '[No Text]')
          });
        }
        if (!shouldProcessMessage(msg)) continue;

        // Process task extraction with per-message error isolation.
        console.log('[WA_INTAKE] Passing message to task parser...');
        void handleMessage(newSock, msg).catch((err) => {
          // Suppress expected Bad MAC / decrypt / SessionError noise
          const errMsg = err?.message || String(err || '');
          if (/bad mac|decrypt|sessionerror/i.test(errMsg) || isExpectedHistoryDecryptError(err, msg, type)) {
            return;
          }
          logger.error(
            `[WA] Failed to ingest message ${msg.key?.id ?? 'unknown'}:`,
            err
          );
        });
      }
    });

    return newSock;
  } catch (err) {
    // Reset the guard so the reconnect timer can retry
    sock = null;
    throw err;
  } finally {
    initializing = false;
  }
};

/**
 * Intentionally stop the Baileys listener (called during server shutdown).
 * Sets `stopped = true` so reconnect timers are never re-armed.
 */
export const closeWhatsAppListener = async () => {
  stopped = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const activeSocket = sock;
  sock = null;

  if (activeSocket) {
    try {
      activeSocket.ev.removeAllListeners();
      activeSocket.ws?.close();
      activeSocket.end?.(new Error('[WA] Listener shutdown requested.'));
    } catch {
      // silent — already closed
    }
  }
};

/**
 * Send an outbound message to a specific WhatsApp JID (user or group)
 * @param {string} targetJid - e.g. "447123456789@s.whatsapp.net" or "120363049482690322@g.us"
 * @param {string} messageText - formatted notification message
 */
const normalizeWhatsAppPhoneNumber = (target) => {
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

/**
 * Send a WhatsApp task notification to an individual number or group JID.
 * Individual numbers are resolved by WhatsApp first so Baileys can use the
 * registered JID (including LID addresses where applicable).
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
        logger.warn('[WA_OUTBOUND] Cannot send: group JID is invalid.');
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

    logger.info(`[WA_OUTBOUND] Sending task "${taskTitle || 'assignment notification'}" to ${targetJid}.`);
    const sent = await sock.sendMessage(targetJid, { text: messageText.trim() });
    logger.info(`[WA_OUTBOUND_SUCCESS] Delivered assignment message for "${taskTitle || 'task'}" to ${targetJid}.`);
    return { success: true, messageId: sent?.key?.id };
  } catch (error) {
    logger.error(`[WA_OUTBOUND_ERROR] Failed to send WhatsApp message: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export async function sendWhatsAppMessage(targetJid, messageText) {
  const result = await sendWhatsAppTaskNotification(targetJid, messageText);
  return result.success;
}

// ─── Internals exposed for unit tests ────────────────────────────────────────
export const whatsappListenerInternals = {
  getGroupTitle,
  getMessageText,
  extractMessageText,
  extractFullMessageText,
  getUnwrappedContent,
  getMediaObject,
  isExpectedHistoryDecryptError,
  isAllowAllGroups,
  isTargetGroup,
  shouldProcessMessage,
  getConfiguredGroupId,
  getAllowedGroups,
  shouldIgnoreJid,
  normalizeWhatsAppPhoneNumber
};
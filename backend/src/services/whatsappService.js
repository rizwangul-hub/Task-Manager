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
 * Pino logger at 'error' level only.
 * Suppresses Baileys info/debug/warn noise while still capturing real errors.
 */
const baileysLogger = pino({ level: 'error' });

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

/** Unwrap ephemeral / view-once wrapper layers to reach the real message content. */
const getMessageContent = (message = {}) => {
  let content = message;
  while (
    content.ephemeralMessage?.message ||
    content.viewOnceMessage?.message ||
    content.viewOnceMessageV2?.message
  ) {
    content =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message;
  }
  return content;
};

/** Extract plain text from any supported message type. */
const getMessageText = (content) =>
  content.conversation ||
  content.extendedTextMessage?.text ||
  content.imageMessage?.caption ||
  content.documentMessage?.caption ||
  '';

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

/** Helper to retrieve the active WhatsApp group ID configuration */
const getConfiguredGroupId = () =>
  (process.env.PIXX_WHATSAPP_GROUP_ID || process.env.WHATSAPP_GROUP_ID || env.WHATSAPP.groupId || '').trim();

/** Check if group filter is set to 'all' or empty, allowing any group */
const isAllowAllGroups = () => {
  const groupId = getConfiguredGroupId();
  return !groupId || groupId.toLowerCase() === 'all';
};

/** Determine whether an incoming group message is permitted for processing */
const isTargetGroup = (remoteJid) => {
  if (isAllowAllGroups()) return true;
  return remoteJid === getConfiguredGroupId();
};

/**
 * Returns true for Bad MAC / decrypt errors that are expected noise from
 * historical or status messages — these should not be logged as real errors.
 */
const isExpectedHistoryDecryptError = (error, message, upsertType) => {
  const errorMessage = error instanceof Error ? error.message : String(error || '');
  if (!/bad mac|decrypt/i.test(errorMessage)) return false;

  const remoteJid = message?.key?.remoteJid || '';
  // Expected if: not a live notify, came from status broadcasts, or not a group
  return (
    upsertType !== 'notify' ||
    remoteJid === 'status@broadcast' ||
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

/** Download and buffer an image message, enforcing the byte-size limit. */
const downloadImage = async (message, sockRef) => {
  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    { logger: baileysLogger, reuploadRequest: sockRef.updateMediaMessage }
  );
  const imageBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (imageBuffer.length > MAX_MEDIA_BYTES) {
    throw new Error(
      `WhatsApp image exceeds the configured ${MAX_MEDIA_BYTES}-byte limit.`
    );
  }
  return imageBuffer;
};

// ─── Core message handler ─────────────────────────────────────────────────────

const handleMessage = async (activeSock, message) => {
  const remoteJid = message.key?.remoteJid || '';

  // Ignore: own messages, status broadcasts, non-group chats, or non-matching groups
  if (
    !message.key?.id ||
    message.key.fromMe ||
    remoteJid === 'status@broadcast' ||
    !remoteJid.endsWith('@g.us') ||
    !isTargetGroup(remoteJid)
  ) return;

  const messageId = message.key.id;

  // Deduplicate: skip if already processing or already saved to DB
  if (
    inFlightMessageIds.has(messageId) ||
    await Task.exists({ whatsappMessageId: messageId })
  ) return;

  inFlightMessageIds.add(messageId);
  try {
    const content = getMessageContent(message.message);
    if (!content) return;

    const text = String(getMessageText(content) || '').trim();
    const mediaMessage = content.imageMessage;
    const media = [];

    if (mediaMessage) {
      const imageBuffer = await downloadImage(message, activeSock);
      media.push({
        id: messageId,
        base64: imageBuffer.toString('base64'),
        mimeType: mediaMessage.mimetype || 'image/jpeg',
        fileName: getMediaFileName(messageId, mediaMessage.mimetype)
      });
    }

    const senderPhone = String(message.key.participant || '')
      .replace(/:\d+@/, '@')
      .replace(/@s\.whatsapp\.net$/, '');
    const timestamp = message.messageTimestamp
      ? new Date(Number(message.messageTimestamp) * 1000)
      : new Date();

    await ingestWhatsAppMessage(
      {
        id: messageId,
        groupId: remoteJid,
        senderPhone,
        senderName: message.pushName || '',
        timestamp,
        text,
        media
      },
      'baileys',
      {
        groupTitle: getGroupTitle(text),
        title: text.split(/\r?\n/, 1)[0]?.slice(0, 80).trim() || '',
        fallbackTitle: `WhatsApp Image Task - ${Date.now()}`
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
      logger: baileysLogger,          // error-level only — suppresses decrypt/retry noise
      printQRInTerminal: false,
      markOnlineOnConnect: false,     // prevent WhatsApp marking the account as online
      syncFullHistory: false,         // do not request full chat history on connect
      shouldIgnoreJid: () => false,
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
        const mode = isAllowAllGroups()
          ? 'ALL groups ("all" mode active)'
          : `group ${getConfiguredGroupId()}`;
        logger.info(`[WA] Baileys connected — listening on ${mode}.`);
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
    newSock.ev.on('messages.upsert', ({ type, messages = [] }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const remoteJid = msg.key?.remoteJid || '';

        // 1. Log incoming WhatsApp group messages and JIDs clearly
        if (remoteJid.endsWith('@g.us')) {
          console.log('📩 [WHATSAPP GROUP DETECTED]:', {
            groupId: remoteJid,
            sender: msg.pushName || msg.key?.participant,
            text: msg.message?.conversation ||
                  msg.message?.extendedTextMessage?.text ||
                  msg.message?.imageMessage?.caption ||
                  '[Media/Image]'
          });
        }

        void handleMessage(newSock, msg).catch((err) => {
          // Suppress expected Bad MAC / decrypt noise from history replay
          if (isExpectedHistoryDecryptError(err, msg, type)) return;
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

// ─── Internals exposed for unit tests ────────────────────────────────────────
export const whatsappListenerInternals = {
  getGroupTitle,
  getMessageText,
  isExpectedHistoryDecryptError,
  isAllowAllGroups,
  isTargetGroup,
  getConfiguredGroupId
};
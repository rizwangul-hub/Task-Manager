import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  WAMessageStatus,
  isJidBroadcast,
  isJidNewsletter,
  jidNormalizedUser,
  jidEncode,
  proto,
  downloadMediaMessage,
  getBinaryNodeChild
} from '@whiskeysockets/baileys';
import { useMongoAuthState, clearMongoAuthState } from './mongoAuthState.js';
import NodeCache from '@cacheable/node-cache';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { logger as defaultLogger } from '../utils/logger.js';

const CONNECTION_STATES = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  LOGGED_OUT: 'logged_out',
  QR_REQUIRED: 'qr_required',
  STOPPED: 'stopped'
};

const MAX_MESSAGE_CACHE_SIZE = 1000;
const recentMessageStore = new Map();

export const cacheRecentWhatsAppMessage = (keyId, messageProto) => {
  if (!keyId || !messageProto) return;
  if (recentMessageStore.size >= MAX_MESSAGE_CACHE_SIZE) {
    const oldestKey = recentMessageStore.keys().next().value;
    recentMessageStore.delete(oldestKey);
  }
  recentMessageStore.set(keyId, messageProto);
};

export const normalizeWhatsAppPhoneNumber = (target) => {
  if (!target) return '';
  // Strip JID domain and device index FIRST: e.g. "923179500901:36@s.whatsapp.net" -> "923179500901"
  const raw = String(target).split('@')[0].split(':')[0];
  let digits = raw.replace(/\D/g, '');
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

const lidToPhoneCache = new Map();

export const registerLidPhoneMapping = (lid, phone) => {
  if (!lid || !phone) return;
  const cleanLid = String(lid).split('@')[0].split(':')[0];
  const cleanPhone = normalizeWhatsAppPhoneNumber(phone);
  if (cleanLid && cleanPhone) {
    lidToPhoneCache.set(cleanLid, cleanPhone);
    lidToPhoneCache.set(`${cleanLid}@lid`, `${cleanPhone}@s.whatsapp.net`);
  }
};

export const resolvePhoneFromLid = (target) => {
  if (!target) return '';
  const clean = String(target).split('@')[0].split(':')[0];
  return lidToPhoneCache.get(clean) || lidToPhoneCache.get(target) || '';
};

export const clearLidPhoneMappings = () => {
  lidToPhoneCache.clear();
};

const redactPhoneNumber = (value) => String(value || '').replace(/\+?\d[\d\s().-]{5,}\d/g, '[REDACTED_PHONE]');
const redactError = (error) => redactPhoneNumber(error?.message || error || 'Unknown WhatsApp error')
  .replace(/[0-9a-fA-F]{24,}/g, '[REDACTED_ID]');
const isUnsupportedServerlessRuntime = () => process.env.VERCEL === '1';
const SERVERLESS_RUNTIME_ERROR =
  'Baileys requires a persistent Node.js process; this API is running as a Vercel serverless function.';
const QR_TTL_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 8;
const cryptoConsoleFilterKey = Symbol.for('task-manager.whatsapp-crypto-console-filter');
const isWhatsAppOwnerProcess = () =>
  !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

const installCryptoConsoleErrorFilter = (serviceLogger) => {
  let filterState = globalThis[cryptoConsoleFilterKey];
  if (!filterState) {
    const originalError = console.error;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const state = {
      originalError,
      originalInfo,
      originalWarn,
      consumers: 0,
      lastWarningAt: 0,
      suppressedErrors: 0,
      suppressedSessionLogs: 0,
      errorWrapper: null,
      infoWrapper: null,
      warnWrapper: null
    };
    const getMessage = (args) => args.map((value) =>
      typeof value === 'string' ? value : value?.message || ''
    ).join(' ');
    const suppressSessionLog = (args) => {
      if (!/^(Closing|Opening) session:|^Session already (closed|open)/i.test(getMessage(args))) {
        return false;
      }
      state.suppressedSessionLogs += 1;
      const now = Date.now();
      if (now - state.lastWarningAt >= 60_000) {
        serviceLogger.warn(
          `[WA_CRYPTO] Suppressed ${state.suppressedSessionLogs} libsignal session log(s) that contain key material.`
        );
        state.lastWarningAt = now;
        state.suppressedSessionLogs = 0;
      }
      return true;
    };
    state.errorWrapper = (...args) => {
      const message = getMessage(args);
      if (/Failed to decrypt message with any known session|Session error: Bad MAC|Bad MAC|Over 2000 messages into the future|Session error/i.test(message)) {
        state.suppressedErrors += 1;
        const now = Date.now();
        if (now - state.lastWarningAt >= 60_000) {
          serviceLogger.warn(
            `[WA_CRYPTO] A message could not be decrypted (${state.suppressedErrors} similar event(s) since the previous report). The saved session was not changed.`
          );
          state.lastWarningAt = now;
          state.suppressedErrors = 0;
        }
        return;
      }
      state.originalError.apply(console, args);
    };
    state.infoWrapper = (...args) => {
      if (!suppressSessionLog(args)) state.originalInfo.apply(console, args);
    };
    state.warnWrapper = (...args) => {
      if (!suppressSessionLog(args)) state.originalWarn.apply(console, args);
    };
    filterState = state;
    globalThis[cryptoConsoleFilterKey] = state;
    console.error = state.errorWrapper;
    console.info = state.infoWrapper;
    console.warn = state.warnWrapper;
  }

  filterState.consumers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    filterState.consumers -= 1;
    if (filterState.consumers === 0) {
      if (console.error === filterState.errorWrapper) console.error = filterState.originalError;
      if (console.info === filterState.infoWrapper) console.info = filterState.originalInfo;
      if (console.warn === filterState.warnWrapper) console.warn = filterState.originalWarn;
      delete globalThis[cryptoConsoleFilterKey];
    }
  };
};

const createBaileysLogger = (serviceLogger) => {
  let lastCryptoWarningAt = 0;
  let suppressedCryptoErrors = 0;
  let lastOtherWarningAt = 0;

  return pino({ level: 'error' }, {
    write: (line) => {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }

      const message = [entry.msg, entry.err?.message].filter(Boolean).join(' ');
      const now = Date.now();
      if (/Bad MAC|Failed to decrypt message with any known session|Session error|Over 2000 messages into the future/i.test(message)) {
        suppressedCryptoErrors += 1;
        if (now - lastCryptoWarningAt >= 60_000) {
          serviceLogger.warn(
            `[WA_CRYPTO] A message could not be decrypted (${suppressedCryptoErrors} similar event(s) since the previous report). The saved session was not changed.`
          );
          lastCryptoWarningAt = now;
          suppressedCryptoErrors = 0;
        }
        return;
      }

      if (now - lastOtherWarningAt >= 10_000) {
        const safeDetail = redactError(message || entry.msg || 'Baileys internal error');
        const safeStack = entry.err?.stack ? redactError(entry.err.stack.split('\n').slice(0, 3).join(' | ')) : null;
        serviceLogger.warn(`[WA_BAILEYS] Baileys internal event: ${safeDetail}`, {
          errName: entry.err?.name || null,
          stack: safeStack
        });
        lastOtherWarningAt = now;
      }
    }
  });
};

export function extractFullMessageText(msg) {
  if (!msg || !msg.message) return '';
  const m = msg.message;

  const content =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message ||
    m;

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    '';

  return String(text || '').trim();
}

export const getWhatsAppMessageTimestamp = (msg) => {
  let ts = msg?.messageTimestamp;
  if (!ts) return null;
  if (typeof ts === 'object') {
    if (typeof ts.low === 'number') {
      ts = ts.low;
    } else if (typeof ts.toNumber === 'function') {
      ts = ts.toNumber();
    } else if (typeof ts.toString === 'function') {
      ts = ts.toString();
    }
  }
  if (typeof ts === 'bigint') {
    ts = Number(ts);
  }
  const timestamp = Number(ts);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;
};

export const isAfterWhatsAppProcessingCheckpoint = (messageTimestamp, checkpoint) => {
  if (!checkpoint) return true;
  const messageDate = new Date(messageTimestamp);
  const checkpointDate = new Date(checkpoint);
  return (
    Number.isFinite(messageDate.getTime()) &&
    Number.isFinite(checkpointDate.getTime()) &&
    messageDate > checkpointDate
  );
};

let defaultWhatsAppService = null;

export function getWhatsAppSocket() {
  return defaultWhatsAppService?.getSocket() || null;
}


export const createWhatsAppService = ({
  socketFactory = makeWASocket,
  authStateFactory = useMongoAuthState,
  authInfoPath = env.WHATSAPP.authInfoPath,
  serviceLogger = defaultLogger,
  loggedOutCode = DisconnectReason.loggedOut,
  sendReadyTimeoutMs = 20_000,
  reconnectDelaysMs = [5_000, 10_000, 20_000, 40_000, 60_000],
  maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
  fileSystem = { mkdir, readdir, rename, stat },
  inboundDependencies = {},
  onReady = async () => {
    const { taskAssignmentNotificationService } = await import('./taskAssignmentNotification.service.js');
    await taskAssignmentNotificationService.processPending();
  }
} = {}) => {
  let instanceSock = null;
  // Operational counters for diagnostics (non-sensitive)
  let counters = {
    totalMessagesReceived: 0,
    totalDraftsCreated: 0,
    totalExtractionFailures: 0,
    totalDecryptionFailures: 0,
    disconnectCount: 0
  };
  const recentInboundAuditLogs = [];
  const recordAudit = (entry) => {
    recentInboundAuditLogs.push({ time: new Date().toISOString(), ...entry });
    if (recentInboundAuditLogs.length > 30) recentInboundAuditLogs.shift();
  };
  let connectionState = CONNECTION_STATES.DISCONNECTED;
  let initializationPromise = null;
  let reconnectPromise = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let authStateLoadFailed = false;
  let authenticationValid = false;
  let lastConnectionAt = null;
  let lastDisconnectionReason = null;
  let lastSuccessfulSendAt = null;
  let lastError = null;
  let pairingQrDataUrl = null;
  let pairingQrExpiresAt = null;
  let rePairConfirmationRequired = false;
  let pairingBackupConfirmed = false;
  let releaseCryptoConsoleFilter = null;
  const connectionWaiters = new Set();
  let inboundQueue = Promise.resolve();
  const pendingExtractions = new Set();
  const inFlightMessageKeys = new Set();
  const msgRetryCounterCache = new NodeCache({
    stdTTL: 3600,
    useClones: false
  });
  let cachedGroups = null;
  let cachedGroupsAt = 0;
  let inFlightGroupsPromise = null;

  const isReady = () => {
    const s = instanceSock;
    return (
      connectionState === CONNECTION_STATES.CONNECTED &&
      Boolean(s?.user) &&
      (s?.ws?.readyState === undefined || s?.ws?.readyState === 1)
    );
  };

  const notifyWaiters = () => {
    for (const waiter of connectionWaiters) waiter();
  };

  const enqueueInboundWork = (work) => {
    const queuedWork = inboundQueue.then(work, work);
    inboundQueue = queuedWork.catch((error) => {
      serviceLogger.error('[WA_INBOUND_ERROR] Queued WhatsApp processing failed.', {
        name: error?.name || 'Error',
        code: error?.code || null
      });
    });
    return queuedWork;
  };

  const waitForInboundExtractions = async () => {
    while (pendingExtractions.size) {
      await Promise.all([...pendingExtractions]);
    }
  };

  const runInboundMaintenance = (work) => enqueueInboundWork(async () => {
    await waitForInboundExtractions();
    return work();
  });

  const waitForInboundProcessing = async () => {
    await inboundQueue;
    await waitForInboundExtractions();
  };

  const serviceStartedAt = new Date(Date.now() - 60_000);
  const getInboundCheckpoint = async () => {
    if (inboundDependencies.getCheckpoint) return inboundDependencies.getCheckpoint();
    const { WhatsAppProcessingCheckpoint } = await import(
      '../models/whatsappProcessingCheckpoint.model.js'
    );
    const checkpoint = await WhatsAppProcessingCheckpoint.findOne({ key: 'inbound' }).lean();
    return checkpoint?.startedAt || serviceStartedAt;
  };

  const findMonitoredGroup = async (groupJid) => {
    if (inboundDependencies.findMonitoredGroup) {
      return inboundDependencies.findMonitoredGroup(groupJid);
    }
    const { MonitoredGroup } = await import('../models/monitoredGroup.model.js');
    return MonitoredGroup.findOne({ groupJid, isMonitored: true });
  };

  const processInboundMessage = async (msg) => {
    const remoteJid = msg.key?.remoteJid || '';
    const messageId = msg.key?.id || 'unknown';
    const isGroup = remoteJid.endsWith('@g.us');
    const isDirect = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
    const fromMe = Boolean(msg.key?.fromMe);
    const senderJid = isGroup
      ? (msg.key?.participantPn || msg.key?.participant || msg.key?.participantLid ||
        msg.participant || (fromMe ? (instanceSock?.user?.id || remoteJid) : remoteJid))
      : (fromMe ? (instanceSock?.user?.id || remoteJid) : remoteJid);
    let senderName = msg.pushName || '';
    let senderPhone = '';
    if (senderJid.endsWith('@lid')) {
      const resolved = resolvePhoneFromLid(senderJid);
      if (resolved) {
        senderPhone = '+' + resolved;
      }
    } else {
      const phone = normalizeWhatsAppPhoneNumber(senderJid);
      if (phone) {
        senderPhone = '+' + phone;
      }
    }
    if (!senderName) {
      if (fromMe) {
        senderName = instanceSock?.user?.name || 'Me';
      } else {
        senderName = senderPhone || (isGroup ? 'Group Member' : 'Direct Sender');
      }
    }

    if ((!isGroup && !isDirect) || remoteJid === 'status@broadcast') {
      recordAudit({ event: 'dropped_not_group_or_direct', remoteJid, fromMe });
      serviceLogger.info('[WA_INBOUND_FILTER] Ignored non-group and non-direct message or status broadcast.', {
        remoteJid,
        isGroup,
        isDirect
      });
      return;
    }

    serviceLogger.info(`[WA_MESSAGE_RECEIVED] Inbound ${isGroup ? 'group' : 'direct'} message accepted for processing.`, {
      messageId,
      remoteJid,
      fromMe
    });

    if (fromMe) {
      if (process.env.WHATSAPP_ALLOW_FROM_ME !== 'true') {
        recordAudit({ event: 'dropped_fromMe_disabled', remoteJid, messageId });
        serviceLogger.info('[WA_INBOUND_FILTER] Ignored message sent by the connected account (fromMe=true). Set WHATSAPP_ALLOW_FROM_ME=true in backend/.env to enable self-testing.', {
          remoteJid,
          messageId
        });
        return;
      }
      serviceLogger.info('[WA_INBOUND_FILTER] Processing self-sent message because WHATSAPP_ALLOW_FROM_ME=true.', {
        messageId
      });
    }

    const messageTimestamp = getWhatsAppMessageTimestamp(msg);
    if (!messageTimestamp) {
      recordAudit({ event: 'dropped_no_timestamp', remoteJid, messageId, raw: msg?.messageTimestamp });
      serviceLogger.warn('[WA_INBOUND_FILTER] Ignored group message without a valid provider timestamp.', {
        messageId,
        rawTimestamp: msg?.messageTimestamp
      });
      return;
    }
    const checkpoint = await getInboundCheckpoint();
    if (!isAfterWhatsAppProcessingCheckpoint(messageTimestamp, checkpoint)) {
      recordAudit({ event: 'dropped_checkpoint', remoteJid, messageId, msgTime: messageTimestamp.toISOString(), checkpoint });
      serviceLogger.info('[WA_INBOUND_FILTER] Ignored group message at or before the saved processing checkpoint.', {
        messageId,
        messageTimestamp: messageTimestamp.toISOString(),
        checkpoint: checkpoint ? new Date(checkpoint).toISOString() : null
      });
      return;
    }

    let messageText = extractFullMessageText(msg);

    const rawMsg = msg.message;
    const innerMsg =
      rawMsg?.ephemeralMessage?.message ||
      rawMsg?.viewOnceMessage?.message ||
      rawMsg?.viewOnceMessageV2?.message ||
      rawMsg?.documentWithCaptionMessage?.message ||
      rawMsg;

    const imageMsg = innerMsg?.imageMessage;
    const documentMsg = innerMsg?.documentMessage;
    const audioMsg = innerMsg?.audioMessage;
    const hasImage = Boolean(imageMsg);
    const hasDocument = Boolean(documentMsg);
    const hasAudio = Boolean(audioMsg);

    if (!messageText && (hasImage || hasDocument || hasAudio)) {
      messageText = hasImage
        ? (imageMsg?.caption?.trim() || `[Photo from ${senderName}]`)
        : hasAudio
        ? `[Voice Note from ${senderName}]`
        : (documentMsg?.caption?.trim() || `[File: ${documentMsg?.fileName || 'Attachment'}]`);
    }

    // Filter out internal WhatsApp control frames (e.g. protocolMessage, app state sync, peer requests)
    // These are not customer messages and should never be counted as decryption failures.
    const isControlProtocolMessage = Boolean(
      innerMsg?.protocolMessage ||
      (innerMsg?.senderKeyDistributionMessage && !innerMsg?.conversation && !innerMsg?.extendedTextMessage)
    );
    if (isControlProtocolMessage) {
      serviceLogger.debug?.('[WA_INBOUND_FILTER] Ignored internal protocol control message.', {
        messageId,
        remoteJid,
        protocolType: innerMsg?.protocolMessage?.type
      });
      return;
    }

    if (!messageText) {
      counters.totalDecryptionFailures += 1;
      recordAudit({ event: 'dropped_no_text_undecrypted', remoteJid, messageId, messageKeys: msg?.message ? Object.keys(msg.message) : [] });
      serviceLogger.warn('[WA_INBOUND_FILTER] Message had no extractable text (undecryptable, media-only, or stub).', {
        messageId,
        remoteJid,
        messageStubType: msg?.messageStubType || null,
        messageKeys: msg?.message ? Object.keys(msg.message) : []
      });

      return;
    }

    let monitored = null;
    let resolvedGroupName = '';
    if (isGroup) {
      monitored = await findMonitoredGroup(remoteJid);
      if (!monitored && !inboundDependencies.findMonitoredGroup && process.env.WHATSAPP_AUTO_MONITOR_GROUPS !== 'false') {
        try {
          const { MonitoredGroup } = await import('../models/monitoredGroup.model.js');
          const existingGroup = await MonitoredGroup.findOne({ groupJid: remoteJid });
          if (!existingGroup) {
            let fetchedSubject = 'WhatsApp Group';
            try {
              if (instanceSock?.groupMetadata) {
                const meta = await instanceSock.groupMetadata(remoteJid);
                if (meta?.subject) fetchedSubject = meta.subject;
              }
            } catch {}
            monitored = await MonitoredGroup.create({
              groupJid: remoteJid,
              groupName: fetchedSubject,
              isMonitored: true,
              isPaused: false
            });
            serviceLogger.info('[WA_AUTO_MONITOR] Auto-registered and monitored new active group.', {
              groupJid: remoteJid,
              groupName: fetchedSubject
            });
          } else if (existingGroup.isPaused) {
            monitored = existingGroup;
          } else {
            existingGroup.isMonitored = true;
            await existingGroup.save();
            monitored = existingGroup;
          }
        } catch (e) {
          serviceLogger.warn('[WA_AUTO_MONITOR] Could not auto-register group:', { error: e.message });
        }
      }

      if (!monitored) {
        recordAudit({ event: 'dropped_unmonitored_group', remoteJid, messageId });
        let activeMonitoredInfo = [];
        try {
          const { MonitoredGroup } = await import('../models/monitoredGroup.model.js');
          const docs = await MonitoredGroup.find().lean();
          activeMonitoredInfo = docs.map((d) => ({
            groupJid: d.groupJid,
            groupName: d.groupName,
            isMonitored: d.isMonitored,
            isPaused: d.isPaused
          }));
        } catch {}
        serviceLogger.info('[WA_INBOUND_FILTER] Ignored message: Group is not in monitored list.', {
          incomingGroupJid: remoteJid,
          allMonitoredGroups: activeMonitoredInfo
        });
        return;
      }
      if (monitored.isPaused) {
        recordAudit({ event: 'dropped_paused_group', remoteJid, messageId, groupName: monitored.groupName });
        serviceLogger.info('[WA_INBOUND_FILTER] Ignored message: Monitored group is currently paused.', {
          groupJid: remoteJid,
          groupName: monitored.groupName
        });
        return;
      }
      resolvedGroupName = monitored.groupName || 'WhatsApp Group';

      if (inboundDependencies.updateGroupLastMessageAt) {
        await inboundDependencies.updateGroupLastMessageAt(remoteJid, messageTimestamp);
      } else {
        const { MonitoredGroup } = await import('../models/monitoredGroup.model.js');
        await MonitoredGroup.updateOne(
          { groupJid: remoteJid },
          { $set: { lastMessageAt: messageTimestamp } }
        );
      }
    }

    // Unified Saved Contact Verification (Direct & Group):
    // Only messages from saved active Contacts or registered Team Users are allowed to create tasks!
    let isAllowedSender = false;
    let matchedContactOrUser = null;

    if (inboundDependencies.isAllowedSender) {
      const checkResult = await inboundDependencies.isAllowedSender({
        senderPhone,
        senderJid,
        remoteJid,
        isGroup
      });
      if (typeof checkResult === 'boolean') {
        isAllowedSender = checkResult;
      } else if (checkResult) {
        isAllowedSender = true;
        matchedContactOrUser = checkResult;
      }
    } else if (isDirect && inboundDependencies.isAllowedDirect) {
      const checkResult = await inboundDependencies.isAllowedDirect({
        senderPhone,
        senderJid,
        remoteJid
      });
      if (typeof checkResult === 'boolean') {
        isAllowedSender = checkResult;
      } else if (checkResult) {
        isAllowedSender = true;
        matchedContactOrUser = checkResult;
      }
    } else if (inboundDependencies.createDraft || process.env.WHATSAPP_ALLOW_ALL_SENDERS === 'true' || (fromMe && process.env.WHATSAPP_ALLOW_FROM_ME === 'true')) {
      isAllowedSender = true;
    } else {
      try {
        const { Contact } = await import('../models/contact.model.js');
        const { User } = await import('../models/user.model.js');
        const cleanNumber = normalizeWhatsAppPhoneNumber(senderPhone || senderJid || remoteJid);
        if (cleanNumber && cleanNumber.length >= 7) {
          const suffix = cleanNumber.slice(-9);
          matchedContactOrUser = await Contact.findOne({
            whatsappNumber: new RegExp(suffix, 'i'),
            isActive: true
          });
          if (!matchedContactOrUser) {
            matchedContactOrUser = await User.findOne({
              $or: [
                { whatsappNumber: new RegExp(suffix, 'i') },
                { phone: new RegExp(suffix, 'i') }
              ],
              isActive: true
            });
          }
        }
        // Name-based fallback if phone matching didn't match
        if (!matchedContactOrUser && senderName) {
          const normName = senderName.trim().toLowerCase();
          if (normName && normName !== 'me' && normName !== 'group member' && normName !== 'direct sender') {
            const words = normName.split(/\s+/).filter((w) => w.length >= 3);
            for (const word of words) {
              matchedContactOrUser = await Contact.findOne({
                fullName: new RegExp(word, 'i'),
                isActive: true
              });
              if (matchedContactOrUser) break;
            }
          }
        }
        if (matchedContactOrUser) {
          isAllowedSender = true;
        }
      } catch (err) {
        serviceLogger.warn('[WA_SENDER_CHECK_WARN] Could not verify contact for sender:', { error: err?.message });
      }
    }

    if (!isAllowedSender) {
      recordAudit({ event: 'dropped_unknown_contact_sender', remoteJid, senderPhone, senderJid, messageId, isGroup });
      serviceLogger.info('[WA_INBOUND_FILTER] Ignored message: sender is not in saved Contacts or Team list.', {
        senderPhone,
        senderJid,
        remoteJid,
        messageId,
        isGroup
      });
      return;
    }

    if (matchedContactOrUser?.fullName || matchedContactOrUser?.name) {
      senderName = matchedContactOrUser.fullName || matchedContactOrUser.name;
    }

    if (isDirect) {
      resolvedGroupName = `Direct (${senderName || 'Contact'})`;
    }

    const messageKey = `${remoteJid}:${messageId}`;
    if (inFlightMessageKeys.has(messageKey)) {
      serviceLogger.info('[WA_INBOUND_DUP] Message is currently being processed; skipped duplicate.');
      return;
    }

    let existing;
    if (inboundDependencies.findDraft) {
      existing = await inboundDependencies.findDraft(remoteJid, messageId);
    } else {
      const { TaskDraft } = await import('../models/taskDraft.model.js');
      existing = await TaskDraft.findOne({ groupJid: remoteJid, messageId });
    }
    if (existing) {
      recordAudit({ event: 'dropped_existing_draft', remoteJid, messageId });
      serviceLogger.info('[WA_INBOUND_DUP] Message already has a draft; skipped duplicate.');
      return;
    }

    inFlightMessageKeys.add(messageKey);

    const extractionTask = (async () => {
      try {
        serviceLogger.info('[WA_EXTRACT_START] Starting task extraction.', { characterCount: messageText.length });

        // Download attached WhatsApp media if present (images, documents, or voice notes)
        let mediaBuffer = null;
        let attachments = [];
        let previewImage = { publicId: '', url: '', bytes: 0 };

        if (hasImage || hasDocument || hasAudio) {
          if (inboundDependencies.downloadMedia) {
            mediaBuffer = await inboundDependencies.downloadMedia(msg);
          } else if (!inboundDependencies.uploadMedia) {
            try {
              serviceLogger.info('[WA_MEDIA] Downloading attached WhatsApp media...', { messageId, hasAudio, hasImage });
              const msgToDownload = (innerMsg && innerMsg !== rawMsg) ? { key: msg.key, message: innerMsg } : msg;
              mediaBuffer = await downloadMediaMessage(
                msgToDownload,
                'buffer',
                {},
                {
                  logger: createBaileysLogger(serviceLogger),
                  reuploadRequest: (msgToReupload) => instanceSock?.updateMediaMessage(msgToReupload)
                }
              ).catch(async (firstErr) => {
                if (msgToDownload !== msg) {
                  return downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                      logger: createBaileysLogger(serviceLogger),
                      reuploadRequest: (msgToReupload) => instanceSock?.updateMediaMessage(msgToReupload)
                    }
                  );
                }
                throw firstErr;
              });
            } catch (mediaError) {
              serviceLogger.error('[WA_MEDIA_ERROR] Failed to download attached media:', {
                messageId,
                error: redactError(mediaError?.message || '')
              });
            }
          }

          if (inboundDependencies.uploadMedia) {
            const mediaResult = await inboundDependencies.uploadMedia(msg, mediaBuffer);
            if (mediaResult) {
              attachments = mediaResult.attachments || [];
              previewImage = mediaResult.previewImage || { publicId: '', url: '' };
            }
          } else if (mediaBuffer && mediaBuffer.length > 0) {
            try {
              const { default: cloudinaryService } = await import('./cloudinary.service.js');
              if (cloudinaryService.isReady()) {
                serviceLogger.info('[WA_MEDIA] Uploading media to Cloudinary...', { bytes: mediaBuffer.length, hasAudio, hasImage });
                const mimeType = hasImage
                  ? (imageMsg?.mimetype || 'image/jpeg')
                  : hasAudio
                  ? (audioMsg?.mimetype || 'audio/ogg')
                  : (documentMsg?.mimetype || 'application/octet-stream');
                const fileName = hasImage
                  ? `wa_img_${messageId}.jpg`
                  : hasAudio
                  ? `wa_voice_${messageId}.ogg`
                  : (documentMsg?.fileName || `wa_file_${messageId}`);

                const uploadResult = await cloudinaryService.uploadBuffer(mediaBuffer, {
                  folder: 'whatsapp_task_attachments',
                  resource_type: 'auto'
                });

                if (uploadResult?.url) {
                  serviceLogger.info('[WA_MEDIA_SUCCESS] Uploaded WhatsApp media to Cloudinary', {
                    url: uploadResult.url,
                    publicId: uploadResult.publicId
                  });

                  attachments.push({
                    publicId: uploadResult.publicId,
                    url: uploadResult.url,
                    fileName,
                    fileType: mimeType,
                    bytes: uploadResult.bytes || mediaBuffer.length,
                    uploadedAt: new Date()
                  });

                  if (hasImage) {
                    previewImage = {
                      publicId: uploadResult.publicId,
                      url: uploadResult.url
                    };
                  }
                }
              } else {
                serviceLogger.warn('[WA_MEDIA] Cloudinary not configured; attachment skipped upload.');
              }
            } catch (uploadErr) {
              serviceLogger.error('[WA_MEDIA_ERROR] Failed to upload media to Cloudinary:', {
                error: redactError(uploadErr?.message || '')
              });
            }
          }
        }

        const audioContext = hasAudio && mediaBuffer && mediaBuffer.length > 0 ? {
          buffer: mediaBuffer,
          mimeType: audioMsg?.mimetype || 'audio/ogg'
        } : null;

        let extraction;
        let provider;
        let fallbackReason;
        if (inboundDependencies.extractTask) {
          ({ extraction, provider, fallbackReason } = await inboundDependencies.extractTask(messageText, {
            senderName,
            messageTimestamp,
            audio: audioContext
          }));
        } else {
          const { extractTaskFromWhatsAppMessage } = await import('./aiTaskExtraction.service.js');
          ({ extraction, provider, fallbackReason } = await extractTaskFromWhatsAppMessage(messageText, {
            senderName,
            messageTimestamp,
            audio: audioContext
          }));
        }

        if (hasAudio && extraction?.title && messageText.startsWith('[Voice Note')) {
          messageText = `🎙️ Voice Note: ${extraction.title}${extraction.description ? ` — "${extraction.description}"` : ''}`;
        }

        let newStatus = 'awaiting_review';
        if (!extraction.isTask) {
          newStatus = 'ignored';
        } else if (extraction.missingInformation?.length > 0 || extraction.confidence < 0.6) {
          newStatus = 'needs_clarification';
        }

        let draft;
        const draftData = {
          groupJid: remoteJid,
          groupName: resolvedGroupName,
          messageId,
          senderJid,
          senderName,
          messageTimestamp,
          rawMessageText: messageText,
          attachments,
          previewImage,
          status: newStatus,
          aiExtraction: extraction,
          extractorProvider: provider,
          processingError: fallbackReason || null,
          attempts: 1
        };

        try {
          if (inboundDependencies.createDraft) {
            draft = await inboundDependencies.createDraft(draftData);
            if (draft) {
              draft.aiExtraction = extraction;
              draft.status = newStatus;
              draft.extractorProvider = provider;
              draft.processingError = fallbackReason || null;
              if (attachments.length > 0) draft.attachments = attachments;
              if (previewImage.url) draft.previewImage = previewImage;
              await draft.save?.();
            }
          } else {
            const { TaskDraft } = await import('../models/taskDraft.model.js');
            draft = await TaskDraft.create(draftData);
          }
        } catch (createErr) {
          if (createErr.code === 11000) {
            serviceLogger.info('[WA_INBOUND_DUP_INDEX] Unique message index prevented a concurrent duplicate draft.');
            return;
          }
          throw createErr;
        }

        if (newStatus === 'ignored') {
          recordAudit({ event: 'draft_saved_ignored', remoteJid, messageId, sender: senderName, text: messageText, reason: extraction.reason });
          serviceLogger.info('[WA_DRAFT_IGNORED] Message classified as non-task (casual chat). Saved as ignored, omitted from review queue and real-time alerts.', {
            draftId: String(draft?._id || ''),
            messageId,
            reason: extraction.reason || 'Not an actionable task'
          });
        } else {
          recordAudit({ event: 'draft_saved_actionable', remoteJid, messageId, sender: senderName, text: messageText, status: newStatus, title: extraction.title });
          counters.totalDraftsCreated += 1;
          serviceLogger.info('[WA_DRAFT_SAVED] Task draft persisted to MongoDB successfully.', {
            draftId: String(draft?._id || ''),
            messageId: draft?.messageId,
            status: draft?.status,
            provider,
            isTask: Boolean(extraction.isTask),
            title: extraction.title || '(none)'
          });

          serviceLogger.info('[WA_EXTRACT_RESULT] Extraction completed.', {
            isTask: Boolean(extraction.isTask),
            confidence: extraction.confidence,
            provider,
            status: newStatus,
            fallbackUsed: Boolean(fallbackReason)
          });
          serviceLogger.info('[WA_DRAFT_PERSISTED] Task draft saved for review.', { draftId: String(draft?._id || '') });
        }

        if (!inboundDependencies.getCheckpoint) {
          try {
            const { WhatsAppProcessingCheckpoint } = await import('../models/whatsappProcessingCheckpoint.model.js');
            await WhatsAppProcessingCheckpoint.findOneAndUpdate(
              { key: 'inbound' },
              { $max: { startedAt: messageTimestamp } },
              { upsert: true }
            );
          } catch {
            // Non-critical checkpoint update error
          }
        }

        if (newStatus !== 'ignored') {
          if (inboundDependencies.broadcastDraft) {
            await inboundDependencies.broadcastDraft('whatsapp:draft_created', draft);
          } else {
            const { socketService } = await import('./socket.service.js');
            socketService.broadcast('whatsapp:draft_created', draft);
          }
          serviceLogger.info('[WA_BROADCAST] Task draft update broadcast to real-time clients.');

          try {
            const { emailService } = await import('./email.service.js');
            const { env } = await import('../config/env.js');
            const recipient = env.EMAIL?.emailUser || process.env.INITIAL_ADMIN_EMAIL;
            if (recipient) {
              const actionUrl = `${env.FRONTEND_URL || 'http://localhost:5173'}/whatsapp-inbox`;
              const template = emailService.templates.whatsappDraftReceived({
                draftTitle: extraction?.title || 'New WhatsApp Task Draft',
                groupName: resolvedGroupName || remoteJid,
                senderName,
                senderPhone: senderJid,
                priority: extraction?.priority || 'Medium',
                dueDate: extraction?.dueDate ? new Date(extraction.dueDate).toLocaleDateString() : 'Not specified',
                rawMessage: messageText,
                actionUrl
              });
              void emailService.sendEmail({
                to: recipient,
                subject: template.subject,
                html: template.html,
                text: template.text
              }).catch((err) => {
                serviceLogger.warn('[WA_EMAIL_WARN] Failed to send WhatsApp draft alert email:', {
                  error: err?.message || String(err)
                });
              });
            }
          } catch (emailErr) {
            serviceLogger.warn('[WA_EMAIL_WARN] Could not construct WhatsApp draft alert email:', {
              error: emailErr?.message || String(emailErr)
            });
          }
        }
      } catch (aiErr) {
        counters.totalExtractionFailures += 1;
        serviceLogger.error('[WA_EXTRACTION_ERROR] Task extraction failed.', {
          name: aiErr?.name || 'Error',
          status: aiErr?.status || null
        });
        try {
          const failedData = {
            groupJid: remoteJid,
            groupName: resolvedGroupName || '',
            messageId,
            senderJid,
            senderName,
            messageTimestamp,
            rawMessageText: messageText,
            status: 'failed',
            processingError: 'Task extraction failed. Review server diagnostics and retry extraction.',
            attempts: 1
          };
          let failedDraft;
          if (inboundDependencies.createDraft) {
            failedDraft = await inboundDependencies.createDraft(failedData);
          } else {
            const { TaskDraft } = await import('../models/taskDraft.model.js');
            failedDraft = await TaskDraft.create(failedData);
          }
          if (inboundDependencies.broadcastDraft) {
            await inboundDependencies.broadcastDraft('whatsapp:draft_created', failedDraft);
          } else {
            const { socketService } = await import('./socket.service.js');
            socketService.broadcast('whatsapp:draft_created', failedDraft);
          }
        } catch (saveError) {
          serviceLogger.error('[WA_EXTRACTION_ERROR] Could not persist failed extraction status.', {
            name: saveError?.name || 'Error'
          });
        }
      } finally {
        inFlightMessageKeys.delete(messageKey);
      }
    })();
    pendingExtractions.add(extractionTask);
    void extractionTask.finally(() => pendingExtractions.delete(extractionTask));
  };

  const scheduleReconnect = () => {
    if (stopped || connectionState === CONNECTION_STATES.LOGGED_OUT || reconnectTimer) return;
    if (reconnectAttempt >= maxReconnectAttempts) {
      lastError = 'Automatic reconnection stopped after repeated failures. Use Reconnect WhatsApp to try again.';
      serviceLogger.error(`[WA] ${lastError}`);
      notifyWaiters();
      return;
    }
    const delayIndex = Math.min(reconnectAttempt, reconnectDelaysMs.length - 1);
    const delayMs = reconnectDelaysMs[delayIndex];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void initialize().catch((error) => {
        lastError = redactError(error);
        serviceLogger.error(`[WA] Reconnect attempt failed: ${lastError}`);
        scheduleReconnect();
      });
    }, delayMs);
    reconnectTimer.unref?.();
  };

  const clearPairingQr = () => {
    pairingQrDataUrl = null;
    pairingQrExpiresAt = null;
  };

  const getPairingQr = () => {
    if (pairingQrExpiresAt && Date.now() >= pairingQrExpiresAt) clearPairingQr();
    return pairingQrDataUrl;
  };

  const authDirectoryHasData = async () => {
    try {
      return (await fileSystem.readdir(resolve(authInfoPath))).length > 0;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };

  const stopCurrentSocket = () => {
    const activeSocket = instanceSock;
    instanceSock = null;
    releaseCryptoConsoleFilter?.();
    releaseCryptoConsoleFilter = null;
    if (!activeSocket) return;
    try {
      activeSocket.ev?.removeAllListeners?.();
      activeSocket.end?.(new Error('Baileys connection is being replaced by a manual reconnect.'));
    } catch (error) {
      serviceLogger.warn(`[WA] Could not cleanly close the previous socket: ${redactError(error)}`);
    }
  };

  const preserveAuthDirectoryForPairing = async () => {
    const authPath = resolve(authInfoPath);
    try {
      await fileSystem.stat(authPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fileSystem.mkdir(authPath, { recursive: true, mode: 0o700 });
      return null;
    }

    const backupPath = `${authPath}.backup-${Date.now()}-${randomUUID()}`;
    await clearMongoAuthState().catch(() => {});
    try {
      await fileSystem.rename(authPath, backupPath);
      await fileSystem.mkdir(authPath, { recursive: true, mode: 0o700 });
      return basename(backupPath);
    } catch (renameErr) {
      serviceLogger.warn(`[WA] Direct rename failed (${redactError(renameErr?.message)}), falling back to directory copy.`);
      const { cp, rm } = await import('node:fs/promises');
      await cp(authPath, backupPath, { recursive: true });
      await rm(authPath, { recursive: true, force: true });
      await fileSystem.mkdir(authPath, { recursive: true, mode: 0o700 });
      return basename(backupPath);
    }
  };

  const reconnect = async ({ confirmRePair = false, forceRePair = false } = {}) => {
    if (reconnectPromise) return reconnectPromise;
    if (isUnsupportedServerlessRuntime()) {
      return {
        success: false,
        message: SERVERLESS_RUNTIME_ERROR,
        diagnostics: getDiagnostics()
      };
    }
    if (
      (connectionState === CONNECTION_STATES.LOGGED_OUT || rePairConfirmationRequired) &&
      !confirmRePair
    ) {
      return {
        success: false,
        rePairConfirmationRequired: true,
        message: 'WhatsApp reported logout or requested a new pairing QR while saved authentication data exists. Re-pairing preserves the current authentication directory in a timestamped backup before starting a new pairing session.',
        diagnostics: getDiagnostics()
      };
    }
    if (confirmRePair &&
      !forceRePair &&
      connectionState !== CONNECTION_STATES.LOGGED_OUT &&
      !rePairConfirmationRequired) {
      return {
        success: false,
        message: 'A new pairing session is only allowed after WhatsApp reports logout or requests a fresh QR while saved authentication data exists.',
        diagnostics: getDiagnostics()
      };
    }
    if (
      !confirmRePair &&
      connectionState === CONNECTION_STATES.QR_REQUIRED &&
      getPairingQr()
    ) {
      return {
        success: true,
        message: 'Scan the current QR code with WhatsApp to finish pairing.',
        diagnostics: getDiagnostics()
      };
    }
    if (!confirmRePair && connectionState === CONNECTION_STATES.CONNECTING) {
      return {
        success: true,
        message: 'WhatsApp is already connecting.',
        diagnostics: getDiagnostics()
      };
    }

    reconnectPromise = (async () => {
      let backupName = null;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopCurrentSocket();
      clearPairingQr();
      stopped = false;
      authStateLoadFailed = false;
      reconnectAttempt = 0;
      connectionState = CONNECTION_STATES.DISCONNECTED;
      authenticationValid = false;

      if (confirmRePair) {
        backupName = await preserveAuthDirectoryForPairing();
        rePairConfirmationRequired = false;
        pairingBackupConfirmed = true;
      }

      await initialize();
      return {
        success: true,
        message: confirmRePair
          ? backupName
            ? 'The previous authentication directory was preserved. Scan the new QR code with WhatsApp to pair.'
            : 'No previous authentication directory existed. Scan the new QR code with WhatsApp to pair.'
          : 'Reconnect started using the existing WhatsApp authentication data.',
        backupName,
        diagnostics: getDiagnostics()
      };
    })().finally(() => {
      reconnectPromise = null;
    });

    return reconnectPromise;
  };

  const updateDeliveryReceipt = async (updates) => {
    const { TaskWhatsAppNotification, TASK_WHATSAPP_STATUSES } = await import(
      '../models/taskWhatsAppNotification.model.js'
    );

    for (const update of updates) {
      const messageId = update.key?.id;
      const status = update.update?.status;
      if (!messageId) continue;

      if (status === WAMessageStatus.SERVER_ACK) {
        await TaskWhatsAppNotification.updateOne(
          { providerMessageId: messageId, status: TASK_WHATSAPP_STATUSES.SENT },
          {
            $set: {
              status: TASK_WHATSAPP_STATUSES.SERVER_ACK,
              serverAckAt: new Date()
            }
          }
        );
        serviceLogger.info(`[WA_SERVER_ACK] WhatsApp server acknowledged message ${messageId}.`);
      } else if (
        status === WAMessageStatus.DELIVERY_ACK ||
        status === WAMessageStatus.READ ||
        status === WAMessageStatus.PLAYED
      ) {
        await TaskWhatsAppNotification.updateOne(
          {
            providerMessageId: messageId,
            status: { $in: [TASK_WHATSAPP_STATUSES.SENT, TASK_WHATSAPP_STATUSES.SERVER_ACK] }
          },
          {
            $set: {
              status: TASK_WHATSAPP_STATUSES.DELIVERED,
              deliveredAt: new Date()
            }
          }
        );
        serviceLogger.info(`[WA_DELIVERY_RECEIPT] WhatsApp confirmed delivery for message ${messageId}.`);
      }
    }
  };

  const syncMonitoredGroupSessions = async () => {
    if (!instanceSock || !isReady()) return;
    try {
      const groups = inboundDependencies.getMonitoredGroups
        ? await inboundDependencies.getMonitoredGroups()
        : await (await import('../models/monitoredGroup.model.js'))
          .MonitoredGroup.find({ isMonitored: true }).lean();
      for (const group of groups) {
        if (
          instanceSock?.groupMetadata &&
          instanceSock?.getUSyncDevices &&
          instanceSock?.assertSessions
        ) {
          try {
            const meta = await instanceSock.groupMetadata(group.groupJid);
            const participants = meta?.participants || [];
            for (const p of participants) {
              if (p?.lid && p?.jid) {
                registerLidPhoneMapping(p.lid, p.jid);
              }
            }
            const ownUsers = new Set([
              instanceSock?.user?.id?.split('@')[0]?.split(':')[0],
              instanceSock?.user?.lid?.split('@')[0]?.split(':')[0]
            ].filter(Boolean));
            const participantJids = [...new Set(
              participants
                .map((participant) => participant.id)
                .filter((jid) => typeof jid === 'string' && jid.includes('@'))
                .filter((jid) => {
                  const u = jid.split('@')[0]?.split(':')[0];
                  return !ownUsers.has(u);
                })
            )];
            if (participantJids.length > 0) {
              const devices = await instanceSock.getUSyncDevices(
                participantJids,
                false,
                false
              );
              const server = meta.addressingMode === 'lid' ? 'lid' : 's.whatsapp.net';
              const sessionJids = [...new Set(
                devices
                  .filter(({ user }) => !ownUsers.has(user))
                  .map(({ user, device }) => jidEncode(user, server, device))
              )];
              if (!sessionJids.length) continue;
              const shouldAssert = Boolean(inboundDependencies.getMonitoredGroups) || process.env.WHATSAPP_BOOTSTRAP_GROUP_SESSIONS === 'true';
              if (shouldAssert) {
                serviceLogger.info('[WA_SESSION_BOOTSTRAP] Asserting Signal sessions for group participants', {
                  groupJid: group.groupJid,
                  participantCount: sessionJids.length,
                  addressingMode: meta.addressingMode || 'pn'
                });
                await instanceSock.assertSessions(sessionJids, false);
              }
            }
          } catch (groupMetaErr) {
            serviceLogger.warn('[WA_SESSION_BOOTSTRAP_WARN]', { groupJid: group.groupJid, error: groupMetaErr?.message });
          }
        }
      }
    } catch (err) {
      serviceLogger.warn('[WA_SESSION_BOOTSTRAP_ERR]', { error: err?.message });
    }
  };

  const initialize = async () => {
    if (initializationPromise) return initializationPromise;
    if (instanceSock) return instanceSock;
    if (stopped) return null;
    if (connectionState === CONNECTION_STATES.LOGGED_OUT) return null;
    if (authStateLoadFailed) return null;
    if (!isWhatsAppOwnerProcess()) {
      connectionState = CONNECTION_STATES.DISCONNECTED;
      lastError = 'This backend worker does not own the WhatsApp connection. Run a single WhatsApp owner process.';
      notifyWaiters();
      return null;
    }
    if (isUnsupportedServerlessRuntime()) {
      connectionState = CONNECTION_STATES.DISCONNECTED;
      lastError = SERVERLESS_RUNTIME_ERROR;
      serviceLogger.warn(`[WA] ${SERVERLESS_RUNTIME_ERROR}`);
      notifyWaiters();
      return null;
    }
    if (process.env.ENABLE_WHATSAPP === 'false' || process.env.WHATSAPP_ENABLED === 'false') {
      connectionState = CONNECTION_STATES.DISCONNECTED;
      serviceLogger.info('[WA] Baileys outbound connection disabled via configuration flag.');
      notifyWaiters();
      return null;
    }

    initializationPromise = (async () => {
      connectionState = CONNECTION_STATES.CONNECTING;
      authenticationValid = false;
      notifyWaiters();
      let authStateLoaded = false;
      try {
        const { state, saveCreds } = await authStateFactory(authInfoPath);
        authStateLoaded = true;
        authenticationValid = false;
        if (stopped) return null;

        serviceLogger.info('[WA_STATE] WhatsApp connection state: CONNECTING (Establishing Baileys socket)');

        // Wrap state.keys with makeCacheableSignalKeyStore to eliminate Signal ratchet race conditions on disk
        const authKeys = state.keys
          ? makeCacheableSignalKeyStore(state.keys, createBaileysLogger(serviceLogger))
          : undefined;
        const authConfig = authKeys ? { creds: state.creds, keys: authKeys } : state;

        releaseCryptoConsoleFilter ??= installCryptoConsoleErrorFilter(serviceLogger);
        const newSock = socketFactory({
          auth: authConfig,
          logger: createBaileysLogger(serviceLogger),
          printQRInTerminal: false,
          markOnlineOnConnect: true,
          syncFullHistory: false,
          shouldSyncHistoryMessage: () => false,
          fireInitQueries: false,
          browser: Browsers.ubuntu('Chrome'),
          msgRetryCounterCache,
          retryRequestDelayMs: 500,
          shouldIgnoreJid: (jid) => !jid || isJidBroadcast(jid) || (isJidNewsletter ? isJidNewsletter(jid) : String(jid).endsWith('@newsletter')) || String(jid).endsWith('@call') || String(jid).endsWith('@bot'),
          keepAliveIntervalMs: 25_000,
          defaultQueryTimeoutMs: 90_000,
          connectTimeoutMs: 60_000,
          getMessage: async (key) => {
            if (key?.id && recentMessageStore.has(key.id)) {
              return recentMessageStore.get(key.id);
            }
            try {
              const { TaskDraft } = await import('../models/taskDraft.model.js');
              const draft = await TaskDraft.findOne({ messageId: key?.id }).select('rawMessageText').lean();
              if (draft?.rawMessageText) {
                return { conversation: draft.rawMessageText };
              }
            } catch {
              // Ignore lookup errors
            }
            return undefined;
          }
        });
        instanceSock = newSock;

        const originalSendRetryRequest = newSock.sendRetryRequest?.bind(newSock);
        if (originalSendRetryRequest) {
          newSock.sendRetryRequest = async (node, forceIncludeKeys = false) => {
            // Always force include prekeys on retry requests so the remote sender
            // can re-encrypt and distribute SenderKey / Whisper session immediately.
            return originalSendRetryRequest(node, true);
          };
        }

        if (newSock.ev?.on) {
          newSock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
            registerLidPhoneMapping(lid, jid);
            serviceLogger.info('[WA_PHONE_SHARE] Captured LID to Phone mapping', { lid, jid });
          });
        }

        if (newSock.ws?.on) {
          newSock.ws.on('CB:message', async (stanza) => {
            try {
              const from = stanza.attrs?.from || '';
              if (!from || from === 'status@broadcast') return;

              const participant = stanza.attrs?.participant || stanza.attrs?.participant_pn || from;
              const participantPn = stanza.attrs?.participant_pn || stanza.attrs?.sender_pn;
              if (participantPn && participant && participant.endsWith('@lid')) {
                registerLidPhoneMapping(participant, participantPn);
              }

              const encNode = (typeof getBinaryNodeChild === 'function' ? getBinaryNodeChild(stanza, 'enc') : null) ||
                (Array.isArray(stanza.content) ? stanza.content.find((c) => c?.tag === 'enc') : null);
              if (!encNode) return;
              const encType = encNode.attrs?.type;

              if (encType === 'skmsg' && from.endsWith('@g.us')) {
                const user = participant.split('@')[0].split(':')[0];
                const device = participant.split(':')[1]?.split('@')[0] || 0;
                const senderKeyId = `${from}::${user}::${device}`;

                let hasKey = false;
                if (authKeys?.get) {
                  try {
                    const existing = await authKeys.get('sender-key', [senderKeyId]);
                    hasKey = Boolean(existing?.[senderKeyId]);
                  } catch {}
                }

                if (!hasKey) {
                  serviceLogger.info('[WA_SKDM_MISSING] Missing group sender key for participant. Requesting SKDM retry with prekeys.', {
                    from,
                    participant,
                    senderKeyId
                  });

                  if (newSock.sendRetryRequest) {
                    try {
                      await newSock.sendRetryRequest(stanza, true);
                    } catch (err) {
                      serviceLogger.debug('[WA_RETRY_ERR] Could not send retry receipt for skmsg', { error: err?.message });
                    }
                  }
                }
              } else if (encType === 'msg') {
                const user = participant.split('@')[0].split(':')[0];
                const device = participant.split(':')[1]?.split('@')[0] || 0;
                const sessionId = `${user}.${device}`;

                let hasSession = false;
                if (authKeys?.get) {
                  try {
                    const existing = await authKeys.get('session', [sessionId]);
                    hasSession = Boolean(existing?.[sessionId]);
                  } catch {}
                }

                if (!hasSession) {
                  serviceLogger.info('[WA_SESSION_MISSING] Missing pairwise session for direct sender. Requesting prekey retry.', {
                    from,
                    participant,
                    sessionId
                  });

                  if (newSock.sendRetryRequest) {
                    try {
                      await newSock.sendRetryRequest(stanza, true);
                    } catch (err) {
                      serviceLogger.debug('[WA_RETRY_ERR] Could not send retry receipt for msg', { error: err?.message });
                    }
                  }
                }
              }
            } catch (err) {
              serviceLogger.debug('[WA_CB_MESSAGE_ERR]', { error: err?.message });
            }
          });
        }

        newSock.ev.on('creds.update', () => {
          void saveCreds().catch((error) => {
            lastError = redactError(error);
            serviceLogger.error(`[WA] Failed to persist Baileys credentials: ${lastError}`);
          });
        });

        newSock.ev.on('messages.update', (updates) => {
          void updateDeliveryReceipt(updates).catch((error) => {
            lastError = redactError(error);
            serviceLogger.error(`[WA_DELIVERY_RECEIPT] Could not persist message receipt: ${lastError}`);
          });

          if (Array.isArray(updates)) {
            for (const item of updates) {
              if (item?.update?.message && item?.key) {
                if (item.key.id) {
                  cacheRecentWhatsAppMessage(item.key.id, item.update.message);
                }
                const syntheticMessage = {
                  key: item.key,
                  message: item.update.message,
                  messageTimestamp: item.update.messageTimestamp || Math.floor(Date.now() / 1000),
                  pushName: item.update.pushName || ''
                };
                serviceLogger.info('[WA_INBOUND][MESSAGE_UPDATE_RECEIVED] Processing decrypted/updated message.', {
                  id: item.key.id,
                  remoteJid: item.key.remoteJid,
                  participant: item.key.participant || null
                });
                void enqueueInboundWork(async () => {
                  try {
                    await processInboundMessage(syntheticMessage);
                  } catch (error) {
                    serviceLogger.error('[WA_INBOUND_ERROR] Failed to process updated WhatsApp message.', {
                      message: redactError(error?.message || '')
                    });
                  }
                });
              }
            }
          }
        });

        newSock.ev.on('messages.upsert', (upsertData) => {
          const type = upsertData?.type;
          const messages = upsertData?.messages;
          const msgList = Array.isArray(messages) ? messages : [];

          recordAudit({
            event: 'messages.upsert',
            type,
            count: msgList.length,
            items: msgList.map((m) => ({
              id: m.key?.id || 'unknown',
              remoteJid: m.key?.remoteJid || 'unknown',
              participant: m.key?.participant || m.participant || null,
              fromMe: Boolean(m.key?.fromMe),
              pushName: m.pushName || null,
              hasMessage: Boolean(m.message),
              keys: m.message ? Object.keys(m.message) : [],
              extractedText: extractFullMessageText(m)
            }))
          });

          // Temporary safe diagnostic log at the VERY beginning of messages.upsert
          serviceLogger.info('[WA_DIAGNOSTIC][MESSAGES_UPSERT_START]', {
            eventType: type,
            messageCount: msgList.length,
            messagesSummary: msgList.map((m) => ({
              id: m.key?.id || 'unknown',
              remoteJid: m.key?.remoteJid || 'unknown',
              fromMe: Boolean(m.key?.fromMe),
              hasMessage: Boolean(m.message),
              hasText: Boolean(extractFullMessageText(m))
            }))
          });

          const isAllowedType = type === 'notify' || type === 'append';
          if (!isAllowedType || !Array.isArray(messages)) {
            serviceLogger.info('[WA_INBOUND_FILTER] Ignored upsert event with non-allowed type.', {
              type,
              count: msgList.length
            });
            return;
          }

          const messagesToProcess = type === 'append'
            ? messages.filter((m) => m.key?.fromMe && (Boolean(m.message) || Boolean(extractFullMessageText(m))))
            : messages;

          if (messagesToProcess.length === 0) {
            return;
          }

          const messageIds = [];
          for (const message of messagesToProcess) {
            if (message.key?.id && message.message) {
              cacheRecentWhatsAppMessage(message.key.id, message.message);
            }
            if (message.key?.id) messageIds.push(message.key.id);
          }
          counters.totalMessagesReceived += messagesToProcess.length;
          serviceLogger.info('[WA_INBOUND][MESSAGE_RECEIVED] New-message event received.', {
            messageCount: messagesToProcess.length,
            messageIds: messageIds.slice(0, 20)
          });
          void enqueueInboundWork(async () => {
            for (const message of messagesToProcess) {
              try {
                await processInboundMessage(message);
              } catch (error) {
                serviceLogger.error('[WA_INBOUND_ERROR] Failed to process a WhatsApp message.', {
                  name: error?.name || 'Error',
                  code: error?.code || null,
                  message: redactError(error?.message || '')
                });
              }
            }
          });
        });

        newSock.ev.on('connection.update', (update) => {
          if (instanceSock !== newSock) return;

          if (update.qr) {
            connectionState = CONNECTION_STATES.QR_REQUIRED;
            authenticationValid = false;
            clearPairingQr();
            serviceLogger.info('[WA_STATE] WhatsApp connection state: QR_REQUIRED (Pairing QR generated)');
            notifyWaiters();
            void (async () => {
              try {
                const existingAuthData = await authDirectoryHasData();
                if (instanceSock !== newSock || connectionState !== CONNECTION_STATES.QR_REQUIRED) return;
                if (existingAuthData && !pairingBackupConfirmed) {
                  rePairConfirmationRequired = true;
                  lastError = 'WhatsApp requested a new pairing QR while saved authentication data exists. Confirm a backup before pairing.';
                  serviceLogger.warn('[WA] A fresh pairing QR is waiting for explicit confirmation to preserve saved authentication data.');
                  notifyWaiters();
                  return;
                }

                pairingQrExpiresAt = Date.now() + QR_TTL_MS;
                pairingQrDataUrl = await QRCode.toDataURL(update.qr);
                if (instanceSock !== newSock || connectionState !== CONNECTION_STATES.QR_REQUIRED) return;
                notifyWaiters();
              } catch (error) {
                lastError = redactError(error);
                serviceLogger.error('[WA] Could not prepare the pairing QR for the authenticated settings page.');
              }
            })();
          }

          if (update.connection === 'open') {
            authenticationValid = Boolean(newSock.user);
            connectionState = authenticationValid
              ? CONNECTION_STATES.CONNECTED
              : CONNECTION_STATES.DISCONNECTED;
            if (authenticationValid) lastConnectionAt = new Date();
            lastError = authenticationValid
              ? null
              : 'Baileys opened a connection without an authenticated WhatsApp account.';
            lastDisconnectionReason = null;
            clearPairingQr();
            rePairConfirmationRequired = false;
            pairingBackupConfirmed = false;
            if (authenticationValid) reconnectAttempt = 0;
            if (authenticationValid) {
              serviceLogger.info('[WA_STATE] WhatsApp connection state: CONNECTED (authenticated).');
            } else {
              serviceLogger.warn(`[WA] ${lastError}`);
            }
            notifyWaiters();
            if (authenticationValid) {
              void Promise.resolve(onReady()).catch((error) => {
                lastError = redactError(error);
                serviceLogger.error(`[WA_OUTBOX] Could not resume pending notifications: ${lastError}`);
              });
              void syncMonitoredGroupSessions().catch(() => {});
            }
          }

          if (update.connection === 'close') {
            counters.disconnectCount += 1;
            const statusCode = update.lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === loggedOutCode;
            const reasonName = Object.entries(DisconnectReason)
              .find(([, code]) => code === statusCode)?.[0];
            instanceSock = null;
            releaseCryptoConsoleFilter?.();
            releaseCryptoConsoleFilter = null;
            authenticationValid = false;
            clearPairingQr();
            connectionState = isLoggedOut
              ? CONNECTION_STATES.LOGGED_OUT
              : stopped
                ? CONNECTION_STATES.STOPPED
                : CONNECTION_STATES.DISCONNECTED;
            lastError = isLoggedOut
              ? 'WhatsApp session logged out; re-pair the existing account.'
              : statusCode
                ? `WhatsApp connection closed (${reasonName || statusCode}).`
                : 'WhatsApp connection closed.';
            lastDisconnectionReason = lastError;
            serviceLogger.warn(
              `[WA_STATE] WhatsApp connection state: ${connectionState.toUpperCase()} (Reason: ${reasonName || statusCode || 'Unknown'}, StatusCode: ${statusCode || 'none'})`
            );
            if (statusCode === DisconnectReason.connectionReplaced) {
              serviceLogger.warn(
                '[WA_STATE] Connection was replaced by another active session or dev process. Backing off reconnection to avoid collision.'
              );
            }
            // Provide a short, structured log for operators with actionable details
            serviceLogger.info('[WA_DISCONNECT_DETAILS]', {
              disconnectCount: counters.disconnectCount,
              reason: reasonName || statusCode || 'Unknown',
              statusCode: statusCode || null,
              stopped: Boolean(stopped),
              isLoggedOut
            });
            notifyWaiters();
            if (!isLoggedOut && !stopped) scheduleReconnect();
          }
        });

        return newSock;
      } catch (error) {
        instanceSock = null;
        releaseCryptoConsoleFilter?.();
        releaseCryptoConsoleFilter = null;
        authenticationValid = false;
        connectionState = CONNECTION_STATES.DISCONNECTED;
        lastError = redactError(error);
        notifyWaiters();
        authStateLoadFailed = !authStateLoaded;
        if (authStateLoaded) scheduleReconnect();
        throw error;
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  };

  const waitForReady = async () => {
    if (isReady()) return true;
    if (
      isUnsupportedServerlessRuntime() ||
      connectionState === CONNECTION_STATES.LOGGED_OUT ||
      authStateLoadFailed ||
      stopped
    ) return false;
    if (!instanceSock && !initializationPromise && !reconnectTimer) {
      void initialize().catch((error) => {
        serviceLogger.error(`[WA] Connection initialization failed: ${redactError(error)}`);
      });
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        connectionWaiters.delete(checkConnection);
        resolve(ready);
      };
      const checkConnection = () => {
        if (isReady()) finish(true);
        else if (
          connectionState === CONNECTION_STATES.LOGGED_OUT ||
          connectionState === CONNECTION_STATES.QR_REQUIRED ||
          stopped
        ) finish(false);
      };
      connectionWaiters.add(checkConnection);
      const timeout = setTimeout(() => finish(isReady()), sendReadyTimeoutMs);
      timeout.unref?.();
      if (isReady()) finish(true);
    });
  };

  const sendWhatsAppTaskNotification = async (target, messageText, { taskTitle = '' } = {}) => {
    if (typeof target !== 'string' || !target.trim()) {
      return { success: false, retryable: false, reason: 'Recipient not configured' };
    }
    if (typeof messageText !== 'string' || !messageText.trim()) {
      return { success: false, retryable: false, reason: 'Message text is empty' };
    }

    const trimmedTarget = target.trim();
    const isJid = trimmedTarget.endsWith('@g.us') || trimmedTarget.endsWith('@s.whatsapp.net');
    let cleanDigits = '';
    if (isJid) {
      if (!/^\d+@(g\.us|s\.whatsapp\.net)$/.test(trimmedTarget)) {
        return { success: false, retryable: false, reason: 'Invalid WhatsApp JID' };
      }
    } else {
      let digits = trimmedTarget.replace(/[^0-9]/g, '');

      if (digits.startsWith('03') && digits.length === 11) {
        digits = '92' + digits.slice(1);
      }
      if (digits.startsWith('07') && digits.length === 11) {
        digits = '44' + digits.slice(1);
      }
      if (digits.startsWith('00')) {
        digits = digits.slice(2);
      }
      if (digits.startsWith('920') || digits.startsWith('440')) {
        digits = digits.slice(0, 2) + digits.slice(3);
      }

      if (!/^\d{7,15}$/.test(digits)) {
        return { success: false, retryable: false, reason: 'Invalid phone number' };
      }
      cleanDigits = digits;
    }

    if (!(await waitForReady())) {
      const reason = isUnsupportedServerlessRuntime()
        ? SERVERLESS_RUNTIME_ERROR
        : connectionState === CONNECTION_STATES.QR_REQUIRED
          ? 'WhatsApp QR pairing is required; scan the QR code in Settings.'
        : connectionState === CONNECTION_STATES.LOGGED_OUT
        ? 'WhatsApp session is logged out; re-pair the existing account.'
        : authStateLoadFailed
          ? 'Baileys authentication state could not be loaded; check AUTH_INFO_PATH and restart.'
        : 'WhatsApp socket is not ready; notification will be retried.';
      const retryable = connectionState !== CONNECTION_STATES.LOGGED_OUT && !authStateLoadFailed && !stopped;
      lastError = reason;
      serviceLogger.warn(`[WA_SEND_RESULT] Send not attempted: ${reason}`);
      return { success: false, retryable, reason, error: 'Socket not connected' };
    }

    const activeSock = instanceSock;
    if (!activeSock || !isReady()) {
      return { success: false, retryable: true, reason: 'Socket not connected', error: 'Socket not connected' };
    }

    try {
      let targetJid = trimmedTarget;
      if (!isJid) {
        const results = await activeSock.onWhatsApp(cleanDigits);
        const match = Array.isArray(results) ? results.find((r) => r?.exists && r?.jid) : results?.[0];
        if (!match || !match.exists) {
          serviceLogger.warn(`[WA_OUTBOUND] Recipient ${redactPhoneNumber(cleanDigits)} is not registered on WhatsApp.`);
          return { success: false, retryable: false, reason: 'Number not on WhatsApp' };
        }
        targetJid = match.jid;
      }

      if (activeSock !== instanceSock || !isReady()) {
        const reason = 'WhatsApp socket disconnected before the message could be sent.';
        lastError = reason;
        return { success: false, retryable: true, reason, error: reason };
      }

      const sent = await activeSock.sendMessage(targetJid, { text: messageText.trim() });
      if (sent?.key?.id) {
        cacheRecentWhatsAppMessage(sent.key.id, { conversation: messageText.trim() });
      }
      serviceLogger.info(`[WA_OUTBOUND_SUCCESS] Notification accepted by Baileys for ${redactPhoneNumber(targetJid)}.`);
      lastSuccessfulSendAt = new Date();
      lastError = null;
      return { success: true, messageId: sent?.key?.id };
    } catch (err) {
      lastError = redactError(err);
      serviceLogger.error(`[WA_OUTBOUND_EXCEPTION] ${lastError}`);
      return { success: false, retryable: true, reason: lastError, error: lastError };
    }
  };

  const close = async () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectionState = CONNECTION_STATES.STOPPED;
    notifyWaiters();
    const activeSocket = instanceSock;
    instanceSock = null;
    releaseCryptoConsoleFilter?.();
    releaseCryptoConsoleFilter = null;
    if (!activeSocket) return;
    try {
      activeSocket.ev?.removeAllListeners?.();
      activeSocket.end?.(new Error('Baileys outbound connection shutdown requested.'));
    } catch (error) {
      serviceLogger.warn(`[WA] Socket shutdown reported: ${redactError(error)}`);
    }
  };

  const getDiagnostics = () => ({
    provider: 'Baileys (WhatsApp Web Multi-Device)',
    connectionStatus: connectionState,
    instanceRole: isWhatsAppOwnerProcess() ? 'owner' : 'non_owner',
    qrRequired: connectionState === CONNECTION_STATES.QR_REQUIRED,
    rePairConfirmationRequired,
    qrCodeDataUrl: connectionState === CONNECTION_STATES.QR_REQUIRED ? getPairingQr() : null,
    qrExpiresAt: connectionState === CONNECTION_STATES.QR_REQUIRED ? pairingQrExpiresAt : null,
    authenticationValid,
    sendingCapabilityStatus: isReady() ? 'ready' : 'unavailable',
    hostingCompatibility: isUnsupportedServerlessRuntime()
      ? 'serverless_unsupported'
      : !isWhatsAppOwnerProcess()
        ? 'non_owner_worker'
        : 'persistent_runtime',
    hostingCompatibilityMessage: isUnsupportedServerlessRuntime()
      ? `${SERVERLESS_RUNTIME_ERROR} Deploy the backend API to an always-on Node.js host.`
      : !isWhatsAppOwnerProcess()
        ? 'This worker does not own the Baileys socket. Run the API and WhatsApp listener as a single backend process.'
        : null,
    lastConnectionAt,
    lastDisconnectionReason,
    lastSuccessfulSendAt,
    lastError: lastError
      ? redactError(lastError)
      : isUnsupportedServerlessRuntime()
        ? 'Baileys is not initialized in the Vercel serverless runtime.'
        : !isWhatsAppOwnerProcess()
          ? 'Baileys is not initialized on this non-owner backend worker.'
          : null,
    stats: {
      totalMessagesReceived: counters.totalMessagesReceived,
      totalDraftsCreated: counters.totalDraftsCreated,
      totalExtractionFailures: counters.totalExtractionFailures,
      totalDecryptionFailures: counters.totalDecryptionFailures,
      disconnectCount: counters.disconnectCount
    },
    recentInboundAudit: recentInboundAuditLogs
  });

  const getParticipatingGroups = async () => {
    if (!isReady()) {
      return { success: false, reason: 'WhatsApp socket is not connected', groups: [] };
    }
    const now = Date.now();
    if (cachedGroups && (now - cachedGroupsAt < 20_000)) {
      return { success: true, groups: cachedGroups };
    }
    if (inFlightGroupsPromise) {
      return inFlightGroupsPromise;
    }
    inFlightGroupsPromise = (async () => {
      try {
        const groupData = await instanceSock.groupFetchAllParticipating();
        const groups = Object.values(groupData || {}).map((g) => ({
          id: g.id,
          subject: g.subject || 'Unnamed Group',
          creation: g.creation ? new Date(g.creation * 1000) : null,
          owner: g.owner || null,
          size: Array.isArray(g.participants) ? g.participants.length : 0,
          desc: g.desc || ''
        }));
        cachedGroups = groups;
        cachedGroupsAt = Date.now();
        return { success: true, groups };
      } catch (err) {
        serviceLogger.error('[WA_GROUPS_ERROR] Failed to fetch participating groups.', {
          name: err?.name || 'Error',
          statusCode: err?.output?.statusCode || null
        });
        if (cachedGroups) {
          return { success: true, groups: cachedGroups };
        }
        return { success: false, error: 'Unable to fetch WhatsApp groups from the current connection.', groups: [] };
      } finally {
        inFlightGroupsPromise = null;
      }
    })();
    return inFlightGroupsPromise;
  };

  return {
    initialize,
    reconnect,
    close,
    sendWhatsAppTaskNotification,
    getDiagnostics,
    getParticipatingGroups,
    runInboundMaintenance,
    waitForInboundProcessing,
    getSocket: () => instanceSock,
    normalizeWhatsAppPhoneNumber
  };
};

const whatsappService = createWhatsAppService();
defaultWhatsAppService = whatsappService;

export const initWhatsAppListener = () => whatsappService.initialize();
export const reconnectWhatsApp = (options) => whatsappService.reconnect(options);
export const closeWhatsAppListener = () => whatsappService.close();
export const sendWhatsAppTaskNotification = (...args) =>
  whatsappService.sendWhatsAppTaskNotification(...args);
export const sendWhatsAppMessage = async (...args) =>
  (await whatsappService.sendWhatsAppTaskNotification(...args)).success;
export const getWhatsAppDiagnostics = () => whatsappService.getDiagnostics();
export const getParticipatingGroups = () => whatsappService.getParticipatingGroups();
export const runWhatsAppInboundMaintenance = (work) => whatsappService.runInboundMaintenance(work);
export const whatsappListenerInternals = {
  normalizeWhatsAppPhoneNumber,
  registerLidPhoneMapping,
  resolvePhoneFromLid,
  clearLidPhoneMappings
};

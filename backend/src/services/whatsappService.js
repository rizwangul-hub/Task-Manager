import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  WAMessageStatus
} from '@whiskeysockets/baileys';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
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

const redactPhoneNumber = (value) => String(value || '').replace(/\+?\d[\d\s().-]{5,}\d/g, '[REDACTED_PHONE]');
const redactError = (error) => redactPhoneNumber(error?.message || error || 'Unknown WhatsApp error')
  .replace(/[0-9a-fA-F]{24,}/g, '[REDACTED_ID]');
const isUnsupportedServerlessRuntime = () => process.env.VERCEL === '1';
const SERVERLESS_RUNTIME_ERROR =
  'Baileys requires a persistent Node.js process; this API is running as a Vercel serverless function.';
const QR_TTL_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 8;
const cryptoConsoleFilterKey = Symbol.for('task-manager.whatsapp-crypto-console-filter');

const installCryptoConsoleErrorFilter = (serviceLogger) => {
  let filterState = globalThis[cryptoConsoleFilterKey];
  if (!filterState) {
    const originalError = console.error;
    const state = {
      originalError,
      consumers: 0,
      lastWarningAt: 0,
      suppressedErrors: 0,
      wrapper: null
    };
    state.wrapper = (...args) => {
      const message = args.map((value) =>
        typeof value === 'string' ? value : value?.message || ''
      ).join(' ');
      if (/Failed to decrypt message with any known session|Session error: Bad MAC|Bad MAC/.test(message)) {
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
    filterState = state;
    globalThis[cryptoConsoleFilterKey] = state;
    console.error = state.wrapper;
  }

  filterState.consumers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    filterState.consumers -= 1;
    if (filterState.consumers === 0) {
      if (console.error === filterState.wrapper) console.error = filterState.originalError;
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
      if (/Bad MAC|Failed to decrypt message with any known session|Session error/i.test(message)) {
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

      if (now - lastOtherWarningAt >= 60_000) {
        serviceLogger.warn('[WA_BAILEYS] Baileys reported an internal error; details omitted.');
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
  const timestamp = Number(msg?.messageTimestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;
};

export const isAfterWhatsAppProcessingCheckpoint = (messageTimestamp, checkpoint) => {
  if (!checkpoint) return true;
  const messageDate = new Date(messageTimestamp);
  const checkpointDate = new Date(checkpoint);
  return Number.isFinite(messageDate.getTime()) &&
    Number.isFinite(checkpointDate.getTime()) &&
    messageDate > checkpointDate;
};

let defaultWhatsAppService = null;

export function getWhatsAppSocket() {
  return defaultWhatsAppService?.getSocket() || null;
}


export const createWhatsAppService = ({
  socketFactory = makeWASocket,
  authStateFactory = useMultiFileAuthState,
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
      serviceLogger.error(`[WA_INBOUND_ERROR] ${redactError(error)}`);
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

  const getInboundCheckpoint = async () => {
    if (inboundDependencies.getCheckpoint) return inboundDependencies.getCheckpoint();
    const { WhatsAppProcessingCheckpoint } = await import(
      '../models/whatsappProcessingCheckpoint.model.js'
    );
    const checkpoint = await WhatsAppProcessingCheckpoint.findOne({ key: 'inbound' }).lean();
    return checkpoint?.startedAt || null;
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
    const fromMe = Boolean(msg.key?.fromMe);
    const senderJid = msg.key?.participant || msg.participant || remoteJid;
    const senderName = msg.pushName || '';

    if (!isGroup || remoteJid === 'status@broadcast') {
      return;
    }

    serviceLogger.info(
      `[WA_INBOUND_MSG] Inbound group message detected: id=${messageId}, group=${remoteJid}, sender=${senderName || senderJid}, fromMe=${fromMe}`
    );

    if (fromMe) {
      if (process.env.WHATSAPP_IGNORE_FROM_ME === 'true') {
        serviceLogger.info(
          `[WA_INBOUND_FILTER] Message ${messageId} ignored: Sent by own account (fromMe=true) and WHATSAPP_IGNORE_FROM_ME is true.`
        );
        return;
      }
      serviceLogger.info(
        `[WA_INBOUND_MSG] Message ${messageId} sent by connected manager account (fromMe=true) in group ${remoteJid}. Processing instructions.`
      );
    }

    const messageTimestamp = getWhatsAppMessageTimestamp(msg);
    if (!messageTimestamp) {
      serviceLogger.warn(`[WA_INBOUND_FILTER] Message ${messageId} in ${remoteJid} ignored: No valid provider timestamp.`);
      return;
    }
    const checkpoint = await getInboundCheckpoint();
    if (!isAfterWhatsAppProcessingCheckpoint(messageTimestamp, checkpoint)) {
      serviceLogger.info(
        `[WA_INBOUND_FILTER] Message ${messageId} in ${remoteJid} ignored: Timestamp (${messageTimestamp.toISOString()}) predates processing checkpoint (${checkpoint ? new Date(checkpoint).toISOString() : 'none'}).`
      );
      return;
    }

    const messageText = extractFullMessageText(msg);
    if (!messageText) {
      serviceLogger.warn(
        `[WA_INBOUND_FILTER] Message ${messageId} in ${remoteJid} ignored: Empty or undecryptable text payload (Bad MAC or non-text message).`
      );
      return;
    }

    const monitored = await findMonitoredGroup(remoteJid);
    if (!monitored) {
      serviceLogger.info(
        `[WA_INBOUND_FILTER] Message ${messageId} ignored: Group ${remoteJid} is not configured for monitoring in MongoDB. Enable it in Manager Dashboard or Settings to process tasks.`
      );
      return;
    }
    if (monitored.isPaused) {
      serviceLogger.info(
        `[WA_INBOUND_FILTER] Message ${messageId} ignored: Group "${monitored.groupName || remoteJid}" is currently paused.`
      );
      return;
    }

    if (inboundDependencies.updateGroupLastMessageAt) {
      await inboundDependencies.updateGroupLastMessageAt(remoteJid, messageTimestamp);
    } else {
      const { MonitoredGroup } = await import('../models/monitoredGroup.model.js');
      await MonitoredGroup.updateOne(
        { groupJid: remoteJid },
        { $set: { lastMessageAt: messageTimestamp } }
      );
    }

    let existing;
    if (inboundDependencies.findDraft) {
      existing = await inboundDependencies.findDraft(remoteJid, messageId);
    } else {
      const { TaskDraft } = await import('../models/taskDraft.model.js');
      existing = await TaskDraft.findOne({ groupJid: remoteJid, messageId });
    }
    if (existing) {
      serviceLogger.info(`[WA_INBOUND_DUP] Message ${messageId} in "${monitored.groupName || remoteJid}" already drafted (status: ${existing.status}); skipping duplicate.`);
      return;
    }

    let draft;
    try {
      const draftData = {
        groupJid: remoteJid,
        groupName: monitored.groupName || '',
        messageId,
        senderJid,
        senderName,
        messageTimestamp,
        rawMessageText: messageText,
        attempts: 1
      };
      if (inboundDependencies.createDraft) {
        draft = await inboundDependencies.createDraft(draftData);
      } else {
        const { TaskDraft, TASK_DRAFT_STATUSES } = await import('../models/taskDraft.model.js');
        draft = await TaskDraft.create({
          ...draftData,
          status: TASK_DRAFT_STATUSES.AWAITING_REVIEW
        });
      }
    } catch (createErr) {
      if (createErr.code === 11000) {
        serviceLogger.info(`[WA_INBOUND_DUP_INDEX] Concurrent duplicate prevented for message ${messageId}.`);
        return;
      }
      throw createErr;
    }

    serviceLogger.info(`[WA_DRAFT_INIT] Draft record created for message ${messageId} from "${senderName || senderJid}" in "${monitored.groupName || remoteJid}"`);

    const extractionTask = (async () => {
      try {
        serviceLogger.info(
          `[WA_EXTRACT_START] Analyzing text (${messageText.length} chars) from "${senderName || senderJid}" in "${monitored.groupName || remoteJid}": "${messageText.slice(0, 60)}..."`
        );

        let extraction;
        let provider;
        if (inboundDependencies.extractTask) {
          ({ extraction, provider } = await inboundDependencies.extractTask(messageText, {
            senderName,
            messageTimestamp
          }));
        } else {
          const { extractTaskFromWhatsAppMessage } = await import('./aiTaskExtraction.service.js');
          ({ extraction, provider } = await extractTaskFromWhatsAppMessage(messageText, {
            senderName,
            messageTimestamp
          }));
        }

        let newStatus = 'awaiting_review';
        if (!extraction.isTask) {
          newStatus = 'ignored';
        } else if (extraction.missingInformation?.length > 0 || extraction.confidence < 0.6) {
          newStatus = 'needs_clarification';
        }

        draft.aiExtraction = extraction;
        draft.status = newStatus;
        draft.extractorProvider = provider;
        await draft.save();

        serviceLogger.info(
          `[WA_EXTRACT_RESULT] Extraction complete for message ${messageId}: isTask=${extraction.isTask}, title="${extraction.title}", priority=${extraction.priority}, confidence=${extraction.confidence}, provider=${provider}, status=${newStatus}`
        );
        serviceLogger.info(
          `[WA_DRAFT_PERSISTED] Task draft ${draft._id} persisted in MongoDB with status "${newStatus}". Awaiting manager review.`
        );

        if (inboundDependencies.broadcastDraft) {
          await inboundDependencies.broadcastDraft('whatsapp:draft_created', draft);
        } else {
          const { socketService } = await import('./socket.service.js');
          socketService.broadcast('whatsapp:draft_created', draft);
        }
        serviceLogger.info(`[WA_BROADCAST] Broadcasted "whatsapp:draft_created" for draft ${draft._id} to real-time clients.`);
      } catch (aiErr) {
        serviceLogger.error(`[WA_INBOUND_AI_ERROR] Extraction failed for ${messageId}: ${redactError(aiErr)}`);
        draft.status = 'failed';
        draft.processingError = aiErr.message || 'AI task extraction failed';
        try {
          await draft.save();
        } catch (saveError) {
          serviceLogger.error(`[WA_INBOUND_AI_ERROR] Could not persist failed extraction for ${messageId}: ${redactError(saveError)}`);
        }
        try {
          if (inboundDependencies.broadcastDraft) {
            await inboundDependencies.broadcastDraft('whatsapp:draft_created', draft);
          } else {
            const { socketService } = await import('./socket.service.js');
            socketService.broadcast('whatsapp:draft_created', draft);
          }
        } catch (broadcastError) {
          serviceLogger.error(`[WA_INBOUND_AI_ERROR] Could not broadcast draft ${messageId}: ${redactError(broadcastError)}`);
        }
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
    await fileSystem.rename(authPath, backupPath);
    await fileSystem.mkdir(authPath, { recursive: true, mode: 0o700 });
    return basename(backupPath);
  };

  const reconnect = async ({ confirmRePair = false } = {}) => {
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

  const initialize = async () => {
    if (initializationPromise) return initializationPromise;
    if (instanceSock) return instanceSock;
    if (stopped) return null;
    if (connectionState === CONNECTION_STATES.LOGGED_OUT) return null;
    if (authStateLoadFailed) return null;
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
          markOnlineOnConnect: false,
          syncFullHistory: false,
          browser: Browsers.ubuntu('Chrome'),
          getMessage: async (key) => {
            if (key?.id && recentMessageStore.has(key.id)) {
              return recentMessageStore.get(key.id);
            }
            return undefined;
          }
        });
        instanceSock = newSock;

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
        });

        newSock.ev.on('messages.upsert', ({ messages, type }) => {
          if (!Array.isArray(messages)) return;
          for (const message of messages) {
            if (message.key?.id && message.message) {
              cacheRecentWhatsAppMessage(message.key.id, message.message);
            }
          }
          serviceLogger.info(`[WA_INBOUND_RAW] Upsert event received: type=${type}, messageCount=${messages.length}`);
          void enqueueInboundWork(async () => {
            for (const message of messages) {
              try {
                await processInboundMessage(message);
              } catch (error) {
                serviceLogger.error(`[WA_INBOUND_ERROR] Failed to process message in Baileys: ${redactError(error)}`);
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
              serviceLogger.info(
                `[WA_STATE] WhatsApp connection state: CONNECTED (Authenticated as "${newSock.user?.name || 'Manager'}", JID: ${newSock.user?.id || 'none'}, LID: ${newSock.user?.lid || 'none'})`
              );
            } else {
              serviceLogger.warn(`[WA] ${lastError}`);
            }
            notifyWaiters();
            if (authenticationValid) {
              void Promise.resolve(onReady()).catch((error) => {
                lastError = redactError(error);
                serviceLogger.error(`[WA_OUTBOX] Could not resume pending notifications: ${lastError}`);
              });
            }
          }

          if (update.connection === 'close') {
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
    qrRequired: connectionState === CONNECTION_STATES.QR_REQUIRED,
    rePairConfirmationRequired,
    qrCodeDataUrl: connectionState === CONNECTION_STATES.QR_REQUIRED ? getPairingQr() : null,
    qrExpiresAt: connectionState === CONNECTION_STATES.QR_REQUIRED ? pairingQrExpiresAt : null,
    authenticationValid,
    sendingCapabilityStatus: isReady() ? 'ready' : 'unavailable',
    hostingCompatibility: isUnsupportedServerlessRuntime() ? 'serverless_unsupported' : 'persistent_runtime',
    hostingCompatibilityMessage: isUnsupportedServerlessRuntime()
      ? `${SERVERLESS_RUNTIME_ERROR} Deploy the backend API to an always-on Node.js host.`
      : null,
    lastConnectionAt,
    lastDisconnectionReason,
    lastSuccessfulSendAt,
    lastError: lastError
      ? redactError(lastError)
      : isUnsupportedServerlessRuntime()
        ? 'Baileys is not initialized in the Vercel serverless runtime.'
        : null
  });

  const getParticipatingGroups = async () => {
    if (!isReady()) {
      return { success: false, reason: 'WhatsApp socket is not connected', groups: [] };
    }
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
      return { success: true, groups };
    } catch (err) {
      serviceLogger.error(`[WA_GROUPS_ERROR] Failed to fetch participating groups: ${err.message}`);
      return { success: false, error: err.message, groups: [] };
    }
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
export const whatsappListenerInternals = { normalizeWhatsAppPhoneNumber };

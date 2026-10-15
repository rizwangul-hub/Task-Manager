import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WAMessageStatus
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { logger as defaultLogger } from '../utils/logger.js';

const CONNECTION_STATES = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  LOGGED_OUT: 'logged_out',
  STOPPED: 'stopped'
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
  onReady = async () => {
    const { taskAssignmentNotificationService } = await import('./taskAssignmentNotification.service.js');
    await taskAssignmentNotificationService.processPending();
  }
} = {}) => {
  let instanceSock = null;
  let connectionState = CONNECTION_STATES.DISCONNECTED;
  let initializationPromise = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let authStateLoadFailed = false;
  let authenticationValid = false;
  let lastConnectionAt = null;
  let lastSuccessfulSendAt = null;
  let lastError = null;
  const connectionWaiters = new Set();

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

  const scheduleReconnect = () => {
    if (stopped || connectionState === CONNECTION_STATES.LOGGED_OUT || reconnectTimer) return;
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
    if (process.env.ENABLE_WHATSAPP === 'false' || process.env.WHATSAPP_ENABLED === 'false') {
      connectionState = CONNECTION_STATES.DISCONNECTED;
      serviceLogger.info('[WA] Baileys outbound connection disabled via configuration flag.');
      notifyWaiters();
      return null;
    }

    initializationPromise = (async () => {
      connectionState = CONNECTION_STATES.CONNECTING;
      notifyWaiters();
      let authStateLoaded = false;
      try {
        const { state, saveCreds } = await authStateFactory(authInfoPath);
        authStateLoaded = true;
        authenticationValid = Boolean(state.creds?.registered);
        const newSock = socketFactory({
          auth: state,
          logger: pino({ level: 'silent' }),
          printQRInTerminal: false,
          markOnlineOnConnect: false,
          syncFullHistory: false,
          getMessage: async () => ({ conversation: '' })
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

        newSock.ev.on('connection.update', (update) => {
          if (instanceSock !== newSock) return;

          if (update.qr && !authenticationValid) {
            serviceLogger.info('[WA] No paired session found; scan the QR code to connect WhatsApp:');
            qrcode.generate(update.qr, { small: true });
          }

          if (update.connection === 'open') {
            connectionState = CONNECTION_STATES.CONNECTED;
            authenticationValid = Boolean(newSock.user);
            lastConnectionAt = new Date();
            lastError = null;
            reconnectAttempt = 0;
            serviceLogger.info('[WA] Baileys connected and authenticated for assignment notifications.');
            notifyWaiters();
            void Promise.resolve(onReady()).catch((error) => {
              lastError = redactError(error);
              serviceLogger.error(`[WA_OUTBOX] Could not resume pending notifications: ${lastError}`);
            });
          }

          if (update.connection === 'close') {
            const statusCode = update.lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === loggedOutCode;
            instanceSock = null;
            if (isLoggedOut) authenticationValid = false;
            connectionState = isLoggedOut
              ? CONNECTION_STATES.LOGGED_OUT
              : stopped
                ? CONNECTION_STATES.STOPPED
                : CONNECTION_STATES.DISCONNECTED;
            lastError = isLoggedOut
              ? 'WhatsApp session logged out; re-pair the existing account.'
              : statusCode
                ? `WhatsApp connection closed (${statusCode}).`
                : 'WhatsApp connection closed.';
            serviceLogger.warn(`[WA] Connection closed; state=${connectionState}.`);
            notifyWaiters();
            if (!isLoggedOut && !stopped) scheduleReconnect();
          }
        });

        return newSock;
      } catch (error) {
        instanceSock = null;
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
        else if (connectionState === CONNECTION_STATES.LOGGED_OUT || stopped) finish(false);
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
      const reason = connectionState === CONNECTION_STATES.LOGGED_OUT
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

      serviceLogger.info(`[WA_SEND_ATTEMPT] Sending assignment notification to ${redactPhoneNumber(targetJid)}.`);
      const sent = await activeSock.sendMessage(targetJid, { text: messageText.trim() });
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
    authenticationValid,
    sendingCapabilityStatus: isReady() ? 'ready' : 'unavailable',
    lastConnectionAt,
    lastSuccessfulSendAt,
    lastError: lastError ? redactError(lastError) : null
  });

  return {
    initialize,
    close,
    sendWhatsAppTaskNotification,
    getDiagnostics,
    getSocket: () => instanceSock,
    normalizeWhatsAppPhoneNumber
  };
};

const whatsappService = createWhatsAppService();
defaultWhatsAppService = whatsappService;

export const initWhatsAppListener = () => whatsappService.initialize();
export const closeWhatsAppListener = () => whatsappService.close();
export const sendWhatsAppTaskNotification = (...args) =>
  whatsappService.sendWhatsAppTaskNotification(...args);
export const sendWhatsAppMessage = async (...args) =>
  (await whatsappService.sendWhatsAppTaskNotification(...args)).success;
export const getWhatsAppDiagnostics = () => whatsappService.getDiagnostics();
export const whatsappListenerInternals = { normalizeWhatsAppPhoneNumber };

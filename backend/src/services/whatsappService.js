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

let sock = null;

export function getWhatsAppSocket() {
  return sock || global.waSock || null;
}

export const createWhatsAppService = ({
  socketFactory = makeWASocket,
  authStateFactory = useMultiFileAuthState,
  authInfoPath = env.WHATSAPP.authInfoPath,
  serviceLogger = defaultLogger,
  loggedOutCode = DisconnectReason.loggedOut,
  sendReadyTimeoutMs = 20_000,
  reconnectDelaysMs = [5_000, 10_000, 20_000, 40_000, 60_000]
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
    const s = instanceSock || sock || global.waSock;
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
        sock = newSock;
        global.waSock = newSock;

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
            sock = newSock;
            global.waSock = newSock;
            console.log('✅ [WA_SERVICE] WhatsApp socket successfully connected and globally stored.');
            serviceLogger.info('[WA] Baileys connected and authenticated for assignment notifications.');
            notifyWaiters();
          }

          if (update.connection === 'close') {
            const statusCode = update.lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === loggedOutCode;
            if (sock === newSock) sock = null;
            if (global.waSock === newSock) global.waSock = null;
            instanceSock = null;
            authenticationValid = false;
            connectionState = isLoggedOut
              ? CONNECTION_STATES.LOGGED_OUT
              : stopped
                ? CONNECTION_STATES.STOPPED
                : CONNECTION_STATES.DISCONNECTED;
            lastError = statusCode ? `WhatsApp connection closed (${statusCode}).` : 'WhatsApp connection closed.';
            serviceLogger.warn(`[WA] Connection closed; state=${connectionState}.`);
            notifyWaiters();
            if (!isLoggedOut && !stopped) scheduleReconnect();
          }
        });

        return newSock;
      } catch (error) {
        if (sock === instanceSock) sock = null;
        if (global.waSock === instanceSock) global.waSock = null;
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
    if (!sock && !initializationPromise && !reconnectTimer) {
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
      return { success: false, retryable: false, reason: 'Recipient not configured', error: 'Recipient not configured' };
    }
    if (typeof messageText !== 'string' || !messageText.trim()) {
      return { success: false, retryable: false, reason: 'Message text is empty', error: 'Message text is empty' };
    }

    let activeSock = getWhatsAppSocket() || instanceSock || sock;
    if (!activeSock || (activeSock.ws && activeSock.ws.readyState !== 1)) {
      if (typeof waitForReady === 'function') {
        const ready = await waitForReady();
        if (ready) {
          activeSock = getWhatsAppSocket() || instanceSock || sock;
        }
      }
    }

    if (!activeSock) {
      console.error('❌ [WA_OUTBOUND] Socket not connected: global.waSock is null.');
      return { success: false, retryable: true, reason: 'Socket not connected', error: 'Socket not connected' };
    }

    try {
      let targetJid = target.trim();

      // Format raw phone number into clean international digits
      if (!targetJid.endsWith('@g.us') && !targetJid.endsWith('@s.whatsapp.net')) {
        let digits = targetJid.replace(/[^0-9]/g, '');

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
          return { success: false, retryable: false, reason: 'Invalid phone number', error: 'Invalid phone number' };
        }

        // Query registered JID on WhatsApp
        const results = await activeSock.onWhatsApp(digits);
        const match = Array.isArray(results) ? results.find((r) => r?.exists && r?.jid) : results?.[0];
        if (!match || !match.exists) {
          console.error(`❌ [WA_OUTBOUND] Number ${digits} is not registered on WhatsApp.`);
          return { success: false, retryable: false, reason: 'Number not on WhatsApp', error: 'Number not on WhatsApp' };
        }
        targetJid = match.jid;
      } else {
        if (!/^\d+@(g\.us|s\.whatsapp\.net)$/.test(targetJid)) {
          return { success: false, retryable: false, reason: 'Invalid WhatsApp JID', error: 'Invalid WhatsApp JID' };
        }
      }

      console.log(`📤 [WA_OUTBOUND] Dispatching message to ${targetJid}...`);
      const sent = await activeSock.sendMessage(targetJid, { text: messageText.trim() });
      console.log(`✅ [WA_OUTBOUND_SUCCESS] Message delivered to ${targetJid}`);
      lastSuccessfulSendAt = new Date();
      lastError = null;
      return { success: true, messageId: sent?.key?.id };
    } catch (err) {
      console.error('❌ [WA_OUTBOUND_EXCEPTION]:', err.message);
      lastError = err.message;
      return { success: false, retryable: true, reason: err.message, error: err.message };
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
    const activeSocket = instanceSock || sock;
    if (sock === activeSocket) sock = null;
    if (global.waSock === activeSocket) global.waSock = null;
    instanceSock = null;
    if (!activeSocket) return;
    try {
      activeSocket.ev.removeAllListeners();
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
    normalizeWhatsAppPhoneNumber
  };
};

const whatsappService = createWhatsAppService();

export const initWhatsAppListener = () => whatsappService.initialize();
export const closeWhatsAppListener = () => whatsappService.close();
export const sendWhatsAppTaskNotification = (...args) =>
  whatsappService.sendWhatsAppTaskNotification(...args);
export const sendWhatsAppMessage = async (...args) =>
  (await whatsappService.sendWhatsAppTaskNotification(...args)).success;
export const getWhatsAppDiagnostics = () => whatsappService.getDiagnostics();
export const whatsappListenerInternals = { normalizeWhatsAppPhoneNumber };

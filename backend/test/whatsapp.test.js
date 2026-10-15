import test from 'node:test';
import assert from 'node:assert/strict';
import {
  whatsappListenerInternals,
  sendWhatsAppMessage,
  sendWhatsAppTaskNotification,
  createWhatsAppService,
  getWhatsAppDiagnostics
} from '../src/services/whatsappService.js';
import { whatsappWebhookController } from '../src/controllers/whatsappWebhook.controller.js';

test('WhatsApp outbound number normalization supports local PK/UK and international formats', () => {
  const { normalizeWhatsAppPhoneNumber } = whatsappListenerInternals;
  assert.equal(normalizeWhatsAppPhoneNumber('0300-1234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhoneNumber('07123 456789'), '447123456789');
  assert.equal(normalizeWhatsAppPhoneNumber('+92 (0) 300 1234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhoneNumber('+44 (0) 7123 456789'), '447123456789');
  assert.equal(normalizeWhatsAppPhoneNumber('12345'), '');
});

const createMockBaileysSocket = ({ readyState = 0 } = {}) => {
  const handlers = new Map();
  return {
    user: { id: 'sender@s.whatsapp.net' },
    ws: { readyState },
    ev: {
      on(event, handler) { handlers.set(event, handler); },
      removeAllListeners() { handlers.clear(); }
    },
    emit(event, payload) { handlers.get(event)?.(payload); },
    onWhatsApp: async (digits) => [{ exists: true, jid: `${digits}@s.whatsapp.net` }],
    async sendMessage(jid, message) {
      this.lastSent = { jid, message };
      return { key: { id: 'baileys-message-1' } };
    },
    end() {}
  };
};

const createMockedWhatsAppService = ({ readyState = 0, authStateFactory } = {}) => {
  let socket;
  const service = createWhatsAppService({
    authStateFactory: authStateFactory || (async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    })),
    socketFactory: () => {
      socket = createMockBaileysSocket({ readyState });
      return socket;
    },
    sendReadyTimeoutMs: 10,
    reconnectDelaysMs: [60_000],
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  return { service, getSocket: () => socket };
};

test('Baileys sends to the validated normalized contact JID and captures its message ID', async () => {
  const { service, getSocket } = createMockedWhatsAppService({ readyState: 1 });
  await service.initialize();
  getSocket().emit('connection.update', { connection: 'open' });

  const result = await service.sendWhatsAppTaskNotification('0317 9500901', 'Task assigned');
  assert.deepEqual(result, { success: true, messageId: 'baileys-message-1' });
  assert.deepEqual(getSocket().lastSent, {
    jid: '923179500901@s.whatsapp.net',
    message: { text: 'Task assigned' }
  });
  assert.equal(service.getDiagnostics().connectionStatus, 'connected');
  assert.equal(service.getDiagnostics().authenticationValid, true);
  await service.close();
});

test('Baileys waits for readiness and retries disconnected sends without reporting success', async () => {
  const { service, getSocket } = createMockedWhatsAppService();
  await service.initialize();
  const sendPromise = service.sendWhatsAppTaskNotification('447123456789', 'Task assigned');
  await new Promise((resolve) => setTimeout(resolve, 0));
  getSocket().ws.readyState = 1;
  getSocket().emit('connection.update', { connection: 'open' });

  assert.equal((await sendPromise).success, true);
  await service.close();
});

test('Baileys rejects invalid and unregistered phone numbers without sending', async () => {
  const { service, getSocket } = createMockedWhatsAppService({ readyState: 1 });
  await service.initialize();
  getSocket().emit('connection.update', { connection: 'open' });
  getSocket().onWhatsApp = async () => [{ exists: false }];
  assert.deepEqual(
    await service.sendWhatsAppTaskNotification('12345', 'Task assigned'),
    { success: false, retryable: false, reason: 'Invalid phone number' }
  );
  assert.equal((await service.sendWhatsAppTaskNotification('447123456789', 'Task assigned')).success, false);
  assert.equal(getSocket().lastSent, undefined);
  await service.close();
});

test('Baileys reports disconnected sends as retryable and does not create a competing socket', async () => {
  const { service, getSocket } = createMockedWhatsAppService();
  await service.initialize();
  const originalSocket = getSocket();
  const result = await service.sendWhatsAppTaskNotification('447123456789', 'Task assigned');
  assert.equal(result.retryable, true);
  assert.equal(service.getDiagnostics().connectionStatus, 'connecting');
  assert.equal(await service.initialize(), originalSocket);
  await service.close();
});

test('Baileys reports missing authentication state instead of silently sending', async () => {
  const { service } = createMockedWhatsAppService({
    authStateFactory: async () => { throw new Error('Authentication state unavailable'); }
  });
  await assert.rejects(service.initialize(), /Authentication state unavailable/);
  assert.equal(service.getDiagnostics().authenticationValid, false);
  assert.match(service.getDiagnostics().lastError, /Authentication state unavailable/);
  await service.close();
});

test('legacy disconnected sender fails without attempting to expose credentials', async () => {
  assert.equal(await sendWhatsAppMessage('', 'Hello'), false);
  assert.deepEqual(
    await sendWhatsAppTaskNotification('', 'Task notification'),
    { success: false, retryable: false, reason: 'Recipient not configured' }
  );
});

test('WhatsApp inbound webhook is disabled without inspecting or queueing its payload', () => {
  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  whatsappWebhookController.receive({
    get body() {
      throw new Error('Inbound body must not be accessed');
    }
  }, response);

  assert.equal(statusCode, 410);
  assert.deepEqual(responseBody, {
    status: 'disabled',
    message: 'WhatsApp inbound intake is disabled. Use the application to create tasks.'
  });
});

test('getWhatsAppDiagnostics returns safe operational shape without leaking tokens', () => {
  const diagnostics = getWhatsAppDiagnostics();
  assert.ok(diagnostics, 'diagnostics object should exist');
  assert.equal(typeof diagnostics.provider, 'string');
  assert.equal(typeof diagnostics.connectionStatus, 'string');
  assert.equal(typeof diagnostics.sendingCapabilityStatus, 'string');
  assert.equal(diagnostics.connectionStatus === 'connected' || diagnostics.connectionStatus === 'disconnected' || diagnostics.connectionStatus === 'stopped' || diagnostics.connectionStatus === 'connecting', true);
  // Ensure no secret fields are exposed
  assert.equal(diagnostics.auth, undefined);
  assert.equal(diagnostics.creds, undefined);
  assert.equal(diagnostics.tokens, undefined);
  assert.equal(diagnostics.keys, undefined);
});

test('sendWhatsAppTaskNotification safely validates empty inputs and recipient format', async () => {
  // Empty text
  const emptyText = await sendWhatsAppTaskNotification('923255984244', '');
  assert.equal(emptyText.success, false);
  assert.equal(emptyText.reason, 'Message text is empty');

  // Whitespace-only target
  const wsTarget = await sendWhatsAppTaskNotification('   ', 'Notification message');
  assert.equal(wsTarget.success, false);
  assert.equal(wsTarget.reason, 'Recipient not configured');
});

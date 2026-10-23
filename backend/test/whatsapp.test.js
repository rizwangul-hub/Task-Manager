import test from 'node:test';
import assert from 'node:assert/strict';
import {
  whatsappListenerInternals,
  sendWhatsAppMessage,
  sendWhatsAppTaskNotification,
  createWhatsAppService,
  getWhatsAppDiagnostics,
  getWhatsAppMessageTimestamp,
  isAfterWhatsAppProcessingCheckpoint
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

const createMockedWhatsAppService = ({
  readyState = 0,
  authStateFactory,
  onReady = async () => {},
  serviceLogger = { info() {}, warn() {}, error() {} }
} = {}) => {
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
    fileSystem: {
      async mkdir() {},
      async readdir() { return []; },
      async rename() {},
      async stat() {}
    },
    onReady,
    serviceLogger
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

test('concurrent startup calls initialize a single Baileys socket', async () => {
  let socketCount = 0;
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      socketCount += 1;
      return createMockBaileysSocket();
    },
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const [firstSocket, secondSocket] = await Promise.all([
    service.initialize(),
    service.initialize()
  ]);

  assert.equal(firstSocket, secondSocket);
  assert.equal(socketCount, 1);
  await service.close();
});

test('saved registered credentials do not report an authenticated connection before socket open', async () => {
  let authPath;
  const { service, getSocket } = createMockedWhatsAppService({
    authStateFactory: async (path) => {
      authPath = path;
      return {
        state: { creds: { registered: true } },
        saveCreds: async () => {}
      };
    }
  });
  await service.initialize();
  assert.equal(typeof authPath, 'string');
  assert.equal(service.getDiagnostics().connectionStatus, 'connecting');
  assert.equal(service.getDiagnostics().authenticationValid, false);
  getSocket().emit('connection.update', { connection: 'open' });
  assert.equal(service.getDiagnostics().connectionStatus, 'connected');
  assert.equal(service.getDiagnostics().authenticationValid, true);
  await service.close();
});

test('Baileys exposes a temporary QR code without logging the pairing contents', async () => {
  const warnings = [];
  const { service, getSocket } = createMockedWhatsAppService({
    serviceLogger: { info() {}, warn(message) { warnings.push(message); }, error() {} }
  });
  await service.initialize();
  getSocket().emit('connection.update', { qr: 'private-pairing-token' });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (service.getDiagnostics().qrCodeDataUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const diagnostics = service.getDiagnostics();
  assert.equal(diagnostics.connectionStatus, 'qr_required');
  assert.equal(diagnostics.qrRequired, true);
  assert.match(diagnostics.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(typeof diagnostics.qrExpiresAt, 'number');
  assert.equal(diagnostics.authenticationValid, false);
  assert.equal(warnings.some((message) => message.includes('private-pairing-token')), false);
  await service.close();
});

test('QR from an existing auth directory stays hidden until the user confirms a backup', async () => {
  const sockets = [];
  const operations = [];
  let authDirectoryHasData = true;
  const service = createWhatsAppService({
    authInfoPath: 'auth_info_baileys',
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const socket = createMockBaileysSocket();
      sockets.push(socket);
      return socket;
    },
    fileSystem: {
      async stat(path) { operations.push(['stat', path]); },
      async readdir() { return authDirectoryHasData ? ['creds.json'] : []; },
      async rename(source, destination) {
        operations.push(['rename', source, destination]);
        authDirectoryHasData = false;
      },
      async mkdir(path) { operations.push(['mkdir', path]); }
    },
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  await service.initialize();
  sockets[0].emit('connection.update', { qr: 'private-pairing-token' });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (service.getDiagnostics().rePairConfirmationRequired) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(service.getDiagnostics().qrCodeDataUrl, null);
  const confirmation = await service.reconnect();
  assert.equal(confirmation.rePairConfirmationRequired, true);
  assert.equal(operations.length, 0);

  const result = await service.reconnect({ confirmRePair: true });
  assert.equal(result.success, true);
  assert.ok(result.backupName);
  sockets[1].emit('connection.update', { qr: 'fresh-pairing-token' });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (service.getDiagnostics().qrCodeDataUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.match(service.getDiagnostics().qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(operations.some(([operation]) => operation === 'rename'), true);
  await service.close();
});

test('Baileys replaces stale sockets and sends only through the current connection', async () => {
  const sockets = [];
  let readyCount = 0;
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const socket = createMockBaileysSocket({ readyState: 1 });
      sockets.push(socket);
      return socket;
    },
    onReady: async () => { readyCount += 1; },
    reconnectDelaysMs: [60_000],
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  await service.initialize();
  const staleSocket = sockets[0];
  staleSocket.emit('connection.update', { connection: 'open' });
  staleSocket.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } }
  });

  const currentSocket = await service.initialize();
  assert.equal(sockets.length, 2);
  assert.equal(service.getSocket(), currentSocket);
  staleSocket.emit('connection.update', { connection: 'open' });
  currentSocket.emit('connection.update', { connection: 'open' });

  const result = await service.sendWhatsAppTaskNotification('447123456789', 'Task assigned');
  assert.equal(result.success, true);
  assert.equal(staleSocket.lastSent, undefined);
  assert.equal(currentSocket.lastSent.jid, '447123456789@s.whatsapp.net');
  assert.equal(readyCount, 2);
  await service.close();
});

test('manual reconnect reuses saved authentication and creates only one replacement socket', async () => {
  const sockets = [];
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const socket = createMockBaileysSocket();
      sockets.push(socket);
      return socket;
    },
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const originalSocket = await service.initialize();
  originalSocket.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } }
  });
  const result = await service.reconnect();

  assert.equal(sockets.length, 2);
  assert.notEqual(result.diagnostics.connectionStatus, 'connected');
  assert.notEqual(service.getSocket(), originalSocket);
  assert.equal(result.message, 'Reconnect started using the existing WhatsApp authentication data.');
  await service.close();
});

test('re-pairing requires confirmation and preserves the old auth directory as a backup', async () => {
  const fileSystemCalls = [];
  let socketCount = 0;
  const service = createWhatsAppService({
    authInfoPath: 'auth_info_baileys',
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      socketCount += 1;
      return createMockBaileysSocket();
    },
    fileSystem: {
      async stat(path) { fileSystemCalls.push(['stat', path]); },
      async rename(source, destination) { fileSystemCalls.push(['rename', source, destination]); },
      async mkdir(path) { fileSystemCalls.push(['mkdir', path]); }
    },
    loggedOutCode: 401,
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const socket = await service.initialize();
  socket.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } }
  });
  const confirmation = await service.reconnect();
  assert.equal(confirmation.rePairConfirmationRequired, true);
  assert.equal(socketCount, 1);
  assert.equal(fileSystemCalls.length, 0);

  const result = await service.reconnect({ confirmRePair: true });
  assert.equal(result.success, true);
  assert.match(result.backupName, /^auth_info_baileys\.backup-/);
  assert.equal(fileSystemCalls.some(([operation]) => operation === 'rename'), true);
  assert.equal(fileSystemCalls.some(([operation]) => operation === 'mkdir'), true);
  assert.equal(socketCount, 2);
  await service.close();
});

test('repeated Baileys Bad MAC errors are sanitized and rate limited', async () => {
  const warnings = [];
  let baileysLogger;
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: (options) => {
      baileysLogger = options.logger;
      return createMockBaileysSocket();
    },
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    serviceLogger: { info() {}, warn(message) { warnings.push(message); }, error() {} }
  });
  await service.initialize();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    baileysLogger.error({ msg: 'Session error: Bad MAC', key: 'private-session-material' });
  }

  const cryptoWarnings = warnings.filter((message) => message.includes('[WA_CRYPTO]'));
  assert.equal(cryptoWarnings.length, 1);
  assert.match(cryptoWarnings[0], /saved session was not changed/);
  assert.doesNotMatch(cryptoWarnings[0], /private-session-material|Bad MAC/);
  assert.equal(service.getDiagnostics().connectionStatus, 'connecting');
  await service.close();
});

test('libsignal direct decryption console errors are rate limited and restored on close', async () => {
  const warnings = [];
  const originalConsoleError = console.error;
  const { service } = createMockedWhatsAppService({
    serviceLogger: { info() {}, warn(message) { warnings.push(message); }, error() {} }
  });
  await service.initialize();
  try {
    assert.notEqual(console.error, originalConsoleError);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      console.error('Failed to decrypt message with any known session...');
    }

    const cryptoWarnings = warnings.filter((message) => message.includes('[WA_CRYPTO]'));
    assert.equal(cryptoWarnings.length, 1);
    assert.match(cryptoWarnings[0], /1 similar event/);
    assert.doesNotMatch(cryptoWarnings[0], /known session|Bad MAC/);
  } finally {
    await service.close();
  }
  assert.equal(console.error, originalConsoleError);
});

test('automatic reconnection stops after the configured attempt limit', async () => {
  const sockets = [];
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const socket = createMockBaileysSocket();
      sockets.push(socket);
      return socket;
    },
    maxReconnectAttempts: 1,
    reconnectDelaysMs: [0],
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const initialSocket = await service.initialize();
  initialSocket.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sockets.length, 2);
  sockets[1].emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } }
  });

  assert.match(service.getDiagnostics().lastError, /Automatic reconnection stopped/);
  assert.equal(sockets.length, 2);
  await service.close();
});

test('Baileys does not recreate a logged-out session automatically', async () => {
  let socketCount = 0;
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      socketCount += 1;
      return createMockBaileysSocket({ readyState: 1 });
    },
    loggedOutCode: 401,
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const socket = await service.initialize();
  socket.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } }
  });

  assert.equal(await service.initialize(), null);
  assert.equal(socketCount, 1);
  assert.equal(service.getDiagnostics().connectionStatus, 'logged_out');
  const result = await service.sendWhatsAppTaskNotification('447123456789', 'Task assigned');
  assert.equal(result.retryable, false);
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
  assert.equal([
    'connected',
    'connecting',
    'disconnected',
    'logged_out',
    'qr_required',
    'stopped'
  ].includes(diagnostics.connectionStatus), true);
  // Ensure no secret fields are exposed
  assert.equal(diagnostics.auth, undefined);
  assert.equal(diagnostics.creds, undefined);
  assert.equal(diagnostics.tokens, undefined);
  assert.equal(diagnostics.keys, undefined);
});

test('WhatsApp diagnostics explain when Vercel serverless cannot host Baileys', async () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    let socketCreations = 0;
    const service = createWhatsAppService({
      authStateFactory: async () => ({
        state: { creds: { registered: true } },
        saveCreds: async () => {}
      }),
      socketFactory: () => {
        socketCreations += 1;
        return createMockBaileysSocket({ readyState: 1 });
      },
      serviceLogger: { info() {}, warn() {}, error() {} }
    });
    assert.equal(await service.initialize(), null);
    const diagnostics = service.getDiagnostics();
    assert.equal(diagnostics.hostingCompatibility, 'serverless_unsupported');
    assert.match(diagnostics.hostingCompatibilityMessage, /persistent Node\.js process/);
    assert.match(diagnostics.lastError, /Vercel serverless function/);
    const sendResult = await service.sendWhatsAppTaskNotification('447123456789', 'Task assigned');
    assert.equal(sendResult.retryable, true);
    assert.match(sendResult.reason, /Vercel serverless function/);
    assert.equal(socketCreations, 0);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('WhatsApp diagnostics identify workers that do not own the Baileys socket', async () => {
  const previousInstance = process.env.NODE_APP_INSTANCE;
  process.env.NODE_APP_INSTANCE = '1';
  try {
    let socketCreations = 0;
    const service = createWhatsAppService({
      authStateFactory: async () => ({
        state: { creds: { registered: true } },
        saveCreds: async () => {}
      }),
      socketFactory: () => {
        socketCreations += 1;
        return createMockBaileysSocket({ readyState: 1 });
      },
      serviceLogger: { info() {}, warn() {}, error() {} }
    });

    assert.equal(await service.initialize(), null);
    const diagnostics = service.getDiagnostics();
    assert.equal(diagnostics.connectionStatus, 'disconnected');
    assert.equal(diagnostics.instanceRole, 'non_owner');
    assert.equal(diagnostics.hostingCompatibility, 'non_owner_worker');
    assert.match(diagnostics.hostingCompatibilityMessage, /single backend process/);
    assert.equal(socketCreations, 0);
    await service.close();
  } finally {
    if (previousInstance === undefined) delete process.env.NODE_APP_INSTANCE;
    else process.env.NODE_APP_INSTANCE = previousInstance;
  }
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

test('WhatsApp checkpoint rejects old, equal, and missing timestamps', () => {
  const checkpoint = new Date('2026-10-16T03:30:00.000Z');
  assert.equal(
    isAfterWhatsAppProcessingCheckpoint(new Date('2026-10-16T03:29:59.000Z'), checkpoint),
    false
  );
  assert.equal(isAfterWhatsAppProcessingCheckpoint(checkpoint, checkpoint), false);
  assert.equal(
    isAfterWhatsAppProcessingCheckpoint(new Date('2026-10-16T03:30:01.000Z'), checkpoint),
    true
  );
  assert.equal(getWhatsAppMessageTimestamp({ messageTimestamp: 0 }), null);
  assert.equal(getWhatsAppMessageTimestamp({}), null);
});

test('inbound notify events create one review draft for a new message and ignore old/history duplicates', async () => {
  const checkpoint = new Date('2026-10-16T03:30:00.000Z');
  const drafts = [];
  const logMessages = [];
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => createMockBaileysSocket({ readyState: 1 }),
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    inboundDependencies: {
      getCheckpoint: async () => checkpoint,
      findMonitoredGroup: async () => ({ groupName: 'Operations Group', isPaused: false }),
      updateGroupLastMessageAt: async () => {},
      findDraft: async (groupJid, messageId) =>
        drafts.find((draft) => draft.groupJid === groupJid && draft.messageId === messageId),
      createDraft: async (draftData) => {
        const draft = { ...draftData, status: 'awaiting_review', save: async () => {} };
        drafts.push(draft);
        return draft;
      },
      extractTask: async () => ({
        extraction: { isTask: true, confidence: 0.9, missingInformation: [] },
        provider: 'test',
        fallbackReason: 'Gemini extraction failed (HTTP 401); rule-based fallback was used.'
      }),
      broadcastDraft: async () => {}
    },
    serviceLogger: {
      info(...args) { logMessages.push(args.join(' ')); },
      warn(...args) { logMessages.push(args.join(' ')); },
      error(...args) { logMessages.push(args.join(' ')); }
    }
  });

  await service.initialize();
  const socket = service.getSocket();
  socket.emit('connection.update', { connection: 'open' });
  const groupJid = '120363049482690322@g.us';
  const newMessage = {
    key: { id: 'new-message', remoteJid: groupJid, participant: 'sender@s.whatsapp.net' },
    pushName: 'Sender',
    messageTimestamp: Math.floor(new Date('2026-10-16T03:31:00.000Z').getTime() / 1000),
    message: { conversation: 'Please update the project tracker' }
  };

  socket.emit('messages.upsert', {
    type: 'notify',
    messages: [
      {
        ...newMessage,
        key: { ...newMessage.key, id: 'old-message' },
        messageTimestamp: Math.floor(new Date('2026-10-16T03:29:00.000Z').getTime() / 1000)
      },
      newMessage
    ]
  });
  await service.waitForInboundProcessing();

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].status, 'awaiting_review');
  assert.equal(drafts[0].messageId, 'new-message');
  assert.equal(drafts[0].groupJid, groupJid);
  assert.equal(drafts[0].senderJid, 'sender@s.whatsapp.net');
  assert.equal(drafts[0].messageTimestamp.toISOString(), '2026-10-16T03:31:00.000Z');
  assert.equal(drafts[0].aiExtraction.isTask, true);
  assert.match(drafts[0].processingError, /Gemini extraction failed/);

  socket.emit('messages.upsert', { type: 'notify', messages: [newMessage] });
  socket.emit('messages.upsert', { type: 'append', messages: [newMessage] });
  socket.emit('messages.upsert', {
    type: 'append',
    messages: [{
      ...newMessage,
      key: { ...newMessage.key, id: 'history-append' },
      message: { conversation: 'Historical message should not be processed' }
    }]
  });
  await service.waitForInboundProcessing();
  assert.equal(drafts.length, 1);
  assert.equal(logMessages.some((entry) =>
    entry.includes('Please update the project tracker') ||
    entry.includes('Historical message should not be processed') ||
    entry.includes('sender@s.whatsapp.net') ||
    entry.includes(groupJid)
  ), false);

  await service.close();
});

test('reset waits for active extraction and checkpoint rejects replayed messages after service restart', async () => {
  let checkpoint = new Date('2026-10-16T03:30:00.000Z');
  let releaseExtraction;
  let notifyExtractionStarted;
  const extractionGate = new Promise((resolve) => { releaseExtraction = resolve; });
  const extractionStarted = new Promise((resolve) => { notifyExtractionStarted = resolve; });
  const drafts = [];
  const inboundDependencies = {
    getCheckpoint: async () => checkpoint,
    findMonitoredGroup: async () => ({ groupName: 'Operations Group', isPaused: false }),
    updateGroupLastMessageAt: async () => {},
    findDraft: async (groupJid, messageId) =>
      drafts.find((draft) => draft.groupJid === groupJid && draft.messageId === messageId),
    createDraft: async (draftData) => {
      const draft = { ...draftData, status: 'awaiting_review', save: async () => {} };
      drafts.push(draft);
      return draft;
    },
    extractTask: async () => {
      notifyExtractionStarted();
      await extractionGate;
      return {
        extraction: { isTask: true, confidence: 0.9, missingInformation: [] },
        provider: 'test'
      };
    },
    broadcastDraft: async () => {}
  };
  const createService = () => createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => createMockBaileysSocket({ readyState: 1 }),
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    inboundDependencies,
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const createMessage = (id, timestamp) => ({
    key: { id, remoteJid: '120363049482690322@g.us', participant: 'sender@s.whatsapp.net' },
    messageTimestamp: Math.floor(new Date(timestamp).getTime() / 1000),
    message: { conversation: 'Please update the project tracker' }
  });

  const service = createService();
  await service.initialize();
  service.getSocket().emit('connection.update', { connection: 'open' });
  service.getSocket().emit('messages.upsert', {
    type: 'notify',
    messages: [createMessage('before-reset', '2026-10-16T03:31:00.000Z')]
  });
  await extractionStarted;

  let resetCompleted = false;
  const reset = service.runInboundMaintenance(async () => {
    checkpoint = new Date('2026-10-16T03:32:00.000Z');
    resetCompleted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resetCompleted, false, 'reset must wait until in-flight AI extraction saves its draft');
  releaseExtraction();
  await reset;
  assert.equal(resetCompleted, true);
  await service.close();

  const restartedService = createService();
  await restartedService.initialize();
  restartedService.getSocket().emit('connection.update', { connection: 'open' });
  restartedService.getSocket().emit('messages.upsert', {
    type: 'notify',
    messages: [
      createMessage('replayed-old-message', '2026-10-16T03:31:00.000Z'),
      createMessage('new-after-restart', '2026-10-16T03:33:00.000Z')
    ]
  });
  await restartedService.waitForInboundProcessing();

  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((draft) => draft.messageId), ['before-reset', 'new-after-restart']);
  await restartedService.close();
});

test('ciphertext stubs rely on Baileys native retry handling instead of issuing duplicate session requests', async () => {
  const sessionAssertions = [];
  const socket = createMockBaileysSocket({ readyState: 1 });
  socket.assertSessions = async (jids, force) => {
    sessionAssertions.push({ jids, force });
  };
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => socket,
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    inboundDependencies: {
      getCheckpoint: async () => new Date('2026-10-22T00:00:00.000Z')
    },
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  await service.initialize();
  socket.emit('messages.upsert', {
    type: 'notify',
    messages: [{
      key: {
        id: 'ciphertext-lid-message',
        remoteJid: '120363000000000000@g.us',
        participant: '999000000001@lid',
        participantPn: '19995550123@s.whatsapp.net',
        participantLid: '999000000001@lid',
        fromMe: false
      },
      messageTimestamp: Math.floor(new Date('2026-10-22T00:01:00.000Z').getTime() / 1000),
      messageStubType: 2
    }]
  });
  await service.waitForInboundProcessing();

  assert.deepEqual(sessionAssertions, []);
  assert.equal(service.getDiagnostics().stats.totalDecryptionFailures, 1);
  await service.close();
});

test('group session bootstrap uses Baileys-discovered participant devices and the group addressing mode', async () => {
  const syncAssertions = [];
  const discoveryCalls = [];
  let finishBootstrap;
  const bootstrapFinished = new Promise((resolve) => {
    finishBootstrap = resolve;
  });
  const socket = createMockBaileysSocket({ readyState: 1 });
  socket.groupMetadata = async () => ({
    addressingMode: 'lid',
    participants: [
      { id: 'member-lid@lid', jid: 'member-phone@s.whatsapp.net', lid: 'member-lid@lid' }
    ]
  });
  socket.getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
    discoveryCalls.push({ jids, useCache, ignoreZeroDevices });
    return [
      { user: 'member-lid', device: 2 },
      { user: 'member-lid', device: 0 }
    ];
  };
  socket.assertSessions = async (jids, force) => {
    syncAssertions.push({ jids, force });
    finishBootstrap();
  };
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => socket,
    reconnectDelaysMs: [60_000],
    onReady: async () => {},
    inboundDependencies: {
      getMonitoredGroups: async () => [{ groupJid: '120363000000000000@g.us' }]
    },
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  await service.initialize();
  socket.emit('connection.update', { connection: 'open' });
  await bootstrapFinished;

  assert.deepEqual(discoveryCalls, [{
    jids: ['member-lid@lid'],
    useCache: false,
    ignoreZeroDevices: false
  }]);
  assert.deepEqual(syncAssertions, [{
    jids: ['member-lid:2@lid', 'member-lid@lid'],
    force: false
  }]);
  await service.close();
});

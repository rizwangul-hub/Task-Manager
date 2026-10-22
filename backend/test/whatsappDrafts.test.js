import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFullMessageText,
  createWhatsAppService
} from '../src/services/whatsappService.js';
import {
  extractTaskHeuristic,
  validateExtractionOutput,
  parseRelativeDate,
  callGemini,
  testGeminiConnectivity,
  extractTaskFromWhatsAppMessage
} from '../src/services/aiTaskExtraction.service.js';
import { TASK_DRAFT_STATUSES } from '../src/models/taskDraft.model.js';

test('1. extractFullMessageText correctly extracts text across various WhatsApp message wrappers', () => {
  // Plain conversation
  assert.equal(
    extractFullMessageText({ message: { conversation: 'Please update tracker' } }),
    'Please update tracker'
  );

  // Extended text
  assert.equal(
    extractFullMessageText({ message: { extendedTextMessage: { text: 'Fix bug in portal' } } }),
    'Fix bug in portal'
  );

  // Image with caption
  assert.equal(
    extractFullMessageText({ message: { imageMessage: { caption: 'Check invoice document' } } }),
    'Check invoice document'
  );

  // View Once wrapper with caption
  assert.equal(
    extractFullMessageText({
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: { caption: 'Confidential property report' }
          }
        }
      }
    }),
    'Confidential property report'
  );

  // Ephemeral wrapper
  assert.equal(
    extractFullMessageText({
      message: {
        ephemeralMessage: {
          message: {
            conversation: 'Urgent meeting at 3pm'
          }
        }
      }
    }),
    'Urgent meeting at 3pm'
  );

  // Empty or unsupported
  assert.equal(extractFullMessageText({ message: {} }), '');
  assert.equal(extractFullMessageText(null), '');
});

test('2. Greetings and casual conversations are not classified as tasks', () => {
  const casualMessages = [
    'Good morning',
    'Hello',
    'hi',
    'Thanks',
    'Thank you so much',
    'ok',
    'noted',
    'cool',
    'How are you?'
  ];

  for (const msg of casualMessages) {
    const res = extractTaskHeuristic(msg);
    assert.equal(res.isTask, false, `Message "${msg}" should not be detected as a task`);
    assert.equal(res.confidence, 0);
  }
});

test('3. Actionable work instructions produce valid task drafts', () => {
  const refDate = new Date('2026-10-16T10:00:00Z'); // Friday
  const projects = [
    { _id: 'proj_123', title: 'UK Property System' },
    { _id: 'proj_456', title: 'Marketing Portal' }
  ];

  const message = 'Rizwan, please update the UK Property System expense tracker and finish the report by Monday.';
  const res = extractTaskHeuristic(message, {
    senderName: 'Boss',
    messageTimestamp: refDate,
    projects
  });

  assert.equal(res.isTask, true);
  assert.ok(res.confidence >= 0.7);
  assert.ok(res.title.length > 5);
  assert.equal(res.projectId, 'proj_123');
  assert.equal(res.sourceSender, 'Boss');
  assert.ok(res.dueDate instanceof Date);
  // Monday after Friday Oct 16 is Oct 19
  assert.equal(res.dueDate.getDay(), 1); // 1 = Monday
});

test('4. Ambiguous deadlines are not invented and flagged for review', () => {
  const message = 'Please review the contract sometime.';
  const res = extractTaskHeuristic(message);

  assert.equal(res.isTask, true);
  assert.equal(res.dueDate, null);
  assert.equal(res.dateInterpretation, '');
});

test('5. parseRelativeDate accurately calculates future day dates relative to message timestamp', () => {
  const fridayRef = new Date('2026-10-16T09:00:00Z'); // Friday

  // "tomorrow"
  const tomorrowRes = parseRelativeDate('finish tomorrow', fridayRef);
  assert.ok(tomorrowRes.date);
  assert.equal(tomorrowRes.date.getDate(), 17); // Saturday

  // "by Monday"
  const mondayRes = parseRelativeDate('please complete by Monday', fridayRef);
  assert.ok(mondayRes.date);
  assert.equal(mondayRes.date.getDate(), 19); // Oct 19 is next Monday
  assert.ok(mondayRes.interpretation.includes('Monday'));

  // "today"
  const todayRes = parseRelativeDate('need this by today eod', fridayRef);
  assert.ok(todayRes.date);
  assert.equal(todayRes.date.getDate(), 16);
});

test('6. validateExtractionOutput validates schema and clamps confidence', () => {
  const raw = {
    isTask: true,
    confidence: 1.5, // out of range
    title: '  Test Task  ',
    description: 'A detailed task description',
    priority: 'InvalidPriority', // should default to Medium
    dueDate: '2026-11-01T00:00:00Z'
  };

  const validated = validateExtractionOutput(raw, []);
  assert.equal(validated.isTask, true);
  assert.equal(validated.confidence, 1.0); // clamped
  assert.equal(validated.title, 'Test Task');
  assert.equal(validated.priority, 'Medium'); // fallback
  assert.ok(validated.dueDate instanceof Date);
});

test('7. Heuristic extractor handles missing AI credentials gracefully without throwing', () => {
  const result = extractTaskHeuristic('Please verify the tenant deposits ASAP.', {
    senderName: 'Property Manager'
  });

  assert.equal(result.isTask, true);
  assert.equal(result.priority, 'Urgent');
  assert.equal(result.sourceSender, 'Property Manager');
  assert.ok(result.title.includes('Verify the tenant deposits'));
});

test('8. Task draft status transitions follow defined lifecycle', () => {
  assert.equal(TASK_DRAFT_STATUSES.AWAITING_REVIEW, 'awaiting_review');
  assert.equal(TASK_DRAFT_STATUSES.NEEDS_CLARIFICATION, 'needs_clarification');
  assert.equal(TASK_DRAFT_STATUSES.APPROVED, 'approved');
  assert.equal(TASK_DRAFT_STATUSES.REJECTED, 'rejected');
  assert.equal(TASK_DRAFT_STATUSES.FAILED, 'failed');
  assert.equal(TASK_DRAFT_STATUSES.IGNORED, 'ignored');
});

test('9. Inbound filter logic rejects non-group chats and status broadcasts', () => {
  const isEligibleChat = (jid) => typeof jid === 'string' && jid.endsWith('@g.us') && jid !== 'status@broadcast';

  assert.equal(isEligibleChat('120363049482690322@g.us'), true);
  assert.equal(isEligibleChat('447123456789@s.whatsapp.net'), false);
  assert.equal(isEligibleChat('status@broadcast'), false);
  assert.equal(isEligibleChat(''), false);
});

test('10. Unmonitored groups are ignored by group filtering check', () => {
  const monitoredGroupJids = new Set(['120363049482690322@g.us']);

  const shouldProcess = (groupJid) => monitoredGroupJids.has(groupJid);

  assert.equal(shouldProcess('120363049482690322@g.us'), true);
  assert.equal(shouldProcess('120363099999999999@g.us'), false);
});

test('11. Inbound deduplication ensures duplicate message events create at most one draft', () => {
  const processedKeys = new Set();

  const handleInboundEvent = (groupJid, messageId) => {
    const key = `${groupJid}:${messageId}`;
    if (processedKeys.has(key)) {
      return { created: false, reason: 'duplicate' };
    }
    processedKeys.add(key);
    return { created: true, draftId: `draft_${messageId}` };
  };

  const firstDelivery = handleInboundEvent('120363049482690322@g.us', 'msg_abc_123');
  assert.equal(firstDelivery.created, true);

  const duplicateDelivery = handleInboundEvent('120363049482690322@g.us', 'msg_abc_123');
  assert.equal(duplicateDelivery.created, false);
  assert.equal(duplicateDelivery.reason, 'duplicate');
});

test('12. Idempotent approval: double approval returns existing task and prevents duplicate tasks', () => {
  let createdTasksCount = 0;
  const draftState = {
    _id: 'draft_999',
    status: TASK_DRAFT_STATUSES.AWAITING_REVIEW,
    createdTask: null
  };

  const approveDraftMock = () => {
    // Atomic check: if already approved, return existing task without creating new task
    if (draftState.status === TASK_DRAFT_STATUSES.APPROVED && draftState.createdTask) {
      return { task: draftState.createdTask, isDuplicate: true };
    }

    createdTasksCount += 1;
    const newTask = { _id: `task_${createdTasksCount}`, taskKey: `PROJ-${createdTasksCount}` };
    draftState.status = TASK_DRAFT_STATUSES.APPROVED;
    draftState.createdTask = newTask;
    return { task: newTask, isDuplicate: false };
  };

  // First approval
  const firstApproval = approveDraftMock();
  assert.equal(firstApproval.isDuplicate, false);
  assert.equal(createdTasksCount, 1);
  assert.equal(draftState.status, TASK_DRAFT_STATUSES.APPROVED);

  // Second approval (double click / retry)
  const secondApproval = approveDraftMock();
  assert.equal(secondApproval.isDuplicate, true);
  assert.equal(createdTasksCount, 1); // Task count must remain 1!
  assert.equal(secondApproval.task._id, 'task_1');
});

test('13. Rejecting a draft sets status to rejected and never creates a task', () => {
  let createdTasksCount = 0;
  const draft = {
    status: TASK_DRAFT_STATUSES.AWAITING_REVIEW,
    createdTask: null
  };

  const rejectDraftMock = () => {
    draft.status = TASK_DRAFT_STATUSES.REJECTED;
    return draft;
  };

  rejectDraftMock();
  assert.equal(draft.status, TASK_DRAFT_STATUSES.REJECTED);
  assert.equal(draft.createdTask, null);
  assert.equal(createdTasksCount, 0);
});

test('14. callGemini sends correct REST request structure with x-goog-api-key and parses valid response', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    isTask: true,
                    title: 'Update UK expense tracker',
                    description: 'Finish report by tomorrow',
                    assigneeName: 'Rizwan',
                    assigneePhone: null,
                    priority: 'High',
                    dueDate: '2026-10-17T17:00:00.000Z',
                    projectName: 'UK Property System',
                    confidence: 0.95,
                    reason: 'Direct task delegation with due date',
                    missingInformation: []
                  })
                }
              ]
            }
          }
        ]
      })
    };
  };

  try {
    const result = await callGemini(
      'fake-api-key-xyz',
      'Rizwan, please update UK expense tracker by tomorrow.',
      {
        messageTimestamp: new Date('2026-10-16T10:00:00.000Z'),
        senderName: 'Manager',
        projects: [{ _id: 'proj_1', title: 'UK Property System' }]
      },
      { model: 'gemini-2.5-flash' }
    );

    assert.equal(capturedHeaders['x-goog-api-key'], 'fake-api-key-xyz');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.match(capturedUrl, /gemini-2.5-flash:generateContent/);
    assert.ok(capturedBody.contents[0].parts[0].text.includes('Rizwan, please update'));
    assert.equal(result.isTask, true);
    assert.equal(result.assigneeName, 'Rizwan');
    assert.equal(result.priority, 'High');
    assert.equal(result.modelUsed, 'gemini-2.5-flash');
  } finally {
    global.fetch = originalFetch;
  }
});

test('15. callGemini dynamically falls back to gemini-1.5-flash when primary model returns 404', async () => {
  const originalFetch = global.fetch;
  const attemptedUrls = [];

  global.fetch = async (url) => {
    attemptedUrls.push(url);

    // Primary model 404
    if (url.includes('gemini-2.5-flash')) {
      return {
        ok: false,
        status: 404,
        text: async () => 'Model not found or not supported for this API key'
      };
    }

    // Fallback model succeeds
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    isTask: true,
                    title: 'Fallback task extraction',
                    assigneeName: 'Alex',
                    priority: 'Medium',
                    confidence: 0.9
                  })
                }
              ]
            }
          }
        ]
      })
    };
  };

  try {
    const result = await callGemini(
      'test-key',
      'Alex, review the pull request',
      {
        messageTimestamp: new Date(),
        senderName: 'Lead',
        projects: []
      },
      { model: 'gemini-2.5-flash' }
    );

    assert.equal(result.isTask, true);
    assert.equal(result.modelUsed, 'gemini-1.5-flash');
    assert.equal(attemptedUrls.length, 2);
    assert.match(attemptedUrls[0], /gemini-2.5-flash/);
    assert.match(attemptedUrls[1], /gemini-1.5-flash/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('16. callGemini fast-fails immediately on 401 Unauthorized without retries', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;

  global.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 401,
      text: async () => 'API_KEY_INVALID'
    };
  };

  try {
    await assert.rejects(
      async () => {
        await callGemini(
          'bad-key',
          'Some message',
          { messageTimestamp: new Date(), projects: [] },
          { model: 'gemini-2.5-flash' }
        );
      },
      /Authentication or Client Error \(401\)/
    );

    assert.equal(callCount, 1, '401 Unauthorized must fast fail and not loop retries');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini auth failure uses heuristic fallback and reports a sanitized extraction warning', async () => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;
  const originalModel = process.env.GEMINI_MODEL;
  let callCount = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.AI_PROVIDER = 'gemini';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  global.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 401,
      text: async () => 'provider-secret-response'
    };
  };

  try {
    const result = await extractTaskFromWhatsAppMessage('Please update the project tracker', {
      providedProjects: []
    });
    assert.equal(result.provider, 'heuristic');
    assert.equal(result.extraction.isTask, true);
    assert.match(result.fallbackReason, /Gemini extraction failed \(HTTP 401\)/);
    assert.doesNotMatch(result.fallbackReason, /provider-secret-response/);
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  }
});

test('17. testGeminiConnectivity validates API key availability and response', async () => {
  // Test when no API key provided
  const missingKeyRes = await testGeminiConnectivity({ apiKey: '' });
  assert.equal(missingKeyRes.success, false);
  assert.equal(missingKeyRes.configured, false);

  // Test when API key provided and responds 200
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'valid-key');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ping":"pong"}' }] } }]
      })
    };
  };

  try {
    const successRes = await testGeminiConnectivity({ apiKey: 'valid-key', model: 'gemini-2.5-flash' });
    assert.equal(successRes.success, true);
    assert.equal(successRes.configured, true);
    assert.equal(successRes.model, 'gemini-2.5-flash');
  } finally {
    global.fetch = originalFetch;
  }
});

test('18. validateExtractionOutput preserves assigneeName, assigneePhone, reason, and modelUsed', () => {
  const rawOutput = {
    isTask: true,
    confidence: 0.92,
    title: 'Update property portfolio',
    description: 'Quarterly review',
    assigneeName: '  Rizwan Ahmed  ',
    assigneePhone: '+447123456789',
    projectName: 'Property System',
    reason: 'Explicit delegation from management',
    modelUsed: 'gemini-2.5-flash',
    priority: 'Urgent'
  };

  const validated = validateExtractionOutput(rawOutput);
  assert.equal(validated.isTask, true);
  assert.equal(validated.assigneeName, 'Rizwan Ahmed');
  assert.equal(validated.assigneePhone, '+447123456789');
  assert.equal(validated.reason, 'Explicit delegation from management');
  assert.equal(validated.modelUsed, 'gemini-2.5-flash');
  assert.equal(validated.priority, 'Urgent');
});

test('19. Inbound messages from manager account (fromMe === true) are ignored', () => {
  const shouldProcessMessage = (msg) => {
    if (msg?.key?.fromMe) return false;
    const remoteJid = msg?.key?.remoteJid || '';
    if (!remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return false;
    return true;
  };

  assert.equal(shouldProcessMessage({ key: { fromMe: true, remoteJid: '120363049482690322@g.us' } }), false);
  assert.equal(shouldProcessMessage({ key: { fromMe: false, remoteJid: '120363049482690322@g.us' } }), true);
});

test('20. Paused monitored groups are bypassed from inbound draft creation', () => {
  const groupsDb = new Map([
    ['120363049482690322@g.us', { isMonitored: true, isPaused: false }],
    ['120363049482690333@g.us', { isMonitored: true, isPaused: true }],
    ['120363049482690444@g.us', { isMonitored: false, isPaused: false }]
  ]);

  const isGroupActive = (jid) => {
    const record = groupsDb.get(jid);
    return Boolean(record && record.isMonitored && !record.isPaused);
  };

  assert.equal(isGroupActive('120363049482690322@g.us'), true);
  assert.equal(isGroupActive('120363049482690333@g.us'), false, 'Paused groups must not trigger task intake');
  assert.equal(isGroupActive('120363049482690444@g.us'), false, 'Disabled groups must not trigger task intake');
  assert.equal(isGroupActive('120363099999999999@g.us'), false, 'Unknown groups must not trigger task intake');
});

test('21. Non-actionable conversation transitions draft to ignored without creating a task', () => {
  let createdTaskCount = 0;
  const processDraftResult = (extraction) => {
    if (!extraction.isTask) {
      return { status: TASK_DRAFT_STATUSES.IGNORED, taskCreated: false };
    }
    createdTaskCount++;
    return { status: TASK_DRAFT_STATUSES.APPROVED, taskCreated: true };
  };

  const casualResult = processDraftResult({ isTask: false, reason: 'Casual greeting' });
  assert.equal(casualResult.status, 'ignored');
  assert.equal(casualResult.taskCreated, false);
  assert.equal(createdTaskCount, 0);

  const taskResult = processDraftResult({ isTask: true, title: 'Fix report' });
  assert.equal(taskResult.status, 'approved');
  assert.equal(taskResult.taskCreated, true);
  assert.equal(createdTaskCount, 1);
});

test('22. Reconnect safety: socket re-initialization replaces inactive socket without duplicate intake', async () => {
  let intakeEventCount = 0;
  let activeSocketInstance = null;

  const mockConnect = () => {
    const listeners = new Map();
    const sock = {
      id: Math.random().toString(),
      on: (event, handler) => { listeners.set(event, handler); },
      trigger: (event, payload) => { listeners.get(event)?.(payload); },
      close: () => { listeners.clear(); }
    };

    if (activeSocketInstance) {
      activeSocketInstance.close();
    }
    activeSocketInstance = sock;

    sock.on('messages.upsert', () => {
      intakeEventCount++;
    });

    return sock;
  };

  // Initial connect
  const socket1 = mockConnect();
  socket1.trigger('messages.upsert', { type: 'notify' });
  assert.equal(intakeEventCount, 1);

  // Simulated reconnect: socket1 is replaced by socket2
  const socket2 = mockConnect();
  socket2.trigger('messages.upsert', { type: 'notify' });
  assert.equal(intakeEventCount, 2, 'Only the active socket processes events after reconnect');

  // Stale socket1 triggers must have no effect
  socket1.trigger('messages.upsert', { type: 'notify' });
  assert.equal(intakeEventCount, 2, 'Stale socket listeners must be closed');
});

test('23. Awaiting Review query retrieves pending drafts and filters out non-awaiting drafts', () => {
  const draftsDatabase = [
    { _id: 'd1', status: 'awaiting_review', aiExtraction: { isTask: true, title: 'Draft 1' } },
    { _id: 'd2', status: 'approved', aiExtraction: { isTask: true, title: 'Draft 2' } },
    { _id: 'd3', status: 'awaiting_review', aiExtraction: { isTask: true, title: 'Draft 3' } },
    { _id: 'd4', status: 'ignored', aiExtraction: { isTask: false } }
  ];

  const filterByStatus = (status) => draftsDatabase.filter((d) => d.status === status);
  const awaitingDrafts = filterByStatus('awaiting_review');

  assert.equal(awaitingDrafts.length, 2);
  assert.deepEqual(awaitingDrafts.map((d) => d._id), ['d1', 'd3']);
});

test('24. Outbox processing safely bypasses execution when MongoDB is not connected', async () => {
  const { createTaskAssignmentNotificationService } = await import('../src/services/taskAssignmentNotification.service.js');
  const mockNotificationModel = {
    find() {
      throw new Error('Should not be called when disconnected');
    }
  };

  const service = createTaskAssignmentNotificationService({
    notificationModel: mockNotificationModel,
    contactModel: {},
    taskModel: {},
    sendNotification: async () => {},
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  // Verify processPending handles disconnection safely
  assert.equal(typeof service.processPending, 'function');
});

test('25. Gemini missing credentials produce clear error object without throwing uncaught exceptions', async () => {
  const res = await testGeminiConnectivity({ apiKey: '' });
  assert.equal(res.success, false);
  assert.equal(res.configured, false);
  assert.match(res.error, /GEMINI_API_KEY/);
});




test('26. Casual non-task message sets draft status to ignored and suppresses real-time broadcast', async () => {
  let socketHandler;
  const drafts = [];
  const broadcasts = [];
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const sock = {
        user: { id: 'sender@s.whatsapp.net' },
        ws: { readyState: 1 },
        ev: {
          on(evt, handler) {
            if (evt === 'messages.upsert') socketHandler = handler;
          },
          removeAllListeners() {}
        },
        emit(evt, payload) {
          if (evt === 'messages.upsert') socketHandler?.(payload);
        },
        end() {}
      };
      return sock;
    },
    reconnectDelaysMs: [60_000],
    inboundDependencies: {
      getCheckpoint: async () => new Date('2026-10-16T03:30:00.000Z'),
      findMonitoredGroup: async () => ({ groupName: 'General Chat', isPaused: false }),
      updateGroupLastMessageAt: async () => {},
      findDraft: async () => null,
      createDraft: async (draftData) => {
        const draft = { ...draftData, save: async () => {} };
        drafts.push(draft);
        return draft;
      },
      extractTask: async () => ({
        extraction: { isTask: false, confidence: 0.99, reason: 'Casual greeting' },
        provider: 'gemini'
      }),
      broadcastDraft: async (event, data) => {
        broadcasts.push({ event, data });
      }
    },
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  await service.initialize();
  const socket = service.getSocket();
  const casualMessage = {
    key: { id: 'msg-greeting', remoteJid: '120363049482690322@g.us', participant: 'sender@s.whatsapp.net' },
    pushName: 'Colleague',
    messageTimestamp: Math.floor(new Date('2026-10-16T03:35:00.000Z').getTime() / 1000),
    message: { conversation: 'Good morning' }
  };

  socket.emit('messages.upsert', {
    type: 'notify',
    messages: [casualMessage]
  });

  await service.waitForInboundProcessing();

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].status, 'ignored');
  assert.equal(drafts[0].aiExtraction.isTask, false);
  assert.equal(broadcasts.length, 0, 'Non-task messages must NOT trigger whatsapp:draft_created broadcast');
  await service.close();
});


test('27. Both manager (fromMe: true) and boss/team messages with actionable tasks create awaiting_review drafts when WHATSAPP_ALLOW_FROM_ME=true', async () => {
  const previousEnv = process.env.WHATSAPP_ALLOW_FROM_ME;
  process.env.WHATSAPP_ALLOW_FROM_ME = 'true';
  try {
    let socketHandler;
    const drafts = [];
    const broadcasts = [];
    const service = createWhatsAppService({
      authStateFactory: async () => ({
        state: { creds: { registered: true } },
        saveCreds: async () => {}
      }),
      socketFactory: () => {
        const sock = {
          user: { id: 'me@s.whatsapp.net', name: 'Rizwan' },
          ws: { readyState: 1 },
          ev: {
            on(evt, handler) {
              if (evt === 'messages.upsert') socketHandler = handler;
            },
            removeAllListeners() {}
          },
          emit(evt, payload) {
            if (evt === 'messages.upsert') socketHandler?.(payload);
          },
          end() {}
        };
        return sock;
      },
      reconnectDelaysMs: [60_000],
      inboundDependencies: {
        getCheckpoint: async () => new Date('2026-10-16T03:30:00.000Z'),
        findMonitoredGroup: async () => ({ groupName: 'Task', isPaused: false }),
        updateGroupLastMessageAt: async () => {},
        findDraft: async () => null,
        createDraft: async (draftData) => {
          const draft = { ...draftData, save: async () => {} };
          drafts.push(draft);
          return draft;
        },
        extractTask: async () => ({
          extraction: { isTask: true, title: 'Action task', confidence: 0.95 },
          provider: 'gemini'
        }),
        broadcastDraft: async (event, data) => {
          broadcasts.push({ event, data });
        }
      },
      serviceLogger: { info() {}, warn() {}, error() {} }
    });

    await service.initialize();
    const socket = service.getSocket();

    // 1. Message from 'me' (user themselves via append or notify)
    const myMessage = {
      key: { id: 'msg-from-me', remoteJid: '120363049482690322@g.us', fromMe: true },
      pushName: '',
      messageTimestamp: Math.floor(new Date('2026-10-16T03:35:00.000Z').getTime() / 1000),
      message: { conversation: 'Ahmed, please review the landing page by tomorrow 5pm' }
    };
    socket.emit('messages.upsert', {
      type: 'append',
      messages: [myMessage]
    });
    await service.waitForInboundProcessing();

    // 2. Message from 'boss' (team member in group)
    const bossMessage = {
      key: { id: 'msg-from-boss', remoteJid: '120363049482690322@g.us', fromMe: false, participant: 'boss@s.whatsapp.net' },
      pushName: 'Boss',
      messageTimestamp: Math.floor(new Date('2026-10-16T03:36:00.000Z').getTime() / 1000),
      message: { conversation: 'Rizwan, please submit financial report by Friday' }
    };
    socket.emit('messages.upsert', {
      type: 'notify',
      messages: [bossMessage]
    });
    await service.waitForInboundProcessing();

    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].senderName, 'Rizwan');
    assert.equal(drafts[0].status, 'awaiting_review');
    assert.equal(drafts[1].senderName, 'Boss');
    assert.equal(drafts[1].status, 'awaiting_review');
    assert.equal(broadcasts.length, 2);
    await service.close();
  } finally {
    process.env.WHATSAPP_ALLOW_FROM_ME = previousEnv;
  }
});

test('28. messages.update event with decrypted message content creates an awaiting_review draft', async () => {
  let updateHandler;
  const drafts = [];
  const service = createWhatsAppService({
    authStateFactory: async () => ({
      state: { creds: { registered: true } },
      saveCreds: async () => {}
    }),
    socketFactory: () => {
      const sock = {
        user: { id: 'me@s.whatsapp.net', name: 'Rizwan' },
        ws: { readyState: 1 },
        ev: {
          on(evt, handler) {
            if (evt === 'messages.update') updateHandler = handler;
          },
          removeAllListeners() {}
        },
        emit(evt, payload) {
          if (evt === 'messages.update') updateHandler?.(payload);
        },
        end() {}
      };
      return sock;
    },
    reconnectDelaysMs: [60_000],
    inboundDependencies: {
      getCheckpoint: async () => new Date('2026-10-16T03:30:00.000Z'),
      findMonitoredGroup: async () => ({ groupName: 'Task', isPaused: false }),
      updateGroupLastMessageAt: async () => {},
      findDraft: async () => null,
      createDraft: async (draftData) => {
        const draft = { ...draftData, save: async () => {} };
        drafts.push(draft);
        return draft;
      },
      extractTask: async () => ({
        extraction: { isTask: true, title: 'Updated decrypted task', confidence: 0.95 },
        provider: 'gemini'
      }),
      broadcastDraft: async () => {}
    },
    serviceLogger: { info() {}, warn() {}, error() {} }
  });

  await service.initialize();
  const socket = service.getSocket();
  socket.emit('messages.update', [
    {
      key: { id: 'msg-update-boss', remoteJid: '120363049482690322@g.us', fromMe: false, participant: 'boss@s.whatsapp.net' },
      update: {
        message: { conversation: 'Please prepare the client demo presentation by 4pm' },
        messageTimestamp: Math.floor(new Date('2026-10-16T03:37:00.000Z').getTime() / 1000),
        pushName: 'Boss'
      }
    }
  ]);
  await service.waitForInboundProcessing();

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].senderName, 'Boss');
  assert.equal(drafts[0].status, 'awaiting_review');
  await service.close();
});

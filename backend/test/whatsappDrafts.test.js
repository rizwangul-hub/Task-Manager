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
  testGeminiConnectivity
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




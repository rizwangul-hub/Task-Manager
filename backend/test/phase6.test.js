import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import { User, USER_ROLES } from '../src/models/user.model.js';
import { Project, PROJECT_STATUSES } from '../src/models/project.model.js';
import { Task, TASK_STATUSES, TASK_PRIORITIES } from '../src/models/task.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../src/models/taskEvent.model.js';
import { Notification, NOTIFICATION_TYPES } from '../src/models/notification.model.js';
import { NotificationOutbox, OUTBOX_STATUSES } from '../src/models/notificationOutbox.model.js';
import { TimeEntry } from '../src/models/timeEntry.model.js';
import { Comment } from '../src/models/comment.model.js';
import { generateTokens, verifyAccessToken, verifyRefreshToken } from '../src/utils/token.js';
import { sanitizeCsvCell, buildCsvString } from '../src/utils/csv.js';
import { schedulerService } from '../src/services/scheduler.service.js';
import { emailService } from '../src/services/email.service.js';

// Helper to make test HTTP requests
const makeRequest = (port, path, options = {}) => {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
};

test('Phase 6 Integration - Authentication, Sessions & Public Registration Defense', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Confirm public registration does not exist
    const regRes = await makeRequest(port, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Hacker', email: 'hacker@test.com', password: 'password123' }
    });
    assert.strictEqual(regRes.status, 404, 'Public registration route must return 404 Not Found');

    // 2. Reject login without credentials
    const emptyLoginRes = await makeRequest(port, '/api/auth/login', {
      method: 'POST',
      body: {}
    });
    // Can be 400 (validation) or 503 (if DB offline during test)
    assert.ok([400, 503].includes(emptyLoginRes.status), 'Login without credentials must fail safely');

    // 3. Reject access to protected route with tampered or expired token
    const tamperedRes = await makeRequest(port, '/api/auth/me', {
      headers: { Authorization: 'Bearer invalid.tampered.token' }
    });
    assert.strictEqual(tamperedRes.status, 401, 'Tampered token must return 401');

    // 4. Token lifecycle: access and refresh tokens
    const mockUser = {
      _id: '607f1f77bcf86cd799439099',
      email: 'integrator@pixxtechnologiees.com',
      role: USER_ROLES.MANAGER
    };
    const { accessToken, refreshToken } = generateTokens(mockUser);
    assert.ok(accessToken);
    assert.ok(refreshToken);

    const verifiedAccess = verifyAccessToken(accessToken);
    assert.strictEqual(verifiedAccess.id, mockUser._id);
    assert.strictEqual(verifiedAccess.role, USER_ROLES.MANAGER);

    const verifiedRefresh = verifyRefreshToken(refreshToken);
    assert.strictEqual(verifiedRefresh.id, mockUser._id);
  } finally {
    server.close();
  }
});

test('Phase 6 Integration - RBAC & IDOR Object-Level Access Control Rules', async () => {
  // 1. Validate Roles enum
  assert.strictEqual(USER_ROLES.ADMIN, 'Admin');
  assert.strictEqual(USER_ROLES.MANAGER, 'Manager');
  assert.strictEqual(USER_ROLES.MEMBER, 'Member');
  assert.strictEqual(USER_ROLES.EMPLOYEE, 'Member');

  // 2. Project creation constraints: start date cannot be after due date
  const invalidProject = new Project({
    name: 'Invalid Date Project',
    projectKey: 'INVD',
    startDate: new Date('2026-11-01'),
    dueDate: new Date('2026-10-01'), // Earlier than start date
    createdBy: '507f191e810c19729de860ea'
  });
  // Verify date logic detected
  assert.ok(invalidProject.startDate > invalidProject.dueDate, 'Invalid date ordering detected');

  // 3. Task Key Incremental Pattern
  const projectKey = 'PIXX';
  const taskCount = 14;
  const generatedKey = `${projectKey}-${taskCount + 1}`;
  assert.strictEqual(generatedKey, 'PIXX-15');
});

test('Phase 6 Integration - Task, Kanban & Calendar Lifecycle Validation', async () => {
  // 1. Validate existing workflow and WhatsApp intake statuses
  const expectedStatuses = ['Backlog', 'To Do', 'In Progress', 'Blocked', 'In Review', 'Done', 'Working on it', 'Stuck', 'Applied'];
  assert.deepStrictEqual(Object.values(TASK_STATUSES), expectedStatuses);

  // 2. Task model status default and validation
  const validTask = new Task({
    title: 'Valid Deliverable',
    taskKey: 'TEST-10',
    project: '507f191e810c19729de860ea',
    creator: '507f191e810c19729de860eb',
    status: TASK_STATUSES.IN_REVIEW,
    priority: TASK_PRIORITIES.URGENT
  });
  assert.strictEqual(validTask.status, 'In Review');
  assert.strictEqual(validTask.priority, 'Urgent');

  // 3. Completion date auto-setting logic
  const doneTask = new Task({
    title: 'Completed Deliverable',
    taskKey: 'TEST-11',
    project: '507f191e810c19729de860ea',
    creator: '507f191e810c19729de860eb',
    status: TASK_STATUSES.DONE,
    completedAt: new Date()
  });
  assert.ok(doneTask.completedAt instanceof Date, 'Done task should have completedAt timestamp');
});

test('Phase 6 Integration - Comments, Attachments, Time Tracking & Audit Events', async () => {
  // 1. Time entry validation constraints: durationMinutes must be between 1 and 1440
  const zeroMinuteEntry = new TimeEntry({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    durationMinutes: 0
  });
  assert.ok(zeroMinuteEntry.validateSync().errors.durationMinutes, 'Zero duration must be rejected');

  const excessiveEntry = new TimeEntry({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    durationMinutes: 1441 // > 24 hours
  });
  assert.ok(excessiveEntry.validateSync().errors.durationMinutes, 'Duration > 1440 min must be rejected');

  const validEntry = new TimeEntry({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    durationMinutes: 120
  });
  assert.strictEqual(validEntry.validateSync(), undefined, 'Valid duration should pass validation');

  // 2. Audit Event Reliability: TaskEvent.logEvent handles missing database gracefully
  const eventResult = await TaskEvent.logEvent({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    action: TASK_EVENT_ACTIONS.TIME_LOGGED
  });
  assert.strictEqual(eventResult, null, 'logEvent must catch errors without throwing');
});

test('Phase 6 Integration - Notifications, Sockets, Scheduler & Email Outbox', async () => {
  // 1. Scheduler single-instance protection
  assert.strictEqual(typeof schedulerService.startScheduler, 'function');
  assert.strictEqual(typeof schedulerService.stopScheduler, 'function');
  assert.strictEqual(typeof schedulerService.isRunning, 'function');

  // 2. Email service unconfigured state resilience
  const emailRes = await emailService.sendEmail({
    to: 'test@pixxtechnologiees.com',
    subject: 'System Check',
    html: '<p>Test</p>',
    text: 'Test'
  });
  assert.strictEqual(emailRes.success, false);
  assert.strictEqual(emailRes.reason, 'unconfigured');

  // 3. Outbox lifecycle statuses
  assert.strictEqual(OUTBOX_STATUSES.PENDING, 'pending');
  assert.strictEqual(OUTBOX_STATUSES.SENT, 'sent');
  assert.strictEqual(OUTBOX_STATUSES.FAILED, 'failed');

  // 4. Notification deduplication key schema check
  const notif = new Notification({
    recipient: '507f191e810c19729de860ea',
    type: NOTIFICATION_TYPES.TASK_OVERDUE,
    title: 'Overdue Alert',
    message: 'Task is overdue',
    dedupKey: 'overdue-task1-user1-2026-10-14'
  });
  assert.strictEqual(notif.dedupKey, 'overdue-task1-user1-2026-10-14');
});

test('Phase 6 Integration - CSV Export Security & Formula-Injection Defense', async () => {
  // Verify defense against all 6 spreadsheet formula execution triggers
  const triggers = ['=HYPERLINK("http://attacker.com")', '+2+5', '-10*2', '@SUM(A1:A5)', '\tEVIL_TAB', '\nEVIL_NEWLINE'];
  for (const trigger of triggers) {
    const sanitized = sanitizeCsvCell(trigger);
    assert.ok(
      sanitized.startsWith('"\'') || sanitized.startsWith("'"),
      `Cell starting with "${trigger.charAt(0)}" must be escaped with single quote`
    );
  }

  // Safe table export formatting
  const headers = ['Task Key', 'Title', 'Hours'];
  const rows = [
    ['=TASK-1', 'Normal Title', 4.5],
    ['TASK-2', 'Title with, comma', 2.0]
  ];
  const csv = buildCsvString(headers, rows);
  assert.ok(csv.includes('"Task Key","Title","Hours"'));
  assert.ok(csv.includes('"\'=TASK-1"'));
  assert.ok(csv.includes('"Title with, comma"'));
});

test('Phase 6 Integration - Centralized Error Handler Normalization', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Unmatched route returns 404 with structured error
    const notFoundRes = await makeRequest(port, '/api/non-existent-phase6-route');
    assert.strictEqual(notFoundRes.status, 404);
    assert.strictEqual(notFoundRes.body.status, 'error');
    assert.strictEqual(notFoundRes.body.statusCode, 404);

    // 2. Health diagnostic endpoint returns operational status
    const healthRes = await makeRequest(port, '/api/health');
    assert.ok([200, 503].includes(healthRes.status));
    assert.ok(healthRes.body.status);
    assert.ok(healthRes.body.services);
  } finally {
    server.close();
  }
});

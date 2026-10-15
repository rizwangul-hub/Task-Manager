import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import {
  Notification,
  NOTIFICATION_TYPES,
  NotificationOutbox,
  OUTBOX_STATUSES,
  User
} from '../src/models/index.js';
import { emailService, resolveEmailRecipient } from '../src/services/email.service.js';
import { schedulerService } from '../src/services/scheduler.service.js';
import { verifyAccessToken } from '../src/utils/token.js';

test('Phase 4 - Notification model schema validations and constants', async () => {
  // 1. Types
  assert.ok(NOTIFICATION_TYPES.TASK_ASSIGNED);
  assert.ok(NOTIFICATION_TYPES.TASK_UNASSIGNED);
  assert.ok(NOTIFICATION_TYPES.TASK_STATUS_CHANGED);
  assert.ok(NOTIFICATION_TYPES.TASK_DUE_DATE_CHANGED);
  assert.ok(NOTIFICATION_TYPES.TASK_COMMENT_ADDED);
  assert.ok(NOTIFICATION_TYPES.TASK_OVERDUE);
  assert.ok(NOTIFICATION_TYPES.TASK_UPCOMING_DUE);
  assert.ok(NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED);

  // 2. Notification doc default values
  const notif = new Notification({
    recipient: '507f191e810c19729de860ea',
    type: NOTIFICATION_TYPES.TASK_ASSIGNED,
    title: 'Test Assignment',
    message: 'You have a new assignment'
  });

  assert.strictEqual(notif.isRead, false);
  assert.strictEqual(notif.readAt, null);
  assert.strictEqual(notif.dedupKey, null);

  // 3. Invalid Notification (missing recipient)
  const invalidNotif = new Notification({
    type: NOTIFICATION_TYPES.TASK_ASSIGNED,
    title: 'Test'
  });
  const valErr = invalidNotif.validateSync();
  assert.ok(valErr.errors.recipient, 'Recipient should be required');
  assert.ok(valErr.errors.message, 'Message should be required');
});

test('Phase 4 - NotificationOutbox schema validations and constants', async () => {
  assert.ok(OUTBOX_STATUSES.PENDING);
  assert.ok(OUTBOX_STATUSES.SENT);
  assert.ok(OUTBOX_STATUSES.FAILED);

  const outboxJob = new NotificationOutbox({
    recipient: '507f191e810c19729de860ea',
    recipientEmail: 'employee@pixxtechnologiees.com',
    notificationType: NOTIFICATION_TYPES.TASK_ASSIGNED,
    channel: 'email'
  });

  assert.strictEqual(outboxJob.status, OUTBOX_STATUSES.PENDING);
  assert.strictEqual(outboxJob.attempts, 0);
  assert.strictEqual(outboxJob.maxAttempts, 3);
});

test('Phase 4 - User model contains default notificationPreferences', async () => {
  const user = new User({
    name: 'Test Employee',
    email: 'employee@pixxtechnologiees.com',
    passwordHash: 'dummyhash'
  });

  assert.ok(user.notificationPreferences);
  assert.strictEqual(user.notificationPreferences.emailNotifications, true);
  assert.strictEqual(user.notificationPreferences.taskAssigned, true);
  assert.strictEqual(user.notificationPreferences.taskStatusChanged, true);
  assert.strictEqual(user.notificationPreferences.taskDueDate, true);
  assert.strictEqual(user.notificationPreferences.taskComments, true);
  assert.strictEqual(user.notificationPreferences.overdueReminders, true);
});

test('Phase 4 - Email service handles unconfigured state safely without throwing', async () => {
  // Sending email when SMTP is unconfigured should cleanly suppress and not throw
  const res = await emailService.sendEmail({
    to: 'test@pixxtechnologiees.com',
    subject: 'Operational Alert',
    html: '<p>Test</p>',
    text: 'Test'
  });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.reason, 'unconfigured');
});

test('Placeholder task recipients are routed to EMAIL_USER', () => {
  const fallback = process.env.EMAIL_USER?.trim();
  if (!fallback) {
    assert.throws(
      () => resolveEmailRecipient('assignee@pixxtechnologiees.com'),
      /EMAIL_USER is not a valid fallback/
    );
    return;
  }

  for (const placeholder of [
    'assignee@pixxtechnologiees.com',
    'test@example.com',
    'dummy@invalid',
    'placeholder.user@gmail.com'
  ]) {
    assert.equal(resolveEmailRecipient(placeholder), fallback);
  }

  assert.equal(resolveEmailRecipient('person@gmail.com'), 'person@gmail.com');
});

test('Phase 4 - Scheduler service check runs without fatal crash when DB is offline', async () => {
  const res = await schedulerService.runDueRemindersCheck();
  // Catches gracefully and returns error descriptor when DB disconnected
  assert.strictEqual(typeof res, 'object');
});

test('Phase 4 - Socket authentication token verification security', async () => {
  // Tampered or invalid token should be rejected
  const tamperedToken = 'header.payload.invalidsignature';
  const decoded = verifyAccessToken(tamperedToken);
  assert.strictEqual(decoded, null, 'Tampered token must be rejected');

  const emptyDecoded = verifyAccessToken('');
  assert.strictEqual(emptyDecoded, null, 'Empty token must be rejected');
});

test('Phase 4 - Protected notification routes reject unauthenticated requests with 401', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const fakeId = '507f191e810c19729de860ea';
  const endpoints = [
    { method: 'GET', path: '/api/notifications' },
    { method: 'GET', path: '/api/notifications/unread-count' },
    { method: 'GET', path: '/api/notifications/preferences' },
    { method: 'PATCH', path: '/api/notifications/preferences', body: { emailNotifications: false } },
    { method: 'PATCH', path: '/api/notifications/mark-all-read' },
    { method: 'PATCH', path: `/api/notifications/${fakeId}/read` },
    { method: 'DELETE', path: `/api/notifications/${fakeId}` }
  ];

  try {
    for (const ep of endpoints) {
      const response = await fetch(`http://localhost:${port}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.strictEqual(response.status, 401, `${ep.method} ${ep.path} must reject without auth`);
      const body = await response.json();
      assert.strictEqual(body.status, 'error');
    }
  } finally {
    server.close();
  }
});

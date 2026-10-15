import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import {
  TaskEvent,
  TASK_EVENT_ACTIONS,
  Comment,
  TimeEntry,
  Task
} from '../src/models/index.js';

test('Phase 3 - Model schemas and constants validation', async () => {
  // 1. TaskEvent actions
  assert.ok(TASK_EVENT_ACTIONS.TASK_CREATED);
  assert.ok(TASK_EVENT_ACTIONS.TASK_UPDATED);
  assert.ok(TASK_EVENT_ACTIONS.STATUS_CHANGED);
  assert.ok(TASK_EVENT_ACTIONS.PRIORITY_CHANGED);
  assert.ok(TASK_EVENT_ACTIONS.ASSIGNMENT_CHANGED);
  assert.ok(TASK_EVENT_ACTIONS.DUE_DATE_CHANGED);
  assert.ok(TASK_EVENT_ACTIONS.TASK_ARCHIVED);
  assert.ok(TASK_EVENT_ACTIONS.TASK_RESTORED);
  assert.ok(TASK_EVENT_ACTIONS.COMMENT_ADDED);
  assert.ok(TASK_EVENT_ACTIONS.COMMENT_DELETED);
  assert.ok(TASK_EVENT_ACTIONS.ATTACHMENT_ADDED);
  assert.ok(TASK_EVENT_ACTIONS.ATTACHMENT_REMOVED);
  assert.ok(TASK_EVENT_ACTIONS.TIME_LOGGED);
  assert.ok(TASK_EVENT_ACTIONS.TIME_DELETED);

  // 2. Task model has attachments and totalTimeSpentMinutes
  const taskDoc = new Task({
    title: 'Test Task',
    taskKey: 'TEST-1',
    creator: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb'
  });
  assert.strictEqual(taskDoc.totalTimeSpentMinutes, 0);
  assert.ok(Array.isArray(taskDoc.attachments));
  assert.strictEqual(taskDoc.attachments.length, 0);

  // 3. TimeEntry validation
  const invalidTimeEntry = new TimeEntry({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    durationMinutes: 0 // invalid (< 1)
  });
  const valError = invalidTimeEntry.validateSync();
  assert.ok(valError.errors.durationMinutes, 'Duration below 1 minute should be invalid');

  // 4. Comment validation
  const invalidComment = new Comment({
    task: '507f191e810c19729de860ea',
    author: '507f191e810c19729de860eb',
    content: ''
  });
  const commentValError = invalidComment.validateSync();
  assert.ok(commentValError.errors.content, 'Empty comment content should be invalid');
});

test('Phase 3 - TaskEvent.logEvent static helper gracefully catches errors without crashing', async () => {
  // Calling logEvent when DB is offline should return null and not crash
  const res = await TaskEvent.logEvent({
    task: '507f191e810c19729de860ea',
    project: '507f191e810c19729de860eb',
    user: '507f191e810c19729de860ec',
    action: TASK_EVENT_ACTIONS.TASK_CREATED
  });
  // Without mongo running, it gracefully catches and returns null
  assert.strictEqual(res, null);
});

test('Phase 3 - Protected endpoints reject unauthenticated requests', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const fakeTaskId = '507f191e810c19729de860ea';
  const endpoints = [
    { method: 'GET', path: `/api/tasks/${fakeTaskId}/activity` },
    { method: 'GET', path: `/api/tasks/${fakeTaskId}/comments` },
    { method: 'POST', path: `/api/tasks/${fakeTaskId}/comments`, body: { content: 'test' } },
    { method: 'GET', path: `/api/tasks/${fakeTaskId}/time-entries` },
    { method: 'POST', path: `/api/tasks/${fakeTaskId}/time-entries`, body: { durationMinutes: 30 } },
    { method: 'POST', path: `/api/tasks/${fakeTaskId}/attachments` }
  ];

  try {
    for (const ep of endpoints) {
      const response = await fetch(`http://localhost:${port}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body ? JSON.stringify(ep.body) : undefined
      });
      assert.strictEqual(response.status, 401, `${ep.method} ${ep.path} should require authentication`);
      const body = await response.json();
      assert.strictEqual(body.status, 'error');
    }
  } finally {
    server.close();
  }
});

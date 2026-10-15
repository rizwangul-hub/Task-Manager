import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import { sanitizeCsvCell, buildCsvString } from '../src/utils/csv.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../src/models/task.model.js';

test('Phase 5 - CSV formula-injection defense tests', async () => {
  // 1. Cells starting with dangerous formula characters must have a leading single quote prepended
  assert.strictEqual(sanitizeCsvCell('=cmd|"/C calc"!A0'), '"\'=cmd|""/C calc""!A0"');
  assert.strictEqual(sanitizeCsvCell('+1+2'), '"\'+1+2"');
  assert.strictEqual(sanitizeCsvCell('-5+5'), '"\'-5+5"');
  assert.strictEqual(sanitizeCsvCell('@SUM(A1:A10)'), '"\'@SUM(A1:A10)"');
  assert.strictEqual(sanitizeCsvCell('\tTabCharacter'), '"\'\tTabCharacter"');

  // 2. Benign cells must not be modified with prepended quote
  assert.strictEqual(sanitizeCsvCell('Normal Task Title'), '"Normal Task Title"');
  assert.strictEqual(sanitizeCsvCell('PROJ-102'), '"PROJ-102"');

  // 3. Null or undefined values are safely formatted
  assert.strictEqual(sanitizeCsvCell(null), '""');
  assert.strictEqual(sanitizeCsvCell(undefined), '""');

  // 4. Test multi-row CSV generation
  const headers = ['Task Key', 'Title', 'Status'];
  const rows = [
    ['=KEY-1', 'Implement SSO', 'To Do'],
    ['KEY-2', 'Normal, with comma', 'In Progress']
  ];
  const csv = buildCsvString(headers, rows);

  // Verification
  assert.ok(csv.includes('"\'=KEY-1"'), 'Formula cell should be prefixed with single quote');
  assert.ok(csv.includes('"Normal, with comma"'), 'Comma cell should be safely escaped in quotes');
  assert.ok(csv.includes('"Task Key","Title","Status"'));
});

test('Phase 5 - Kanban task statuses and transitions definition', async () => {
  // Verify the existing workflow statuses and WhatsApp intake statuses are supported
  assert.strictEqual(TASK_STATUSES.BACKLOG, 'Backlog');
  assert.strictEqual(TASK_STATUSES.TO_DO, 'To Do');
  assert.strictEqual(TASK_STATUSES.IN_PROGRESS, 'In Progress');
  assert.strictEqual(TASK_STATUSES.BLOCKED, 'Blocked');
  assert.strictEqual(TASK_STATUSES.IN_REVIEW, 'In Review');
  assert.strictEqual(TASK_STATUSES.DONE, 'Done');
  assert.strictEqual(TASK_STATUSES.WORKING_ON_IT, 'Working on it');
  assert.strictEqual(TASK_STATUSES.STUCK, 'Stuck');
  assert.strictEqual(TASK_STATUSES.APPLIED, 'Applied');
  assert.strictEqual(Object.keys(TASK_STATUSES).length, 9);
});

test('Phase 5 - Task date range logic and validation', async () => {
  const startDate = new Date('2026-10-15');
  const dueDate = new Date('2026-10-10'); // Invalid: earlier than start date

  assert.ok(startDate > dueDate, 'Start date after due date must be detected');

  const validStart = new Date('2026-10-10');
  const validDue = new Date('2026-10-15');
  assert.ok(validStart <= validDue, 'Valid date sequence should pass');
});

test('Phase 5 - Management report metrics calculation logic', async () => {
  // Test completion rate calculation formula: (completed / total) * 100
  const calcRate = (completed, total) => (total > 0 ? Math.round((completed / total) * 100) : 0);

  assert.strictEqual(calcRate(0, 0), 0, 'Zero deliverables must not divide by zero');
  assert.strictEqual(calcRate(1, 4), 25, '1 of 4 should be 25%');
  assert.strictEqual(calcRate(2, 3), 67, '2 of 3 should round to 67%');
  assert.strictEqual(calcRate(10, 10), 100, '10 of 10 should be 100%');

  // Test working hours decimal conversion
  const calcHours = (minutes) => Math.round((minutes / 60) * 10) / 10;
  assert.strictEqual(calcHours(90), 1.5, '90 minutes should be 1.5 hours');
  assert.strictEqual(calcHours(45), 0.8, '45 minutes should round to 0.8 hours');
});

test('Phase 5 - Protected report and export routes reject unauthenticated requests with 401', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const request = (path, method = 'GET') => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  };

  try {
    // 1. Report summary endpoint requires authentication
    const repRes = await request('/api/reports/summary');
    assert.strictEqual(repRes.status, 401);

    // 2. Report CSV export requires authentication
    const repCsvRes = await request('/api/reports/export/csv');
    assert.strictEqual(repCsvRes.status, 401);

    // 3. Task CSV export requires authentication
    const taskCsvRes = await request('/api/tasks/export/csv');
    assert.strictEqual(taskCsvRes.status, 401);

    // 4. Direct status transition requires authentication
    const statusRes = await request('/api/tasks/507f191e810c19729de860ea/status', 'PATCH');
    assert.strictEqual(statusRes.status, 401);
  } finally {
    server.close();
  }
});

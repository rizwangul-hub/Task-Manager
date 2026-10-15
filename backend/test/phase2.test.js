import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import { User, USER_ROLES } from '../src/models/user.model.js';
import { Project, PROJECT_STATUSES } from '../src/models/project.model.js';
import { Task, TASK_STATUSES, TASK_PRIORITIES } from '../src/models/task.model.js';
import { generateTokens, verifyAccessToken, verifyRefreshToken } from '../src/utils/token.js';

test('Password hashing and comparison with bcryptjs', async (t) => {
  const plainPassword = 'SuperSecretPassword123!';
  const hash = await User.hashPassword(plainPassword);

  assert.ok(hash, 'Hash should be generated');
  assert.notStrictEqual(hash, plainPassword, 'Hash must not equal plain text password');
  assert.match(hash, /^\$2[aby]\$/, 'Hash should follow bcrypt format');

  const testUser = new User({
    name: 'Test Hash User',
    email: 'testhash@pixxtechnologiees.com',
    passwordHash: hash,
    role: USER_ROLES.EMPLOYEE
  });

  const isMatch = await testUser.comparePassword(plainPassword);
  assert.strictEqual(isMatch, true, 'comparePassword should return true for valid password');

  const isBadMatch = await testUser.comparePassword('WrongPassword999!');
  assert.strictEqual(isBadMatch, false, 'comparePassword should return false for invalid password');
});

test('JWT Access and Refresh token generation and verification', async (t) => {
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    email: 'admin@pixxtechnologiees.com',
    role: USER_ROLES.ADMIN
  };

  const { accessToken, refreshToken } = generateTokens(mockUser);

  assert.ok(accessToken, 'Access token generated');
  assert.ok(refreshToken, 'Refresh token generated');

  const decodedAccess = verifyAccessToken(accessToken);
  assert.ok(decodedAccess, 'Access token decoded successfully');
  assert.strictEqual(decodedAccess.id, mockUser._id);
  assert.strictEqual(decodedAccess.role, USER_ROLES.ADMIN);

  const decodedRefresh = verifyRefreshToken(refreshToken);
  assert.ok(decodedRefresh, 'Refresh token decoded successfully');
  assert.strictEqual(decodedRefresh.id, mockUser._id);

  const invalidTokenResult = verifyAccessToken('invalid.token.string');
  assert.strictEqual(invalidTokenResult, null, 'Invalid token should return null');
});

test('Protected routes reject requests without authentication', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const endpoints = [
      '/api/auth/me',
      '/api/users',
      '/api/projects',
      '/api/tasks',
      '/api/dashboard/stats'
    ];

    for (const ep of endpoints) {
      const res = await fetch(`http://localhost:${port}${ep}`);
      assert.strictEqual(
        res.status,
        401,
        `Endpoint ${ep} should return 401 Unauthorized without credentials`
      );
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    }
  } finally {
    server.close();
  }
});

test('Login fails gracefully when MongoDB is disconnected', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@pixxtechnologiees.com',
        password: 'password123'
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 503, 'Should return 503 when DB is offline');
    assert.strictEqual(data.status, 'error');
    assert.match(data.message, /Database service is currently unavailable/);
  } finally {
    server.close();
  }
});

test('Model schema validations and enums', async (t) => {
  assert.deepStrictEqual(
    Object.values(USER_ROLES),
    ['Admin', 'Manager', 'Member']
  );
  assert.strictEqual(USER_ROLES.EMPLOYEE, USER_ROLES.MEMBER, 'Legacy employee role maps to Member');

  assert.ok(Object.values(PROJECT_STATUSES).includes('Active'));
  assert.ok(Object.values(PROJECT_STATUSES).includes('Completed'));

  assert.ok(Object.values(TASK_STATUSES).includes('To Do'));
  assert.ok(Object.values(TASK_STATUSES).includes('In Progress'));
  assert.ok(Object.values(TASK_STATUSES).includes('Done'));
  assert.ok(Object.values(TASK_PRIORITIES).includes('Urgent'));
});

import test from 'node:test';
import assert from 'node:assert';
import app from '../src/app.js';
import http from 'node:http';

test('Health endpoint GET /api/health returns accurate response', async (t) => {
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://localhost:${port}/api/health`);
    const data = await response.json();

    assert.ok(data.status, 'Should have a status field');
    assert.strictEqual(data.service, 'PixxTechnologiees Task Manager API');
    assert.ok(data.database, 'Should report database status object');
    assert.strictEqual(typeof data.database.connected, 'boolean');
    assert.strictEqual(data.database.connected, false, 'Database should be reported as disconnected when MONGODB_URI is empty');
    assert.strictEqual(typeof data.services.cloudinary.configured, 'boolean', 'Cloudinary configuration status should be reported as boolean');
  } finally {
    server.close();
  }
});

test('Root API endpoint GET /api returns service descriptor', async (t) => {
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://localhost:${port}/api`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.name, 'PixxTechnologiees Task Manager API');
    assert.ok(data.endpoints.health);
  } finally {
    server.close();
  }
});

test('Backend root GET / returns service links instead of 404', async (t) => {
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.api, '/api');
    assert.strictEqual(data.health, '/api/health');
  } finally {
    server.close();
  }
});

test('Unmatched route returns 404 error with clean JSON', async (t) => {
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://localhost:${port}/api/non-existent-route`);
    const data = await response.json();

    assert.strictEqual(response.status, 404);
    assert.strictEqual(data.status, 'error');
    assert.strictEqual(data.statusCode, 404);
  } finally {
    server.close();
  }
});

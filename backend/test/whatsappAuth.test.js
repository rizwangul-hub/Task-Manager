import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import whatsappRoutes from '../src/routes/whatsapp.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('WhatsApp diagnostics route returns 401 without an authenticated session', async () => {
  const app = express();
  app.use('/api/whatsapp', whatsappRoutes);
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/whatsapp/diagnostics`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.status, 'error');
    assert.match(body.message, /Authentication required/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

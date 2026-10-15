import test from 'node:test';
import assert from 'node:assert/strict';
import {
  whatsappListenerInternals,
  sendWhatsAppMessage,
  sendWhatsAppTaskNotification
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

test('WhatsApp sends fail clearly when Baileys is disconnected', async () => {
  assert.equal(await sendWhatsAppMessage('447123456789', 'Hello from web dashboard'), false);
  assert.equal(await sendWhatsAppMessage('', 'Hello'), false);
  assert.deepEqual(
    await sendWhatsAppTaskNotification('447123456789', 'Task notification'),
    { success: false, reason: 'Socket not connected' }
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

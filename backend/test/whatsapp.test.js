import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Notification, NOTIFICATION_CHANNELS, EMAIL_DELIVERY_STATUSES } from '../src/models/notification.model.js';
import { Task, TASK_SOURCES } from '../src/models/task.model.js';
import { User } from '../src/models/user.model.js';
import { emailService } from '../src/services/email.service.js';
import {
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
  verifyTwilioWebhookSignature
} from '../src/utils/metaWhatsApp.js';
import { whatsappParserService } from '../src/services/whatsappParser.service.js';
import { whatsappPayloadAdapterService } from '../src/services/whatsappPayloadAdapter.service.js';
import {
  whatsappListenerInternals,
  sendWhatsAppMessage,
  sendWhatsAppTaskNotification
} from '../src/services/whatsappService.js';
import { uploadBufferToCloudinary } from '../src/services/cloudinaryUploadService.js';

test('WhatsApp task schema defaults and source enum', async () => {
  const task = new Task({
    title: ' WhatsApp intake ',
    project: '507f1f77bcf86cd799439011',
    taskKey: 'PRJ-WA-12345678',
    creator: '507f1f77bcf86cd799439012'
  });

  test('User schema stores an optional WhatsApp number', async () => {
    const user = new User({
      name: 'WhatsApp User',
      email: 'whatsapp-user@example.com',
      passwordHash: 'test-hash',
      whatsappNumber: ' 923179500901 '
    });

    assert.equal(user.whatsappNumber, '923179500901');
    await user.validate();

    const withoutNumber = new User({
      name: 'No WhatsApp User',
      email: 'no-whatsapp-user@example.com',
      passwordHash: 'test-hash'
    });
    assert.equal(withoutNumber.whatsappNumber, null);
  });

  assert.equal(task.title, 'WhatsApp intake');
  assert.equal(task.source, TASK_SOURCES.MANUAL);
  assert.equal(task.status, 'Working on it');
  assert.equal(task.groupTitle, 'General Tasks');
  assert.equal(task.reminderSent, false);
  assert.equal(task.deadlineAlertSent, false);
  assert.equal(task.overdueAlertSent, false);
  assert.equal(task.priority, 'Medium');

  task.source = TASK_SOURCES.WHATSAPP;
  task.whatsappMessageId = 'wamid.example';
  task.whatsappSender = { phone: '+15551234567', name: 'Fahad' };
  task.groupName = 'Penalty Charge Notice';
  task.groupTitle = 'Penalty Charge Notice';
  task.status = 'Working on it';
  task.attachments.push({
    url: 'https://res.cloudinary.com/demo/image/upload/test.jpg',
    public_id: 'pixx_tasks/whatsapp/test',
    fileName: 'whatsapp-test.jpg'
  });
  task.previewImage = { publicId: 'pixx_tasks/test', url: 'https://res.cloudinary.com/demo/image/upload/test.jpg' };
  await task.validate();
  assert.equal(task.source, TASK_SOURCES.WHATSAPP);
  assert.equal(task.whatsappSender.name, 'Fahad');
  assert.equal(task.groupName, 'Penalty Charge Notice');
  assert.equal(task.groupTitle, 'Penalty Charge Notice');
  assert.equal(task.status, 'Working on it');
  assert.equal(task.attachments[0].public_id, 'pixx_tasks/whatsapp/test');
  assert.equal(task.schema.indexes().some(([fields, options]) =>
    fields.whatsappMessageId === 1 && options.unique && options.sparse
  ), true);
  assert.equal(task.schema.indexes().some(([fields]) => fields.groupTitle === 1), true);
});

test('Notification schema supports dual delivery tracking and taskId alias', () => {
  const notification = new Notification({
    recipient: '507f1f77bcf86cd799439011',
    task: '507f1f77bcf86cd799439012',
    type: 'WHATSAPP_TASK_CREATED',
    title: 'New WhatsApp task',
    message: 'A task was created from WhatsApp.'
  });

  assert.equal(notification.channel, NOTIFICATION_CHANNELS.BOTH);
  assert.equal(notification.emailDeliveryStatus, EMAIL_DELIVERY_STATUSES.PENDING);
  assert.equal(notification.taskId.toString(), notification.task.toString());
});

test('Meta webhook token and raw-body signature checks', () => {
  const rawBody = Buffer.from('{"entry":[]}');
  const appSecret = 'meta-test-secret';
  const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  assert.equal(verifyMetaWebhookToken('verify-token', 'verify-token'), true);
  assert.equal(verifyMetaWebhookToken('wrong-token', 'verify-token'), false);
  assert.equal(verifyMetaWebhookSignature(rawBody, signature, appSecret), true);
  assert.equal(verifyMetaWebhookSignature(Buffer.from('{"entry":[ ]}'), signature, appSecret), false);
  assert.equal(verifyMetaWebhookSignature(rawBody, signature, ''), false);
});

test('WhatsApp parser routes board groups and separates title from description', () => {
  const parsed = whatsappParserService.parseMessage('Penalty ticket needs review. The fine is due tomorrow.');
  assert.equal(parsed.boardName, 'Penalty Charge Notice');
  assert.equal(parsed.groupName, 'Penalty Charge Notice');
  assert.equal(parsed.title, 'Penalty ticket needs review.');
  assert.equal(parsed.description, 'The fine is due tomorrow.');
  assert.equal(whatsappParserService.parseMessage('Stamp duty reimbursement').groupName, 'Stamp Duty Refund');
  assert.equal(whatsappParserService.parseMessage('Please review bridging loan').groupName, 'Bridging Loan');
  assert.equal(whatsappParserService.parseMessage('Dartford fine').groupTitle, 'Penalty Charge Notice');
  assert.equal(whatsappParserService.parseMessage('Bridging loan').groupTitle, 'Jasmine Work - Bridging Loan');
  assert.equal(whatsappParserService.parseMessage('Refund pending').groupTitle, 'Stamp Duty Refund');
  assert.equal(whatsappParserService.parseMessage('General question').groupName, 'Backlog / Unsorted');

  const long = whatsappParserService.parseMessage(`${'x'.repeat(90)} remaining details`);
  assert.equal(long.title.length, 80);
  assert.equal(long.description, `${'x'.repeat(10)} remaining details`);
  assert.deepEqual(whatsappParserService.findMentionedNames('@Fahad please ask @Jasmine'), ['Fahad', 'Jasmine']);
});

test('Baileys message helpers extract text and route group titles', () => {
  assert.equal(whatsappListenerInternals.getMessageText({
    conversation: 'Simple message'
  }), 'Simple message');
  assert.equal(whatsappListenerInternals.getMessageText({
    imageMessage: { caption: 'PCN ticket photo' }
  }), 'PCN ticket photo');
  assert.equal(whatsappListenerInternals.getGroupTitle('Dartford fine'), 'Penalty Charge Notice');
  assert.equal(whatsappListenerInternals.getGroupTitle('Bridging loan'), 'Jasmine Work - Bridging Loan');
  assert.equal(whatsappListenerInternals.getGroupTitle('Stamp duty refund'), 'Stamp Duty Refund');
  assert.equal(whatsappListenerInternals.getGroupTitle('General request'), 'General Tasks');
});

test('Baileys text extraction unwraps media, documents, ephemeral, and view-once messages', () => {
  const { extractMessageText } = whatsappListenerInternals;
  assert.equal(extractMessageText({
    message: { imageMessage: { caption: '  PCN image  ' } }
  }), 'PCN image');
  assert.equal(extractMessageText({
    message: { ephemeralMessage: { message: { documentMessage: { caption: 'Invoice task' } } } }
  }), 'Invoice task');
  assert.equal(extractMessageText({
    message: { viewOnceMessage: { message: { videoMessage: { caption: '  Bridging update ' } } } }
  }), 'Bridging update');
  assert.equal(extractMessageText({
    message: {
      viewOnceMessageV2: {
        message: {
          documentWithCaptionMessage: {
            message: { documentMessage: { fileName: '  Stamp Duty Refund.pdf  ' } }
          }
        }
      }
    }
  }), 'Stamp Duty Refund.pdf');
  assert.equal(extractMessageText({}), '');

  const { extractFullMessageText, getMediaObject, getUnwrappedContent } = whatsappListenerInternals;
  assert.equal(extractFullMessageText({
    message: { imageMessage: { caption: 'Photo of penalty notice' } }
  }), 'Photo of penalty notice');
  assert.equal(extractFullMessageText({
    message: { documentMessage: { caption: 'Urgent document attached' } }
  }), 'Urgent document attached');
  assert.equal(Boolean(getMediaObject(getUnwrappedContent({
    message: { documentMessage: { caption: 'doc' } }
  }))), true);
});

test('Baileys listener parses multiple allowed groups and handles all mode', () => {
  const previousGroupIds = process.env.PIXX_WHATSAPP_GROUP_ID;
  try {
    process.env.PIXX_WHATSAPP_GROUP_ID = '120363000000000001@g.us, 120363000000000002@g.us,,';
    assert.deepEqual(whatsappListenerInternals.getAllowedGroups(), [
      '120363000000000001@g.us',
      '120363000000000002@g.us'
    ]);
    assert.equal(whatsappListenerInternals.isTargetGroup('120363000000000002@g.us'), true);
    assert.equal(whatsappListenerInternals.isTargetGroup('120363000000000003@g.us'), false);
    assert.equal(whatsappListenerInternals.shouldProcessMessage({
      key: {
        id: 'outgoing-group-message',
        remoteJid: '120363000000000002@g.us',
        fromMe: true
      }
    }), true);

    process.env.PIXX_WHATSAPP_GROUP_ID = ' all ';
    assert.deepEqual(whatsappListenerInternals.getAllowedGroups(), ['all']);
    assert.equal(whatsappListenerInternals.isTargetGroup('120363000000000003@g.us'), true);
    assert.equal(whatsappListenerInternals.shouldIgnoreJid('status@broadcast'), true);
    assert.equal(whatsappListenerInternals.shouldIgnoreJid('12345@lid'), true);
    assert.equal(whatsappListenerInternals.shouldIgnoreJid('120363000000000003@g.us'), false);
  } finally {
    if (previousGroupIds === undefined) delete process.env.PIXX_WHATSAPP_GROUP_ID;
    else process.env.PIXX_WHATSAPP_GROUP_ID = previousGroupIds;
  }
});

test('Baileys listener suppresses only decrypt errors from history or non-group messages', () => {
  const badMacError = new Error('Bad MAC');
  assert.equal(whatsappListenerInternals.isExpectedHistoryDecryptError(
    badMacError,
    { key: { remoteJid: 'status@broadcast' } },
    'notify'
  ), true);
  assert.equal(whatsappListenerInternals.isExpectedHistoryDecryptError(
    new Error('Failed to decrypt message'),
    { key: { remoteJid: '15551234567@s.whatsapp.net' } },
    'notify'
  ), true);
  assert.equal(whatsappListenerInternals.isExpectedHistoryDecryptError(
    badMacError,
    { key: { remoteJid: '120363000000000000@g.us' } },
    'append'
  ), true);
  assert.equal(whatsappListenerInternals.isExpectedHistoryDecryptError(
    badMacError,
    { key: { remoteJid: '120363000000000000@g.us' } },
    'notify'
  ), false);
  assert.equal(whatsappListenerInternals.isExpectedHistoryDecryptError(
    new Error('Network timeout'),
    { key: { remoteJid: 'status@broadcast' } },
    'notify'
  ), false);
});

test('Cloudinary buffer helper rejects invalid buffers without attempting an upload', async () => {
  await assert.rejects(
    uploadBufferToCloudinary(Buffer.alloc(0), 'pixx_tasks/whatsapp', 'empty.jpg'),
    /non-empty Buffer/
  );
});

test('WhatsApp provider adapter normalizes Meta, Twilio, and Baileys messages', () => {
  const meta = whatsappPayloadAdapterService.normalize({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '15551234567', profile: { name: 'Fahad' } }],
      messages: [{ id: 'meta-1', from: '15551234567', group_id: 'group-1', type: 'image', image: { id: 'media-1', caption: 'PCN image' } }]
    } }] }]
  });
  assert.equal(meta.provider, 'meta');
  assert.equal(meta.messages[0].senderName, 'Fahad');
  assert.equal(meta.messages[0].media[0].id, 'media-1');

  const twilio = whatsappPayloadAdapterService.normalize({
    MessageSid: 'twilio-1',
    From: 'whatsapp:+15551234567',
    GroupSid: 'group-1',
    Body: 'Bridging loan',
    NumMedia: '1',
    MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/a/Media/b',
    MediaContentType0: 'image/jpeg'
  });
  assert.equal(twilio.provider, 'twilio');
  assert.equal(twilio.messages[0].senderPhone, '+15551234567');
  assert.equal(twilio.messages[0].media[0].mimeType, 'image/jpeg');

  const baileys = whatsappPayloadAdapterService.normalize({
    key: { id: 'baileys-1', remoteJid: 'group-1@g.us', participant: '15551234567' },
    pushName: 'Jasmine',
    message: { imageMessage: { caption: 'Stamp duty', base64: Buffer.from('image').toString('base64'), mimetype: 'image/png' } }
  });
  assert.equal(baileys.provider, 'baileys');
  assert.equal(baileys.messages[0].groupId, 'group-1@g.us');
  assert.equal(baileys.messages[0].media[0].mimeType, 'image/png');
});

test('Twilio webhook signature validation uses the full callback URL and sorted form parameters', () => {
  const authToken = 'twilio-test-token';
  const url = 'https://example.test/api/webhook/whatsapp';
  const params = { Body: 'Hello', From: 'whatsapp:+15551234567' };
  const signedPayload = `${url}BodyHelloFromwhatsapp:+15551234567`;
  const signature = createHmac('sha1', authToken).update(signedPayload).digest('base64');
  assert.equal(verifyTwilioWebhookSignature(url, params, signature, authToken), true);
  assert.equal(verifyTwilioWebhookSignature(url, params, signature, 'wrong-token'), false);
});

test('WhatsApp intake email escapes untrusted HTML content', () => {
  const template = emailService.templates.whatsappTaskCreated({
    taskTitle: '<img src=x onerror=alert(1)>',
    taskKey: 'PRJ-WA-12345678',
    projectName: 'Project <script>',
    senderPhone: '<script>alert(1)</script>',
    groupName: 'Penalty Charge Notice',
    priority: 'Urgent',
    dueDate: '10/15/2026',
    taskPreviewUrl: 'https://res.cloudinary.com/demo/image/upload/preview.jpg',
    actionUrl: 'https://example.com/tasks'
  });

  assert.doesNotMatch(template.html, /<script>|<img src=x/);
  assert.match(template.html, /alt="WhatsApp task attachment"/);
  assert.match(template.html, /&lt;script&gt;/);
  assert.match(template.html, /Penalty Charge Notice/);
  assert.match(template.html, /Urgent/);
  assert.match(template.html, /10\/15\/2026/);
});

test('Task assignment email includes board, group, priority, and due date safely', () => {
  const template = emailService.templates.taskAssigned({
    taskTitle: '<img src=x>',
    taskKey: 'PRJ-1',
    projectName: 'Agency Board',
    groupName: 'Urgent Matters',
    assignerName: 'Manager',
    priority: 'High',
    dueDate: '10/15/2026',
    actionUrl: 'https://example.com/tasks'
  });

  assert.match(template.html, /Agency Board/);
  assert.match(template.html, /Urgent Matters/);
  assert.match(template.html, /High/);
  assert.match(template.html, /10\/15\/2026/);
  assert.doesNotMatch(template.html, /<img src=x>/);
});

test('sendWhatsAppMessage handles disconnected Baileys socket and empty recipient safely', async () => {
  const resultDisconnected = await sendWhatsAppMessage('447123456789', 'Hello from web dashboard');
  assert.equal(resultDisconnected, false);

  const resultEmpty = await sendWhatsAppMessage('', 'Hello');
  assert.equal(resultEmpty, false);

  const taskResult = await sendWhatsAppTaskNotification('447123456789', 'Task notification');
  assert.deepEqual(taskResult, { success: false, reason: 'Socket not connected' });
});

test('WhatsApp outbound number normalization supports local PK/UK and international formats', () => {
  const { normalizeWhatsAppPhoneNumber } = whatsappListenerInternals;
  assert.equal(normalizeWhatsAppPhoneNumber('0300-1234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhoneNumber('07123 456789'), '447123456789');
  assert.equal(normalizeWhatsAppPhoneNumber('+92 (0) 300 1234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhoneNumber('+44 (0) 7123 456789'), '447123456789');
  assert.equal(normalizeWhatsAppPhoneNumber('12345'), '');
});

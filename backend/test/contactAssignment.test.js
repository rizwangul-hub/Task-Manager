import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Contact, normalizeContactWhatsAppNumber } from '../src/models/contact.model.js';
import { Task } from '../src/models/task.model.js';
import {
  TaskWhatsAppNotification,
  TASK_WHATSAPP_STATUSES
} from '../src/models/taskWhatsAppNotification.model.js';
import { contactController } from '../src/controllers/contact.controller.js';
import {
  createTaskAssignmentNotificationService,
  taskAssignmentNotificationService
} from '../src/services/taskAssignmentNotification.service.js';
import { authenticate } from '../src/middleware/auth.middleware.js';

test('contact numbers normalize common Pakistan and UK formats to E.164', () => {
  assert.equal(normalizeContactWhatsAppNumber('+92 (0) 317-9500901'), '+923179500901');
  assert.equal(normalizeContactWhatsAppNumber('0317 9500901'), '+923179500901');
  assert.equal(normalizeContactWhatsAppNumber('+44 (0) 7123 456789'), '+447123456789');
  assert.equal(normalizeContactWhatsAppNumber('07123 456789'), '+447123456789');
  assert.equal(normalizeContactWhatsAppNumber('12345'), '');
});

test('contact schema validates required fields and has unique normalized-number index', async () => {
  const valid = new Contact({
    fullName: ' Ahmed Khan ',
    whatsappNumber: '+92 317 9500901'
  });
  await valid.validate();
  assert.equal(valid.fullName, 'Ahmed Khan');
  assert.equal(valid.whatsappNumber, '+923179500901');

  const invalid = new Contact({ fullName: 'Missing phone', whatsappNumber: '12345' });
  await assert.rejects(invalid.validate(), /valid international WhatsApp number/);
  assert.ok(Contact.schema.indexes().some(([fields, options]) =>
    fields.whatsappNumber === 1 && options.unique
  ));
});

test('contact create endpoint stores normalized numbers and rejects duplicate index errors', async () => {
  const originalCreate = Contact.create;
  const responseFor = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  });

  try {
    let createdData;
    Contact.create = async (data) => {
      createdData = data;
      return { toJSON: () => ({ ...data, _id: 'contact-id' }) };
    };
    const successResponse = responseFor();
    await contactController.create({
      body: { fullName: 'Ahmed Khan', whatsappNumber: '0317 9500901' }
    }, successResponse, (error) => { throw error; });
    assert.equal(successResponse.statusCode, 201);
    assert.equal(createdData.whatsappNumber, '+923179500901');

    Contact.create = async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); };
    let duplicateError;
    await contactController.create({
      body: { fullName: 'Another Ahmed', whatsappNumber: '+923179500901' }
    }, responseFor(), (error) => { duplicateError = error; });
    assert.equal(duplicateError.statusCode, 409);
  } finally {
    Contact.create = originalCreate;
  }
});

test('task and WhatsApp history schemas preserve contact assignment and deduplicate dispatches', async () => {
  const contactId = new mongoose.Types.ObjectId();
  const task = new Task({
    title: 'Monthly report',
    project: new mongoose.Types.ObjectId(),
    taskKey: 'PRJ-1',
    creator: new mongoose.Types.ObjectId(),
    assignedContact: contactId,
    contactAssignmentId: new mongoose.Types.ObjectId()
  });
  await task.validate();
  assert.equal(task.assignedContact.toString(), contactId.toString());
  assert.equal(task.whatsappNotificationSent, false);
  assert.ok(Task.schema.indexes().some(([fields, options]) =>
    fields.creator === 1 &&
    fields.creationRequestId === 1 &&
    options.unique &&
    options.partialFilterExpression
  ));

  const history = new TaskWhatsAppNotification({
    task: task._id,
    contact: contactId,
    contactName: 'Ahmed Khan',
    recipientNumber: '+923179500901',
    assignmentId: task.contactAssignmentId
  });
  await history.validate();
  assert.equal(history.status, TASK_WHATSAPP_STATUSES.PENDING);
  assert.ok(TaskWhatsAppNotification.schema.indexes().some(([fields, options]) =>
    fields.task === 1 && fields.assignmentId === 1 && options.unique
  ));
});

test('assignment notification text includes task details and handles optional fields', () => {
  const fullMessage = taskAssignmentNotificationService.buildAssignmentMessage({
    title: 'Prepare monthly report',
    project: { name: 'Finance' },
    priority: 'High',
    dueDate: '2026-10-20T00:00:00.000Z',
    description: 'Verify expenses.'
  }, { fullName: 'Ahmed Khan' });
  assert.match(fullMessage, /Hello Ahmed Khan/);
  assert.match(fullMessage, /Task: Prepare monthly report/);
  assert.match(fullMessage, /Project: Finance/);
  assert.match(fullMessage, /Priority: High/);
  assert.match(fullMessage, /Description: Verify expenses\./);
  assert.match(fullMessage, /Thank you\./);

  const minimalMessage = taskAssignmentNotificationService.buildAssignmentMessage({
    title: 'Review',
    priority: 'Low'
  }, { fullName: 'Sam' });
  assert.match(minimalMessage, /Due Date: No deadline/);
  assert.doesNotMatch(minimalMessage, /Description:/);
});

test('outbox records provider failures, retries safely, and deduplicates assignment sends', async () => {
  let record = null;
  let sendCount = 0;
  let shouldSend = false;
  let taskFlagUpdated = false;
  const notificationModel = {
    async create(data) {
      if (record) throw Object.assign(new Error('duplicate assignment'), { code: 11000 });
      record = {
        ...data,
        _id: 'notification-1',
        attempts: 0,
        async save() {}
      };
      return record;
    },
    async findOneAndUpdate(_filter, update) {
      if (!record || record.status !== TASK_WHATSAPP_STATUSES.PENDING) return null;
      record.status = update.$set.status;
      record.processingStartedAt = update.$set.processingStartedAt;
      record.attempts += update.$inc.attempts;
      return record;
    },
    async findOne(query) {
      if (!record || (query.status && query.status !== record.status)) return null;
      return record;
    }
  };
  const task = {
    _id: 'task-1',
    title: 'Prepare report',
    priority: 'High',
    contactAssignmentId: 'assignment-1',
    project: { name: 'Finance' }
  };
  const contact = {
    _id: 'contact-1',
    fullName: 'Ahmed Khan',
    whatsappNumber: '+923179500901',
    toObject() { return { fullName: this.fullName }; }
  };
  const service = createTaskAssignmentNotificationService({
    notificationModel,
    contactModel: { findById: async () => contact },
    taskModel: {
      findById: () => ({ populate: async () => task }),
      updateOne: async () => { taskFlagUpdated = true; }
    },
    sendNotification: async () => {
      sendCount += 1;
      return shouldSend
        ? { success: true, messageId: 'provider-message-1' }
        : { success: false, reason: 'Baileys offline' };
    },
    serviceLogger: { error() {} }
  });
  const waitForStatus = async (status) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (record?.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail(`Notification did not reach ${status} status.`);
  };

  await service.enqueue(task, contact);
  await waitForStatus(TASK_WHATSAPP_STATUSES.FAILED);
  assert.equal(record.failureReason, 'Baileys offline');
  assert.equal(record.attempts, 1);

  shouldSend = true;
  await service.retry(task._id, record._id);
  await waitForStatus(TASK_WHATSAPP_STATUSES.SENT);
  assert.equal(record.providerMessageId, 'provider-message-1');
  assert.equal(record.attempts, 2);
  assert.equal(taskFlagUpdated, true);

  await service.enqueue(task, contact);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sendCount, 2);
});

test('authentication rejects contact API requests without a login token', async () => {
  let authError;
  await authenticate({
    cookies: {},
    headers: {},
    method: 'GET',
    originalUrl: '/api/contacts'
  }, {}, (error) => { authError = error; });
  assert.equal(authError.statusCode, 401);
});

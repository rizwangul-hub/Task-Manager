import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Contact, normalizeContactWhatsAppNumber } from '../src/models/contact.model.js';
import { Task } from '../src/models/task.model.js';
import { Project } from '../src/models/project.model.js';
import { TaskEvent } from '../src/models/taskEvent.model.js';
import {
  TaskWhatsAppNotification,
  TASK_WHATSAPP_STATUSES
} from '../src/models/taskWhatsAppNotification.model.js';
import { contactController } from '../src/controllers/contact.controller.js';
import { taskController } from '../src/controllers/task.controller.js';
import {
  createTaskAssignmentNotificationService,
  taskAssignmentNotificationService
} from '../src/services/taskAssignmentNotification.service.js';
import { authenticate } from '../src/middleware/auth.middleware.js';
import { socketService } from '../src/services/socket.service.js';

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
    serviceLogger: { info() {}, warn() {}, error() {} }
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

test('outbox automatically retries temporary Baileys disconnects and keeps the same assignment record', async () => {
  let record = null;
  let sendCount = 0;
  const task = {
    _id: 'task-retry',
    title: 'Prepare report',
    priority: 'High',
    contactAssignmentId: 'assignment-retry',
    project: { name: 'Finance' }
  };
  const contact = {
    _id: 'contact-retry',
    fullName: 'Ahmed Khan',
    whatsappNumber: '+923179500901',
    toObject() { return { fullName: this.fullName }; }
  };
  const notificationModel = {
    async create(data) {
      record = {
        ...data,
        _id: 'notification-retry',
        attempts: 0,
        automaticRetries: 0,
        nextAttemptAt: new Date(),
        async save() {}
      };
      return record;
    },
    async findOneAndUpdate(_filter, update) {
      if (record.status !== TASK_WHATSAPP_STATUSES.PENDING) return null;
      record.status = update.$set.status;
      record.processingStartedAt = update.$set.processingStartedAt;
      record.attempts += update.$inc.attempts;
      return record;
    },
    find() {
      return {
        select() { return this; },
        limit: async () => [{ _id: record._id }]
      };
    }
  };
  const service = createTaskAssignmentNotificationService({
    notificationModel,
    contactModel: { findById: async () => contact },
    taskModel: {
      findById: () => ({ populate: async () => task }),
      updateOne: async () => {}
    },
    sendNotification: async () => {
      sendCount += 1;
      return sendCount === 1
        ? { success: false, retryable: true, reason: 'Socket reconnecting' }
        : { success: true, messageId: 'message-after-reconnect' };
    },
    serviceLogger: { info() {}, warn() {}, error() {} }
  });
  const waitForStatus = async (status) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (record?.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail(`Notification did not reach ${status} status.`);
  };

  await service.enqueue(task, contact);
  await waitForStatus(TASK_WHATSAPP_STATUSES.PENDING);
  assert.equal(record.automaticRetries, 1);
  record.nextAttemptAt = new Date();
  await service.processPending();
  await waitForStatus(TASK_WHATSAPP_STATUSES.SENT);
  assert.equal(record.attempts, 2);
  assert.equal(record.providerMessageId, 'message-after-reconnect');
  assert.equal(sendCount, 2);
});

test('task creation persists the contact assignment before queuing WhatsApp', async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const contactId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const contact = {
    _id: contactId,
    fullName: 'Ahmed Khan',
    whatsappNumber: '+923179500901'
  };
  const project = {
    _id: projectId,
    projectKey: 'PRJ',
    members: [],
    async save() {}
  };
  const savedTask = {
    _id: taskId,
    taskKey: 'PRJ-1',
    title: 'Prepare report',
    assignees: [],
    project: { ...project, name: 'Finance', manager: ownerId, members: [ownerId] },
    creator: { _id: ownerId, name: 'Workspace owner' },
    assignedContact: contact,
    toJSON() { return this; },
    populate() { return this; }
  };
  const originals = {
    projectFindById: Project.findById,
    contactFindOne: Contact.findOne,
    taskCountDocuments: Task.countDocuments,
    taskCreate: Task.create,
    taskFindById: Task.findById,
    taskEventLogEvent: TaskEvent.logEvent,
    enqueue: taskAssignmentNotificationService.enqueue,
    getIO: socketService.getIO
  };
  let taskWasSaved = false;
  let queuedAfterSave = false;

  try {
    Project.findById = async () => project;
    Contact.findOne = async () => contact;
    Task.countDocuments = async () => 0;
    Task.create = async (data) => {
      taskWasSaved = true;
      assert.equal(data.assignedContact.toString(), contactId.toString());
      return { ...data, _id: taskId, taskKey: 'PRJ-1' };
    };
    Task.findById = () => savedTask;
    TaskEvent.logEvent = async () => {};
    socketService.getIO = () => null;
    taskAssignmentNotificationService.enqueue = async () => {
      queuedAfterSave = taskWasSaved;
      return null;
    };

    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; }
    };
    await taskController.createTask({
      body: { title: 'Prepare report', project: projectId.toString(), contactId: contactId.toString() },
      user: { _id: ownerId }
    }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 201);
    assert.equal(response.payload.data.task.assignedContact._id.toString(), contactId.toString());
    assert.equal(queuedAfterSave, true);
  } finally {
    Project.findById = originals.projectFindById;
    Contact.findOne = originals.contactFindOne;
    Task.countDocuments = originals.taskCountDocuments;
    Task.create = originals.taskCreate;
    Task.findById = originals.taskFindById;
    TaskEvent.logEvent = originals.taskEventLogEvent;
    taskAssignmentNotificationService.enqueue = originals.enqueue;
    socketService.getIO = originals.getIO;
  }
});

test('task creation failure does not enqueue a WhatsApp notification', async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const contactId = new mongoose.Types.ObjectId();
  const originals = {
    projectFindById: Project.findById,
    contactFindOne: Contact.findOne,
    taskCountDocuments: Task.countDocuments,
    taskCreate: Task.create,
    enqueue: taskAssignmentNotificationService.enqueue
  };
  let enqueueCount = 0;
  let requestError;

  try {
    Project.findById = async () => ({ _id: projectId, projectKey: 'PRJ', members: [], async save() {} });
    Contact.findOne = async () => ({ _id: contactId, fullName: 'Ahmed Khan', whatsappNumber: '+923179500901' });
    Task.countDocuments = async () => 0;
    Task.create = async () => { throw new Error('Task persistence failed.'); };
    taskAssignmentNotificationService.enqueue = async () => { enqueueCount += 1; };

    await taskController.createTask({
      body: { title: 'Prepare report', project: projectId.toString(), contactId: contactId.toString() },
      user: { _id: ownerId }
    }, {}, (error) => { requestError = error; });

    assert.match(requestError.message, /Task persistence failed/);
    assert.equal(enqueueCount, 0);
  } finally {
    Project.findById = originals.projectFindById;
    Contact.findOne = originals.contactFindOne;
    Task.countDocuments = originals.taskCountDocuments;
    Task.create = originals.taskCreate;
    taskAssignmentNotificationService.enqueue = originals.enqueue;
  }
});

test('replayed task creation keys return the existing task without creating a second task', async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const contactId = new mongoose.Types.ObjectId();
  const existingTask = {
    _id: taskId,
    assignedContact: { _id: contactId, fullName: 'Ahmed Khan', whatsappNumber: '+923179500901' },
    toJSON() { return this; },
    populate() { return this; }
  };
  const originals = {
    taskFindOne: Task.findOne,
    taskCreate: Task.create,
    getForTask: taskAssignmentNotificationService.getForTask,
    enqueue: taskAssignmentNotificationService.enqueue
  };
  let createCount = 0;
  let enqueueCount = 0;

  try {
    Task.findOne = () => existingTask;
    Task.create = async () => { createCount += 1; };
    taskAssignmentNotificationService.getForTask = async () => [];
    taskAssignmentNotificationService.enqueue = async () => { enqueueCount += 1; };

    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; }
    };
    await taskController.createTask({
      body: {
        title: 'Prepare report',
        project: new mongoose.Types.ObjectId().toString(),
        contactId: contactId.toString(),
        idempotencyKey: 'stable-request-id'
      },
      user: { _id: ownerId }
    }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.data.task._id.toString(), taskId.toString());
    assert.equal(createCount, 0);
    assert.equal(enqueueCount, 1);
  } finally {
    Task.findOne = originals.taskFindOne;
    Task.create = originals.taskCreate;
    taskAssignmentNotificationService.getForTask = originals.getForTask;
    taskAssignmentNotificationService.enqueue = originals.enqueue;
  }
});

test('task field edits do not notify again, but contact reassignment queues a new notification', async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const taskId = new mongoose.Types.ObjectId();
  const originalContactId = new mongoose.Types.ObjectId();
  const nextContactId = new mongoose.Types.ObjectId();
  const nextContact = {
    _id: nextContactId,
    fullName: 'New Assignee',
    whatsappNumber: '+447123456789'
  };
  const task = {
    _id: taskId,
    title: 'Original title',
    description: '',
    project: { _id: projectId },
    assignees: [],
    assignedContact: originalContactId,
    contactAssignmentId: new mongoose.Types.ObjectId(),
    contactAssignedAt: new Date(),
    status: 'To Do',
    priority: 'Medium',
    startDate: null,
    dueDate: null,
    customFields: [],
    async save() {},
    toJSON() { return this; }
  };
  const originals = {
    taskFindById: Task.findById,
    contactFindOne: Contact.findOne,
    logEvent: TaskEvent.logEvent,
    enqueue: taskAssignmentNotificationService.enqueue,
    emitTaskUpdate: socketService.emitTaskUpdate
  };
  let enqueueCount = 0;
  const makeQuery = (value) => ({
    populate() { return this; },
    then(resolve, reject) {
      return Promise.resolve(typeof value === 'function' ? value() : value).then(resolve, reject);
    }
  });

  try {
    Task.findById = () => makeQuery(task);
    Contact.findOne = async () => nextContact;
    TaskEvent.logEvent = async () => {};
    taskAssignmentNotificationService.enqueue = async () => { enqueueCount += 1; };
    socketService.emitTaskUpdate = () => {};
    const responseFor = () => ({
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; }
    });

    const unrelatedResponse = responseFor();
    Task.findById = (callCount => () => makeQuery(++callCount === 1
      ? task
      : {
          ...task,
          assignedContact: { _id: originalContactId, fullName: 'Original Contact' },
          toJSON() { return this; }
        }))(0);
    await taskController.updateTask({
      params: { id: taskId.toString() },
      body: { title: 'Updated title', priority: 'High' },
      user: { _id: ownerId, role: 'Admin' }
    }, unrelatedResponse, (error) => { throw error; });
    assert.equal(enqueueCount, 0);

    let findCall = 0;
    Task.findById = () => makeQuery(++findCall === 1
      ? task
      : {
          ...task,
          assignedContact: nextContact,
          toJSON() { return this; }
        });
    const reassignmentResponse = responseFor();
    await taskController.updateTask({
      params: { id: taskId.toString() },
      body: { contactId: nextContactId.toString() },
      user: { _id: ownerId, role: 'Admin' }
    }, reassignmentResponse, (error) => { throw error; });

    assert.equal(enqueueCount, 1);
    assert.equal(reassignmentResponse.statusCode, 200);
  } finally {
    Task.findById = originals.taskFindById;
    Contact.findOne = originals.contactFindOne;
    TaskEvent.logEvent = originals.logEvent;
    taskAssignmentNotificationService.enqueue = originals.enqueue;
    socketService.emitTaskUpdate = originals.emitTaskUpdate;
  }
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

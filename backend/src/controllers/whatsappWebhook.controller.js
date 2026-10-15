import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Project } from '../models/project.model.js';
import { Task, TASK_SOURCES, TASK_STATUSES } from '../models/task.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { Comment } from '../models/comment.model.js';
import { User } from '../models/user.model.js';
import { WhatsAppWebhookJob, WHATSAPP_JOB_STATUSES } from '../models/whatsappWebhookJob.model.js';
import { socketService } from '../services/socket.service.js';
import { whatsappMediaService } from '../services/whatsappMedia.service.js';
import { whatsappParserService } from '../services/whatsappParser.service.js';
import { whatsappPayloadAdapterService } from '../services/whatsappPayloadAdapter.service.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
  verifyTwilioWebhookSignature
} from '../utils/metaWhatsApp.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getPayload = (req) => {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  if (req.body && typeof req.body === 'object') return req.body;
  throw new Error('WhatsApp webhook body must contain valid JSON.');
};

const isMetaPayload = (payload) => payload?.object === 'whatsapp_business_account';

const isAuthorized = (req, payload, provider) => {
  if (provider === 'meta') {
    return Boolean(
      isMetaPayload(payload) &&
      env.WHATSAPP.appSecret &&
      verifyMetaWebhookSignature(req.body, req.get('x-hub-signature-256'), env.WHATSAPP.appSecret)
    );
  }
  if (provider === 'twilio' && env.WHATSAPP.twilioAuthToken) {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return verifyTwilioWebhookSignature(
      url,
      req.body,
      req.get('x-twilio-signature'),
      env.WHATSAPP.twilioAuthToken
    );
  }
  if (env.WHATSAPP.webhookSecret) {
    return verifyMetaWebhookToken(
      req.get('x-whatsapp-webhook-secret'),
      env.WHATSAPP.webhookSecret
    );
  }
  return false;
};

const getTargetProject = async (boardName) => {
  // 1. Try finding an unarchived project matching the parsed board name
  if (boardName) {
    const target = await Project.findOne({
      name: new RegExp(`^${escapeRegex(boardName)}$`, 'i'),
      isArchived: false
    });
    if (target) return target;
  }

  // 2. Try configured default project ID if valid
  if (mongoose.Types.ObjectId.isValid(env.WHATSAPP.defaultProjectId)) {
    const defaultProject = await Project.findOne({ _id: env.WHATSAPP.defaultProjectId, isArchived: false });
    if (defaultProject) return defaultProject;
  }

  // 3. Fallback: Query MongoDB for the first active default project
  const firstActiveProject = await Project.findOne({ isArchived: false }).sort({ createdAt: 1 });
  if (firstActiveProject) return firstActiveProject;

  // 4. Any project in the database
  const anyProject = await Project.findOne().sort({ createdAt: 1 });
  if (anyProject) return anyProject;

  // 5. If no project exists, create a default project automatically
  let adminUser = await User.findOne({ isActive: true, role: { $in: ['ADMIN', 'MANAGER'] } });
  if (!adminUser) adminUser = await User.findOne({ isActive: true });
  if (!adminUser) return null;

  return Project.create({
    name: 'General Tasks',
    projectKey: 'GEN',
    description: 'Default project for incoming WhatsApp tasks',
    manager: adminUser._id,
    members: [adminUser._id],
    createdBy: adminUser._id,
    isArchived: false
  });
};

const getTaskAssignees = async (text, project) => {
  const projectUserIds = [
    project.manager,
    ...(project.members || [])
  ].filter(Boolean).map((id) => id.toString());
  const mentionedNames = whatsappParserService.findMentionedNames(text);
  const matched = mentionedNames.length
    ? await User.find({
      _id: { $in: projectUserIds },
      isActive: true,
      $or: mentionedNames.map((name) => ({
        name: new RegExp(`^${escapeRegex(name)}(?:\\s|$)`, 'i')
      }))
    }).select('_id')
    : [];
  if (matched.length) return matched.map((user) => user._id);

  if (mongoose.Types.ObjectId.isValid(env.WHATSAPP.defaultAssigneeId) &&
      projectUserIds.includes(env.WHATSAPP.defaultAssigneeId)) {
    const defaultAssignee = await User.findOne({
      _id: env.WHATSAPP.defaultAssigneeId,
      isActive: true
    }).select('_id');
    if (defaultAssignee) return [defaultAssignee._id];
  }

  const manager = await User.findOne({ _id: project.manager, isActive: true }).select('_id');
  return manager ? [manager._id] : [];
};

const createTaskFromMessage = async (
  message,
  provider,
  { groupTitle = '', title = '', fallbackTitle = '' } = {}
) => {
  if (!message.id || !message.senderPhone) {
    logger.warn('Ignoring WhatsApp message without a message ID or sender.');
    return false;
  }

  const groupId = String(message.groupId || '');
  const targetGroupConfig = (process.env.PIXX_WHATSAPP_GROUP_ID || env.WHATSAPP.groupId || '').trim();
  const isAllowAll = !targetGroupConfig || targetGroupConfig.toLowerCase() === 'all';
  if (!isAllowAll && groupId && targetGroupConfig !== groupId) {
    const allowed = targetGroupConfig.split(',').map((g) => g.trim()).filter(Boolean);
    if (!allowed.includes(groupId)) return false;
  }

  const messageText = String(message.text || '').trim();
  const displayText = messageText || `WhatsApp media from ${message.senderName || message.senderPhone || 'Member'}`;
  const parsed = whatsappParserService.parseMessage(messageText);
  const existing = await Task.findOne({ whatsappMessageId: message.id }).select('_id');
  if (existing) return false;

  const project = await getTargetProject(parsed.boardName);
  if (!project) {
    throw new Error('No active project found and unable to initialize default project.');
  }

  let assignees = await getTaskAssignees(messageText, project);
  if (!assignees.length) {
    assignees = project.manager ? [project.manager] : [];
  }

  let creator = await User.findOne({ email: env.OWNER.email, isActive: true });
  if (!creator && project.manager) creator = await User.findOne({ _id: project.manager, isActive: true });
  if (!creator) creator = await User.findOne({ isActive: true });
  if (!creator) throw new Error('An active user account is required for WhatsApp intake.');

  let attachments = [];
  let mediaError = '';
  if (message.media?.length) {
    try {
      attachments = await whatsappMediaService.uploadMessageMedia(message.media, provider, creator._id);
    } catch (error) {
      mediaError = error.message || 'WhatsApp media could not be uploaded.';
      logger.error(`WhatsApp attachment upload failed for message ${message.id}:`, error);
    }
  }

  const id = new mongoose.Types.ObjectId();
  const descriptionParts = [
    messageText,
    `Received via WhatsApp from ${message.senderName ? `${message.senderName} ` : ''}${message.senderPhone}.`,
    mediaError ? `Attachment upload warning: ${mediaError}` : ''
  ].filter(Boolean);

  const finalTitle =
    title ||
    parsed.title ||
    fallbackTitle ||
    (messageText ? messageText.slice(0, 80) : '') ||
    `WhatsApp Media from ${message.senderName || message.senderPhone || 'Member'} - ${new Date().toLocaleTimeString()}`;

  let task;
  try {
    task = await Task.create({
      _id: id,
      title: finalTitle,
      description: descriptionParts.join('\n\n').slice(0, 5000),
      project: project._id,
      taskKey: `${project.projectKey || 'TASK'}-WA-${id.toString().slice(-8)}`,
      creator: creator._id,
      assignees,
      status: TASK_STATUSES.TO_DO,
      source: TASK_SOURCES.WHATSAPP,
      whatsappMessageId: message.id,
      whatsappSender: {
        phone: message.senderPhone,
        name: message.senderName,
        sentAt: message.timestamp && !Number.isNaN(new Date(message.timestamp).getTime())
          ? new Date(message.timestamp)
          : new Date()
      },
      groupName: parsed.groupName,
      groupTitle: groupTitle || parsed.groupTitle,
      previewImage: (() => {
        const image = attachments.find((attachment) => attachment.fileType?.startsWith('image/'));
        return image ? { publicId: image.publicId, url: image.url } : undefined;
      })(),
      attachments
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.whatsappMessageId) return false;
    throw error;
  }

  const firstImage = attachments.find((attachment) => attachment.fileType?.startsWith('image/'));
  if (firstImage) {
    try {
      const comment = await Comment.create({
        task: task._id,
        author: creator._id,
        content: messageText || `Image received from WhatsApp${message.senderName ? ` (${message.senderName})` : ''}.`,
        attachments: [{
          url: firstImage.url,
          fileName: firstImage.fileName,
          fileType: firstImage.fileType,
          publicId: firstImage.publicId
        }]
      });
      await TaskEvent.logEvent({
        task: task._id,
        project: project._id,
        user: creator._id,
        action: TASK_EVENT_ACTIONS.COMMENT_ADDED,
        details: { commentId: comment._id, source: TASK_SOURCES.WHATSAPP, snippet: comment.content.slice(0, 100) }
      });
    } catch (error) {
      logger.error(`Failed to add WhatsApp image update to task ${task._id}:`, error);
    }
  }

  await TaskEvent.logEvent({
    task: task._id,
    project: project._id,
    user: creator._id,
    action: TASK_EVENT_ACTIONS.TASK_CREATED,
    details: {
      title: task.title,
      taskKey: task.taskKey,
      source: TASK_SOURCES.WHATSAPP,
      senderPhone: message.senderPhone,
      senderName: message.senderName,
      groupId,
      groupName: parsed.groupName,
      mediaCount: attachments.length,
      mediaError: mediaError || undefined
    }
  });

  const populatedTask = await Task.findById(task._id)
    .populate('project', 'name title projectKey status manager members')
    .populate('assignees', 'name email avatar role')
    .populate('creator', 'name email avatar');

  const getReferenceId = (reference) => reference?._id?.toString() || reference?.toString();
  const authorizedUserIds = new Set([
    getReferenceId(populatedTask.creator),
    ...(populatedTask.assignees || []).map(getReferenceId),
    getReferenceId(populatedTask.project?.manager),
    ...(populatedTask.project?.members || []).map(getReferenceId)
  ].filter(Boolean));
  const taskPayload = populatedTask.toJSON();
  if (taskPayload.project && !taskPayload.project.title) {
    taskPayload.project.title = taskPayload.project.name;
  }
  if (!taskPayload.assignee && taskPayload.assignees?.length) {
    taskPayload.assignee = taskPayload.assignees[0];
  }

  const io = socketService.getIO();
  if (io) {
    // Broadcast globally so all active boards receive it regardless of room
    io.emit('task:created', taskPayload);
    io.emit('task:new', taskPayload);
    console.log('📢 [SOCKET_EMIT] Broadcasted task to frontend:', populatedTask.title);
  } else {
    logger.warn(`[SOCKET_EMIT] Unable to emit task:created for task "${populatedTask.title}": Socket.IO is not initialized.`);
  }

  return true;
};

export const ingestWhatsAppMessage = (message, provider = 'baileys', options = {}) =>
  createTaskFromMessage(message, provider, options);

export const processWhatsAppQueue = async () => {
  const staleLock = new Date(Date.now() - 5 * 60 * 1000);
  let processed = 0;

  await WhatsAppWebhookJob.updateMany(
    {
      status: WHATSAPP_JOB_STATUSES.PROCESSING,
      attempts: { $gte: 5 },
      lockedAt: { $lt: staleLock }
    },
    {
      $set: {
        status: WHATSAPP_JOB_STATUSES.FAILED,
        lockedAt: null,
        lastError: 'Worker lease expired after the maximum number of attempts.'
      }
    }
  );

  while (true) {
    const now = new Date();
    const job = await WhatsAppWebhookJob.findOneAndUpdate(
      {
        attempts: { $lt: 5 },
        nextAttemptAt: { $lte: now },
        $or: [
          { status: { $in: [WHATSAPP_JOB_STATUSES.PENDING, WHATSAPP_JOB_STATUSES.FAILED] } },
          { status: WHATSAPP_JOB_STATUSES.PROCESSING, lockedAt: { $lt: staleLock } }
        ]
      },
      {
        $set: { status: WHATSAPP_JOB_STATUSES.PROCESSING, lockedAt: now },
        $inc: { attempts: 1 }
      },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!job) break;

    try {
      await createTaskFromMessage(job.message, job.provider);
      job.status = WHATSAPP_JOB_STATUSES.PROCESSED;
      job.lastError = '';
      job.lockedAt = null;
      await job.save();
      processed += 1;
    } catch (error) {
      logger.error(`Failed to process WhatsApp message ${job.messageId}:`, error);
      job.status = WHATSAPP_JOB_STATUSES.FAILED;
      job.lastError = error.message || 'WhatsApp task processing failed.';
      job.lockedAt = null;
      job.nextAttemptAt = new Date(Date.now() + Math.min(2 ** job.attempts, 30) * 60 * 1000);
      await job.save();
    }
  }
  return { processed };
};

export const whatsappWebhookController = {
  verify: (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (!env.WHATSAPP.verifyToken) {
      return res.status(503).send('WhatsApp webhook verification is not configured.');
    }
    if (mode === 'subscribe' && verifyMetaWebhookToken(token, env.WHATSAPP.verifyToken) && challenge) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.sendStatus(403);
  },

  receive: async (req, res, next) => {
    let payload;
    let normalized;
    try {
      payload = getPayload(req);
      normalized = whatsappPayloadAdapterService.normalize(payload, env.WHATSAPP.provider);
    } catch (error) {
      return next(new AppError(error.message || 'Unsupported WhatsApp webhook payload.', 400));
    }

    if (!isAuthorized(req, payload, normalized.provider)) {
      return next(new AppError('Invalid or missing WhatsApp webhook signature.', 401));
    }
    if (normalized.messages.length === 0) {
      return res.status(200).json({
        status: 'accepted',
        data: { received: 0, queued: 0 }
      });
    }
    if (!env.WHATSAPP.groupId) {
      return next(new AppError('WHATSAPP_GROUP_ID must be configured before enabling WhatsApp intake.', 503));
    }

    const acceptedMessages = normalized.messages.filter((message) =>
      String(message.groupId || '') === env.WHATSAPP.groupId
    );
    try {
      await Promise.all(acceptedMessages.map((message) =>
        WhatsAppWebhookJob.updateOne(
          { provider: normalized.provider, messageId: message.id },
          {
            $setOnInsert: {
              provider: normalized.provider,
              messageId: message.id,
              message,
              status: WHATSAPP_JOB_STATUSES.PENDING,
              nextAttemptAt: new Date()
            }
          },
          { upsert: true }
        ).catch((error) => {
          if (error.code !== 11000) throw error;
        })
      ));
    } catch (error) {
      return next(error);
    }

    res.status(200).json({
      status: 'accepted',
      data: { received: normalized.messages.length, queued: acceptedMessages.length }
    });

    if (acceptedMessages.length) {
      setImmediate(() => {
        void processWhatsAppQueue().catch((error) => {
          logger.error('Unexpected WhatsApp intake queue failure:', error);
        });
      });
    }
  }
};

export default whatsappWebhookController;

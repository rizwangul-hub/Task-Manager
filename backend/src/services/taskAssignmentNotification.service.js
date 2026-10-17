import mongoose from 'mongoose';
import { Contact } from '../models/contact.model.js';
import { Task } from '../models/task.model.js';
import {
  TaskWhatsAppNotification,
  TASK_WHATSAPP_STATUSES
} from '../models/taskWhatsAppNotification.model.js';
import { sendWhatsAppTaskNotification } from './whatsappService.js';
import { logger } from '../utils/logger.js';

const MAX_AUTOMATIC_RETRIES = 5;

const buildAssignmentMessage = (task, contact) => [
  `Hello ${contact.fullName},`,
  '',
  'You have been assigned a new task.',
  '',
  `Task: ${task.title}`,
  `Project: ${task.project?.name || 'Project'}`,
  `Priority: ${task.priority}`,
  `Due Date: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) : 'No deadline'}`,
  task.description ? `\nDescription: ${task.description}` : '',
  '',
  'Please review the task details and contact the task manager if you have any questions.',
  '',
  'Thank you.'
].filter(Boolean).join('\n');

export const createTaskAssignmentNotificationService = ({
  notificationModel = TaskWhatsAppNotification,
  contactModel = Contact,
  taskModel = Task,
  sendNotification = sendWhatsAppTaskNotification,
  serviceLogger = logger
} = {}) => {
  const deliver = async (notificationId) => {
    const staleProcessingAt = new Date(Date.now() - 5 * 60 * 1000);
    const notification = await notificationModel.findOneAndUpdate(
      {
        _id: notificationId,
        $or: [
          {
            status: TASK_WHATSAPP_STATUSES.PENDING,
            nextAttemptAt: { $lte: new Date() }
          },
          { status: TASK_WHATSAPP_STATUSES.PROCESSING, processingStartedAt: { $lt: staleProcessingAt } }
        ]
      },
      {
        $set: {
          status: TASK_WHATSAPP_STATUSES.PROCESSING,
          processingStartedAt: new Date()
        },
        $inc: { attempts: 1 }
      },
      { new: true }
    );
    if (!notification) return;

    try {
      const [task, contact] = await Promise.all([
        taskModel.findById(notification.task).populate('project', 'name'),
        contactModel.findById(notification.contact)
      ]);
      if (!task) throw new Error('Assigned task no longer exists.');
      if (!contact) throw new Error('Assigned contact no longer exists.');

      const result = await sendNotification(
        notification.recipientNumber,
        buildAssignmentMessage(task, { ...contact.toObject(), fullName: notification.contactName }),
        { taskTitle: task.title }
      );

      if (!result.success) {
        const canRetry = result.retryable && notification.automaticRetries < MAX_AUTOMATIC_RETRIES;
        notification.status = canRetry ? TASK_WHATSAPP_STATUSES.PENDING : TASK_WHATSAPP_STATUSES.FAILED;
        notification.failureReason = result.reason || result.error || 'WhatsApp provider rejected the send request.';
        notification.processingStartedAt = null;
        if (canRetry) {
          notification.automaticRetries += 1;
          notification.nextAttemptAt = new Date(Date.now() + Math.min(30 * 1000 * (2 ** (notification.automaticRetries - 1)), 15 * 60 * 1000));
          serviceLogger.warn(`[WA_OUTBOX] Notification ${notification._id} will retry automatically.`);
        } else {
          serviceLogger.error(`[WA_OUTBOX] Notification ${notification._id} failed permanently: ${notification.failureReason}`);
        }
        await notification.save();
        return;
      }

      notification.status = TASK_WHATSAPP_STATUSES.SENT;
      notification.sentAt = new Date();
      notification.providerMessageId = result.messageId || null;
      notification.failureReason = null;
      notification.processingStartedAt = null;
      notification.nextAttemptAt = null;
      await notification.save();
      await taskModel.updateOne(
        { _id: task._id, contactAssignmentId: notification.assignmentId },
        { $set: { whatsappNotificationSent: true } }
      );
    } catch (error) {
      notification.status = TASK_WHATSAPP_STATUSES.FAILED;
      notification.failureReason = error.message;
      notification.processingStartedAt = null;
      notification.nextAttemptAt = null;
      await notification.save();
      serviceLogger.error(`[WA_OUTBOX] Assignment notification ${notification._id} failed: ${error.message}`);
    }
  };

  return {
    enqueue: async (task, contact) => {
      if (!task?.contactAssignmentId || !contact?.whatsappNumber) return null;
      try {
        serviceLogger.info(`[WA_OUTBOX] Queued assignment notification for task ${task._id}.`);
        const notification = await notificationModel.create({
          task: task._id,
          contact: contact._id,
          contactName: contact.fullName,
          recipientNumber: contact.whatsappNumber,
          assignmentId: task.contactAssignmentId,
          status: TASK_WHATSAPP_STATUSES.PENDING
        });
        void deliver(notification._id).catch((error) => {
          serviceLogger.error(`[WA_OUTBOX] Notification dispatch failed: ${error.message}`);
        });
        return notification;
      } catch (error) {
        if (error.code === 11000) {
          return notificationModel.findOne({
            task: task._id,
            assignmentId: task.contactAssignmentId
          });
        }
        serviceLogger.error(`[WA_OUTBOX] Could not queue task assignment notification: ${error.message}`);
        return null;
      }
    },

    processPending: async () => {
      if (notificationModel === TaskWhatsAppNotification && mongoose.connection?.readyState !== 1) {
        return 0;
      }
      try {
        const staleProcessingAt = new Date(Date.now() - 5 * 60 * 1000);
        const pending = await notificationModel.find({
          $or: [
            { status: TASK_WHATSAPP_STATUSES.PENDING, nextAttemptAt: { $lte: new Date() } },
            { status: TASK_WHATSAPP_STATUSES.PROCESSING, processingStartedAt: { $lt: staleProcessingAt } }
          ]
        }).select('_id').limit(25);
        await Promise.all(pending.map(({ _id }) => deliver(_id)));
        return pending.length;
      } catch (err) {
        logger.error('[WA_OUTBOX] Error processing pending notifications:', err.message);
        return 0;
      }
    },

    retry: async (taskId, notificationId) => {
      const notification = await notificationModel.findOne({
        _id: notificationId,
        task: taskId,
        status: TASK_WHATSAPP_STATUSES.FAILED
      });
      if (!notification) return null;
      notification.status = TASK_WHATSAPP_STATUSES.PENDING;
      notification.failureReason = null;
      notification.processingStartedAt = null;
      notification.automaticRetries = 0;
      notification.nextAttemptAt = new Date();
      await notification.save();
      void deliver(notification._id).catch((error) => {
        serviceLogger.error(`[WA_OUTBOX] Retry dispatch failed: ${error.message}`);
      });
      return notification;
    },

    getForTask: async (taskId) => {
      if (!mongoose.isValidObjectId(taskId)) return [];
      return notificationModel.find({ task: taskId })
        .populate('contact', 'fullName whatsappNumber email isActive')
        .sort({ createdAt: -1 })
        .limit(100);
    },

    buildAssignmentMessage
  };
};

export const taskAssignmentNotificationService = createTaskAssignmentNotificationService();

export default taskAssignmentNotificationService;

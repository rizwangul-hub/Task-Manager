import cron from 'node-cron';
import { Task, TASK_STATUSES } from '../models/task.model.js';
import { NotificationOutbox, OUTBOX_STATUSES } from '../models/notificationOutbox.model.js';
import { Notification, NOTIFICATION_TYPES, EMAIL_DELIVERY_STATUSES } from '../models/notification.model.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { processWhatsAppQueue } from '../controllers/whatsappWebhook.controller.js';

let cronTask = null;
let whatsappQueueTimer = null;

export async function checkDeadlinesAndOverdue() {
  const now = new Date();
  const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || env.EMAIL.emailUser;
  let sentCount = 0;

  for (const [alertType, query, isOverdue] of [
    [
      'deadlineAlertSent',
      {
        dueDate: { $gte: now, $lte: next24Hours },
        deadlineAlertSent: { $ne: true }
      },
      false
    ],
    [
      'overdueAlertSent',
      {
        dueDate: { $lt: now },
        overdueAlertSent: { $ne: true }
      },
      true
    ]
  ]) {
    const tasks = await Task.find({
      ...query,
      isArchived: false,
      status: { $nin: [TASK_STATUSES.DONE, 'Completed'] }
    })
      .populate('assignees', 'name email')
      .populate('project', 'name')
      .limit(500);

    for (const task of tasks) {
      const recipients = [...new Set(
        (task.assignees || []).map((assignee) => assignee.email?.trim()).filter(Boolean)
      )];
      if (!recipients.length && adminEmail) recipients.push(adminEmail.trim());
      if (!recipients.length) {
        logger.warn(`[SCHEDULER] No email recipient available for ${alertType} task ${task.taskKey}.`);
        continue;
      }

      const emailTemplate = emailService.templates.dueReminder({
        taskTitle: task.title,
        taskKey: task.taskKey,
        projectName: task.project?.name || 'Project',
        dueDate: new Date(task.dueDate).toLocaleDateString(),
        isOverdue,
        actionUrl: `${env.FRONTEND_URL}/tasks`
      });
      let allEmailsSent = true;

      for (const recipient of recipients) {
        try {
          const result = await emailService.sendEmail({
            to: recipient,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
          });
          if (result.success) {
            sentCount++;
          } else {
            allEmailsSent = false;
            logger.warn(`[SCHEDULER] ${alertType} email was not sent for task ${task.taskKey}: ${result.reason || 'unknown reason'}.`);
          }
        } catch (error) {
          allEmailsSent = false;
          logger.error(`[SCHEDULER] ${alertType} email failed for task ${task.taskKey} to ${recipient}: ${error.message}`);
        }
      }

      if (allEmailsSent) {
        task[alertType] = true;
        await task.save();
      }
    }
  }

  return { sentCount };
}

export const schedulerService = {
  /**
   * Run one pass of upcoming due date reminders and overdue alerts
   */
  runDueRemindersCheck: async () => {
    logger.info('[SCHEDULER] Checking for upcoming deadlines and overdue tasks...');
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const dueSoonWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let processedCount = 0;

    try {
      const emailAlerts = await checkDeadlinesAndOverdue();

      // 1. Process Overdue Tasks: dueDate < now, status != Done, isArchived != true
      const overdueTasks = await Task.find({
        isArchived: false,
        status: { $ne: TASK_STATUSES.DONE },
        dueDate: { $ne: null, $lt: now }
      })
        .populate('project', 'name')
        .limit(100);

      for (const task of overdueTasks) {
        if (!task.assignees || task.assignees.length === 0) continue;

        for (const assignee of task.assignees) {
          const recipientId = assignee._id ? assignee._id.toString() : assignee.toString();
          const dedupKey = `overdue-${task._id}-${recipientId}-${todayStr}`;

          const emailTemplate = emailService.templates.dueReminder({
            taskTitle: task.title,
            taskKey: task.taskKey,
            projectName: task.project?.name || 'Project',
            dueDate: new Date(task.dueDate).toLocaleDateString(),
            isOverdue: true,
            actionUrl: `${env.FRONTEND_URL}/tasks`
          });

          await notificationService.dispatch({
            recipientId,
            type: NOTIFICATION_TYPES.TASK_OVERDUE,
            title: `OVERDUE: Task ${task.taskKey}`,
            message: `Deliverable "${task.title}" is overdue (due: ${new Date(task.dueDate).toLocaleDateString()}).`,
            taskId: task._id,
            projectId: task.project?._id || task.project,
            dedupKey,
            emailTemplate,
            channel: 'IN_APP'
          });
          processedCount++;
        }
      }

      // 2. Process one-time 24-hour warnings for tasks not previously reminded.
      const upcomingTasks = await Task.find({
        isArchived: false,
        reminderSent: false,
        status: { $ne: TASK_STATUSES.DONE },
        dueDate: { $gte: now, $lte: dueSoonWindow }
      })
        .populate('project', 'name projectKey')
        .limit(500);

      for (const task of upcomingTasks) {
        if (!task.assignees || task.assignees.length === 0) continue;

        for (const assignee of task.assignees) {
          const recipientId = assignee._id ? assignee._id.toString() : assignee.toString();
          const dedupKey = `deadline-near-${task._id}-${recipientId}`;

          const emailTemplate = emailService.templates.dueReminder({
            taskTitle: task.title,
            taskKey: task.taskKey,
            projectName: task.project?.name || 'Project',
            dueDate: new Date(task.dueDate).toLocaleDateString(),
            isOverdue: false,
            actionUrl: `${env.FRONTEND_URL}/tasks`
          });

          await notificationService.dispatch({
            recipientId,
            type: NOTIFICATION_TYPES.DEADLINE_NEAR,
            title: `Reminder: Task ${task.taskKey} due soon`,
            message: `Deliverable "${task.title}" is due within 24 hours (${new Date(task.dueDate).toLocaleString()}).`,
            taskId: task._id,
            projectId: task.project?._id || task.project,
            dedupKey,
            emailTemplate,
            channel: 'IN_APP'
          });
          processedCount++;
        }

        await Task.updateOne(
          { _id: task._id, reminderSent: false },
          { $set: { reminderSent: true } }
        );
      }

      logger.info(`[SCHEDULER] Deadline check completed. Dispatched ${processedCount} in-app alerts and sent ${emailAlerts.sentCount} email alert(s).`);
      return { success: true, processedCount, emailAlertsSent: emailAlerts.sentCount };
    } catch (error) {
      logger.error('[SCHEDULER_ERROR] Failed during due reminders check:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Process pending outbox retries for failed email notifications
   */
  processOutboxRetries: async () => {
    if (!emailService.isConfigured()) return { processed: 0 };

    try {
      const now = new Date();
      const suppressedWhatsAppJobs = await NotificationOutbox.updateMany(
        {
          notificationType: NOTIFICATION_TYPES.WHATSAPP_TASK_CREATED,
          channel: 'email',
          status: { $in: [OUTBOX_STATUSES.PENDING, OUTBOX_STATUSES.FAILED] }
        },
        {
          $set: {
            status: OUTBOX_STATUSES.FAILED,
            attempts: 3,
            lastError: 'WhatsApp task-creation email notifications are disabled.'
          }
        }
      );
      if (suppressedWhatsAppJobs.modifiedCount) {
        logger.info(`[SCHEDULER] Suppressed ${suppressedWhatsAppJobs.modifiedCount} queued WhatsApp task-creation email(s).`);
      }

      const failedJobs = await NotificationOutbox.find({
        status: { $in: [OUTBOX_STATUSES.PENDING, OUTBOX_STATUSES.FAILED] },
        channel: 'email',
        attempts: { $lt: 3 },
        nextRetryAt: { $lte: now }
      }).limit(20);

      let processed = 0;

      for (const job of failedJobs) {
        job.attempts += 1;
        try {
          const result = await emailService.sendEmail({
            to: job.recipientEmail,
            subject: job.subject,
            html: job.htmlContent,
            text: job.textContent
          });

          if (result.success) {
            job.status = OUTBOX_STATUSES.SENT;
            job.lastError = null;
            if (job.notification) {
              await Notification.updateOne(
                { _id: job.notification },
                { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.SENT } }
              );
            }
          } else {
            job.status = OUTBOX_STATUSES.FAILED;
            job.lastError = 'SMTP is not configured';
            job.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000);
            if (job.notification) {
              await Notification.updateOne(
                { _id: job.notification },
                { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.FAILED } }
              );
            }
          }
        } catch (err) {
          job.status = OUTBOX_STATUSES.FAILED;
          job.lastError = err.message || 'Retry delivery failed';
          job.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000);
          if (job.notification) {
            await Notification.updateOne(
              { _id: job.notification },
              { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.FAILED } }
            );
          }
        }
        await job.save();
        processed++;
      }

      return { processed };
    } catch (err) {
      logger.error('[SCHEDULER_ERROR] Outbox retry failure:', err);
      return { processed: 0, error: err.message };
    }
  },

  /**
   * Start recurring background worker
   */
  startScheduler: () => {
    if (!whatsappQueueTimer) {
      const runWhatsAppQueue = () => {
        void processWhatsAppQueue().catch((error) => {
          logger.error('[WHATSAPP_QUEUE] Intake queue processing failed:', error);
        });
      };
      runWhatsAppQueue();
      whatsappQueueTimer = setInterval(runWhatsAppQueue, 30 * 1000);
      whatsappQueueTimer.unref?.();
      logger.info('[WHATSAPP_QUEUE] Persistent intake worker started.');
    }

    if (!env.SCHEDULER.enabled) {
      logger.info('[SCHEDULER] Background worker disabled via ENABLE_SCHEDULER=false.');
      return;
    }

    if (cronTask) {
      logger.warn('[SCHEDULER] Background scheduler is already running. Skipping redundant start.');
      return;
    }

    const cronExpr = env.SCHEDULER.cronExpr || '0 * * * *';
    logger.info(`[SCHEDULER] Starting background scheduler with schedule: "${cronExpr}"`);

    cronTask = cron.schedule(
      cronExpr,
      async () => {
        await schedulerService.runDueRemindersCheck();
        await schedulerService.processOutboxRetries();
      },
      {
        timezone: env.SCHEDULER.timezone || 'UTC'
      }
    );
  },

  /**
   * Check if background worker is currently active
   */
  isRunning: () => Boolean(cronTask),

  /**
   * Stop background scheduler
   */
  stopScheduler: () => {
    if (whatsappQueueTimer) {
      clearInterval(whatsappQueueTimer);
      whatsappQueueTimer = null;
    }
    if (cronTask) {
      cronTask.stop();
      cronTask = null;
      logger.info('[SCHEDULER] Background scheduler stopped.');
    }
  }
};

export default schedulerService;

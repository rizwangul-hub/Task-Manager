import {
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  EMAIL_DELIVERY_STATUSES
} from '../models/notification.model.js';
import { NotificationOutbox, OUTBOX_STATUSES } from '../models/notificationOutbox.model.js';
import { User } from '../models/user.model.js';
import {
  emailService,
  resolveEmailRecipient,
  sendTaskNotificationEmail
} from './email.service.js';
import { socketService } from './socket.service.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { TASK_STATUSES } from '../models/task.model.js';

/**
 * Check if recipient's preferences allow this notification type
 */
const isNotificationAllowedByPreferences = (user, type, channel = 'in_app') => {
  const prefs = user.notificationPreferences || {};

  if (channel === 'email' && prefs.emailNotifications === false) {
    return false;
  }

  switch (type) {
    case NOTIFICATION_TYPES.TASK_ASSIGNED:
    case NOTIFICATION_TYPES.TASK_UNASSIGNED:
      return prefs.taskAssigned !== false;
    case NOTIFICATION_TYPES.TASK_STATUS_CHANGED:
      return prefs.taskStatusChanged !== false;
    case NOTIFICATION_TYPES.TASK_DUE_DATE_CHANGED:
      return prefs.taskDueDate !== false;
    case NOTIFICATION_TYPES.TASK_COMMENT_ADDED:
      return prefs.taskComments !== false;
    case NOTIFICATION_TYPES.TASK_OVERDUE:
    case NOTIFICATION_TYPES.TASK_UPCOMING_DUE:
    case NOTIFICATION_TYPES.DEADLINE_NEAR:
      return prefs.overdueReminders !== false;
    case NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED:
    case NOTIFICATION_TYPES.PROJECT_MEMBER_REMOVED:
    case NOTIFICATION_TYPES.SYSTEM_NOTICE:
    default:
      return true; // Essential notices are allowed
  }
};

const deliverEmail = (outboxEntry, notificationId) => {
  setImmediate(() => {
    void (async () => {
      try {
        const result = await emailService.sendEmail({
          to: outboxEntry.recipientEmail,
          subject: outboxEntry.subject,
          html: outboxEntry.htmlContent,
          text: outboxEntry.textContent
        });

        if (result.success) {
          outboxEntry.status = OUTBOX_STATUSES.SENT;
          outboxEntry.lastError = null;
          outboxEntry.attempts += 1;
          await outboxEntry.save();
          if (notificationId) {
            await Notification.updateOne(
              { _id: notificationId },
              { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.SENT } }
            );
          }
          return;
        }

        outboxEntry.status = OUTBOX_STATUSES.FAILED;
        outboxEntry.lastError = 'SMTP is not configured';
        outboxEntry.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);
        outboxEntry.attempts += 1;
        await outboxEntry.save();
        if (notificationId) {
          await Notification.updateOne(
            { _id: notificationId },
            { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.FAILED } }
          );
        }
      } catch (error) {
        logger.error('Asynchronous email notification delivery failed:', error);
        try {
          outboxEntry.status = OUTBOX_STATUSES.FAILED;
          outboxEntry.lastError = error.message || 'SMTP delivery failure';
          outboxEntry.nextRetryAt = new Date(Date.now() + 5 * 60 * 1000);
          outboxEntry.attempts += 1;
          await outboxEntry.save();
          if (notificationId) {
            await Notification.updateOne(
              { _id: notificationId },
              { $set: { emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.FAILED } }
            );
          }
        } catch (persistenceError) {
          logger.error('Failed to persist asynchronous email delivery failure:', persistenceError);
        }
      }
    })().catch((error) => {
      logger.error('Unhandled asynchronous email delivery error:', error);
    });
  });
};

export const notificationService = {
  /**
   * Persist a notification, emit in-app events, and queue email without awaiting SMTP.
   */
  createAndSendNotification: async ({
    recipientId,
    type,
    title,
    message,
    taskId = null,
    projectId = null,
    dedupKey = null,
    metadata = {},
    emailTemplate = null,
    channel = NOTIFICATION_CHANNELS.BOTH
  }) => {
    if (!recipientId) return null;

    try {
      const recipient = await User.findById(recipientId);
      if (!recipient || !recipient.isActive) {
        return null; // Skip non-existent or deactivated users
      }

      const requestedChannel = Object.values(NOTIFICATION_CHANNELS).includes(channel)
        ? channel
        : NOTIFICATION_CHANNELS.BOTH;
      const wantsInApp = requestedChannel !== NOTIFICATION_CHANNELS.EMAIL;
      const wantsEmail = requestedChannel !== NOTIFICATION_CHANNELS.IN_APP;
      const allowInApp = wantsInApp && isNotificationAllowedByPreferences(recipient, type, 'in_app');
      const shouldSendEmail =
        wantsEmail &&
        isNotificationAllowedByPreferences(recipient, type, 'email') &&
        Boolean(recipient.email && emailTemplate);

      if (!allowInApp && !shouldSendEmail) return null;

      if (dedupKey) {
        const existing = await Notification.findOne({
          recipient: recipient._id,
          dedupKey
        });
        if (existing) {
          logger.info(`Notification duplicate suppressed: ${dedupKey}`);
          return existing;
        }
      }

      let createdNotification;
      try {
        createdNotification = await Notification.create({
          recipient: recipient._id,
          type,
          title,
          message,
          task: taskId,
          project: projectId,
          channel: allowInApp && shouldSendEmail
            ? NOTIFICATION_CHANNELS.BOTH
            : allowInApp
              ? NOTIFICATION_CHANNELS.IN_APP
              : NOTIFICATION_CHANNELS.EMAIL,
          emailDeliveryStatus: EMAIL_DELIVERY_STATUSES.PENDING,
          dedupKey,
          metadata
        });
      } catch (error) {
        if (error.code === 11000 && dedupKey) {
          logger.info(`Notification race condition duplicate caught: ${dedupKey}`);
          return Notification.findOne({ recipient: recipient._id, dedupKey });
        }
        throw error;
      }

      if (allowInApp) {
        socketService.emitNotification(recipient._id.toString(), createdNotification.toJSON());
      }

      if (shouldSendEmail) {
        try {
          const outboxEntry = await NotificationOutbox.create({
            recipient: recipient._id,
            notification: createdNotification._id,
            recipientEmail: resolveEmailRecipient(recipient.email),
            recipientName: recipient.name,
            notificationType: type,
            channel: 'email',
            subject: emailTemplate.subject,
            htmlContent: emailTemplate.html,
            textContent: emailTemplate.text,
            inAppPayload: { title, message, taskId, projectId },
            status: OUTBOX_STATUSES.PENDING,
            dedupKey: dedupKey ? `outbox-${dedupKey}` : null
          });
          deliverEmail(outboxEntry, createdNotification._id);
        } catch (error) {
          logger.error('Failed to stage notification email:', error);
          createdNotification.emailDeliveryStatus = EMAIL_DELIVERY_STATUSES.FAILED;
          await createdNotification.save();
        }
      }

      return createdNotification;
    } catch (error) {
      logger.error('[NOTIFICATION_SERVICE_ERROR] Error dispatching notification:', error);
      return null;
    }
  },

  dispatch: async (options) => notificationService.createAndSendNotification(options),

  /**
   * Trigger: Task Assigned / Reassigned
   */
  notifyTaskAssigned: async (task, assigner, newAssigneeIds = []) => {
    if (!task || !newAssigneeIds.length) return;

    const actionUrl = `${env.FRONTEND_URL}/tasks`;
    const projectName = task.project?.name || 'Project';
    const recipientsToNotify = newAssigneeIds.filter(
      (assigneeId) => assigneeId.toString() !== assigner?._id?.toString()
    );
    const recipientIdsWithEmail = recipientsToNotify.filter((assigneeId) =>
      (task.assignees || []).some((assignee) =>
        (assignee._id || assignee).toString() === assigneeId.toString() &&
        Boolean(assignee.email)
      )
    );

    for (const assigneeId of recipientsToNotify) {

      const dedupKey = `assign-${task._id}-${assigneeId}-${Date.now()}`;
      const emailTemplate = emailService.templates.taskAssigned({
        taskTitle: task.title,
        taskKey: task.taskKey,
        projectName,
        groupName: task.groupTitle || task.groupName || '',
        assignerName: assigner?.name || 'A team manager',
        dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None',
        priority: task.priority,
        actionUrl
      });

      await notificationService.dispatch({
        recipientId: assigneeId,
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: `Assigned to task: ${task.taskKey}`,
        message: `${assigner?.name || 'Manager'} assigned you to "${task.title}" in ${projectName}.`,
        taskId: task._id,
        projectId: task.project?._id || task.project,
        dedupKey,
        metadata: { assignerId: assigner?._id },
        emailTemplate
      });
    }

    if (!recipientIdsWithEmail.length && env.EMAIL.emailUser) {
      const emailTemplate = emailService.templates.taskAssigned({
        taskTitle: task.title,
        taskKey: task.taskKey,
        projectName,
        groupName: task.groupTitle || task.groupName || '',
        assignerName: assigner?.name || 'A team manager',
        dueDate: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'None',
        priority: task.priority,
        actionUrl
      });
      void sendTaskNotificationEmail({
        to: env.EMAIL.emailUser,
        subject: emailTemplate.subject,
        htmlContent: emailTemplate.html
      }).catch((error) => {
        logger.error(`[EMAIL_FAILED] Task notification fallback email failed: ${error.message}`);
      });
    }
  },

  /**
   * Trigger: User Unassigned from Task
   */
  notifyTaskUnassigned: async (task, assigner, removedAssigneeIds = []) => {
    if (!task || !removedAssigneeIds.length) return;

    for (const removedId of removedAssigneeIds) {
      if (removedId.toString() === assigner?._id?.toString()) continue;

      const dedupKey = `unassign-${task._id}-${removedId}-${Date.now()}`;
      await notificationService.dispatch({
        recipientId: removedId,
        type: NOTIFICATION_TYPES.TASK_UNASSIGNED,
        title: `Removed from task: ${task.taskKey}`,
        message: `You were unassigned from "${task.title}".`,
        taskId: task._id,
        projectId: task.project?._id || task.project,
        dedupKey
      });
    }
  },

  /**
   * Trigger: Task Status Changed (Completed, In Review, Reopened)
   */
  notifyTaskStatusChanged: async (task, actor, previousStatus, newStatus) => {
    if (!task || previousStatus === newStatus) return;

    const recipients = new Set();

    // Include task creator if not actor
    if (task.creator && task.creator.toString() !== actor?._id?.toString()) {
      recipients.add(task.creator.toString());
    }

    if (
      [TASK_STATUSES.DONE, TASK_STATUSES.IN_REVIEW].includes(newStatus) &&
      task.project?.manager &&
      task.project.manager.toString() !== actor?._id?.toString()
    ) {
      recipients.add(task.project.manager.toString());
    }

    // Include assignees if not actor
    (task.assignees || []).forEach((a) => {
      const id = a._id ? a._id.toString() : a.toString();
      if (id !== actor?._id?.toString()) {
        recipients.add(id);
      }
    });

    const actionUrl = `${env.FRONTEND_URL}/tasks`;
    const projectName = task.project?.name || 'Project';

    for (const recipientId of recipients) {
      const dedupKey = `status-${task._id}-${newStatus}-${Date.now()}`;
      const emailTemplate = emailService.templates.statusChanged({
        taskTitle: task.title,
        taskKey: task.taskKey,
        projectName,
        changerName: actor?.name || 'A team member',
        previousStatus,
        newStatus,
        actionUrl
      });

      await notificationService.dispatch({
        recipientId,
        type: NOTIFICATION_TYPES.TASK_STATUS_CHANGED,
        title: `Task status updated: ${task.taskKey}`,
        message: `"${task.title}" was moved to ${newStatus} by ${actor?.name || 'a teammate'}.`,
        taskId: task._id,
        projectId: task.project?._id || task.project,
        dedupKey,
        metadata: { previousStatus, newStatus },
        emailTemplate
      });
    }
  },

  /**
   * Trigger: Task Due Date Changed
   */
  notifyTaskDueDateChanged: async (task, actor, newDueDate) => {
    if (!task || !newDueDate) return;

    (task.assignees || []).forEach(async (a) => {
      const recipientId = a._id ? a._id.toString() : a.toString();
      if (recipientId === actor?._id?.toString()) return;

      const formatted = new Date(newDueDate).toLocaleDateString();
      await notificationService.dispatch({
        recipientId,
        type: NOTIFICATION_TYPES.TASK_DUE_DATE_CHANGED,
        title: `Due date changed: ${task.taskKey}`,
        message: `The deadline for "${task.title}" was adjusted to ${formatted}.`,
        taskId: task._id,
        projectId: task.project?._id || task.project,
        dedupKey: `due-${task._id}-${formatted}-${recipientId}`
      });
    });
  },

  /**
   * Trigger: Comment Added
   */
  notifyTaskComment: async (task, commenter, commentContent) => {
    if (!task || !commentContent) return;

    const recipients = new Set();
    const commenterId = commenter?._id?.toString();

    // Include creator
    if (task.creator && task.creator.toString() !== commenterId) {
      recipients.add(task.creator.toString());
    }

    // Include assignees
    (task.assignees || []).forEach((a) => {
      const id = a._id ? a._id.toString() : a.toString();
      if (id !== commenterId) {
        recipients.add(id);
      }
    });

    const actionUrl = `${env.FRONTEND_URL}/tasks`;
    const snippet = commentContent.trim().substring(0, 120);

    for (const recipientId of recipients) {
      const dedupKey = `comment-${task._id}-${Date.now()}-${recipientId}`;
      const emailTemplate = emailService.templates.commentAdded({
        taskTitle: task.title,
        taskKey: task.taskKey,
        commenterName: commenter?.name || 'A teammate',
        commentSnippet: snippet,
        actionUrl
      });

      await notificationService.dispatch({
        recipientId,
        type: NOTIFICATION_TYPES.TASK_COMMENT_ADDED,
        title: `New comment on ${task.taskKey}`,
        message: `${commenter?.name || 'Someone'} commented: "${snippet}"`,
        taskId: task._id,
        projectId: task.project?._id || task.project,
        dedupKey,
        emailTemplate
      });
    }
  },

  /**
   * Trigger: Project Member Added
   */
  notifyProjectMemberAdded: async (project, actor, newMemberIds = []) => {
    if (!project || !newMemberIds.length) return;

    for (const memberId of newMemberIds) {
      if (memberId.toString() === actor?._id?.toString()) continue;

      await notificationService.dispatch({
        recipientId: memberId,
        type: NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED,
        title: `Added to project: ${project.name}`,
        message: `You were added as a team member to project "${project.name}" (${project.projectKey}).`,
        projectId: project._id,
        dedupKey: `proj-member-${project._id}-${memberId}`
      });
    }
  }
};

export default notificationService;

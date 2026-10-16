import { Comment } from '../models/comment.model.js';
import { Notification } from '../models/notification.model.js';
import { NotificationOutbox } from '../models/notificationOutbox.model.js';
import { Task, TASK_SOURCES } from '../models/task.model.js';
import { TaskDraft } from '../models/taskDraft.model.js';
import { TaskEvent } from '../models/taskEvent.model.js';
import { TaskWhatsAppNotification } from '../models/taskWhatsAppNotification.model.js';
import { TimeEntry } from '../models/timeEntry.model.js';
import { MonitoredGroup } from '../models/monitoredGroup.model.js';
import { USER_ROLES } from '../models/user.model.js';
import { WhatsAppProcessingCheckpoint } from '../models/whatsappProcessingCheckpoint.model.js';

const CHECKPOINT_KEY = 'inbound';

export const whatsappImportedTaskFilter = {
  $or: [
    { source: TASK_SOURCES.WHATSAPP },
    { whatsappMessageId: { $type: 'string' } },
    { whatsappDraftId: { $ne: null } },
    { 'sourceMetadata.groupJid': { $type: 'string' } },
    { 'sourceMetadata.messageId': { $type: 'string' } }
  ]
};

export const getWhatsAppHistoryResetPreview = async () => {
  const [tasks, drafts, groupsWithActivity, checkpoint] = await Promise.all([
    Task.countDocuments(whatsappImportedTaskFilter),
    TaskDraft.countDocuments({}),
    MonitoredGroup.countDocuments({ lastMessageAt: { $ne: null } }),
    WhatsAppProcessingCheckpoint.findOne({ key: CHECKPOINT_KEY }).lean()
  ]);

  return {
    tasks,
    drafts,
    groupsWithActivity,
    processingStartedAt: checkpoint?.startedAt || null
  };
};

export const resetWhatsAppHistory = async (admin) => {
  if (!admin || admin.role !== USER_ROLES.ADMIN) {
    throw new Error('Only administrators may reset WhatsApp task history.');
  }

  const startedAt = new Date();

  await WhatsAppProcessingCheckpoint.findOneAndUpdate(
    { key: CHECKPOINT_KEY },
    {
      $set: {
        startedAt,
        resetBy: admin?._id || null,
        resetByName: admin?.name || admin?.email || ''
      }
    },
    { upsert: true, new: true, runValidators: true }
  );

  const importedTasks = await Task.find(whatsappImportedTaskFilter).select('_id').lean();
  const taskIds = importedTasks.map((task) => task._id);
  const result = {
    startedAt,
    tasks: 0,
    drafts: 0,
    taskEvents: 0,
    comments: 0,
    timeEntries: 0,
    whatsappNotifications: 0,
    notifications: 0,
    notificationOutbox: 0,
    groupsUpdated: 0
  };

  if (taskIds.length) {
    const notifications = await Notification.find({ task: { $in: taskIds } }).select('_id').lean();
    const notificationIds = notifications.map((notification) => notification._id);

    if (notificationIds.length) {
      const outbox = await NotificationOutbox.deleteMany({ notification: { $in: notificationIds } });
      result.notificationOutbox = outbox.deletedCount || 0;
    }

    const [taskEvents, comments, timeEntries, whatsappNotifications, deletedNotifications] =
      await Promise.all([
        TaskEvent.deleteMany({ task: { $in: taskIds } }),
        Comment.deleteMany({ task: { $in: taskIds } }),
        TimeEntry.deleteMany({ task: { $in: taskIds } }),
        TaskWhatsAppNotification.deleteMany({ task: { $in: taskIds } }),
        Notification.deleteMany({ task: { $in: taskIds } })
      ]);

    result.taskEvents = taskEvents.deletedCount || 0;
    result.comments = comments.deletedCount || 0;
    result.timeEntries = timeEntries.deletedCount || 0;
    result.whatsappNotifications = whatsappNotifications.deletedCount || 0;
    result.notifications = deletedNotifications.deletedCount || 0;
  }

  const [tasks, drafts, groups] = await Promise.all([
    Task.deleteMany(whatsappImportedTaskFilter),
    TaskDraft.deleteMany({}),
    MonitoredGroup.updateMany(
      { lastMessageAt: { $ne: null } },
      { $set: { lastMessageAt: null } }
    )
  ]);

  result.tasks = tasks.deletedCount || 0;
  result.drafts = drafts.deletedCount || 0;
  result.groupsUpdated = groups.modifiedCount || 0;

  return result;
};

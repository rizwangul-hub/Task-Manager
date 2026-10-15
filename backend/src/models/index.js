import { User, USER_ROLES } from './user.model.js';
import { Project, PROJECT_STATUSES } from './project.model.js';
import { Task, TASK_STATUSES, TASK_PRIORITIES, TASK_SOURCES } from './task.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from './taskEvent.model.js';
import { Comment } from './comment.model.js';
import { TimeEntry } from './timeEntry.model.js';
import {
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  EMAIL_DELIVERY_STATUSES
} from './notification.model.js';
import { NotificationOutbox, OUTBOX_STATUSES } from './notificationOutbox.model.js';

export const MODEL_NAMES = {
  USER: 'User',
  PROJECT: 'Project',
  TASK: 'Task',
  TASK_EVENT: 'TaskEvent',
  TIME_ENTRY: 'TimeEntry',
  COMMENT: 'Comment',
  NOTIFICATION: 'Notification',
  NOTIFICATION_OUTBOX: 'NotificationOutbox',
  INTEGRATION_MESSAGE: 'IntegrationMessage'
};

export {
  User,
  USER_ROLES,
  Project,
  PROJECT_STATUSES,
  Task,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TaskEvent,
  TASK_EVENT_ACTIONS,
  Comment,
  TimeEntry,
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  EMAIL_DELIVERY_STATUSES,
  NotificationOutbox,
  OUTBOX_STATUSES
};

export default {
  User,
  Project,
  Task,
  TaskEvent,
  Comment,
  TimeEntry,
  Notification,
  NotificationOutbox,
  USER_ROLES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_EVENT_ACTIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  EMAIL_DELIVERY_STATUSES,
  OUTBOX_STATUSES,
  MODEL_NAMES
};

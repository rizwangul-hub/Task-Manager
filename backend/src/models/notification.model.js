import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_UNASSIGNED: 'TASK_UNASSIGNED',
  TASK_DUE_DATE_CHANGED: 'TASK_DUE_DATE_CHANGED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_UPCOMING_DUE: 'TASK_UPCOMING_DUE',
  TASK_COMMENT_ADDED: 'TASK_COMMENT_ADDED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  DEADLINE_NEAR: 'DEADLINE_NEAR',
  WHATSAPP_TASK_CREATED: 'WHATSAPP_TASK_CREATED',
  PROJECT_MEMBER_ADDED: 'PROJECT_MEMBER_ADDED',
  PROJECT_MEMBER_REMOVED: 'PROJECT_MEMBER_REMOVED',
  SYSTEM_NOTICE: 'SYSTEM_NOTICE'
};

export const NOTIFICATION_CHANNELS = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  BOTH: 'BOTH'
};

export const EMAIL_DELIVERY_STATUSES = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED'
};

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient user reference is required']
    },
    type: {
      type: String,
      enum: {
        values: Object.values(NOTIFICATION_TYPES),
        message: '{VALUE} is not a valid notification type'
      },
      required: [true, 'Notification type is required']
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters']
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      alias: 'taskId',
      default: null
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null
    },
    isRead: {
      type: Boolean,
      default: false
    },
    channel: {
      type: String,
      enum: Object.values(NOTIFICATION_CHANNELS),
      default: NOTIFICATION_CHANNELS.BOTH
    },
    emailDeliveryStatus: {
      type: String,
      enum: Object.values(EMAIL_DELIVERY_STATUSES),
      default: EMAIL_DELIVERY_STATUSES.PENDING
    },
    readAt: {
      type: Date,
      default: null
    },
    dedupKey: {
      type: String,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, dedupKey: 1 }, { unique: true, sparse: true });
notificationSchema.index({ task: 1 });
notificationSchema.index({ createdAt: -1 });

notificationSchema.methods.toJSON = function () {
  const notif = this.toObject();
  delete notif.__v;
  return notif;
};

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export default Notification;

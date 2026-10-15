import mongoose from 'mongoose';

export const OUTBOX_STATUSES = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed'
};

const notificationOutboxSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient user reference is required']
    },
    notification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Notification',
      default: null
    },
    recipientEmail: {
      type: String,
      required: [true, 'Recipient email is required'],
      lowercase: true,
      trim: true
    },
    recipientName: {
      type: String,
      default: ''
    },
    notificationType: {
      type: String,
      required: true
    },
    channel: {
      type: String,
      enum: ['email', 'in_app', 'both'],
      default: 'email'
    },
    subject: {
      type: String,
      default: ''
    },
    htmlContent: {
      type: String,
      default: ''
    },
    textContent: {
      type: String,
      default: ''
    },
    inAppPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    status: {
      type: String,
      enum: Object.values(OUTBOX_STATUSES),
      default: OUTBOX_STATUSES.PENDING
    },
    attempts: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 3
    },
    lastError: {
      type: String,
      default: null
    },
    nextRetryAt: {
      type: Date,
      default: Date.now
    },
    dedupKey: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes for worker queries
notificationOutboxSchema.index({ status: 1, nextRetryAt: 1 });
notificationOutboxSchema.index({ dedupKey: 1 }, { unique: true, sparse: true });
notificationOutboxSchema.index({ createdAt: -1 });

export const NotificationOutbox =
  mongoose.models.NotificationOutbox ||
  mongoose.model('NotificationOutbox', notificationOutboxSchema);
export default NotificationOutbox;

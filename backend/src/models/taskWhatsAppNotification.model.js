import mongoose from 'mongoose';

export const TASK_WHATSAPP_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed'
};

const taskWhatsAppNotificationSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true
    },
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: true
    },
    contactName: { type: String, required: true },
    recipientNumber: { type: String, required: true },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    messageType: {
      type: String,
      enum: ['task_assignment'],
      default: 'task_assignment'
    },
    provider: {
      type: String,
      enum: ['baileys'],
      default: 'baileys'
    },
    providerMessageId: { type: String, default: null },
    status: {
      type: String,
      enum: Object.values(TASK_WHATSAPP_STATUSES),
      default: TASK_WHATSAPP_STATUSES.PENDING,
      index: true
    },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
    processingStartedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    nextAttemptAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

taskWhatsAppNotificationSchema.index(
  { task: 1, assignmentId: 1 },
  { unique: true, name: 'task_assignment_notification_once' }
);
taskWhatsAppNotificationSchema.index({ status: 1, nextAttemptAt: 1 });

export const TaskWhatsAppNotification =
  mongoose.models.TaskWhatsAppNotification ||
  mongoose.model('TaskWhatsAppNotification', taskWhatsAppNotificationSchema);
export default TaskWhatsAppNotification;

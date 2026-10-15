import mongoose from 'mongoose';

export const WHATSAPP_JOB_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  PROCESSED: 'PROCESSED'
};

const whatsappWebhookJobSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['meta', 'twilio', 'baileys'],
      required: true
    },
    messageId: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    status: {
      type: String,
      enum: Object.values(WHATSAPP_JOB_STATUSES),
      default: WHATSAPP_JOB_STATUSES.PENDING,
      required: true
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now
    },
    lockedAt: {
      type: Date,
      default: null
    },
    lastError: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

whatsappWebhookJobSchema.index({ provider: 1, messageId: 1 }, { unique: true });
whatsappWebhookJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export const WhatsAppWebhookJob = mongoose.models.WhatsAppWebhookJob ||
  mongoose.model('WhatsAppWebhookJob', whatsappWebhookJobSchema);
export default WhatsAppWebhookJob;

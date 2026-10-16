import mongoose from 'mongoose';

export const TASK_DRAFT_STATUSES = {
  AWAITING_REVIEW: 'awaiting_review',
  NEEDS_CLARIFICATION: 'needs_clarification',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FAILED: 'failed',
  IGNORED: 'ignored'
};

const taskDraftSchema = new mongoose.Schema(
  {
    groupJid: {
      type: String,
      required: [true, 'Group JID is required'],
      trim: true,
      index: true
    },
    groupName: {
      type: String,
      trim: true,
      default: ''
    },
    messageId: {
      type: String,
      required: [true, 'Message ID is required'],
      trim: true
    },
    senderJid: {
      type: String,
      trim: true,
      default: ''
    },
    senderName: {
      type: String,
      trim: true,
      default: ''
    },
    messageTimestamp: {
      type: Date,
      required: true,
      index: true
    },
    rawMessageText: {
      type: String,
      default: '',
      trim: true
    },
    isRawMessageRedacted: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: Object.values(TASK_DRAFT_STATUSES),
      default: TASK_DRAFT_STATUSES.AWAITING_REVIEW,
      index: true
    },
    aiExtraction: {
      isTask: { type: Boolean, default: false },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      title: { type: String, default: '', trim: true },
      description: { type: String, default: '', trim: true },
      assigneeName: { type: String, default: '', trim: true },
      assigneePhone: { type: String, default: '', trim: true },
      projectName: { type: String, default: '', trim: true },
      projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
      priority: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Urgent'],
        default: 'Medium'
      },
      startDate: { type: Date, default: null },
      dueDate: { type: Date, default: null },
      dateInterpretation: { type: String, default: '' },
      sourceSender: { type: String, default: '' },
      reason: { type: String, default: '', trim: true },
      missingInformation: [{ type: String, trim: true }],
      modelUsed: { type: String, default: '' }
    },
    editableFields: {
      title: { type: String, default: undefined, trim: true },
      description: { type: String, default: undefined, trim: true },
      assigneeName: { type: String, default: undefined, trim: true },
      assigneePhone: { type: String, default: undefined, trim: true },
      projectName: { type: String, default: undefined, trim: true },
      projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: undefined },
      priority: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Urgent'],
        default: undefined
      },
      startDate: { type: Date, default: undefined },
      dueDate: { type: Date, default: undefined }
    },
    createdTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
      index: true
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    processingError: {
      type: String,
      default: null
    },
    attempts: {
      type: Number,
      default: 0
    },
    extractorProvider: {
      type: String,
      default: 'heuristic' // 'openai' | 'gemini' | 'heuristic'
    }
  },
  {
    timestamps: true
  }
);

// Enforce unique compound index to guarantee idempotency and prevent duplicate drafts
taskDraftSchema.index(
  { groupJid: 1, messageId: 1 },
  { unique: true, name: 'group_message_unique' }
);

taskDraftSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export const TaskDraft =
  mongoose.models.TaskDraft || mongoose.model('TaskDraft', taskDraftSchema);

export default TaskDraft;

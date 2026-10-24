import mongoose from 'mongoose';

export const TASK_EVENT_ACTIONS = {
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED',
  START_DATE_CHANGED: 'START_DATE_CHANGED',
  DUE_DATE_CHANGED: 'DUE_DATE_CHANGED',
  TASK_ARCHIVED: 'TASK_ARCHIVED',
  TASK_RESTORED: 'TASK_RESTORED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  TIME_LOGGED: 'TIME_LOGGED',
  TIME_DELETED: 'TIME_DELETED'
};

const taskEventSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: [true, 'Task reference is required']
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: false,
      default: null
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Actor user reference is required']
    },
    action: {
      type: String,
      enum: {
        values: Object.values(TASK_EVENT_ACTIONS),
        message: '{VALUE} is not a valid task event action'
      },
      required: [true, 'Event action is required']
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes for chronological audit trail querying
taskEventSchema.index({ task: 1, createdAt: -1 });
taskEventSchema.index({ project: 1, createdAt: -1 });
taskEventSchema.index({ user: 1, createdAt: -1 });
taskEventSchema.index({ action: 1 });

/**
 * Static trusted helper to record audit events server-side
 */
taskEventSchema.statics.logEvent = async function ({
  task,
  project,
  user,
  action,
  details = {},
  metadata = {}
}) {
  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  try {
    return await this.create({
      task,
      project,
      user,
      action,
      details,
      metadata
    });
  } catch (error) {
    // Audit logging should not crash business transactions, but should log error
    console.error('[AUDIT_LOG_ERROR] Failed to record task event:', error);
    return null;
  }
};

taskEventSchema.methods.toJSON = function () {
  const event = this.toObject();
  delete event.__v;
  return event;
};

export const TaskEvent = mongoose.models.TaskEvent || mongoose.model('TaskEvent', taskEventSchema);
export default TaskEvent;

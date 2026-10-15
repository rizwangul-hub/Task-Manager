import mongoose from 'mongoose';

export const TASK_STATUSES = {
  BACKLOG: 'Backlog',
  TO_DO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  WORKING_ON_IT: 'Working on it',
  STUCK: 'Stuck',
  APPLIED: 'Applied'
};

export const TASK_PRIORITIES = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent'
};

export const TASK_SOURCES = {
  MANUAL: 'Manual',
  WHATSAPP: 'WhatsApp'
};

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters']
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Task must belong to a project']
    },
    taskKey: {
      type: String,
      required: [true, 'Unique task identifier is required'],
      unique: true,
      uppercase: true,
      trim: true
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Task creator reference is required']
    },
    creationRequestId: {
      type: String,
      trim: true,
      default: undefined,
      select: false
    },
    assignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    assignedContact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    contactAssignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    contactAssignedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: {
        values: Object.values(TASK_STATUSES),
        message: '{VALUE} is not a valid task status'
      },
      default: TASK_STATUSES.WORKING_ON_IT
    },
    priority: {
      type: String,
      enum: {
        values: Object.values(TASK_PRIORITIES),
        message: '{VALUE} is not a valid task priority'
      },
      default: TASK_PRIORITIES.MEDIUM
    },
    source: {
      type: String,
      enum: {
        values: Object.values(TASK_SOURCES),
        message: '{VALUE} is not a valid task source'
      },
      default: TASK_SOURCES.MANUAL
    },
    whatsappMessageId: {
      type: String,
      trim: true,
      default: undefined
    },
    whatsappSender: {
      phone: { type: String, trim: true, default: '' },
      name: { type: String, trim: true, default: '' },
      sentAt: { type: Date, default: null }
    },
    groupName: {
      type: String,
      trim: true,
      default: ''
    },
    groupTitle: {
      type: String,
      trim: true,
      default: 'General Tasks',
      index: true
    },
    previewImage: {
      publicId: { type: String, default: '' },
      url: { type: String, default: '' }
    },
    reminderSent: {
      type: Boolean,
      default: false
    },
    deadlineAlertSent: {
      type: Boolean,
      default: false
    },
    overdueAlertSent: {
      type: Boolean,
      default: false
    },
    whatsappNotificationSent: {
      type: Boolean,
      default: false
    },
    customFields: [
      {
        key: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        type: { type: String, enum: ['Text', 'Number', 'Date'], required: true },
        value: { type: mongoose.Schema.Types.Mixed, default: null }
      }
    ],
    startDate: {
      type: Date,
      default: null
    },
    dueDate: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null
    },
    attachments: [
      {
        publicId: { type: String, default: '' },
        public_id: { type: String, default: '' },
        url: { type: String, required: true },
        fileName: { type: String, default: '' },
        fileType: { type: String, default: 'application/octet-stream' },
        bytes: { type: Number, default: 0 },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now }
      }
    ],
    totalTimeSpentMinutes: {
      type: Number,
      default: 0,
      min: 0
    },
    isArchived: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
taskSchema.index({ project: 1 });
taskSchema.index({ assignees: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ priority: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ isArchived: 1 });
taskSchema.index({ title: 'text', description: 'text' });
taskSchema.index(
  { creator: 1, creationRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { creationRequestId: { $type: 'string' } },
    name: 'task_creation_request_once'
  }
);
taskSchema.index(
  { whatsappMessageId: 1 },
  { unique: true, sparse: true, name: 'whatsapp_message_id_unique' }
);

taskSchema.virtual('assignee').get(function () {
  return this.assignees && this.assignees.length > 0 ? this.assignees[0] : null;
});

taskSchema.methods.toJSON = function () {
  const task = this.toObject({ virtuals: true });
  delete task.__v;
  return task;
};

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
export default Task;

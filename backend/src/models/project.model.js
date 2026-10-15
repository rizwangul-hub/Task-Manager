import mongoose from 'mongoose';

export const PROJECT_STATUSES = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [150, 'Project name cannot exceed 150 characters']
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    projectKey: {
      type: String,
      required: [true, 'Project key is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9_-]{2,10}$/, 'Project key must be 2-10 alphanumeric characters']
    },
    status: {
      type: String,
      enum: {
        values: Object.values(PROJECT_STATUSES),
        message: '{VALUE} is not a valid project status'
      },
      default: PROJECT_STATUSES.ACTIVE
    },
    startDate: {
      type: Date,
      default: null
    },
    dueDate: {
      type: Date,
      default: null
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Project manager reference is required']
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Project creator reference is required']
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

// Indexes for query optimization
projectSchema.index({ status: 1 });
projectSchema.index({ manager: 1 });
projectSchema.index({ members: 1 });
projectSchema.index({ isArchived: 1 });
projectSchema.index({ name: 'text', description: 'text' });

projectSchema.methods.toJSON = function () {
  const project = this.toObject();
  delete project.__v;
  return project;
};

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
export default Project;

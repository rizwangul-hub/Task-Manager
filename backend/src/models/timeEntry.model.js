import mongoose from 'mongoose';

const timeEntrySchema = new mongoose.Schema(
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
      required: [true, 'User reference is required']
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      min: [1, 'Minimum duration is 1 minute'],
      max: [1440, 'Maximum duration is 1440 minutes (24 hours)']
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    date: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Indexes
timeEntrySchema.index({ task: 1, date: -1 });
timeEntrySchema.index({ user: 1, date: -1 });
timeEntrySchema.index({ project: 1 });

timeEntrySchema.methods.toJSON = function () {
  const entry = this.toObject();
  delete entry.__v;
  return entry;
};

export const TimeEntry = mongoose.models.TimeEntry || mongoose.model('TimeEntry', timeEntrySchema);
export default TimeEntry;

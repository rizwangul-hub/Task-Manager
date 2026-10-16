import mongoose from 'mongoose';

const monitoredGroupSchema = new mongoose.Schema(
  {
    groupJid: {
      type: String,
      required: [true, 'Group JID is required'],
      unique: true,
      trim: true,
      index: true
    },
    groupName: {
      type: String,
      trim: true,
      default: ''
    },
    isMonitored: {
      type: Boolean,
      default: false,
      index: true
    },
    isPaused: {
      type: Boolean,
      default: false
    },
    participantCount: {
      type: Number,
      default: 0
    },
    lastMessageAt: {
      type: Date,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

monitoredGroupSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export const MonitoredGroup =
  mongoose.models.MonitoredGroup || mongoose.model('MonitoredGroup', monitoredGroupSchema);

export default MonitoredGroup;

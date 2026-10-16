import mongoose from 'mongoose';

const whatsappProcessingCheckpointSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'inbound'
    },
    startedAt: {
      type: Date,
      required: true
    },
    resetBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    resetByName: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

export const WhatsAppProcessingCheckpoint =
  mongoose.models.WhatsAppProcessingCheckpoint ||
  mongoose.model('WhatsAppProcessingCheckpoint', whatsappProcessingCheckpointSchema);

export default WhatsAppProcessingCheckpoint;

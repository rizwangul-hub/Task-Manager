import mongoose from 'mongoose';

const whatsappAuthSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    value: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

export const WhatsAppAuth =
  mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', whatsappAuthSchema);

export default WhatsAppAuth;

import mongoose from 'mongoose';

export const normalizeContactWhatsAppNumber = (value) => {
  if (typeof value !== 'string') return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('03') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  } else if (digits.startsWith('07') && digits.length === 11) {
    digits = `44${digits.slice(1)}`;
  } else if (digits.startsWith('920') || digits.startsWith('440')) {
    digits = `${digits.slice(0, 2)}${digits.slice(3)}`;
  }

  return /^\d{10,15}$/.test(digits) && !digits.startsWith('0') ? `+${digits}` : '';
};

const contactSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Contact name is required'],
      trim: true,
      maxlength: [120, 'Contact name cannot exceed 120 characters']
    },
    whatsappNumber: {
      type: String,
      required: [true, 'WhatsApp number is required'],
      set: (value) => normalizeContactWhatsAppNumber(value) ||
        (typeof value === 'string' ? value.trim() : value),
      validate: {
        validator: (value) => /^\+[1-9]\d{9,14}$/.test(value || ''),
        message: 'Enter a valid international WhatsApp number with 10–15 digits.'
      }
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      match: [/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address']
    },
    jobTitle: {
      type: String,
      trim: true,
      default: '',
      maxlength: [120, 'Job title cannot exceed 120 characters']
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Notes cannot exceed 2000 characters']
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

contactSchema.index({ whatsappNumber: 1 }, { unique: true });
contactSchema.index({ fullName: 1, isActive: 1 });

contactSchema.methods.toJSON = function () {
  const contact = this.toObject();
  delete contact.__v;
  return contact;
};

export const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);
export default Contact;

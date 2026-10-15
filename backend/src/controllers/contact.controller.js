import mongoose from 'mongoose';
import { Contact, normalizeContactWhatsAppNumber } from '../models/contact.model.js';
import { AppError } from '../middleware/errorHandler.js';

const validateContactInput = (body, { partial = false } = {}) => {
  const input = body || {};
  const normalizedNumber = input.whatsappNumber === undefined
    ? undefined
    : normalizeContactWhatsAppNumber(input.whatsappNumber);

  if (!partial && (typeof input.fullName !== 'string' || !input.fullName.trim())) {
    return { error: 'Full name is required.' };
  }
  if (!partial && !normalizedNumber) {
    return { error: 'Enter a valid international WhatsApp number with 10–15 digits.' };
  }
  if (input.whatsappNumber !== undefined && !normalizedNumber) {
    return { error: 'Enter a valid international WhatsApp number with 10–15 digits.' };
  }
  if (input.email !== undefined && typeof input.email !== 'string') {
    return { error: 'Email address must be text.' };
  }
  if (input.jobTitle !== undefined && typeof input.jobTitle !== 'string') {
    return { error: 'Job title must be text.' };
  }
  if (input.notes !== undefined && typeof input.notes !== 'string') {
    return { error: 'Notes must be text.' };
  }
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    return { error: 'Contact status must be active or inactive.' };
  }
  return { normalizedNumber };
};

export const contactController = {
  list: async (req, res, next) => {
    try {
      const query = {};
      if (req.query.status !== 'all') query.isActive = req.query.status === 'inactive' ? false : true;
      if (typeof req.query.search === 'string' && req.query.search.trim()) {
        const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { fullName: { $regex: escaped, $options: 'i' } },
          { whatsappNumber: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } }
        ];
      }
      const contacts = await Contact.find(query).sort({ fullName: 1 }).limit(500);
      res.status(200).json({ status: 'success', data: { contacts: contacts.map((contact) => contact.toJSON()) } });
    } catch (error) {
      next(error);
    }
  },

  create: async (req, res, next) => {
    const validated = validateContactInput(req.body);
    if (validated.error) return next(new AppError(validated.error, 400));
    try {
      const contact = await Contact.create({
        ...req.body,
        fullName: req.body.fullName.trim(),
        whatsappNumber: validated.normalizedNumber,
        email: req.body.email?.trim() || '',
        jobTitle: req.body.jobTitle?.trim() || '',
        notes: req.body.notes?.trim() || ''
      });
      res.status(201).json({ status: 'success', data: { contact: contact.toJSON() } });
    } catch (error) {
      if (error.code === 11000) return next(new AppError('A contact with this WhatsApp number already exists.', 409));
      next(error);
    }
  },

  update: async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Invalid contact ID.', 400));
    const validated = validateContactInput(req.body, { partial: true });
    if (validated.error) return next(new AppError(validated.error, 400));
    try {
      const contact = await Contact.findById(req.params.id);
      if (!contact) return next(new AppError('Contact not found.', 404));
      for (const field of ['fullName', 'email', 'jobTitle', 'notes', 'isActive']) {
        if (req.body[field] !== undefined) {
          contact[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
        }
      }
      if (validated.normalizedNumber !== undefined) contact.whatsappNumber = validated.normalizedNumber;
      await contact.save();
      res.status(200).json({ status: 'success', data: { contact: contact.toJSON() } });
    } catch (error) {
      if (error.code === 11000) return next(new AppError('A contact with this WhatsApp number already exists.', 409));
      next(error);
    }
  },

  deactivate: async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) return next(new AppError('Invalid contact ID.', 400));
    try {
      const contact = await Contact.findByIdAndUpdate(
        req.params.id,
        { $set: { isActive: false } },
        { new: true, runValidators: true }
      );
      if (!contact) return next(new AppError('Contact not found.', 404));
      res.status(200).json({ status: 'success', message: 'Contact deactivated.', data: { contact: contact.toJSON() } });
    } catch (error) {
      next(error);
    }
  }
};

export default contactController;

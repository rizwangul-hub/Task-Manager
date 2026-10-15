import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import FormField from '../ui/FormField';
import { contactService } from '../../services/contactService';

export const ContactFormModal = ({ isOpen, contact, onClose, onSaved, compact = false }) => {
  const [fullName, setFullName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setFullName(contact?.fullName || '');
    setWhatsappNumber(contact?.whatsappNumber || '');
    setEmail(contact?.email || '');
    setJobTitle(contact?.jobTitle || '');
    setNotes(contact?.notes || '');
    setIsActive(contact?.isActive ?? true);
    setError('');
  }, [contact, isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        fullName: fullName.trim(),
        whatsappNumber: whatsappNumber.trim(),
        email: email.trim(),
        jobTitle: jobTitle.trim(),
        notes: notes.trim(),
        isActive
      };
      const response = contact
        ? await contactService.updateContact(contact._id, payload)
        : await contactService.createContact(payload);
      onSaved(response.data.contact);
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'Could not save contact.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={contact ? 'Edit Contact' : 'Add Contact'}
      maxWidth={compact ? '480px' : '560px'}
      className="contact-form-modal"
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <div className="form-error-banner">{error}</div>}
        <FormField label="Full Name" required>
          <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} />
        </FormField>
        <FormField label="WhatsApp Number" helperText="Include country code, e.g. +92 317 9500901 or +44 7123 456789." required>
          <input
            className="input-field"
            type="tel"
            autoComplete="tel"
            placeholder="+923179500901"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            required
          />
        </FormField>
        {!compact && (
          <>
            <FormField label="Email (optional)">
              <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Job Title / Role (optional)">
              <input className="input-field" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Notes (optional)">
              <textarea className="input-field textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </FormField>
            {contact && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span>Active contact</span>
              </label>
            )}
          </>
        )}
        <div className="modal-actions-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={saving}>
            {contact ? 'Save Contact' : 'Add Contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ContactFormModal;

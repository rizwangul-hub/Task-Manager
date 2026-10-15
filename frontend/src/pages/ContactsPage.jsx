import React, { useCallback, useEffect, useState } from 'react';
import { ContactRound, Plus, Search, Pencil, UserX } from 'lucide-react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import ConfirmationDialog from '../components/ui/ConfirmationDialog';
import ContactFormModal from '../components/contacts/ContactFormModal';
import { contactService } from '../services/contactService';
import { useToast } from '../hooks/useToast';
import { formatWhatsAppNumber } from '../utils/phone';

export const ContactsPage = () => {
  const { toast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingContact, setEditingContact] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deactivatingContact, setDeactivatingContact] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await contactService.getContacts({
        search: search.trim() || undefined,
        status
      });
      setContacts(response.data.contacts || []);
    } catch (loadError) {
      setError(loadError.message || 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const handleSaved = (savedContact) => {
    setContacts((current) => {
      const exists = current.some((item) => item._id === savedContact._id);
      return exists
        ? current.map((item) => item._id === savedContact._id ? savedContact : item)
        : [...current, savedContact].sort((a, b) => a.fullName.localeCompare(b.fullName));
    });
    toast.success('Contact saved.');
    void loadContacts();
  };

  const handleDeactivate = async () => {
    if (!deactivatingContact) return;
    setDeactivating(true);
    try {
      await contactService.deactivateContact(deactivatingContact._id);
      toast.success('Contact deactivated. Existing task history is preserved.');
      setDeactivatingContact(null);
      await loadContacts();
    } catch (deactivateError) {
      toast.error(deactivateError.message || 'Could not deactivate contact.');
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <PageContainer
      title="Contacts"
      subtitle="Manage people who receive assigned work. Contacts do not need application accounts."
      badge={<StatusBadge status="active" label={`${contacts.length} Contacts`} />}
      actions={<Button variant="primary" icon={Plus} onClick={() => { setEditingContact(null); setShowForm(true); }}>Add Contact</Button>}
    >
      <div className="filter-controls-bar">
        <div className="filter-search-box">
          <Search size={16} className="filter-search-icon" />
          <input
            type="search"
            className="filter-search-input"
            placeholder="Search name, number, or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="active">Active contacts</option>
          <option value="inactive">Inactive contacts</option>
          <option value="all">All contacts</option>
        </select>
      </div>

      {loading && <LoadingState message="Loading contacts..." />}
      {error && <ErrorState title="Could not load contacts" message={error} onRetry={loadContacts} />}
      {!loading && !error && contacts.length === 0 && (
        <EmptyState
          icon={ContactRound}
          title="No contacts found"
          description="Add a contact to assign tasks and send WhatsApp notifications."
          actionLabel="Add Contact"
          actionIcon={Plus}
          onAction={() => { setEditingContact(null); setShowForm(true); }}
        />
      )}
      {!loading && !error && contacts.length > 0 && (
        <div className="data-table-container">
          <table className="data-table" aria-label="Contact directory">
            <thead>
              <tr><th>Name</th><th>WhatsApp</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Updated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact._id}>
                  <td><strong>{contact.fullName}</strong></td>
                  <td>{formatWhatsAppNumber(contact.whatsappNumber)}</td>
                  <td>{contact.email || '—'}</td>
                  <td>{contact.jobTitle || '—'}</td>
                  <td><StatusBadge status={contact.isActive ? 'active' : 'offline'} label={contact.isActive ? 'Active' : 'Inactive'} /></td>
                  <td>{contact.createdAt ? new Date(contact.createdAt).toLocaleDateString() : '—'}</td>
                  <td>{contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <div className="table-actions-btns">
                      <Button variant="secondary" size="sm" icon={Pencil} onClick={() => { setEditingContact(contact); setShowForm(true); }}>Edit</Button>
                      {contact.isActive && (
                        <Button variant="secondary" size="sm" icon={UserX} onClick={() => setDeactivatingContact(contact)}>Deactivate</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactFormModal
        isOpen={showForm}
        contact={editingContact}
        onClose={() => setShowForm(false)}
        onSaved={handleSaved}
      />
      <ConfirmationDialog
        isOpen={Boolean(deactivatingContact)}
        onClose={() => setDeactivatingContact(null)}
        onConfirm={handleDeactivate}
        title="Deactivate contact?"
        message="The contact will no longer be assignable. Existing tasks and WhatsApp history will remain intact."
        confirmLabel="Deactivate"
        isLoading={deactivating}
        variant="warning"
      />
    </PageContainer>
  );
};

export default ContactsPage;

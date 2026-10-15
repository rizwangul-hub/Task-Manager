import React, { useState, useEffect, useCallback } from 'react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import { userService } from '../services/userService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  Users,
  UserPlus,
  Search,
  Mail,
  Shield
} from 'lucide-react';

export const TeamPage = () => {
  const { user, isAdmin, isManager, checkSession } = useAuth();
  const canManageUsers = isAdmin || isManager;
  const { toast } = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('Member');
  const [formWhatsAppNumber, setFormWhatsAppNumber] = useState('');
  const [profileWhatsAppNumber, setProfileWhatsAppNumber] = useState(user?.whatsappNumber || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await userService.getUsers({
        search: search.trim() || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined
      });
      setUsers(res.data.users);
    } catch (err) {
      setError(err.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('Member');
    setFormWhatsAppNumber('');
    setFormError('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formName.trim() || !formEmail.trim() || !formPassword) {
      setFormError('All fields are required.');
      return;
    }

    if (formPassword.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      await userService.createUser({
        name: formName.trim(),
        email: formEmail.trim(),
        password: formPassword,
        role: formRole,
        whatsappNumber: formWhatsAppNumber.trim() || null
      });
      toast.success(`User '${formName}' created successfully.`);
      setIsCreateModalOpen(false);
      fetchUsers();
    } catch (err) {
      setFormError(err.message || 'Failed to create user account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProfileWhatsApp = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await userService.updateUser(user._id, {
        whatsappNumber: profileWhatsAppNumber.trim() || null
      });
      await checkSession();
      toast.success('Your WhatsApp number has been saved.');
    } catch (err) {
      toast.error(err.message || 'Could not save your WhatsApp number.');
    } finally {
      setSavingProfile(false);
    }
  };

  const pageActions = canManageUsers && (
    <Button variant="primary" size="md" icon={UserPlus} onClick={handleOpenCreate}>
      Add Team Member
    </Button>
  );

  return (
    <PageContainer
      title="Team Directory"
      subtitle="View the team and provision accounts with the appropriate access level."
      badge={<StatusBadge status="active" label={`${users.length} Members`} />}
      actions={pageActions}
    >
      <form className="settings-card" onSubmit={handleSaveProfileWhatsApp}>
        <div className="card-header">
          <div className="card-header-title">
            <h3>Your WhatsApp Number</h3>
          </div>
        </div>
        <FormField
          id="profile-whatsapp-number"
          label="WhatsApp number"
          type="tel"
          placeholder="e.g. 923001234567 or +447123456789"
          value={profileWhatsAppNumber}
          onChange={(e) => setProfileWhatsAppNumber(e.target.value)}
          helperText="Include the country code. Assigned tasks will be sent to this number when it is registered on WhatsApp."
        />
        <div className="modal-actions-right">
          <Button type="submit" variant="primary" isLoading={savingProfile}>
            Save WhatsApp Number
          </Button>
        </div>
      </form>

      {/* Search and Filters Bar */}
      <div className="filter-controls-bar">
        <div className="filter-search-box">
          <Search size={16} className="filter-search-icon" />
          <input
            type="search"
            placeholder="Search by employee name or email address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-search-input"
          />
        </div>

        <div className="filter-select-group">
          <select
            className="filter-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            <option value="Admin">Administrators</option>
            <option value="Manager">Managers</option>
            <option value="Member">Members</option>
          </select>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="active">Active Accounts</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {loading && <LoadingState message="Loading team members..." />}

      {error && (
        <ErrorState
          title="Could not load team directory"
          message={error}
          onRetry={fetchUsers}
        />
      )}

      {!loading && !error && users.length === 0 && (
        <EmptyState
          icon={Users}
          title="No Users Found"
          description={
            search || roleFilter || statusFilter
              ? 'No employee accounts match your current filters.'
              : 'The user directory is currently unpopulated.'
          }
          actionLabel={canManageUsers && !search ? 'Add First Team Member' : undefined}
          actionIcon={canManageUsers ? UserPlus : undefined}
          onAction={canManageUsers ? handleOpenCreate : undefined}
        />
      )}

      {!loading && !error && users.length > 0 && (
        <div className="data-table-container">
          <table className="data-table" aria-label="Team Directory Table">
            <thead>
              <tr>
                <th>Employee</th>
                <th style={{ width: '220px' }}>Email Address</th>
                <th style={{ width: '180px' }}>WhatsApp</th>
                <th style={{ width: '130px' }}>Role</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '150px' }}>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item._id} className={!item.isActive ? 'row-inactive' : ''}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar-mark">
                        {item.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="user-cell-name">
                        {item.name}
                        {item._id === user?._id && <span className="you-pill">You</span>}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="user-email-cell">
                      <Mail size={13} className="cell-icon" />
                      <span>{item.email}</span>
                    </div>
                  </td>
                  <td>{item.whatsappNumber || 'Not set'}</td>
                  <td>
                    <span className={`role-badge role-${item.role.toLowerCase()}`}>
                      <Shield size={12} />
                      {item.role}
                    </span>
                  </td>
                  <td>
                    <StatusBadge
                      status={item.isActive ? 'active' : 'offline'}
                      label={item.isActive ? 'Active' : 'Inactive'}
                    />
                  </td>
                  <td>
                    <span className="last-login-text">
                      {item.lastLogin ? new Date(item.lastLogin).toLocaleDateString() : 'Never'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create User Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Add Team Member"
      >
        <form onSubmit={handleCreateSubmit} className="modal-form">
          {formError && <p className="modal-form-error">{formError}</p>}

          <FormField
            id="create-name"
            label="Full Name"
            placeholder="e.g. John Doe"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />

          <FormField
            id="create-email"
            label="Work Email Address"
            type="email"
            placeholder="e.g. jdoe@pixxtechnologiees.com"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            required
          />

          <FormField
            id="create-password"
            label="Temporary Initial Password"
            type="password"
            placeholder="Minimum 8 characters"
            value={formPassword}
            onChange={(e) => setFormPassword(e.target.value)}
            helperText="The user will use this password to sign in."
            required
          />

          <FormField
            id="create-whatsapp-number"
            label="WhatsApp Number"
            type="tel"
            placeholder="e.g. 923001234567 or +447123456789"
            value={formWhatsAppNumber}
            onChange={(e) => setFormWhatsAppNumber(e.target.value)}
            helperText="Include the country code. This number is used for task assignment notifications."
          />

          <FormField
            id="create-role"
            label="System Role & Permissions"
            as="select"
            value={formRole}
            onChange={(e) => setFormRole(e.target.value)}
            helperText={isAdmin ? 'Choose the access level for this account.' : 'Managers can create Member accounts.'}
          >
                <option value="Member">Member (Contributor)</option>
                {isAdmin && <option value="Manager">Manager (Project Lead)</option>}
                {isAdmin && <option value="Admin">Administrator (Full Access)</option>}
          </FormField>

          <div className="modal-actions-right">
            <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

    </PageContainer>
  );
};

export default TeamPage;

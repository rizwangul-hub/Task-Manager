import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import FormField from '../components/ui/FormField';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import { notificationService } from '../services/notificationService';
import { userService } from '../services/userService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  Settings,
  Save,
  Server,
  Bell,
  Mail,
  User as UserIcon,
  Phone
} from 'lucide-react';

export const SettingsPage = () => {
  const { apiStatus } = useOutletContext() || {};
  const { user, checkSession } = useAuth();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState('PixxTechnologiees');
  const [workspaceDomain, setWorkspaceDomain] = useState('internal.pixxtechnologiees.com');
  const [timezone, setTimezone] = useState('UTC');

  // User Profile & WhatsApp state
  const [profileWhatsAppNumber, setProfileWhatsAppNumber] = useState(user?.whatsappNumber || '');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (user?.whatsappNumber !== undefined) {
      setProfileWhatsAppNumber(user.whatsappNumber || '');
    }
  }, [user]);

  // Notification Preferences State
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [emailChannel, setEmailChannel] = useState({ configured: false, statusMessage: '' });
  const [prefs, setPrefs] = useState({
    emailNotifications: true,
    taskAssigned: true,
    taskStatusChanged: true,
    taskDueDate: true,
    taskComments: true,
    overdueReminders: true
  });

  const fetchPrefs = useCallback(async () => {
    setLoadingPrefs(true);
    try {
      const res = await notificationService.getPreferences();
      if (res.data?.preferences) {
        setPrefs(res.data.preferences);
      }
      if (res.data?.emailChannel) {
        setEmailChannel(res.data.emailChannel);
      }
    } catch {
      // Keep defaults
    } finally {
      setLoadingPrefs(false);
    }
  }, []);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const handleGeneralSave = (e) => {
    e.preventDefault();
    toast.success('Workspace preferences saved locally for this session.');
  };

  const handlePrefToggle = (field) => {
    setPrefs((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSavePreferences = async (e) => {
    e.preventDefault();
    setSavingPrefs(true);
    try {
      const res = await notificationService.updatePreferences(prefs);
      if (res.data?.preferences) {
        setPrefs(res.data.preferences);
      }
      toast.success('Notification preferences saved.');
    } catch (err) {
      toast.error(err.message || 'Failed to save notification preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleSaveProfileWhatsApp = async (e) => {
    e.preventDefault();
    if (!user?._id) return;
    setSavingProfile(true);
    try {
      await userService.updateUser(user._id, {
        whatsappNumber: profileWhatsAppNumber.trim() || null
      });
      if (checkSession) await checkSession();
      toast.success('Your WhatsApp notification number has been saved.');
    } catch (err) {
      toast.error(err.message || 'Could not save your WhatsApp number.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <PageContainer
      title="System Settings"
      subtitle="Workspace configuration, notification channels, user profile, and operational defaults."
      badge={<StatusBadge status="active" label="Settings Active" />}
    >
      <div className="settings-page-grid">
        {/* User Profile & WhatsApp Settings Card */}
        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <UserIcon size={18} className="card-title-icon" />
              <h3>User Profile & WhatsApp Alerts</h3>
            </div>
            <span className="card-tag">Profile</span>
          </div>

          <form onSubmit={handleSaveProfileWhatsApp} className="settings-form">
            <div className="profile-user-summary" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ fontWeight: 600 }}>{user?.name || 'Workspace User'}</div>
              <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>({user?.email})</div>
              {profileWhatsAppNumber.trim() ? (
                <StatusBadge status="active" label="WhatsApp Linked" />
              ) : (
                <StatusBadge status="pending" label="No WhatsApp" />
              )}
            </div>

            <FormField
              id="settings-whatsapp-number"
              label="WhatsApp Phone Number (with Country Code)"
              type="tel"
              placeholder="e.g. 923179500901 or 447123456789"
              value={profileWhatsAppNumber}
              onChange={(e) => setProfileWhatsAppNumber(e.target.value)}
              helperText="e.g. 923179500901 or 447123456789 (Used for automated task assignment alerts)"
            />

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <Button
                type="submit"
                variant="primary"
                icon={Phone}
                isLoading={savingProfile}
              >
                Save WhatsApp Number
              </Button>
            </div>
          </form>
        </div>

        {/* Notification Preferences Card */}
        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <Bell size={18} className="card-title-icon" />
              <h3>Notification & Alert Preferences</h3>
            </div>
            <span className="card-tag">Notifications</span>
          </div>

          <form onSubmit={handleSavePreferences} className="settings-form">
            {/* SMTP Status banner */}
            <div
              className={`smtp-status-banner ${emailChannel.configured ? 'is-active' : 'is-dormant'}`}
            >
              <Mail size={16} />
              <div className="smtp-banner-text">
                <strong>Email Delivery Channel: </strong>
                <span>
                  {emailChannel.configured
                    ? 'SMTP active. Transactional task alerts will be sent to your email.'
                    : 'SMTP credentials unconfigured on server. In-app alerts active; email notifications dormant.'}
                </span>
              </div>
            </div>

            <div className="prefs-toggle-list">
              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.emailNotifications}
                  onChange={() => handlePrefToggle('emailNotifications')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Email Notifications Master Switch</span>
                  <span className="pref-desc">
                    Receive operational email alerts at your registered address.
                  </span>
                </div>
              </label>

              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.taskAssigned}
                  onChange={() => handlePrefToggle('taskAssigned')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Task Assignments & Handoffs</span>
                  <span className="pref-desc">
                    Notify when managers assign or reassign deliverables to your account.
                  </span>
                </div>
              </label>

              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.taskStatusChanged}
                  onChange={() => handlePrefToggle('taskStatusChanged')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Status Transitions & Reviews</span>
                  <span className="pref-desc">
                    Notify when deliverables move to In Review, Done, or Blocked.
                  </span>
                </div>
              </label>

              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.taskDueDate}
                  onChange={() => handlePrefToggle('taskDueDate')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Deadline Adjustments</span>
                  <span className="pref-desc">
                    Notify when a project manager reschedules a task due date.
                  </span>
                </div>
              </label>

              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.taskComments}
                  onChange={() => handlePrefToggle('taskComments')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Discussion & Comments</span>
                  <span className="pref-desc">
                    Notify when discussion notes or updates are added to your deliverables.
                  </span>
                </div>
              </label>

              <label className="pref-toggle-item">
                <input
                  type="checkbox"
                  checked={prefs.overdueReminders}
                  onChange={() => handlePrefToggle('overdueReminders')}
                  className="pref-checkbox"
                />
                <div className="pref-label-group">
                  <span className="pref-title">Overdue & Upcoming Due Reminders</span>
                  <span className="pref-desc">
                    Automated scheduled reminders 24h before due dates and overdue warnings.
                  </span>
                </div>
              </label>
            </div>

            <div className="form-actions">
              <Button
                type="submit"
                variant="primary"
                icon={Save}
                isLoading={savingPrefs}
                disabled={loadingPrefs}
              >
                Save Notification Preferences
              </Button>
            </div>
          </form>
        </div>

        {/* Workspace Preferences Card */}
        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <Settings size={18} className="card-title-icon" />
              <h3>Private Workspace Configuration</h3>
            </div>
            <span className="card-tag">General</span>
          </div>

          <form onSubmit={handleGeneralSave} className="settings-form">
            <FormField
              id="companyName"
              label="Workspace Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              helperText="The workspace name displayed across headers and reports."
              required
            />

            <FormField
              id="workspaceDomain"
              label="Internal Workspace Domain"
              value={workspaceDomain}
              onChange={(e) => setWorkspaceDomain(e.target.value)}
              helperText="Internal subdomain routing used for notifications and workspace links."
            />

            <FormField
              id="timezone"
              label="Default Workspace Timezone"
              as="select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              helperText="Ensures accurate deadline countdowns and scheduled reminders."
            >
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="EST">Eastern Time (US / Canada)</option>
              <option value="CST">Central Time (US / Canada)</option>
              <option value="PST">Pacific Time (US / Canada)</option>
              <option value="GMT">Greenwich Mean Time (London)</option>
              <option value="IST">India Standard Time (IST)</option>
            </FormField>

            <div className="form-actions">
              <Button type="submit" variant="secondary" icon={Save}>
                Save Workspace Defaults
              </Button>
            </div>
          </form>
        </div>

        {/* Infrastructure & Security Diagnostics Card */}
        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <Server size={18} className="card-title-icon" />
              <h3>Infrastructure Diagnostics</h3>
            </div>
            <span className="card-tag">Diagnostic</span>
          </div>

          <div className="settings-diagnostics-list">
            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Express API Health</span>
                <span className="diagnostic-desc">HTTP status code & endpoint response</span>
              </div>
              <StatusBadge
                status={apiStatus?.status === 'healthy' ? 'healthy' : apiStatus?.status === 'degraded' ? 'degraded' : 'offline'}
                label={apiStatus?.status ? apiStatus.status.toUpperCase() : 'CHECKING'}
              />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">MongoDB State</span>
                <span className="diagnostic-desc">Mongoose persistent storage</span>
              </div>
              <StatusBadge
                status={apiStatus?.database?.connected ? 'healthy' : 'offline'}
                label={apiStatus?.database?.connected ? 'CONNECTED' : 'DISCONNECTED'}
              />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Cloudinary Attachment Service</span>
                <span className="diagnostic-desc">Media CDN & bucket integration</span>
              </div>
              <StatusBadge
                status={apiStatus?.services?.cloudinary?.configured ? 'healthy' : 'pending'}
                label={apiStatus?.services?.cloudinary?.configured ? 'CONFIGURED' : 'PENDING'}
              />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">SMTP Email Transport</span>
                <span className="diagnostic-desc">Transactional mail delivery</span>
              </div>
              <StatusBadge
                status={emailChannel.configured ? 'healthy' : 'pending'}
                label={emailChannel.configured ? 'CONFIGURED' : 'UNCONFIGURED'}
              />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Real-Time WebSocket Engine</span>
                <span className="diagnostic-desc">Socket.IO authenticated push alerts</span>
              </div>
              <StatusBadge status="healthy" label="ACTIVE" />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Scheduled Background Worker</span>
                <span className="diagnostic-desc">Node-cron recurring deadline processor</span>
              </div>
              <StatusBadge status="healthy" label="ENABLED" />
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default SettingsPage;

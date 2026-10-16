import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import FormField from '../components/ui/FormField';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import { notificationService } from '../services/notificationService';
import { whatsappService } from '../services/whatsappService';
import { userService } from '../services/userService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import Modal from '../components/ui/Modal';
import {
  Settings,
  Save,
  Server,
  Bell,
  Mail,
  User as UserIcon,
  Phone,
  RefreshCw,
  Send,
  Users,
  Info,
  Sparkles,
  Play,
  Pause,
  FlaskConical,
  CheckCircle2,
  AlertCircle
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
  const [whatsappDiagnostics, setWhatsAppDiagnostics] = useState(null);
  const [whatsappDiagnosticsError, setWhatsAppDiagnosticsError] = useState('');
  const [testWhatsAppNumber, setTestWhatsAppNumber] = useState('');
  const [testRecipientConsented, setTestRecipientConsented] = useState(false);
  const [sendingTestWhatsApp, setSendingTestWhatsApp] = useState(false);

  // WhatsApp Groups Monitoring State
  const [monitoredGroups, setMonitoredGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [togglingJid, setTogglingJid] = useState(null);

  const fetchGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const res = await whatsappService.getGroups();
      setMonitoredGroups(res.data?.groups || []);
    } catch {
      // Best effort
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleToggleGroupMonitoring = async (group) => {
    setTogglingJid(group.groupJid);
    try {
      const res = await whatsappService.toggleMonitoredGroup({
        groupJid: group.groupJid,
        groupName: group.groupName,
        isMonitored: !group.isMonitored,
        participantCount: group.participantCount
      });
      toast.success(res.message || 'Group monitoring updated.');
      setMonitoredGroups((prev) =>
        prev.map((g) =>
          g.groupJid === group.groupJid ? { ...g, isMonitored: !group.isMonitored } : g
        )
      );
    } catch (err) {
      toast.error(err.message || 'Failed to update group monitoring.');
    } finally {
      setTogglingJid(null);
    }
  };

  const handleTogglePause = async (group) => {
    setTogglingJid(group.groupJid);
    try {
      const res = await whatsappService.toggleMonitoredGroup({
        groupJid: group.groupJid,
        groupName: group.groupName,
        isMonitored: group.isMonitored,
        isPaused: !group.isPaused,
        participantCount: group.participantCount
      });
      toast.success(res.message || 'Group status updated.');
      setMonitoredGroups((prev) =>
        prev.map((g) =>
          g.groupJid === group.groupJid ? { ...g, isPaused: !g.isPaused } : g
        )
      );
    } catch (err) {
      toast.error(err.message || 'Failed to update group pause status.');
    } finally {
      setTogglingJid(null);
    }
  };

  // Gemini Test State
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState(null);

  // Sample Message Test State
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [sampleMessageText, setSampleMessageText] = useState(
    'Rizwan, please update the UK property expense tracker and finish the service charge report by tomorrow.'
  );
  const [sampleSenderName, setSampleSenderName] = useState('Manager');
  const [sampleResult, setSampleResult] = useState(null);
  const [testingSample, setTestingSample] = useState(false);

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const res = await whatsappService.testGemini();
      setGeminiTestResult({ success: true, data: res.data });
      toast.success(res.message || 'Google Gemini API is reachable and responding.');
    } catch (err) {
      setGeminiTestResult({ success: false, error: err.message || 'Gemini connectivity failed.' });
      toast.error(err.message || 'Failed to connect to Google Gemini API.');
    } finally {
      setTestingGemini(false);
    }
  };

  const handleRunSampleAnalysis = async (e) => {
    if (e) e.preventDefault();
    if (!sampleMessageText.trim()) return;
    setTestingSample(true);
    setSampleResult(null);
    try {
      const res = await whatsappService.testSampleMessage({
        sampleMessage: sampleMessageText.trim(),
        senderName: sampleSenderName.trim()
      });
      setSampleResult(res.data);
      toast.success('Sample message analyzed with Gemini!');
    } catch (err) {
      toast.error(err.message || 'Failed to analyze sample message.');
    } finally {
      setTestingSample(false);
    }
  };

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

  const fetchWhatsAppDiagnostics = useCallback(async () => {
    try {
      const response = await whatsappService.getDiagnostics();
      setWhatsAppDiagnostics(response.data?.diagnostics || null);
      setWhatsAppDiagnosticsError('');
    } catch (error) {
      setWhatsAppDiagnosticsError(error.message || 'WhatsApp diagnostics are unavailable.');
    }
  }, []);

  useEffect(() => {
    const initialFetch = setTimeout(fetchWhatsAppDiagnostics, 0);
    const timer = setInterval(fetchWhatsAppDiagnostics, 10_000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(timer);
    };
  }, [fetchWhatsAppDiagnostics]);

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

  const handleSendTestWhatsApp = async (e) => {
    e.preventDefault();
    setSendingTestWhatsApp(true);
    try {
      await whatsappService.sendTestMessage(testWhatsAppNumber.trim());
      toast.success('Test message was accepted by Baileys.');
      await fetchWhatsAppDiagnostics();
    } catch (error) {
      toast.error(error.message || 'Could not send the WhatsApp test message.');
    } finally {
      setSendingTestWhatsApp(false);
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

        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <Phone size={18} className="card-title-icon" />
              <h3>WhatsApp Assignment Sender</h3>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={fetchWhatsAppDiagnostics}
            >
              Refresh
            </Button>
          </div>

          <div className="settings-diagnostics-list">
            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">WhatsApp Provider</span>
                <span className="diagnostic-desc">{whatsappDiagnostics?.provider || 'Baileys (WhatsApp Web Multi-Device)'}</span>
              </div>
              <StatusBadge
                status={whatsappDiagnostics?.connectionStatus === 'connected' ? 'healthy' :
                  whatsappDiagnostics?.connectionStatus === 'connecting' ? 'degraded' : 'offline'}
                label={whatsappDiagnostics?.connectionStatus?.toUpperCase() || 'DISCONNECTED'}
              />
            </div>
            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Sending Capability</span>
                <span className="diagnostic-desc">Paired Baileys session authorization status</span>
              </div>
              <StatusBadge
                status={whatsappDiagnostics?.authenticationValid ? 'healthy' : 'offline'}
                label={whatsappDiagnostics?.authenticationValid ? 'VALID' : 'NOT READY'}
              />
            </div>
            <p className="text-sm text-muted">
              <strong>Last connection:</strong>{' '}
              {whatsappDiagnostics?.lastConnectionAt
                ? new Date(whatsappDiagnostics.lastConnectionAt).toLocaleString()
                : 'No connection established since this server started'}
            </p>
            <p className="text-sm text-muted">
              <strong>Last successful send:</strong>{' '}
              {whatsappDiagnostics?.lastSuccessfulSendAt
                ? new Date(whatsappDiagnostics.lastSuccessfulSendAt).toLocaleString()
                : 'No successful sends recorded'}
            </p>
            {whatsappDiagnostics?.hostingCompatibilityMessage && (
              <p className="text-danger" role="status">
                <strong>Hosting requirement:</strong> {whatsappDiagnostics.hostingCompatibilityMessage}
              </p>
            )}
            {(whatsappDiagnosticsError || whatsappDiagnostics?.lastError) && (
              <p className="text-danger" role="status">
                <strong>Error:</strong> {whatsappDiagnosticsError || whatsappDiagnostics.lastError}
              </p>
            )}
          </div>

          <form onSubmit={handleSendTestWhatsApp} className="settings-form">
            <FormField
              id="whatsapp-test-number"
              label="Consenting test recipient"
              type="tel"
              placeholder="e.g. +923179500901"
              value={testWhatsAppNumber}
              onChange={(event) => setTestWhatsAppNumber(event.target.value)}
              required
            />
            <label className="pref-toggle-item">
              <input
                type="checkbox"
                checked={testRecipientConsented}
                onChange={(event) => setTestRecipientConsented(event.target.checked)}
                className="pref-checkbox"
              />
              <span className="pref-label-group">
                <span className="pref-title">The recipient agreed to receive this test message.</span>
              </span>
            </label>
            <Button
              type="submit"
              variant="primary"
              icon={Send}
              isLoading={sendingTestWhatsApp}
              disabled={
                !testRecipientConsented ||
                !testWhatsAppNumber.trim() ||
                whatsappDiagnostics?.sendingCapabilityStatus !== 'ready'
              }
            >
              Send Test Message
            </Button>
            {whatsappDiagnostics?.sendingCapabilityStatus !== 'ready' && (
              <p className="text-muted" role="status">
                Connect the Baileys account on the always-on backend before sending a test message.
              </p>
            )}
            <p className="text-muted">
              “Sent” means Baileys accepted the message. WhatsApp delivery confirmation is shown separately.
            </p>
          </form>
        </div>

        {/* WhatsApp Task Capture & Group Monitoring Card */}
        <div className="settings-card">
          <div className="card-header">
            <div className="card-header-title">
              <Users size={18} className="card-title-icon" />
              <h3>WhatsApp Task Capture (Group Monitoring)</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                size="small"
                icon={Sparkles}
                onClick={handleTestGemini}
                isLoading={testingGemini}
              >
                Test Gemini API
              </Button>
              <Button
                variant="secondary"
                size="small"
                icon={FlaskConical}
                onClick={() => setSampleModalOpen(true)}
              >
                Test Sample Message
              </Button>
              <Button
                variant="secondary"
                size="small"
                icon={RefreshCw}
                onClick={fetchGroups}
                isLoading={loadingGroups}
              >
                Refresh Groups
              </Button>
            </div>
          </div>

          <p className="card-description">
            Select WhatsApp groups to actively monitor for task instructions. When incoming work messages are detected, the system will prepare drafts for your review in the <strong>WhatsApp Task Inbox</strong>. Tasks are never created without your explicit approval.
          </p>

          {geminiTestResult && (
            <div
              style={{
                background: geminiTestResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${geminiTestResult.success ? '#bbf7d0' : '#fecaca'}`,
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                fontSize: '0.875rem',
                color: geminiTestResult.success ? '#166534' : '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {geminiTestResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <div style={{ flex: 1 }}>
                <strong>{geminiTestResult.success ? 'Gemini API Connected:' : 'Gemini API Error:'}</strong>{' '}
                {geminiTestResult.success
                  ? `Model responded successfully (${geminiTestResult.data?.model || 'gemini-2.5-flash'}) with latency ${geminiTestResult.data?.latencyMs || 0}ms.`
                  : (geminiTestResult.error || 'Failed to connect')}
              </div>
              <button
                type="button"
                onClick={() => setGeminiTestResult(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold' }}
              >
                ×
              </button>
            </div>
          )}

          <div
            style={{
              background: 'var(--bg-subtle, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '8px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#475569',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-start'
            }}
          >
            <Info size={16} style={{ marginTop: '2px', flexShrink: 0, color: '#3b82f6' }} />
            <div>
              <strong>Baileys Connection Notice & Limitations:</strong> Incoming messages are captured in real-time while the server connection is connected. Messages sent prior to enabling or while offline cannot be guaranteed without full session sync. Message edits or ephemeral timer changes follow standard WhatsApp multi-device behavior.
            </div>
          </div>

          {loadingGroups ? (
            <p className="text-muted">Discovering WhatsApp groups from active session...</p>
          ) : monitoredGroups.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', background: 'var(--bg-subtle, #f8fafc)', borderRadius: '8px' }}>
              <p className="text-muted" style={{ margin: 0 }}>
                No groups found. Ensure your WhatsApp account is paired, connected, and belongs to at least one group chat.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Group Name</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Group JID</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Members</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Last Activity</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Monitoring Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {monitoredGroups.map((group) => {
                    const isToggling = togglingJid === group.groupJid;
                    return (
                      <tr key={group.groupJid} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500 }}>
                          {group.groupName}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', color: '#64748b', fontSize: '0.8rem' }}>
                          {group.groupJid}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#64748b' }}>
                          {group.participantCount || 0}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
                          {group.lastMessageAt ? new Date(group.lastMessageAt).toLocaleString() : 'No messages yet'}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: !group.isMonitored
                                ? '#f1f5f9'
                                : group.isPaused
                                  ? '#fef3c7'
                                  : '#dcfce7',
                              color: !group.isMonitored
                                ? '#64748b'
                                : group.isPaused
                                  ? '#b45309'
                                  : '#15803d'
                            }}
                          >
                            {!group.isMonitored
                              ? 'DISABLED'
                              : group.isPaused
                                ? 'PAUSED'
                                : 'ACTIVE'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                            {group.isMonitored && (
                              <button
                                type="button"
                                onClick={() => handleTogglePause(group)}
                                disabled={isToggling}
                                title={group.isPaused ? 'Resume monitoring' : 'Pause monitoring'}
                                style={{
                                  padding: '0.25rem 0.6rem',
                                  borderRadius: '4px',
                                  border: '1px solid #cbd5e1',
                                  background: '#ffffff',
                                  cursor: isToggling ? 'not-allowed' : 'pointer',
                                  fontSize: '0.75rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#334155'
                                }}
                              >
                                {group.isPaused ? <Play size={12} /> : <Pause size={12} />}
                                {group.isPaused ? 'Resume' : 'Pause'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggleGroupMonitoring(group)}
                              disabled={isToggling}
                              style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '20px',
                                border: 'none',
                                cursor: isToggling ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                fontSize: '0.75rem',
                                background: group.isMonitored ? '#ef4444' : '#16a34a',
                                color: '#ffffff',
                                transition: 'all 0.2s'
                              }}
                            >
                              {isToggling
                                ? 'Saving...'
                                : group.isMonitored
                                  ? 'DISABLE'
                                  : 'ENABLE'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">WhatsApp Assignment Dispatcher</span>
                <span className="diagnostic-desc">Baileys multi-device notification sender</span>
              </div>
              <StatusBadge
                status={whatsappDiagnostics?.connectionStatus === 'connected' ? 'healthy' :
                  whatsappDiagnostics?.connectionStatus === 'connecting' ? 'degraded' : 'offline'}
                label={whatsappDiagnostics?.connectionStatus?.toUpperCase() || 'DISCONNECTED'}
              />
            </div>

            <div className="diagnostic-row">
              <div className="diagnostic-label-col">
                <span className="diagnostic-title">Google Gemini AI Engine</span>
                <span className="diagnostic-desc">REST generateContent model pipeline</span>
              </div>
              <StatusBadge
                status={geminiTestResult?.success ? 'healthy' : 'pending'}
                label={geminiTestResult?.success ? 'ONLINE' : 'CONFIGURED'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sample Message Test Modal */}
      <Modal
        isOpen={sampleModalOpen}
        onClose={() => setSampleModalOpen(false)}
        title="Test WhatsApp Group Message Analysis (Gemini)"
        maxWidth="650px"
      >
        <form onSubmit={handleRunSampleAnalysis} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
            Enter a sample WhatsApp group message to test Gemini AI's real-time structured task extraction before processing live incoming messages.
          </p>

          <FormField
            id="sample-sender-name"
            label="Sender Name"
            type="text"
            value={sampleSenderName}
            onChange={(e) => setSampleSenderName(e.target.value)}
            placeholder="e.g. Manager"
            required
          />

          <div>
            <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
              WhatsApp Message Content *
            </label>
            <textarea
              className="form-input"
              rows={4}
              value={sampleMessageText}
              onChange={(e) => setSampleMessageText(e.target.value)}
              placeholder="e.g. Rizwan, please update the UK property expense tracker and finish the service charge report by tomorrow."
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontFamily: 'inherit',
                fontSize: '0.875rem'
              }}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSampleModalOpen(false)}
              disabled={testingSample}
            >
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon={Sparkles}
              isLoading={testingSample}
            >
              Analyze with Gemini
            </Button>
          </div>
        </form>

        {sampleResult && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem',
              background: 'var(--bg-subtle, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '8px',
              fontSize: '0.875rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>Gemini AI Extraction Output</span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: sampleResult.isTask ? '#dcfce7' : '#fee2e2',
                  color: sampleResult.isTask ? '#15803d' : '#b91c1c'
                }}
              >
                {sampleResult.isTask ? 'TASK DETECTED' : 'NOT A TASK'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div><strong>Confidence:</strong> {Math.round((sampleResult.confidence || 0) * 100)}%</div>
              <div><strong>Priority:</strong> {sampleResult.priority || 'Medium'}</div>
              <div><strong>Candidate Assignee:</strong> {sampleResult.assigneeName || 'None'}</div>
              <div><strong>Due Date:</strong> {sampleResult.dueDate ? new Date(sampleResult.dueDate).toLocaleDateString() : 'None'}</div>
            </div>

            {sampleResult.title && (
              <div style={{ marginTop: '0.5rem' }}>
                <strong>Generated Title:</strong>
                <p style={{ margin: '0.25rem 0 0', color: '#1e293b', fontWeight: 500 }}>{sampleResult.title}</p>
              </div>
            )}

            {sampleResult.description && (
              <div style={{ marginTop: '0.5rem' }}>
                <strong>Description:</strong>
                <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>{sampleResult.description}</p>
              </div>
            )}

            {sampleResult.reason && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                <strong>Reasoning:</strong> {sampleResult.reason}
              </div>
            )}

            {sampleResult.modelUsed && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                Model: <code>{sampleResult.modelUsed}</code>
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default SettingsPage;

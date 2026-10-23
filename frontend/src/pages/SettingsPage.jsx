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
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  QrCode
} from 'lucide-react';

const SETTINGS_TABS = [
  { id: 'whatsapp', label: 'WhatsApp & QR Pairing', icon: Phone },
  { id: 'groups', label: 'Monitored Groups', icon: Users },
  { id: 'ai', label: 'Gemini AI Intelligence', icon: Sparkles },
  { id: 'notifications', label: 'Notification Preferences', icon: Bell },
  { id: 'general', label: 'Workspace & Infrastructure', icon: Settings }
];

export const SettingsPage = () => {
  const { apiStatus } = useOutletContext() || {};
  const { user, checkSession, isAdmin } = useAuth();
  const { toast } = useToast();

  const [activeSettingsTab, setActiveSettingsTab] = useState('whatsapp');

  const [companyName, setCompanyName] = useState('PixxTechnologiees');
  const [workspaceDomain, setWorkspaceDomain] = useState('internal.pixxtechnologiees.com');
  const [timezone, setTimezone] = useState('UTC');

  // User Profile & WhatsApp state
  const [profileWhatsAppNumber, setProfileWhatsAppNumber] = useState(user?.whatsappNumber || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [whatsappDiagnostics, setWhatsAppDiagnostics] = useState(() => {
    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem('wa_diag_cache') : null;
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [whatsappDiagnosticsError, setWhatsAppDiagnosticsError] = useState('');
  const [whatsappDiagnosticsErrorStatus, setWhatsAppDiagnosticsErrorStatus] = useState(null);
  const [testWhatsAppNumber, setTestWhatsAppNumber] = useState('');
  const [testRecipientConsented, setTestRecipientConsented] = useState(false);
  const [sendingTestWhatsApp, setSendingTestWhatsApp] = useState(false);
  const [reconnectingWhatsApp, setReconnectingWhatsApp] = useState(false);
  const [resetPreview, setResetPreview] = useState(null);
  const [showHistoryResetModal, setShowHistoryResetModal] = useState(false);
  const [loadingHistoryResetPreview, setLoadingHistoryResetPreview] = useState(false);
  const [confirmHistoryReset, setConfirmHistoryReset] = useState(false);
  const [resettingWhatsAppHistory, setResettingWhatsAppHistory] = useState(false);

  // WhatsApp Groups Monitoring State
  const [monitoredGroups, setMonitoredGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [togglingJid, setTogglingJid] = useState(null);

  // Gemini AI Test State
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState(null);
  const [sampleMessageText, setSampleMessageText] = useState(
    'Rizwan, please update the UK property expense tracker and finish the service charge report by tomorrow.'
  );
  const [sampleSenderName, setSampleSenderName] = useState('Manager');
  const [testingSample, setTestingSample] = useState(false);
  const [sampleResult, setSampleResult] = useState(null);

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

  const handleToggleGroupPause = async (group) => {
    setTogglingJid(group.groupJid);
    try {
      const res = await whatsappService.toggleMonitoredGroup({
        groupJid: group.groupJid,
        groupName: group.groupName,
        isPaused: !group.isPaused,
        isMonitored: group.isMonitored,
        participantCount: group.participantCount
      });
      toast.success(res.message || 'Group state updated.');
      setMonitoredGroups((prev) =>
        prev.map((g) =>
          g.groupJid === group.groupJid ? { ...g, isPaused: !group.isPaused } : g
        )
      );
    } catch (err) {
      toast.error(err.message || 'Failed to update group pause state.');
    } finally {
      setTogglingJid(null);
    }
  };

  const handleTestGemini = async () => {
    setTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const res = await whatsappService.testGeminiConnectivity();
      setGeminiTestResult(res);
      toast.success(res.message || 'Gemini API is connected and responding.');
    } catch (err) {
      setGeminiTestResult({
        success: false,
        error: err.message || 'Gemini connectivity test failed.'
      });
      toast.error(err.message || 'Failed to connect to Gemini API.');
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
      const raw = res.data || {};
      const extraction = raw.extraction || raw;
      setSampleResult({
        ...extraction,
        provider: raw.provider || extraction.modelUsed || 'heuristic',
        modelUsed: extraction.modelUsed || raw.provider || 'heuristic'
      });
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
      const diag = response.data?.diagnostics || null;
      setWhatsAppDiagnostics(diag);
      if (diag && typeof window !== 'undefined') {
        try { sessionStorage.setItem('wa_diag_cache', JSON.stringify(diag)); } catch {}
      }
      setWhatsAppDiagnosticsError('');
      setWhatsAppDiagnosticsErrorStatus(null);
    } catch (error) {
      setWhatsAppDiagnostics(null);
      setWhatsAppDiagnosticsError(error.message || 'WhatsApp diagnostics are unavailable.');
      setWhatsAppDiagnosticsErrorStatus(error.status || null);
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

  const handleReconnectWhatsApp = async () => {
    setReconnectingWhatsApp(true);
    try {
      let response;
      try {
        response = await whatsappService.reconnect();
      } catch (err) {
        if (err.status === 409) {
          response = err.data;
        } else {
          throw err;
        }
      }
      if (response?.data?.rePairConfirmationRequired) {
        const confirmed = window.confirm(
          'Reconnecting requires creating a fresh session backup. Do you want to proceed and generate a new pairing QR code?'
        );
        if (confirmed) {
          const forceRes = await whatsappService.reconnect(true);
          toast.success(forceRes.message || 'Fresh QR code generated. Please scan to link device.');
        } else {
          toast.info('Reconnect cancelled. Existing session was preserved.');
        }
      } else {
        toast.success(response?.message || 'WhatsApp reconnect signal dispatched.');
      }
      await fetchWhatsAppDiagnostics();
    } catch (error) {
      toast.error(error.message || 'Failed to dispatch WhatsApp reconnect signal.');
    } finally {
      setReconnectingWhatsApp(false);
    }
  };

  const handleForceRePairWhatsApp = async () => {
    const confirmed = window.confirm(
      'This will back up the current session and generate a brand-new WhatsApp pairing QR code. Are you sure you want to re-pair?'
    );
    if (!confirmed) return;
    setReconnectingWhatsApp(true);
    try {
      const forceRes = await whatsappService.reconnect(true);
      toast.success(forceRes.message || 'Fresh QR code generated. Please scan to link your WhatsApp.');
      await fetchWhatsAppDiagnostics();
    } catch (error) {
      toast.error(error.message || 'Failed to generate new pairing QR code.');
    } finally {
      setReconnectingWhatsApp(false);
    }
  };

  const handleOpenHistoryReset = async () => {
    setLoadingHistoryResetPreview(true);
    try {
      const response = await whatsappService.getHistoryResetPreview();
      const preview = response.data?.preview;
      if (!preview || typeof preview.tasks !== 'number' || typeof preview.drafts !== 'number') {
        throw new Error('WhatsApp reset preview returned invalid task or draft counts.');
      }
      setResetPreview(preview);
      setConfirmHistoryReset(false);
      setShowHistoryResetModal(true);
    } catch (error) {
      toast.error(error.message || 'Could not load WhatsApp task and draft counts.');
    } finally {
      setLoadingHistoryResetPreview(false);
    }
  };

  const handleResetWhatsAppHistory = async () => {
    if (!confirmHistoryReset) return;
    setResettingWhatsAppHistory(true);
    try {
      const response = await whatsappService.resetHistory(resetPreview);
      setShowHistoryResetModal(false);
      setConfirmHistoryReset(false);
      toast.success(response.message || 'WhatsApp history cleared; processing is starting fresh.');
      await Promise.all([fetchGroups(), fetchWhatsAppDiagnostics()]);
    } catch (error) {
      if (error.status === 409) {
        const updatedPreview = error.data?.data?.preview;
        if (updatedPreview) setResetPreview(updatedPreview);
        setConfirmHistoryReset(false);
      }
      toast.error(error.message || 'Could not reset WhatsApp task history.');
    } finally {
      setResettingWhatsAppHistory(false);
    }
  };

  return (
    <PageContainer
      title="System Settings"
      subtitle="Workspace configuration, notification channels, user profile, and operational defaults."
      badge={<StatusBadge status="active" label="Settings Active" />}
    >
      {/* Sleek Modern Settings Navigation Tabs */}
      <div className="settings-tab-nav" role="tablist">
        {SETTINGS_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSettingsTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`settings-tab-btn ${isActive ? 'is-active' : ''}`}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: WhatsApp Connection & Alerts */}
      {activeSettingsTab === 'whatsapp' && (
        <div className="settings-two-col">
          {/* Card 1: WhatsApp Assignment Sender */}
          <div className="settings-card">
            <div className="card-header">
              <div className="card-header-title">
                <Phone size={18} className="card-title-icon" />
                <h3>WhatsApp Assignment Sender</h3>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  onClick={fetchWhatsAppDiagnostics}
                >
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  isLoading={reconnectingWhatsApp}
                  onClick={handleReconnectWhatsApp}
                >
                  Reconnect
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  icon={QrCode}
                  isLoading={reconnectingWhatsApp}
                  onClick={handleForceRePairWhatsApp}
                  title="Generates a fresh QR code to scan"
                >
                  Scan New QR
                </Button>
              </div>
            </div>

            <div className="settings-diagnostics-list">
              <div className="diagnostic-row">
                <div className="diagnostic-label-col">
                  <span className="diagnostic-title">WhatsApp Provider</span>
                  <span className="diagnostic-desc">{whatsappDiagnostics?.provider || 'Baileys Multi-Device'}</span>
                </div>
                <StatusBadge
                  status={whatsappDiagnosticsError ? 'degraded' :
                    whatsappDiagnostics?.connectionStatus === 'connected' ? 'healthy' :
                    whatsappDiagnostics?.connectionStatus === 'connecting' ||
                    whatsappDiagnostics?.connectionStatus === 'qr_required' ? 'degraded' :
                    !whatsappDiagnostics ? 'degraded' : 'offline'}
                  label={whatsappDiagnosticsError
                    ? whatsappDiagnosticsErrorStatus === 401 ? 'AUTH REQUIRED' : 'UNAVAILABLE'
                    : whatsappDiagnostics?.connectionStatus?.replaceAll('_', ' ').toUpperCase() || 'CONNECTING...'}
                />
              </div>
              <div className="diagnostic-row">
                <div className="diagnostic-label-col">
                  <span className="diagnostic-title">Sending Capability</span>
                  <span className="diagnostic-desc">Persistent Baileys session authorization status</span>
                </div>
                <StatusBadge
                  status={whatsappDiagnosticsError ? 'degraded' : whatsappDiagnostics?.authenticationValid ? 'healthy' : !whatsappDiagnostics ? 'degraded' : 'offline'}
                  label={whatsappDiagnosticsError
                    ? whatsappDiagnosticsErrorStatus === 401 ? 'AUTH REQUIRED' : 'UNAVAILABLE'
                    : whatsappDiagnostics?.authenticationValid ? 'VALID' : !whatsappDiagnostics ? 'CHECKING...' : 'NOT READY'}
                />
              </div>

              {whatsappDiagnostics?.connectedPhoneNumber && (
                <div className="diagnostic-row">
                  <div className="diagnostic-label-col">
                    <span className="diagnostic-title">Connected Number</span>
                    <span className="diagnostic-desc">Active WhatsApp phone account</span>
                  </div>
                  <span style={{ fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                    +{whatsappDiagnostics.connectedPhoneNumber}
                  </span>
                </div>
              )}

              <p className="text-sm text-muted" style={{ margin: '0.25rem 0' }}>
                <strong>Last connection:</strong>{' '}
                {whatsappDiagnostics?.lastConnectionAt
                  ? new Date(whatsappDiagnostics.lastConnectionAt).toLocaleString()
                  : whatsappDiagnostics ? 'Waiting for initial link' : 'Checking status...'}
              </p>

              {whatsappDiagnostics?.qrRequired && (
                <div className="whatsapp-pairing-panel" role="status" style={{ border: '2px dashed #3b82f6', borderRadius: '8px', padding: '1rem', background: '#eff6ff', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 0.5rem', color: '#1e40af' }}>Scan QR with WhatsApp</h4>
                  <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 0.75rem' }}>
                    Open WhatsApp on your phone → Linked devices → Link a device, then scan this code.
                  </p>
                  {whatsappDiagnostics.qrCodeDataUrl ? (
                    <img
                      src={whatsappDiagnostics.qrCodeDataUrl}
                      alt="WhatsApp pairing QR code"
                      width="200"
                      height="200"
                      style={{ display: 'block', margin: '0 auto', maxWidth: '100%', background: 'white', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                    />
                  ) : (
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>Preparing pairing QR code...</p>
                  )}
                </div>
              )}

              {(whatsappDiagnosticsError || whatsappDiagnostics?.lastError) && (
                <p className="text-danger" role="status" style={{ margin: 0 }}>
                  <strong>Error:</strong> {whatsappDiagnosticsError || whatsappDiagnostics.lastError}
                </p>
              )}
            </div>

            {/* Test Message Form */}
            <form onSubmit={handleSendTestWhatsApp} className="settings-form" style={{ borderTop: '1px solid var(--border-light, #e2e8f0)', paddingTop: '1rem' }}>
              <FormField
                id="whatsapp-test-number"
                label="Consenting Test Recipient"
                type="tel"
                placeholder="e.g. 923179500901"
                value={testWhatsAppNumber}
                onChange={(event) => setTestWhatsAppNumber(event.target.value)}
              />
              <label className="pref-toggle-item" style={{ marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={testRecipientConsented}
                  onChange={(event) => setTestRecipientConsented(event.target.checked)}
                  className="pref-checkbox"
                />
                <span className="pref-label-group">
                  <span className="pref-title">Recipient consented to receive this test notification.</span>
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
            </form>
          </div>

          {/* Card 2: User Profile WhatsApp Alerts & History Reset */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="settings-card">
              <div className="card-header">
                <div className="card-header-title">
                  <UserIcon size={18} className="card-title-icon" />
                  <h3>User Profile &amp; WhatsApp Alerts</h3>
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
                  label="Your WhatsApp Number (with Country Code)"
                  type="tel"
                  placeholder="e.g. 923179500901 or 447123456789"
                  value={profileWhatsAppNumber}
                  onChange={(e) => setProfileWhatsAppNumber(e.target.value)}
                  helperText="Used for automated task assignment &amp; deadline alerts dispatched to your personal phone."
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

            {/* Admin Maintenance Card */}
            {isAdmin && (
              <div className="settings-card" style={{ borderColor: '#fecaca' }}>
                <div className="card-header" style={{ background: '#fef2f2' }}>
                  <div className="card-header-title">
                    <RotateCcw size={18} style={{ color: '#dc2626' }} />
                    <h3 style={{ color: '#991b1b' }}>WhatsApp Maintenance &amp; Reset</h3>
                  </div>
                  <span className="card-tag" style={{ background: '#fee2e2', color: '#991b1b' }}>Admin</span>
                </div>
                <div style={{ padding: '1.25rem' }}>
                  <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 1rem' }}>
                    Resetting clears older WhatsApp-imported tasks and drafts, advancing the processing checkpoint so only fresh incoming instructions produce new tasks.
                  </p>
                  <Button
                    type="button"
                    variant="danger"
                    icon={RotateCcw}
                    isLoading={loadingHistoryResetPreview}
                    onClick={handleOpenHistoryReset}
                  >
                    Clear Old WhatsApp Tasks &amp; Start Fresh
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Monitored Groups */}
      {activeSettingsTab === 'groups' && (
        <div className="settings-page-grid">
          <div className="settings-card">
            <div className="card-header">
              <div className="card-header-title">
                <Users size={18} className="card-title-icon" />
                <h3>WhatsApp Task Capture (Group Monitoring)</h3>
              </div>
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

            <div style={{ padding: '1rem 1.5rem 0' }}>
              <p className="card-description" style={{ margin: 0 }}>
                Select WhatsApp groups to monitor. Incoming instructions will create drafts in your <strong>WhatsApp Task Inbox</strong>. Tasks are never added to your project board without your explicit approval.
              </p>

              <div
                style={{
                  background: 'var(--bg-subtle, #f8fafc)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  marginTop: '0.75rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#475569',
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'center'
                }}
              >
                <Info size={16} style={{ flexShrink: 0, color: '#3b82f6' }} />
                <span>
                  <strong>Persistent Connection:</strong> WhatsApp auth is stored in MongoDB Atlas, maintaining connection across server restarts.
                </span>
              </div>
            </div>

            {loadingGroups ? (
              <p className="text-muted" style={{ padding: '1.5rem' }}>Discovering participating WhatsApp groups...</p>
            ) : monitoredGroups.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--bg-subtle, #f8fafc)', margin: '1rem 1.5rem 1.5rem', borderRadius: '8px' }}>
                <p style={{ margin: 0, color: '#64748b' }}>No WhatsApp groups discovered yet. Make sure your WhatsApp account is in at least one group and click "Refresh Groups".</p>
              </div>
            ) : (
              <div style={{ padding: '0 1.5rem 1.5rem', maxHeight: '480px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color, #e2e8f0)', color: '#64748b' }}>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Group Name</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Group JID</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Members</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Last Activity</th>
                      <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                      <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitoredGroups.map((g) => {
                      const isToggling = togglingJid === g.groupJid;
                      const statusVariant = g.isPaused ? 'warning' : g.isMonitored ? 'success' : 'secondary';
                      const statusText = g.isPaused ? 'Paused' : g.isMonitored ? 'Active' : 'Unmonitored';

                      return (
                        <tr key={g.groupJid} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>{g.groupName || 'Unnamed Group'}</td>
                          <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>
                            {g.groupJid}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{g.participantCount || '-'}</td>
                          <td style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
                            {g.lastMessageAt ? new Date(g.lastMessageAt).toLocaleString() : 'No messages'}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>
                            <StatusBadge status={statusVariant} label={statusText} />
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                              <Button
                                size="sm"
                                variant={g.isMonitored ? 'outline-danger' : 'primary'}
                                onClick={() => handleToggleGroupMonitoring(g)}
                                disabled={isToggling}
                              >
                                {g.isMonitored ? 'Unmonitor' : 'Monitor'}
                              </Button>
                              {g.isMonitored && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  icon={g.isPaused ? Play : Pause}
                                  onClick={() => handleToggleGroupPause(g)}
                                  disabled={isToggling}
                                >
                                  {g.isPaused ? 'Resume' : 'Pause'}
                                </Button>
                              )}
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
        </div>
      )}

      {/* Tab 3: Gemini AI Intelligence */}
      {activeSettingsTab === 'ai' && (
        <div className="settings-page-grid">
          <div className="settings-card">
            <div className="card-header">
              <div className="card-header-title">
                <Sparkles size={18} className="card-title-icon" />
                <h3>Google Gemini AI Task Intelligence</h3>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                onClick={handleTestGemini}
                isLoading={testingGemini}
              >
                Test Gemini API
              </Button>
            </div>

            <div style={{ padding: '1.25rem' }}>
              {geminiTestResult && (
                <div
                  style={{
                    background: geminiTestResult.success ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${geminiTestResult.success ? '#bbf7d0' : '#fecaca'}`,
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    marginBottom: '1.25rem',
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
                      ? `Model responded successfully (${geminiTestResult.data?.model || 'gemini-3.5-flash'}) with latency ${geminiTestResult.data?.latencyMs || 0}ms.`
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

              <h4 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#1e293b' }}>
                Interactive Task Analysis Sandbox
              </h4>
              <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 1rem' }}>
                Test how Google Gemini analyzes text and voice note instructions, extracts titles, assignees, deadlines, and filters out casual chit-chat.
              </p>

              <form onSubmit={handleRunSampleAnalysis} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <FormField
                    id="sample-sender-name"
                    label="Sender Name"
                    type="text"
                    value={sampleSenderName}
                    onChange={(e) => setSampleSenderName(e.target.value)}
                    placeholder="e.g. Boss / Client"
                    required
                  />
                </div>

                <div>
                  <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                    WhatsApp Message Text *
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={sampleMessageText}
                    onChange={(e) => setSampleMessageText(e.target.value)}
                    placeholder="e.g. Usman update attendance sheet on Sunday."
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

                <div>
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
                    <span style={{ fontWeight: 600, color: '#334155' }}>
                      Extraction Result ({sampleResult.provider || 'gemini'})
                    </span>
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
                      {sampleResult.isTask ? 'ACTIONABLE TASK DETECTED' : 'CASUAL CHAT / IGNORED'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div><strong>Confidence:</strong> {Math.round((sampleResult.confidence || 0) * 100)}%</div>
                    <div><strong>Priority:</strong> {sampleResult.priority || 'Medium'}</div>
                    <div><strong>Assignee:</strong> {sampleResult.assigneeName || 'None'}</div>
                    <div><strong>Due Date:</strong> {sampleResult.dueDate ? new Date(sampleResult.dueDate).toLocaleDateString() : 'None'}</div>
                  </div>

                  {sampleResult.title && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <strong>Generated Title:</strong>
                      <p style={{ margin: '0.25rem 0 0', color: '#1e293b', fontWeight: 600 }}>{sampleResult.title}</p>
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Notification Preferences */}
      {activeSettingsTab === 'notifications' && (
        <div className="settings-page-grid">
          <div className="settings-card">
            <div className="card-header">
              <div className="card-header-title">
                <Bell size={18} className="card-title-icon" />
                <h3>Notification &amp; Alert Preferences</h3>
              </div>
              <span className="card-tag">Notifications</span>
            </div>

            <form onSubmit={handleSavePreferences} className="settings-form">
              {/* SMTP Status banner */}
              <div
                className={`smtp-status-banner ${emailChannel.configured ? 'is-active' : 'is-dormant'}`}
                style={{ marginBottom: '1.25rem' }}
              >
                <Mail size={16} />
                <div className="smtp-banner-text">
                  <strong>Email Delivery Channel: </strong>
                  <span>
                    {emailChannel.configured
                      ? 'SMTP active. Transactional task alerts are delivered to your registered email.'
                      : 'SMTP credentials unconfigured on server. In-app alerts active; email notifications dormant.'}
                  </span>
                </div>
              </div>

              <div className="prefs-toggle-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
                      Receive operational alerts at your registered address.
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
                    <span className="pref-title">Task Assignments</span>
                    <span className="pref-desc">
                      Notify when tasks are assigned or delegated to you.
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
                    <span className="pref-title">Status Transitions</span>
                    <span className="pref-desc">
                      Notify when deliverables move to Review, Done, or Blocked.
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
                      Notify when a due date or milestone is rescheduled.
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
                    <span className="pref-title">Discussion &amp; Comments</span>
                    <span className="pref-desc">
                      Notify when comments or notes are added to your tasks.
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
                    <span className="pref-title">Overdue &amp; Upcoming Reminders</span>
                    <span className="pref-desc">
                      Scheduled warnings 24h before due dates.
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
        </div>
      )}

      {/* Tab 5: Workspace & Infrastructure */}
      {activeSettingsTab === 'general' && (
        <div className="settings-two-col">
          {/* Card 1: Workspace Preferences */}
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
                helperText="Displayed across headers, reports, and emails."
                required
              />

              <FormField
                id="workspaceDomain"
                label="Internal Workspace Domain"
                value={workspaceDomain}
                onChange={(e) => setWorkspaceDomain(e.target.value)}
                helperText="Subdomain routing used for notification links."
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

              <div className="form-actions" style={{ marginTop: '1rem' }}>
                <Button type="submit" variant="secondary" icon={Save}>
                  Save Workspace Defaults
                </Button>
              </div>
            </form>
          </div>

          {/* Card 2: Infrastructure Diagnostics */}
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
                  <span className="diagnostic-desc">HTTP status code &amp; endpoint response</span>
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
                  <span className="diagnostic-title">Cloudinary Media Service</span>
                  <span className="diagnostic-desc">Voice notes &amp; image storage</span>
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
      )}

      {/* History Reset Confirmation Modal */}
      <Modal
        isOpen={showHistoryResetModal}
        onClose={() => {
          if (!resettingWhatsAppHistory) setShowHistoryResetModal(false);
        }}
        title="Clear Old WhatsApp Tasks & Start Fresh"
        maxWidth="540px"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowHistoryResetModal(false)}
              disabled={resettingWhatsAppHistory}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleResetWhatsAppHistory}
              isLoading={resettingWhatsAppHistory}
              disabled={!confirmHistoryReset}
            >
              Clear and Start Fresh
            </Button>
          </>
        }
      >
        <p>
          This reset will delete <strong>{resetPreview?.tasks ?? 0} WhatsApp-imported task(s)</strong> and{' '}
          <strong>{resetPreview?.drafts ?? 0} WhatsApp draft(s)</strong>, advancing the processing checkpoint so older messages are ignored.
        </p>
        <p className="text-muted">
          Manually created tasks, users, assignments, and linked WhatsApp session remain untouched.
        </p>
        <label className="pref-toggle-item" style={{ marginTop: '1rem' }}>
          <input
            type="checkbox"
            checked={confirmHistoryReset}
            onChange={(event) => setConfirmHistoryReset(event.target.checked)}
            className="pref-checkbox"
          />
          <span className="pref-label-group">
            <span className="pref-title">I understand and want to permanently clear these WhatsApp records.</span>
          </span>
        </label>
      </Modal>
    </PageContainer>
  );
};

export default SettingsPage;

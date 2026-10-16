import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import FormField from '../components/ui/FormField';
import { taskService } from '../services/taskService';
import { projectService } from '../services/projectService';
import { whatsappService } from '../services/whatsappService';
import { socketService } from '../services/socket';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  ListTodo,
  Clock,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Activity,
  PieChart,
  Plus,
  Server,
  Database,
  Cloud,
  Layers,
  Sparkles,
  ArrowRight,
  Users,
  MessageSquare,
  RefreshCw,
  Eye,
  Check,
  XCircle,
  Copy,
  User as UserIcon,
  Bot,
  Play,
  Pause,
  ExternalLink,
  Inbox
} from 'lucide-react';

export const DashboardPage = () => {
  const { apiStatus } = useOutletContext() || {};
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const { toast } = useToast();

  // WhatsApp Groups State
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [togglingJid, setTogglingJid] = useState(null);

  const fetchGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const res = await whatsappService.getGroups();
      setGroups(res.data?.groups || []);
    } catch (err) {
      // Graceful fallback
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  const handleToggleMonitoring = async (group) => {
    setTogglingJid(group.groupJid);
    try {
      const res = await whatsappService.toggleMonitoredGroup({
        groupJid: group.groupJid,
        groupName: group.groupName,
        isMonitored: !group.isMonitored,
        participantCount: group.participantCount
      });
      toast.success(res.message || 'Group monitoring updated.');
      setGroups((prev) =>
        prev.map((g) =>
          g.groupJid === group.groupJid ? { ...g, isMonitored: !g.isMonitored } : g
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
      setGroups((prev) =>
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

  // Pending WhatsApp Drafts State
  const [pendingDrafts, setPendingDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [projects, setProjects] = useState([]);

  const fetchPendingDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const res = await whatsappService.getDrafts({ status: 'awaiting_review', limit: 10 });
      setPendingDrafts(res.data?.drafts || []);
    } catch (err) {
      // Graceful fallback
    } finally {
      setLoadingDrafts(false);
    }
  }, []);

  // Load workspace projects for task assignment
  useEffect(() => {
    projectService
      .getProjects({ limit: 100 })
      .then((res) => setProjects(res.data?.projects || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchPendingDrafts();
  }, [fetchGroups, fetchPendingDrafts]);

  // Review & Approval Modal State
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editPriority, setEditPriority] = useState('Medium');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editAssigneeName, setEditAssigneeName] = useState('');
  const [editAssigneePhone, setEditAssigneePhone] = useState('');

  const handleOpenReview = (draft) => {
    setSelectedDraft(draft);
    setEditTitle(draft.editableFields?.title || draft.aiExtraction?.title || '');
    setEditDescription(
      draft.editableFields?.description !== undefined
        ? draft.editableFields.description
        : draft.aiExtraction?.description || draft.rawMessageText || ''
    );
    setEditProjectId(
      draft.editableFields?.projectId?._id ||
        draft.editableFields?.projectId ||
        draft.aiExtraction?.projectId?._id ||
        draft.aiExtraction?.projectId ||
        (projects.length > 0 ? projects[0]._id : '')
    );
    setEditPriority(
      draft.editableFields?.priority || draft.aiExtraction?.priority || 'Medium'
    );
    setEditStartDate(
      draft.editableFields?.startDate
        ? new Date(draft.editableFields.startDate).toISOString().slice(0, 10)
        : draft.aiExtraction?.startDate
          ? new Date(draft.aiExtraction.startDate).toISOString().slice(0, 10)
          : ''
    );
    setEditDueDate(
      draft.editableFields?.dueDate
        ? new Date(draft.editableFields.dueDate).toISOString().slice(0, 10)
        : draft.aiExtraction?.dueDate
          ? new Date(draft.aiExtraction.dueDate).toISOString().slice(0, 10)
          : ''
    );
    setEditAssigneeName(
      draft.editableFields?.assigneeName || draft.aiExtraction?.assigneeName || ''
    );
    setEditAssigneePhone(
      draft.editableFields?.assigneePhone || draft.aiExtraction?.assigneePhone || ''
    );
    setIsReviewModalOpen(true);
  };

  const handleApprove = async () => {
    if (!editTitle.trim()) {
      toast.error('Task title is required.');
      return;
    }
    if (!editProjectId) {
      toast.error('Please assign this task to a workspace project.');
      return;
    }

    setSubmittingApproval(true);
    try {
      const payload = {
        title: editTitle.trim(),
        description: editDescription.trim(),
        projectId: editProjectId,
        priority: editPriority,
        startDate: editStartDate ? new Date(editStartDate).toISOString() : null,
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
        assigneeName: editAssigneeName.trim(),
        assigneePhone: editAssigneePhone.trim()
      };

      const res = await whatsappService.approveDraft(selectedDraft._id, payload);
      toast.success(res.message || 'Task created successfully from WhatsApp draft!');
      setIsReviewModalOpen(false);
      fetchPendingDrafts();
      fetchStats();
    } catch (err) {
      toast.error(err.message || 'Failed to approve draft and create task.');
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleReject = async () => {
    setSubmittingApproval(true);
    try {
      await whatsappService.rejectDraft(selectedDraft._id);
      toast.info('Draft has been rejected.');
      setIsReviewModalOpen(false);
      fetchPendingDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to reject draft.');
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleCopyMessage = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Original message copied to clipboard.');
  };

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taskService.getDashboardStats();
      setStats(res.data);
    } catch (err) {
      setError(err.message || 'Failed to fetch dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    const socket = socketService.connect();
    if (!socket) return;

    socket.on('task:created', fetchStats);
    socket.on('task:new', fetchStats);
    socket.on('task:updated', fetchStats);
    socket.on('whatsapp:draft_created', () => {
      fetchPendingDrafts();
      fetchStats();
    });

    return () => {
      socket.off('task:created', fetchStats);
      socket.off('task:new', fetchStats);
      socket.off('task:updated', fetchStats);
      socket.off('whatsapp:draft_created');
    };
  }, [fetchStats, fetchPendingDrafts]);

  const metrics = stats?.metrics || {
    totalTasks: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    overdue: 0
  };

  const statusDistribution = stats?.statusDistribution || {};
  const recentActivity = stats?.recentActivity || [];
  const upcomingDeadlines = stats?.upcomingDeadlines || [];

  const summaryCards = [
    {
      title: 'Total Tasks',
      value: metrics.totalTasks,
      icon: ListTodo,
      variant: 'default',
      badgeText: 'Assigned',
      description: metrics.totalTasks === 0 ? 'No tasks created yet' : 'Total active tasks in scope',
      isSetupState: metrics.totalTasks === 0
    },
    {
      title: 'Pending',
      value: metrics.pending,
      icon: Clock,
      variant: 'pending',
      badgeText: 'Backlog / To Do',
      description: 'Tasks waiting to be started',
      isSetupState: metrics.pending === 0
    },
    {
      title: 'In Progress',
      value: metrics.inProgress,
      icon: PlayCircle,
      variant: 'in_progress',
      badgeText: 'Underway',
      description: 'Tasks actively being worked on',
      isSetupState: metrics.inProgress === 0
    },
    {
      title: 'Completed',
      value: metrics.completed,
      icon: CheckCircle2,
      variant: 'completed',
      badgeText: 'Done',
      description: 'Successfully finished deliverables',
      isSetupState: metrics.completed === 0
    },
    {
      title: 'Overdue',
      value: metrics.overdue,
      icon: AlertTriangle,
      variant: 'overdue',
      badgeText: 'Attention',
      description: metrics.overdue > 0 ? 'Urgent attention required' : 'No overdue deliverables',
      isSetupState: metrics.overdue === 0
    }
  ];

  const pageActions = (
    <div className="header-action-group">
      <Button
        variant="outline"
        size="md"
        icon={Server}
        onClick={() => setIsHealthModalOpen(true)}
      >
        System Status
      </Button>
      <Button
        variant="primary"
        size="md"
        icon={Plus}
        onClick={() => navigate('/all-tasks')}
      >
        Manage Tasks
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={`Welcome back, ${user?.name || 'Manager'}`}
      subtitle="Operational workspace overview for your deliverables and projects."
      badge={<StatusBadge status="active" label="Workspace Owner" />}
      actions={pageActions}
    >
      {/* Platform Welcome Banner */}
      <section className="welcome-banner" aria-label="Single-User Workspace Overview Banner">
        <div className="banner-content">
          <div className="banner-badge">
            <Sparkles size={14} className="banner-badge-icon" />
            <span>Single-User Mode • Private Workspace</span>
          </div>
          <h2 className="banner-title">Personal Workspace Operations</h2>
          <p className="banner-text">
            Your private task workspace with real-time tracking, calendar, kanban, and audited deliverables.
          </p>
        </div>
        <div className="banner-meta">
          <div className="banner-stat">
            <span className="banner-stat-label">API Health</span>
            <span className="banner-stat-value">
              <StatusBadge
                status={apiStatus?.status === 'healthy' ? 'healthy' : apiStatus?.status === 'degraded' ? 'degraded' : 'offline'}
              />
            </span>
          </div>
          <div className="banner-stat">
            <span className="banner-stat-label">Active Projects</span>
            <span className="banner-stat-value">{metrics.totalProjects || 0}</span>
          </div>
        </div>
      </section>

      {/* Loading & Error States */}
      {loading && <LoadingState message="Loading live operational metrics..." />}

      {error && (
        <ErrorState
          title="Could not load dashboard data"
          message={error}
          onRetry={fetchStats}
        />
      )}

      {/* KPI Stat Cards Grid */}
      {!loading && !error && (
        <>
          <section className="stats-grid" aria-label="Task Status Summary">
            {summaryCards.map((metric) => (
              <StatCard
                key={metric.title}
                title={metric.title}
                value={metric.value}
                icon={metric.icon}
                variant={metric.variant}
                badgeText={metric.badgeText}
                description={metric.description}
                isSetupState={metric.isSetupState}
              />
            ))}
          </section>

          {/* Dashboard Modules Grid */}
          <section className="dashboard-grid">
            {/* Recent Activity */}
            <div className="dashboard-card recent-activity-card">
              <div className="card-header">
                <div className="card-header-title">
                  <Activity size={18} className="card-title-icon" />
                  <h3>Recent Task Activity</h3>
                </div>
                <span className="card-tag">Live Feed</span>
              </div>
              <div className="card-body">
                {recentActivity.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No Recent Tasks Logged"
                    description="Create projects and assign tasks to view live activity transitions in this feed."
                  />
                ) : (
                  <div className="activity-list">
                    {recentActivity.map((task) => (
                      <div key={task._id} className="activity-item">
                        <div className="activity-meta">
                          <span className="activity-key">{task.taskKey}</span>
                          <span className="activity-title">{task.title}</span>
                        </div>
                        <StatusBadge status={task.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Deadlines */}
            <div className="dashboard-card upcoming-deadlines-card">
              <div className="card-header">
                <div className="card-header-title">
                  <Calendar size={18} className="card-title-icon" />
                  <h3>Upcoming Deadlines</h3>
                </div>
                <span className="card-tag">Timeline</span>
              </div>
              <div className="card-body">
                {upcomingDeadlines.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    title="No Scheduled Deadlines"
                    description="Tasks with target due dates will automatically appear in chronological sequence here."
                  />
                ) : (
                  <div className="deadlines-list">
                    {upcomingDeadlines.map((task) => (
                      <div key={task._id} className="deadline-item">
                        <div className="deadline-left">
                          <span className="deadline-task">{task.title}</span>
                          <span className="deadline-project">{task.project?.name || 'Project'}</span>
                        </div>
                        <span className="deadline-date">
                          {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No date'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Task Status Distribution */}
            <div className="dashboard-card status-distribution-card">
              <div className="card-header">
                <div className="card-header-title">
                  <PieChart size={18} className="card-title-icon" />
                  <h3>Task Status Distribution</h3>
                </div>
                <span className="card-tag">Breakdown</span>
              </div>
              <div className="card-body">
                {metrics.totalTasks === 0 ? (
                  <EmptyState
                    icon={PieChart}
                    title="No Tasks for Distribution"
                    description="Task status distributions will automatically populate as deliverables move through workflow states."
                  />
                ) : (
                  <div className="status-bars-container">
                    {Object.entries(statusDistribution).map(([statusKey, count]) => (
                      <div key={statusKey} className="status-bar-row">
                        <span className="status-bar-label">{statusKey}</span>
                        <div className="status-bar-track">
                          <div
                            className="status-bar-fill"
                            style={{
                              width: `${metrics.totalTasks > 0 ? (count / metrics.totalTasks) * 100 : 0}%`
                            }}
                          />
                        </div>
                        <span className="status-bar-count">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Workspace Navigation & Quick Access */}
            <div className="dashboard-card team-workload-card">
              <div className="card-header">
                <div className="card-header-title">
                  <Layers size={18} className="card-title-icon" />
                  <h3>Workspace Modules</h3>
                </div>
                <span className="card-tag">Quick Jump</span>
              </div>
              <div className="card-body">
                <div className="quick-access-grid">
                  <button
                    type="button"
                    className="quick-access-item"
                    onClick={() => navigate('/my-work')}
                  >
                    <span>My Assigned Work</span>
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="quick-access-item"
                    onClick={() => navigate('/projects')}
                  >
                    <span>Projects Portfolio</span>
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="quick-access-item"
                    onClick={() => navigate('/all-tasks')}
                  >
                    <span>All Tasks Board</span>
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="quick-access-item"
                    onClick={() => navigate('/reports')}
                  >
                    <span>Reports & Analytics</span>
                    <ArrowRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="quick-access-item"
                    onClick={() => navigate('/whatsapp-inbox')}
                  >
                    <span>WhatsApp Task Inbox</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* WhatsApp Groups Monitoring Card */}
            <div className="dashboard-card whatsapp-groups-card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-header">
                <div className="card-header-title">
                  <Users size={18} className="card-title-icon" />
                  <h3>WhatsApp Groups (Group Monitoring)</h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="card-tag">
                    {groups.filter((g) => g.isMonitored).length} Monitored
                  </span>
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
              <div className="card-body" style={{ padding: '1rem' }}>
                <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#64748b' }}>
                  Select existing WhatsApp groups from your connected account to monitor for task instructions. New work requests from monitored groups are automatically analyzed with Gemini AI and prepared as drafts below for your approval.
                </p>

                {loadingGroups ? (
                  <p className="text-muted" style={{ fontSize: '0.875rem' }}>Fetching WhatsApp groups from active session...</p>
                ) : groups.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No WhatsApp Groups Found"
                    description="Ensure your WhatsApp account is paired and connected in Settings, and that your account belongs to at least one group chat."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: '#64748b' }}>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Group Name</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Group JID</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Members</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Last Activity</th>
                          <th style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>Status</th>
                          <th style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>Monitoring Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => {
                          const isToggling = togglingJid === group.groupJid;
                          return (
                            <tr key={group.groupJid} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                              <td style={{ padding: '0.6rem 0.5rem', fontWeight: 500, color: 'var(--text-primary, #0f172a)' }}>
                                {group.groupName}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', fontFamily: 'monospace', color: '#64748b', fontSize: '0.78rem' }}>
                                {group.groupJid}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>
                                {group.participantCount || 0}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
                                {group.lastMessageAt ? new Date(group.lastMessageAt).toLocaleString() : 'No messages yet'}
                              </td>
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>
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
                              <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                                  {group.isMonitored && (
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePause(group)}
                                      disabled={isToggling}
                                      title={group.isPaused ? 'Resume monitoring' : 'Pause monitoring'}
                                      style={{
                                        padding: '0.2rem 0.5rem',
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
                                    onClick={() => handleToggleMonitoring(group)}
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
            </div>

            {/* Pending Task Drafts Card */}
            <div className="dashboard-card pending-drafts-card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-header">
                <div className="card-header-title">
                  <MessageSquare size={18} className="card-title-icon" />
                  <h3>Pending WhatsApp Task Drafts</h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="card-tag">
                    {pendingDrafts.length} Awaiting Approval
                  </span>
                  <Button
                    variant="ghost"
                    size="small"
                    icon={ExternalLink}
                    onClick={() => navigate('/whatsapp-inbox')}
                  >
                    View All in Inbox
                  </Button>
                </div>
              </div>
              <div className="card-body" style={{ padding: '1rem' }}>
                {loadingDrafts ? (
                  <p className="text-muted" style={{ fontSize: '0.875rem' }}>Loading pending task drafts...</p>
                ) : pendingDrafts.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="No Pending Task Drafts"
                    description="When work instructions or tasks are posted in your monitored WhatsApp groups, Gemini AI will automatically extract them and queue drafts here for your approval before creating tasks."
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {pendingDrafts.map((draft) => {
                      const title = draft.editableFields?.title || draft.aiExtraction?.title || draft.rawMessageText?.slice(0, 80) || 'Untitled Task Draft';
                      const priority = draft.editableFields?.priority || draft.aiExtraction?.priority || 'Medium';
                      const dueDate = draft.editableFields?.dueDate || draft.aiExtraction?.dueDate;
                      const assignee = draft.editableFields?.assigneeName || draft.aiExtraction?.assigneeName;
                      const confidence = draft.aiExtraction?.confidence !== undefined ? Math.round(draft.aiExtraction.confidence * 100) : null;

                      return (
                        <div
                          key={draft._id}
                          style={{
                            border: '1px solid var(--border-color, #e2e8f0)',
                            borderRadius: '8px',
                            padding: '0.85rem 1rem',
                            background: '#ffffff',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <StatusBadge status="pending" label="AWAITING REVIEW" />
                              {confidence !== null && (
                                <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#475569' }}>
                                  <Sparkles size={11} color="#f59e0b" />
                                  {confidence}% AI confidence
                                </span>
                              )}
                              {draft.aiExtraction?.modelUsed && (
                                <span style={{ fontSize: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#64748b' }}>
                                  <Bot size={11} color="#6366f1" />
                                  {draft.aiExtraction.modelUsed}
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              {draft.groupName || 'WhatsApp Group'} &bull; {draft.senderName || draft.senderJid} &bull; {new Date(draft.messageTimestamp).toLocaleString()}
                            </span>
                          </div>

                          <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                            {title}
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', padding: '2px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e' }}>
                              ⚡ {priority}
                            </span>
                            {dueDate && (
                              <span style={{ fontSize: '0.8rem', padding: '2px 6px', borderRadius: '4px', background: '#f3e8ff', color: '#6b21a8' }}>
                                📅 Due: {new Date(dueDate).toLocaleDateString()}
                              </span>
                            )}
                            {assignee && (
                              <span style={{ fontSize: '0.8rem', padding: '2px 6px', borderRadius: '4px', background: '#ecfdf5', color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <UserIcon size={11} /> Assignee: {assignee}
                              </span>
                            )}
                          </div>

                          <div style={{ background: 'var(--bg-subtle, #f8fafc)', borderLeft: '3px solid #3b82f6', padding: '0.4rem 0.6rem', borderRadius: '0 4px 4px 0', fontSize: '0.825rem', color: '#475569', fontFamily: 'monospace' }}>
                            {draft.rawMessageText}
                          </div>

                          {draft.aiExtraction?.reason && (
                            <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Sparkles size={11} color="#f59e0b" />
                              <span><strong>Reasoning:</strong> {draft.aiExtraction.reason}</span>
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                            <Button
                              variant="primary"
                              size="small"
                              icon={Eye}
                              onClick={() => handleOpenReview(draft)}
                            >
                              Review & Approve
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* System Status Modal */}
      <Modal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
        title="System Architecture & Health"
        footer={
          <Button variant="primary" onClick={() => setIsHealthModalOpen(false)}>
            Close Overview
          </Button>
        }
      >
        <div className="system-health-modal-body">
          <p className="health-modal-intro">
            Live infrastructure diagnostics for the PixxTechnologiees Task Manager backend.
          </p>

          <div className="health-spec-list">
            <div className="health-spec-item">
              <div className="spec-item-left">
                <Server size={18} className="spec-icon" />
                <div>
                  <strong>Backend API</strong>
                  <p className="spec-sub">Express server on Node.js</p>
                </div>
              </div>
              <StatusBadge
                status={apiStatus?.status === 'healthy' ? 'healthy' : apiStatus?.status === 'degraded' ? 'degraded' : 'offline'}
                label={apiStatus?.status ? apiStatus.status.toUpperCase() : 'CHECKING'}
              />
            </div>

            <div className="health-spec-item">
              <div className="spec-item-left">
                <Database size={18} className="spec-icon" />
                <div>
                  <strong>MongoDB Database</strong>
                  <p className="spec-sub">Mongoose ODM driver</p>
                </div>
              </div>
              <StatusBadge
                status={apiStatus?.database?.connected ? 'healthy' : 'offline'}
                label={apiStatus?.database?.connected ? 'CONNECTED' : 'DISCONNECTED'}
              />
            </div>

            <div className="health-spec-item">
              <div className="spec-item-left">
                <Cloud size={18} className="spec-icon" />
                <div>
                  <strong>Cloudinary Storage</strong>
                  <p className="spec-sub">Secure image & attachment backend service</p>
                </div>
              </div>
              <StatusBadge
                status={apiStatus?.services?.cloudinary?.configured ? 'healthy' : 'pending'}
                label={apiStatus?.services?.cloudinary?.configured ? 'READY' : 'PENDING CREDENTIALS'}
              />
            </div>

            <div className="health-spec-item">
              <div className="spec-item-left">
                <Layers size={18} className="spec-icon" />
                <div>
                  <strong>Environment</strong>
                  <p className="spec-sub">Runtime execution environment</p>
                </div>
              </div>
              <span className="env-pill">{apiStatus?.environment || 'development'}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Review & Approval Modal */}
      {selectedDraft && (
        <Modal
          isOpen={isReviewModalOpen}
          onClose={() => !submittingApproval && setIsReviewModalOpen(false)}
          title="Review & Approve Task Draft"
          maxWidth="700px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Original WhatsApp Message Callout */}
            <div
              style={{
                background: 'var(--bg-subtle, #f8fafc)',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '8px',
                padding: '0.75rem 1rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <MessageSquare size={14} />
                  ORIGINAL WHATSAPP MESSAGE
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  icon={Copy}
                  onClick={() => handleCopyMessage(selectedDraft.rawMessageText)}
                >
                  Copy
                </Button>
              </div>

              <div
                style={{
                  fontSize: '0.875rem',
                  color: '#1e293b',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '120px',
                  overflowY: 'auto'
                }}
              >
                {selectedDraft.rawMessageText}
              </div>

              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
                From: <strong>{selectedDraft.senderName || selectedDraft.senderJid}</strong> in{' '}
                <strong>{selectedDraft.groupName || selectedDraft.groupJid}</strong> &bull;{' '}
                {new Date(selectedDraft.messageTimestamp).toLocaleString()}
              </div>
            </div>

            {/* Missing Info Warning */}
            {selectedDraft.aiExtraction?.missingInformation?.length > 0 && (
              <div
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '6px',
                  padding: '0.75rem',
                  fontSize: '0.85rem',
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem'
                }}
              >
                <AlertTriangle size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <strong>Missing details flagged by AI:</strong>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                    {selectedDraft.aiExtraction.missingInformation.map((m, idx) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* AI Reasoning Callout */}
            {selectedDraft.aiExtraction?.reason && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.825rem',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <Bot size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                <div>
                  <strong>Gemini AI Reasoning ({selectedDraft.aiExtraction?.modelUsed || 'gemini-2.5-flash'}):</strong>{' '}
                  {selectedDraft.aiExtraction.reason}
                </div>
              </div>
            )}

            {/* Editable Fields Form */}
            <FormField
              id="edit-draft-title"
              label="Task Title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="e.g. Update UK property expense tracker"
              required
            />

            <FormField
              id="edit-draft-desc"
              label="Task Description"
              as="textarea"
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Detailed instructions..."
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                  Project *
                </label>
                <select
                  className="form-input"
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #cbd5e1)'
                  }}
                  required
                >
                  <option value="">Select Target Project</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                  Priority
                </label>
                <select
                  className="form-input"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #cbd5e1)'
                  }}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField
                id="edit-draft-start"
                label="Start Date"
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
              />

              <FormField
                id="edit-draft-due"
                label="Due Date"
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                helperText={selectedDraft.aiExtraction?.dateInterpretation || ''}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FormField
                id="edit-draft-assignee-name"
                label="Assignee Name"
                value={editAssigneeName}
                onChange={(e) => setEditAssigneeName(e.target.value)}
                placeholder="e.g. Rizwan"
                helperText="Matched against workspace users or contacts"
              />

              <FormField
                id="edit-draft-assignee-phone"
                label="Assignee WhatsApp Phone"
                type="tel"
                value={editAssigneePhone}
                onChange={(e) => setEditAssigneePhone(e.target.value)}
                placeholder="e.g. +447123456789"
                helperText="Optional phone for WhatsApp task alert"
              />
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}
            >
              <Button
                variant="danger"
                icon={XCircle}
                onClick={handleReject}
                isLoading={submittingApproval}
              >
                Reject Draft
              </Button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="ghost"
                  onClick={() => setIsReviewModalOpen(false)}
                  disabled={submittingApproval}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  onClick={handleApprove}
                  isLoading={submittingApproval}
                  style={{ background: '#16a34a', borderColor: '#16a34a', color: '#fff' }}
                >
                  Approve & Create Task
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
};

export default DashboardPage;

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
import { taskService } from '../services/taskService';
import { useAuth } from '../hooks/useAuth';
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
  ArrowRight
} from 'lucide-react';

export const DashboardPage = () => {
  const { apiStatus } = useOutletContext() || {};
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);

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
  }, [fetchStats]);

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
                </div>
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
    </PageContainer>
  );
};

export default DashboardPage;

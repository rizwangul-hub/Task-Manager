import React, { useState, useEffect, useCallback } from 'react';
import PageContainer from '../components/layout/PageContainer';
import StatCard from '../components/ui/StatCard';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import TaskDetailsModal from '../components/tasks/TaskDetailsModal';
import { reportService } from '../services/reportService';
import { projectService } from '../services/projectService';
import { useToast } from '../hooks/useToast';
import { formatDate } from '../utils/date';
import {
  BarChart3,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FolderKanban,
  FileSpreadsheet,
  Percent
} from 'lucide-react';

export const ReportsPage = () => {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [datePreset, setDatePreset] = useState('30d'); // '7d' | '30d' | '90d' | 'all'
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);

  // Report Data State
  const [reportData, setReportData] = useState(null);

  // Task Details Modal
  const [detailsTaskId, setDetailsTaskId] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Load Projects for Filter
  useEffect(() => {
    projectService
      .getProjects({ limit: 100 })
      .then((res) => setProjects(res.data.projects || []))
      .catch(() => {});
  }, []);

  // Fetch Report Summary
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    const now = new Date();
    let from = null;

    if (datePreset === '7d') {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (datePreset === '30d') {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (datePreset === '90d') {
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      const res = await reportService.getSummary({
        from: from || undefined,
        to: now.toISOString(),
        project: projectId || undefined
      });
      setReportData(res.data);
    } catch (err) {
      setError(err.message || 'Failed to generate management report.');
    } finally {
      setLoading(false);
    }
  }, [datePreset, projectId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCsv = async (type = 'workload') => {
    setExporting(true);
    try {
      const now = new Date();
      let from = null;
      if (datePreset === '7d') from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      if (datePreset === '30d') from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      if (datePreset === '90d') from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

      await reportService.exportCsv({
        from: from || undefined,
        to: now.toISOString(),
        project: projectId || undefined,
        type
      });
      toast.success('Report CSV exported successfully.');
    } catch (err) {
      toast.error(err.message || 'Failed to export CSV report.');
    } finally {
      setExporting(false);
    }
  };

  const metrics = reportData?.metrics || {
    totalTasks: 0,
    openTasks: 0,
    completedTasks: 0,
    blockedTasks: 0,
    overdueTasks: 0,
    completionRate: 0,
    periodCreatedCount: 0,
    periodCompletedCount: 0,
    totalLoggedMinutes: 0,
    totalLoggedHours: 0
  };

  const projectProgress = reportData?.projectProgress || [];
  const loggedTimeSummary = reportData?.loggedTimeSummary || [];
  const overdueTasks = reportData?.overdueTasks || [];

  return (
    <PageContainer
      title="Management Reports & Analytics"
      subtitle="Audited performance metrics, completion velocity, project progress, and tracked hours."
      actions={
        <div className="reports-top-actions">
          <div className="filter-group">
            <select
              className="reports-select"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              aria-label="Select report time period"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last Quarter (90 Days)</option>
              <option value="all">All-Time Cumulative</option>
            </select>

            <select
              className="reports-select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="Filter report by project"
            >
              <option value="">All Scoped Projects</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="export-actions">
            <Button
              variant="secondary"
              size="sm"
              isLoading={exporting}
              onClick={() => handleExportCsv('workload')}
            >
              <FileSpreadsheet size={15} /> Export Tasks CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={exporting}
              onClick={() => handleExportCsv('time')}
            >
              <Download size={15} /> Export Time Logs CSV
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <LoadingState message="Aggregating performance insights..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchReport} />
      ) : (
        <div className="reports-dashboard-grid">
          {/* Section 1: KPI Stat Cards */}
          <div className="reports-stats-row">
            <StatCard
              title="Completion Rate"
              value={`${metrics.completionRate}%`}
              icon={Percent}
              color="emerald"
              description="Calculation: (Completed Tasks ÷ Total Scope) × 100"
            />
            <StatCard
              title="Deliverables in Scope"
              value={metrics.totalTasks}
              icon={BarChart3}
              color="sky"
              description={`${metrics.periodCreatedCount} created during this selected period`}
            />
            <StatCard
              title="Completed Tasks"
              value={metrics.completedTasks}
              icon={CheckCircle2}
              color="indigo"
              description={`${metrics.periodCompletedCount} closed during this selected period`}
            />
            <StatCard
              title="Overdue Tasks"
              value={metrics.overdueTasks}
              icon={AlertTriangle}
              color="rose"
              description={`${metrics.blockedTasks} currently blocked in progress`}
            />
            <StatCard
              title="Tracked Working Hours"
              value={`${metrics.totalLoggedHours}h`}
              icon={Clock}
              color="amber"
              description={`${metrics.totalLoggedMinutes} total minutes recorded`}
            />
          </div>

          {/* Section 2: Project Velocity & Progress */}
          <div className="reports-panel">
            <div className="reports-panel-header">
              <div className="panel-title-wrap">
                <FolderKanban size={18} />
                <h3>Project Progress & Velocity</h3>
              </div>
              <span className="panel-badge">{projectProgress.length} Projects</span>
            </div>

            {projectProgress.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No Projects in Range"
                description="No projects match the current filter selection."
              />
            ) : (
              <div className="project-progress-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Total Tasks</th>
                      <th>Completed</th>
                      <th>Overdue</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectProgress.map((p) => (
                      <tr key={p.projectId}>
                        <td className="font-semibold">
                          <span className="project-key-tag">{p.key}</span> {p.name}
                        </td>
                        <td><StatusBadge status={p.status} size="sm" /></td>
                        <td>{p.totalTasks}</td>
                        <td className="text-emerald font-semibold">{p.completedTasks}</td>
                        <td className={p.overdueTasks > 0 ? 'text-rose font-semibold' : ''}>
                          {p.overdueTasks}
                        </td>
                        <td className="progress-cell">
                          <div className="progress-bar-container">
                            <div
                              className="progress-bar-fill"
                              style={{ width: `${p.completionRate}%` }}
                            />
                          </div>
                          <span className="progress-pct">{p.completionRate}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 3: Logged Working Hours Aggregation */}
          <div className="reports-panel">
            <div className="reports-panel-header">
              <div className="panel-title-wrap">
                <Clock size={18} />
                <h3>Logged Working Time Distribution</h3>
              </div>
              <span className="panel-badge">{metrics.totalLoggedHours} Total Hours</span>
            </div>

            {loggedTimeSummary.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No Logged Time Entries"
                description="No work hours have been recorded in the selected date period."
              />
            ) : (
              <div className="time-summary-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Logged Entries</th>
                      <th>Total Minutes</th>
                      <th>Total Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loggedTimeSummary.map((t) => (
                      <tr key={t.userId}>
                        <td className="font-semibold">{t.name}</td>
                        <td><StatusBadge status={t.role} size="sm" /></td>
                        <td>{t.entryCount} logs</td>
                        <td>{t.totalMinutes} min</td>
                        <td className="text-amber font-semibold">{t.totalHours} hrs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 5: Overdue Deliverable Attention List */}
          {overdueTasks.length > 0 && (
            <div className="reports-panel border-rose">
              <div className="reports-panel-header">
                <div className="panel-title-wrap text-rose">
                  <AlertTriangle size={18} />
                  <h3>Urgent Overdue Tasks Requiring Attention</h3>
                </div>
                <span className="panel-badge badge-rose">{overdueTasks.length} Overdue</span>
              </div>

              <div className="overdue-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Task Key</th>
                      <th>Title</th>
                      <th>Project</th>
                      <th>Priority</th>
                      <th>Due Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueTasks.map((task) => (
                      <tr key={task._id} onClick={() => { setDetailsTaskId(task._id); setIsDetailsOpen(true); }}>
                        <td className="font-semibold text-rose">{task.taskKey}</td>
                        <td className="font-medium">{task.title}</td>
                        <td>{task.project?.name || '—'}</td>
                        <td><StatusBadge status={task.priority} size="sm" /></td>
                        <td className="text-rose font-semibold">{formatDate(task.dueDate)}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailsTaskId(task._id);
                              setIsDetailsOpen(true);
                            }}
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isDetailsOpen}
        taskId={detailsTaskId}
        onClose={() => {
          setIsDetailsOpen(false);
          setDetailsTaskId(null);
        }}
        onTaskUpdated={fetchReport}
      />
    </PageContainer>
  );
};

export default ReportsPage;

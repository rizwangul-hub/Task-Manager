import React, { useState, useEffect, useCallback } from 'react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import TaskDetailsModal from '../components/tasks/TaskDetailsModal';
import KanbanBoard from '../components/kanban/KanbanBoard';
import TimelineView from '../components/timeline/TimelineView';
import { taskService } from '../services/taskService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { isTaskOverdue, formatDate } from '../utils/date';
import {
  CheckSquare,
  AlertTriangle,
  Calendar,
  FolderKanban,
  Eye,
  Download,
  List,
  LayoutGrid,
  Calendar as CalendarIcon
} from 'lucide-react';

export const MyWorkPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('pixx_my_work_view_mode') || 'table';
  });

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tabFilter, setTabFilter] = useState('all');
  const [exporting, setExporting] = useState(false);

  // Task details modal state
  const [detailsTaskId, setDetailsTaskId] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('pixx_my_work_view_mode', mode);
  };

  const fetchMyTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taskService.getTasks({
        assignee: 'me',
        limit: 100 // load all assigned tasks
      });
      setTasks(res.data.tasks || []);
    } catch (err) {
      setError(err.message || 'Failed to load your personal tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyTasks();
  }, [fetchMyTasks]);

  const handleStatusChange = async (taskId, newStatus) => {
    const originalTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      await taskService.changeStatus(taskId, newStatus);
      toast.success(`Task moved to ${newStatus}.`);
    } catch (err) {
      setTasks(originalTasks);
      toast.error(err.message || 'Failed to update task status.');
    }
  };

  const handleOpenDetails = (task) => {
    const id = task._id || task;
    setDetailsTaskId(id);
    setIsDetailsOpen(true);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await taskService.exportCsv({
        assignee: 'me'
      });
      toast.success('Your personal tasks have been exported to CSV.');
    } catch (err) {
      toast.error(err.message || 'Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  // Filter tasks according to selected tab
  const filteredTasks = tasks.filter((t) => {
    if (tabFilter === 'overdue') {
      return isTaskOverdue(t.dueDate) && t.status !== 'Done';
    }
    if (tabFilter === 'in_progress') {
      return t.status === 'In Progress' || t.status === 'In Review';
    }
    if (tabFilter === 'completed') {
      return t.status === 'Done';
    }
    return true; // 'all'
  });

  const overdueCount = tasks.filter((t) => isTaskOverdue(t.dueDate) && t.status !== 'Done').length;

  return (
    <PageContainer
      title="My Work"
      subtitle={`Personal task queue and deliverables assigned to ${user?.name}.`}
      badge={<StatusBadge status="active" label={`${tasks.length} Assigned`} />}
      actions={
        <div className="workspace-top-bar">
          <div className="view-mode-toggle" role="group" aria-label="My Work View">
            <button
              className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('table')}
              title="Table View"
            >
              <List size={15} /> Table
            </button>
            <button
              className={`toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('kanban')}
              title="Kanban Board View"
            >
              <LayoutGrid size={15} /> Kanban
            </button>
            <button
              className={`toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('timeline')}
              title="Timeline Gantt View"
            >
              <CalendarIcon size={15} /> Timeline
            </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            isLoading={exporting}
            onClick={handleExportCsv}
            title="Export my tasks to CSV"
          >
            <Download size={15} /> Export CSV
          </Button>
        </div>
      }
    >
      {/* Tabs Filter Bar (Only for Table View) */}
      {viewMode === 'table' && (
        <div className="mywork-tabs-bar">
          <button
            type="button"
            className={`tab-btn ${tabFilter === 'all' ? 'active' : ''}`}
            onClick={() => setTabFilter('all')}
          >
            All Assigned ({tasks.length})
          </button>

          <button
            type="button"
            className={`tab-btn ${tabFilter === 'in_progress' ? 'active' : ''}`}
            onClick={() => setTabFilter('in_progress')}
          >
            In Progress ({tasks.filter((t) => t.status === 'In Progress' || t.status === 'In Review').length})
          </button>

          <button
            type="button"
            className={`tab-btn ${tabFilter === 'overdue' ? 'active overdue' : ''}`}
            onClick={() => setTabFilter('overdue')}
          >
            <AlertTriangle size={14} /> Overdue ({overdueCount})
          </button>

          <button
            type="button"
            className={`tab-btn ${tabFilter === 'completed' ? 'active' : ''}`}
            onClick={() => setTabFilter('completed')}
          >
            Completed ({tasks.filter((t) => t.status === 'Done').length})
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading your assigned deliverables..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchMyTasks} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="All caught up!"
          description="You do not have any tasks currently assigned to you. Enjoy your day!"
        />
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          tasks={tasks}
          onStatusChange={handleStatusChange}
          onSelectTask={handleOpenDetails}
        />
      ) : viewMode === 'timeline' ? (
        <TimelineView
          tasks={tasks}
          onSelectTask={handleOpenDetails}
        />
      ) : (
        /* Table View */
        <div className="mywork-tasks-list">
          {filteredTasks.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="No tasks in this view"
              description={`You have no tasks matching the '${tabFilter.replace('_', ' ')}' filter.`}
            />
          ) : (
            <div className="tasks-cards-grid">
              {filteredTasks.map((task) => {
                const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';

                return (
                  <div
                    key={task._id}
                    className={`mywork-task-card ${overdue ? 'card-overdue' : ''}`}
                    onClick={() => handleOpenDetails(task)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleOpenDetails(task);
                      }
                    }}
                  >
                    <div className="card-header-row">
                      <span className="task-key-tag">{task.taskKey}</span>
                      <div className="card-badges">
                        <StatusBadge status={task.priority} size="sm" />
                        <StatusBadge status={task.status} size="sm" />
                      </div>
                    </div>

                    <h3 className="card-task-title">{task.title}</h3>
                    {task.description && (
                      <p className="card-task-desc">{task.description}</p>
                    )}

                    <div className="card-meta-row">
                      <div className="card-meta-item">
                        <FolderKanban size={14} />
                        <span>{task.project?.name || 'Assigned Project'}</span>
                      </div>

                      {task.dueDate && (
                        <div className={`card-meta-item ${overdue ? 'text-rose font-medium' : ''}`}>
                          <Calendar size={14} />
                          <span>Due: {formatDate(task.dueDate)}</span>
                        </div>
                      )}
                    </div>

                    <div className="card-footer-row" onClick={(e) => e.stopPropagation()}>
                      <div className="status-selector-wrap">
                        <label htmlFor={`status-select-${task._id}`} className="sr-only">
                          Update status
                        </label>
                        <select
                          id={`status-select-${task._id}`}
                          className="status-dropdown-sm"
                          value={task.status}
                          onChange={(e) => handleStatusChange(task._id, e.target.value)}
                        >
                          <option value="Backlog">Backlog</option>
                          <option value="To Do">To Do</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Blocked">Blocked</option>
                          <option value="In Review">In Review</option>
                          <option value="Done">Done</option>
                        </select>
                      </div>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleOpenDetails(task)}
                      >
                        <Eye size={14} /> View Details
                      </Button>
                    </div>
                  </div>
                );
              })}
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
        onTaskUpdated={fetchMyTasks}
      />
    </PageContainer>
  );
};

export default MyWorkPage;

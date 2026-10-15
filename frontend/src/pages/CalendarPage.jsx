import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import TaskDetailsModal from '../components/tasks/TaskDetailsModal';
import { taskService } from '../services/taskService';
import { projectService } from '../services/projectService';
import { useToast } from '../hooks/useToast';
import { formatDate, isTaskOverdue } from '../utils/date';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  List,
  Grid
} from 'lucide-react';

export const CalendarPage = () => {
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'list'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Projects filter
  const [projects, setProjects] = useState([]);
  const [projectFilter, setProjectFilter] = useState('');

  // Task details modal
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Quick Reschedule Modal
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [newDueDate, setNewDueDate] = useState('');
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  // Load project options for filtering
  useEffect(() => {
    projectService
      .getProjects({ limit: 100 })
      .then((res) => setProjects(res.data.projects || []))
      .catch(() => {});
  }, []);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taskService.getTasks({
        project: projectFilter || undefined,
        limit: 100 // load up to 100 tasks for calendar
      });
      setTasks(res.data.tasks || []);
    } catch (err) {
      setError(err.message || 'Failed to load calendar deliverables.');
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Navigation Handlers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() - 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setMonth(next.getMonth() - 1);
    }
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() + 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Split tasks into dated vs undated
  const { scheduledTasks, undatedTasks } = useMemo(() => {
    const scheduled = [];
    const undated = [];

    tasks.forEach((t) => {
      if (t.dueDate || t.startDate) {
        scheduled.push(t);
      } else {
        undated.push(t);
      }
    });

    return { scheduledTasks: scheduled, undatedTasks: undated };
  }, [tasks]);

  // Calendar Grid Days for Month View
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const startDayIndex = firstDayOfMonth.getDay(); // 0 (Sun) to 6 (Sat)
    const totalDays = lastDayOfMonth.getDate();

    const days = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayIndex - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false
      });
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true
      });
    }

    // Next month padding (complete 35 or 42 grid cells)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }

    return days;
  }, [currentDate]);

  // Week View Days
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const first = curr.getDate() - curr.getDay();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(curr.setDate(first + i));
      days.push(d);
    }
    return days;
  }, [currentDate]);

  // Handle quick date rescheduling
  const handleOpenReschedule = (e, task) => {
    e.stopPropagation();
    setRescheduleTask(task);
    setNewDueDate(task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '');
  };

  const handleSaveReschedule = async () => {
    if (!rescheduleTask || !newDueDate) return;
    setRescheduleSaving(true);
    try {
      await taskService.updateTask(rescheduleTask._id, {
        dueDate: newDueDate
      });
      toast.success(`Task ${rescheduleTask.taskKey} rescheduled to ${newDueDate}.`);
      setRescheduleTask(null);
      fetchTasks();
    } catch (err) {
      toast.error(err.message || 'Failed to reschedule task.');
    } finally {
      setRescheduleSaving(false);
    }
  };

  return (
    <PageContainer
      title="Calendar"
      subtitle="Interactive schedule of deliverable deadlines, milestones, and upcoming tasks."
      actions={
        <div className="calendar-top-actions">
          <select
            className="calendar-project-select"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filter calendar by project"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="view-mode-toggle" role="group" aria-label="Calendar view mode">
            <button
              className={`toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              <Grid size={15} /> Month
            </button>
            <button
              className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
              onClick={() => setViewMode('week')}
            >
              <Clock size={15} /> Week
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <List size={15} /> List
            </button>
          </div>
        </div>
      }
    >
      {/* Calendar Navigation Bar */}
      <div className="calendar-nav-toolbar">
        <div className="calendar-title-heading">
          <h2>
            {currentDate.toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric'
            })}
          </h2>
        </div>

        <div className="calendar-nav-controls">
          <Button variant="secondary" size="sm" onClick={handlePrev} aria-label="Previous period">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="secondary" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={handleNext} aria-label="Next period">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Synchronizing calendar deadlines..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchTasks} />
      ) : (
        <div className="calendar-main-layout">
          {/* VIEW: MONTH */}
          {viewMode === 'month' && (
            <div className="calendar-month-grid">
              <div className="calendar-weekdays-header">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="weekday-header-cell">
                    {d}
                  </div>
                ))}
              </div>

              <div className="calendar-cells-grid">
                {monthDays.map((cell, idx) => {
                  const dateStr = cell.date.toDateString();
                  const isToday = dateStr === new Date().toDateString();

                  // Find tasks on this date
                  const dayTasks = scheduledTasks.filter((t) => {
                    const taskDate = t.dueDate ? new Date(t.dueDate).toDateString() : null;
                    return taskDate === dateStr;
                  });

                  return (
                    <div
                      key={idx}
                      className={`calendar-day-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${isToday ? 'is-today' : ''}`}
                    >
                      <div className="day-number-header">
                        <span className="day-num">{cell.date.getDate()}</span>
                        {dayTasks.length > 0 && (
                          <span className="task-count-dot">{dayTasks.length}</span>
                        )}
                      </div>

                      <div className="day-tasks-stack">
                        {dayTasks.slice(0, 3).map((task) => {
                          const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';
                          const isDone = task.status === 'Done';

                          return (
                            <div
                              key={task._id}
                              className={`calendar-task-pill status-${task.status.toLowerCase().replace(/\s+/g, '-')} ${overdue ? 'pill-overdue' : ''} ${isDone ? 'pill-done' : ''}`}
                              onClick={() => {
                                setSelectedTaskId(task._id);
                                setIsDetailsOpen(true);
                              }}
                              title={`${task.taskKey}: ${task.title} (${task.status})`}
                            >
                              <span className="pill-key">{task.taskKey}</span>
                              <span className="pill-title">{task.title}</span>
                            </div>
                          );
                        })}

                        {dayTasks.length > 3 && (
                          <span className="more-tasks-indicator">
                            +{dayTasks.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: WEEK */}
          {viewMode === 'week' && (
            <div className="calendar-week-view">
              <div className="week-grid-columns">
                {weekDays.map((d, idx) => {
                  const isToday = d.toDateString() === new Date().toDateString();
                  const dateStr = d.toDateString();

                  const dayTasks = scheduledTasks.filter((t) => {
                    const taskDate = t.dueDate ? new Date(t.dueDate).toDateString() : null;
                    return taskDate === dateStr;
                  });

                  return (
                    <div key={idx} className={`week-column ${isToday ? 'is-today' : ''}`}>
                      <div className="week-col-header">
                        <span className="week-day-name">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                        <span className="week-day-num">{d.getDate()}</span>
                      </div>
                      <div className="week-col-body">
                        {dayTasks.length === 0 ? (
                          <div className="no-day-tasks">None</div>
                        ) : (
                          dayTasks.map((task) => (
                            <div
                              key={task._id}
                              className="week-task-card"
                              onClick={() => {
                                setSelectedTaskId(task._id);
                                setIsDetailsOpen(true);
                              }}
                            >
                              <div className="week-card-top">
                                <span className="task-key-tag">{task.taskKey}</span>
                                <StatusBadge status={task.priority} size="sm" />
                              </div>
                              <h5 className="week-task-title">{task.title}</h5>
                              <div className="week-card-bottom">
                                <StatusBadge status={task.status} size="sm" />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: LIST */}
          {viewMode === 'list' && (
            <div className="calendar-list-view">
              {scheduledTasks.length === 0 ? (
                <div className="calendar-list-empty">
                  <p>No scheduled tasks in this period.</p>
                </div>
              ) : (
                <div className="calendar-list-table-wrapper">
                  <table className="calendar-list-table">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Task Deliverable</th>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Due Date</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduledTasks.map((task) => {
                        const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';
                        return (
                          <tr key={task._id} onClick={() => { setSelectedTaskId(task._id); setIsDetailsOpen(true); }}>
                            <td className="key-cell">{task.taskKey}</td>
                            <td className="title-cell">{task.title}</td>
                            <td>{task.project?.name || '—'}</td>
                            <td><StatusBadge status={task.status} size="sm" /></td>
                            <td><StatusBadge status={task.priority} size="sm" /></td>
                            <td className={overdue ? 'overdue-text' : ''}>
                              {task.dueDate ? formatDate(task.dueDate) : '—'}
                            </td>
                            <td>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={(e) => handleOpenReschedule(e, task)}
                              >
                                Reschedule
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Unscheduled Tasks Section */}
          {undatedTasks.length > 0 && (
            <div className="calendar-undated-panel">
              <div className="undated-panel-header">
                <AlertCircle size={18} />
                <h4>Tasks Without Due Dates ({undatedTasks.length})</h4>
              </div>
              <p className="undated-desc">
                These tasks are active but have no due date assigned. Schedule them to appear on the calendar.
              </p>
              <div className="undated-cards-grid">
                {undatedTasks.slice(0, 8).map((task) => (
                  <div
                    key={task._id}
                    className="undated-task-chip"
                    onClick={() => { setSelectedTaskId(task._id); setIsDetailsOpen(true); }}
                  >
                    <span className="chip-key">{task.taskKey}</span>
                    <span className="chip-title">{task.title}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => handleOpenReschedule(e, task)}
                    >
                      Assign Date
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isDetailsOpen}
        taskId={selectedTaskId}
        onClose={() => {
          setIsDetailsOpen(false);
          setSelectedTaskId(null);
        }}
        onTaskUpdated={fetchTasks}
      />

      {/* Quick Reschedule Modal */}
      {rescheduleTask && (
        <div className="modal-backdrop" onClick={() => setRescheduleTask(null)}>
          <div className="modal-dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <h3>Reschedule {rescheduleTask.taskKey}</h3>
              <button
                className="modal-close-btn"
                onClick={() => setRescheduleTask(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-dialog-body">
              <p className="reschedule-task-title">{rescheduleTask.title}</p>
              <label className="reschedule-label">
                Select New Due Date:
                <input
                  type="date"
                  className="reschedule-input"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-dialog-footer">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRescheduleTask(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={rescheduleSaving}
                onClick={handleSaveReschedule}
                disabled={!newDueDate}
              >
                Save Date
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
};

export default CalendarPage;

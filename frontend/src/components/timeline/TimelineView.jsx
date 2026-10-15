import React, { useState, useMemo } from 'react';
import StatusBadge from '../ui/StatusBadge';
import Button from '../ui/Button';
import { formatDate, isTaskOverdue } from '../../utils/date';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';

export const TimelineView = ({
  tasks = [],
  onSelectTask,
  onDateChange
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  // Split tasks into scheduled and unscheduled
  const { scheduledTasks, unscheduledTasks } = useMemo(() => {
    const scheduled = [];
    const unscheduled = [];

    tasks.forEach((t) => {
      if (t.startDate || t.dueDate) {
        scheduled.push(t);
      } else {
        unscheduled.push(t);
      }
    });

    // Sort scheduled tasks by start or due date
    scheduled.sort((a, b) => {
      const dateA = new Date(a.startDate || a.dueDate).getTime();
      const dateB = new Date(b.startDate || b.dueDate).getTime();
      return dateA - dateB;
    });

    return { scheduledTasks: scheduled, unscheduledTasks: unscheduled };
  }, [tasks]);

  // Compute 14-day timeline range around currentDate
  const timelineDays = useMemo(() => {
    const days = [];
    const start = new Date(currentDate);
    start.setDate(start.getDate() - 3); // 3 days before

    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentDate]);

  const timelineStart = timelineDays[0].getTime();
  const timelineEnd = timelineDays[timelineDays.length - 1].getTime();
  const totalTimelineDuration = timelineEnd - timelineStart || 1;

  const handlePrev = () => {
    const prev = new Date(currentDate);
    prev.setDate(prev.getDate() - 7);
    setCurrentDate(prev);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + 7);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <div className="timeline-container">
      {/* Timeline Controls */}
      <div className="timeline-header-bar">
        <div className="timeline-date-display">
          <CalendarIcon size={18} />
          <span>
            {timelineDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
            {timelineDays[timelineDays.length - 1].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <div className="timeline-nav-buttons">
          <Button variant="secondary" size="sm" onClick={handlePrev}>
            <ChevronLeft size={16} />
          </Button>
          <Button variant="secondary" size="sm" onClick={handleToday}>
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={handleNext}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Gantt Timeline Grid */}
      <div className="timeline-gantt-wrapper">
        <div className="timeline-grid-table">
          {/* Day Headers */}
          <div className="timeline-days-row">
            <div className="timeline-task-info-col header-cell">Task Deliverable</div>
            <div className="timeline-bars-col">
              {timelineDays.map((d, i) => {
                const isToday = d.toDateString() === new Date().toDateString();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={i}
                    className={`timeline-day-cell ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}`}
                  >
                    <span className="day-name">{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                    <span className="day-number">{d.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scheduled Task Rows */}
          <div className="timeline-rows-body">
            {scheduledTasks.length === 0 ? (
              <div className="timeline-empty-message">
                <p>No tasks with start or due dates scheduled in this range.</p>
              </div>
            ) : (
              scheduledTasks.map((task) => {
                const start = task.startDate ? new Date(task.startDate).getTime() : new Date(task.dueDate).getTime();
                const due = task.dueDate ? new Date(task.dueDate).getTime() : start;
                const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';

                // Calculate percentage offsets relative to timeline window
                const leftPercent = Math.max(0, Math.min(100, ((start - timelineStart) / totalTimelineDuration) * 100));
                const rightPercent = Math.max(0, Math.min(100, ((due - timelineStart) / totalTimelineDuration) * 100));
                const widthPercent = Math.max(3, rightPercent - leftPercent || 4);

                return (
                  <div key={task._id} className="timeline-task-row">
                    <div
                      className="timeline-task-info-col"
                      onClick={() => onSelectTask(task)}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="timeline-key">{task.taskKey}</span>
                      <span className="timeline-title" title={task.title}>{task.title}</span>
                      <StatusBadge status={task.status} size="sm" />
                    </div>

                    <div className="timeline-bars-col">
                      <div
                        className={`timeline-bar ${overdue ? 'bar-overdue' : ''} status-${task.status.toLowerCase().replace(/\s+/g, '-')}`}
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`
                        }}
                        onClick={() => onSelectTask(task)}
                        title={`${task.title} (${task.startDate ? formatDate(task.startDate) : 'No start'} – ${task.dueDate ? formatDate(task.dueDate) : 'No due'})`}
                      >
                        <span className="bar-label">{task.title}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Unscheduled Tasks Section */}
      {unscheduledTasks.length > 0 && (
        <div className="timeline-unscheduled-section">
          <div className="unscheduled-header">
            <h4>
              <AlertTriangle size={16} />
              Unscheduled Tasks ({unscheduledTasks.length})
            </h4>
            <p className="unscheduled-help">
              These tasks lack a set start or due date and cannot be plotted on the timeline.
            </p>
          </div>
          <div className="unscheduled-list">
            {unscheduledTasks.map((task) => (
              <div
                key={task._id}
                className="unscheduled-card"
                onClick={() => onSelectTask(task)}
                role="button"
                tabIndex={0}
              >
                <div className="unscheduled-card-top">
                  <span className="task-key-tag">{task.taskKey}</span>
                  <StatusBadge status={task.priority} size="sm" />
                </div>
                <h5>{task.title}</h5>
                <div className="unscheduled-card-footer">
                  <span className="project-sub">{task.project?.name || 'General Project'}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTask(task);
                    }}
                  >
                    Set Dates
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimelineView;

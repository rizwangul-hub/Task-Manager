import React, { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';
import { isTaskOverdue, formatDate } from '../../utils/date';
import { Clock, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const STATUS_COLUMNS = [
  { id: 'Backlog', label: 'Backlog', color: '#64748b' },
  { id: 'To Do', label: 'To Do', color: '#0ea5e9' },
  { id: 'Working on it', label: 'Working on it', color: '#f59e0b' },
  { id: 'In Progress', label: 'In Progress', color: '#f59e0b' },
  { id: 'Stuck', label: 'Stuck', color: '#ef4444' },
  { id: 'Blocked', label: 'Blocked', color: '#ef4444' },
  { id: 'In Review', label: 'In Review', color: '#8b5cf6' },
  { id: 'Applied', label: 'Applied', color: '#9d50dd' },
  { id: 'Done', label: 'Done', color: '#10b981' }
];

export const KanbanBoard = ({
  tasks = [],
  onStatusChange,
  onSelectTask,
  onDeleteTask,
  loading = false
}) => {
  const { canEditTask, canManageBoard } = useAuth();
  const canManage = canManageBoard();
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [activeMenuTaskId, setActiveMenuTaskId] = useState(null);

  const handleDragStart = (e, taskId) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, columnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== columnId) {
      setDragOverColumn(columnId);
    }
  };

  const handleDragLeave = (e, columnId) => {
    if (dragOverColumn === columnId) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = (e, targetStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    setDraggedTaskId(null);

    if (!taskId) return;

    const task = tasks.find((t) => t._id === taskId);
    if (task && canEditTask(task) && task.status !== targetStatus) {
      onStatusChange(taskId, targetStatus);
    }
  };

  return (
    <div className="kanban-board-container" role="region" aria-label="Kanban task board">
      <div className="kanban-board">
        {STATUS_COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          const isOver = dragOverColumn === col.id;

          return (
            <div
              key={col.id}
              className={`kanban-column ${isOver ? 'column-drop-target' : ''}`}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={(e) => handleDragLeave(e, col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div className="kanban-column-header">
                <div className="kanban-header-title">
                  <span
                    className="kanban-column-indicator"
                    style={{ backgroundColor: col.color }}
                  />
                  <h3>{col.label}</h3>
                </div>
                <span className="kanban-column-count">{colTasks.length}</span>
              </div>

              <div className="kanban-cards-list">
                {colTasks.length === 0 ? (
                  <div className="kanban-empty-column">
                    <p>No tasks</p>
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';
                    const isDragging = draggedTaskId === task._id;

                    return (
                      <div
                        key={task._id}
                        draggable={canEditTask(task)}
                        onDragStart={(e) => canEditTask(task) && handleDragStart(e, task._id)}
                        className={`kanban-card ${isDragging ? 'dragging' : ''} ${overdue ? 'card-overdue' : ''}`}
                        onClick={() => onSelectTask(task)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectTask(task);
                          }
                        }}
                        aria-label={`Task ${task.taskKey}: ${task.title}`}
                      >
                        <div className="kanban-card-top">
                          <span className="kanban-task-key">{task.taskKey}</span>
                          <div className="kanban-card-actions" onClick={(e) => e.stopPropagation()}>
                            <select
                              aria-label={`Move status for ${task.taskKey}`}
                              value={task.status}
                              onChange={(e) => onStatusChange(task._id, e.target.value)}
                              disabled={!canEditTask(task)}
                              className="kanban-quick-status-select"
                            >
                              {STATUS_COLUMNS.map((s) => (
                                <option key={s.id} value={s.id}>
                                  Move to: {s.label}
                                </option>
                              ))}
                            </select>
                            {canManage && onDeleteTask && (
                              <button
                                type="button"
                                className="kanban-card-delete-btn"
                                title="Delete task"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#94a3b8',
                                  cursor: 'pointer',
                                  padding: '2px 4px',
                                  marginLeft: '4px',
                                  borderRadius: '4px'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteTask(task._id, task.title);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>

                        <h4 className="kanban-card-title">{task.title}</h4>

                        {task.project?.name && (
                          <div className="kanban-project-pill">
                            <span>{task.project.name}</span>
                          </div>
                        )}

                        <div className="kanban-card-footer">
                          <div className="kanban-badges">
                            <StatusBadge status={task.priority} size="sm" />

                            {task.dueDate && (
                              <span className={`kanban-due-date ${overdue ? 'overdue' : ''}`}>
                                <Clock size={12} />
                                {formatDate(task.dueDate)}
                              </span>
                            )}
                          </div>

                          <div className="kanban-assignees">
                            {task.assignees && task.assignees.length > 0 ? (
                              <div className="avatar-group-sm">
                                {task.assignees.slice(0, 3).map((u) => (
                                  <div
                                    key={u._id}
                                    className="user-avatar-tiny"
                                    title={u.name}
                                  >
                                    {u.name?.charAt(0).toUpperCase()}
                                  </div>
                                ))}
                                {task.assignees.length > 3 && (
                                  <span className="avatar-more-count">
                                    +{task.assignees.length - 3}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="unassigned-text">Unassigned</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default KanbanBoard;

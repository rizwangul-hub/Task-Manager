import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignLeft,
  CalendarDays,
  Check,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Columns3,
  FolderKanban,
  Layers,
  MessageSquare,
  Plus,
  Search,
  ContactRound,
  X
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { formatWhatsAppNumber } from '../../utils/phone';

const STATUS_OPTIONS = [
  { label: 'Backlog', value: 'Backlog', color: 'gray' },
  { label: 'To Do', value: 'To Do', color: 'blue' },
  { label: 'Working on it', value: 'Working on it', color: 'orange' },
  { label: 'In Progress', value: 'In Progress', color: 'orange' },
  { label: 'Stuck', value: 'Stuck', color: 'red' },
  { label: 'Blocked', value: 'Blocked', color: 'red' },
  { label: 'In Review', value: 'In Review', color: 'purple' },
  { label: 'Applied', value: 'Applied', color: 'purple' },
  { label: 'Done', value: 'Done', color: 'green' }
];

const GROUP_COLORS = ['pink', 'green', 'purple', 'blue', 'orange'];

const getId = (value) => (value?._id || value)?.toString();
const getInitials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

const TaskBoard = ({
  tasks,
  projects,
  contacts,
  groupBy,
  visibleCols,
  onToggleColumn,
  onOpenDetails,
  onUpdateTask,
  onQuickCreate,
  onSelectProject,
  selectedProjectId,
  contactFilter,
  onFilterContact,
  sortBy,
  sortOrder,
  onChangeSort
}) => {
  const { canManageBoard, canEditTask } = useAuth();
  const canManage = canManageBoard();
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [openPopover, setOpenPopover] = useState(null);

  useEffect(() => {
    if (!openPopover) return;
    const handleClickOutside = (e) => {
      if (
        !e.target.closest('.board-status-popover') &&
        !e.target.closest('.board-assignee-popover') &&
        !e.target.closest('.board-status-pill') &&
        !e.target.closest('.board-assignee-trigger')
      ) {
        setOpenPopover(null);
      }
    };
    const handleScroll = (e) => {
      if (e.target?.closest?.('.board-status-popover') || e.target?.closest?.('.board-assignee-popover')) {
        return;
      }
      setOpenPopover(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [openPopover]);
  const [contactSearch, setContactSearch] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [quickCreateGroup, setQuickCreateGroup] = useState(null);
  const [quickCreateTitle, setQuickCreateTitle] = useState('');
  const [emptyCreateTitle, setEmptyCreateTitle] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [customColumns, setCustomColumns] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pixx_task_custom_columns') || '[]');
    } catch {
      return [];
    }
  });
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState('Text');

  const groups = useMemo(() => {
    const result = new Map();
    tasks.forEach((task) => {
      let title = 'All tasks';
      if (groupBy === 'project') title = task.project?.name || 'Unassigned project';
      if (groupBy === 'status') title = task.status || 'Unspecified';
      if (groupBy === 'priority') title = task.priority || 'Unspecified';
      if (groupBy === 'groupTitle') title = task.groupTitle || 'General Tasks';
      if (!result.has(title)) result.set(title, []);
      result.get(title).push(task);
    });
    return [...result.entries()];
  }, [tasks, groupBy]);

  const toggleSelected = (taskId) => {
    setSelectedTaskIds((selected) =>
      selected.includes(taskId)
        ? selected.filter((id) => id !== taskId)
        : [...selected, taskId]
    );
  };

  const saveTitle = async (task) => {
    const title = editingTitle.trim();
    setEditingTaskId(null);
    if (!title || title === task.title) return;
    await onUpdateTask(task, { title });
  };

  const startQuickCreate = (groupTitle, groupTasks) => {
    const projectId = groupTasks[0]?.project?._id || groupTasks[0]?.project ||
      projects.find((project) => project.name === groupTitle)?._id ||
      (projects.length === 1 ? projects[0]._id : '');
    if (!projectId) {
      onSelectProject('');
      setQuickCreateGroup(groupTitle);
      setQuickCreateTitle('');
      return;
    }
    setQuickCreateGroup(groupTitle);
    setQuickCreateTitle('');
  };

  const submitQuickCreate = async (event, groupTitle, groupTasks) => {
    event.preventDefault();
    const projectId = groupTasks[0]?.project?._id || groupTasks[0]?.project ||
      projects.find((project) => project.name === groupTitle)?._id ||
      (projects.length === 1 ? projects[0]._id : '');
    if (!projectId || !quickCreateTitle.trim()) return;
    await onQuickCreate(projectId, quickCreateTitle.trim());
    setQuickCreateTitle('');
    setQuickCreateGroup(null);
  };

  const addableColumns = [
    ['assignees', 'Assigned To', ContactRound],
    ['status', 'Status', Check],
    ['dueDate', 'Date', CalendarDays],
    ['priority', 'Priority', Layers],
    ['project', 'Project', FolderKanban],
    ['timeSpent', 'Time tracked', AlignLeft],
    ['key', 'Task ID', AlignLeft]
  ];

  const addCustomColumn = (event) => {
    event.preventDefault();
    const label = newColumnName.trim();
    if (!label || customColumns.some((column) => column.label.toLowerCase() === label.toLowerCase())) return;
    const column = {
      key: `custom_${Date.now().toString(36)}`,
      label,
      type: newColumnType
    };
    const nextColumns = [...customColumns, column];
    setCustomColumns(nextColumns);
    localStorage.setItem('pixx_task_custom_columns', JSON.stringify(nextColumns));
    setNewColumnName('');
  };

  const saveCustomField = (task, column, value) => {
    const fields = task.customFields || [];
    const nextFields = fields.some((field) => field.key === column.key)
      ? fields.map((field) => field.key === column.key ? { ...field, value } : field)
      : [...fields, { ...column, value }];
    void onUpdateTask(task, { customFields: nextFields });
  };

  return (
    <div className="monday-board-layout">
      <aside className={`board-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`} aria-label="Workspace boards">
        <div className="board-sidebar-heading">
          <Layers size={16} />
          <span>Workspace</span>
          <button type="button" title={sidebarCollapsed ? 'Expand workspace list' : 'Collapse workspace list'} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
            {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
        <button
          type="button"
          className={`board-nav-item ${!selectedProjectId ? 'selected' : ''}`}
          onClick={() => onSelectProject('')}
        >
          <FolderKanban size={15} />
          <span>All tasks</span>
        </button>
        <div className="board-nav-label">Boards</div>
        {projects.map((project, index) => (
          <button
            type="button"
            key={project._id}
            className={`board-nav-item ${selectedProjectId === project._id ? 'selected' : ''}`}
            onClick={() => onSelectProject(project._id)}
          >
            <span className={`board-nav-dot board-nav-dot-${GROUP_COLORS[index % GROUP_COLORS.length]}`} />
            <span>{project.name}</span>
          </button>
        ))}
        <div className="board-sidebar-footer">
          <CirclePlus size={15} /> Workspaces & boards
        </div>
      </aside>

      <section className="monday-board" aria-label="Task board">
        <div className="board-toolbar">
          <div className="board-toolbar-title">
            <h2>{projects.find((project) => project._id === selectedProjectId)?.name || 'Task workspace'}</h2>
            <span>{tasks.length} tasks</span>
          </div>
          <div className="board-toolbar-actions">
            <label className="board-person-filter">
              <ContactRound size={15} />
              <select aria-label="Filter board by contact" value={contactFilter} onChange={(event) => onFilterContact(event.target.value)}>
                <option value="">All contacts</option>
                {contacts.filter((contact) => contact.isActive).map((contact) => (
                  <option value={contact._id} key={contact._id}>{contact.fullName}</option>
                ))}
              </select>
            </label>
            <button type="button" className="board-tool-button" onClick={() => setColumnsOpen((open) => !open)}>
              <Columns3 size={15} /> Columns
            </button>
            <label className="board-sort-control">
              <span>Sort</span>
              <select value={sortBy} aria-label="Sort tasks" onChange={(event) => onChangeSort(event.target.value, sortOrder)}>
                <option value="createdAt">Created date</option>
                <option value="title">Task name</option>
                <option value="status">Status</option>
                <option value="priority">Priority</option>
                <option value="dueDate">Due date</option>
              </select>
              <button type="button" aria-label="Toggle sort direction" onClick={() => onChangeSort(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}>
                {sortOrder === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </label>
            {columnsOpen && (
              <div className="board-columns-popover">
                <strong>Add or hide columns</strong>
                {addableColumns.map(([key, label, Icon]) => (
                  <label key={key}>
                    <input type="checkbox" checked={Boolean(visibleCols[key])} onChange={() => onToggleColumn(key)} />
                    <Icon size={14} /> {label}
                  </label>
                ))}
                {canManage && <form className="board-add-column-form" onSubmit={addCustomColumn}>
                  <input
                    aria-label="Custom column name"
                    placeholder="New column name"
                    value={newColumnName}
                    onChange={(event) => setNewColumnName(event.target.value)}
                  />
                  <select aria-label="Custom column type" value={newColumnType} onChange={(event) => setNewColumnType(event.target.value)}>
                    <option>Text</option>
                    <option>Number</option>
                    <option>Date</option>
                  </select>
                  <button type="submit" disabled={!newColumnName.trim()}><Plus size={14} /> Add</button>
                </form>}
              </div>
            )}
          </div>
        </div>

        {selectedTaskIds.length > 0 && (
          <div className="board-selection-bar">
            {selectedTaskIds.length} selected
            <button type="button" onClick={() => setSelectedTaskIds([])}>Clear selection</button>
          </div>
        )}

        <div className="board-groups">
          {groups.map(([groupTitle, groupTasks], groupIndex) => {
            const isCollapsed = Boolean(collapsedGroups[groupTitle]);
            const groupProjectId = groupTasks[0]?.project?._id || groupTasks[0]?.project ||
              projects.find((project) => project.name === groupTitle)?._id || '';
            return (
              <section className={`board-group group-color-${GROUP_COLORS[groupIndex % GROUP_COLORS.length]}`} key={groupTitle}>
                <header className="board-group-header">
                  <button
                    type="button"
                    className="group-collapse-button"
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${groupTitle}`}
                    onClick={() => setCollapsedGroups((state) => ({ ...state, [groupTitle]: !state[groupTitle] }))}
                  >
                    {isCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                  </button>
                  <span className="group-color-marker" />
                  <h3>{groupTitle}</h3>
                  <span className="board-group-count">{groupTasks.length}</span>
                  {canManage && (
                    <button type="button" className="group-add-button" onClick={() => startQuickCreate(groupTitle, groupTasks)}>
                      <Plus size={15} /> Add task
                    </button>
                  )}
                </header>

                {!isCollapsed && (
                  <div className="board-table-scroll">
                    <table className="monday-data-table">
                      <thead>
                        <tr>
                          <th className="board-check-column"><input type="checkbox" aria-label={`Select all ${groupTitle} tasks`} checked={groupTasks.length > 0 && groupTasks.every((task) => selectedTaskIds.includes(task._id))} onChange={() => {
                            const ids = groupTasks.map((task) => task._id);
                            const allSelected = ids.every((id) => selectedTaskIds.includes(id));
                            setSelectedTaskIds((selected) => allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
                          }} /></th>
                          <th className="board-task-column">Task</th>
                          {visibleCols.assignees && <th>Assigned To</th>}
                          {visibleCols.status && <th>Status</th>}
                          {visibleCols.priority && <th>Priority</th>}
                          {visibleCols.dueDate && <th>Date</th>}
                          {visibleCols.project && <th>Project</th>}
                          {visibleCols.timeSpent && <th>Time</th>}
                          {visibleCols.key && <th>Task ID</th>}
                          {customColumns.map((column) => <th key={column.key}>{column.label}</th>)}
                          <th className="board-column-adder">
                            {canManage && <button type="button" aria-label="Add board column" onClick={() => setColumnsOpen((open) => !open)}><Plus size={16} /></button>}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupTasks.map((task) => {
                          const status = STATUS_OPTIONS.find((option) => option.value === task.status) || STATUS_OPTIONS[0];
                          const assignedContact = task.assignedContact;
                          const popoverId = openPopover?.taskId === task._id ? openPopover.type : null;
                          return (
                            <tr key={task._id} className={selectedTaskIds.includes(task._id) ? 'is-selected' : ''}>
                              <td className="board-check-column">
                                <input type="checkbox" checked={selectedTaskIds.includes(task._id)} aria-label={`Select ${task.title}`} onChange={() => toggleSelected(task._id)} />
                              </td>
                              <td className="board-task-column">
                                <div className="board-task-cell">
                                  {editingTaskId === task._id && canManage ? (
                                    <input
                                      autoFocus
                                      className="board-inline-title"
                                      value={editingTitle}
                                      onChange={(event) => setEditingTitle(event.target.value)}
                                      onBlur={() => saveTitle(task)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                        if (event.key === 'Escape') setEditingTaskId(null);
                                      }}
                                      aria-label="Edit task title"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className="board-task-title"
                                      onClick={() => {
                                        if (canManage) {
                                          setEditingTaskId(task._id);
                                          setEditingTitle(task.title);
                                        } else {
                                          onOpenDetails(task, 'overview');
                                        }
                                      }}
                                      title={canManage ? 'Click to edit task title' : 'Open task details'}
                                    >{task.title}</button>
                                  )}
                                  <button type="button" className="board-updates-button" title="Open task updates" onClick={() => onOpenDetails(task, 'comments')}>
                                    <MessageSquare size={15} />
                                  </button>
                                </div>
                              </td>
                              {visibleCols.assignees && (
                                <td className="board-cell-popover">
                                  <button
                                    type="button"
                                    className="board-assignee-trigger"
                                    aria-label={`Assign contact to ${task.title}`}
                                    disabled={!canManage}
                                    onClick={(e) => {
                                      if (popoverId === 'assignees') {
                                        setOpenPopover(null);
                                      } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setOpenPopover({
                                          taskId: task._id,
                                          type: 'assignees',
                                          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
                                        });
                                        setContactSearch('');
                                      }
                                    }}
                                  >
                                    {assignedContact
                                      ? <span className="board-avatar" title={assignedContact.fullName}>{getInitials(assignedContact.fullName)}</span>
                                      : <span className="board-avatar board-avatar-empty"><Plus size={14} /></span>}
                                  </button>
                                  {popoverId === 'assignees' && openPopover?.rect && createPortal(
                                    <div
                                      className="board-popover board-assignee-popover board-assignee-popover-portal"
                                      style={{
                                        position: 'fixed',
                                        zIndex: 99999,
                                        width: '260px',
                                        left: `${Math.max(12, Math.min(window.innerWidth - 272, openPopover.rect.left + (openPopover.rect.width / 2) - 130))}px`,
                                        ...(openPopover.rect.top > 250
                                          ? { bottom: `${window.innerHeight - openPopover.rect.top + 6}px`, top: 'auto' }
                                          : { top: `${openPopover.rect.bottom + 6}px`, bottom: 'auto' }),
                                        maxHeight: '320px',
                                        overflowY: 'auto'
                                      }}
                                    >
                                      <div className="board-popover-title">Assign contact</div>
                                      <div className="board-assignee-search"><Search size={14} /><input autoFocus placeholder="Search contacts" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} /></div>
                                      <p>The contact will receive a WhatsApp assignment notification.</p>
                                      <div className="board-assignee-list">
                                        {contacts.filter((contact) => contact.isActive &&
                                          `${contact.fullName} ${contact.whatsappNumber}`.toLowerCase().includes(contactSearch.toLowerCase())
                                        ).map((contact) => {
                                          const selected = getId(assignedContact) === getId(contact);
                                          return <button type="button" key={contact._id} onClick={() => {
                                            setOpenPopover(null);
                                            if (!selected) void onUpdateTask(task, { contactId: contact._id });
                                          }}><span className="board-avatar">{getInitials(contact.fullName)}</span><span>{contact.fullName} · {formatWhatsAppNumber(contact.whatsappNumber)}</span>{selected && <Check size={15} />}</button>;
                                        })}
                                        {contacts.every((contact) => !contact.isActive) && <p>No active contacts. Add one from Contacts.</p>}
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                </td>
                              )}
                              {visibleCols.status && (
                                <td className="board-cell-popover">
                                  <button
                                    type="button"
                                    className={`board-status-pill status-color-${status.color}`}
                                    disabled={!canEditTask(task)}
                                    onClick={(e) => {
                                      if (popoverId === 'status') {
                                        setOpenPopover(null);
                                      } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setOpenPopover({
                                          taskId: task._id,
                                          type: 'status',
                                          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
                                        });
                                      }
                                    }}
                                  >
                                    {status.label}
                                  </button>
                                  {popoverId === 'status' && canEditTask(task) && openPopover?.rect && createPortal(
                                    <div
                                      className="board-popover board-status-popover board-status-popover-portal"
                                      style={{
                                        position: 'fixed',
                                        zIndex: 99999,
                                        width: '160px',
                                        left: `${Math.max(12, Math.min(window.innerWidth - 172, openPopover.rect.left + (openPopover.rect.width / 2) - 80))}px`,
                                        ...(openPopover.rect.top > 200
                                          ? { bottom: `${window.innerHeight - openPopover.rect.top + 6}px`, top: 'auto' }
                                          : { top: `${openPopover.rect.bottom + 6}px`, bottom: 'auto' }),
                                        maxHeight: '270px',
                                        overflowY: 'auto'
                                      }}
                                    >
                                      {STATUS_OPTIONS.map((option) => (
                                        <button
                                          type="button"
                                          key={option.value}
                                          onClick={() => {
                                            setOpenPopover(null);
                                            void onUpdateTask(task, { status: option.value });
                                          }}
                                        >
                                          <span className={`status-swatch status-color-${option.color}`} />
                                          {option.label}
                                          {task.status === option.value && <Check size={14} />}
                                        </button>
                                      ))}
                                    </div>,
                                    document.body
                                  )}
                                </td>
                              )}
                              {visibleCols.priority && <td><span className={`board-priority priority-${(task.priority || 'Medium').toLowerCase()}`}>{task.priority || 'Medium'}</span></td>}
                              {visibleCols.dueDate && <td><label className="board-date-cell"><CalendarDays size={14} /><input type="date" aria-label={`Due date for ${task.title}`} value={task.dueDate ? task.dueDate.slice(0, 10) : ''} disabled={!canEditTask(task)} onChange={(event) => void onUpdateTask(task, { dueDate: event.target.value || null })} /></label></td>}
                              {visibleCols.project && <td className="board-muted-cell">{task.project?.name || '—'}</td>}
                              {visibleCols.timeSpent && <td className="board-muted-cell">{((task.totalTimeSpentMinutes || 0) / 60).toFixed(1)}h</td>}
                              {visibleCols.key && <td className="board-task-key">{task.taskKey}</td>}
                              {customColumns.map((column) => {
                                const field = task.customFields?.find((item) => item.key === column.key);
                                return (
                                  <td key={column.key}>
                                    <input
                                      className="board-custom-field"
                                      type={column.type === 'Number' ? 'number' : column.type === 'Date' ? 'date' : 'text'}
                                      aria-label={`${column.label} for ${task.title}`}
                                      defaultValue={field?.value ?? ''}
                                      disabled={!canEditTask(task)}
                                      onBlur={(event) => {
                                        const value = column.type === 'Number' && event.target.value !== ''
                                          ? Number(event.target.value)
                                          : event.target.value || null;
                                        if (value !== (field?.value ?? null)) saveCustomField(task, column, value);
                                      }}
                                    />
                                  </td>
                                );
                              })}
                              <td className="board-row-menu-cell"><button type="button" aria-label={`Open ${task.title} details`} onClick={() => onOpenDetails(task)}><ChevronRight size={16} /></button></td>
                            </tr>
                          );
                        })}
                        {quickCreateGroup === groupTitle && (
                          <tr className="board-quick-create-row">
                            <td />
                            <td colSpan={8}>
                              <form onSubmit={(event) => submitQuickCreate(event, groupTitle, groupTasks)}>
                                <input autoFocus placeholder="Type a task name and press Enter" value={quickCreateTitle} onChange={(event) => setQuickCreateTitle(event.target.value)} />
                                <button type="submit" disabled={!quickCreateTitle.trim() || !groupProjectId}><Check size={15} /></button>
                                <button type="button" onClick={() => setQuickCreateGroup(null)}><X size={15} /></button>
                                {!groupProjectId && <span>Select a project to create a task.</span>}
                              </form>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {canManage && quickCreateGroup !== groupTitle && (
                      <button type="button" className="board-add-task-row" onClick={() => startQuickCreate(groupTitle, groupTasks)}>
                        <Plus size={15} /> Add task
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          {canManage && groups.length === 0 && (
            <form
              className="board-empty-create"
              onSubmit={async (event) => {
                event.preventDefault();
                const projectId = selectedProjectId || projects[0]?._id;
                if (!projectId || !emptyCreateTitle.trim()) return;
                await onQuickCreate(projectId, emptyCreateTitle.trim());
                setEmptyCreateTitle('');
              }}
            >
              <FolderKanban size={24} />
              <strong>No tasks on this board yet</strong>
              <span>Start with a task. You can assign people and set a due date from the board.</span>
              <div>
                <input
                  aria-label="New task title"
                  placeholder="Task name"
                  value={emptyCreateTitle}
                  onChange={(event) => setEmptyCreateTitle(event.target.value)}
                />
                <button type="submit" disabled={!projects.length || !emptyCreateTitle.trim()}><Plus size={15} /> Add task</button>
              </div>
              {!selectedProjectId && projects.length > 1 && (
                <label>
                  Board
                  <select defaultValue={projects[0]._id} onChange={(event) => onSelectProject(event.target.value)}>
                    {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
                  </select>
                </label>
              )}
            </form>
          )}
          {canManage && projects.length > 0 && groupBy === 'project' && projects.some((project) => !groups.some(([title]) => title === project.name)) && (
            <button type="button" className="board-add-group-button" onClick={() => onSelectProject(projects[0]._id)}>
              <Plus size={16} /> Choose a board to add a task
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default TaskBoard;

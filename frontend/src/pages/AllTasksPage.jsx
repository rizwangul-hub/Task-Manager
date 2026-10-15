import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import TaskDetailsModal from '../components/tasks/TaskDetailsModal';
import TaskBoard from '../components/tasks/TaskBoard';
import KanbanBoard from '../components/kanban/KanbanBoard';
import TimelineView from '../components/timeline/TimelineView';
import { taskService } from '../services/taskService';
import { socketService } from '../services/socket';
import { projectService } from '../services/projectService';
import { userService } from '../services/userService';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { isTaskOverdue, formatDate } from '../utils/date';
import {
  ListTodo,
  Plus,
  Search,
  Edit2,
  Eye,
  Download,
  RotateCcw,
  LayoutGrid,
  List,
  Calendar as CalendarIcon,
  Columns,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Layers
} from 'lucide-react';

const DEFAULT_COLUMNS = {
  key: true,
  title: true,
  project: true,
  assignees: false,
  status: true,
  priority: true,
  dueDate: true,
  timeSpent: true,
  actions: true
};

export const AllTasksPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { canManageBoard, canEditTask } = useAuth();
  const canManage = canManageBoard();

  // Persistent View Preferences
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('pixx_all_tasks_view_mode') || 'table';
  });

  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('pixx_task_visible_cols');
      return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
    } catch {
      return DEFAULT_COLUMNS;
    }
  });

  const [isColMenuOpen, setIsColMenuOpen] = useState(false);

  // Task Data & Pagination
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalTasks, setTotalTasks] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo] = useState('');
  const [groupBy, setGroupBy] = useState('project'); // 'none' | 'status' | 'project' | 'priority' | 'groupTitle'

  // Sorting
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // Metadata
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [exporting, setExporting] = useState(false);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [detailsTaskId, setDetailsTaskId] = useState(null);
  const [detailsInitialTab, setDetailsInitialTab] = useState('overview');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Form Fields
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProject, setFormProject] = useState('');
  const [formAssignees, setFormAssignees] = useState([]);
  const [formStatus, setFormStatus] = useState('To Do');
  const [formPriority, setFormPriority] = useState('Medium');
  const [formStartDate, setFormStartDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formError, setFormError] = useState('');

  // Save view preference
  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('pixx_all_tasks_view_mode', mode);
  };

  const toggleColumn = (col) => {
    const updated = { ...visibleCols, [col]: !visibleCols[col] };
    setVisibleCols(updated);
    localStorage.setItem('pixx_task_visible_cols', JSON.stringify(updated));
  };

  const handleOpenDetails = (task, initialTab = 'overview') => {
    setDetailsTaskId(task._id);
    setDetailsInitialTab(initialTab);
    setIsDetailsOpen(true);
  };

  const handleBoardTaskUpdate = async (task, changes) => {
    const previousTasks = tasks;
    setTasks((current) => current.map((item) =>
      item._id === task._id ? { ...item, ...changes } : item
    ));
    try {
      if (changes.status) {
        await taskService.changeStatus(task._id, changes.status);
      } else {
        await taskService.updateTask(task._id, changes);
      }
      await fetchTasks();
      toast.success('Task updated.');
    } catch (err) {
      setTasks(previousTasks);
      toast.error(err.message || 'Could not update task.');
    }
  };

  const handleBoardQuickCreate = async (projectId, title) => {
    try {
      await taskService.createTask({ project: projectId, title, status: 'To Do' });
      toast.success('Task created.');
      await fetchTasks();
    } catch (err) {
      toast.error(err.message || 'Could not create task.');
    }
  };

  // Fetch Tasks with Server-side Pagination & Filters
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taskService.getTasks({
        page,
        limit: viewMode === 'kanban' || viewMode === 'timeline' ? 100 : limit,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        project: projectFilter || undefined,
        assignee: assigneeFilter || undefined,
        dueDateFrom: dueDateFrom || undefined,
        dueDateTo: dueDateTo || undefined,
        sortBy,
        sortOrder
      });

      setTasks(res.data.tasks || []);
      if (res.data.pagination) {
        setTotalTasks(res.data.pagination.total);
        setTotalPages(res.data.pagination.pages);
      }
    } catch (err) {
      setError(err.message || 'Failed to load tasks.');
    } finally {
      setLoading(false);
    }
  }, [page, limit, viewMode, search, statusFilter, priorityFilter, projectFilter, assigneeFilter, dueDateFrom, dueDateTo, sortBy, sortOrder]);

  // Load project metadata
  useEffect(() => {
    projectService
      .getProjects({ limit: 100 })
      .then((res) => setProjects(res.data.projects || []))
      .catch(() => {});
    userService
      .getUsers({ limit: 100, status: 'active' })
      .then((res) => setUsers(res.data.users || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const socket = socketService.connect();
    const handleTaskUpdate = (payload) => {
      const updatedTask = payload?.task;
      const taskId = updatedTask?._id || payload?.taskId;
      if (!taskId) return;
      setTasks((current) => current.map((task) =>
        task._id === taskId
          ? { ...task, ...(updatedTask || {}), ...(payload.status ? { status: payload.status } : {}) }
          : task
      ));
    };
    const handleTaskCreated = (createdTask) => {
      const createdProjectId = createdTask?.project?._id || createdTask?.project;
      if (projectFilter && createdProjectId?.toString() !== projectFilter.toString()) return;
      if (!createdTask?._id) return;
      void fetchTasks();
    };
    socket.on('task:updated', handleTaskUpdate);
    socket.on('task:created', handleTaskCreated);
    return () => {
      socket.off('task:updated', handleTaskUpdate);
      socket.off('task:created', handleTaskCreated);
    };
  }, [fetchTasks, projectFilter]);

  // Clear all filters
  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
    setProjectFilter('');
    setAssigneeFilter('');
    setDueDateFrom('');
    setDueDateTo('');
    setGroupBy('none');
    setPage(1);
    setSearchParams({});
  };

  const hasActiveFilters = Boolean(
    search || statusFilter || priorityFilter || projectFilter || assigneeFilter || dueDateFrom || dueDateTo || groupBy !== 'none'
  );

  // Fast Kanban status transition with rollback
  const handleKanbanStatusChange = async (taskId, newStatus) => {
    const task = tasks.find((item) => item._id === taskId);
    if (!task || !canEditTask(task)) return;
    const originalTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) => (t._id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      await taskService.changeStatus(taskId, newStatus);
      toast.success(`Task moved to ${newStatus}.`);
    } catch (err) {
      setTasks(originalTasks);
      toast.error(err.message || 'Failed to update status. Reverting change.');
    }
  };

  // CSV Export
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await taskService.exportCsv({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        project: projectFilter || undefined,
        assignee: assigneeFilter || undefined,
        dueDateFrom: dueDateFrom || undefined,
        dueDateTo: dueDateTo || undefined
      });
      toast.success('Tasks exported to CSV successfully.');
    } catch (err) {
      toast.error(err.message || 'Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  // Form Reset & Open Handlers
  const resetForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormProject(projects[0]?._id || '');
    setFormAssignees([]);
    setFormStatus('To Do');
    setFormPriority('Medium');
    setFormStartDate('');
    setFormDueDate('');
    setFormError('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (task) => {
    setSelectedTask(task);
    setFormTitle(task.title);
    setFormDesc(task.description || '');
    setFormProject(task.project?._id || task.project);
    setFormAssignees(task.assignees?.map((a) => a._id || a) || []);
    setFormStatus(task.status);
    setFormPriority(task.priority);
    setFormStartDate(task.startDate ? task.startDate.split('T')[0] : '');
    setFormDueDate(task.dueDate ? task.dueDate.split('T')[0] : '');
    setFormError('');
    setIsEditModalOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formTitle.trim() || !formProject) {
      setFormError('Task title and target project are required.');
      return;
    }

    setSubmitting(true);
    try {
      await taskService.createTask({
        title: formTitle.trim(),
        description: formDesc.trim(),
        project: formProject,
        assignees: formAssignees,
        status: formStatus,
        priority: formPriority,
        startDate: formStartDate || null,
        dueDate: formDueDate || null
      });

      toast.success('Task created successfully.');
      setIsCreateModalOpen(false);
      fetchTasks();
    } catch (err) {
      setFormError(err.message || 'Failed to create task.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formTitle.trim()) {
      setFormError('Task title is required.');
      return;
    }

    setSubmitting(true);
    try {
      await taskService.updateTask(selectedTask._id, {
        title: formTitle.trim(),
        description: formDesc.trim(),
        assignees: formAssignees,
        status: formStatus,
        priority: formPriority,
        startDate: formStartDate || null,
        dueDate: formDueDate || null
      });

      toast.success('Task updated successfully.');
      setIsEditModalOpen(false);
      fetchTasks();
    } catch (err) {
      setFormError(err.message || 'Failed to update task.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer
      title="All Tasks"
      subtitle="Comprehensive workspace to plan, assign, schedule, and review company deliverables."
      actions={
        <div className="workspace-top-bar">
          {/* View Mode Switcher */}
          <div className="view-mode-toggle" role="group" aria-label="Workspace View">
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

          {/* Export CSV */}
          <Button
            variant="secondary"
            size="sm"
            isLoading={exporting}
            onClick={handleExportCsv}
            title="Export filtered tasks to CSV"
          >
            <Download size={15} /> Export CSV
          </Button>

          {/* Create Task Button */}
          {canManage && (
            <Button variant="primary" size="sm" onClick={handleOpenCreate}>
              <Plus size={16} /> New Task
            </Button>
          )}
        </div>
      }
    >
      {/* Workspace Filters & Controls Toolbar */}
      <div className="workspace-toolbar">
        <div className="toolbar-search-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by title, key (e.g. MKT-1), description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="toolbar-filters-wrap">
          {/* Project Filter */}
          <select
            className="filter-select"
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}
            aria-label="Filter by project"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            aria-label="Filter by status"
          >
            <option value="">All Statuses</option>
            <option value="Backlog">Backlog</option>
            <option value="To Do">To Do</option>
            <option value="In Progress">In Progress</option>
            <option value="Blocked">Blocked</option>
            <option value="In Review">In Review</option>
            <option value="Done">Done</option>
          </select>

          {/* Priority Filter */}
          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
            aria-label="Filter by priority"
          >
            <option value="">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>



          {/* Grouping Select */}
          {viewMode === 'table' && (
            <select
              className="filter-select"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              aria-label="Group tasks by"
            >
              <option value="none">Group: None</option>
              <option value="status">Group: Status</option>
              <option value="priority">Group: Priority</option>
              <option value="project">Group: Project</option>
              <option value="groupTitle">Group: WhatsApp group</option>
            </select>
          )}

          {/* Column Visibility Menu Button */}
          {viewMode === 'table' && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsColMenuOpen(!isColMenuOpen)}
                title="Configure table columns"
              >
                <Columns size={15} /> Columns
              </Button>

              {isColMenuOpen && (
                <div className="columns-dropdown-menu">
                  <div className="dropdown-header">Toggle Columns</div>
                  {Object.keys(DEFAULT_COLUMNS).map((col) => (
                    <label key={col} className="col-checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleCols[col]}
                        onChange={() => toggleColumn(col)}
                      />
                      <span>{col.charAt(0).toUpperCase() + col.slice(1)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Clear Filters Action */}
          {hasActiveFilters && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearFilters}
              title="Clear all active filters"
            >
              <RotateCcw size={14} /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area depending on ViewMode */}
      {loading ? (
        <LoadingState message="Loading tasks..." />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchTasks} />
      ) : tasks.length === 0 && viewMode !== 'table' ? (
        <EmptyState
          icon={ListTodo}
          title="No Tasks Found"
          description={
            hasActiveFilters
              ? 'No deliverables match your applied search and filter criteria. Try clearing some filters.'
              : 'No tasks have been created in your workspace yet. Click "New Task" above to get started.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                Clear Active Filters
              </Button>
            ) : canManage ? (
              <Button variant="primary" size="sm" onClick={handleOpenCreate}>
                <Plus size={16} /> Create First Task
              </Button>
            ) : null
          }
        />
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          tasks={tasks}
          onStatusChange={handleKanbanStatusChange}
          onSelectTask={handleOpenDetails}
          loading={loading}
        />
      ) : viewMode === 'timeline' ? (
        <TimelineView
          tasks={tasks}
          onSelectTask={handleOpenDetails}
        />
      ) : viewMode === 'table' ? (
        <div className="workspace-table-container">
          <TaskBoard
            tasks={tasks}
            projects={projects}
            users={users}
            groupBy={groupBy}
            visibleCols={visibleCols}
            onToggleColumn={toggleColumn}
            onOpenDetails={handleOpenDetails}
            onUpdateTask={handleBoardTaskUpdate}
            onQuickCreate={handleBoardQuickCreate}
            onSelectProject={(projectId) => {
              setProjectFilter(projectId);
              setPage(1);
            }}
            selectedProjectId={projectFilter}
            assigneeFilter={assigneeFilter}
            onFilterAssignee={(assigneeId) => {
              setAssigneeFilter(assigneeId);
              setPage(1);
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChangeSort={(field, order) => {
              setSortBy(field);
              setSortOrder(order);
            }}
          />
          <div className="pagination-bar">
            <div className="pagination-info">
              Showing <span>{totalTasks === 0 ? 0 : (page - 1) * limit + 1}</span>–<span>{Math.min(page * limit, totalTasks)}</span> of{' '}
              <span>{totalTasks}</span> tasks
            </div>
            <div className="pagination-actions">
              <label className="limit-selector">
                Per page:
                <select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="page-nav-btns">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={16} /> Prev
                </Button>
                <span className="current-page-tag">{page} / {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* VIEW: TABLE (With optional grouping and server-side pagination) */
        <div className="workspace-table-container">
          {groupedTasks ? (
            Object.entries(groupedTasks).map(([groupTitle, groupItems]) => (
              <div key={groupTitle} className="task-group-section">
                <div className="task-group-header">
                  <Layers size={16} />
                  <h3>{groupTitle}</h3>
                  <span className="task-group-count">{groupItems.length}</span>
                </div>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {visibleCols.key && <th>Key</th>}
                        {visibleCols.title && <th>Title</th>}
                        {visibleCols.project && <th>Project</th>}
                        {visibleCols.assignees && <th>Assignees</th>}
                        {visibleCols.status && <th>Status</th>}
                        {visibleCols.priority && <th>Priority</th>}
                        {visibleCols.dueDate && <th>Due Date</th>}
                        {visibleCols.timeSpent && <th>Time</th>}
                        {visibleCols.actions && <th className="text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {groupItems.map((task) => (
                        <TaskRow
                          key={task._id}
                          task={task}
                          visibleCols={visibleCols}
                          onOpenDetails={handleOpenDetails}
                          onOpenEdit={handleOpenEdit}
                          canManage={canManage}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    {visibleCols.key && (
                      <th
                        className="cursor-pointer"
                        onClick={() => {
                          setSortBy('taskKey');
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        <div className="th-sortable">
                          <span>Key</span>
                          <ArrowUpDown size={13} />
                        </div>
                      </th>
                    )}
                    {visibleCols.title && (
                      <th
                        className="cursor-pointer"
                        onClick={() => {
                          setSortBy('title');
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        <div className="th-sortable">
                          <span>Title</span>
                          <ArrowUpDown size={13} />
                        </div>
                      </th>
                    )}
                    {visibleCols.project && <th>Project</th>}
                    {visibleCols.assignees && <th>Assignees</th>}
                    {visibleCols.status && (
                      <th
                        className="cursor-pointer"
                        onClick={() => {
                          setSortBy('status');
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        <div className="th-sortable">
                          <span>Status</span>
                          <ArrowUpDown size={13} />
                        </div>
                      </th>
                    )}
                    {visibleCols.priority && (
                      <th
                        className="cursor-pointer"
                        onClick={() => {
                          setSortBy('priority');
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        <div className="th-sortable">
                          <span>Priority</span>
                          <ArrowUpDown size={13} />
                        </div>
                      </th>
                    )}
                    {visibleCols.dueDate && (
                      <th
                        className="cursor-pointer"
                        onClick={() => {
                          setSortBy('dueDate');
                          setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        <div className="th-sortable">
                          <span>Due Date</span>
                          <ArrowUpDown size={13} />
                        </div>
                      </th>
                    )}
                    {visibleCols.timeSpent && <th>Logged Time</th>}
                    {visibleCols.actions && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <TaskRow
                      key={task._id}
                      task={task}
                      visibleCols={visibleCols}
                      onOpenDetails={handleOpenDetails}
                      onOpenEdit={handleOpenEdit}
                      canManage={canManage}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          <div className="pagination-bar">
            <div className="pagination-info">
              Showing <span>{(page - 1) * limit + 1}</span>–<span>{Math.min(page * limit, totalTasks)}</span> of{' '}
              <span>{totalTasks}</span> deliverables
            </div>

            <div className="pagination-actions">
              <label className="limit-selector">
                Per page:
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>

              <div className="page-nav-btns">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={16} /> Prev
                </Button>
                <span className="current-page-tag">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isDetailsOpen}
        taskId={detailsTaskId}
        initialTab={detailsInitialTab}
        onClose={() => {
          setIsDetailsOpen(false);
          setDetailsTaskId(null);
        }}
        onTaskUpdated={fetchTasks}
        users={users}
      />

      {/* Create Task Modal */}
      {canManage && <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Deliverable"
      >
        <form onSubmit={handleCreateSubmit} className="form-stack">
          {formError && <div className="form-error-banner">{formError}</div>}

          <FormField label="Task Title" required>
            <input
              type="text"
              className="input-field"
              placeholder="e.g. Implement user onboarding flow"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
            />
          </FormField>

          <FormField label="Project" required>
            <select
              className="input-field"
              value={formProject}
              onChange={(e) => setFormProject(e.target.value)}
              required
            >
              <option value="">Select Target Project</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Description">
            <textarea
              className="input-field textarea"
              rows={3}
              placeholder="Provide detailed instructions or deliverable acceptance criteria..."
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </FormField>

          <div className="form-grid-2">
            <FormField label="Status">
              <select
                className="input-field"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
              >
                <option value="Backlog">Backlog</option>
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="Blocked">Blocked</option>
                <option value="In Review">In Review</option>
                <option value="Done">Done</option>
              </select>
            </FormField>

            <FormField label="Priority">
              <select
                className="input-field"
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </FormField>
          </div>

          <div className="form-grid-2">
            <FormField label="Start Date">
              <input
                type="date"
                className="input-field"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
              />
            </FormField>

            <FormField label="Due Date">
              <input
                type="date"
                className="input-field"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
              />
            </FormField>
          </div>

          <div className="modal-actions-footer">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Create Task
            </Button>
          </div>
        </form>
      </Modal>}

      {/* Edit Task Modal */}
      {canManage && <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={`Edit ${selectedTask?.taskKey || 'Task'}`}
      >
        <form onSubmit={handleEditSubmit} className="form-stack">
          {formError && <div className="form-error-banner">{formError}</div>}

          <FormField label="Task Title" required>
            <input
              type="text"
              className="input-field"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
            />
          </FormField>

          <FormField label="Description">
            <textarea
              className="input-field textarea"
              rows={3}
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </FormField>

          <div className="form-grid-2">
            <FormField label="Status">
              <select
                className="input-field"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
              >
                <option value="Backlog">Backlog</option>
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="Blocked">Blocked</option>
                <option value="In Review">In Review</option>
                <option value="Done">Done</option>
              </select>
            </FormField>

            <FormField label="Priority">
              <select
                className="input-field"
                value={formPriority}
                onChange={(e) => setFormPriority(e.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </FormField>
          </div>

          <div className="form-grid-2">
            <FormField label="Start Date">
              <input
                type="date"
                className="input-field"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
              />
            </FormField>

            <FormField label="Due Date">
              <input
                type="date"
                className="input-field"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
              />
            </FormField>
          </div>

          <div className="modal-actions-footer">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>}
    </PageContainer>
  );
};

// Row component for Table view
const TaskRow = ({ task, visibleCols, onOpenDetails, onOpenEdit, canManage }) => {
  const overdue = isTaskOverdue(task.dueDate) && task.status !== 'Done';
  const hours = task.totalTimeSpentMinutes ? (task.totalTimeSpentMinutes / 60).toFixed(1) : '0';

  return (
    <tr onClick={() => onOpenDetails(task)} className="cursor-pointer hover:bg-slate-50">
      {visibleCols.key && (
        <td className="font-semibold text-sky-600">
          <span className="task-key-tag">{task.taskKey}</span>
        </td>
      )}
      {visibleCols.title && (
        <td className="font-medium">
          <span title={task.title}>{task.title}</span>
        </td>
      )}
      {visibleCols.project && (
        <td>{task.project?.name || '—'}</td>
      )}
      {visibleCols.assignees && (
        <td>
          <span className="text-slate-700 font-medium">Owner</span>
        </td>
      )}
      {visibleCols.status && (
        <td><StatusBadge status={task.status} size="sm" /></td>
      )}
      {visibleCols.priority && (
        <td><StatusBadge status={task.priority} size="sm" /></td>
      )}
      {visibleCols.dueDate && (
        <td className={overdue ? 'text-rose-600 font-semibold' : ''}>
          {task.dueDate ? formatDate(task.dueDate) : '—'}
        </td>
      )}
      {visibleCols.timeSpent && (
        <td>
          <span className="text-slate-600 font-medium">{hours} hrs</span>
        </td>
      )}
      {visibleCols.actions && (
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          <div className="table-actions-btns">
            <button
              className="action-icon-btn"
              title="Inspect task details"
              onClick={() => onOpenDetails(task)}
            >
              <Eye size={15} />
            </button>
            {canManage && <button
              className="action-icon-btn"
              title="Edit task"
              onClick={() => onOpenEdit(task)}
            >
              <Edit2 size={15} />
            </button>}
          </div>
        </td>
      )}
    </tr>
  );
};

export default AllTasksPage;

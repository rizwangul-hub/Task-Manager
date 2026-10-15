import React, { useState, useEffect, useCallback } from 'react';
import PageContainer from '../components/layout/PageContainer';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import ConfirmationDialog from '../components/ui/ConfirmationDialog';
import StatusBadge from '../components/ui/StatusBadge';
import EmptyState from '../components/ui/EmptyState';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import { projectService } from '../services/projectService';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  FolderKanban,
  Plus,
  Search,
  Calendar,
  User,
  Edit2,
  Archive,
  RotateCcw
} from 'lucide-react';

export const ProjectsPage = () => {
  const { canManageBoard } = useAuth();
  const canManage = canManageBoard();
  const { toast } = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [archiveTargetProject, setArchiveTargetProject] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formKey, setFormKey] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState('Active');
  const [formStartDate, setFormStartDate] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formError, setFormError] = useState('');

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await projectService.getProjects({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        archived: showArchived ? 'true' : 'false'
      });
      setProjects(res.data.projects);
    } catch (err) {
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, showArchived]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const resetForm = () => {
    setFormName('');
    setFormKey('');
    setFormDesc('');
    setFormStatus('Active');
    setFormStartDate('');
    setFormDueDate('');
    setFormError('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (project) => {
    setSelectedProject(project);
    setFormName(project.name);
    setFormKey(project.projectKey);
    setFormDesc(project.description || '');
    setFormStatus(project.status || 'Active');
    setFormStartDate(project.startDate ? project.startDate.split('T')[0] : '');
    setFormDueDate(project.dueDate ? project.dueDate.split('T')[0] : '');
    setFormError('');
    setIsEditModalOpen(true);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formName.trim() || !formKey.trim()) {
      setFormError('Project name and key are required.');
      return;
    }

    setSubmitting(true);
    try {
      await projectService.createProject({
        name: formName.trim(),
        projectKey: formKey.toUpperCase().trim(),
        description: formDesc.trim(),
        status: formStatus,
        startDate: formStartDate || null,
        dueDate: formDueDate || null
      });
      toast.success('Project created successfully.');
      setIsCreateModalOpen(false);
      fetchProjects();
    } catch (err) {
      setFormError(err.message || 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProject) return;
    setFormError('');

    setSubmitting(true);
    try {
      await projectService.updateProject(selectedProject._id, {
        name: formName.trim(),
        description: formDesc.trim(),
        status: formStatus,
        startDate: formStartDate || null,
        dueDate: formDueDate || null
      });
      toast.success('Project updated successfully.');
      setIsEditModalOpen(false);
      fetchProjects();
    } catch (err) {
      setFormError(err.message || 'Failed to update project.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!archiveTargetProject) return;
    setSubmitting(true);
    try {
      const willArchive = !archiveTargetProject.isArchived;
      await projectService.archiveProject(archiveTargetProject._id, willArchive);
      toast.success(`Project ${willArchive ? 'archived' : 'restored'} successfully.`);
      setArchiveTargetProject(null);
      fetchProjects();
    } catch (err) {
      toast.error(err.message || 'Failed to update project archive status.');
    } finally {
      setSubmitting(false);
    }
  };

  const pageActions = canManage && (
    <Button variant="primary" size="md" icon={Plus} onClick={handleOpenCreate}>
      New Project
    </Button>
  );

  return (
    <PageContainer
      title="Projects"
      subtitle="Organize initiatives and milestones in your private workspace."
      badge={<StatusBadge status="active" label={`${projects.length} Projects`} />}
      actions={pageActions}
    >
      {/* Search and Filters Bar */}
      <div className="filter-controls-bar">
        <div className="filter-search-box">
          <Search size={16} className="filter-search-icon" />
          <input
            type="search"
            placeholder="Search projects by name, key, or summary..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-search-input"
          />
        </div>

        <div className="filter-select-group">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Planning">Planning</option>
            <option value="On Hold">On Hold</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>

          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show Archived</span>
          </label>
        </div>
      </div>

      {/* Main Content Area */}
      {loading && <LoadingState message="Loading projects..." />}

      {error && (
        <ErrorState
          title="Could not load projects"
          message={error}
          onRetry={fetchProjects}
        />
      )}

      {!loading && !error && projects.length === 0 && (
        <EmptyState
          icon={FolderKanban}
          title="No Projects Found"
          description={
            search || statusFilter
              ? 'No projects match your filter criteria.'
              : 'Create your first project to begin managing tasks and milestones.'
          }
          actionLabel={canManage && !search && !statusFilter ? 'Create First Project' : undefined}
          actionIcon={canManage ? Plus : undefined}
          onAction={canManage ? handleOpenCreate : undefined}
        />
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="projects-card-grid">
          {projects.map((project) => {
            return (
              <div key={project._id} className={`project-card ${project.isArchived ? 'archived' : ''}`}>
                <div className="project-card-header">
                  <div className="project-key-pill">{project.projectKey}</div>
                  <StatusBadge status={project.status} />
                </div>

                <h3 className="project-card-title">{project.name}</h3>
                <p className="project-card-desc">
                  {project.description || 'No project description provided.'}
                </p>

                <div className="project-meta-list">
                  <div className="project-meta-row">
                    <User size={14} className="meta-icon" />
                    <span>Owner: <strong>{project.manager?.name || 'Workspace Manager'}</strong></span>
                  </div>

                  <div className="project-meta-row">
                    <Calendar size={14} className="meta-icon" />
                    <span>
                      Due: {project.dueDate ? new Date(project.dueDate).toLocaleDateString() : 'No deadline'}
                    </span>
                  </div>
                </div>

                {canManage && (
                  <div className="project-card-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={Edit2}
                      onClick={() => handleOpenEdit(project)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={project.isArchived ? RotateCcw : Archive}
                      onClick={() => setArchiveTargetProject(project)}
                    >
                      {project.isArchived ? 'Restore' : 'Archive'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Project Modal */}
      {canManage && <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Project"
      >
        <form onSubmit={handleCreateSubmit} className="modal-form">
          {formError && <p className="modal-form-error">{formError}</p>}

          <FormField
            id="proj-name"
            label="Project Name"
            placeholder="e.g. Mobile Application Revamp"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />

          <FormField
            id="proj-key"
            label="Project Key (Unique prefix for tasks)"
            placeholder="e.g. MOB, CORE, OPS"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value.toUpperCase())}
            helperText="2-6 uppercase letters. Will prefix all task identifiers (e.g. MOB-1)."
            required
          />

          <FormField
            id="proj-desc"
            label="Description"
            as="textarea"
            placeholder="Project goals, deliverable scope, and milestones..."
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
          />

          <FormField
            id="proj-status"
            label="Initial Status"
            as="select"
            value={formStatus}
            onChange={(e) => setFormStatus(e.target.value)}
          >
            <option value="Active">Active</option>
            <option value="Planning">Planning</option>
            <option value="On Hold">On Hold</option>
          </FormField>

          <div className="form-row-2">
            <FormField
              id="proj-start"
              label="Start Date"
              type="date"
              value={formStartDate}
              onChange={(e) => setFormStartDate(e.target.value)}
            />

            <FormField
              id="proj-due"
              label="Target Due Date"
              type="date"
              value={formDueDate}
              onChange={(e) => setFormDueDate(e.target.value)}
            />
          </div>

          <div className="modal-actions-right">
            <Button variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Create Project
            </Button>
          </div>
        </form>
      </Modal>}

      {/* Edit Project Modal */}
      {canManage && <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={`Edit Project: ${selectedProject?.projectKey}`}
      >
        <form onSubmit={handleEditSubmit} className="modal-form">
          {formError && <p className="modal-form-error">{formError}</p>}

          <FormField
            id="edit-name"
            label="Project Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />

          <FormField
            id="edit-desc"
            label="Description"
            as="textarea"
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
          />

          <FormField
            id="edit-status"
            label="Status"
            as="select"
            value={formStatus}
            onChange={(e) => setFormStatus(e.target.value)}
          >
            <option value="Active">Active</option>
            <option value="Planning">Planning</option>
            <option value="On Hold">On Hold</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </FormField>

          <div className="form-row-2">
            <FormField
              id="edit-start"
              label="Start Date"
              type="date"
              value={formStartDate}
              onChange={(e) => setFormStartDate(e.target.value)}
            />

            <FormField
              id="edit-due"
              label="Due Date"
              type="date"
              value={formDueDate}
              onChange={(e) => setFormDueDate(e.target.value)}
            />
          </div>

          <div className="modal-actions-right">
            <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={submitting}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>}

      {/* Archive / Restore Confirmation Dialog */}
      {canManage && <ConfirmationDialog
        isOpen={Boolean(archiveTargetProject)}
        onClose={() => setArchiveTargetProject(null)}
        onConfirm={handleToggleArchive}
        title={archiveTargetProject?.isArchived ? 'Restore Project' : 'Archive Project'}
        message={
          archiveTargetProject?.isArchived
            ? `Restore '${archiveTargetProject?.name}' back to active workspace?`
            : `Archive '${archiveTargetProject?.name}'? Its tasks and history will be preserved but hidden from normal workspace views.`
        }
        confirmLabel={archiveTargetProject?.isArchived ? 'Restore' : 'Archive'}
        variant={archiveTargetProject?.isArchived ? 'info' : 'warning'}
        isLoading={submitting}
      />}
    </PageContainer>
  );
};

export default ProjectsPage;

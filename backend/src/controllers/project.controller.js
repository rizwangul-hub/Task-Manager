import { Project, PROJECT_STATUSES } from '../models/project.model.js';
import { User, USER_ROLES } from '../models/user.model.js';
import { notificationService } from '../services/notification.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const projectController = {
  /**
   * List projects accessible to the authenticated user
   * GET /api/projects
   */
  getProjects: async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const skip = (page - 1) * limit;

      const query = {};

      // Archived filter: default excludes archived unless requested
      if (req.query.archived === 'true') {
        query.isArchived = true;
      } else {
        query.isArchived = false;
      }

      // Members only see boards they belong to; managers and admins manage all boards.
      if (req.user.role === USER_ROLES.MEMBER) {
        query.$or = [{ members: req.user._id }, { manager: req.user._id }];
      }

      // Status filter
      if (req.query.status && Object.values(PROJECT_STATUSES).includes(req.query.status)) {
        query.status = req.query.status;
      }

      // Search by name or description or projectKey
      if (req.query.search) {
        const regex = new RegExp(req.query.search.trim(), 'i');
        query.$and = query.$and || [];
        query.$and.push({
          $or: [{ name: regex }, { projectKey: regex }, { description: regex }]
        });
      }

      const [projects, total] = await Promise.all([
        Project.find(query)
          .populate('manager', 'name email role')
          .populate('members', 'name email role')
          .populate('createdBy', 'name email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Project.countDocuments(query)
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          projects: projects.map((p) => p.toJSON()),
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get project by ID
   * GET /api/projects/:id
   */
  getProjectById: async (req, res, next) => {
    try {
      const project = await Project.findById(req.params.id)
        .populate('manager', 'name email role')
        .populate('members', 'name email role')
        .populate('createdBy', 'name email');

      if (!project) {
        return next(new AppError('Project not found.', 404));
      }

      // Members can only view boards they belong to.
      if (req.user.role === USER_ROLES.MEMBER) {
        const isMember = project.members.some((m) => (m._id || m).toString() === req.user._id.toString());
        const isManager = (project.manager?._id || project.manager).toString() === req.user._id.toString();

        if (!isMember && !isManager) {
          return next(new AppError('Access denied: You are not an authorized member or manager of this project.', 403));
        }
      }

      res.status(200).json({
        status: 'success',
        data: { project: project.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a new project (Admin or Manager)
   * POST /api/projects
   */
  createProject: async (req, res, next) => {
    const { name, description, projectKey, status, startDate, dueDate, manager, members } = req.body;

    if (!name || !projectKey) {
      return next(new AppError('Project name and unique project key are required.', 400));
    }

    const normalizedKey = projectKey.toUpperCase().trim();

    try {
      const existingProject = await Project.findOne({ projectKey: normalizedKey });
      if (existingProject) {
        return next(new AppError(`Project with key '${normalizedKey}' already exists.`, 409));
      }

      // Determine manager: defaults to current user
      let assignedManagerId = req.user._id;
      if (manager) {
        const managerUser = await User.findById(manager);
        if (managerUser && managerUser.isActive) {
          assignedManagerId = managerUser._id;
        }
      }

      // Determine members: default to current user in single-user workspace
      const memberIds = [req.user._id];
      if (Array.isArray(members)) {
        for (const mid of members) {
          const u = await User.findById(mid);
          if (u && u.isActive && !memberIds.some((id) => id.toString() === u._id.toString())) {
            memberIds.push(u._id);
          }
        }
      }

      // Date validation
      if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
        return next(new AppError('Start date cannot be after due date.', 400));
      }

      const project = await Project.create({
        name: name.trim(),
        description: (description || '').trim(),
        projectKey: normalizedKey,
        status: status && Object.values(PROJECT_STATUSES).includes(status) ? status : PROJECT_STATUSES.ACTIVE,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        manager: assignedManagerId,
        members: memberIds,
        createdBy: req.user._id
      });

      const populated = await Project.findById(project._id)
        .populate('manager', 'name email role')
        .populate('members', 'name email role')
        .populate('createdBy', 'name email');

      res.status(201).json({
        status: 'success',
        message: 'Project created successfully.',
        data: { project: populated.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update project details (Admin or assigned Project Manager)
   * PUT /api/projects/:id
   */
  updateProject: async (req, res, next) => {
    const { id } = req.params;
    const { name, description, status, startDate, dueDate, manager, members } = req.body;

    try {
      const project = await Project.findById(id);
      if (!project) {
        return next(new AppError('Project not found.', 404));
      }

      if (name) project.name = name.trim();
      if (description !== undefined) project.description = description.trim();
      if (status && Object.values(PROJECT_STATUSES).includes(status)) project.status = status;

      if (startDate !== undefined) project.startDate = startDate ? new Date(startDate) : null;
      if (dueDate !== undefined) project.dueDate = dueDate ? new Date(dueDate) : null;

      if (project.startDate && project.dueDate && project.startDate > project.dueDate) {
        return next(new AppError('Start date cannot be after due date.', 400));
      }

      if (manager && req.user.role === USER_ROLES.ADMIN) {
        const mgr = await User.findById(manager);
        if (!mgr || !mgr.isActive) {
          return next(new AppError('Selected manager is invalid or inactive.', 400));
        }
        project.manager = mgr._id;
      }

      let addedMembers = [];
      if (Array.isArray(members)) {
        const prevMemberStrings = (project.members || []).map((m) => m.toString());
        const newMemberStrings = members.map((m) => m.toString());
        addedMembers = newMemberStrings.filter((m) => !prevMemberStrings.includes(m));
        project.members = members;
      }

      await project.save();

      if (addedMembers.length > 0) {
        await notificationService.notifyProjectMemberAdded(project, req.user, addedMembers);
      }

      const populated = await Project.findById(project._id)
        .populate('manager', 'name email role')
        .populate('members', 'name email role')
        .populate('createdBy', 'name email');

      res.status(200).json({
        status: 'success',
        message: 'Project updated successfully.',
        data: { project: populated.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Archive or Unarchive a project without deleting historical data
   * PATCH /api/projects/:id/archive
   */
  archiveProject: async (req, res, next) => {
    const { id } = req.params;
    const { isArchived } = req.body;

    if (typeof isArchived !== 'boolean') {
      return next(new AppError('isArchived boolean value is required.', 400));
    }

    try {
      const project = await Project.findById(id);
      if (!project) {
        return next(new AppError('Project not found.', 404));
      }

      project.isArchived = isArchived;
      await project.save();

      res.status(200).json({
        status: 'success',
        message: `Project ${isArchived ? 'archived' : 'restored'} successfully.`,
        data: { project: project.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  deleteProject: async (req, res, next) => {
    req.body = { isArchived: true };
    return projectController.archiveProject(req, res, next);
  }
};

export default projectController;

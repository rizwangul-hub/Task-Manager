import { Task, TASK_STATUSES, TASK_PRIORITIES } from '../models/task.model.js';
import mongoose from 'mongoose';
import { Contact } from '../models/contact.model.js';
import { Project } from '../models/project.model.js';
import { User, USER_ROLES } from '../models/user.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { notificationService } from '../services/notification.service.js';
import { socketService } from '../services/socket.service.js';
import { taskAssignmentNotificationService } from '../services/taskAssignmentNotification.service.js';
import { sendWhatsAppTaskNotification } from '../services/whatsappService.js';
import { buildCsvString } from '../utils/csv.js';
import { AppError } from '../middleware/errorHandler.js';

export const taskController = {
  /**
   * Get tasks with comprehensive filtering, search, and pagination
   * GET /api/tasks
   */
  getTasks: async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const skip = (page - 1) * limit;

      const query = {};

      // Archived filter
      query.isArchived = req.query.archived === 'true';

      // Project filter
      if (req.query.project) {
        query.project = req.query.project;
      }

      // Status filter
      if (req.query.status && Object.values(TASK_STATUSES).includes(req.query.status)) {
        query.status = req.query.status;
      }

      // Priority filter
      if (req.query.priority && Object.values(TASK_PRIORITIES).includes(req.query.priority)) {
        query.priority = req.query.priority;
      }

      // Assignee filter
      if (req.query.assignee) {
        if (req.query.assignee === 'me') {
          query.assignees = req.user._id;
        } else {
          query.assignees = req.query.assignee;
        }
      }
      if (req.query.contactId) {
        if (!mongoose.isValidObjectId(req.query.contactId)) {
          return next(new AppError('Invalid contact filter.', 400));
        }
        query.assignedContact = req.query.contactId;
      }

      // Search by title or taskKey or description
      if (req.query.search) {
        const regex = new RegExp(req.query.search.trim(), 'i');
        query.$or = [{ title: regex }, { taskKey: regex }, { description: regex }];
      }

      // Due date quick filters (overdue, today)
      const now = new Date();
      if (req.query.dueFilter === 'overdue') {
        query.dueDate = { $lt: now };
        query.status = { $ne: TASK_STATUSES.DONE };
      } else if (req.query.dueFilter === 'today') {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        query.dueDate = { $gte: startOfDay, $lte: endOfDay };
      }

      // Date Range Filters (for Calendar, Timeline, & Workspace)
      if (req.query.dueDateFrom || req.query.dueDateTo) {
        query.dueDate = query.dueDate || {};
        if (req.query.dueDateFrom) {
          query.dueDate.$gte = new Date(req.query.dueDateFrom);
        }
        if (req.query.dueDateTo) {
          const toDate = new Date(req.query.dueDateTo);
          toDate.setHours(23, 59, 59, 999);
          query.dueDate.$lte = toDate;
        }
      }

      if (req.query.startDateFrom || req.query.startDateTo) {
        query.startDate = query.startDate || {};
        if (req.query.startDateFrom) {
          query.startDate.$gte = new Date(req.query.startDateFrom);
        }
        if (req.query.startDateTo) {
          const toDate = new Date(req.query.startDateTo);
          toDate.setHours(23, 59, 59, 999);
          query.startDate.$lte = toDate;
        }
      }

      // Unscheduled vs scheduled tasks filter
      if (req.query.hasDates === 'false') {
        query.dueDate = null;
        query.startDate = null;
      } else if (req.query.hasDates === 'true') {
        query.$or = query.$or || [];
        query.$or.push({ dueDate: { $ne: null } }, { startDate: { $ne: null } });
      }

      // Members can see tasks on their boards and tasks assigned directly to them.
      if (req.user.role === USER_ROLES.MEMBER) {
        const userProjects = await Project.find({
          $or: [{ members: req.user._id }, { manager: req.user._id }]
        }).select('_id');
        const authorizedProjectIds = userProjects.map((p) => p._id.toString());

        if (req.query.project) {
          // If querying a specific project, user must belong to it; otherwise restrict strictly to their assigned tasks
          const isAffiliated = authorizedProjectIds.includes(req.query.project.toString());
          if (!isAffiliated) {
            query.assignees = req.user._id;
          }
        } else {
          // If no specific project filtered, restrict to affiliated projects OR tasks assigned to user
          query.$and = query.$and || [];
          query.$and.push({
            $or: [{ assignees: req.user._id }, { project: { $in: authorizedProjectIds } }]
          });
        }
      }

      // Dynamic sorting
      const sortBy = req.query.sortBy || req.query.sort || 'createdAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      const allowedSortFields = ['createdAt', 'updatedAt', 'dueDate', 'startDate', 'priority', 'status', 'title', 'taskKey', 'totalTimeSpentMinutes'];
      const sort = allowedSortFields.includes(sortBy)
        ? { [sortBy]: sortOrder, _id: -1 }
        : { createdAt: -1 };

      const [tasks, total] = await Promise.all([
        Task.find(query)
          .populate('project', 'name projectKey status')
          .populate('creator', 'name email')
          .populate('assignees', 'name email role phone whatsappNumber')
          .populate('assignedContact', 'fullName whatsappNumber isActive')
          .sort(sort)
          .skip(skip)
          .limit(limit),
        Task.countDocuments(query)
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          tasks: tasks.map((t) => t.toJSON()),
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get task by ID
   * GET /api/tasks/:id
   */
  getTaskById: async (req, res, next) => {
    try {
      const task = await Task.findById(req.params.id)
        .populate('project', 'name projectKey status manager members')
        .populate('creator', 'name email')
        .populate('assignees', 'name email role phone whatsappNumber')
        .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');

      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Members must belong to the board or be assigned to the task.
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees.some((a) => (a._id || a).toString() === req.user._id.toString());
        const isProjectMember =
          task.project?.members?.some((m) => (m._id || m).toString() === req.user._id.toString()) ||
          (task.project?.manager?._id || task.project?.manager)?.toString() === req.user._id.toString();

        if (!isAssignee && !isProjectMember) {
          return next(new AppError('Access denied: You are not authorized to view this task.', 403));
        }
      }

      const whatsappNotifications = await taskAssignmentNotificationService.getForTask(task._id);
      res.status(200).json({
        status: 'success',
        data: {
          task: {
            ...task.toJSON(),
            whatsappNotifications: whatsappNotifications.map((entry) => entry.toJSON())
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  getWhatsAppNotifications: async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError('Invalid task ID.', 400));
    }
    try {
      const task = await Task.findById(req.params.id)
        .populate('project', 'manager members')
        .select('_id assignees');
      if (!task) return next(new AppError('Task not found.', 404));
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees.some((id) => id.toString() === req.user._id.toString());
        const isProjectMember = task.project?.members?.some((id) => id.toString() === req.user._id.toString()) ||
          task.project?.manager?.toString() === req.user._id.toString();
        if (!isAssignee && !isProjectMember) {
          return next(new AppError('Access denied: You are not authorized to view this task.', 403));
        }
      }
      const notifications = await taskAssignmentNotificationService.getForTask(task._id);
      res.status(200).json({
        status: 'success',
        data: { notifications: notifications.map((item) => item.toJSON()) }
      });
    } catch (error) {
      next(error);
    }
  },

  retryWhatsAppNotification: async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError('Invalid task ID.', 400));
    }
    try {
      const task = await Task.findById(req.params.id)
        .populate('project', 'name projectKey')
        .populate('assignees', 'name email role phone whatsappNumber')
        .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');

      if (!task) return next(new AppError('Task not found.', 404));

      // Resolve recipient phone number
      let recipient = null;
      let recipientName = 'Team Member';

      if (task.assignedContact?.whatsappNumber) {
        recipient = task.assignedContact.whatsappNumber;
        recipientName = task.assignedContact.fullName || 'Team Member';
      } else if (task.assignees?.length > 0) {
        const assignedUser = task.assignees.find((u) => u.whatsappNumber || u.phone) || task.assignees[0];
        recipient = assignedUser.whatsappNumber || assignedUser.phone;
        recipientName = assignedUser.name || 'Team Member';
      }

      if (!recipient) {
        task.whatsappNotificationStatus = 'failed';
        task.whatsappNotificationError = 'No WhatsApp phone number configured on assigned contact or user.';
        await task.save();
        return res.status(400).json({
          status: 'fail',
          message: task.whatsappNotificationError,
          data: { task: task.toJSON() }
        });
      }

      const messageText = [
        `Hello ${recipientName},`,
        '',
        'You have been assigned a task.',
        '',
        `Task: ${task.title}`,
        `Project: ${task.project?.name || 'Project'}`,
        `Priority: ${task.priority}`,
        `Due Date: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }) : 'No deadline'}`,
        task.description ? `\nDescription: ${task.description}` : '',
        '',
        'Please review the task details and contact the task manager if you have any questions.',
        '',
        'Thank you.'
      ].filter(Boolean).join('\n');

      const result = await sendWhatsAppTaskNotification(recipient, messageText, {
        taskTitle: task.title
      });

      if (result.success) {
        task.whatsappNotificationStatus = 'sent';
        task.whatsappNotificationSent = true;
        task.whatsappNotificationError = null;
        await task.save();
      } else {
        task.whatsappNotificationStatus = 'failed';
        task.whatsappNotificationSent = false;
        task.whatsappNotificationError = result.error || result.reason;
        await task.save();
      }

      // If notificationId is provided, also update TaskWhatsAppNotification
      if (req.params.notificationId && mongoose.isValidObjectId(req.params.notificationId)) {
        try {
          const { TaskWhatsAppNotification, TASK_WHATSAPP_STATUSES } = await import(
            '../models/taskWhatsAppNotification.model.js'
          );
          await TaskWhatsAppNotification.findByIdAndUpdate(req.params.notificationId, {
            status: result.success ? TASK_WHATSAPP_STATUSES.SENT : TASK_WHATSAPP_STATUSES.FAILED,
            failureReason: result.success ? null : (result.error || result.reason),
            sentAt: result.success ? new Date() : null,
            providerMessageId: result.messageId || null
          });
        } catch {
          // Best effort sync
        }
      }

      res.status(result.success ? 200 : 400).json({
        status: result.success ? 'success' : 'fail',
        message: result.success
          ? 'WhatsApp notification sent successfully.'
          : (result.error || result.reason || 'Failed to dispatch WhatsApp notification.'),
        data: { task: task.toJSON(), result }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a new task in a project
   * POST /api/tasks
   */
  createTask: async (req, res, next) => {
    const {
      title,
      description,
      project: projectId,
      contactId,
      idempotencyKey,
      assignee,
      assignees,
      status,
      priority,
      startDate,
      dueDate
    } = req.body;

    if (!title || !projectId) {
      return next(new AppError('Task title and project reference are required.', 400));
    }
    if (idempotencyKey !== undefined &&
        (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
      return next(new AppError('Task creation request key is invalid.', 400));
    }

    try {
      if (idempotencyKey) {
        const existing = await Task.findOne({
          creator: req.user._id,
          creationRequestId: idempotencyKey
        })
          .populate('project', 'name projectKey manager members')
          .populate('creator', 'name email')
          .populate('assignees', 'name email role')
          .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');
        if (existing) {
          const notifications = await taskAssignmentNotificationService.getForTask(existing._id);
          if (existing.assignedContact) {
            await taskAssignmentNotificationService.enqueue(existing, existing.assignedContact);
          }
          return res.status(200).json({
            status: 'success',
            message: 'Task creation request was already processed.',
            data: {
              task: {
                ...existing.toJSON(),
                whatsappNotifications: notifications.map((entry) => entry.toJSON())
              }
            }
          });
        }
      }

      const project = await Project.findById(projectId);
      if (!project || project.isArchived) {
        return next(new AppError('Target project does not exist or has been archived.', 404));
      }

      let assignedContact = null;
      if (contactId) {
        if (!mongoose.isValidObjectId(contactId)) {
          return next(new AppError('Invalid contact selection.', 400));
        }
        assignedContact = await Contact.findOne({ _id: contactId, isActive: true });
        if (!assignedContact) {
          return next(new AppError('Select an active contact before assigning this task.', 400));
        }
      }

      // Managers may assign any active workspace user; assignment grants board visibility.
      const validatedAssigneeIds = [];
      const requestedAssignees = Array.isArray(assignees)
        ? assignees
        : assignee
          ? [assignee]
          : [];
      if (requestedAssignees.length > 0) {
        for (const uid of requestedAssignees) {
          const user = await User.findById(uid);
          if (user && user.isActive) {
            validatedAssigneeIds.push(user._id);
            if (!project.members.some((member) => member.toString() === user._id.toString())) {
              project.members.push(user._id);
            }
          }
        }
      }
      if (validatedAssigneeIds.length === 0 && !Object.prototype.hasOwnProperty.call(req.body, 'assignee')) {
        validatedAssigneeIds.push(req.user._id);
      }
      await project.save();

      // Date validation
      if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
        return next(new AppError('Start date cannot be after due date.', 400));
      }

      // Generate incremental taskKey based on existing tasks in project
      const count = await Task.countDocuments({ project: project._id });
      const taskKey = `${project.projectKey}-${count + 1}`;

      const initialStatus = status && Object.values(TASK_STATUSES).includes(status) ? status : TASK_STATUSES.TO_DO;

      const task = await Task.create({
        title: title.trim(),
        description: (description || '').trim(),
        project: project._id,
        taskKey,
        creator: req.user._id,
        ...(idempotencyKey ? { creationRequestId: idempotencyKey } : {}),
        assignees: validatedAssigneeIds,
        assignedContact: assignedContact?._id || null,
        contactAssignmentId: assignedContact ? new mongoose.Types.ObjectId() : null,
        contactAssignedAt: assignedContact ? new Date() : null,
        status: initialStatus,
        priority: priority && Object.values(TASK_PRIORITIES).includes(priority) ? priority : TASK_PRIORITIES.MEDIUM,
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        completedAt: initialStatus === TASK_STATUSES.DONE ? new Date() : null
      });

      // Audit log event
      await TaskEvent.logEvent({
        task: task._id,
        project: project._id,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.TASK_CREATED,
        details: {
          title: task.title,
          taskKey: task.taskKey,
          status: task.status,
          priority: task.priority
        }
      });

      const populated = await Task.findById(task._id)
        .populate('project', 'name projectKey manager members')
        .populate('creator', 'name email')
        .populate('assignees', 'name email role phone whatsappNumber')
        .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');

      const taskPayload = populated.toJSON();
      const getUserId = (userRef) => userRef?._id?.toString() || userRef?.toString();
      const authorizedUserIds = new Set([
        getUserId(populated.creator),
        ...(populated.assignees || []).map(getUserId),
        getUserId(populated.project?.manager),
        ...(populated.project?.members || []).map(getUserId)
      ].filter(Boolean));
      if (socketService.getIO()) {
        for (const userId of authorizedUserIds) {
          socketService.emitUserEvent(userId, 'task:created', taskPayload);
        }
      } else {
        console.warn(`[SOCKET_EMIT] Socket.IO is unavailable for created task ${populated.taskKey}.`);
      }

      // Dispatch notifications to assignees
      if (populated.assignees && populated.assignees.length > 0) {
        await notificationService.notifyTaskAssigned(
          populated,
          req.user,
          populated.assignees.map((a) => a._id || a)
        );

      }

      if (assignedContact) {
        console.info(`[TASK_ASSIGNMENT] Queuing WhatsApp notification for contact ${assignedContact.fullName}.`);
        await taskAssignmentNotificationService.enqueue(populated, assignedContact);
      }

      res.status(201).json({
        status: 'success',
        message: 'Task created successfully.',
        data: { task: populated.toJSON() }
      });
    } catch (error) {
      if (error.code === 11000 && idempotencyKey) {
        try {
          const existing = await Task.findOne({
            creator: req.user._id,
            creationRequestId: idempotencyKey
          })
            .populate('project', 'name projectKey manager members')
            .populate('creator', 'name email')
            .populate('assignees', 'name email role')
            .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');
          if (existing) {
            const notifications = await taskAssignmentNotificationService.getForTask(existing._id);
            if (existing.assignedContact) {
              await taskAssignmentNotificationService.enqueue(existing, existing.assignedContact);
            }
            return res.status(200).json({
              status: 'success',
              message: 'Task creation request was already processed.',
              data: {
                task: {
                  ...existing.toJSON(),
                  whatsappNotifications: notifications.map((entry) => entry.toJSON())
                }
              }
            });
          }
        } catch (lookupError) {
          return next(lookupError);
        }
      }
      next(error);
    }
  },

  /**
   * Update task details
   * PUT /api/tasks/:id
   */
  updateTask: async (req, res, next) => {
    const { id } = req.params;
    const {
      title,
      description,
      assignees,
      contactId,
      status,
      priority,
      startDate,
      dueDate,
      customFields
    } = req.body;

    try {
      const task = await Task.findById(id).populate('project');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      const isAssignee = task.assignees.some((a) => a.toString() === req.user._id.toString());
      const canManageTask = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.MANAGER;
      if (!canManageTask && !isAssignee) {
        return next(new AppError('Access forbidden: You cannot edit this task.', 403));
      }

      const prevStatus = task.status;
      const prevPriority = task.priority;
      const prevStartDate = task.startDate ? task.startDate.toISOString().split('T')[0] : null;
      const prevDueDate = task.dueDate ? task.dueDate.toISOString().split('T')[0] : null;
      const prevAssignees = (task.assignees || []).map((a) => a.toString());
      const prevContactId = task.assignedContact?.toString() || '';

      if (!canManageTask) {
        const allowedFields = new Set(['status', 'startDate', 'dueDate', 'customFields']);
        if (Object.keys(req.body).some((field) => !allowedFields.has(field))) {
          return next(new AppError('Members may only update status, dates, and task column values on tasks assigned to them.', 403));
        }
        if (status !== undefined) {
          if (!Object.values(TASK_STATUSES).includes(status)) {
            return next(new AppError('Valid task status is required.', 400));
          }
          task.status = status;
          task.completedAt = status === TASK_STATUSES.DONE ? (task.completedAt || new Date()) : null;
        }
        if (startDate !== undefined) task.startDate = startDate ? new Date(startDate) : null;
        if (dueDate !== undefined) {
          task.dueDate = dueDate ? new Date(dueDate) : null;
          const nextDueDate = task.dueDate && !Number.isNaN(task.dueDate.getTime())
            ? task.dueDate.toISOString().split('T')[0]
            : null;
          if (nextDueDate !== prevDueDate) task.reminderSent = false;
        }
        if (customFields !== undefined) {
          if (!Array.isArray(customFields)) {
            return next(new AppError('Custom fields must be provided as an array.', 400));
          }
          const currentFields = new Map(task.customFields.map((field) => [field.key, field]));
          const incomingValues = new Map();
          for (const field of customFields) {
            if (!field || typeof field.key !== 'string' || !currentFields.has(field.key)) {
              return next(new AppError('Members cannot add or change task column definitions.', 403));
            }
            const definition = currentFields.get(field.key);
            const validValue =
              field.value === null ||
              (definition.type === 'Text' && typeof field.value === 'string') ||
              (definition.type === 'Number' && typeof field.value === 'number' && Number.isFinite(field.value)) ||
              (definition.type === 'Date' && typeof field.value === 'string' && !Number.isNaN(Date.parse(field.value)));
            if (!validValue) {
              return next(new AppError(`Invalid value for the '${definition.label}' column.`, 400));
            }
            incomingValues.set(field.key, field.value);
          }
          for (const [key, value] of incomingValues) currentFields.get(key).value = value;
        }
        if (task.startDate && task.dueDate && task.startDate > task.dueDate) {
          return next(new AppError('Start date cannot be after due date.', 400));
        }
        await task.save();

        if (task.status !== prevStatus) {
          await TaskEvent.logEvent({
            task: task._id,
            project: task.project._id || task.project,
            user: req.user._id,
            action: TASK_EVENT_ACTIONS.STATUS_CHANGED,
            details: { previousValue: prevStatus, newValue: task.status }
          });
          await notificationService.notifyTaskStatusChanged(task, req.user, prevStatus, task.status);
        }
        const newStartDate = task.startDate ? task.startDate.toISOString().split('T')[0] : null;
        if (startDate !== undefined && newStartDate !== prevStartDate) {
          await TaskEvent.logEvent({
            task: task._id,
            project: task.project._id || task.project,
            user: req.user._id,
            action: TASK_EVENT_ACTIONS.START_DATE_CHANGED,
            details: { previousValue: prevStartDate, newValue: newStartDate }
          });
        }
        const newDueDate = task.dueDate ? task.dueDate.toISOString().split('T')[0] : null;
        if (dueDate !== undefined && newDueDate !== prevDueDate) {
          await TaskEvent.logEvent({
            task: task._id,
            project: task.project._id || task.project,
            user: req.user._id,
            action: TASK_EVENT_ACTIONS.DUE_DATE_CHANGED,
            details: { previousValue: prevDueDate, newValue: newDueDate }
          });
          await notificationService.notifyTaskDueDateChanged(task, req.user, task.dueDate);
        }

        const populated = await Task.findById(task._id)
          .populate('project', 'name projectKey manager')
          .populate('creator', 'name email')
          .populate('assignees', 'name email role');

        socketService.emitTaskUpdate(
          (populated.assignees || []).map((assignee) => (assignee._id || assignee).toString()),
          { type: 'UPDATED', task: populated.toJSON() }
        );

        return res.status(200).json({
          status: 'success',
          message: 'Task updated successfully.',
          data: { task: populated.toJSON() }
        });
      }

      // Managers and admins have full task-edit permissions.
      let contactAssignmentChanged = false;
      let newAssignedContact = null;
      if (title) task.title = title.trim();
      if (description !== undefined) task.description = description.trim();
      if (customFields !== undefined) {
        if (!Array.isArray(customFields)) {
          return next(new AppError('Custom fields must be provided as an array.', 400));
        }
        task.customFields = customFields;
      }

      if (status && Object.values(TASK_STATUSES).includes(status)) {
        task.status = status;
        task.completedAt = status === TASK_STATUSES.DONE ? (task.completedAt || new Date()) : null;
      }

      if (priority && Object.values(TASK_PRIORITIES).includes(priority)) {
        task.priority = priority;
      }

      if (startDate !== undefined) task.startDate = startDate ? new Date(startDate) : null;
      if (dueDate !== undefined) {
        const updatedDueDate = dueDate ? new Date(dueDate) : null;
        const updatedDueDateKey =
          updatedDueDate && !Number.isNaN(updatedDueDate.getTime())
            ? updatedDueDate.toISOString().split('T')[0]
            : null;
        task.dueDate = updatedDueDate;
        if (updatedDueDateKey !== prevDueDate) task.reminderSent = false;
      }

      if (task.startDate && task.dueDate && task.startDate > task.dueDate) {
        return next(new AppError('Start date cannot be after due date.', 400));
      }

      // Assignees update
      if (Array.isArray(assignees)) {
        const project = await Project.findById(task.project._id);
        const validated = [];
        for (const uid of assignees) {
          const u = await User.findById(uid);
          if (u && u.isActive) {
            validated.push(u._id);
            if (!project.members.some((member) => member.toString() === u._id.toString())) {
              project.members.push(u._id);
            }
          }
        }
        task.assignees = validated;
        await project.save();
      }

      if (contactId !== undefined) {
        const nextContactId = contactId || '';
        if (nextContactId !== prevContactId) {
          if (nextContactId) {
            if (!mongoose.isValidObjectId(nextContactId)) {
              return next(new AppError('Invalid contact selection.', 400));
            }
            newAssignedContact = await Contact.findOne({ _id: nextContactId, isActive: true });
            if (!newAssignedContact) {
              return next(new AppError('Select an active contact before assigning this task.', 400));
            }
          }
          task.assignedContact = newAssignedContact?._id || null;
          task.contactAssignmentId = newAssignedContact ? new mongoose.Types.ObjectId() : null;
          task.contactAssignedAt = newAssignedContact ? new Date() : null;
          task.whatsappNotificationSent = false;
          contactAssignmentChanged = true;
        }
      }

      await task.save();

      // Check diffs for audit events
      if (status && task.status !== prevStatus) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project._id || task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.STATUS_CHANGED,
          details: { previousValue: prevStatus, newValue: task.status }
        });
      }

      if (priority && task.priority !== prevPriority) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project._id || task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.PRIORITY_CHANGED,
          details: { previousValue: prevPriority, newValue: task.priority }
        });
      }

      const newDueDate = task.dueDate ? task.dueDate.toISOString().split('T')[0] : null;
      if (dueDate !== undefined && newDueDate !== prevDueDate) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project._id || task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.DUE_DATE_CHANGED,
          details: { previousValue: prevDueDate, newValue: newDueDate }
        });
      }

      if (Array.isArray(assignees)) {
        const newAssignees = (task.assignees || []).map((a) => a.toString());
        const hasChanged =
          newAssignees.length !== prevAssignees.length ||
          newAssignees.some((id) => !prevAssignees.includes(id));

        if (hasChanged) {
          await TaskEvent.logEvent({
            task: task._id,
            project: task.project._id || task.project,
            user: req.user._id,
            action: TASK_EVENT_ACTIONS.ASSIGNMENT_CHANGED,
            details: { previousAssignees: prevAssignees, newAssignees }
          });
        }

        if (contactAssignmentChanged) {
          await TaskEvent.logEvent({
            task: task._id,
            project: task.project._id || task.project,
            user: req.user._id,
            action: TASK_EVENT_ACTIONS.ASSIGNMENT_CHANGED,
            details: {
              previousContactId: prevContactId || null,
              assignedContactId: task.assignedContact || null
            }
          });
        }
      }

      await TaskEvent.logEvent({
        task: task._id,
        project: task.project._id || task.project,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.TASK_UPDATED,
        details: { title: task.title }
      });

      const populated = await Task.findById(task._id)
        .populate('project', 'name projectKey manager')
        .populate('creator', 'name email')
        .populate('assignees', 'name email role')
        .populate('assignedContact', 'fullName whatsappNumber email jobTitle isActive');

      if (contactAssignmentChanged && populated.assignedContact) {
        console.info(`[TASK_ASSIGNMENT] Queuing WhatsApp notification for contact ${populated.assignedContact.fullName}.`);
        await taskAssignmentNotificationService.enqueue(populated, populated.assignedContact);
      }

      // Dispatch relevant notification triggers
      if (status && task.status !== prevStatus) {
        await notificationService.notifyTaskStatusChanged(populated, req.user, prevStatus, task.status);
      }

      if (dueDate !== undefined && newDueDate !== prevDueDate) {
        await notificationService.notifyTaskDueDateChanged(populated, req.user, task.dueDate);
      }

      if (Array.isArray(assignees)) {
        const newAssigneeStrings = (task.assignees || []).map((a) => a.toString());
        const addedAssignees = newAssigneeStrings.filter((id) => !prevAssignees.includes(id));
        const removedAssignees = prevAssignees.filter((id) => !newAssigneeStrings.includes(id));

        if (addedAssignees.length > 0) {
          await notificationService.notifyTaskAssigned(populated, req.user, addedAssignees);
        }
        if (removedAssignees.length > 0) {
          await notificationService.notifyTaskUnassigned(populated, req.user, removedAssignees);
        }
      }

      socketService.emitTaskUpdate(
        (populated.assignees || []).map((a) => (a._id || a).toString()),
        { type: 'UPDATED', task: populated.toJSON() }
      );

      res.status(200).json({
        status: 'success',
        message: 'Task updated successfully.',
        data: { task: populated.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Fast status transition endpoint
   * PATCH /api/tasks/:id/status
   */
  changeStatus: async (req, res, next) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !Object.values(TASK_STATUSES).includes(status)) {
      return next(new AppError('Valid task status is required.', 400));
    }

    try {
      const task = await Task.findById(id).populate('project');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      const isAssignee = task.assignees.some((a) => a.toString() === req.user._id.toString());
      const canManageTask = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.MANAGER;

      if (!canManageTask && !isAssignee) {
        return next(new AppError('Access forbidden: You cannot change status on this task.', 403));
      }

      const prevStatus = task.status;
      task.status = status;
      task.completedAt = status === TASK_STATUSES.DONE ? new Date() : null;
      await task.save();

      if (prevStatus !== status) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project._id || task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.STATUS_CHANGED,
          details: {
            previousValue: prevStatus,
            newValue: status
          }
        });

        await notificationService.notifyTaskStatusChanged(task, req.user, prevStatus, status);
        socketService.emitTaskUpdate(
          (task.assignees || []).map((a) => a.toString()),
          { type: 'STATUS_CHANGED', taskId: task._id, status }
        );
      }

      res.status(200).json({
        status: 'success',
        message: `Task status updated to '${status}'.`,
        data: {
          task: {
            id: task._id,
            status: task.status,
            completedAt: task.completedAt
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Archive task
   * PATCH /api/tasks/:id/archive
   */
  archiveTask: async (req, res, next) => {
    const { id } = req.params;
    const { isArchived } = req.body;

    if (typeof isArchived !== 'boolean') {
      return next(new AppError('isArchived boolean is required.', 400));
    }

    try {
      const task = await Task.findById(id).populate('project');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      task.isArchived = isArchived;
      await task.save();

      await TaskEvent.logEvent({
        task: task._id,
        project: task.project._id || task.project,
        user: req.user._id,
        action: isArchived ? TASK_EVENT_ACTIONS.TASK_ARCHIVED : TASK_EVENT_ACTIONS.TASK_RESTORED,
        details: { isArchived }
      });

      res.status(200).json({
        status: 'success',
        message: `Task ${isArchived ? 'archived' : 'restored'} successfully.`
      });
    } catch (error) {
      next(error);
    }
  },

  deleteTask: async (req, res, next) => {
    req.body = { isArchived: true };
    return taskController.archiveTask(req, res, next);
  },

  /**
   * Real aggregate dashboard statistics computed strictly from database records
   * GET /api/dashboard/stats
   */
  getDashboardStats: async (req, res, next) => {
    try {
      // Visibility query scopes
      const projectQuery = { isArchived: false };
      const taskQuery = { isArchived: false };

      if (req.user.role === USER_ROLES.MEMBER) {
        projectQuery.$or = [{ members: req.user._id }, { manager: req.user._id }];
        taskQuery.$or = [{ assignees: req.user._id }];
      }

      const now = new Date();

      const [
        totalProjects,
        totalTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        overdueTasks,
        recentTasks,
        upcomingTasks
      ] = await Promise.all([
        Project.countDocuments(projectQuery),
        Task.countDocuments(taskQuery),
        Task.countDocuments({ ...taskQuery, status: { $in: [TASK_STATUSES.BACKLOG, TASK_STATUSES.TO_DO] } }),
        Task.countDocuments({
          ...taskQuery,
          status: {
            $in: [
              TASK_STATUSES.WORKING_ON_IT,
              TASK_STATUSES.IN_PROGRESS,
              TASK_STATUSES.IN_REVIEW,
              TASK_STATUSES.APPLIED
            ]
          }
        }),
        Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.DONE }),
        Task.countDocuments({
          ...taskQuery,
          status: { $ne: TASK_STATUSES.DONE },
          dueDate: { $lt: now }
        }),
        Task.find(taskQuery)
          .sort({ updatedAt: -1 })
          .limit(5)
          .populate('project', 'name projectKey')
          .populate('assignees', 'name role'),
        Task.find({
          ...taskQuery,
          status: { $ne: TASK_STATUSES.DONE },
          dueDate: { $gte: now }
        })
          .sort({ dueDate: 1 })
          .limit(5)
          .populate('project', 'name projectKey')
          .populate('assignees', 'name')
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          metrics: {
            totalProjects,
            totalTasks,
            pending: pendingTasks,
            inProgress: inProgressTasks,
            completed: completedTasks,
            overdue: overdueTasks
          },
          statusDistribution: {
            backlog: await Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.BACKLOG }),
            toDo: await Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.TO_DO }),
            inProgress: await Task.countDocuments({
              ...taskQuery,
              status: { $in: [TASK_STATUSES.WORKING_ON_IT, TASK_STATUSES.IN_PROGRESS] }
            }),
            blocked: await Task.countDocuments({
              ...taskQuery,
              status: { $in: [TASK_STATUSES.BLOCKED, TASK_STATUSES.STUCK] }
            }),
            inReview: await Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.IN_REVIEW }),
            applied: await Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.APPLIED }),
            done: completedTasks
          },
          recentActivity: recentTasks.map((t) => t.toJSON()),
          upcomingDeadlines: upcomingTasks.map((t) => t.toJSON())
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Export tasks as CSV with formula injection defense
   * GET /api/tasks/export/csv
   */
  exportTasksCsv: async (req, res, next) => {
    try {
      const query = { isArchived: req.query.archived === 'true' };

      if (req.query.project) query.project = req.query.project;
      if (req.query.status && Object.values(TASK_STATUSES).includes(req.query.status)) query.status = req.query.status;
      if (req.query.priority && Object.values(TASK_PRIORITIES).includes(req.query.priority)) query.priority = req.query.priority;

      if (req.query.assignee) {
        query.assignees = req.query.assignee === 'me' ? req.user._id : req.query.assignee;
      }
      if (req.query.contactId) {
        if (!mongoose.isValidObjectId(req.query.contactId)) {
          return next(new AppError('Invalid contact filter.', 400));
        }
        query.assignedContact = req.query.contactId;
      }

      if (req.query.search) {
        const regex = new RegExp(req.query.search.trim(), 'i');
        query.$or = [{ title: regex }, { taskKey: regex }, { description: regex }];
      }

      if (req.query.dueDateFrom || req.query.dueDateTo) {
        query.dueDate = query.dueDate || {};
        if (req.query.dueDateFrom) query.dueDate.$gte = new Date(req.query.dueDateFrom);
        if (req.query.dueDateTo) {
          const toDate = new Date(req.query.dueDateTo);
          toDate.setHours(23, 59, 59, 999);
          query.dueDate.$lte = toDate;
        }
      }

      // Role-based visibility scoping for non-admins (MANAGER, EMPLOYEE)
      if (req.user.role === USER_ROLES.MEMBER) {
        const userProjects = await Project.find({
          $or: [{ members: req.user._id }, { manager: req.user._id }]
        }).select('_id');
        const authorizedProjectIds = userProjects.map((p) => p._id.toString());

        if (req.query.project) {
          const isAffiliated = authorizedProjectIds.includes(req.query.project.toString());
          if (!isAffiliated) {
            query.assignees = req.user._id;
          }
        } else {
          query.$and = query.$and || [];
          query.$and.push({
            $or: [{ assignees: req.user._id }, { project: { $in: authorizedProjectIds } }]
          });
        }
      }

      const tasks = await Task.find(query)
        .populate('project', 'name projectKey')
        .populate('creator', 'name email')
        .populate('assignees', 'name email')
        .sort({ createdAt: -1 })
        .limit(5000); // Guarded maximum limit

      const headers = [
        'Task Key',
        'Title',
        'Project',
        'Status',
        'Priority',
        'Start Date',
        'Due Date',
        'Assignees',
        'Creator',
        'Total Time Spent (Minutes)',
        'Created At'
      ];

      const rows = tasks.map((t) => [
        t.taskKey,
        t.title,
        t.project?.name || '',
        t.status,
        t.priority,
        t.startDate ? new Date(t.startDate).toISOString().split('T')[0] : '',
        t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
        (t.assignees || []).map((a) => a.name).join('; '),
        t.creator?.name || '',
        t.totalTimeSpentMinutes || 0,
        t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : ''
      ]);

      const csv = buildCsvString(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tasks-export-${Date.now()}.csv"`);
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  }
};

export default taskController;

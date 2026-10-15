import { Task } from '../models/task.model.js';
import { TimeEntry } from '../models/timeEntry.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { USER_ROLES } from '../models/user.model.js';
import { AppError } from '../middleware/errorHandler.js';

export const timeEntryController = {
  /**
   * Get all logged time entries for a task
   * GET /api/tasks/:id/time-entries
   */
  getTimeEntries: async (req, res, next) => {
    const { id } = req.params;

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Members must belong to the board or be assigned to the task.
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees?.some((a) => (a._id || a).toString() === req.user._id.toString());
        const isProjectMember =
          task.project?.members?.some((m) => (m._id || m).toString() === req.user._id.toString()) ||
          (task.project?.manager?._id || task.project?.manager)?.toString() === req.user._id.toString();

        if (!isAssignee && !isProjectMember) {
          return next(new AppError('Access denied: You cannot view time entries for this task.', 403));
        }
      }

      const entries = await TimeEntry.find({ task: id })
        .sort({ date: -1, createdAt: -1 })
        .populate('user', 'name email role');

      const totalMinutes = entries.reduce((acc, curr) => acc + (curr.durationMinutes || 0), 0);

      res.status(200).json({
        status: 'success',
        data: {
          entries: entries.map((e) => e.toJSON()),
          totalMinutes,
          totalHours: Number((totalMinutes / 60).toFixed(2))
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Log time on a task
   * POST /api/tasks/:id/time-entries
   */
  createTimeEntry: async (req, res, next) => {
    const { id } = req.params;
    const { durationMinutes, description, date } = req.body;

    const parsedMinutes = parseInt(durationMinutes, 10);
    if (isNaN(parsedMinutes) || parsedMinutes < 1 || parsedMinutes > 1440) {
      return next(new AppError('Duration must be a valid number of minutes between 1 and 1440 (24 hours).', 400));
    }

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Members may log time only to tasks assigned to them.
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees?.some((a) => (a._id || a).toString() === req.user._id.toString());

        if (!isAssignee) {
          return next(new AppError('Access denied: You cannot log time on this task.', 403));
        }
      }

      const entryDate = date ? new Date(date) : new Date();
      if (isNaN(entryDate.getTime())) {
        return next(new AppError('Invalid date provided for time entry.', 400));
      }

      const timeEntry = await TimeEntry.create({
        task: task._id,
        project: task.project._id || task.project,
        user: req.user._id,
        durationMinutes: parsedMinutes,
        description: (description || '').trim(),
        date: entryDate
      });

      // Update total time in task
      task.totalTimeSpentMinutes = (task.totalTimeSpentMinutes || 0) + parsedMinutes;
      await task.save();

      // Audit log event
      await TaskEvent.logEvent({
        task: task._id,
        project: task.project._id || task.project,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.TIME_LOGGED,
        details: {
          entryId: timeEntry._id,
          durationMinutes: parsedMinutes,
          description: (description || '').trim()
        }
      });

      const populated = await TimeEntry.findById(timeEntry._id).populate('user', 'name email role');

      res.status(201).json({
        status: 'success',
        message: 'Time logged successfully.',
        data: {
          entry: populated.toJSON(),
          totalTimeSpentMinutes: task.totalTimeSpentMinutes
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete a time entry (Author or Admin)
   * DELETE /api/tasks/:id/time-entries/:entryId
   */
  deleteTimeEntry: async (req, res, next) => {
    const { id, entryId } = req.params;

    try {
      const entry = await TimeEntry.findOne({ _id: entryId, task: id });
      if (!entry) {
        return next(new AppError('Time entry not found.', 404));
      }

      const isAuthor = entry.user.toString() === req.user._id.toString();
      const canManage = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.MANAGER;

      if (!isAuthor && !canManage) {
        return next(new AppError('Access forbidden: You can only delete your own time entries.', 403));
      }

      const task = await Task.findById(id);
      if (task) {
        task.totalTimeSpentMinutes = Math.max(0, (task.totalTimeSpentMinutes || 0) - entry.durationMinutes);
        await task.save();
      }

      await TimeEntry.deleteOne({ _id: entry._id });

      // Audit log event
      if (task) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.TIME_DELETED,
          details: {
            entryId: entry._id,
            durationMinutes: entry.durationMinutes
          }
        });
      }

      res.status(200).json({
        status: 'success',
        message: 'Time entry deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
};

export default timeEntryController;

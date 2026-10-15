import { Task } from '../models/task.model.js';
import { TaskEvent } from '../models/taskEvent.model.js';
import { USER_ROLES } from '../models/user.model.js';
import { AppError } from '../middleware/errorHandler.js';

export const taskEventController = {
  /**
   * Get chronological activity timeline for a task
   * GET /api/tasks/:id/activity
   */
  getTaskActivity: async (req, res, next) => {
    const { id } = req.params;

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Permission check: Employees can only view activity for tasks they belong to
      if (req.user.role === USER_ROLES.EMPLOYEE) {
        const isAssignee = task.assignees?.some((a) => a.toString() === req.user._id.toString());
        const isProjectMember =
          task.project?.members?.some((m) => m.toString() === req.user._id.toString()) ||
          task.project?.manager?.toString() === req.user._id.toString();

        if (!isAssignee && !isProjectMember) {
          return next(new AppError('Access denied: You are not authorized to view this task activity.', 403));
        }
      }

      const events = await TaskEvent.find({ task: id })
        .sort({ createdAt: -1 })
        .populate('user', 'name email role')
        .limit(100);

      res.status(200).json({
        status: 'success',
        data: {
          activity: events.map((e) => e.toJSON())
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

export default taskEventController;

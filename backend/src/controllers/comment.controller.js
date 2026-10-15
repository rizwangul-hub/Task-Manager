import { Task } from '../models/task.model.js';
import { Comment } from '../models/comment.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { notificationService } from '../services/notification.service.js';
import { USER_ROLES } from '../models/user.model.js';
import { AppError } from '../middleware/errorHandler.js';

export const commentController = {
  /**
   * Get all comments for a task
   * GET /api/tasks/:id/comments
   */
  getComments: async (req, res, next) => {
    const { id } = req.params;

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Check view permission: Non-admins must be assignee or project affiliate
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees?.some((a) => (a._id || a).toString() === req.user._id.toString());
        const isProjectMember =
          task.project?.members?.some((m) => (m._id || m).toString() === req.user._id.toString()) ||
          (task.project?.manager?._id || task.project?.manager)?.toString() === req.user._id.toString();

        if (!isAssignee && !isProjectMember) {
          return next(new AppError('Access denied: You cannot view comments for this task.', 403));
        }
      }

      const comments = await Comment.find({ task: id })
        .sort({ createdAt: 1 })
        .populate('author', 'name email role');

      res.status(200).json({
        status: 'success',
        data: {
          comments: comments.map((c) => c.toJSON())
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Post a new comment to a task
   * POST /api/tasks/:id/comments
   */
  createComment: async (req, res, next) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return next(new AppError('Comment content cannot be empty.', 400));
    }

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Check permission: Non-admins must have access to task
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees?.some((a) => (a._id || a).toString() === req.user._id.toString());

        if (!isAssignee) {
          return next(new AppError('Access denied: You cannot comment on this task.', 403));
        }
      }

      const comment = await Comment.create({
        task: task._id,
        author: req.user._id,
        content: content.trim()
      });

      // Audit log event
      await TaskEvent.logEvent({
        task: task._id,
        project: task.project._id || task.project,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.COMMENT_ADDED,
        details: {
          commentId: comment._id,
          snippet: content.trim().substring(0, 100)
        }
      });

      // Dispatch notifications to assignees and creator
      await notificationService.notifyTaskComment(task, req.user, content.trim());

      const populated = await Comment.findById(comment._id).populate('author', 'name email role');

      res.status(201).json({
        status: 'success',
        message: 'Comment added successfully.',
        data: {
          comment: populated.toJSON()
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete a comment (Author or Admin)
   * DELETE /api/tasks/:id/comments/:commentId
   */
  deleteComment: async (req, res, next) => {
    const { id, commentId } = req.params;

    try {
      const comment = await Comment.findOne({ _id: commentId, task: id });
      if (!comment) {
        return next(new AppError('Comment not found.', 404));
      }

      const isAuthor = comment.author.toString() === req.user._id.toString();
      const canManage = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.MANAGER;

      if (!isAuthor && !canManage) {
        return next(new AppError('Access forbidden: You can only delete your own comments.', 403));
      }

      const task = await Task.findById(id);

      await Comment.deleteOne({ _id: comment._id });

      // Audit log event
      if (task) {
        await TaskEvent.logEvent({
          task: task._id,
          project: task.project,
          user: req.user._id,
          action: TASK_EVENT_ACTIONS.COMMENT_DELETED,
          details: {
            commentId: comment._id
          }
        });
      }

      res.status(200).json({
        status: 'success',
        message: 'Comment deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
};

export default commentController;

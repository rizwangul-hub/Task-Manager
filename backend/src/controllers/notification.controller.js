import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { emailService } from '../services/email.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const notificationController = {
  /**
   * List current user's notifications with pagination
   * GET /api/notifications
   */
  getNotifications: async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      const skip = (page - 1) * limit;

      // Strict recipient isolation: Users only ever see their own notifications
      const query = { recipient: req.user._id };

      if (req.query.unread === 'true') {
        query.isRead = false;
      }

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(query)
          .populate('task', 'title taskKey project')
          .populate('project', 'name projectKey')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Notification.countDocuments(query),
        Notification.countDocuments({ recipient: req.user._id, isRead: false })
      ]);

      res.status(200).json({
        status: 'success',
        data: {
          notifications: notifications.map((n) => n.toJSON()),
          unreadCount,
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
   * Get total unread count for current user
   * GET /api/notifications/unread-count
   */
  getUnreadCount: async (req, res, next) => {
    try {
      const unreadCount = await Notification.countDocuments({
        recipient: req.user._id,
        isRead: false
      });

      res.status(200).json({
        status: 'success',
        data: { unreadCount }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get single notification by ID
   * GET /api/notifications/:id
   */
  getNotificationById: async (req, res, next) => {
    const { id } = req.params;
    try {
      if (!mongoose.isValidObjectId(id)) {
        return next(new AppError('Invalid notification ID format.', 400));
      }
      const notification = await Notification.findOne({
        _id: id,
        recipient: req.user._id
      });
      if (!notification) {
        return next(new AppError('Notification not found or access denied.', 404));
      }
      res.status(200).json({
        status: 'success',
        data: { notification: notification.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Mark a single notification as read
   * PATCH /api/notifications/:id/read or PATCH /api/notifications/:id
   */
  markAsRead: async (req, res, next) => {
    const { id } = req.params;

    try {
      if (!mongoose.isValidObjectId(id)) {
        return next(new AppError('Invalid notification ID format.', 400));
      }
      // Must belong to authenticated user
      const notification = await Notification.findOne({
        _id: id,
        recipient: req.user._id
      });

      if (!notification) {
        // Return idempotent success if notification is already removed or missing
        return res.status(200).json({
          status: 'success',
          message: 'Notification already dismissed or read.',
          data: { notification: null }
        });
      }

      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();

      res.status(200).json({
        status: 'success',
        message: 'Notification marked as read.',
        data: { notification: notification.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Mark all notifications as read for current user
   * PATCH /api/notifications/mark-all-read
   */
  markAllAsRead: async (req, res, next) => {
    try {
      const result = await Notification.updateMany(
        { recipient: req.user._id, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
      );

      res.status(200).json({
        status: 'success',
        message: 'All notifications marked as read.',
        data: { modifiedCount: result.modifiedCount }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete a notification (recipient only)
   * DELETE /api/notifications/:id
   */
  deleteNotification: async (req, res, next) => {
    const { id } = req.params;

    try {
      if (!mongoose.isValidObjectId(id)) {
        return next(new AppError('Invalid notification ID format.', 400));
      }

      const notification = await Notification.findOne({
        _id: id,
        recipient: req.user._id
      });

      if (!notification) {
        // Idempotent delete: if already removed or not found, return success so frontend does not produce 404 console errors
        return res.status(200).json({
          status: 'success',
          message: 'Notification already deleted.'
        });
      }

      await Notification.deleteOne({ _id: notification._id });

      res.status(200).json({
        status: 'success',
        message: 'Notification deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get user notification preferences
   * GET /api/notifications/preferences
   */
  getPreferences: async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return next(new AppError('User profile not found.', 404));
      }

      const emailStatus = emailService.getEmailStatus();
      res.status(200).json({
        status: 'success',
        data: {
          preferences: user.notificationPreferences || {
            emailNotifications: true,
            taskAssigned: true,
            taskStatusChanged: true,
            taskDueDate: true,
            taskComments: true,
            overdueReminders: true
          },
          emailChannel: {
            configured: emailStatus.configured,
            connected: emailStatus.connected,
            status: emailStatus.status,
            provider: emailStatus.provider,
            transport: emailStatus.transport,
            statusMessage: emailStatus.configured
              ? `Email channel is ${emailStatus.status.toLowerCase()} (${emailStatus.transport}).`
              : 'Email credentials are not set on server. In-app notifications will function, but email alerts will remain dormant.'
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update user notification preferences
   * PATCH /api/notifications/preferences
   */
  updatePreferences: async (req, res, next) => {
    const {
      emailNotifications,
      taskAssigned,
      taskStatusChanged,
      taskDueDate,
      taskComments,
      overdueReminders
    } = req.body;

    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return next(new AppError('User profile not found.', 404));
      }

      const current = user.notificationPreferences || {};

      user.notificationPreferences = {
        emailNotifications:
          typeof emailNotifications === 'boolean' ? emailNotifications : current.emailNotifications ?? true,
        taskAssigned:
          typeof taskAssigned === 'boolean' ? taskAssigned : current.taskAssigned ?? true,
        taskStatusChanged:
          typeof taskStatusChanged === 'boolean' ? taskStatusChanged : current.taskStatusChanged ?? true,
        taskDueDate:
          typeof taskDueDate === 'boolean' ? taskDueDate : current.taskDueDate ?? true,
        taskComments:
          typeof taskComments === 'boolean' ? taskComments : current.taskComments ?? true,
        overdueReminders:
          typeof overdueReminders === 'boolean' ? overdueReminders : current.overdueReminders ?? true
      };

      await user.save();

      res.status(200).json({
        status: 'success',
        message: 'Notification preferences updated successfully.',
        data: {
          preferences: user.notificationPreferences
        }
      });
    } catch (error) {
      next(error);
    }
  }
};

export default notificationController;

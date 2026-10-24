import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

// Protect all notification routes
router.use(authenticate);

// Unread count (placed before /:id)
router.get('/unread-count', notificationController.getUnreadCount);

// Preferences (placed before /:id)
router.get('/preferences', notificationController.getPreferences);
router.patch('/preferences', notificationController.updatePreferences);

// Mark all as read (placed before /:id)
router.patch('/mark-all-read', notificationController.markAllAsRead);

// List notifications with pagination and unread filter
router.get('/', notificationController.getNotifications);

// Get single notification
router.get('/:id', notificationController.getNotificationById);

// Mark single notification as read (supports both /:id and /:id/read)
router.patch('/:id/read', notificationController.markAsRead);
router.patch('/:id', notificationController.markAsRead);

// Delete single notification
router.delete('/:id', notificationController.deleteNotification);

export default router;

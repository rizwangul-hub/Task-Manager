import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { taskEventController } from '../controllers/taskEvent.controller.js';
import { commentController } from '../controllers/comment.controller.js';
import { attachmentController } from '../controllers/attachment.controller.js';
import { timeEntryController } from '../controllers/timeEntry.controller.js';
import { uploadAttachment } from '../middleware/upload.middleware.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';

const router = Router();

// Protect all task routes
router.use(authenticate);

// List tasks with filtering and pagination
router.get('/', taskController.getTasks);

// Create a new task
router.post('/', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), taskController.createTask);

// Export tasks as CSV
router.get('/export/csv', taskController.exportTasksCsv);

// Get single task
router.get('/:id', taskController.getTaskById);

// Update task details
router.put('/:id', taskController.updateTask);

// Update task status
router.patch('/:id/status', taskController.changeStatus);

// Archive task
router.patch('/:id/archive', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), taskController.archiveTask);
router.delete('/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), taskController.deleteTask);

// --- Phase 3 Routes ---

// 1. Task Activity Timeline
router.get('/:id/activity', taskEventController.getTaskActivity);

// 2. Task Comments
router.get('/:id/comments', commentController.getComments);
router.post('/:id/comments', commentController.createComment);
router.delete('/:id/comments/:commentId', commentController.deleteComment);

// 3. Task Attachments
router.post('/:id/attachments', uploadAttachment, attachmentController.uploadAttachment);
router.delete('/:id/attachments/:attachmentId', attachmentController.deleteAttachment);

// 4. Task Time Tracking
router.get('/:id/time-entries', timeEntryController.getTimeEntries);
router.post('/:id/time-entries', timeEntryController.createTimeEntry);
router.delete('/:id/time-entries/:entryId', timeEntryController.deleteTimeEntry);

export default router;

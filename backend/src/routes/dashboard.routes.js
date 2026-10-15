import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', authenticate, taskController.getDashboardStats);

export default router;

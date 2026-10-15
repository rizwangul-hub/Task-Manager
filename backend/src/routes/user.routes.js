import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';

const router = Router();

// Protect all user routes
router.use(authenticate);

// List users (Workspace owner)
router.get('/', userController.getUsers);

// Create user (Disabled - returns 403)
router.post('/', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), userController.createUser);

// Get single user by ID
router.get('/:id', userController.getUserById);

// Update user details
router.put('/:id', userController.updateUser);

// Activate/Deactivate user (Disabled - returns 403)
router.patch('/:id/status', userController.setUserStatus);

// Password reset
router.post('/:id/reset-password', userController.resetPassword);

export default router;

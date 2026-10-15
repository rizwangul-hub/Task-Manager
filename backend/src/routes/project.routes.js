import { Router } from 'express';
import { projectController } from '../controllers/project.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';

const router = Router();

// Protect all project routes
router.use(authenticate);

// List projects (scoped inside controller)
router.get('/', projectController.getProjects);

// Create project (Admin and Manager only)
router.post('/', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), projectController.createProject);

// Get single project
router.get('/:id', projectController.getProjectById);

// Update project (Admin or project manager)
router.put('/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), projectController.updateProject);

// Archive or restore project (Admin or Manager)
router.patch('/:id/archive', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), projectController.archiveProject);
router.delete('/:id', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), projectController.deleteProject);

export default router;

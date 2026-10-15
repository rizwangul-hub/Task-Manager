import { Router } from 'express';
import { contactController } from '../controllers/contact.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';

const router = Router();
router.use(authenticate, authorize(USER_ROLES.ADMIN));
router.get('/', contactController.list);
router.post('/', contactController.create);
router.put('/:id', contactController.update);
router.delete('/:id', contactController.deactivate);

export default router;

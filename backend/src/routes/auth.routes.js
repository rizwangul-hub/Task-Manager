import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { ssoExchange } from '../controllers/sso.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.getMe);

// Phase 6A: Central Portal Single Sign-On (SSO) ticket exchange
router.post('/sso/exchange', ssoExchange);

export default router;

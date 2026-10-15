import { Router } from 'express';
import { whatsappWebhookController } from '../controllers/whatsappWebhook.controller.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(webhookLimiter);
router.get('/', whatsappWebhookController.receive);
router.post('/', whatsappWebhookController.receive);

export default router;

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';
import {
  getWhatsAppDiagnostics,
  sendWhatsAppTaskNotification,
  normalizeWhatsAppPhoneNumber
} from '../services/whatsappService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Require authentication for all WhatsApp integration endpoints
router.use(authenticate);

/**
 * GET /api/whatsapp/diagnostics
 * Returns the status of the WhatsApp provider, connection, and capabilities.
 * Safe and sanitized: no tokens, cookies, or secrets exposed.
 */
router.get('/diagnostics', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), (req, res) => {
  const diagnostics = getWhatsAppDiagnostics();
  res.status(200).json({
    status: 'success',
    data: { diagnostics }
  });
});

/**
 * POST /api/whatsapp/test-message
 * Sends a test message to a specified verified test number using the connected sender account.
 */
router.post('/test-message', authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER), async (req, res, next) => {
  const { testNumber } = req.body || {};

  if (!testNumber || typeof testNumber !== 'string' || !testNumber.trim()) {
    return next(new AppError('A valid test phone number or WhatsApp JID is required.', 400));
  }

  const cleanDigits = normalizeWhatsAppPhoneNumber(testNumber.trim());
  const isJid = testNumber.trim().endsWith('@s.whatsapp.net') || testNumber.trim().endsWith('@g.us');
  if (!cleanDigits && !isJid) {
    return next(new AppError('Invalid phone number. Please provide a valid number with country code (e.g. 923255984244).', 400));
  }

  const messageText = [
    '🔔 *PixxTechnologiees Task Manager — WhatsApp Integration Test*',
    '',
    'This is a verified test message sent from your connected WhatsApp account.',
    'Automated task assignment alerts are active and functional.',
    '',
    `Sent at: ${new Date().toLocaleString()}`,
    '_PixxTechnologiees Workspace_'
  ].join('\n');

  try {
    const result = await sendWhatsAppTaskNotification(testNumber.trim(), messageText, {
      taskTitle: 'System Diagnostic Test'
    });

    if (!result.success) {
      return res.status(400).json({
        status: 'fail',
        message: result.reason || result.error || 'Failed to send test message via connected WhatsApp account.',
        data: { result }
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Test message accepted and dispatched successfully.',
      data: {
        providerMessageId: result.messageId || null,
        recipient: testNumber.trim()
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;

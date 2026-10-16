import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { USER_ROLES } from '../models/user.model.js';
import {
  getWhatsAppDiagnostics,
  sendWhatsAppTaskNotification,
  normalizeWhatsAppPhoneNumber
} from '../services/whatsappService.js';
import { whatsappDraftController } from '../controllers/whatsappDraft.controller.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Require authentication for all WhatsApp integration endpoints
router.use(authenticate);

const ownerOnly = authorize(USER_ROLES.ADMIN, USER_ROLES.MANAGER);

/**
 * Diagnostics & Connection
 * GET /api/whatsapp/diagnostics
 */
router.get('/diagnostics', ownerOnly, (req, res) => {
  const diagnostics = getWhatsAppDiagnostics();
  res.status(200).json({
    status: 'success',
    data: { diagnostics }
  });
});

/**
 * WhatsApp Group Monitoring
 * GET /api/whatsapp/groups
 * POST /api/whatsapp/monitored-groups
 */
router.get('/groups', ownerOnly, whatsappDraftController.getGroups);
router.post('/monitored-groups', ownerOnly, whatsappDraftController.toggleMonitoredGroup);
router.post('/test-gemini', ownerOnly, whatsappDraftController.testGemini);
router.post('/test-sample-message', ownerOnly, whatsappDraftController.testSampleMessage);

/**
 * Task Drafts CRUD & Pipeline Actions
 * GET /api/whatsapp/drafts
 * GET /api/whatsapp/drafts/:id
 * PUT /api/whatsapp/drafts/:id
 * POST /api/whatsapp/drafts/:id/approve
 * POST /api/whatsapp/drafts/:id/reject
 * POST /api/whatsapp/drafts/:id/retry
 * DELETE /api/whatsapp/drafts/:id/raw-message
 */
router.get('/drafts', ownerOnly, whatsappDraftController.getDrafts);
router.get('/drafts/:id', ownerOnly, whatsappDraftController.getDraftById);
router.put('/drafts/:id', ownerOnly, whatsappDraftController.updateDraft);
router.post('/drafts/:id/approve', ownerOnly, whatsappDraftController.approveDraft);
router.post('/drafts/:id/reject', ownerOnly, whatsappDraftController.rejectDraft);
router.post('/drafts/:id/retry', ownerOnly, whatsappDraftController.retryDraft);
router.delete('/drafts/:id/raw-message', ownerOnly, whatsappDraftController.deleteRawMessage);

/**
 * POST /api/whatsapp/test-message
 * Sends a test message to a specified verified test number using the connected sender account.
 */
router.post('/test-message', ownerOnly, async (req, res, next) => {
  const { testNumber } = req.body || {};

  if (!testNumber || typeof testNumber !== 'string' || !testNumber.trim()) {
    return next(new AppError('A valid test phone number or WhatsApp JID is required.', 400));
  }

  const cleanDigits = normalizeWhatsAppPhoneNumber(testNumber.trim());
  const isJid = testNumber.trim().endsWith('@s.whatsapp.net') || testNumber.trim().endsWith('@g.us');
  if (!cleanDigits && !isJid) {
    return next(
      new AppError('Invalid phone number. Please provide a valid number with country code (e.g. 923255984244).', 400)
    );
  }

  const messageText = [
    '🔔 *PixxTechnologiees Task Manager — WhatsApp Integration Test*',
    '',
    'This is a verified test message sent from your connected WhatsApp account.',
    'Automated task assignment alerts and group monitoring are active.',
    '',
    `Sent at: ${new Date().toLocaleString()}`,
    '_PixxTechnologiees Workspace_'
  ].join('\n');

  try {
    const result = await sendWhatsAppTaskNotification(testNumber.trim(), messageText, {
      taskTitle: 'System Diagnostic Test'
    });

    if (!result.success) {
      const statusCode = result.retryable ? 503 : 400;
      return res.status(statusCode).json({
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

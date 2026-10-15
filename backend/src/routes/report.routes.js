import { Router } from 'express';
import { reportController } from '../controllers/report.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

// Protect all report routes
router.use(authenticate);

// Management reports summary aggregation
router.get('/summary', reportController.getReportSummary);

// Export report data as safe CSV
router.get('/export/csv', reportController.exportReportCsv);

export default router;

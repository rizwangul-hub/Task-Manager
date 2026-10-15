import { Router } from 'express';
import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import projectRoutes from './project.routes.js';
import taskRoutes from './task.routes.js';
import notificationRoutes from './notification.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import reportRoutes from './report.routes.js';
import whatsappWebhookRoutes from './whatsappWebhook.routes.js';
import contactRoutes from './contact.routes.js';
import whatsappRoutes from './whatsapp.routes.js';

const router = Router();

// System health routes
router.use('/', healthRoutes);

// Business & Authentication routes
router.use('/webhook/whatsapp', whatsappWebhookRoutes);
router.use('/webhooks/whatsapp', whatsappWebhookRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/contacts', contactRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/notifications', notificationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/whatsapp', whatsappRoutes);

// Informational API descriptor
router.get('/', (req, res) => {
  res.json({
    name: 'PixxTechnologiees Task Manager API',
    version: '5.0.0',
    documentation: 'Phase 5 - Advanced Task Workspace, Kanban, Calendar, Timeline & Reports',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      contacts: '/api/contacts',
      projects: '/api/projects',
      tasks: '/api/tasks',
      notifications: '/api/notifications',
      whatsappWebhook: '/api/webhook/whatsapp',
      whatsapp: '/api/whatsapp',
      dashboard: '/api/dashboard/stats',
      reports: '/api/reports/summary'
    }
  });
});

export default router;

import { getDBStatus } from '../config/db.js';
import { getCloudinaryStatus } from '../config/cloudinary.js';
import { emailService } from '../services/email.service.js';
import { env } from '../config/env.js';

/**
 * Controller to provide application health and service connectivity status
 */
export const getHealth = (req, res) => {
  const dbStatus = getDBStatus();
  const cloudinaryStatus = getCloudinaryStatus();
  const emailStatus = emailService.getEmailStatus();

  const isHealthy = dbStatus.isConnected;

  const response = {
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'PixxTechnologiees Task Manager API',
    version: '4.1.0',
    build: 'b5affae-inbound-fix',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus.status,
      connected: dbStatus.isConnected
    },
    services: {
      cloudinary: {
        configured: cloudinaryStatus.configured
      },
      email: {
        configured: emailStatus.configured,
        connected: emailStatus.connected,
        status: emailStatus.status,
        provider: emailStatus.provider,
        transport: emailStatus.transport,
        host: emailStatus.host
      },
      scheduler: {
        enabled: env.SCHEDULER.enabled,
        timezone: env.SCHEDULER.timezone
      }
    }
  };

  const statusCode = isHealthy ? 200 : (dbStatus.readyState === 0 ? 503 : 200);

  res.status(statusCode).json(response);
};

export default getHealth;

import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { env, validateEnv } from './config/env.js'; // configuration loaded
import { connectDB, disconnectDB } from './config/db.js';
import { socketService } from './services/socket.service.js';
import { schedulerService } from './services/scheduler.service.js';
import { closeWhatsAppListener, initWhatsAppListener } from './services/whatsappService.js';
import { logger } from './utils/logger.js';

// Validate environment variables on startup
validateEnv();

let whatsappListenerStarted = false;
const startWhatsAppListener = () => {
  if (
    whatsappListenerStarted ||
    mongoose.connection.readyState !== 1 ||
    (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0')
  ) return;
  whatsappListenerStarted = true;
  void initWhatsAppListener().catch((error) => {
    whatsappListenerStarted = false;
    logger.error('Failed to initialize the Baileys WhatsApp listener:', error);
  });
};

mongoose.connection.on('connected', startWhatsAppListener);

// Connect to MongoDB
await connectDB();

// Create standard HTTP server to support Socket.IO and Express
const httpServer = http.createServer(app);

// Initialize Socket.IO before accepting requests so clustered delivery is ready.
await socketService.init(httpServer);

// Initialize scheduled reminders & outbox retry worker
if (!process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0') {
  schedulerService.startScheduler();
}

const server = httpServer.listen(env.PORT, () => {
  logger.info(`PixxTechnologiees Task Manager backend running on port ${env.PORT}`);
  logger.info(`Health check available at: http://localhost:${env.PORT}/api/health`);
  logger.info(`WebSocket real-time engine active on port ${env.PORT}`);
  startWhatsAppListener();
});

// Handle graceful shutdown
let shutdownPromise = null;
const shutdown = (signal, restart = false) => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    logger.info(`Received ${signal}. Gracefully shutting down server...`);

    const forceExitTimer = setTimeout(() => {
      logger.error('Forced shutdown due to timeout while closing connections.');
      process.exit(1);
    }, 10_000);

    try {
      schedulerService.stopScheduler();
      await closeWhatsAppListener();
      await socketService.close();
      await new Promise((resolveClose) => server.close(resolveClose));
      logger.info('HTTP and WebSocket server closed.');
      await disconnectDB();
      clearTimeout(forceExitTimer);
      if (restart) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(0);
    } catch (error) {
      logger.error('Graceful shutdown failed:', error);
      process.exit(1);
    }
  })();
  return shutdownPromise;
};

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGUSR2', () => { void shutdown('SIGUSR2', true); });

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default server;

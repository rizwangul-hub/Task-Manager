import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let isConnecting = false;

/**
 * Connect to MongoDB instance using Mongoose
 */
export const connectDB = async () => {
  if (!env.MONGODB_URI) {
    logger.warn('MongoDB connection skipped: MONGO_URI or MONGODB_URI is not defined in environment variables.');
    return;
  }

  if (mongoose.connection.readyState === 1 || isConnecting) {
    return;
  }

  try {
    isConnecting = true;
    logger.info('Connecting to MongoDB database...');

    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    logger.info('Successfully connected to MongoDB database.');
  } catch (error) {
    logger.error('Failed to connect to MongoDB database:', error);
    logger.warn('Backend will continue running in offline database mode. Endpoints requiring database access will fail safely.');
  } finally {
    isConnecting = false;
  }
};

/**
 * Returns database connection status summary for health checks
 */
export const getDBStatus = () => {
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized'
  };

  const readyState = mongoose.connection.readyState;
  return {
    status: stateMap[readyState] || 'unknown',
    isConnected: readyState === 1,
    readyState
  };
};

/**
 * Gracefully close database connection
 */
export const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully.');
  }
};

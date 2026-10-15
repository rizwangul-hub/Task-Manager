import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let cachedPromise = null;

/**
 * Connect to MongoDB instance using Mongoose with promise reuse for serverless concurrency
 */
export const connectDB = async () => {
  if (!env.MONGODB_URI) {
    logger.warn('MongoDB connection skipped: MONGO_URI or MONGODB_URI is not defined in environment variables.');
    return null;
  }

  // 1. If already connected, return existing connection immediately
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // 2. If a connection attempt is already in flight, reuse the same promise
  // This prevents concurrent requests from proceeding while readyState is 2 (connecting)
  if (cachedPromise) {
    return cachedPromise;
  }

  logger.info('Connecting to MongoDB database...');

  cachedPromise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
    })
    .then((mongooseInstance) => {
      logger.info('Successfully connected to MongoDB database.');
      return mongooseInstance;
    })
    .catch((error) => {
      cachedPromise = null; // Reset on failure so subsequent requests can retry
      logger.error('Failed to connect to MongoDB database:', error);
      throw error;
    });

  return cachedPromise;
};

// Reset cached promise on disconnection or error so next request can reconnect
mongoose.connection.on('disconnected', () => {
  cachedPromise = null;
});

mongoose.connection.on('error', (err) => {
  cachedPromise = null;
  logger.error('MongoDB connection error:', err);
});

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
    cachedPromise = null;
    logger.info('MongoDB connection closed gracefully.');
  }
};


import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Global is used here to maintain a cached connection across hot reloads in development
 * and prevent connection thrashing / stale promises during serverless execution on Vercel.
 */
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB instance using Mongoose with promise reuse for serverless concurrency
 */
export const connectDB = async () => {
  if (!env.MONGODB_URI) {
    logger.warn('MongoDB connection skipped: MONGO_URI or MONGODB_URI is not defined in environment variables.');
    return null;
  }

  // 1. If mongoose already has an active, open connection (readyState === 1), reuse it immediately
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose.connection;
    return cached.conn;
  }

  // 2. If a connection attempt is actively in flight (readyState === 2), await the active promise
  if (cached.promise && mongoose.connection.readyState === 2) {
    return cached.promise;
  }

  // 3. If disconnected (readyState === 0 or 3) or promise is stale/null, initiate a fresh connection
  logger.info('Connecting to MongoDB database...');

  cached.promise = mongoose
    .connect(env.MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    })
    .then((mongooseInstance) => {
      cached.conn = mongooseInstance.connection || mongooseInstance;
      logger.info('Successfully connected to MongoDB database.');
      return cached.conn;
    })
    .catch((error) => {
      cached.promise = null;
      cached.conn = null;
      logger.error('Failed to connect to MongoDB database:', error);
      throw error;
    });

  return cached.promise;
};

// Reset cached promise on disconnection or error so next request can reconnect
mongoose.connection.on('disconnected', () => {
  if (cached) {
    cached.promise = null;
    cached.conn = null;
  }
});

mongoose.connection.on('error', (err) => {
  if (cached) {
    cached.promise = null;
    cached.conn = null;
  }
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
    if (cached) {
      cached.promise = null;
      cached.conn = null;
    }
    logger.info('MongoDB connection closed gracefully.');
  }
};


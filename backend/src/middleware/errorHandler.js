import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized application error handling middleware
 */
export const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle Mongoose CastError (e.g. invalid MongoDB ObjectId)
  if (err.name === 'CastError') {
    error = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  // Handle Mongoose ValidationError
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {}).map((val) => val.message);
    error = new AppError(`Validation failed: ${messages.join('. ')}`, 400, err.errors);
  }

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = new AppError(`Duplicate value entered for ${field}. Please use another value.`, 409);
  }

  // Handle Multer upload limits
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new AppError('File upload exceeds maximum allowed size (10MB).', 400);
  }

  const statusCode = error.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  
  logger.error(`[${req.method}] ${req.originalUrl} - ${error.message}`, error);

  const response = {
    status: 'error',
    statusCode,
    message: error.isOperational ? error.message : 'Internal Server Error'
  };

  // Provide helpful validation or client error details if operational
  if (error.isOperational && error.details) {
    response.details = error.details;
  }

  // Include stack trace only in local development mode
  if (env.NODE_ENV === 'development') {
    response.debug = {
      message: err.message,
      stack: err.stack
    };
  }

  res.status(statusCode).json(response);
};

/**
 * Custom application error class for operational errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

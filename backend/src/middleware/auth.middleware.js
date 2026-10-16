import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { verifyAccessToken } from '../utils/token.js';
import { User, normalizeUserRole } from '../models/user.model.js';
import { AppError } from './errorHandler.js';

/**
 * Middleware ensuring incoming requests are authenticated via JWT (cookie or Bearer header)
 */
export const authenticate = async (req, res, next) => {
  // 1. Extract token from HTTP-only cookie or Authorization header
  let token = req.cookies?.access_token;

  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('Authentication required. Please log in to proceed.', 401));
  }

  // 2. Verify token
  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return next(new AppError('Session expired or invalid token. Please log in again.', 401));
  }

  // 3. Ensure database is connected before querying user record
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
    } catch (dbErr) {
      logger.error('[DB_AUTH_ERROR] Database connection attempt failed during request authentication:', dbErr);
    }
  }

  if (mongoose.connection.readyState !== 1) {
    return next(new AppError('Database service is currently unavailable. Please check MongoDB configuration.', 503));
  }

  try {
    // 4. Confirm active user exists in database
    const user = await User.findById(decoded.id);

    if (!user) {
      return next(new AppError('User account not found.', 401));
    }

    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated. Contact an administrator.', 403));
    }

    req.user = user;
    req.user.role = normalizeUserRole(req.user.role);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-based authorization middleware
 * @param  {...string} allowedRoles - Array of roles permitted (e.g. 'ADMIN', 'MANAGER')
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    if (!allowedRoles.includes(normalizeUserRole(req.user.role))) {
      return next(
        new AppError(
          `Access forbidden: '${req.user.role}' role does not have permission to access this resource.`,
          403
        )
      );
    }

    next();
  };
};

export const verifyToken = authenticate;
export const authorizeRoles = authorize;

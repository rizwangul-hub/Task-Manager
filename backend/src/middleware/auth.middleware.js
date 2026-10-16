import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { verifyAccessToken } from '../utils/token.js';
import { User, normalizeUserRole } from '../models/user.model.js';
import { AppError } from './errorHandler.js';
import { logger } from '../utils/logger.js';

export const getAuthenticatedTokenPayload = (req) => {
  const authorization = req.headers.authorization || req.headers.Authorization || '';
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  const cookieToken = req.cookies?.access_token;

  if (bearerToken) {
    const bearerPayload = verifyAccessToken(bearerToken);
    if (bearerPayload) return bearerPayload;
  }

  return cookieToken ? verifyAccessToken(cookieToken) : null;
};

/**
 * Middleware ensuring incoming requests are authenticated via JWT (cookie or Bearer header)
 */
export const authenticate = async (req, res, next) => {
  // Prefer a valid bearer token, then fall back to the cookie for browser sessions.
  const hasCredential = Boolean(req.cookies?.access_token || req.headers.authorization || req.headers.Authorization);
  if (!hasCredential) {
    logger.warn('[AUTH] Protected request rejected: no access credential.', {
      method: req.method,
      path: req.path
    });
    return next(new AppError('Authentication required. Please log in to proceed.', 401));
  }

  const decoded = getAuthenticatedTokenPayload(req);
  if (!decoded) {
    logger.warn('[AUTH] Protected request rejected: access credentials are invalid or expired.', {
      method: req.method,
      path: req.path
    });
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

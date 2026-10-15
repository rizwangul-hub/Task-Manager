import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { generateTokens, setAuthCookies, clearAuthCookies, verifyRefreshToken } from '../utils/token.js';
import { AppError } from '../middleware/errorHandler.js';

export const authController = {
  /** Authenticate any active workspace account. */
  login: async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return next(new AppError('Database service is currently unavailable. Please verify MongoDB connection.', 503));
    }

    const { email, password } = req.body || {};

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return next(new AppError('Please provide both email and password.', 400));
    }

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

      if (!user) {
        return next(new AppError('Invalid email or password.', 401));
      }

      if (!user.isActive) {
        return next(new AppError('This account has been deactivated. Please contact your administrator.', 403));
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return next(new AppError('Invalid email or password.', 401));
      }

      // Update last login timestamp
      user.lastLogin = new Date();
      await user.save();

      // Issue tokens and cookies
      const { accessToken, refreshToken } = generateTokens(user);
      setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        status: 'success',
        message: 'Authentication successful',
        data: {
          user: user.toJSON(),
          accessToken
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * User logout endpoint
   * POST /api/auth/logout
   */
  logout: async (req, res) => {
    clearAuthCookies(res);
    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully.'
    });
  },

  /**
   * Refresh session access token
   * POST /api/auth/refresh
   */
  refresh: async (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      return next(new AppError('Database service is currently unavailable.', 503));
    }

    const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;

    if (!refreshToken) {
      return next(new AppError('Refresh token required.', 401));
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      clearAuthCookies(res);
      return next(new AppError('Invalid or expired refresh token. Please log in again.', 401));
    }

    try {
      const user = await User.findById(decoded.id);
      if (!user || !user.isActive) {
        clearAuthCookies(res);
        return next(new AppError('User not found or account deactivated.', 401));
      }

      const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
      setAuthCookies(res, accessToken, newRefreshToken);

      res.status(200).json({
        status: 'success',
        data: {
          user: user.toJSON(),
          accessToken
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get current authenticated user session
   * GET /api/auth/me
   */
  getMe: async (req, res) => {
    res.status(200).json({
      status: 'success',
      data: {
        user: req.user.toJSON()
      }
    });
  }
};

export default authController;

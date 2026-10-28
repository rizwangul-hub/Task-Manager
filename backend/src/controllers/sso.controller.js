import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { generateTokens, setAuthCookies } from '../utils/token.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const SSO_ISSUER = 'https://portal.pixxtech.internal';
const ALLOWED_AUDIENCES = ['task-manager', 'tasks'];
const ALLOWED_ALGORITHMS = ['HS256'];

// Atomic in-memory replay prevention cache
const redeemedTickets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [jti, expMs] of redeemedTickets.entries()) {
    if (now > expMs) {
      redeemedTickets.delete(jti);
    }
  }
}, 60000).unref();

const getSSOSecret = () => {
  return process.env.SSO_SECRET || process.env.CENTRAL_PORTAL_SECRET || env.JWT.accessSecret || 'pixxtech_central_portal_sso_secret_2026';
};

/**
 * Exchange Central Portal SSO authorization ticket for Task Manager session (access token + refresh cookie)
 * POST /api/auth/sso/exchange
 */
export const ssoExchange = async (req, res, next) => {
  try {
    const { ticket } = req.body || {};

    if (!ticket || typeof ticket !== 'string') {
      return next(new AppError('SSO authorization ticket is required.', 400));
    }

    const ssoSecret = getSSOSecret();
    let decoded;

    try {
      decoded = jwt.verify(ticket, ssoSecret, {
        issuer: SSO_ISSUER,
        algorithms: ALLOWED_ALGORITHMS,
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('The SSO authorization ticket has expired. Please launch again from Central Portal.', 401));
      }
      return next(new AppError(`Invalid SSO authorization ticket: ${err.message}`, 401));
    }

    // Audience verification
    if (!ALLOWED_AUDIENCES.includes(decoded.aud)) {
      return next(new AppError(`Ticket audience mismatch. Expected 'task-manager', got '${decoded.aud}'.`, 403));
    }

    // Mandatory claims verification
    if (!decoded.jti || !decoded.sub || !decoded.email) {
      return next(new AppError('SSO ticket is missing mandatory identity claims (jti, sub, email).', 400));
    }

    // Atomic replay protection
    if (redeemedTickets.has(decoded.jti)) {
      return next(new AppError('SSO ticket has already been redeemed (replay detected).', 401));
    }

    const expMs = (decoded.exp || Math.floor(Date.now() / 1000) + 300) * 1000;
    redeemedTickets.set(decoded.jti, expMs);

    const normalizedEmail = decoded.email.toLowerCase().trim();

    // Query user without altering credentials
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return next(new AppError(`No active account found for '${normalizedEmail}' in Task Manager. Please contact administration for local user provisioning.`, 404));
    }

    if (!user.isActive) {
      return next(new AppError('This account has been deactivated in Task Manager.', 403));
    }

    // Update login timestamp
    user.lastLogin = new Date();
    await user.save();

    // Generate Task Manager dual token flow (Access Token + Refresh Token)
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure HTTP-only refresh cookies
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json({
      status: 'success',
      message: 'SSO authentication successful',
      data: {
        user: user.toJSON(),
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

export default { ssoExchange };

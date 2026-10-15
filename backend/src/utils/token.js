import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generate Access and Refresh JWT tokens
 */
export const generateTokens = (user) => {
  const payload = {
    id: user._id.toString(),
    role: user.role,
    email: user.email
  };

  const accessToken = jwt.sign(payload, env.JWT.accessSecret, {
    expiresIn: env.JWT.accessExpiresIn
  });

  const refreshToken = jwt.sign({ id: user._id.toString() }, env.JWT.refreshSecret, {
    expiresIn: env.JWT.refreshExpiresIn
  });

  return { accessToken, refreshToken };
};

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.JWT.accessSecret);
  } catch (error) {
    return null;
  }
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, env.JWT.refreshSecret);
  } catch (error) {
    return null;
  }
};

/**
 * Attach secure, HTTP-only authentication cookies to response
 */
export const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProduction = env.NODE_ENV === 'production' || env.JWT.cookieSecure;
  const sameSite = env.JWT.cookieSameSite || (isProduction ? 'none' : 'lax');
  const secure = isProduction || sameSite === 'none';

  // Access token cookie (short-lived)
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  // Refresh token cookie (long-lived, restricted path)
  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
  }
};

/**
 * Clear authentication cookies on logout
 */
export const clearAuthCookies = (res) => {
  const isProduction = env.NODE_ENV === 'production' || env.JWT.cookieSecure;
  const sameSite = env.JWT.cookieSameSite || (isProduction ? 'none' : 'lax');
  const secure = isProduction || sameSite === 'none';

  res.clearCookie('access_token', {
    httpOnly: true,
    secure,
    sameSite
  });

  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth'
  });
};

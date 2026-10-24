import rateLimit from 'express-rate-limit';

/**
 * Standard API rate limiter to protect against brute-force or runaway traffic
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Limit each IP to 2000 requests per windowMs for active collaborative workspace
  skip: (req) =>
    req.path.startsWith('/webhook/') ||
    req.path.startsWith('/webhooks/') ||
    req.path === '/health' ||
    req.path.endsWith('/health'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    statusCode: 429,
    message: 'Too many requests from this IP address. Please try again after 15 minutes.'
  }
});

export const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    statusCode: 429,
    message: 'Too many webhook requests. Please retry later.'
  }
});

/**
 * Strict rate limiter for authentication routes to prevent brute-force attacks
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 login attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    statusCode: 429,
    message: 'Too many authentication attempts from this IP. Please wait 15 minutes before trying again.'
  }
});

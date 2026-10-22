import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || resolve(backendRoot, '.env');
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: envPath });
}

const exampleJwtSecrets = new Set([
  'pixx_default_dev_access_secret_change_in_prod',
  'pixx_default_dev_refresh_secret_change_in_prod',
  'your_super_secret_access_jwt_key_min_32_chars',
  'your_super_secret_refresh_jwt_key_min_32_chars',
  'replace-with-a-unique-random-secret-at-least-32-characters',
  'replace-with-a-different-unique-random-secret-at-least-32-characters'
]);

const isExampleJwtSecret = (secret) =>
  exampleJwtSecrets.has(String(secret || '').trim().toLowerCase());

export const getProductionJwtSecretErrors = ({ accessSecret, refreshSecret }) => {
  const errors = [];
  const access = String(accessSecret || '').trim();
  const refresh = String(refreshSecret || '').trim();

  if (!access) {
    errors.push('JWT_ACCESS_SECRET (or JWT_SECRET) must be explicitly set in production.');
  } else if (access.length < 32 || isExampleJwtSecret(access)) {
    errors.push('JWT_ACCESS_SECRET (or JWT_SECRET) must be a unique, non-example secret with at least 32 characters.');
  }

  if (!refresh) {
    errors.push('JWT_REFRESH_SECRET must be explicitly set in production.');
  } else if (refresh.length < 32 || isExampleJwtSecret(refresh)) {
    errors.push('JWT_REFRESH_SECRET must be a unique, non-example secret with at least 32 characters.');
  }

  if (access && refresh && access === refresh) {
    errors.push('JWT access and refresh secrets must be distinct.');
  }

  return errors;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const frontendUrl = process.env.FRONTEND_URL || (nodeEnv === 'production' ? '' : 'http://localhost:5173');

/**
 * Validate and export normalized environment configuration
 */
export const env = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI || '',
  FRONTEND_URL: frontendUrl,
  FRONTEND_ORIGINS: [
    frontendUrl,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    ...(process.env.FRONTEND_URLS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
  ],
  REDIS_URL: process.env.REDIS_URL || '',
  JWT: {
    accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'pixx_default_dev_access_secret_change_in_prod'),
    refreshSecret: process.env.JWT_REFRESH_SECRET || (nodeEnv === 'production' ? '' : 'pixx_default_dev_refresh_secret_change_in_prod'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    cookieSameSite: process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')
  },
  OWNER: {
    email: process.env.OWNER_EMAIL || process.env.INITIAL_ADMIN_EMAIL || 'admin@pixxtechnologiees.com',
    password: process.env.OWNER_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '',
    name: process.env.OWNER_NAME || process.env.INITIAL_ADMIN_NAME || 'Workspace Owner'
  },
  INITIAL_ADMIN: {
    email: process.env.OWNER_EMAIL || process.env.INITIAL_ADMIN_EMAIL || 'admin@pixxtechnologiees.com',
    password: process.env.OWNER_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '',
    name: process.env.OWNER_NAME || process.env.INITIAL_ADMIN_NAME || 'Workspace Owner'
  },
  CLOUDINARY: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    isConfigured: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    )
  },
  EMAIL: {
    // Standard SMTP fields (host-based or Gmail App Password)
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    // SMTP credentials (Gmail App Password path uses SMTP_USER + SMTP_PASS)
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    // OAuth2 credentials (fallback path)
    emailUser: process.env.EMAIL_USER || '',
    oauthClientId: process.env.OAUTH_CLIENT_ID || '',
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '',
    oauthRefreshToken: process.env.OAUTH_REFRESH_TOKEN || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || 'PixxTechnologiees Task Manager <notifications@pixxtechnologiees.com>',
    // Gmail App Password: SMTP_USER + SMTP_PASS set and SMTP_PASS is not the example placeholder
    isSmtpAppPasswordConfigured: Boolean(
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_PASS !== 'your_email_app_password'
    ),
    // Full OAuth2 (all four variables present)
    isOAuthConfigured: Boolean(
      process.env.EMAIL_USER &&
      process.env.OAUTH_CLIENT_ID &&
      process.env.OAUTH_CLIENT_SECRET &&
      process.env.OAUTH_REFRESH_TOKEN
    ),
    // Legacy SMTP (host + user + pass, any password)
    isSmtpConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
    // Overall: any transport is ready
    isConfigured: Boolean(
      (process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_PASS !== 'your_email_app_password') ||
      (process.env.EMAIL_USER &&
        process.env.OAUTH_CLIENT_ID &&
        process.env.OAUTH_CLIENT_SECRET &&
        process.env.OAUTH_REFRESH_TOKEN) ||
      (process.env.SMTP_USER && process.env.SMTP_PASS)
    )
  },
  SCHEDULER: {
    enabled: process.env.ENABLE_SCHEDULER !== 'false' && process.env.SCHEDULER_ENABLED !== 'false',
    cronExpr: process.env.SCHEDULER_CRON || '0 * * * *',
    dueSoonHours: parseInt(process.env.REMINDER_DUE_SOON_HOURS, 10) || 24,
    intervalMinutes: parseInt(process.env.REMINDER_INTERVAL_MINUTES, 10) || 60,
    timezone: process.env.SCHEDULER_TIMEZONE || 'UTC'
  },
  WHATSAPP: {
    authInfoPath: process.env.AUTH_INFO_PATH || './auth_info_baileys',
    maxMediaBytes: parseInt(process.env.WHATSAPP_MAX_MEDIA_BYTES, 10) || 10 * 1024 * 1024
  },
  GEMINI: {
    apiKey: process.env.GEMINI_API_KEY || '',
    apiUrl: process.env.GEMINI_API_URL || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '1061431060123',
    isConfigured: Boolean(process.env.GEMINI_API_KEY)
  }
};

/**
 * Perform startup validation of critical environment variables
 */
export const validateEnv = () => {
  logger.info(`Starting PixxTechnologiees Task Manager API in [${env.NODE_ENV}] mode`);

  if (!env.MONGODB_URI) {
    logger.warn('MONGODB_URI is not set. Database connection will not be initiated until configured.');
  }

  if (env.NODE_ENV === 'production') {
    const configErrors = getProductionJwtSecretErrors({
      accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      refreshSecret: process.env.JWT_REFRESH_SECRET
    });
    if (!env.MONGODB_URI) {
      configErrors.push('MONGO_URI (or MONGODB_URI) is required.');
    }
    if (process.env.REQUIRE_REDIS === 'true' && !env.REDIS_URL) {
      configErrors.push('REDIS_URL is required for clustered Socket.IO event delivery.');
    }
    if (!env.FRONTEND_URL) {
      configErrors.push('FRONTEND_URL must be set to the production frontend origin.');
    }
    if (configErrors.length) {
      configErrors.forEach((message) => logger.error(`CRITICAL: ${message}`));
      throw new Error(`Invalid production configuration: ${configErrors.join(' ')}`);
    }
  }

  if (!env.CLOUDINARY.isConfigured) {
    logger.info('Cloudinary credentials are not configured. Upload features will remain dormant until configured.');
  } else {
    logger.info('Cloudinary configuration detected and ready for media operations.');
  }

  if (!env.EMAIL.isConfigured) {
    logger.info('Email credentials are not configured. In-app notifications will function; email alerts will be logged.');
  } else {
    logger.info(`Email configured using ${env.EMAIL.isOAuthConfigured ? 'Google OAuth2' : 'SMTP credentials'}.`);
  }

  if (process.env.AI_PROVIDER === 'gemini') {
    if (!env.GEMINI.apiKey) {
      logger.info('AI_PROVIDER is set to "gemini", but GEMINI_API_KEY is not configured. Falling back to built-in rule-based extractor.');
    } else {
      logger.info(`Google Gemini AI task extraction enabled (model: ${env.GEMINI.model}).`);
    }
  } else if (process.env.AI_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      logger.info('AI_PROVIDER is set to "openai", but OPENAI_API_KEY is not configured. Falling back to built-in rule-based extractor.');
    } else {
      logger.info(`OpenAI task extraction enabled (model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}).`);
    }
  } else {
    logger.info('AI task extraction using built-in rule-based heuristic extractor.');
  }
};

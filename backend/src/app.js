import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { connectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import apiRouter from './routes/index.js';

const app = express();
const sanitizeMongoInput = mongoSanitize();

// Ensure MongoDB is connected on incoming requests (essential for serverless runtimes like Vercel)
app.use(async (req, res, next) => {
  try {
    await connectDB();
  } catch (err) {
    logger.error('[DB_MIDDLEWARE_ERROR] Error connecting to database on request:', err);
  }
  next();
});
app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

// Security HTTP headers
app.use(helmet());

// Cross-Origin Resource Sharing
const allowedOrigins = env.NODE_ENV === 'production'
  ? env.FRONTEND_ORIGINS
  : [...env.FRONTEND_ORIGINS, 'http://127.0.0.1:5173'];

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // In development, allow any localhost or 127.0.0.1 port (5173, 5174, etc.)
  if (env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  // Allow all Vercel deployment URLs (*.vercel.app)
  if (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) return true;
  return false;
};

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Hub-Signature-256',
    'X-WhatsApp-Webhook-Secret',
    'X-Twilio-Signature'
  ]
}));

// HTTP request logger
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Keep the original Meta webhook payload available for signature verification.
app.use(['/api/webhook/whatsapp', '/api/webhooks/whatsapp'], express.raw({ type: 'application/json', limit: '1mb' }));

// Body and Cookie parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/webhook/') ||
    req.path.startsWith('/api/webhooks/')
  ) return next();
  return sanitizeMongoInput(req, res, next);
});

// Apply rate limiting to all /api routes
app.use('/api', apiLimiter);

// Mount main API routes
app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'PixxTechnologiees Task Manager API',
    api: '/api',
    health: '/api/health'
  });
});

// 404 Handler for unmatched routes
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;

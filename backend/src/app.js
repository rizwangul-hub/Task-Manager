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
import apiRouter from './routes/index.js';

const app = express();
const sanitizeMongoInput = mongoSanitize();
app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

// Security HTTP headers
app.use(helmet());

// Cross-Origin Resource Sharing
const allowedOrigins = env.NODE_ENV === 'production'
  ? env.FRONTEND_ORIGINS
  : [...env.FRONTEND_ORIGINS, 'http://127.0.0.1:5173'];
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients have no Origin header; browser origins must be explicitly allowed.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
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

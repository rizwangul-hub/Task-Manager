import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import cookie from 'cookie';
import { verifyAccessToken } from '../utils/token.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { User } from '../models/user.model.js';

let io = null;
let redisClients = [];

export const socketService = {
  /**
   * Initialize Socket.IO with HTTP server
   * @param {http.Server} httpServer
   */
  init: async (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: env.NODE_ENV === 'production'
          ? env.FRONTEND_ORIGINS
          : [...env.FRONTEND_ORIGINS, 'http://127.0.0.1:5173'],
        credentials: true,
        methods: ['GET', 'POST']
      },
      pingTimeout: 30000,
      pingInterval: 25000
    });

    if (env.REDIS_URL) {
      const publisher = createClient({ url: env.REDIS_URL });
      const subscriber = publisher.duplicate();
      publisher.on('error', (error) => logger.error('Socket.IO Redis publisher error:', error));
      subscriber.on('error', (error) => logger.error('Socket.IO Redis subscriber error:', error));
      await Promise.all([publisher.connect(), subscriber.connect()]);
      io.adapter(createAdapter(publisher, subscriber));
      redisClients = [publisher, subscriber];
    } else if (env.NODE_ENV === 'production' && process.env.REQUIRE_REDIS === 'true') {
      throw new Error('REDIS_URL is required for production Socket.IO event delivery.');
    } else {
      logger.info('Socket.IO initialized with default in-memory adapter (single-instance).');
    }

    // Authentication middleware
    io.use(async (socket, next) => {
      try {
        let token = socket.handshake.auth?.token;

        // Fallback: extract token from Cookie header
        if (!token && socket.handshake.headers?.cookie) {
          const parsedCookies = cookie.parse(socket.handshake.headers.cookie);
          token = parsedCookies.access_token;
        }

        if (!token) {
          return next(new Error('Authentication required for socket connection.'));
        }

        const decoded = verifyAccessToken(token);
        if (!decoded || !decoded.id) {
          return next(new Error('Invalid or expired socket authentication token.'));
        }

        const user = await User.findById(decoded.id);
        if (!user || !user.isActive) {
          return next(new Error('Socket access is unavailable for this account.'));
        }

        socket.user = {
          _id: user._id,
          role: user.role,
          email: user.email
        };

        next();
      } catch (err) {
        logger.error('Socket authentication error:', err);
        next(new Error('Socket authentication could not be verified.'));
      }
    });

    io.on('connection', (socket) => {
      const userId = socket.user._id.toString();
      const userRoom = `user:${userId}`;

      // Automatically join isolated user room
      socket.join(userRoom);
      socket.join(userId);
      logger.info(`User connected to live socket: ${userId} (${socket.id})`);

      // Prevent unauthorized joining of other user rooms
      socket.on('join_room', (room) => {
        if (!room || typeof room !== 'string') return;
        if (room.startsWith('user:') && room !== userRoom) {
          logger.warn(`User ${userId} attempted to join unauthorized room: ${room}`);
          return;
        }
        socket.join(room);
      });

      socket.on('disconnect', () => {
        logger.info(`User disconnected from socket: ${userId}`);
      });
    });

    return io;
  },

  /**
   * Get Socket.IO instance
   */
  getIO: () => io,

  close: async () => {
    io?.disconnectSockets(true);
    await Promise.all(redisClients.map((client) => client.quit()));
    redisClients = [];
  },

  /**
   * Emit new in-app notification to a specific user's private room
   * @param {string} userId
   * @param {Object} notification
   */
  emitNotification: (userId, notification) => {
    if (!io) return;
    try {
      const recipientId = userId.toString();
      io.to(`user:${recipientId}`).emit('notification:new', notification);
      io.to(recipientId).emit('new_notification', notification);
    } catch (err) {
      logger.error(`Failed to emit live notification to user ${userId}:`, err);
    }
  },

  emitUserEvent: (userId, eventName, payload) => {
    if (!io || !userId || !eventName) return;
    try {
      io.to(`user:${userId.toString()}`).emit(eventName, payload);
    } catch (err) {
      logger.error(`Failed to emit ${eventName} to user ${userId}:`, err);
    }
  },

  /**
   * Emit task change event to authorized users
   * @param {Array<string>} userIds
   * @param {Object} payload
   */
  emitTaskUpdate: (userIds = [], payload = {}) => {
    if (!io || !Array.isArray(userIds)) return;
    userIds.forEach((uid) => {
      if (uid) {
        try {
          io.to(`user:${uid.toString()}`).emit('task:updated', payload);
        } catch (err) {
          logger.error(`Failed to emit task update to user ${uid}:`, err);
        }
      }
    });
  }
};

export default socketService;

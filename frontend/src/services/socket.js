import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Derive socket origin by stripping /api path, or use explicit VITE_SOCKET_URL
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_URL.replace(/\/api\/?$/, '');

// Detect whether backend is deployed to Vercel serverless functions (which do not support persistent WebSockets)
const isVercelServerless = !import.meta.env.VITE_SOCKET_URL && (
  SOCKET_URL.includes('.vercel.app') ||
  (typeof window !== 'undefined' && window.location.hostname.includes('.vercel.app') && SOCKET_URL.includes('.vercel.app'))
);

const isSocketDisabled = import.meta.env.VITE_ENABLE_SOCKET === 'false' || isVercelServerless;

// Safe mock socket for platforms where persistent WebSockets are unavailable
const createNoopSocket = () => {
  const listeners = new Map();
  return {
    connected: false,
    isMock: true,
    on: function (event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return this;
    },
    off: function (event, handler) {
      if (listeners.has(event)) {
        if (handler) {
          listeners.get(event).delete(handler);
        } else {
          listeners.delete(event);
        }
      }
      return this;
    },
    emit: function (event, data) {
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.forEach((fn) => {
          try { fn(data); } catch (e) { console.error(e); }
        });
      }
      return this;
    },
    disconnect: function () {
      listeners.clear();
    }
  };
};

let socketInstance = null;

export const socketService = {
  /**
   * Connect to WebSocket server with credentials (or fallback mock on serverless hosts)
   */
  connect: () => {
    // If backend is on Vercel serverless, WebSockets are unsupported by Vercel platform.
    // Return a safe no-op mock to prevent console error storms while HTTP polling handles updates.
    if (isSocketDisabled) {
      if (!socketInstance) {
        socketInstance = createNoopSocket();
      }
      return socketInstance;
    }

    if (socketInstance && socketInstance.connected) {
      return socketInstance;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('task_access_token') : null;
    socketInstance = io(SOCKET_URL, {
      withCredentials: true,
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      autoConnect: true
    });

    socketInstance.on('connect_error', (error) => {
      // Suppress unhandled console noise if server is offline
      if (import.meta.env.DEV) {
        console.debug('[Socket] Connection attempt:', error.message);
      }
    });

    return socketInstance;
  },

  /**
   * Get active socket instance
   */
  getSocket: () => socketInstance,

  /**
   * Disconnect socket cleanly
   */
  disconnect: () => {
    if (socketInstance && typeof socketInstance.disconnect === 'function') {
      socketInstance.disconnect();
    }
    socketInstance = null;
  }
};

export default socketService;

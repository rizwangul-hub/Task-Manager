import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Derive socket origin by stripping /api path
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socketInstance = null;

export const socketService = {
  /**
   * Connect to WebSocket server with credentials
   */
  connect: () => {
    if (socketInstance && socketInstance.connected) {
      return socketInstance;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('task_access_token') : null;
    socketInstance = io(SOCKET_URL, {
      withCredentials: true,
      auth: { token },
      transports: ['websocket', 'polling'],
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
    if (socketInstance) {
      socketInstance.disconnect();
      socketInstance = null;
    }
  }
};

export default socketService;

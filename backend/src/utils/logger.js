/**
 * Structured console logger for PixxTechnologiees Task Manager backend
 */

const formatTimestamp = () => new Date().toISOString();

export const logger = {
  info: (message, meta = {}) => {
    console.log(`[${formatTimestamp()}] [INFO] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
  },
  warn: (message, meta = {}) => {
    console.warn(`[${formatTimestamp()}] [WARN] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
  },
  error: (message, error = null) => {
    console.error(
      `[${formatTimestamp()}] [ERROR] ${message}`,
      error ? (error.stack || error.message || error) : ''
    );
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[${formatTimestamp()}] [DEBUG] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
  }
};

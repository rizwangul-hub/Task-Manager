import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let isInitialized = false;

if (env.CLOUDINARY.isConfigured) {
  try {
    cloudinary.config({
      cloud_name: env.CLOUDINARY.cloudName,
      api_key: env.CLOUDINARY.apiKey,
      api_secret: env.CLOUDINARY.apiSecret,
      secure: true
    });
    isInitialized = true;
    logger.info('Cloudinary SDK initialized successfully.');
  } catch (error) {
    logger.error('Error configuring Cloudinary SDK:', error);
  }
} else {
  logger.info('Cloudinary SDK deferred initialization: Credentials not provided.');
}

/**
 * Returns configuration state without revealing sensitive credentials
 */
export const getCloudinaryStatus = () => ({
  configured: isInitialized,
  cloudName: env.CLOUDINARY.cloudName ? `${env.CLOUDINARY.cloudName.substring(0, 3)}***` : null
});

export { cloudinary };

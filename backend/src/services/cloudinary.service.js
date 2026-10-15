import { cloudinary, getCloudinaryStatus } from '../config/cloudinary.js';
import { logger } from '../utils/logger.js';

/**
 * Service providing safe, typed wrappers around Cloudinary operations.
 */
export const cloudinaryService = {
  /**
   * Check if Cloudinary is configured and ready for file operations
   */
  isReady: () => {
    return getCloudinaryStatus().configured;
  },

  /**
   * Upload an asset stream or buffer to Cloudinary
   * @param {string|Buffer} file - File path or buffer
   * @param {Object} options - Upload options (folder, tags, transformations)
   */
  uploadAsset: async (file, options = {}) => {
    if (!cloudinaryService.isReady()) {
      throw new Error('Cloudinary is not configured on this server. Please provide CLOUDINARY credentials in .env.');
    }

    try {
      const defaultOptions = {
        folder: 'pixx_task_manager',
        resource_type: 'auto',
        ...options
      };

      const result = await cloudinary.uploader.upload(file, defaultOptions);
      logger.info('Asset uploaded successfully to Cloudinary', { public_id: result.public_id });

      return {
        publicId: result.public_id,
        url: result.secure_url,
        format: result.format,
        bytes: result.bytes,
        resourceType: result.resource_type
      };
    } catch (error) {
      logger.error('Cloudinary asset upload failed:', error);
      throw error;
    }
  },

  /**
   * Upload in-memory file buffer directly to Cloudinary via upload_stream
   * @param {Buffer} buffer - File buffer from Multer memory storage
   * @param {Object} options - Upload options
   */
  uploadBuffer: (buffer, options = {}) => {
    if (!cloudinaryService.isReady()) {
      throw new Error('Cloudinary storage is not configured. Please configure CLOUDINARY in backend/.env.');
    }

    return new Promise((resolve, reject) => {
      const defaultOptions = {
        folder: 'pixx_task_attachments',
        resource_type: 'auto',
        ...options
      };

      const stream = cloudinary.uploader.upload_stream(defaultOptions, (error, result) => {
        if (error) {
          logger.error('Cloudinary buffer stream upload error:', error);
          return reject(error);
        }

        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          format: result.format,
          bytes: result.bytes,
          resourceType: result.resource_type
        });
      });

      stream.end(buffer);
    });
  },

  /**
   * Delete an asset from Cloudinary
   * @param {string} publicId - Cloudinary asset public ID
   */
  deleteAsset: async (publicId) => {
    if (!cloudinaryService.isReady()) {
      throw new Error('Cloudinary is not configured on this server.');
    }

    try {
      const result = await cloudinary.uploader.destroy(publicId);
      logger.info('Asset removed from Cloudinary', { publicId, result });
      return result;
    } catch (error) {
      logger.error('Failed to delete asset from Cloudinary:', error);
      throw error;
    }
  }
};

export default cloudinaryService;

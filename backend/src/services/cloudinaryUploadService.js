import path from 'node:path';
import { cloudinaryService } from './cloudinary.service.js';
import { cloudinary } from '../config/cloudinary.js';
import { env } from '../config/env.js';

const UPLOAD_TIMEOUT_MS = 120_000;

export const uploadBufferToCloudinary = (buffer, folderName, originalFilename) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new TypeError('Cloudinary upload requires a non-empty Buffer.'));
  }
  if (buffer.length > env.WHATSAPP.maxMediaBytes) {
    return Promise.reject(new Error('WhatsApp media exceeds the configured upload size limit.'));
  }
  if (!folderName || !originalFilename) {
    return Promise.reject(new Error('Cloudinary folder and original filename are required.'));
  }
  if (!cloudinaryService.isReady()) {
    return Promise.reject(new Error('Cloudinary is not configured on this server.'));
  }

  const fileName = path.basename(originalFilename);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };

    const timeout = setTimeout(() => {
      const error = new Error(`Cloudinary upload timed out after ${UPLOAD_TIMEOUT_MS}ms.`);
      stream.destroy(error);
      finish(error);
    }, UPLOAD_TIMEOUT_MS);

    let stream;
    try {
      stream = cloudinary.uploader.upload_stream(
        { folder: folderName, resource_type: 'auto' },
        (error, result) => {
          if (error) return finish(error);
          if (!result?.secure_url || !result.public_id) {
            return finish(new Error('Cloudinary returned an incomplete upload result.'));
          }
          finish(null, {
            url: result.secure_url,
            public_id: result.public_id,
            fileName
          });
        }
      );
      stream.on('error', (error) => finish(error));
      stream.end(buffer);
    } catch (error) {
      finish(error);
    }
  });
};

export default uploadBufferToCloudinary;

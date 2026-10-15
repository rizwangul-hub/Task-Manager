import multer from 'multer';
import { AppError } from './errorHandler.js';

// Memory storage to stream buffer directly to Cloudinary
const storage = multer.memoryStorage();

// File type filter
const fileFilter = (req, file, cb) => {
  const allowedMimePrefixes = ['image/', 'application/pdf', 'text/'];
  const allowedMimes = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed'
  ];

  const isAllowedPrefix = allowedMimePrefixes.some((prefix) => file.mimetype.startsWith(prefix));
  const isAllowedMime = allowedMimes.includes(file.mimetype);

  if (isAllowedPrefix || isAllowedMime) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `File type '${file.mimetype}' is not permitted. Please upload an image, PDF, document, or spreadsheet.`,
        400
      ),
      false
    );
  }
};

export const uploadAttachment = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB maximum file size
  },
  fileFilter
}).single('file');

export default uploadAttachment;

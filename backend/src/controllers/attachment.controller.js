import { Task } from '../models/task.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { USER_ROLES } from '../models/user.model.js';
import { cloudinaryService } from '../services/cloudinary.service.js';
import { AppError } from '../middleware/errorHandler.js';

export const attachmentController = {
  /**
   * Upload an attachment to a task
   * POST /api/tasks/:id/attachments
   */
  uploadAttachment: async (req, res, next) => {
    const { id } = req.params;

    if (!req.file) {
      return next(new AppError('No file was uploaded. Please attach a file.', 400));
    }

    try {
      const task = await Task.findById(id).populate('project', 'manager members name');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      // Check authorization: Admins, or project/task affiliates for non-admins
      if (req.user.role === USER_ROLES.MEMBER) {
        const isAssignee = task.assignees?.some((a) => (a._id || a).toString() === req.user._id.toString());

        if (!isAssignee) {
          return next(new AppError('Access denied: You are not authorized to upload attachments to this task.', 403));
        }
      }

      // Verify Cloudinary configuration
      if (!cloudinaryService.isReady()) {
        return next(
          new AppError(
            'Cloudinary file storage service is unconfigured. Please configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in backend/.env to enable file attachments.',
            503
          )
        );
      }

      // Stream buffer directly to Cloudinary
      const uploadResult = await cloudinaryService.uploadBuffer(req.file.buffer, {
        folder: `pixx_tasks/${task._id}`,
        resource_type: 'auto'
      });

      const newAttachment = {
        publicId: uploadResult.publicId,
        url: uploadResult.url,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        bytes: uploadResult.bytes || req.file.size,
        uploadedBy: req.user._id,
        uploadedAt: new Date()
      };

      task.attachments.push(newAttachment);
      await task.save();

      const savedAttachment = task.attachments[task.attachments.length - 1];

      // Audit log event
      await TaskEvent.logEvent({
        task: task._id,
        project: task.project ? (task.project._id || task.project) : null,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.ATTACHMENT_ADDED,
        details: {
          attachmentId: savedAttachment._id,
          fileName: savedAttachment.fileName,
          bytes: savedAttachment.bytes,
          fileType: savedAttachment.fileType
        }
      });

      res.status(201).json({
        status: 'success',
        message: 'Attachment uploaded successfully.',
        data: {
          attachment: savedAttachment
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Delete an attachment from a task
   * DELETE /api/tasks/:id/attachments/:attachmentId
   */
  deleteAttachment: async (req, res, next) => {
    const { id, attachmentId } = req.params;

    try {
      const task = await Task.findById(id).populate('project', 'manager members');
      if (!task) {
        return next(new AppError('Task not found.', 404));
      }

      const attachment = task.attachments.id(attachmentId);
      if (!attachment) {
        return next(new AppError('Attachment not found.', 404));
      }

      // Permission check: Admins, Project Managers, or the user who uploaded the file
      const canManage = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.MANAGER;
      const isUploader = attachment.uploadedBy?.toString() === req.user._id.toString();

      if (!canManage && !isUploader) {
        return next(new AppError('Access forbidden: You can only delete attachments that you uploaded.', 403));
      }

      // Best-effort delete from Cloudinary
      if (cloudinaryService.isReady() && attachment.publicId) {
        try {
          await cloudinaryService.deleteAsset(attachment.publicId);
        } catch (cloudErr) {
          console.warn('[CLOUDINARY_DELETE_WARNING] Could not delete remote asset:', cloudErr.message);
        }
      }

      const removedDetails = {
        fileName: attachment.fileName,
        publicId: attachment.publicId
      };

      task.attachments.pull(attachmentId);
      await task.save();

      // Audit log event
      await TaskEvent.logEvent({
        task: task._id,
        project: task.project ? (task.project._id || task.project) : null,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.ATTACHMENT_REMOVED,
        details: removedDetails
      });

      res.status(200).json({
        status: 'success',
        message: 'Attachment removed successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
};

export default attachmentController;

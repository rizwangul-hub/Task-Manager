import mongoose from 'mongoose';
import { MonitoredGroup } from '../models/monitoredGroup.model.js';
import { TaskDraft, TASK_DRAFT_STATUSES } from '../models/taskDraft.model.js';
import { Task, TASK_STATUSES, TASK_PRIORITIES, TASK_SOURCES } from '../models/task.model.js';
import { Project } from '../models/project.model.js';
import { User } from '../models/user.model.js';
import { Contact } from '../models/contact.model.js';
import { TaskEvent, TASK_EVENT_ACTIONS } from '../models/taskEvent.model.js';
import { getParticipatingGroups, getWhatsAppDiagnostics } from '../services/whatsappService.js';
import { extractTaskFromWhatsAppMessage } from '../services/aiTaskExtraction.service.js';
import { socketService } from '../services/socket.service.js';
import {
  getWhatsAppHistoryResetPreview,
  resetWhatsAppHistory
} from '../services/whatsappHistoryReset.service.js';
import { runWhatsAppInboundMaintenance } from '../services/whatsappService.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export const whatsappDraftController = {
  getHistoryResetPreview: async (_req, res, next) => {
    try {
      const preview = await getWhatsAppHistoryResetPreview();
      res.status(200).json({
        status: 'success',
        data: { preview }
      });
    } catch (error) {
      next(error);
    }
  },

  resetHistory: async (req, res, next) => {
    if (req.body?.confirmed !== true) {
      return next(new AppError('Explicit confirmation is required to reset WhatsApp task history.', 400));
    }
    const expectedCounts = req.body?.expectedCounts;
    if (
      !expectedCounts ||
      !Number.isInteger(expectedCounts.tasks) ||
      !Number.isInteger(expectedCounts.drafts)
    ) {
      return next(new AppError('A current WhatsApp task and draft count preview is required.', 400));
    }

    try {
      await runWhatsAppInboundMaintenance(async () => {
        const preview = await getWhatsAppHistoryResetPreview();
        if (preview.tasks !== expectedCounts.tasks || preview.drafts !== expectedCounts.drafts) {
          return res.status(409).json({
            status: 'fail',
            message: 'WhatsApp task or draft counts changed. Review the updated counts and confirm again.',
            data: { preview }
          });
        }

        const result = await resetWhatsAppHistory(req.user);
        logger.info('WhatsApp task history reset completed.', {
          adminId: req.user._id.toString(),
          tasks: result.tasks,
          drafts: result.drafts,
          taskEvents: result.taskEvents,
          comments: result.comments,
          timeEntries: result.timeEntries,
          whatsappNotifications: result.whatsappNotifications,
          notifications: result.notifications,
          notificationOutbox: result.notificationOutbox,
          groupsUpdated: result.groupsUpdated,
          startedAt: result.startedAt.toISOString()
        });
        res.status(200).json({
          status: 'success',
          message: 'Old WhatsApp tasks and drafts were cleared. New message processing has started.',
          data: { result }
        });
      });
    } catch (error) {
      logger.error('WhatsApp task history reset failed.', error);
      next(error);
    }
  },

  /**
   * GET /api/whatsapp/groups
   * Fetches available WhatsApp groups from Baileys and merges with database monitoring configuration
   */
  getGroups: async (req, res, next) => {
    try {
      const baileysRes = await getParticipatingGroups();
      const baileysGroups = baileysRes.groups || [];

      const monitoredDocs = await MonitoredGroup.find().lean();
      const monitoredMap = new Map(monitoredDocs.map((m) => [m.groupJid, m]));

      // Merge groups
      const mergedMap = new Map();

      // First add Baileys participating groups
      for (const bg of baileysGroups) {
        const stored = monitoredMap.get(bg.id);
        mergedMap.set(bg.id, {
          groupJid: bg.id,
          groupName: bg.subject || stored?.groupName || 'Unnamed Group',
          isMonitored: stored?.isMonitored || false,
          isPaused: stored?.isPaused || false,
          participantCount: bg.size || stored?.participantCount || 0,
          lastMessageAt: stored?.lastMessageAt || null,
          isOnlineInBaileys: true
        });
      }

      // Also include any previously monitored groups that Baileys might not have returned
      for (const stored of monitoredDocs) {
        if (!mergedMap.has(stored.groupJid)) {
          mergedMap.set(stored.groupJid, {
            groupJid: stored.groupJid,
            groupName: stored.groupName || 'Monitored Group',
            isMonitored: stored.isMonitored,
            isPaused: stored.isPaused || false,
            participantCount: stored.participantCount || 0,
            lastMessageAt: stored.lastMessageAt || null,
            isOnlineInBaileys: false
          });
        }
      }

      const groups = Array.from(mergedMap.values()).sort((a, b) => {
        if (a.isMonitored && !b.isMonitored) return -1;
        if (!a.isMonitored && b.isMonitored) return 1;
        return a.groupName.localeCompare(b.groupName);
      });

      res.set('Cache-Control', 'no-store, private');
      res.status(200).json({
        status: 'success',
        data: {
          groups,
          diagnostics: getWhatsAppDiagnostics()
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/whatsapp/monitored-groups
   * Enables or disables monitoring or pauses/resumes for a specific WhatsApp group
   */
  toggleMonitoredGroup: async (req, res, next) => {
    try {
      const { groupJid, groupName, isMonitored, isPaused, participantCount } = req.body || {};

      if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
        return next(new AppError('A valid WhatsApp group JID (ending with @g.us) is required.', 400));
      }

      const updateFields = {};
      if (groupName !== undefined) updateFields.groupName = String(groupName).trim();
      if (isMonitored !== undefined) updateFields.isMonitored = Boolean(isMonitored);
      if (isPaused !== undefined) updateFields.isPaused = Boolean(isPaused);
      if (typeof participantCount === 'number') updateFields.participantCount = participantCount;

      const doc = await MonitoredGroup.findOneAndUpdate(
        { groupJid: groupJid.trim() },
        { $set: updateFields },
        { upsert: true, new: true }
      );

      res.status(200).json({
        status: 'success',
        message: doc.isMonitored
          ? (doc.isPaused ? `Group "${doc.groupName || doc.groupJid}" is paused.` : `Group "${doc.groupName || doc.groupJid}" is actively monitored.`)
          : `Monitoring disabled for group "${doc.groupName || doc.groupJid}".`,
        data: { monitoredGroup: doc.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/whatsapp/test-gemini
   * Tests Google Gemini API connection with configured credentials
   */
  testGemini: async (req, res, next) => {
    try {
      const { testGeminiConnectivity } = await import('../services/aiTaskExtraction.service.js');
      const result = await testGeminiConnectivity();
      if (!result.success) {
        return res.status(400).json({
          status: 'fail',
          message: result.error || 'Failed to connect to Google Gemini API.',
          data: result
        });
      }
      res.status(200).json({
        status: 'success',
        message: result.message || 'Gemini API is connected and responding.',
        data: result
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/whatsapp/test-sample-message
   * Tests task analysis on a sample WhatsApp message without saving a draft or creating a task
   */
  testSampleMessage: async (req, res, next) => {
    try {
      const { sampleMessage, senderName } = req.body || {};
      if (!sampleMessage || typeof sampleMessage !== 'string' || !sampleMessage.trim()) {
        return next(new AppError('A non-empty sample message string is required.', 400));
      }

      const { extractTaskFromWhatsAppMessage } = await import('../services/aiTaskExtraction.service.js');
      const result = await extractTaskFromWhatsAppMessage(sampleMessage.trim(), {
        senderName: (senderName || 'Sample Sender').trim(),
        messageTimestamp: new Date()
      });

      const extraction = result?.extraction || result || {};
      const provider = result?.provider || extraction.modelUsed || 'heuristic';

      res.status(200).json({
        status: 'success',
        data: {
          ...extraction,
          provider,
          extraction,
          modelUsed: extraction.modelUsed || provider
        }
      });
    } catch (error) {
      next(error);
    }
  },


  /**
   * GET /api/whatsapp/drafts
   * Lists task drafts with pagination, filtering, and tab counts
   */
  getDrafts: async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const skip = (page - 1) * limit;

      const query = {};

      // Status filter
      if (req.query.status && req.query.status !== 'all') {
        if (Object.values(TASK_DRAFT_STATUSES).includes(req.query.status)) {
          query.status = req.query.status;
        }
      } else if (!req.query.status) {
        // Default: hide ignored unless explicitly requested
        query.status = { $ne: TASK_DRAFT_STATUSES.IGNORED };
      }

      // Group filter
      if (req.query.groupJid) {
        query.groupJid = req.query.groupJid;
      }

      // Search filter
      if (req.query.search) {
        const regex = new RegExp(req.query.search.trim(), 'i');
        query.$or = [
          { 'aiExtraction.title': regex },
          { 'editableFields.title': regex },
          { rawMessageText: regex },
          { senderName: regex },
          { groupName: regex }
        ];
      }

      const [drafts, total, statusCounts] = await Promise.all([
        TaskDraft.find(query)
          .populate('aiExtraction.projectId', 'title projectKey')
          .populate('editableFields.projectId', 'title projectKey')
          .populate('createdTask', 'title taskKey status priority')
          .sort({ messageTimestamp: -1 })
          .skip(skip)
          .limit(limit),
        TaskDraft.countDocuments(query),
        TaskDraft.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ])
      ]);

      const counts = {
        all: 0,
        awaiting_review: 0,
        needs_clarification: 0,
        approved: 0,
        rejected: 0,
        failed: 0,
        ignored: 0
      };

      for (const sc of statusCounts) {
        if (counts[sc._id] !== undefined) {
          counts[sc._id] = sc.count;
          if (sc._id !== TASK_DRAFT_STATUSES.IGNORED) {
            counts.all += sc.count;
          }
        }
      }

      res.status(200).json({
        status: 'success',
        data: {
          drafts: drafts.map((d) => d.toJSON()),
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
          },
          counts
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/whatsapp/drafts/:id
   * Get single draft details
   */
  getDraftById: async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id)
        .populate('aiExtraction.projectId', 'title projectKey')
        .populate('editableFields.projectId', 'title projectKey')
        .populate('createdTask', 'title taskKey status priority project');

      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      res.status(200).json({
        status: 'success',
        data: { draft: draft.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/whatsapp/drafts/:id
   * Updates draft editable fields before approval
   */
  updateDraft: async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id);
      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      if (draft.status === TASK_DRAFT_STATUSES.APPROVED) {
        return next(new AppError('Cannot modify an already approved draft.', 400));
      }

      const { title, description, projectId, priority, startDate, dueDate, assigneeName, assigneePhone, projectName } = req.body || {};

      draft.editableFields = draft.editableFields || {};

      if (title !== undefined) draft.editableFields.title = String(title).trim().slice(0, 200);
      if (description !== undefined) draft.editableFields.description = String(description).trim().slice(0, 5000);
      if (assigneeName !== undefined) draft.editableFields.assigneeName = String(assigneeName).trim().slice(0, 100);
      if (assigneePhone !== undefined) draft.editableFields.assigneePhone = String(assigneePhone).trim().slice(0, 30);
      if (projectName !== undefined) draft.editableFields.projectName = String(projectName).trim().slice(0, 150);
      if (projectId !== undefined) {
        if (projectId && !mongoose.isValidObjectId(projectId)) {
          return next(new AppError('Invalid project selection.', 400));
        }
        draft.editableFields.projectId = projectId || null;
      }
      if (priority !== undefined) {
        if (Object.values(TASK_PRIORITIES).includes(priority)) {
          draft.editableFields.priority = priority;
        }
      }
      if (startDate !== undefined) {
        draft.editableFields.startDate = startDate ? new Date(startDate) : null;
      }
      if (dueDate !== undefined) {
        draft.editableFields.dueDate = dueDate ? new Date(dueDate) : null;
      }

      await draft.save();

      const populated = await TaskDraft.findById(draft._id)
        .populate('aiExtraction.projectId', 'title projectKey')
        .populate('editableFields.projectId', 'title projectKey');

      res.status(200).json({
        status: 'success',
        message: 'Draft fields updated successfully.',
        data: { draft: populated.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/whatsapp/drafts/:id/approve
   * Explicit owner approval: atomically creates Task and marks draft approved
   */
  approveDraft: async (req, res, next) => runWhatsAppInboundMaintenance(async () => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id);
      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      // IDEMPOTENCY: If draft was already approved, return the existing task immediately!
      if (draft.status === TASK_DRAFT_STATUSES.APPROVED && draft.createdTask) {
        const existingTask = await Task.findById(draft.createdTask)
          .populate('project', 'name projectKey')
          .populate('creator', 'name email');
        return res.status(200).json({
          status: 'success',
          message: 'Draft was already approved.',
          data: {
            task: existingTask?.toJSON() || null,
            draft: draft.toJSON()
          }
        });
      }

      // Resolve effective fields between body overrides, editable fields, and AI extraction
      const effectiveTitle = (
        req.body?.title ||
        draft.editableFields?.title ||
        draft.aiExtraction?.title ||
        draft.rawMessageText.slice(0, 100)
      ).trim();

      if (!effectiveTitle) {
        return next(new AppError('A valid task title is required to approve this draft.', 400));
      }

      const effectiveDescription = (
        req.body?.description !== undefined
          ? req.body.description
          : (draft.editableFields?.description !== undefined
              ? draft.editableFields.description
              : (draft.aiExtraction?.description || draft.rawMessageText))
      ).trim();

      let targetProjectId =
        req.body?.projectId ||
        draft.editableFields?.projectId ||
        draft.aiExtraction?.projectId;

      // If no project specified, find first available active project or prompt
      if (!targetProjectId) {
        const defaultProject = await Project.findOne({ isArchived: { $ne: true } }).sort({ createdAt: 1 });
        if (defaultProject) {
          targetProjectId = defaultProject._id;
        } else {
          return next(new AppError('No workspace project found. Please create a project first.', 400));
        }
      }

      const project = await Project.findById(targetProjectId);
      if (!project || project.isArchived) {
        return next(new AppError('Target project does not exist or has been archived.', 400));
      }

      const effectivePriority =
        req.body?.priority ||
        draft.editableFields?.priority ||
        draft.aiExtraction?.priority ||
        TASK_PRIORITIES.MEDIUM;

      const effectiveStartDate =
        req.body?.startDate !== undefined
          ? (req.body.startDate ? new Date(req.body.startDate) : null)
          : (draft.editableFields?.startDate || draft.aiExtraction?.startDate || null);

      const effectiveDueDate =
        req.body?.dueDate !== undefined
          ? (req.body.dueDate ? new Date(req.body.dueDate) : null)
          : (draft.editableFields?.dueDate || draft.aiExtraction?.dueDate || null);

      if (effectiveStartDate && effectiveDueDate && effectiveStartDate > effectiveDueDate) {
        return next(new AppError('Start date cannot be after due date.', 400));
      }

      // Generate incremental taskKey based on existing tasks in project
      let taskKey;
      let count = await Task.countDocuments({ project: project._id });
      let keyCandidate = `${project.projectKey}-${count + 1}`;
      let collision = await Task.exists({ taskKey: keyCandidate });
      while (collision) {
        count += 1;
        keyCandidate = `${project.projectKey}-${count + 1}`;
        collision = await Task.exists({ taskKey: keyCandidate });
      }
      taskKey = keyCandidate;

      let assignedUserIds = [req.user._id];
      let assignedContactId = null;

      if (req.body?.assigneeId && mongoose.isValidObjectId(req.body.assigneeId)) {
        const userExists = await User.findById(req.body.assigneeId);
        if (userExists) {
          assignedUserIds = [userExists._id];
        }
      } else if (req.body?.contactId && mongoose.isValidObjectId(req.body.contactId)) {
        const contactExists = await Contact.findById(req.body.contactId);
        if (contactExists) {
          assignedContactId = contactExists._id;
        }
      } else {
        const candidateName = (
          draft.editableFields?.assigneeName ||
          draft.aiExtraction?.assigneeName ||
          ''
        ).trim();
        if (candidateName) {
          const matchedUser = await User.findOne({ name: new RegExp(`^${candidateName}$`, 'i'), isActive: true });
          if (matchedUser) {
            assignedUserIds = [matchedUser._id];
          } else {
            const matchedContact = await Contact.findOne({ fullName: new RegExp(`^${candidateName}$`, 'i'), isActive: true });
            if (matchedContact) {
              assignedContactId = matchedContact._id;
            }
          }
        }
      }

      // Create Task document
      const newTask = await Task.create({
        title: effectiveTitle,
        description: effectiveDescription,
        project: project._id,
        taskKey,
        creator: req.user._id,
        assignees: assignedUserIds,
        assignedContact: assignedContactId,
        status: TASK_STATUSES.TO_DO,
        priority: effectivePriority,
        startDate: effectiveStartDate,
        dueDate: effectiveDueDate,
        source: TASK_SOURCES.WHATSAPP,
        whatsappMessageId: draft.messageId,
        whatsappDraftId: draft._id,
        groupName: draft.groupName || '',
        whatsappSender: {
          phone: draft.senderJid,
          name: draft.senderName,
          sentAt: draft.messageTimestamp
        },
        sourceMetadata: {
          groupJid: draft.groupJid,
          groupName: draft.groupName,
          messageId: draft.messageId,
          senderJid: draft.senderJid,
          senderName: draft.senderName,
          messageTimestamp: draft.messageTimestamp,
          rawMessageText: draft.rawMessageText,
          draftId: draft._id,
          aiModelUsed: draft.aiExtraction?.modelUsed || draft.extractorProvider || 'gemini',
          reason: draft.aiExtraction?.reason || '',
          approvedBy: req.user.name || req.user.email,
          approvedAt: new Date()
        }
      });

      // Atomic transition on draft to prevent double approval
      const updatedDraft = await TaskDraft.findOneAndUpdate(
        { _id: draft._id, status: { $ne: TASK_DRAFT_STATUSES.APPROVED } },
        {
          $set: {
            status: TASK_DRAFT_STATUSES.APPROVED,
            createdTask: newTask._id,
            approvedAt: new Date()
          }
        },
        { new: true }
      );

      // If updatedDraft is null, someone concurrently approved it
      if (!updatedDraft) {
        // Rollback created task
        await Task.findByIdAndDelete(newTask._id);
        const freshDraft = await TaskDraft.findById(draft._id).populate('createdTask');
        return res.status(200).json({
          status: 'success',
          message: 'Draft was already approved concurrently.',
          data: {
            task: freshDraft.createdTask,
            draft: freshDraft.toJSON()
          }
        });
      }

      // Log task event
      await TaskEvent.logEvent({
        task: newTask._id,
        project: project._id,
        user: req.user._id,
        action: TASK_EVENT_ACTIONS.TASK_CREATED,
        details: {
          title: newTask.title,
          taskKey: newTask.taskKey,
          status: newTask.status,
          priority: newTask.priority,
          source: 'WhatsApp Draft Approval',
          groupName: draft.groupName,
          senderName: draft.senderName
        }
      });

      const populatedTask = await Task.findById(newTask._id)
        .populate('project', 'name projectKey')
        .populate('creator', 'name email')
        .populate('assignees', 'name email role');

      // Real-time notification
      socketService.broadcast('task:created', populatedTask.toJSON());
      socketService.broadcast('whatsapp:draft_approved', updatedDraft.toJSON());

      res.status(201).json({
        status: 'success',
        message: 'Draft approved and task created successfully.',
        data: {
          task: populatedTask.toJSON(),
          draft: updatedDraft.toJSON()
        }
      });
    } catch (error) {
      next(error);
    }
  }),

  /**
   * POST /api/whatsapp/drafts/:id/reject
   * Rejects a task draft (does not create a task)
   */
  rejectDraft: async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id);
      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      if (draft.status === TASK_DRAFT_STATUSES.APPROVED) {
        return next(new AppError('Cannot reject an already approved draft.', 400));
      }

      draft.status = TASK_DRAFT_STATUSES.REJECTED;
      draft.rejectedAt = new Date();
      await draft.save();

      socketService.broadcast('whatsapp:draft_rejected', draft.toJSON());

      res.status(200).json({
        status: 'success',
        message: 'Draft rejected successfully.',
        data: { draft: draft.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/whatsapp/drafts/:id/retry
   * Retries AI extraction on a failed or draft message
   */
  retryDraft: async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id);
      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      if (draft.status === TASK_DRAFT_STATUSES.APPROVED) {
        return next(new AppError('Cannot retry an already approved draft.', 400));
      }

      draft.attempts = (draft.attempts || 0) + 1;

      try {
        const { extraction, provider } = await extractTaskFromWhatsAppMessage(draft.rawMessageText, {
          senderName: draft.senderName,
          messageTimestamp: draft.messageTimestamp
        });

        let newStatus = TASK_DRAFT_STATUSES.AWAITING_REVIEW;
        if (!extraction.isTask) {
          newStatus = TASK_DRAFT_STATUSES.IGNORED;
        } else if (extraction.missingInformation?.length > 0 || extraction.confidence < 0.6) {
          newStatus = TASK_DRAFT_STATUSES.NEEDS_CLARIFICATION;
        }

        draft.aiExtraction = extraction;
        draft.status = newStatus;
        draft.extractorProvider = provider;
        draft.processingError = null;
        await draft.save();

        res.status(200).json({
          status: 'success',
          message: `Draft reprocessed successfully using ${provider}.`,
          data: { draft: draft.toJSON() }
        });
      } catch (err) {
        draft.status = TASK_DRAFT_STATUSES.FAILED;
        draft.processingError = err.message || 'AI extraction retry failed';
        await draft.save();

        res.status(400).json({
          status: 'fail',
          message: `Retry failed: ${draft.processingError}`,
          data: { draft: draft.toJSON() }
        });
      }
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/whatsapp/drafts/:id/raw-message
   * Privacy / retention compliance: removes stored raw WhatsApp message text
   */
  deleteRawMessage: async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return next(new AppError('Invalid draft ID.', 400));
      }

      const draft = await TaskDraft.findById(req.params.id);
      if (!draft) {
        return next(new AppError('Draft not found.', 404));
      }

      draft.rawMessageText = '[REDACTED_BY_OWNER]';
      draft.isRawMessageRedacted = true;
      await draft.save();

      res.status(200).json({
        status: 'success',
        message: 'Raw message content redacted for privacy compliance.',
        data: { draft: draft.toJSON() }
      });
    } catch (error) {
      next(error);
    }
  }
};

export default whatsappDraftController;

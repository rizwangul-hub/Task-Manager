import mongoose from 'mongoose';
import { Task, TASK_STATUSES } from '../models/task.model.js';
import { Project } from '../models/project.model.js';
import { User, USER_ROLES } from '../models/user.model.js';
import { TimeEntry } from '../models/timeEntry.model.js';
import { buildCsvString } from '../utils/csv.js';
import { AppError } from '../middleware/errorHandler.js';

export const reportController = {
  /**
   * Get management report metrics & aggregations
   * GET /api/reports/summary
   */
  getReportSummary: async (req, res, next) => {
    try {
      const { from, to, project: projectId } = req.query;

      // 1. Determine Date Range
      const now = new Date();
      let startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // default 30 days
      let endDate = to ? new Date(to) : new Date(now.getTime());
      endDate.setHours(23, 59, 59, 999);

      // 2. Role-based Project Scoping
      let authorizedProjectIds = null;

      if (req.user.role === USER_ROLES.EMPLOYEE) {
        // Employee: only projects they are member of or manage
        const userProjects = await Project.find({
          $or: [{ members: req.user._id }, { manager: req.user._id }]
        }).select('_id');
        authorizedProjectIds = userProjects.map((p) => p._id);
      } else if (req.user.role === USER_ROLES.MANAGER) {
        // Manager: only projects they manage or are member of
        const userProjects = await Project.find({
          $or: [{ manager: req.user._id }, { members: req.user._id }]
        }).select('_id');
        authorizedProjectIds = userProjects.map((p) => p._id);
      }
      // ADMIN has access to all projects (authorizedProjectIds remains null)

      // Base task query
      const taskQuery = { isArchived: false };

      if (projectId) {
        if (authorizedProjectIds && !authorizedProjectIds.some((id) => id.toString() === projectId)) {
          return next(new AppError('You do not have permission to view reports for this project.', 403));
        }
        taskQuery.project = new mongoose.Types.ObjectId(projectId);
      } else if (authorizedProjectIds) {
        taskQuery.project = { $in: authorizedProjectIds };
      }

      // If employee, additionally scope to tasks they are assigned to or created
      if (req.user.role === USER_ROLES.EMPLOYEE) {
        taskQuery.$or = [{ assignees: req.user._id }, { creator: req.user._id }];
      }

      // 3. Compute High-Level Metrics
      const totalTasks = await Task.countDocuments(taskQuery);
      const completedTasks = await Task.countDocuments({ ...taskQuery, status: TASK_STATUSES.DONE });
      const blockedTasks = await Task.countDocuments({
        ...taskQuery,
        status: { $in: [TASK_STATUSES.BLOCKED, TASK_STATUSES.STUCK] }
      });
      const inProgressTasks = await Task.countDocuments({
        ...taskQuery,
        status: { $in: [TASK_STATUSES.WORKING_ON_IT, TASK_STATUSES.IN_PROGRESS, TASK_STATUSES.APPLIED] }
      });
      const openTasks = await Task.countDocuments({
        ...taskQuery,
        status: {
          $in: [
            TASK_STATUSES.BACKLOG,
            TASK_STATUSES.TO_DO,
            TASK_STATUSES.WORKING_ON_IT,
            TASK_STATUSES.IN_PROGRESS,
            TASK_STATUSES.IN_REVIEW,
            TASK_STATUSES.APPLIED,
            TASK_STATUSES.STUCK
          ]
        }
      });

      const overdueTasks = await Task.countDocuments({
        ...taskQuery,
        status: { $ne: TASK_STATUSES.DONE },
        dueDate: { $lt: now }
      });

      // Completion Rate: (completed / total) * 100
      const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      // 4. Tasks Created and Completed in Selected Period
      const periodCreatedCount = await Task.countDocuments({
        ...taskQuery,
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const periodCompletedCount = await Task.countDocuments({
        ...taskQuery,
        status: TASK_STATUSES.DONE,
        completedAt: { $gte: startDate, $lte: endDate }
      });

      // 5. Project Progress Aggregation
      const projectFilter = { isArchived: false };
      if (projectId) {
        projectFilter._id = new mongoose.Types.ObjectId(projectId);
      } else if (authorizedProjectIds) {
        projectFilter._id = { $in: authorizedProjectIds };
      }

      const projects = await Project.find(projectFilter).select('name projectKey status');
      const projectProgress = await Promise.all(
        projects.map(async (proj) => {
          const pTaskQuery = { project: proj._id, isArchived: false };
          if (req.user.role === USER_ROLES.EMPLOYEE) {
            pTaskQuery.$or = [{ assignees: req.user._id }, { creator: req.user._id }];
          }
          const pTotal = await Task.countDocuments(pTaskQuery);
          const pDone = await Task.countDocuments({ ...pTaskQuery, status: TASK_STATUSES.DONE });
          const pOverdue = await Task.countDocuments({
            ...pTaskQuery,
            status: { $ne: TASK_STATUSES.DONE },
            dueDate: { $lt: now }
          });
          const pRate = pTotal > 0 ? Math.round((pDone / pTotal) * 100) : 0;

          return {
            projectId: proj._id,
            name: proj.name,
            key: proj.projectKey,
            status: proj.status,
            totalTasks: pTotal,
            completedTasks: pDone,
            overdueTasks: pOverdue,
            completionRate: pRate
          };
        })
      );

      // 6. Working Time Aggregation from TimeEntry
      const timeQuery = {
        date: { $gte: startDate, $lte: endDate }
      };

      if (projectId) {
        timeQuery.project = new mongoose.Types.ObjectId(projectId);
      } else if (authorizedProjectIds) {
        timeQuery.project = { $in: authorizedProjectIds };
      }

      if (req.user.role === USER_ROLES.EMPLOYEE) {
        timeQuery.user = req.user._id;
      }

      const timeAggregation = await TimeEntry.aggregate([
        { $match: timeQuery },
        {
          $group: {
            _id: '$user',
            totalMinutes: { $sum: '$durationMinutes' },
            entryCount: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        { $unwind: '$userInfo' },
        {
          $project: {
            userId: '$_id',
            name: '$userInfo.name',
            email: '$userInfo.email',
            role: '$userInfo.role',
            totalMinutes: 1,
            totalHours: { $round: [{ $divide: ['$totalMinutes', 60] }, 1] },
            entryCount: 1
          }
        },
        { $sort: { totalMinutes: -1 } }
      ]);

      const totalLoggedMinutes = timeAggregation.reduce((acc, curr) => acc + curr.totalMinutes, 0);

      // 7. Overdue Tasks Breakdown
      const overdueTasksList = await Task.find({
        ...taskQuery,
        status: { $ne: TASK_STATUSES.DONE },
        dueDate: { $lt: now }
      })
        .populate('project', 'name projectKey')
        .populate('assignees', 'name email')
        .sort({ dueDate: 1 })
        .limit(10);

      const overdueTasksData = overdueTasksList.map((t) => t.toJSON());

      res.status(200).json({
        status: 'success',
        data: {
          period: {
            from: startDate.toISOString(),
            to: endDate.toISOString()
          },
          metrics: {
            totalTasks,
            openTasks,
            completedTasks,
            blockedTasks,
            inProgressTasks,
            overdueTasks,
            completionRate,
            periodCreatedCount,
            periodCompletedCount,
            totalLoggedMinutes,
            totalLoggedHours: Math.round((totalLoggedMinutes / 60) * 10) / 10
          },
          projectProgress,
          employeeWorkload: [],
          loggedTimeSummary: timeAggregation,
          overdueTasks: overdueTasksData,
          overdueTasksAttentionList: overdueTasksData
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Export authorized management report data as CSV
   * GET /api/reports/export/csv
   */
  exportReportCsv: async (req, res, next) => {
    try {
      const { from, to, project: projectId, type = 'workload' } = req.query;

      const now = new Date();
      let startDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      let endDate = to ? new Date(to) : new Date(now.getTime());
      endDate.setHours(23, 59, 59, 999);

      let authorizedProjectIds = null;
      if (req.user.role === USER_ROLES.EMPLOYEE || req.user.role === USER_ROLES.MANAGER) {
        const userProjects = await Project.find({
          $or: [{ members: req.user._id }, { manager: req.user._id }]
        }).select('_id');
        authorizedProjectIds = userProjects.map((p) => p._id);
      }

      if (type === 'time') {
        // Export Time Tracking summary
        const timeQuery = {
          date: { $gte: startDate, $lte: endDate }
        };
        if (projectId) {
          if (authorizedProjectIds && !authorizedProjectIds.some((id) => id.toString() === projectId)) {
            return next(new AppError('Permission denied for this project.', 403));
          }
          timeQuery.project = new mongoose.Types.ObjectId(projectId);
        } else if (authorizedProjectIds) {
          timeQuery.project = { $in: authorizedProjectIds };
        }

        if (req.user.role === USER_ROLES.EMPLOYEE) {
          timeQuery.user = req.user._id;
        }

        const entries = await TimeEntry.find(timeQuery)
          .populate('task', 'taskKey title')
          .populate('project', 'name projectKey')
          .populate('user', 'name email role')
          .sort({ date: -1 })
          .limit(2000);

        const headers = ['Date', 'User Name', 'User Email', 'Role', 'Project', 'Task Key', 'Task Title', 'Duration (Minutes)', 'Duration (Hours)', 'Description'];
        const rows = entries.map((e) => [
          e.date ? new Date(e.date).toISOString().split('T')[0] : '',
          e.user?.name || '',
          e.user?.email || '',
          e.user?.role || '',
          e.project?.name || '',
          e.task?.taskKey || '',
          e.task?.title || '',
          e.durationMinutes,
          (e.durationMinutes / 60).toFixed(2),
          e.description || ''
        ]);

        const csv = buildCsvString(headers, rows);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="time-report-${Date.now()}.csv"`);
        return res.status(200).send(csv);
      }

      // Default: Workload and Task Summary CSV
      const taskQuery = { isArchived: false };
      if (projectId) {
        if (authorizedProjectIds && !authorizedProjectIds.some((id) => id.toString() === projectId)) {
          return next(new AppError('Permission denied for this project.', 403));
        }
        taskQuery.project = new mongoose.Types.ObjectId(projectId);
      } else if (authorizedProjectIds) {
        taskQuery.project = { $in: authorizedProjectIds };
      }

      if (req.user.role === USER_ROLES.EMPLOYEE) {
        taskQuery.$or = [{ assignees: req.user._id }, { creator: req.user._id }];
      }

      const tasks = await Task.find(taskQuery)
        .populate('project', 'name projectKey')
        .populate('assignees', 'name email')
        .sort({ createdAt: -1 })
        .limit(2000);

      const headers = ['Task Key', 'Title', 'Project', 'Status', 'Priority', 'Start Date', 'Due Date', 'Assignees', 'Logged Minutes', 'Created At'];
      const rows = tasks.map((t) => [
        t.taskKey,
        t.title,
        t.project?.name || '',
        t.status,
        t.priority,
        t.startDate ? new Date(t.startDate).toISOString().split('T')[0] : '',
        t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
        (t.assignees || []).map((a) => a.name).join('; '),
        t.totalTimeSpentMinutes || 0,
        t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : ''
      ]);

      const csv = buildCsvString(headers, rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="task-report-${Date.now()}.csv"`);
      return res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  }
};

export default reportController;

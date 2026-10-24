import apiClient from './api';

let statsCache = null;
let statsCacheTime = 0;
let statsInFlight = null;
const STATS_TTL = 15000;

export const taskService = {
  getTasks: async (params = {}) => {
    return apiClient.get('/tasks', { params });
  },

  getTaskById: async (id) => {
    return apiClient.get(`/tasks/${id}`);
  },

  getWhatsAppNotifications: async (taskId) => {
    return apiClient.get(`/tasks/${taskId}/whatsapp-notifications`);
  },

  retryWhatsAppNotification: async (taskId, notificationId) => {
    return apiClient.post(`/tasks/${taskId}/whatsapp-notifications/${notificationId}/retry`);
  },

  createTask: async (taskData) => {
    taskService.invalidateStatsCache();
    return apiClient.post('/tasks', taskData);
  },

  updateTask: async (id, taskData) => {
    taskService.invalidateStatsCache();
    return apiClient.put(`/tasks/${id}`, taskData);
  },

  changeStatus: async (id, status) => {
    taskService.invalidateStatsCache();
    return apiClient.patch(`/tasks/${id}/status`, { status });
  },

  archiveTask: async (id, isArchived) => {
    taskService.invalidateStatsCache();
    return apiClient.patch(`/tasks/${id}/archive`, { isArchived });
  },

  deleteTask: async (id) => {
    taskService.invalidateStatsCache();
    return apiClient.delete(`/tasks/${id}`);
  },

  exportCsv: async (params = {}) => {
    const url = apiClient.buildUrl('/tasks/export/csv', params);
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });
    if (!res.ok) {
      throw new Error('Failed to export tasks CSV');
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `tasks-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  },

  invalidateStatsCache: () => {
    statsCache = null;
    statsCacheTime = 0;
  },

  getDashboardStats: async () => {
    const now = Date.now();
    if (statsCache && (now - statsCacheTime < STATS_TTL)) {
      return statsCache;
    }
    if (statsInFlight) {
      return statsInFlight;
    }
    const promise = apiClient.get('/dashboard/stats')
      .then((res) => {
        statsCache = res;
        statsCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        statsInFlight = null;
      });
    statsInFlight = promise;
    return promise;
  },

  // --- Phase 3: Activity Timeline ---
  getActivity: async (taskId) => {
    return apiClient.get(`/tasks/${taskId}/activity`);
  },

  // --- Phase 3: Comments ---
  getComments: async (taskId) => {
    return apiClient.get(`/tasks/${taskId}/comments`);
  },

  createComment: async (taskId, content) => {
    return apiClient.post(`/tasks/${taskId}/comments`, { content });
  },

  deleteComment: async (taskId, commentId) => {
    return apiClient.delete(`/tasks/${taskId}/comments/${commentId}`);
  },

  // --- Phase 3: Attachments ---
  uploadAttachment: async (taskId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.request(`/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData
    });
  },

  deleteAttachment: async (taskId, attachmentId) => {
    return apiClient.delete(`/tasks/${taskId}/attachments/${attachmentId}`);
  },

  // --- Phase 3: Time Tracking ---
  getTimeEntries: async (taskId) => {
    return apiClient.get(`/tasks/${taskId}/time-entries`);
  },

  createTimeEntry: async (taskId, data) => {
    return apiClient.post(`/tasks/${taskId}/time-entries`, data);
  },

  deleteTimeEntry: async (taskId, entryId) => {
    return apiClient.delete(`/tasks/${taskId}/time-entries/${entryId}`);
  }
};

export default taskService;

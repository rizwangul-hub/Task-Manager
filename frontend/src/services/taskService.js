import apiClient from './api';

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
    return apiClient.post('/tasks', taskData);
  },

  updateTask: async (id, taskData) => {
    return apiClient.put(`/tasks/${id}`, taskData);
  },

  changeStatus: async (id, status) => {
    return apiClient.patch(`/tasks/${id}/status`, { status });
  },

  archiveTask: async (id, isArchived) => {
    return apiClient.patch(`/tasks/${id}/archive`, { isArchived });
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

  getDashboardStats: async () => {
    return apiClient.get('/dashboard/stats');
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

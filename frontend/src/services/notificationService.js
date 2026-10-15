import apiClient from './api';

export const notificationService = {
  /**
   * Get user's notifications with pagination and unread filter
   */
  getNotifications: async (params = {}) => {
    return apiClient.get('/notifications', { params });
  },

  /**
   * Get current user's unread notification count
   */
  getUnreadCount: async () => {
    return apiClient.get('/notifications/unread-count');
  },

  /**
   * Mark single notification as read
   */
  markAsRead: async (id) => {
    return apiClient.patch(`/notifications/${id}/read`);
  },

  /**
   * Mark all notifications as read for current user
   */
  markAllAsRead: async () => {
    return apiClient.patch('/notifications/mark-all-read');
  },

  /**
   * Delete a notification
   */
  deleteNotification: async (id) => {
    return apiClient.delete(`/notifications/${id}`);
  },

  /**
   * Get user's notification preferences and email status
   */
  getPreferences: async () => {
    return apiClient.get('/notifications/preferences');
  },

  /**
   * Update notification preferences
   */
  updatePreferences: async (preferences) => {
    return apiClient.patch('/notifications/preferences', preferences);
  }
};

export default notificationService;

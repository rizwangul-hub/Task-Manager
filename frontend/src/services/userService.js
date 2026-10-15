import apiClient from './api';

export const userService = {
  getUsers: async (params = {}) => {
    return apiClient.get('/users', { params });
  },

  getUserById: async (id) => {
    return apiClient.get(`/users/${id}`);
  },

  createUser: async (userData) => {
    return apiClient.post('/users', userData);
  },

  updateUser: async (id, userData) => {
    return apiClient.put(`/users/${id}`, userData);
  },

  setUserStatus: async (id, isActive) => {
    return apiClient.patch(`/users/${id}/status`, { isActive });
  },

  resetPassword: async (id, newPassword) => {
    return apiClient.post(`/users/${id}/reset-password`, { newPassword });
  }
};

export default userService;

import apiClient from './api';

export const authService = {
  login: async (email, password) => {
    return apiClient.post('/auth/login', { email, password });
  },

  logout: async () => {
    return apiClient.post('/auth/logout');
  },

  getMe: async () => {
    return apiClient.get('/auth/me');
  },

  refresh: async () => {
    return apiClient.post('/auth/refresh');
  }
};

export default authService;

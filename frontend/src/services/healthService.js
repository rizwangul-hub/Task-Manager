import apiClient from './api';

export const healthService = {
  /**
   * Fetches health check status from backend
   */
  getHealthStatus: async () => {
    return apiClient.get('/health');
  }
};

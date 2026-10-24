import apiClient from './api';

const usersCache = new Map();
const usersInFlight = new Map();
const TTL = 30000; // 30s

export const userService = {
  getUsers: async (params = {}) => {
    const key = JSON.stringify(params || {});
    const cached = usersCache.get(key);
    const now = Date.now();
    if (cached && (now - cached.time < TTL)) {
      return cached.data;
    }
    if (usersInFlight.has(key)) {
      return usersInFlight.get(key);
    }

    const promise = apiClient.get('/users', { params })
      .then((res) => {
        usersCache.set(key, { data: res, time: Date.now() });
        return res;
      })
      .finally(() => {
        usersInFlight.delete(key);
      });

    usersInFlight.set(key, promise);
    return promise;
  },

  invalidateCache: () => {
    usersCache.clear();
  },

  getUserById: async (id) => {
    return apiClient.get(`/users/${id}`);
  },

  createUser: async (userData) => {
    userService.invalidateCache();
    return apiClient.post('/users', userData);
  },

  updateUser: async (id, userData) => {
    userService.invalidateCache();
    return apiClient.put(`/users/${id}`, userData);
  },

  setUserStatus: async (id, isActive) => {
    userService.invalidateCache();
    return apiClient.patch(`/users/${id}/status`, { isActive });
  },

  resetPassword: async (id, newPassword) => {
    return apiClient.post(`/users/${id}/reset-password`, { newPassword });
  }
};

export default userService;

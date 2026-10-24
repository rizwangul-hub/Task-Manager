import apiClient from './api';

const contactsCache = new Map();
const contactsInFlight = new Map();
const TTL = 30000; // 30s

export const contactService = {
  getContacts: async (params = {}) => {
    const key = JSON.stringify(params || {});
    const cached = contactsCache.get(key);
    const now = Date.now();
    if (cached && (now - cached.time < TTL)) {
      return cached.data;
    }
    if (contactsInFlight.has(key)) {
      return contactsInFlight.get(key);
    }

    const promise = apiClient.get('/contacts', { params })
      .then((res) => {
        contactsCache.set(key, { data: res, time: Date.now() });
        return res;
      })
      .finally(() => {
        contactsInFlight.delete(key);
      });

    contactsInFlight.set(key, promise);
    return promise;
  },

  invalidateCache: () => {
    contactsCache.clear();
  },

  createContact: async (data) => {
    contactService.invalidateCache();
    return apiClient.post('/contacts', data);
  },

  updateContact: async (id, data) => {
    contactService.invalidateCache();
    return apiClient.put(`/contacts/${id}`, data);
  },

  deactivateContact: async (id) => {
    contactService.invalidateCache();
    return apiClient.delete(`/contacts/${id}`);
  }
};

export default contactService;

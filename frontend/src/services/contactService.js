import apiClient from './api';

export const contactService = {
  getContacts: (params = {}) => apiClient.get('/contacts', { params }),
  createContact: (data) => apiClient.post('/contacts', data),
  updateContact: (id, data) => apiClient.put(`/contacts/${id}`, data),
  deactivateContact: (id) => apiClient.delete(`/contacts/${id}`)
};

export default contactService;

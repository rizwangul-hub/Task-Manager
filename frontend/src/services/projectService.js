import apiClient from './api';

export const projectService = {
  getProjects: async (params = {}) => {
    return apiClient.get('/projects', { params });
  },

  getProjectById: async (id) => {
    return apiClient.get(`/projects/${id}`);
  },

  createProject: async (projectData) => {
    return apiClient.post('/projects', projectData);
  },

  updateProject: async (id, projectData) => {
    return apiClient.put(`/projects/${id}`, projectData);
  },

  archiveProject: async (id, isArchived) => {
    return apiClient.patch(`/projects/${id}/archive`, { isArchived });
  }
};

export default projectService;

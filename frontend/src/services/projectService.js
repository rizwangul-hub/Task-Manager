import apiClient from './api';

let projectsCache = null;
let projectsCacheTime = 0;
let projectsInFlight = null;

export const projectService = {
  getProjects: async (params = {}) => {
    const isStandard = !params.search && (!params.page || params.page === 1);
    const now = Date.now();
    if (isStandard && projectsCache && (now - projectsCacheTime < 30000)) {
      return projectsCache;
    }
    if (isStandard && projectsInFlight) {
      return projectsInFlight;
    }

    const promise = apiClient.get('/projects', { params })
      .then((res) => {
        if (isStandard) {
          projectsCache = res;
          projectsCacheTime = Date.now();
        }
        return res;
      })
      .finally(() => {
        if (isStandard) projectsInFlight = null;
      });

    if (isStandard) projectsInFlight = promise;
    return promise;
  },

  invalidateCache: () => {
    projectsCache = null;
    projectsCacheTime = 0;
  },

  getProjectById: async (id) => {
    return apiClient.get(`/projects/${id}`);
  },

  createProject: async (projectData) => {
    projectService.invalidateCache();
    return apiClient.post('/projects', projectData);
  },

  updateProject: async (id, projectData) => {
    projectService.invalidateCache();
    return apiClient.put(`/projects/${id}`, projectData);
  },

  archiveProject: async (id, isArchived) => {
    projectService.invalidateCache();
    return apiClient.patch(`/projects/${id}/archive`, { isArchived });
  }
};

export default projectService;

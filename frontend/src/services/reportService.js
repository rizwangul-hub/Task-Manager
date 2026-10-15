import apiClient from './api';

export const reportService = {
  getSummary: async (params = {}) => {
    return apiClient.get('/reports/summary', { params });
  },

  exportCsv: async (params = {}) => {
    const url = apiClient.buildUrl('/reports/export/csv', params);
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include'
    });
    if (!res.ok) {
      throw new Error('Failed to export reports CSV');
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `report-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }
};

export default reportService;

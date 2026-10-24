import apiClient from './api';

const summaryCache = new Map();
const summaryInFlight = new Map();
const TTL = 20000; // 20s

export const reportService = {
  getSummary: async (params = {}) => {
    // Round 'from' and 'to' to nearest minute if present so minor millisecond differences share cache
    const normalizedParams = { ...params };
    if (normalizedParams.from) {
      const d = new Date(normalizedParams.from);
      d.setSeconds(0, 0);
      normalizedParams.from = d.toISOString();
    }
    if (normalizedParams.to) {
      const d = new Date(normalizedParams.to);
      d.setSeconds(0, 0);
      normalizedParams.to = d.toISOString();
    }

    const key = JSON.stringify(normalizedParams);
    const cached = summaryCache.get(key);
    const now = Date.now();
    if (cached && (now - cached.time < TTL)) {
      return cached.data;
    }
    if (summaryInFlight.has(key)) {
      return summaryInFlight.get(key);
    }

    const promise = apiClient.get('/reports/summary', { params })
      .then((res) => {
        summaryCache.set(key, { data: res, time: Date.now() });
        return res;
      })
      .finally(() => {
        summaryInFlight.delete(key);
      });

    summaryInFlight.set(key, promise);
    return promise;
  },

  invalidateCache: () => {
    summaryCache.clear();
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

import { apiClient } from './api.js';

/**
 * Frontend service for WhatsApp integration, group monitoring, and task drafts.
 * All calls go to the authenticated backend — no tokens or WhatsApp secrets are handled here.
 */
export const whatsappService = {
  /**
   * Fetch current WhatsApp provider diagnostics
   */
  getDiagnostics() {
    return apiClient.get('/whatsapp/diagnostics');
  },

  getHistoryResetPreview() {
    return apiClient.get('/whatsapp/history/reset-preview');
  },

  resetHistory(expectedCounts) {
    return apiClient.post('/whatsapp/history/reset', {
      confirmed: true,
      expectedCounts: {
        tasks: expectedCounts.tasks,
        drafts: expectedCounts.drafts
      }
    });
  },

  /**
   * Send test WhatsApp message
   */
  sendTestMessage(testNumber) {
    return apiClient.post('/whatsapp/test-message', { testNumber });
  },

  reconnect(confirmRePair = false) {
    return apiClient.post('/whatsapp/reconnect', { confirmRePair });
  },

  /**
   * Fetch WhatsApp groups accessible to Baileys with monitoring status
   */
  getGroups() {
    return apiClient.get('/whatsapp/groups');
  },

  /**
   * Toggle monitoring on a specific group
   */
  toggleMonitoredGroup(payload) {
    return apiClient.post('/whatsapp/monitored-groups', payload);
  },

  /**
   * Fetch task drafts with pagination, filters, and status counts
   */
  getDrafts(params = {}) {
    return apiClient.get('/whatsapp/drafts', { params });
  },

  /**
   * Get single draft details
   */
  getDraft(id) {
    return apiClient.get(`/whatsapp/drafts/${id}`);
  },

  /**
   * Update draft editable fields
   */
  updateDraft(id, payload) {
    return apiClient.put(`/whatsapp/drafts/${id}`, payload);
  },

  /**
   * Approve draft & create task (idempotent)
   */
  approveDraft(id, payload = {}) {
    return apiClient.post(`/whatsapp/drafts/${id}/approve`, payload);
  },

  /**
   * Reject draft
   */
  rejectDraft(id) {
    return apiClient.post(`/whatsapp/drafts/${id}/reject`);
  },

  /**
   * Retry AI extraction on draft
   */
  retryDraft(id) {
    return apiClient.post(`/whatsapp/drafts/${id}/retry`);
  },

  /**
   * Redact raw WhatsApp message text for privacy
   */
  deleteRawMessage(id) {
    return apiClient.delete(`/whatsapp/drafts/${id}/raw-message`);
  },

  /**
   * Test Google Gemini API connectivity
   */
  testGemini() {
    return apiClient.post('/whatsapp/test-gemini');
  },

  /**
   * Test task analysis on a sample WhatsApp message
   */
  testSampleMessage(payload) {
    return apiClient.post('/whatsapp/test-sample-message', payload);
  }
};

export default whatsappService;

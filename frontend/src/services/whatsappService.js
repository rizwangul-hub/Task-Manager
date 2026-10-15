import { apiClient } from './api.js';

/**
 * Frontend service for WhatsApp integration diagnostics and test messaging.
 * All calls go to the authenticated backend — no tokens are handled here.
 */
export const whatsappService = {
  /**
   * Fetch the current WhatsApp provider diagnostics.
   * Requires Admin or Manager role on the backend.
   * @returns {Promise<{ provider, connectionStatus, sendingCapabilityStatus, lastSuccessfulSendAt, lastError, authenticatedUser }>}
   */
  getDiagnostics() {
    return apiClient.get('/whatsapp/diagnostics');
  },

  /**
   * Send a test WhatsApp message to the specified number or JID.
   * Requires Admin or Manager role on the backend.
   * @param {string} testNumber - International phone number or WhatsApp JID
   * @returns {Promise<{ status, message, data: { providerMessageId, recipient } }>}
   */
  sendTestMessage(testNumber) {
    return apiClient.post('/whatsapp/test-message', { testNumber });
  }
};

export default whatsappService;

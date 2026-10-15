export const whatsappWebhookController = {
  receive: (_req, res) => res.status(410).json({
    status: 'disabled',
    message: 'WhatsApp inbound intake is disabled. Use the application to create tasks.'
  })
};

export default whatsappWebhookController;

const getMetaMessages = (payload) =>
  (Array.isArray(payload?.entry) ? payload.entry : []).flatMap((entry) =>
    (entry.changes || []).flatMap((change) => {
      const value = change.value || {};
      const contacts = new Map((value.contacts || []).map((contact) => [
        contact.wa_id,
        contact.profile?.name || ''
      ]));
      return (value.messages || []).map((message) => {
        const mediaContent = message.image || message.document;
        return {
          id: message.id,
          groupId: message.group_id || message.groupId || value.group_id ||
            (message.participant ? message.from : ''),
          senderPhone: message.participant || message.from || '',
          senderName: contacts.get(message.participant || message.from) || '',
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : null,
          text: message.text?.body || mediaContent?.caption || '',
          media: mediaContent?.id
            ? [{
              id: mediaContent.id,
              mimeType: mediaContent.mime_type,
              fileName: mediaContent.filename
            }]
            : []
        };
      });
    })
  );

const getTwilioMessages = (payload) => {
  const mediaCount = Math.min(Number(payload.NumMedia) || 0, 10);
  const media = Array.from({ length: mediaCount }, (_, index) => ({
    id: `${payload.MessageSid || payload.SmsMessageSid || 'twilio'}-${index}`,
    url: payload[`MediaUrl${index}`],
    mimeType: payload[`MediaContentType${index}`]
  })).filter((item) => item.url);

  if (!payload.MessageSid && !payload.SmsMessageSid) return [];
  return [{
    id: payload.MessageSid || payload.SmsMessageSid,
    groupId: payload.GroupSid || payload.group_id || payload.GroupId || '',
    senderPhone: String(payload.WaId || payload.From || '').replace(/^whatsapp:/, ''),
    senderName: payload.ProfileName || '',
    timestamp: payload.Timestamp ? new Date(payload.Timestamp) : new Date(),
    text: payload.Body || '',
    media
  }];
};

const getBaileysMessages = (payload) => {
  const messages = Array.isArray(payload.messages) ? payload.messages : [payload];
  return messages.flatMap((item) => {
    const key = item.key || {};
    const content = item.message || item;
    const image = content.imageMessage || item.image || null;
    const document = content.documentMessage || item.document || null;
    const body = content.conversation ||
      content.extendedTextMessage?.text ||
      image?.caption ||
      document?.caption ||
      item.text ||
      '';
    const id = key.id || item.id || item.messageId;
    if (!id) return [];

    const mediaSource = image || document;
    return [{
      id,
      groupId: key.remoteJid || item.groupId || item.group_id || '',
      senderPhone: key.participant || item.sender || item.from || '',
      senderName: item.pushName || item.senderName || '',
      timestamp: item.messageTimestamp
        ? new Date(Number(item.messageTimestamp) * 1000)
        : item.timestamp ? new Date(item.timestamp) : new Date(),
      text: body,
      media: mediaSource
        ? [{
          id,
          url: mediaSource.directUrl || mediaSource.mediaUrl || mediaSource.url,
          base64: mediaSource.base64 || item.mediaBase64,
          mimeType: mediaSource.mimetype || mediaSource.mimeType,
          fileName: document?.fileName
        }].filter((media) => media.url || media.base64)
        : []
    }];
  });
};

export const whatsappPayloadAdapterService = {
  normalize: (payload, configuredProvider = 'auto') => {
    const provider = configuredProvider !== 'auto'
      ? configuredProvider.toLowerCase()
      : payload?.object === 'whatsapp_business_account'
        ? 'meta'
        : payload?.MessageSid || payload?.SmsMessageSid
          ? 'twilio'
          : 'baileys';

    if (provider === 'meta') return { provider, messages: getMetaMessages(payload) };
    if (provider === 'twilio') return { provider, messages: getTwilioMessages(payload) };
    if (provider === 'baileys') return { provider, messages: getBaileysMessages(payload) };
    throw new Error(`Unsupported WhatsApp provider: ${configuredProvider}`);
  }
};

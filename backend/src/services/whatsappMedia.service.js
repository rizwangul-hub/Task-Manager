import { env } from '../config/env.js';
import { uploadBufferToCloudinary } from './cloudinaryUploadService.js';

const SAFE_MEDIA_HOSTS = ['api.twilio.com', 'twiliocdn.com', 'whatsapp.net', 'fbcdn.net', 'fbsbx.com'];
const isSafeMediaUrl = (value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && SAFE_MEDIA_HOSTS.some((host) =>
    url.hostname === host || url.hostname.endsWith(`.${host}`)
  );
};

const readLimitedResponse = async (response) => {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > env.WHATSAPP.maxMediaBytes) {
    throw new Error('WhatsApp media exceeds the configured upload size limit.');
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += chunk.length;
    if (totalBytes > env.WHATSAPP.maxMediaBytes) {
      throw new Error('WhatsApp media exceeds the configured upload size limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const fetchMediaUrl = async (url, headers = {}) => {
  let currentUrl = url;
  let currentHeaders = headers;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isSafeMediaUrl(currentUrl)) throw new Error('WhatsApp media URL host is not allowed.');
    const response = await fetch(currentUrl, {
      headers: currentHeaders,
      signal: AbortSignal.timeout(20000),
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('WhatsApp media returned an invalid redirect.');
      const nextUrl = new URL(location, currentUrl);
      if (new URL(currentUrl).origin !== nextUrl.origin) currentHeaders = {};
      currentUrl = nextUrl.href;
      continue;
    }
    if (!response.ok) throw new Error(`WhatsApp media download failed with HTTP ${response.status}.`);
    return { buffer: await readLimitedResponse(response), contentType: response.headers.get('content-type') };
  }
  throw new Error('WhatsApp media exceeded the redirect limit.');
};

const downloadMedia = async (media, provider) => {
  if (media.base64) {
    const buffer = Buffer.from(media.base64, 'base64');
    if (buffer.length > env.WHATSAPP.maxMediaBytes) throw new Error('WhatsApp media exceeds the configured upload size limit.');
    return { buffer, contentType: media.mimeType };
  }

  if (provider === 'meta') {
    if (!env.WHATSAPP.accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN is required to download Meta media.');
    const mediaResponse = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP.graphApiVersion}/${encodeURIComponent(media.id)}`,
      { headers: { Authorization: `Bearer ${env.WHATSAPP.accessToken}` }, signal: AbortSignal.timeout(20000) }
    );
    if (!mediaResponse.ok) throw new Error(`Meta media lookup failed with HTTP ${mediaResponse.status}.`);
    const mediaInfo = await mediaResponse.json();
    return fetchMediaUrl(mediaInfo.url, { Authorization: `Bearer ${env.WHATSAPP.accessToken}` });
  }

  if (provider === 'twilio') {
    if (!env.WHATSAPP.twilioAccountSid || !env.WHATSAPP.twilioAuthToken) {
      throw new Error('Twilio credentials are required to download WhatsApp media.');
    }
    const basicToken = Buffer.from(`${env.WHATSAPP.twilioAccountSid}:${env.WHATSAPP.twilioAuthToken}`).toString('base64');
    return fetchMediaUrl(media.url, { Authorization: `Basic ${basicToken}` });
  }

  return fetchMediaUrl(media.url);
};

export const whatsappMediaService = {
  uploadMessageMedia: async (mediaItems, provider, uploaderId) => {
    const attachments = [];
    for (const [index, media] of mediaItems.entries()) {
      try {
        const { buffer, contentType } = await downloadMedia(media, provider);
        const mimeType = contentType || media.mimeType || 'application/octet-stream';
        const fileName = media.fileName || `whatsapp-${media.id || index + 1}`;
        const upload = await uploadBufferToCloudinary(
          buffer,
          'pixx_tasks/whatsapp',
          fileName
        );
        attachments.push({
          publicId: upload.public_id,
          public_id: upload.public_id,
          url: upload.url,
          fileName: upload.fileName,
          fileType: mimeType,
          bytes: upload.bytes || buffer.length,
          uploadedBy: uploaderId
        });
      } catch (error) {
        error.message = `WhatsApp media ${media.id || index + 1}: ${error.message}`;
        throw error;
      }
    }
    return attachments;
  }
};

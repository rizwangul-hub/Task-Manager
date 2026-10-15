import { createHmac, timingSafeEqual } from 'node:crypto';

const constantTimeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyMetaWebhookToken = (receivedToken, expectedToken) =>
  Boolean(receivedToken && expectedToken && constantTimeEqual(receivedToken, expectedToken));

export const verifyMetaWebhookSignature = (rawBody, signature, appSecret) => {
  if (!Buffer.isBuffer(rawBody) || !signature || !appSecret) return false;

  const expectedSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return constantTimeEqual(signature, expectedSignature);
};

export const verifyTwilioWebhookSignature = (url, params, signature, authToken) => {
  if (!url || !params || !signature || !authToken) return false;
  const signedPayload = `${url}${Object.keys(params).sort().map((key) =>
    `${key}${Array.isArray(params[key]) ? params[key].join('') : params[key]}`
  ).join('')}`;
  const expectedSignature = createHmac('sha1', authToken).update(signedPayload).digest('base64');
  return constantTimeEqual(signature, expectedSignature);
};

const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const cloudinary = require('cloudinary').v2;
const Task = require('../models/Task');
const { createAndSendNotification } = require('./notificationService');

// Configure Cloudinary (uses your existing credentials)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function connectToWhatsApp() {
  // Saves login session files in 'auth_info_baileys' so you don't scan QR every restart
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Scan this QR code with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('WhatsApp connection established successfully!');
    }
  });

  // Listen for incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;

      // 1. Check if the message is from a Group (ends with @g.us)
      if (!remoteJid.endsWith('@g.us')) continue;

      // Optional: Target a specific group ID (e.g., process.env.PIXX_WHATSAPP_GROUP_ID)
      if (process.env.PIXX_WHATSAPP_GROUP_ID && remoteJid !== process.env.PIXX_WHATSAPP_GROUP_ID) {
        continue;
      }

      const messageId = msg.key.id;

      // Extract text content (from regular conversation or image caption)
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!text && !msg.message.imageMessage) continue;

      // Avoid duplicate task creation
      const existingTask = await Task.findOne({ whatsappMessageId: messageId });
      if (existingTask) continue;

      let attachments = [];

      // 2. Handle Image Uploads (PCN tickets, receipts, car plates)
      if (msg.message.imageMessage) {
        try {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }) }
          );

          // Upload buffer to Cloudinary
          const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: 'pixx_tasks/whatsapp' },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
            stream.end(buffer);
          });

          attachments.push({
            url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
            fileName: `whatsapp_${Date.now()}.jpg`
          });
        } catch (err) {
          console.error('Error uploading WhatsApp image to Cloudinary:', err);
        }
      }

      // 3. Determine Board & Group based on message content
      let groupTitle = 'General Tasks';
      const lowerText = text.toLowerCase();
      if (lowerText.includes('pcn') || lowerText.includes('ticket') || lowerText.includes('penalty')) {
        groupTitle = 'Penalty Charge Notice';
      } else if (lowerText.includes('bridging') || lowerText.includes('loan')) {
        groupTitle = 'Jasmine Work - Bridging Loan';
      } else if (lowerText.includes('stamp duty')) {
        groupTitle = 'Stamp Duty Refund';
      }

      // 4. Save Task to MongoDB
      const newTask = await Task.create({
        title: text ? text.split('\n')[0].substring(0, 80) : 'WhatsApp Photo Task',
        description: text || 'Task created via WhatsApp image upload',
        groupTitle: groupTitle,
        source: 'WhatsApp',
        whatsappMessageId: messageId,
        status: 'Working on it',
        attachments: attachments
      });

      console.log(`Task created from WhatsApp: "${newTask.title}" in group "${groupTitle}"`);

      // 5. Trigger Notifications (In-App Socket + Email)
      await createAndSendNotification({
        taskId: newTask._id,
        type: 'WHATSAPP_TASK_CREATED',
        title: 'New Task from WhatsApp',
        message: `Task: ${newTask.title} was added to ${groupTitle}`,
        channel: 'BOTH'
      });
    }
  });
}

module.exports = { connectToWhatsApp };
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transporter = null;
let transportConnected = false;
let activeTransportType = null; // 'smtp-app-password' | 'oauth2' | null

/**
 * Priority 1 — Gmail App Password (SMTP_USER + SMTP_PASS, not a placeholder).
 * Priority 2 — Google OAuth2 (fallback if App Password not set or fails).
 *
 * Verification is always non-fatal: a failed verify() logs an error and marks
 * transportConnected = false, but never throws or crashes the server.
 */
const initEmailTransporter = () => {
  if (env.EMAIL.isSmtpAppPasswordConfigured) {
    // ── Priority 1: Gmail App Password via standard SMTP ─────────────────────
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.EMAIL.user,
        pass: env.EMAIL.pass
      }
    });
    activeTransportType = 'smtp-app-password';
    logger.info('[EMAIL] Transport initialised via Gmail SMTP App Password.');
  } else if (env.EMAIL.isOAuthConfigured) {
    // ── Priority 2: Google OAuth2 ─────────────────────────────────────────────
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: env.EMAIL.emailUser,
        clientId: env.EMAIL.oauthClientId,
        clientSecret: env.EMAIL.oauthClientSecret,
        refreshToken: env.EMAIL.oauthRefreshToken
      }
    });
    activeTransportType = 'oauth2';
    logger.info('[EMAIL] Transport initialised via Google OAuth2.');
  } else {
    logger.warn('[EMAIL] No valid email credentials found. Email delivery is disabled.');
    return;
  }

  // Verify the connection without crashing the server on failure
  transporter.verify()
    .then(() => {
      transportConnected = true;
      logger.info(`[EMAIL] Email server ready to send messages (${activeTransportType}).`);
    })
    .catch((err) => {
      transportConnected = false;
      logger.error(`[EMAIL] Email transport verification failed (${activeTransportType}): ${err.message}`);
      logger.warn('[EMAIL] Email delivery is disabled until credentials are corrected and the server restarted.');
    });
};

initEmailTransporter();


/**
 * Base email layout wrapper with professional PixxTechnologiees branding
 */
const wrapInEmailLayout = (title, contentHtml) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .email-container { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .email-header { background: #0f172a; padding: 20px 24px; color: #ffffff; font-size: 18px; font-weight: 700; }
    .email-header span { color: #38bdf8; }
    .email-body { padding: 24px; line-height: 1.6; }
    .task-badge { display: inline-block; background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; margin-bottom: 8px; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
    .email-footer { background: #f1f5f9; padding: 16px 24px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      Task Manager <span style="font-size: 13px; font-weight: normal; opacity: 0.85; display: block; margin-top: 2px;">by PixxTechnologies</span>
    </div>
    <div class="email-body">
      ${contentHtml}
    </div>
    <div class="email-footer">
      This is an automated operational notification from Task Manager by PixxTechnologies.<br>
      You can manage your notification preferences in your account settings.
    </div>
  </div>
</body>
</html>
`;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

const placeholderEmailDomains = new Set([
  'pixxtechnologiees.com',
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid',
  'localhost'
]);

const isPlaceholderEmail = (email) => {
  if (typeof email !== 'string') return true;
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return true;

  const localPart = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return true;
  return placeholderEmailDomains.has(domain) ||
    /\.(example|test|invalid|localhost)$/.test(domain) ||
    /^(test|dummy|placeholder|example)([+._-]|$)/.test(localPart);
};

export const resolveEmailRecipient = (to) => {
  const recipient = typeof to === 'string' ? to.trim() : '';
  const fallbackRecipient = env.EMAIL.emailUser.trim();
  const recipientNeedsFallback = isPlaceholderEmail(recipient);

  if (!recipientNeedsFallback) return recipient;
  if (!fallbackRecipient || isPlaceholderEmail(fallbackRecipient)) {
    throw new Error('Email recipient is missing or a placeholder, and EMAIL_USER is not a valid fallback address.');
  }

  logger.info('[EMAIL_RECIPIENT_FALLBACK] Redirecting placeholder or invalid task recipient to EMAIL_USER.');
  return fallbackRecipient;
};

export const sendTaskNotificationEmail = async ({ to, subject, htmlContent, textContent }) => {
  if (process.env.NODE_ENV === 'test') {
    logger.info('[EMAIL_TEST_MODE] Delivery suppressed in test environment.');
    return { success: true, messageId: '<test-email-suppressed>' };
  }
  if (!emailService.isConfigured()) {
    logger.info(`[EMAIL_SUPPRESSED] Email transport unconfigured. Email not sent to ${to}: "${subject}"`);
    return { success: false, reason: 'unconfigured' };
  }

  const recipient = resolveEmailRecipient(to);
  logger.info(`[EMAIL_ATTEMPT] Sending email to ${recipient}: "${subject}"`);
  try {
    const info = await transporter.sendMail({
      from: env.EMAIL.from,
      to: recipient,
      subject,
      html: htmlContent,
      text: textContent
    });

    logger.info(`[EMAIL_SENT] Email delivered to ${recipient}.`, { messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`[EMAIL_FAILED] Email delivery to ${recipient} failed: ${error.message}`);
    throw error;
  }
};

export const emailService = {
  /**
   * Check if email transport is ready
   */
  isConfigured: () => Boolean(transporter && env.EMAIL.isConfigured),

  /**
   * Return status for Settings diagnostics / health endpoint
   */
  getEmailStatus: () => ({
    configured: emailService.isConfigured(),
    connected: transportConnected,
    status: transportConnected
      ? 'CONNECTED'
      : emailService.isConfigured()
        ? 'CONFIGURED'
        : 'UNCONFIGURED',
    provider: activeTransportType,
    transport: activeTransportType === 'smtp-app-password'
      ? 'Gmail App Password (SMTP)'
      : activeTransportType === 'oauth2'
        ? 'Google OAuth2'
        : null,
    host: 'smtp.gmail.com',
    from: env.EMAIL.from
  }),

  sendTaskEmail: ({ to, subject, htmlContent }) =>
    sendTaskNotificationEmail({ to, subject, htmlContent }),
  sendTaskNotificationEmail: ({ to, subject, htmlContent }) =>
    sendTaskNotificationEmail({ to, subject, htmlContent }),

  /**
   * Send an email or cleanly log suppression if unconfigured
   */
  sendEmail: ({ to, subject, html, text }) =>
    sendTaskNotificationEmail({ to, subject, htmlContent: html, textContent: text }),

  /**
   * Templates
   */
  templates: {
    taskCreated: ({ taskTitle, taskKey, projectName, creatorName, priority, dueDate, actionUrl }) => {
      const safeTitle = escapeHtml(taskTitle);
      const safeTaskKey = escapeHtml(taskKey);
      const safeProjectName = escapeHtml(projectName);
      const safeCreatorName = escapeHtml(creatorName || 'A team member');
      const safePriority = escapeHtml(priority || 'Medium');
      const safeDueDate = escapeHtml(dueDate || 'None');
      const safeActionUrl = escapeHtml(actionUrl);
      const subject = `[New Task] ${taskKey}: ${taskTitle}`;
      const text = `A new task was created: ${taskKey} - "${taskTitle}" in project "${projectName}" by ${creatorName}. Priority: ${priority}. Due Date: ${dueDate || 'Not set'}. View task: ${actionUrl}`;
      const html = wrapInEmailLayout(
        escapeHtml(subject),
        `
        <span class="task-badge">${safeTaskKey}</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">New Task Created</h2>
        <p><strong>${safeCreatorName}</strong> created a new deliverable:</p>
        <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 6px 0; font-size: 16px;">${safeTitle}</h3>
          <p style="margin: 0; font-size: 14px; color: #475569;">
            <strong>Board:</strong> ${safeProjectName}<br>
            <strong>Priority:</strong> ${safePriority}<br>
            <strong>Due Date:</strong> ${safeDueDate}
          </p>
        </div>
        <a href="${safeActionUrl}" class="btn">View Task Details</a>
        `
      );
      return { subject, text, html };
    },

    taskAssigned: ({ taskTitle, taskKey, projectName, groupName, assignerName, dueDate, priority, actionUrl }) => {
      const safeTaskTitle = escapeHtml(taskTitle);
      const safeTaskKey = escapeHtml(taskKey);
      const safeProjectName = escapeHtml(projectName);
      const safeGroupName = groupName ? escapeHtml(groupName) : '';
      const safeAssignerName = escapeHtml(assignerName);
      const safePriority = escapeHtml(priority);
      const safeDueDate = escapeHtml(dueDate || 'None');
      const safeActionUrl = escapeHtml(actionUrl);
      const subject = `[Task Assigned] ${taskKey}: ${taskTitle}`;
      const text = `You have been assigned to task ${taskKey}: "${taskTitle}" in project "${projectName}"${groupName ? `, group "${groupName}"` : ''} by ${assignerName}. Priority: ${priority}. Due Date: ${dueDate || 'Not set'}. View task: ${actionUrl}`;
      const html = wrapInEmailLayout(
        escapeHtml(subject),
        `
        <span class="task-badge">${safeTaskKey}</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">You've been assigned to a new task</h2>
        <p><strong>${safeAssignerName}</strong> has assigned you to the following deliverable:</p>
        <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 6px 0; font-size: 16px;">${safeTaskTitle}</h3>
          <p style="margin: 0; font-size: 14px; color: #475569;">
            <strong>Board:</strong> ${safeProjectName}<br>
            ${safeGroupName ? `<strong>Group:</strong> ${safeGroupName}<br>` : ''}
            <strong>Priority:</strong> ${safePriority}<br>
            <strong>Due Date:</strong> ${safeDueDate}
          </p>
        </div>
        <a href="${safeActionUrl}" class="btn">View Task Details</a>
        `
      );
      return { subject, text, html };
    },

    whatsappDraftReceived: ({ draftTitle, groupName, senderName, senderPhone, priority, dueDate, rawMessage, actionUrl }) => {
      const safeTitle = escapeHtml(draftTitle || 'New WhatsApp Task Draft');
      const safeGroupName = escapeHtml(groupName || 'WhatsApp Group');
      const safeSenderName = escapeHtml(senderName || senderPhone || 'A team member');
      const safeSenderPhone = escapeHtml(senderPhone || '');
      const safePriority = escapeHtml(priority || 'Medium');
      const safeDueDate = escapeHtml(dueDate || 'Not specified');
      const safeRawMessage = escapeHtml(rawMessage || '');
      const safeActionUrl = escapeHtml(actionUrl);
      const subject = `[WhatsApp Draft] Awaiting Review: ${draftTitle ? draftTitle.replace(/[\r\n]+/g, ' ') : 'New Task Detected'}`;
      const text = `A new task draft was extracted from WhatsApp group "${groupName}" by ${senderName} (${senderPhone}). Title: "${draftTitle}". Priority: ${priority}. Due Date: ${dueDate || 'Not set'}. Review draft: ${actionUrl}`;
      const html = wrapInEmailLayout(
        escapeHtml(subject),
        `
        <span class="task-badge" style="background: #fef3c7; color: #b45309;">WhatsApp Draft &bull; Awaiting Review</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">New WhatsApp Task Detected</h2>
        <p>A new actionable task instruction was received from <strong>${safeSenderName}</strong>${safeSenderPhone ? ` (${safeSenderPhone})` : ''} in <strong>${safeGroupName}</strong>:</p>
        <div style="background: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 6px 0; font-size: 16px; color: #0f172a;">${safeTitle}</h3>
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #475569;">
            <strong>Group:</strong> ${safeGroupName}<br>
            <strong>Priority:</strong> ${safePriority}<br>
            <strong>Due Date:</strong> ${safeDueDate}
          </p>
          <div style="font-size: 13px; color: #475569; background: #ffffff; padding: 10px 14px; border-radius: 4px; border: 1px dashed #cbd5e1; margin-top: 8px;">
            <strong>Original WhatsApp message:</strong><br>
            <em>"${safeRawMessage}"</em>
          </div>
        </div>
        <a href="${safeActionUrl}" class="btn" style="background: #2563eb;">Review & Approve Task</a>
        `
      );
      return { subject, text, html };
    },

    whatsappTaskCreated: ({ taskTitle, taskKey, projectName, senderPhone, senderName, groupName, priority, dueDate, taskPreviewUrl, actionUrl }) => {
      const safeTitle = escapeHtml(taskTitle);
      const safeTaskKey = escapeHtml(taskKey);
      const safeProjectName = escapeHtml(projectName);
      const safeSenderPhone = escapeHtml(senderPhone);
      const safeSenderName = escapeHtml(senderName || senderPhone);
      const safeGroupName = escapeHtml(groupName || 'Backlog / Unsorted');
      const safeActionUrl = escapeHtml(actionUrl);
      const safePreviewUrl = taskPreviewUrl ? escapeHtml(taskPreviewUrl) : '';
      const subject = `[WhatsApp Intake] ${taskKey}: ${taskTitle.replace(/[\r\n]+/g, ' ')}`;
      const text = `A new task was created from a WhatsApp message from ${senderName ? `${senderName} (${senderPhone})` : senderPhone} in project "${projectName}" under ${groupName || 'Backlog / Unsorted'}. Priority: ${priority || 'Medium'}. Due Date: ${dueDate || 'None'}.${taskPreviewUrl ? ` Image: ${taskPreviewUrl}` : ''} View task: ${actionUrl}`;
      const html = wrapInEmailLayout(
        escapeHtml(subject),
        `
        <span class="task-badge">${safeTaskKey}</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">New task from WhatsApp</h2>
        <p>A WhatsApp message from <strong>${safeSenderName}</strong> (${safeSenderPhone}) created this task:</p>
        <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 6px 0; font-size: 16px;">${safeTitle}</h3>
          <p style="margin: 0; font-size: 14px; color: #475569;"><strong>Board:</strong> ${safeProjectName}<br><strong>Group:</strong> ${safeGroupName}<br><strong>Priority:</strong> ${escapeHtml(priority || 'Medium')}<br><strong>Due Date:</strong> ${escapeHtml(dueDate || 'None')}</p>
        </div>
        ${safePreviewUrl ? `<img src="${safePreviewUrl}" alt="WhatsApp task attachment" style="display:block;max-width:100%;max-height:320px;border-radius:6px;margin:16px 0;">` : ''}
        <a href="${safeActionUrl}" class="btn">View Task Details</a>
        `
      );
      return { subject, text, html };
    },

    statusChanged: ({ taskTitle, taskKey, projectName, changerName, previousStatus, newStatus, actionUrl }) => {
      const subject = `[Status Update] ${taskKey}: Moved to ${newStatus}`;
      const text = `${changerName} changed status of task ${taskKey}: "${taskTitle}" (${projectName}) from "${previousStatus}" to "${newStatus}". View task: ${actionUrl}`;
      const html = wrapInEmailLayout(
        subject,
        `
        <span class="task-badge">${taskKey}</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">Task Status Updated</h2>
        <p><strong>${changerName}</strong> updated the status on <strong>${taskKey}: ${taskTitle}</strong> in project <em>${projectName}</em>.</p>
        <p style="font-size: 15px;">
          Status transitioned from <strong>${previousStatus}</strong> &rarr; <strong style="color: #2563eb;">${newStatus}</strong>.
        </p>
        <a href="${actionUrl}" class="btn">Open Task</a>
        `
      );
      return { subject, text, html };
    },

    commentAdded: ({ taskTitle, taskKey, commenterName, commentSnippet, actionUrl }) => {
      const subject = `[New Comment] on ${taskKey}: ${taskTitle}`;
      const text = `${commenterName} left a comment on ${taskKey}: "${commentSnippet}". View discussion: ${actionUrl}`;
      const html = wrapInEmailLayout(
        subject,
        `
        <span class="task-badge">${taskKey}</span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px;">New Discussion Comment</h2>
        <p><strong>${commenterName}</strong> commented on <strong>${taskKey}: ${taskTitle}</strong>:</p>
        <blockquote style="margin: 16px 0; padding: 12px 16px; background: #f8fafc; border-left: 3px solid #94a3b8; font-style: italic; color: #334155;">
          "${commentSnippet}"
        </blockquote>
        <a href="${actionUrl}" class="btn">Join Discussion</a>
        `
      );
      return { subject, text, html };
    },

    dueReminder: ({ taskTitle, taskKey, projectName, dueDate, isOverdue, actionUrl }) => {
      const prefix = isOverdue ? '[OVERDUE ALERT]' : '[DUE DATE REMINDER]';
      const subject = `${prefix} ${taskKey}: ${taskTitle}`;
      const text = `Task ${taskKey}: "${taskTitle}" in project "${projectName}" is ${isOverdue ? 'OVERDUE' : 'due soon'} (${dueDate}). View task: ${actionUrl}`;
      const html = wrapInEmailLayout(
        subject,
        `
        <span class="task-badge" style="background: ${isOverdue ? '#fee2e2' : '#fef3c7'}; color: ${isOverdue ? '#dc2626' : '#d97706'};">
          ${isOverdue ? 'ACTION REQUIRED: OVERDUE' : 'UPCOMING DEADLINE'}
        </span>
        <h2 style="margin-top: 4px; margin-bottom: 12px; font-size: 20px; color: ${isOverdue ? '#dc2626' : '#d97706'};">
          ${isOverdue ? 'Deliverable is Overdue' : 'Upcoming Task Deadline'}
        </h2>
        <p>This is a reminder that task <strong>${taskKey}: ${taskTitle}</strong> in project <em>${projectName}</em> is scheduled for <strong>${dueDate}</strong>.</p>
        <a href="${actionUrl}" class="btn" style="background: ${isOverdue ? '#dc2626' : '#2563eb'};">Review Deliverable</a>
        `
      );
      return { subject, text, html };
    }
  }
};

export const sendTaskEmail = ({ to, subject, htmlContent }) =>
  sendTaskNotificationEmail({ to, subject, htmlContent });

export default emailService;

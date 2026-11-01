/**
 * Coastal View Mandarmani - Free SMTP Email Service
 * Handles Nodemailer transport, automatic retries, timeouts,
 * daily quota tracking, mail logging (masked recipients, no bodies/codes),
 * and branded responsive HTML + text templates.
 */
require('dotenv').config({ quiet: true });
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decryptSettingSecret, isSettingsEncryptionConfigured } = require('./settings_crypto');
const { getDbPath, readDB: storeReadDB, writeDB: storeWriteDB } = require('./db_store');

const DB_PATH = getDbPath();

// Mask recipient email address: e.g. "admin@domain.com" -> "a***n@domain.com"
function maskEmail(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return 'invalid';
  const name = parts[0];
  const domain = parts[1];
  return `${name[0]}***@${domain}`;
}

// Format IST timestamp
function getISTTimestamp() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
}

// Convert low-level SMTP errors to safe, user-friendly messages (never leaking passwords/stack)
function getSafeErrorMessage(err) {
  if (!err) return 'Unknown email error occurred.';
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '').toUpperCase();

  if (
    msg.includes('invalid login') || 
    msg.includes('535') || 
    msg.includes('bad credentials') || 
    msg.includes('username and password not accepted') || 
    code === 'EAUTH'
  ) {
    return 'Gmail rejected the login. Check the App Password.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'Connection timed out. Check SMTP host and port.';
  }
  if (code === 'ECONNREFUSED' || msg.includes('connection refused')) {
    return 'Connection refused by SMTP server.';
  }
  if (code === 'ENOTFOUND' || msg.includes('getaddrinfo') || msg.includes('not found')) {
    return 'SMTP host could not be resolved. Check hostname.';
  }
  if (code === 'EENVELOPE') {
    return 'Sender or recipient address was rejected by SMTP server.';
  }
  return 'SMTP connection or login failed. Check your settings.';
}

// Get configured SMTP parameters: Database settings first, then .env as fallback
function getSmtpConfig(db = null) {
  if (!db) db = readDBDirect();
  const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).trim().replace(/\/$/, '');
  const dailyLimit = parseInt(process.env.SMTP_DAILY_LIMIT, 10) || 300;

  // 1. Check database settings (db.settings.email)
  const dbSettings = db?.settings?.email;
  if (dbSettings && (dbSettings.senderEmail || dbSettings.appPassword)) {
    let decryptedPass = '';
    let hasSavedPass = false;
    let passMasked = null;
    let passSavedAt = null;
    let passKeyVersion = null;

    if (dbSettings.appPassword) {
      if (typeof dbSettings.appPassword === 'object' && dbSettings.appPassword.encrypted) {
        hasSavedPass = true;
        passMasked = dbSettings.appPassword.masked || '● ● ● ● saved';
        passSavedAt = dbSettings.appPassword.savedAt || null;
        passKeyVersion = dbSettings.appPassword.keyVersion || 1;
        try {
          decryptedPass = decryptSettingSecret(dbSettings.appPassword);
        } catch (e) {
          console.error('[SMTP Engine] Failed to decrypt saved App Password in memory:', e.message);
          decryptedPass = '';
        }
      } else if (typeof dbSettings.appPassword === 'string' && dbSettings.appPassword.length > 0) {
        hasSavedPass = true;
        decryptedPass = dbSettings.appPassword;
      }
    }

    const host = (dbSettings.host || 'smtp.gmail.com').trim();
    const port = parseInt(dbSettings.port, 10) || 465;
    const secure = dbSettings.secure !== undefined ? Boolean(dbSettings.secure) : (port === 465);
    const user = (dbSettings.senderEmail || '').trim();
    const pass = decryptedPass;
    const mailFrom = user || 'reservations@coastalviewmandarmani.com';
    const mailFromName = (dbSettings.senderName || 'Coastal View').trim();
    const adminAlertEmail = (dbSettings.adminAlertEmail || user || '').trim();
    const isConfigured = Boolean(host && user && pass);

    return {
      source: 'database',
      sourceLabel: 'Admin Settings (Database)',
      host,
      port,
      secure,
      user,
      pass,
      mailFrom,
      mailFromName,
      adminEmail: adminAlertEmail,
      adminAlertEmail,
      appUrl,
      dailyLimit,
      isConfigured,
      hasSavedPass,
      passMasked,
      passSavedAt,
      passKeyVersion
    };
  }

  // 2. Fallback to environment variables (SMTP_*)
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const mailFrom = (process.env.MAIL_FROM || process.env.SMTP_FROM || user || 'reservations@coastalviewmandarmani.com').trim();
  const mailFromName = (process.env.MAIL_FROM_NAME || "Coastal View Mandarmani").trim();
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
  const secureEnv = process.env.SMTP_SECURE;
  const secure = (secureEnv !== undefined && secureEnv !== '') 
    ? (secureEnv === 'true' || secureEnv === '1') 
    : (port === 465);
  const isEnvConfigured = Boolean(process.env.SMTP_HOST && user && pass);

  return {
    source: isEnvConfigured ? 'env' : 'none',
    sourceLabel: isEnvConfigured ? 'Environment Variables (.env)' : 'Not Configured',
    host,
    port,
    secure,
    user,
    pass,
    mailFrom,
    mailFromName,
    adminEmail,
    adminAlertEmail: adminEmail,
    appUrl,
    dailyLimit,
    isConfigured: isEnvConfigured,
    hasSavedPass: false,
    passMasked: null,
    passSavedAt: null,
    passKeyVersion: null
  };
}

let cachedTransporter = null;
let lastTransporterConfigKey = '';
let lastKnownStatus = 'not_configured'; // 'working' | 'failing' | 'not_configured'
let lastSmtpError = null;

function createTransporter(db = null, customConfig = null) {
  const config = customConfig || getSmtpConfig(db);
  if (!config.isConfigured) {
    if (!customConfig) {
      cachedTransporter = null;
      lastKnownStatus = 'not_configured';
    }
    return null;
  }

  const passHash = config.pass ? crypto.createHash('sha256').update(config.pass).digest('hex').slice(0, 12) : 'nopass';
  const configKey = `${config.source || 'custom'}:${config.host}:${config.port}:${config.secure}:${config.user}:${passHash}`;
  if (!customConfig && cachedTransporter && lastTransporterConfigKey === configKey) {
    return cachedTransporter;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true for 465, false for 587
      auth: {
        user: config.user,
        pass: config.pass
      },
      connectionTimeout: 10000, // 10s connection timeout
      greetingTimeout: 10000,   // 10s greeting timeout
      socketTimeout: 15000,     // 15s socket activity timeout
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      }
    });

    if (!customConfig) {
      cachedTransporter = transporter;
      lastTransporterConfigKey = configKey;
    }
    return transporter;
  } catch (err) {
    console.error('[SMTP Engine] Transporter creation error:', err.message);
    if (!customConfig) {
      lastKnownStatus = 'failing';
      lastSmtpError = err.message;
    }
    return null;
  }
}

// Log email attempt into db.mailLogs (NO email bodies or verification codes stored)
function recordMailLog(db, { type, recipient, status, errorCode = null }) {
  try {
    const masked = maskEmail(recipient);
    const today = new Date().toISOString().split('T')[0];

    db.mailLogs = db.mailLogs || [];
    const logEntry = {
      id: `mail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type, // 'Login Code', 'Security Alert', 'Password Reset', 'Booking Confirmation', etc.
      recipientMasked: masked,
      status, // 'Success' | 'Failed'
      errorCode: errorCode ? String(errorCode) : null,
      timestamp: new Date().toISOString()
    };

    db.mailLogs.unshift(logEntry);
    if (db.mailLogs.length > 500) {
      db.mailLogs = db.mailLogs.slice(0, 500);
    }

    // Daily counter tracking
    db.emailDailyStats = db.emailDailyStats || {};
    if (!db.emailDailyStats[today]) {
      db.emailDailyStats[today] = { total: 0, success: 0, failed: 0 };
    }
    db.emailDailyStats[today].total += 1;
    if (status === 'Success') {
      db.emailDailyStats[today].success += 1;
    } else {
      db.emailDailyStats[today].failed += 1;
    }

    // Prune stats older than 30 days
    const days = Object.keys(db.emailDailyStats);
    if (days.length > 30) {
      days.sort();
      while (days.length > 30) {
        delete db.emailDailyStats[days.shift()];
      }
    }

    // Persist to disk safely
    storeWriteDB(db);
  } catch (err) {
    console.warn('[SMTP Engine] Failed to record mail log:', err.message);
  }
}

/**
 * Direct DB reader helper if db is not passed into sendMail
 */
function readDBDirect() {
  try {
    return storeReadDB();
  } catch (e) {
    return null;
  }
}

/**
 * Core sendMail function:
 * - Nodemailer transport with Gmail SMTP or custom provider
 * - 1 automatic retry on transient failure
 * - Catches all errors so caller flow NEVER crashes
 * - Masks recipients in mail log
 * - Never stores codes or bodies
 */
async function sendMail({ db, type = 'System Email', to, subject, html, text, attachments = [] }) {
  if (!db) db = readDBDirect();
  const config = getSmtpConfig(db);
  const fromHeader = `"${config.mailFromName}" <${config.mailFrom}>`;

  if (!config.isConfigured) {
    lastKnownStatus = 'not_configured';
    if (db) {
      recordMailLog(db, {
        type,
        recipient: to,
        status: 'Failed',
        errorCode: 'SMTP_NOT_CONFIGURED'
      });
    }
    return {
      success: false,
      errorCode: 'SMTP_NOT_CONFIGURED',
      error: 'Email is not configured yet. Set up SMTP in Settings > Email or .env.'
    };
  }

  const transporter = createTransporter(db);
  if (!transporter) {
    lastKnownStatus = 'failing';
    if (db) {
      recordMailLog(db, {
        type,
        recipient: to,
        status: 'Failed',
        errorCode: 'TRANSPORTER_INIT_ERROR'
      });
    }
    return {
      success: false,
      errorCode: 'TRANSPORTER_INIT_ERROR',
      error: 'Failed to initialize SMTP transporter.'
    };
  }

  const mailOptions = {
    from: fromHeader,
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    html,
    attachments
  };

  // Attempt 1
  try {
    const info = await transporter.sendMail(mailOptions);
    lastKnownStatus = 'connected';
    lastSmtpError = null;
    if (db) {
      recordMailLog(db, {
        type,
        recipient: to,
        status: 'Success'
      });
    }
    return { success: true, messageId: info.messageId };
  } catch (err1) {
    console.warn(`[SMTP Engine] Attempt 1 failed for "${type}" to ${maskEmail(to)}:`, err1.message);

    // One automatic retry after 1.5 seconds delay
    await new Promise(r => setTimeout(r, 1500));

    try {
      const info = await transporter.sendMail(mailOptions);
      lastKnownStatus = 'connected';
      lastSmtpError = null;
      if (db) {
        recordMailLog(db, {
          type,
          recipient: to,
          status: 'Success'
        });
      }
      return { success: true, messageId: info.messageId, retried: true };
    } catch (err2) {
      console.error(`[SMTP Engine] Attempt 2 (retry) also failed for "${type}":`, err2.message);
      lastKnownStatus = 'failing';
      lastSmtpError = err2.message;

      if (db) {
        recordMailLog(db, {
          type,
          recipient: to,
          status: 'Failed',
          errorCode: err2.code || 'SEND_FAILURE'
        });
      }

      return {
        success: false,
        errorCode: err2.code || 'SEND_FAILURE',
        error: getSafeErrorMessage(err2)
      };
    }
  }
}

// Alias for full backward compatibility
const sendMailWithRetry = sendMail;

// Verify live SMTP connection & TLS handshake (supports custom pre-save test config)
async function verifySmtpConnection(customConfig = null, db = null) {
  const config = customConfig || getSmtpConfig(db);
  if (!config.isConfigured) {
    if (!customConfig) lastKnownStatus = 'not_configured';
    return {
      connected: false,
      status: 'not_configured',
      safeError: 'Email credentials are not configured.',
      message: 'Email credentials are not configured.'
    };
  }

  const transporter = createTransporter(db, customConfig);
  if (!transporter) {
    if (!customConfig) lastKnownStatus = 'failing';
    return {
      connected: false,
      status: 'failing',
      safeError: 'Could not create SMTP transport. Check host and port.',
      message: 'Could not create SMTP transport.'
    };
  }

  try {
    await transporter.verify();
    if (!customConfig) {
      lastKnownStatus = 'working';
      lastSmtpError = null;
    }
    return {
      connected: true,
      status: 'working',
      message: `Successfully connected to ${config.host}:${config.port} via ${config.secure ? 'SSL/TLS' : 'STARTTLS'}.`
    };
  } catch (err) {
    // CRITICAL SECURITY: Log real SMTP error code only on the server, never send raw message or stack to client!
    console.error('[SMTP Verify Server Log] SMTP handshake failed:', err.code || 'UNKNOWN', err.message);
    if (!customConfig) {
      lastKnownStatus = 'failing';
      lastSmtpError = err.message;
    }
    const safeError = getSafeErrorMessage(err);
    return {
      connected: false,
      status: 'failing',
      errorCode: err.code || 'VERIFY_FAILED',
      safeError,
      message: safeError
    };
  }
}

// Get email statistics & daily quota usage
function getEmailStats(db = null) {
  if (!db) db = readDBDirect();
  const config = getSmtpConfig(db);
  const today = new Date().toISOString().split('T')[0];
  const todayStats = (db?.emailDailyStats && db.emailDailyStats[today]) || { total: 0, success: 0, failed: 0 };
  const dailyLimit = config.dailyLimit;
  const todayCount = todayStats.success;
  const percentUsed = Math.min(100, Math.round((todayCount / dailyLimit) * 100));
  const isNearLimit = percentUsed >= 80;
  const isLimitReached = todayCount >= dailyLimit;

  // Find last successful send time in db.mailLogs
  const lastSuccessLog = (db?.mailLogs || []).find(l => l.status === 'Success');
  const lastSuccessAt = lastSuccessLog ? lastSuccessLog.timestamp : null;

  // Status computation: working | not_configured | failing
  let status = 'not_configured';
  if (config.isConfigured) {
    status = (lastKnownStatus === 'failing') ? 'failing' : 'working';
  }

  return {
    status,
    host: config.host || 'smtp.gmail.com',
    port: config.port,
    secure: config.secure,
    senderEmail: config.mailFrom,
    senderName: config.mailFromName,
    adminAlertEmail: config.adminAlertEmail,
    isConfigured: config.isConfigured,
    source: config.source,
    sourceLabel: config.sourceLabel,
    hasSavedPass: config.hasSavedPass,
    passMasked: config.passMasked,
    passSavedAt: config.passSavedAt,
    passKeyVersion: config.passKeyVersion,
    todayCount,
    todayFailed: todayStats.failed,
    dailyLimit,
    percentUsed,
    isNearLimit,
    isLimitReached,
    lastSuccessAt,
    lastError: lastSmtpError ? getSafeErrorMessage({ message: lastSmtpError }) : null,
    recentLogs: (db?.mailLogs || []).slice(0, 25)
  };
}

// ============================================================================
// BRANDED EMAIL TEMPLATES (HTML & Plain Text)
// Brand Colors: Ocean Blue #073B4C, Gold #D4AF37/#E8C77B, Seafoam #06B6B0, Sand #F8FAFC
// Mobile Friendly, Max Width 560px, Inline CSS, Alt Text, Gmail Compatible
// Rule: Code or link is NEVER shown in subject line or preview text
// ============================================================================

function baseEmailWrapper({ title, previewText, contentHtml }) {
  const config = getSmtpConfig();
  const logoUrl = `${config.appUrl}/assets/images/logo.png`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px 12px; color: #1E293B; line-height: 1.6;">
  <!-- Hidden preheader preview text: NEVER contains code or token -->
  <div style="display: none; font-size: 1px; color: #F8FAFC; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${previewText || title}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1.5px solid #E8C77B; box-shadow: 0 10px 30px rgba(7, 59, 76, 0.08);">
    <!-- Header -->
    <tr>
      <td style="background: #073B4C; padding: 26px 24px; text-align: center;">
        <img src="${logoUrl}" alt="Coastal View Logo" width="110" style="max-width: 110px; height: auto; margin-bottom: 8px; display: inline-block; border: 0;" onerror="this.style.display='none'">
        <h1 style="margin: 0; font-size: 24px; font-family: Georgia, serif; letter-spacing: 1.5px; color: #FFFFFF; font-weight: 700;">Coastal View</h1>
        <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #E8C77B; margin-top: 4px; font-weight: 600;">Managed By Ani's</div>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 28px 24px;">
        ${contentHtml}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background: #F1F5F9; padding: 18px 20px; text-align: center; font-size: 11px; color: #64748B; border-top: 1px solid #E2E8F0; line-height: 1.5;">
        Coastal View, Managed By Ani's · Rina Rd, Mandarmani, West Bengal 721455 · This is an automated message, please don't reply.
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// 1. Template: Login verification code (Prompt 3A)
function templateLoginCode({ name, code, ip, device, location, timeStr }) {
  const config = getSmtpConfig();
  const subject = "Your Coastal View admin login code";
  const preview = "Use your verification code to finish signing in to the admin panel.";
  const formattedTime = timeStr || getISTTimestamp();
  const resetUrl = `${config.appUrl}/admin/forgot-password`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <p style="font-size: 15px; color: #073B4C; font-weight: 600; margin: 0 0 10px 0;">Hello ${name || 'Staff Member'},</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        Use this code to finish signing in to the admin panel:
      </p>

      <div style="background: #FAF6EE; border: 2px solid #E8C77B; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
        <div style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #073B4C; font-family: 'Courier New', monospace; user-select: all;">
          ${code}
        </div>
        <div style="font-size: 12px; color: #06B6B0; font-weight: 600; margin-top: 8px;">
          ⏱ This code expires in 10 minutes and can be used only once.
        </div>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #334155; margin-bottom: 22px;">
        <div style="font-weight: 600; color: #073B4C; margin-bottom: 6px;">Sign-In Details:</div>
        <div>• <strong>Time:</strong> ${formattedTime}</div>
        <div>• <strong>Device and browser:</strong> ${device || 'Web Browser'}</div>
        <div>• <strong>IP address:</strong> ${ip || '127.0.0.1'}</div>
        ${location ? `<div>• <strong>Approximate location:</strong> ${location}</div>` : ''}
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 14px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; margin-bottom: 18px;">
        <strong>Notice:</strong> If this wasn't you, don't share this code. Change your password right away:
        <div style="margin-top: 10px;">
          <a href="${resetUrl}" style="background: #D4AF37; background: linear-gradient(135deg, #E8C77B 0%, #D4AF37 100%); color: #073B4C; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">
            Reset Password
          </a>
        </div>
      </div>

      <p style="font-size: 12px; color: #64748B; margin: 0; font-style: italic;">
        Coastal View staff will never ask you for this code.
      </p>
    `
  });

  const text = `Coastal View · Managed By Ani's

Hello ${name || 'Staff Member'},

Use this code to finish signing in to the admin panel:
${code}

This code expires in 10 minutes and can be used only once.

Sign-In Details:
Time: ${formattedTime}
Device and browser: ${device || 'Web Browser'}
IP address: ${ip || '127.0.0.1'}
${location ? 'Approximate location: ' + location + '\n' : ''}
If this wasn't you, don't share this code. Change your password right away: ${resetUrl}

Coastal View staff will never ask you for this code.

Coastal View, Managed By Ani's · Rina Rd, Mandarmani, West Bengal 721455 · This is an automated message, please don't reply.`;

  return { subject, html, text };
}

// 2. Template: Password reset link (Prompt 3B)
function templatePasswordReset({ name, resetUrl, ip, device, timeStr }) {
  const subject = "Reset your Coastal View admin password";
  const preview = "We received a request to reset your Coastal View admin password.";
  const formattedTime = timeStr || getISTTimestamp();

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <p style="font-size: 15px; color: #073B4C; font-weight: 600; margin: 0 0 10px 0;">Hello ${name || 'Administrator'},</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        We received a request to reset your password.
      </p>

      <div style="text-align: center; margin: 26px 0;">
        <a href="${resetUrl}" style="background: #D4AF37; background: linear-gradient(135deg, #E8C77B 0%, #D4AF37 100%); color: #073B4C; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(212, 175, 55, 0.35);">
          Reset my password
        </a>
      </div>

      <p style="font-size: 13px; color: #475569; line-height: 1.5; margin: 0 0 20px 0;">
        This link expires in 30 minutes and works once. If you didn't ask for this, ignore this email. Your password won't change.
      </p>

      <div style="background: #FAF6EE; border: 1px dashed #E8C77B; border-radius: 8px; padding: 12px; font-size: 12px; color: #475569; word-break: break-all; margin-bottom: 22px;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #073B4C; text-decoration: underline;">${resetUrl}</a>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #334155;">
        <div style="font-weight: 600; color: #073B4C; margin-bottom: 6px;">Request Details:</div>
        <div>• <strong>Time:</strong> ${formattedTime}</div>
        <div>• <strong>Device and browser:</strong> ${device || 'Web Browser'}</div>
        <div>• <strong>IP address:</strong> ${ip || '127.0.0.1'}</div>
      </div>
    `
  });

  const text = `Coastal View · Managed By Ani's

Hello ${name || 'Administrator'},

We received a request to reset your password.

Reset your password using the link below:
${resetUrl}

This link expires in 30 minutes and works once. If you didn't ask for this, ignore this email. Your password won't change.

Request Details:
Time: ${formattedTime}
Device and browser: ${device || 'Web Browser'}
IP address: ${ip || '127.0.0.1'}

Coastal View, Managed By Ani's · Rina Rd, Mandarmani, West Bengal 721455 · This is an automated message, please don't reply.`;

  return { subject, html, text };
}

// 3. Template: Password changed (Prompt 3C)
function templatePasswordChanged({ name, username, ip, device, timeStr }) {
  const config = getSmtpConfig();
  const subject = "Your Coastal View admin password was changed";
  const preview = "Security notification: Your Coastal View admin password was changed.";
  const formattedTime = timeStr || getISTTimestamp();
  const resetUrl = `${config.appUrl}/admin/forgot-password`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <p style="font-size: 15px; color: #073B4C; font-weight: 600; margin: 0 0 10px 0;">Hello ${name || username || 'Administrator'},</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        Your password was changed on <strong>${formattedTime}</strong> from <strong>${device || 'Web Browser'}</strong>, IP: <strong>${ip || '127.0.0.1'}</strong>.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div style="margin-bottom: 6px;">• <strong>Account:</strong> ${username || name || 'Administrator'}</div>
        <div style="margin-bottom: 6px;">• <strong>Time:</strong> ${formattedTime}</div>
        <div style="margin-bottom: 6px;">• <strong>Device and browser:</strong> ${device || 'Web Browser'}</div>
        <div>• <strong>IP address:</strong> ${ip || '127.0.0.1'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 14px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; line-height: 1.5;">
        <strong>Security Notice:</strong> All other active sessions have been signed out. If this wasn't you, reset your password immediately or contact the owner:
        <div style="margin-top: 10px;">
          <a href="${resetUrl}" style="background: #FF6B5E; color: #FFFFFF; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">
            Reset Immediately
          </a>
        </div>
      </div>
    `
  });

  const text = `Coastal View · Managed By Ani's

Hello ${name || username || 'Administrator'},

Your password was changed on ${formattedTime} from ${device || 'Web Browser'}, IP: ${ip || '127.0.0.1'}.

All other active sessions have been signed out.

If this wasn't you, reset your password immediately: ${resetUrl} or contact the owner.

Coastal View, Managed By Ani's · Rina Rd, Mandarmani, West Bengal 721455 · This is an automated message, please don't reply.`;

  return { subject, html, text };
}

// 4. Template: Optional new device login alert (Prompt 3D)
function templateNewDeviceLogin({ username, name, ip, device, timeStr }) {
  const config = getSmtpConfig();
  const subject = "Security Alert: New device login on Coastal View";
  const preview = "A new device was used to sign into your Coastal View account.";
  const formattedTime = timeStr || getISTTimestamp();
  const resetUrl = `${config.appUrl}/admin/forgot-password`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <p style="font-size: 15px; color: #073B4C; font-weight: 600; margin: 0 0 10px 0;">Hello ${name || username || 'Staff Member'},</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        A new device was used to sign into your Coastal View account (<strong>${username}</strong>):
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div style="margin-bottom: 6px;">• <strong>Account:</strong> ${username}</div>
        <div style="margin-bottom: 6px;">• <strong>Time:</strong> ${formattedTime}</div>
        <div style="margin-bottom: 6px;">• <strong>IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Device:</strong> ${device || 'Unknown Device'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 14px 16px; border-radius: 6px; font-size: 13px; color: #991B1B;">
        If this was you, you can safely ignore this alert.<br>
        If this wasn't you, secure your account right away:
        <div style="margin-top: 10px;">
          <a href="${resetUrl}" style="background: #FF6B5E; color: #FFFFFF; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 12px; display: inline-block;">
            Not Me · Secure Account
          </a>
        </div>
      </div>
    `
  });

  const text = `Coastal View · Managed By Ani's

Security Alert: New device login on Coastal View
Account: ${username}
Time: ${formattedTime}
IP: ${ip}
Device: ${device}

If this wasn't you, secure your account right away: ${resetUrl}

Coastal View, Managed By Ani's · Rina Rd, Mandarmani, West Bengal 721455 · This is an automated message, please don't reply.`;

  return { subject, html, text };
}

// 5. Template: Booking Confirmation (with Invoice PDF attached)
function templateBookingConfirmation({ booking, invoiceNumber, hotelSettings }) {
  const subject = `Booking Confirmation: ${invoiceNumber || booking.bookingId} - Coastal View Mandarmani`;
  const preview = `Your reservation at Coastal View is confirmed! Invoice ${invoiceNumber || booking.bookingId}`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="background: #E6FBF8; color: #06B6B0; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
          Reservation Confirmed
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 22px; color: #073B4C; text-align: center;">Welcome to Coastal View, Mandarmani!</h2>
      <p style="font-size: 14px; color: #475569; text-align: center; margin: 0 0 24px 0;">
        Dear <strong>${booking.customerName}</strong>, your reservation has been confirmed. Your official tax invoice PDF is attached to this email.
      </p>

      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; margin-bottom: 24px; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Invoice / Booking ID:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #073B4C; text-align: right;">${invoiceNumber || booking.bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Room Category:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #073B4C; text-align: right;">${booking.roomName || 'Selected Room'}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Stay Dates:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #073B4C; text-align: right;">${booking.checkIn} to ${booking.checkOut} (${booking.nights || 1} Night(s))</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Guests / Occupancy:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #073B4C; text-align: right;">${booking.children ? `${booking.adults || 2} Adults + ${booking.children} Child${booking.children > 1 ? 'ren' : ''}` : `${booking.adults || 2} Adults`}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Total Amount:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #073B4C; text-align: right;">₹${(booking.totalPrice || 0).toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Advance Paid (20%):</td>
          <td style="padding: 6px 0; font-weight: 700; color: #06B6B0; text-align: right;">₹${(booking.advancePaid || 0).toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748B;">Balance Due at Check-in:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #E8C77B; text-align: right;">₹${(booking.balanceDue || 0).toLocaleString('en-IN')}</td>
        </tr>
      </table>

      <div style="background: #FAF6EE; border-left: 4px solid #E8C77B; padding: 14px 18px; border-radius: 6px; font-size: 13px; color: #475569; margin-bottom: 20px;">
        <strong>Check-in Details:</strong><br>
        • Check-in time: <strong>${hotelSettings?.checkInTime || '11:00 AM'}</strong> • Check-out time: <strong>${hotelSettings?.checkOutTime || '9:30 AM'}</strong><br>
        • Please present a valid Government Photo ID at the front desk upon arrival.
      </div>
    `
  });

  const text = `Booking Confirmation - Coastal View Mandarmani
Booking ID: ${invoiceNumber || booking.bookingId}
Guest: ${booking.customerName}
Room: ${booking.roomName}
Dates: ${booking.checkIn} to ${booking.checkOut}
Total Price: ₹${booking.totalPrice}
Advance Paid: ₹${booking.advancePaid}
Balance Due: ₹${booking.balanceDue}
Invoice attached.`;

  return { subject, html, text };
}

// 6. Template: Booking Cancellation
function templateBookingCancellation({ booking, reason }) {
  const subject = `Booking Cancellation: ${booking.invoiceNumber || booking.bookingId} - Coastal View Mandarmani`;
  const preview = `Your reservation ${booking.invoiceNumber || booking.bookingId} has been cancelled`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="background: #FEF2F2; color: #EF4444; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
          Reservation Cancelled
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 22px; color: #073B4C; text-align: center;">Booking Cancellation Notice</h2>
      <p style="font-size: 14px; color: #475569; text-align: center; margin: 0 0 24px 0;">
        Dear <strong>${booking.customerName}</strong>, your reservation for ${booking.roomName} has been cancelled.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 20px;">
        <div>• <strong>Booking ID:</strong> ${booking.invoiceNumber || booking.bookingId}</div>
        <div>• <strong>Dates:</strong> ${booking.checkIn} to ${booking.checkOut}</div>
        <div>• <strong>Cancellation Reason:</strong> ${reason || 'Per customer request / policy'}</div>
      </div>

      <p style="font-size: 13px; color: #64748B;">
        For any assistance, please contact our front desk at +91 7812027551 or email reservations@coastalviewmandarmani.com.
      </p>
    `
  });

  const text = `Booking Cancellation - Coastal View Mandarmani
Booking ID: ${booking.invoiceNumber || booking.bookingId}
Guest: ${booking.customerName}
Room: ${booking.roomName}
Dates: ${booking.checkIn} to ${booking.checkOut}
Reason: ${reason || 'Customer request'}`;

  return { subject, html, text };
}

// 7. Template: Admin New Booking Alert
function templateAdminNewBookingAlert({ booking, invoiceNumber }) {
  const subject = `[NEW BOOKING ALERT] ${booking.roomName} - ${booking.customerName} (₹${booking.totalPrice})`;
  const preview = `New reservation received from ${booking.customerName}`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #073B4C;">🔔 New Booking Received</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        A new guest booking has been confirmed on the Coastal View website:
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; font-size: 14px; margin-bottom: 22px;">
        <div style="margin-bottom: 6px;">• <strong>Invoice / Booking:</strong> ${invoiceNumber || booking.bookingId}</div>
        <div style="margin-bottom: 6px;">• <strong>Guest Name:</strong> ${booking.customerName}</div>
        <div style="margin-bottom: 6px;">• <strong>Phone:</strong> ${booking.customerPhone}</div>
        <div style="margin-bottom: 6px;">• <strong>Email:</strong> ${booking.customerEmail}</div>
        <div style="margin-bottom: 6px;">• <strong>Room:</strong> ${booking.roomName}</div>
        <div style="margin-bottom: 6px;">• <strong>Stay:</strong> ${booking.checkIn} to ${booking.checkOut} (${booking.nights || 1} Night(s))</div>
        <div style="margin-bottom: 6px;">• <strong>Total Price:</strong> ₹${(booking.totalPrice || 0).toLocaleString('en-IN')}</div>
        <div>• <strong>Advance:</strong> ₹${(booking.advancePaid || 0).toLocaleString('en-IN')} (Balance: ₹${(booking.balanceDue || 0).toLocaleString('en-IN')})</div>
      </div>
    `
  });

  const text = `New Booking Received:
Booking ID: ${invoiceNumber || booking.bookingId}
Guest: ${booking.customerName} (${booking.customerPhone}, ${booking.customerEmail})
Room: ${booking.roomName}
Stay: ${booking.checkIn} to ${booking.checkOut}
Total: ₹${booking.totalPrice}`;

  return { subject, html, text };
}

// 8. Template: Test Email
function templateTestEmail({ recipient, timeStr }) {
  const subject = "Coastal View SMTP Integration Test";
  const preview = "Your SMTP email sending is successfully configured and active";

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="background: #E6FBF8; color: #06B6B0; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
          SMTP Test Passed
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 22px; color: #073B4C; text-align: center;">Email Service Connected!</h2>
      <p style="font-size: 14px; color: #475569; text-align: center; margin: 0 0 24px 0;">
        This test message verifies that your SMTP mail server configuration is fully operational.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; font-size: 13px; color: #334155; margin-bottom: 22px;">
        <div style="margin-bottom: 6px;">• <strong>Recipient:</strong> ${recipient}</div>
        <div style="margin-bottom: 6px;">• <strong>Server Time:</strong> ${timeStr || getISTTimestamp()}</div>
        <div style="margin-bottom: 6px;">• <strong>Status:</strong> Active & Delivering</div>
        <div>• <strong>Protocol:</strong> Nodemailer STARTTLS / SSL</div>
      </div>
    `
  });

  const text = `Coastal View SMTP Test Email
This verifies that your SMTP mail server is operational.
Recipient: ${recipient}
Time: ${timeStr || getISTTimestamp()}`;

  return { subject, html, text };
}

// 9. Template: Lockout Alert
function templateLockoutAlert({ username, ip, timeStr }) {
  const subject = `[SECURITY LOCKOUT] 5 Failed Login Attempts for "${username}"`;
  const preview = `Brute-force lockout triggered for ${username} from IP ${ip}`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="background: #FEF2F2; color: #EF4444; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
          Brute-Force Lockout Active
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #073B4C;">Repeated Failed Login Attempts Detected</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        5 consecutive failed login attempts were recorded for account <strong>${username}</strong>. The account has been placed into a <strong>15-minute temporary lockout</strong> to protect against brute-force attacks.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div>• <strong>Target Account:</strong> ${username}</div>
        <div>• <strong>Origin IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Lockout Timestamp:</strong> ${timeStr || getISTTimestamp()}</div>
        <div>• <strong>Lockout Duration:</strong> 15 Minutes</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn't you, review your account security and verify server audit logs immediately.
      </div>
    `
  });

  const text = `Security Lockout Alert - Coastal View
5 consecutive failed logins detected for "${username}".
IP: ${ip}
Time: ${timeStr || getISTTimestamp()}
Lockout duration: 15 minutes.`;

  return { subject, html, text };
}

// 10. Template: Staff Invitation (Prompt 4)
function templateStaffInvitation({ inviteeName, inviterName, roleName, acceptUrl }) {
  const subject = "You're invited to the Coastal View admin panel";
  const preview = `You have been invited to join the Coastal View admin panel as ${roleName}.`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <p style="font-size: 15px; color: #1E293B; margin: 0 0 16px 0;">Hello <strong>${inviteeName || 'Team Member'}</strong>,</p>
      <p style="font-size: 14px; color: #334155; margin: 0 0 20px 0; line-height: 1.6;">
        <strong>${inviterName || 'The Super Admin'}</strong> invited you to join the Coastal View admin panel as <strong>${roleName}</strong>.
      </p>

      <div style="text-align: center; margin: 30px 0 32px 0;">
        <a href="${acceptUrl}" style="background: linear-gradient(135deg, #D4AF37 0%, #AA7C11 100%); color: #073B4C; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; display: inline-block; box-shadow: 0 4px 14px rgba(212, 175, 55, 0.35); letter-spacing: 0.5px;">
          Accept invitation
        </a>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 12.5px; color: #475569; margin-bottom: 22px; line-height: 1.6;">
        <div>⏱️ <strong>Validity:</strong> This link expires in 24 hours and can be used once.</div>
        <div style="margin-top: 6px;">🔐 <strong>Security:</strong> After you set your password, you'll also set up a verification app for extra security.</div>
      </div>

      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">
        If you weren't expecting this, you can safely ignore this email.
      </p>
    `
  });

  const text = `You're invited to the Coastal View admin panel

Hello ${inviteeName || 'Team Member'},
${inviterName || 'The Super Admin'} invited you to join the Coastal View admin panel as ${roleName}.

Accept your invitation here:
${acceptUrl}

This link expires in 24 hours and can be used once. After you set your password, you'll also set up a verification app for extra security. If you weren't expecting this, ignore this email.

Coastal View, Managed By Ani's
Mandarmani Beach Road, East Midnapore, West Bengal - 721455
This is an automated message.`;

  return { subject, html, text };
}

// 11. Template: Staff Invite Accepted Notification to Super Admin (Prompt 4)
function templateStaffInviteAcceptedAlert({ superAdminName, staffName, staffEmail, roleName, timeStr }) {
  const subject = `[Staff Accepted] ${staffName} accepted invitation (${roleName})`;
  const preview = `${staffName} has activated their staff account and completed security setup.`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="text-align: center; margin-bottom: 20px;">
        <span style="background: #E6FBF8; color: #06B6B0; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
          Staff Account Active
        </span>
      </div>

      <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #073B4C;">Staff Member Onboarded</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        Hello <strong>${superAdminName || 'Super Admin'}</strong>, <strong>${staffName}</strong> has accepted the invitation and successfully set up their password and two-factor authentication.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 20px;">
        <div style="margin-bottom: 6px;">• <strong>Staff Name:</strong> ${staffName}</div>
        <div style="margin-bottom: 6px;">• <strong>Email:</strong> ${staffEmail}</div>
        <div style="margin-bottom: 6px;">• <strong>Assigned Role:</strong> ${roleName}</div>
        <div>• <strong>Activated At:</strong> ${timeStr || getISTTimestamp()}</div>
      </div>
    `
  });

  const text = `Staff Member Onboarded - Coastal View

${staffName} accepted the invitation.
Email: ${staffEmail}
Role: ${roleName}
Time: ${timeStr || getISTTimestamp()}

Coastal View Automated Notification`;

  return { subject, html, text };
}

// 12. Template: Staff Security Alert (Prompt 5)
function templateStaffSecurityAlert({ staffName, actionDescription, timeStr }) {
  const subject = `[Security Alert] Important change to your Coastal View account`;
  const preview = `A security action was performed on your staff account.`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #073B4C;">Security Notification</h2>
      <p style="font-size: 14px; color: #334155; margin: 0 0 16px 0;">Hello <strong>${staffName || 'Staff Member'}</strong>,</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        This alert is to inform you that a security action was performed on your Coastal View staff account:
      </p>

      <div style="background: #F8FAFC; border-left: 4px solid #06B6B0; padding: 16px; border-radius: 6px; font-size: 13.5px; color: #073B4C; margin-bottom: 20px;">
        <strong>${actionDescription}</strong>
        <div style="font-size: 11.5px; color: #64748B; margin-top: 6px;">Timestamp: ${timeStr || getISTTimestamp()}</div>
      </div>

      <p style="font-size: 12.5px; color: #64748B; margin: 0;">
        If you did not authorize or expect this change, please contact the Super Admin or management immediately.
      </p>
    `
  });

  const text = `Coastal View Account Security Alert
Hello ${staffName || 'Staff Member'},
A security action was performed on your staff account:
${actionDescription}
Time: ${timeStr || getISTTimestamp()}
If you did not authorize this, contact the Super Admin immediately.`;

  return { subject, html, text };
}

// 13. Template: Email Change Verification Link (Prompt 5)
function templateEmailChangeVerification({ staffName, confirmUrl, timeStr }) {
  const subject = "Verify your new email address for Coastal View";
  const preview = "Confirm your new email address to complete your staff profile update.";

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 10px 0; font-size: 20px; color: #073B4C;">Confirm Email Update</h2>
      <p style="font-size: 14px; color: #334155; margin: 0 0 16px 0;">Hello <strong>${staffName || 'Staff Member'}</strong>,</p>
      <p style="font-size: 14px; color: #475569; margin: 0 0 24px 0;">
        We received a request to update your login email address on the Coastal View admin panel. Click below to verify and activate this email address:
      </p>

      <div style="text-align: center; margin: 26px 0 30px 0;">
        <a href="${confirmUrl}" style="background: #06B6B0; color: #FFFFFF; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; display: inline-block;">
          Confirm New Email Address
        </a>
      </div>

      <p style="font-size: 12px; color: #94A3B8; margin: 0;">
        This confirmation link expires in 2 hours. If you did not request this update, no action is needed.
      </p>
    `
  });

  const text = `Confirm Email Update - Coastal View
Hello ${staffName || 'Staff Member'},
Confirm your new email address:
${confirmUrl}
Link expires in 2 hours.`;

  return { subject, html, text };
}

// 14. Template: Email Settings Changed Notification
function templateEmailSettingsChanged({ timeStr, device, ip }) {
  const subject = "Security Alert: Coastal View Email Settings Were Changed";
  const preview = "Your hotel email settings were updated. Verify this activity.";

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <div style="background: rgba(244, 63, 94, 0.08); border-left: 4px solid #F43F5E; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px;">
        <strong style="color: #9F1239; font-size: 15px;">Email Settings Changed</strong>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #4C0519;">
          Email settings were changed on <strong>${timeStr || getISTTimestamp()}</strong> from <strong>${device || 'Unknown Device'}</strong> (IP: <code>${ip || 'Unknown'}</code>).
        </p>
      </div>

      <p style="font-size: 14px; color: #334155; margin: 0 0 16px 0;">
        If this was you, no action is needed. If this wasn't you, sign in to your admin panel immediately and update your credentials or revoke access.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #64748B;">
        • Time: ${timeStr || getISTTimestamp()}<br>
        • IP Address: ${ip || 'Unknown'}<br>
        • Device / Client: ${device || 'Web Browser'}
      </div>
    `
  });

  const text = `Security Alert: Email Settings Changed - Coastal View
Email settings were changed on ${timeStr || getISTTimestamp()} from ${device || 'Unknown Device'} (IP: ${ip || 'Unknown'}).
If this wasn't you, act now. Sign in and secure your account immediately.`;

  return { subject, html, text };
}

module.exports = {
  maskEmail,
  getISTTimestamp,
  getSafeErrorMessage,
  getSmtpConfig,
  createTransporter,
  recordMailLog,
  sendMail,
  sendMailWithRetry,
  verifySmtpConnection,
  getEmailStats,
  // Templates
  templateLoginCode,
  templateNewDeviceLogin,
  templatePasswordChanged,
  templatePasswordReset,
  templateBookingConfirmation,
  templateBookingCancellation,
  templateAdminNewBookingAlert,
  templateTestEmail,
  templateLockoutAlert,
  templateStaffInvitation,
  templateStaffInviteAcceptedAlert,
  templateStaffSecurityAlert,
  templateEmailChangeVerification,
  templateEmailSettingsChanged
};



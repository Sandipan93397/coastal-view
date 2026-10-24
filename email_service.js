/**
 * Coastal View Mandarmani - Free SMTP Email Service
 * Handles Nodemailer transport, automatic retries, timeouts,
 * daily quota tracking, mail logging (masked recipients, no bodies/codes),
 * and branded responsive HTML + text templates.
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Mask recipient email address: e.g. "sandipanmajumder9339@gmail.com" -> "s***9@gmail.com"
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

// Get configured SMTP parameters
function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const mailFrom = (process.env.MAIL_FROM || process.env.SMTP_FROM || '').trim();
  const mailFromName = (process.env.MAIL_FROM_NAME || "Coastal View Mandarmani").trim();
  const dailyLimit = parseInt(process.env.SMTP_DAILY_LIMIT, 10) || 300; // Brevo free tier default: 300/day

  // Port 587 uses STARTTLS (secure: false), Port 465 uses SSL/TLS (secure: true)
  const secure = port === 465;

  const isConfigured = Boolean(host && user && pass);

  return {
    host,
    port,
    secure,
    user,
    pass,
    mailFrom: mailFrom || user || 'reservations@coastalviewmandarmani.com',
    mailFromName,
    dailyLimit,
    isConfigured
  };
}

let cachedTransporter = null;
let lastTransporterConfigKey = '';
let lastKnownStatus = 'not_configured'; // 'connected' | 'failing' | 'not_configured'
let lastSmtpError = null;

function createTransporter() {
  const config = getSmtpConfig();
  if (!config.isConfigured) {
    cachedTransporter = null;
    lastKnownStatus = 'not_configured';
    return null;
  }

  const configKey = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (cachedTransporter && lastTransporterConfigKey === configKey) {
    return cachedTransporter;
  }

  try {
    cachedTransporter = nodemailer.createTransport({
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

    lastTransporterConfigKey = configKey;
    return cachedTransporter;
  } catch (err) {
    console.error('[SMTP Engine] Transporter creation error:', err.message);
    lastKnownStatus = 'failing';
    lastSmtpError = err.message;
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
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.warn('[SMTP Engine] Failed to record mail log:', err.message);
  }
}

/**
 * Core sendMail function:
 * - 1 automatic retry on transient failure
 * - Catches all errors so caller flow NEVER crashes
 * - Masks recipients in mail log
 * - Never stores codes or bodies
 */
async function sendMailWithRetry({ db, type, to, subject, html, text, attachments = [] }) {
  const config = getSmtpConfig();
  const fromHeader = `"${config.mailFromName}" <${config.mailFrom}>`;

  if (!config.isConfigured) {
    lastKnownStatus = 'not_configured';
    recordMailLog(db, {
      type,
      recipient: to,
      status: 'Failed',
      errorCode: 'SMTP_NOT_CONFIGURED'
    });
    return {
      success: false,
      errorCode: 'SMTP_NOT_CONFIGURED',
      error: 'SMTP credentials are not configured in environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS).'
    };
  }

  const transporter = createTransporter();
  if (!transporter) {
    lastKnownStatus = 'failing';
    recordMailLog(db, {
      type,
      recipient: to,
      status: 'Failed',
      errorCode: 'TRANSPORTER_INIT_ERROR'
    });
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
    recordMailLog(db, {
      type,
      recipient: to,
      status: 'Success'
    });
    return { success: true, messageId: info.messageId };
  } catch (err1) {
    console.warn(`[SMTP Engine] Attempt 1 failed for "${type}" to ${maskEmail(to)}:`, err1.message);

    // One automatic retry after 1.5 seconds delay
    await new Promise(r => setTimeout(r, 1500));

    try {
      const info = await transporter.sendMail(mailOptions);
      lastKnownStatus = 'connected';
      lastSmtpError = null;
      recordMailLog(db, {
        type,
        recipient: to,
        status: 'Success'
      });
      return { success: true, messageId: info.messageId, retried: true };
    } catch (err2) {
      console.error(`[SMTP Engine] Attempt 2 (retry) also failed for "${type}":`, err2.message);
      lastKnownStatus = 'failing';
      lastSmtpError = err2.message;

      recordMailLog(db, {
        type,
        recipient: to,
        status: 'Failed',
        errorCode: err2.code || 'SEND_FAILURE'
      });

      return {
        success: false,
        errorCode: err2.code || 'SEND_FAILURE',
        error: err2.message
      };
    }
  }
}

// Verify live SMTP connection & TLS handshake
async function verifySmtpConnection() {
  const config = getSmtpConfig();
  if (!config.isConfigured) {
    lastKnownStatus = 'not_configured';
    return {
      connected: false,
      status: 'not_configured',
      message: 'SMTP is not configured in .env (SMTP_HOST, SMTP_USER, SMTP_PASS are required).'
    };
  }

  const transporter = createTransporter();
  if (!transporter) {
    lastKnownStatus = 'failing';
    return {
      connected: false,
      status: 'failing',
      message: 'Could not create SMTP transport.'
    };
  }

  try {
    await transporter.verify();
    lastKnownStatus = 'connected';
    lastSmtpError = null;
    return {
      connected: true,
      status: 'connected',
      message: `Successfully connected to ${config.host}:${config.port} via ${config.secure ? 'SSL/TLS' : 'STARTTLS'}.`
    };
  } catch (err) {
    lastKnownStatus = 'failing';
    lastSmtpError = err.message;
    return {
      connected: false,
      status: 'failing',
      errorCode: err.code || 'VERIFY_FAILED',
      message: err.message
    };
  }
}

// Get email statistics & daily quota usage
function getEmailStats(db) {
  const config = getSmtpConfig();
  const today = new Date().toISOString().split('T')[0];
  const todayStats = (db.emailDailyStats && db.emailDailyStats[today]) || { total: 0, success: 0, failed: 0 };
  const dailyLimit = config.dailyLimit;
  const todayCount = todayStats.success;
  const percentUsed = Math.min(100, Math.round((todayCount / dailyLimit) * 100));
  const isNearLimit = percentUsed >= 80;
  const isLimitReached = todayCount >= dailyLimit;

  return {
    status: lastKnownStatus,
    host: config.host || 'Not Configured',
    port: config.port,
    secure: config.secure,
    senderEmail: config.mailFrom,
    senderName: config.mailFromName,
    isConfigured: config.isConfigured,
    todayCount,
    todayFailed: todayStats.failed,
    dailyLimit,
    percentUsed,
    isNearLimit,
    isLimitReached,
    lastError: lastSmtpError,
    recentLogs: (db.mailLogs || []).slice(0, 25)
  };
}

// ============================================================================
// BRANDED EMAIL TEMPLATES (HTML & Plain Text)
// Brand Colors: Navy #073B4C, Gold #E8C77B, Seafoam #06B6B0, Slate #1E293B
// ============================================================================

function baseEmailWrapper({ title, previewText, contentHtml }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B; line-height: 1.6;">
  <div style="display: none; font-size: 1px; color: #F8FAFC; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${previewText || title}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1.5px solid #E8C77B; box-shadow: 0 10px 30px rgba(7, 59, 76, 0.08);">
    <!-- Header -->
    <tr>
      <td style="background: #073B4C; padding: 28px 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 26px; font-family: Georgia, serif; letter-spacing: 1.5px; color: #FFFFFF; font-weight: 700;">Coastal View</h1>
        <div style="font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; color: #E8C77B; margin-top: 6px; font-weight: 600;">Managed By Ani's • Mandarmani Beach</div>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 32px 28px;">
        ${contentHtml}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background: #F1F5F9; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748B; border-top: 1px solid #E2E8F0;">
        <div style="font-weight: 600; color: #073B4C; margin-bottom: 4px;">Coastal View Mandarmani</div>
        <div>Mandarmani Beach Road, East Midnapore, West Bengal - 721455</div>
        <div style="margin-top: 6px; color: #94A3B8;">This is an automated operational notification. Please do not reply directly.</div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// 1. Template: 2FA Login Verification Code
function templateLoginCode({ code, ip, device, timeStr }) {
  const subject = "Your Coastal View admin login code";
  const preview = `Your single-use 6-digit login verification code is ${code}`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #073B4C;">Security Verification Code</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        A sign-in attempt was initiated for your Coastal View administrator account. Enter this 6-digit code to complete authentication:
      </p>

      <div style="background: #FAF6EE; border: 2px solid #E8C77B; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
        <div style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #073B4C; font-family: 'Courier New', monospace;">
          ${code}
        </div>
        <div style="font-size: 12px; color: #06B6B0; font-weight: 600; margin-top: 8px;">
          ⏱ Expires in 10 minutes • Single-use only
        </div>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #334155; margin-bottom: 22px;">
        <div style="font-weight: 600; color: #073B4C; margin-bottom: 6px;">Sign-In Details:</div>
        <div>• <strong>Time:</strong> ${timeStr || getISTTimestamp()}</div>
        <div>• <strong>IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Device:</strong> ${device || 'Web Browser'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn't you, change your password now.
      </div>
    `
  });

  const text = `Coastal View Admin Verification Code: ${code}
Expires in 10 minutes. Single-use only.
Time: ${timeStr || getISTTimestamp()}
IP Address: ${ip || '127.0.0.1'}
Device: ${device || 'Web Browser'}

If this wasn't you, change your password now.`;

  return { subject, html, text };
}

// 2. Template: New-Device Login Alert
function templateNewDeviceLogin({ username, ip, device, timeStr }) {
  const subject = "Security Alert: New device login on Coastal View";
  const preview = `A new device logged into account ${username}`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #073B4C;">Security Alert: New Device Sign-In</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        Your Coastal View account (<strong>${username}</strong>) was just accessed from a new device or IP address:
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div style="margin-bottom: 6px;">• <strong>Account:</strong> ${username}</div>
        <div style="margin-bottom: 6px;">• <strong>Time:</strong> ${timeStr || getISTTimestamp()}</div>
        <div style="margin-bottom: 6px;">• <strong>IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Device:</strong> ${device || 'Unknown Device'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn't you, change your password now.
      </div>
    `
  });

  const text = `Security Alert: New device login on Coastal View
Account: ${username}
Time: ${timeStr || getISTTimestamp()}
IP: ${ip}
Device: ${device}

If this wasn't you, change your password now.`;

  return { subject, html, text };
}

// 3. Template: Password Changed Alert
function templatePasswordChanged({ username, ip, device, timeStr }) {
  const subject = "Security Alert: Your Coastal View password was changed";
  const preview = `The password for ${username} was successfully changed`;

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #073B4C;">Password Successfully Changed</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        The password for your Coastal View account (<strong>${username}</strong>) was changed. All other active sessions have been terminated.
      </p>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div style="margin-bottom: 6px;">• <strong>Time:</strong> ${timeStr || getISTTimestamp()}</div>
        <div style="margin-bottom: 6px;">• <strong>IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Device:</strong> ${device || 'Web Browser'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn't you, change your password now.
      </div>
    `
  });

  const text = `Security Alert: Your Coastal View password was changed
Account: ${username}
Time: ${timeStr || getISTTimestamp()}
IP: ${ip}
Device: ${device}

If this wasn't you, change your password now.`;

  return { subject, html, text };
}

// 4. Template: Password Reset Request
function templatePasswordReset({ resetUrl, resetToken, ip, device, timeStr }) {
  const subject = "Coastal View Admin: Password Reset Request";
  const preview = "Single-use 30-minute password reset link";

  const html = baseEmailWrapper({
    title: subject,
    previewText: preview,
    contentHtml: `
      <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #073B4C;">Password Reset Request</h2>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px 0;">
        We received a request to reset the password for your Coastal View administrator account. This link expires in <strong>30 minutes</strong> and can only be used once.
      </p>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="background: #D4AF37; background: linear-gradient(135deg, #E8C77B 0%, #D4AF37 100%); color: #073B4C; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(212, 175, 55, 0.35);">
          Reset Admin Password
        </a>
      </div>

      <div style="background: #FAF6EE; border: 1px dashed #E8C77B; border-radius: 8px; padding: 12px; font-size: 12px; color: #475569; word-break: break-all; margin-bottom: 22px;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #073B4C;">${resetUrl}</a>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #334155; margin-bottom: 22px;">
        <div>• <strong>Request Time:</strong> ${timeStr || getISTTimestamp()}</div>
        <div>• <strong>IP Address:</strong> ${ip || '127.0.0.1'}</div>
        <div>• <strong>Device:</strong> ${device || 'Web Browser'}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn't you, change your password now.
      </div>
    `
  });

  const text = `Coastal View Admin: Password Reset Request
Reset Link (Expires in 30 minutes, single use): ${resetUrl}
Token: ${resetToken}
Time: ${timeStr || getISTTimestamp()}
IP: ${ip}

If this wasn't you, change your password now.`;

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
        • Check-in time: <strong>${hotelSettings?.checkInTime || '12:00 PM'}</strong> • Check-out time: <strong>${hotelSettings?.checkOutTime || '11:00 AM'}</strong><br>
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

module.exports = {
  maskEmail,
  getISTTimestamp,
  getSmtpConfig,
  createTransporter,
  recordMailLog,
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
  templateLockoutAlert
};

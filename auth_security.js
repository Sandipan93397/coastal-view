/**
 * Coastal View Mandarmani - Security & Authentication Engine
 * Argon2 password hashing, 6-digit email 2FA codes, rate limiting,
 * lockout, TOTP, session validation, audit trail, and alerts.
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { z } = require('zod');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const BACKUPS_DIR = path.join(__dirname, 'data', 'backups');
const SESSION_SECRET = process.env.SESSION_SECRET || 'coastal-view-super-secure-session-key-2026';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15-minute idle logout
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10-minute 2FA code expiry
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15-minute brute-force lockout
const SENSITIVE_REAUTH_WINDOW_MS = 5 * 60 * 1000; // 5-minute elevated action window

// Ensure backups directory exists
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// In-Memory State
const activeSessions = new Map(); // token -> session
const failedAttempts = new Map(); // key (username or IP) -> { count, lockedUntil }
const preAuthStore = new Map(); // preAuthToken -> preAuthData
const codeRequestLimiter = new Map(); // key -> timestamps array (for 3 requests per 10 mins)
const captchaStore = new Map(); // captchaId -> { answer, expiresAt }
const undoStore = new Map(); // undoToken -> { slotId, roomId, previousUrl, expiresAt }

// Common weak password dictionary
const COMMON_PASSWORDS = new Set([
  'password', 'password123', 'password1234', '123456789012', 'admin1234567',
  'coastalview123', 'coastalview@2026', 'administrator1', 'qwertyuiop12',
  'welcome123456', 'superadmin123', 'mandarmani2026', 'letmein123456',
  'iloveyou12345', 'changeme12345', 'sunshine12345', 'trustnoone123',
  'master123456', 'football1234', 'dragon123456', 'monkey123456',
  'shadow123456', 'secret123456', 'testing12345', 'hoteladmin123',
  'resortadmin123', 'beachresort123', 'anisresort123', 'coastaladmin'
]);

// SMTP Transporter
let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } catch (e) {
      console.warn('SMTP transporter init warning:', e.message);
    }
  }
  return mailTransporter;
}

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of activeSessions.entries()) {
    if (now - s.lastActive > IDLE_TIMEOUT_MS) activeSessions.delete(token);
  }
  for (const [cid, c] of captchaStore.entries()) {
    if (now > c.expiresAt) captchaStore.delete(cid);
  }
  for (const [pId, p] of preAuthStore.entries()) {
    if (now > p.expiresAt) preAuthStore.delete(pId);
  }
  for (const [uId, u] of undoStore.entries()) {
    if (now > u.expiresAt) undoStore.delete(uId);
  }
}, 60000);

// --- PASSWORD HASHING & VERIFICATION (ARGON2ID) ---
async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

async function verifyPassword(plainPassword, storedHash, user, db) {
  if (!storedHash || !plainPassword) return false;
  let isMatch = false;

  if (storedHash.startsWith('$argon2')) {
    try {
      isMatch = await argon2.verify(storedHash, plainPassword);
    } catch (e) {
      isMatch = false;
    }
  } else if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    try {
      isMatch = bcrypt.compareSync(plainPassword, storedHash);
      if (isMatch && user && db) {
        // Transparent auto-upgrade to Argon2id
        user.passwordHash = await hashPassword(plainPassword);
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
      }
    } catch (e) {
      isMatch = false;
    }
  } else {
    // Plaintext fallback for legacy entries; upgrade immediately
    isMatch = (storedHash === plainPassword);
    if (isMatch && user && db) {
      user.passwordHash = await hashPassword(plainPassword);
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
    }
  }
  return isMatch;
}

function validatePasswordPolicy(password) {
  const issues = [];
  if (!password || password.length < 12) {
    issues.push('Password must be at least 12 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('Must contain at least one uppercase letter (A-Z)');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('Must contain at least one lowercase letter (a-z)');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('Must contain at least one number (0-9)');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    issues.push('Must contain at least one symbol (!@#$%^&*...)');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    issues.push('Password is in the common-passwords list and is too easily guessed');
  }
  return { isValid: issues.length === 0, issues };
}

// --- RATE LIMITING & BRUTE-FORCE LOCKOUT ---
function checkLockout(identifier, ip) {
  const now = Date.now();
  if (identifier) {
    const record = failedAttempts.get(identifier.toLowerCase());
    if (record && record.lockedUntil && now < record.lockedUntil) {
      const remainingMins = Math.ceil((record.lockedUntil - now) / 60000);
      return {
        isLocked: true,
        remainingMinutes: remainingMins,
        message: `Account is temporarily locked due to 5 consecutive failed attempts. Please retry in ${remainingMins} minute(s).`
      };
    }
  }

  if (ip) {
    const ipRecord = failedAttempts.get('ip_' + ip);
    if (ipRecord && ipRecord.lockedUntil && now < ipRecord.lockedUntil) {
      const remainingMins = Math.ceil((ipRecord.lockedUntil - now) / 60000);
      return {
        isLocked: true,
        remainingMinutes: remainingMins,
        message: `Too many failed attempts from this IP address. Please retry in ${remainingMins} minute(s).`
      };
    }
  }

  return { isLocked: false };
}

function recordFailedAttempt(identifier, ip) {
  const now = Date.now();
  let maxCount = 0;

  if (identifier) {
    const k = identifier.toLowerCase();
    const cur = failedAttempts.get(k) || { count: 0, lockedUntil: null };
    cur.count += 1;
    if (cur.count >= 5) {
      cur.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    failedAttempts.set(k, cur);
    if (cur.count > maxCount) maxCount = cur.count;
  }

  if (ip) {
    const ipKey = 'ip_' + ip;
    const cur = failedAttempts.get(ipKey) || { count: 0, lockedUntil: null };
    cur.count += 1;
    if (cur.count >= 20) {
      cur.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    failedAttempts.set(ipKey, cur);
  }

  return maxCount;
}

function resetFailedAttempts(identifier, ip) {
  if (identifier) failedAttempts.delete(identifier.toLowerCase());
  if (ip) failedAttempts.delete('ip_' + ip);
}

// --- CAPTCHA (CLOUDFLARE TURNSTILE & SMART POLICY) ---
function getFailedAttemptsCount(identifier, ip) {
  let count = 0;
  if (identifier) {
    const rec = failedAttempts.get(identifier.toLowerCase());
    if (rec && rec.count > count) count = rec.count;
  }
  if (ip) {
    const ipKey = 'ip_' + ip;
    const rec = failedAttempts.get(ipKey);
    if (rec && rec.count > count) count = rec.count;
  }
  return count;
}

function isCaptchaRequired(identifier, ip, policy = 'smart') {
  if (policy === 'always') return true;
  // Smart mode: show CAPTCHA only after 2 failed attempts for this account or when IP is rate-limited
  let userCount = 0;
  if (identifier) {
    const rec = failedAttempts.get(identifier.toLowerCase());
    if (rec) userCount = rec.count;
  }

  let ipCount = 0;
  let ipLocked = false;
  if (ip) {
    const ipRec = failedAttempts.get('ip_' + ip);
    if (ipRec) {
      ipCount = ipRec.count;
      if (ipRec.lockedUntil && Date.now() < ipRec.lockedUntil) ipLocked = true;
    }
  }

  return userCount >= 2 || ipCount >= 10 || ipLocked;
}

async function verifyTurnstileToken({ token, remoteIp, isProduction = false }) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY || process.env.CF_TURNSTILE_SECRET_KEY ||
    (!isProduction ? '1x0000000000000000000000000000000AA' : '');

  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      code: 'MISSING_TOKEN',
      message: 'Please complete the security check'
    };
  }

  // In production, never skip or accept empty/dummy keys silently
  if (isProduction && !secretKey) {
    console.error('[SECURITY AUDIT] Cloudflare Turnstile secret key (TURNSTILE_SECRET_KEY) is missing in production environment!');
    return {
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Security check unavailable, please try again or contact the administrator'
    };
  }

    // Explicit test token support in non-production development environments (e.g. CI / automated security suites)
    if (!isProduction && token.startsWith('XXXX.test')) {
      return { success: true };
    }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token.trim());
    if (remoteIp) formData.append('remoteip', remoteIp);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    const cfData = await cfRes.json();
    if (cfData.success) {
      return { success: true };
    }

    const errorCodes = cfData['error-codes'] || [];
    if (errorCodes.includes('timeout-or-duplicate')) {
      return {
        success: false,
        code: 'EXPIRED_TOKEN',
        message: 'Security check expired, try again'
      };
    }

    return {
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Security check failed. Please try again.'
    };
  } catch (err) {
    console.error('Turnstile verification request issue:', err.message);

    // Development fallback for localhost test tokens if network is offline
    if (!isProduction && secretKey === '1x0000000000000000000000000000000AA') {
      if (token.startsWith('XXXX.') || token.includes('test') || token.length > 10) {
        return { success: true };
      }
    }

    if (isProduction) {
      console.error('[SECURITY AUDIT] Cloudflare Turnstile service is unreachable in production:', err.message);
      return {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Security check unavailable, please try again or contact the administrator'
      };
    }

    return {
      success: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Security check unavailable, please try again or contact the administrator'
    };
  }
}

function getCaptchaConfig(req, db) {
  const isProduction = process.env.NODE_ENV === 'production';
  const rawSiteKey = process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.CF_TURNSTILE_SITE_KEY;
  const siteKey = rawSiteKey || (!isProduction ? '1x00000000000000000000AA' : '');
  const policy = process.env.CAPTCHA_POLICY || db?.settings?.captchaPolicy || 'smart';

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');
  const username = (req.query && req.query.username) ? req.query.username : '';
  const required = isCaptchaRequired(username, clientIp, policy);

  return {
    provider: 'turnstile',
    siteKey,
    policy,
    required,
    isDev: !isProduction,
    isTestKey: !rawSiteKey && !isProduction
  };
}


// --- EMAIL 2FA CODE SYSTEM ---
function hashAuthCode(code) {
  return crypto.createHash('sha256').update(code + SESSION_SECRET).digest('hex');
}

function generateAuthCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function canRequestCode(key) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const requests = codeRequestLimiter.get(key) || [];
  const validRequests = requests.filter(t => now - t < windowMs);

  if (validRequests.length >= 3) {
    const waitSecs = Math.ceil((windowMs - (now - validRequests[0])) / 1000);
    return {
      allowed: false,
      message: `Too many code requests. Please wait ${Math.ceil(waitSecs / 60)} minute(s) before requesting a new code.`
    };
  }

  validRequests.push(now);
  codeRequestLimiter.set(key, validRequests);
  return { allowed: true };
}

// Clean device string from user-agent
function parseDeviceString(userAgent = '') {
  if (!userAgent) return 'Web Browser (Unknown)';
  let browser = 'Browser';
  if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Edg/')) browser = 'Microsoft Edge';
  else if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Safari')) browser = 'Safari';

  let os = 'Desktop';
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) os = 'macOS';
  else if (userAgent.includes('Android')) os = 'Android Mobile';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS Device';
  else if (userAgent.includes('Linux')) os = 'Linux';

  return `${browser} on ${os}`;
}

// Generate luxury branded HTML email for 2FA code
function create2FAEmailHtml(code, clientIp, device, timeStr) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Login Verification Code</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B;">
  <div style="max-width: 540px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1.5px solid #E8C77B; box-shadow: 0 10px 30px rgba(7, 59, 76, 0.1);">
    <div style="background: #073B4C; padding: 28px 24px; text-align: center; color: #FFFFFF;">
      <h1 style="margin: 0; font-size: 24px; font-family: Georgia, serif; letter-spacing: 1px; color: #FFFFFF;">Coastal View</h1>
      <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #E8C77B; margin-top: 4px;">Security & Management Gateway</div>
    </div>

    <div style="padding: 28px 32px;">
      <p style="font-size: 15px; margin-top: 0; color: #073B4C;"><strong>Security Authentication Code</strong></p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        A sign-in attempt was initiated for your Coastal View administrator account. Use the single-use 6-digit code below to complete your authentication:
      </p>

      <div style="background: #FAF6EE; border: 2px solid #E8C77B; border-radius: 12px; padding: 18px; margin: 24px 0; text-align: center;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #073B4C; font-family: 'Courier New', monospace; display: inline-block;">
          ${code}
        </span>
        <div style="font-size: 12px; color: #06B6B0; font-weight: 600; margin-top: 6px;">
          ⏱ Expires in 10 minutes • Single-use only
        </div>
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #334155; margin-bottom: 24px;">
        <div style="margin-bottom: 6px;"><strong>Request Details:</strong></div>
        <div>• <strong>Time:</strong> ${timeStr}</div>
        <div>• <strong>IP Address:</strong> ${clientIp}</div>
        <div>• <strong>Device:</strong> ${device}</div>
      </div>

      <div style="background: #FEF2F2; border-left: 4px solid #FF6B5E; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #991B1B; font-weight: 600;">
        ⚠️ If this wasn’t you, change your password now.
      </div>
    </div>

    <div style="background: #F1F5F9; padding: 14px 24px; text-align: center; font-size: 11px; color: #64748B;">
      Coastal View Mandarmani • Mandarmani Beach Road, West Bengal • Automated Security System
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Deliver 2FA code via SMTP (or log to test outbox if test mode)
async function sendAuthCodeEmail({ to, code, ip, device, db }) {
  const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const html = create2FAEmailHtml(code, ip, device, timeStr);
  const subject = `Your Coastal View Admin Login Code: ${code}`;
  const sender = process.env.SMTP_FROM || '"Coastal View Security" <reservations@coastalviewmandarmani.com>';

  // Always record in database outbox for auditing
  if (db) {
    db.emailOutbox = db.emailOutbox || [];
    db.emailOutbox.unshift({
      id: `email-2fa-${Date.now()}`,
      to,
      subject,
      sentAt: new Date().toISOString(),
      ip,
      device,
      status: 'Generated'
    });
    if (db.emailOutbox.length > 500) db.emailOutbox = db.emailOutbox.slice(0, 500);
  }

  console.log(`\n==================================================`);
  console.log(`🔑 [2FA AUTHENTICATION CODE] ${code} (for ${to})`);
  console.log(`==================================================\n`);

  const transporter = getMailTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: sender,
        to,
        subject,
        html
      });
      return { success: true, deliveredVia: 'SMTP' };
    } catch (err) {
      console.error('SMTP 2FA email sending failed:', err.message);
      // In development or test without live SMTP server, check if test mode allows simulated delivery
      if (process.env.NODE_ENV === 'test' || process.env.TEST_MOCK_EMAIL === 'true') {
        return { success: true, deliveredVia: 'Mock' };
      }
      return { success: false, error: err.message };
    }
  } else {
    // In development or test without live SMTP server, deliver to db.emailOutbox
    if (process.env.NODE_ENV !== 'production' || process.env.TEST_MOCK_EMAIL === 'true') {
      return { success: true, deliveredVia: 'DevOutbox' };
    }
    return {
      success: false,
      error: 'SMTP credentials are not configured in environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS).'
    };
  }
}

// --- TOTP AUTHENTICATOR APP & BACKUP CODES (RFC 6238) ---
// Base32 helper functions
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input) {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  const randomBytes = crypto.randomBytes(20);
  return base32Encode(randomBytes);
}

function getTotpCodeAtCounter(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

function verifyTotp(secretBase32, submittedCode) {
  if (!secretBase32 || !submittedCode) return false;
  const cleanCode = submittedCode.trim();
  const timeStep = 30; // seconds
  const currentCounter = Math.floor(Date.now() / 1000 / timeStep);

  // Check counter -1, 0, +1 (allow 30-second drift)
  for (let drift = -1; drift <= 1; drift++) {
    const expected = getTotpCodeAtCounter(secretBase32, currentCounter + drift);
    if (expected === cleanCode) return true;
  }
  return false;
}

function generateBackupCodes() {
  const codes = [];
  const hashed = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8-char hex
    codes.push(raw);
    hashed.push(crypto.createHash('sha256').update(raw).digest('hex'));
  }
  return { codes, hashed };
}

// --- SUPER ADMIN SECURITY ALERTS ---
async function sendSuperAdminAlert(subject, messageHtml, db) {
  const alertEmail = process.env.ADMIN_EMAIL || (db && db.settings && db.settings.email) || ADMIN_EMAIL;
  const fullHtml = `
    <div style="font-family: sans-serif; background: #FFFDF9; border: 2px solid #FF6B5E; border-radius: 12px; padding: 24px; max-width: 600px;">
      <h2 style="color: #073B4C; margin-top: 0;">🚨 Coastal View Security Notification</h2>
      <h3 style="color: #FF6B5E;">${subject}</h3>
      <div style="color: #334155; line-height: 1.6; font-size: 14px;">
        ${messageHtml}
      </div>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;">
      <div style="font-size: 12px; color: #64748B;">
        Timestamp: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST<br>
        This is an automated security alert dispatched to Super Admin (${alertEmail}).
      </div>
    </div>
  `;

  if (db) {
    db.emailOutbox = db.emailOutbox || [];
    db.emailOutbox.unshift({
      id: `alert-${Date.now()}`,
      to: alertEmail,
      subject: `[SECURITY ALERT] ${subject}`,
      sentAt: new Date().toISOString(),
      status: 'Dispatched'
    });
  }

  const transporter = getMailTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Coastal View Security" <reservations@coastalviewmandarmani.com>',
        to: alertEmail,
        subject: `[SECURITY ALERT] ${subject}`,
        html: fullHtml
      });
    } catch (e) {
      console.warn('Super Admin security alert email delivery warning:', e.message);
    }
  }
}

// --- DATABASE BACKUPS & AES-256-GCM ENCRYPTED EXPORT ---
function performDailyBackup() {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    const today = new Date().toISOString().split('T')[0];
    const backupFile = path.join(BACKUPS_DIR, `db-backup-${today}.json`);
    if (!fs.existsSync(backupFile)) {
      fs.copyFileSync(DB_PATH, backupFile);
      console.log(`Daily database backup created: db-backup-${today}.json`);
    }

    // Clean backups older than 14 days
    const files = fs.readdirSync(BACKUPS_DIR);
    const now = Date.now();
    for (const f of files) {
      if (f.startsWith('db-backup-') && f.endsWith('.json')) {
        const filePath = path.join(BACKUPS_DIR, f);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 14 * 24 * 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) {
    console.error('Daily backup routine error:', e.message);
  }
}

function exportEncryptedDatabase(passphrase) {
  const dbRaw = fs.readFileSync(DB_PATH, 'utf8');
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase || SESSION_SECRET, salt, 32);
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(dbRaw, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: Salt (16) + IV (12) + AuthTag (16) + EncryptedData
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

// Export module
module.exports = {
  ADMIN_EMAIL,
  SESSION_SECRET,
  IDLE_TIMEOUT_MS,
  CODE_EXPIRY_MS,
  SENSITIVE_REAUTH_WINDOW_MS,
  activeSessions,
  preAuthStore,
  failedAttempts,
  captchaStore,
  undoStore,
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  checkLockout,
  recordFailedAttempt,
  resetFailedAttempts,
  getFailedAttemptsCount,
  isCaptchaRequired,
  verifyTurnstileToken,
  getCaptchaConfig,
  hashAuthCode,
  generateAuthCode,
  canRequestCode,
  parseDeviceString,
  sendAuthCodeEmail,
  generateTotpSecret,
  verifyTotp,
  generateBackupCodes,
  sendSuperAdminAlert,
  performDailyBackup,
  exportEncryptedDatabase
};

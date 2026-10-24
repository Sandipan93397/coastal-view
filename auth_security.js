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

async function verifyTurnstileToken({ token, remoteIp, isProduction = false, host = '' }) {
  const CF_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  const rawSecretKey = (process.env.TURNSTILE_SECRET_KEY || process.env.CF_TURNSTILE_SECRET_KEY || '').trim();

  let secretKey;
  if (isProduction) {
    // In production, use ONLY real keys
    secretKey = rawSecretKey;
  } else {
    // When NODE_ENV is not production:
    // On localhost, automatically use Cloudflare's official test secret key
    if (isLocalhost || token.startsWith('XXXX.') || token === '1x00000000000000000000AA' || token.includes('test')) {
      secretKey = CF_TEST_SECRET_KEY;
    } else {
      secretKey = rawSecretKey || CF_TEST_SECRET_KEY;
    }
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      code: 'MISSING_TOKEN',
      message: 'Please complete the security check'
    };
  }

  // In production, never skip or accept empty/dummy keys or test tokens
  if (isProduction) {
    if (!secretKey) {
      console.error('[SECURITY AUDIT] Cloudflare Turnstile secret key (TURNSTILE_SECRET_KEY) is missing in production environment!');
      return {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Security check unavailable, please try again or contact the administrator'
      };
    }

    if (token.startsWith('XXXX.') || token.includes('test') || token === '1x00000000000000000000AA') {
      console.error('[SECURITY AUDIT] Test token rejected in production environment!');
      return {
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Security check failed. Please try again.'
      };
    }
  }

  // Explicit test token support in non-production development environments (e.g. CI / automated security suites)
  if (!isProduction && (token.startsWith('XXXX.test') || token === '1x00000000000000000000AA' || token === 'test-turnstile-token')) {
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
    console.error(`[TURNSTILE AUDIT] Turnstile siteverify rejected token: ${errorCodes.join(', ')} (Host: ${host || 'localhost'}, isProduction: ${isProduction})`);

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
    console.error('[TURNSTILE AUDIT] Turnstile verification network issue:', err.message);

    if (isProduction) {
      console.error('[SECURITY AUDIT] Cloudflare Turnstile service is unreachable in production:', err.message);
      return {
        success: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Security check unavailable, please try again or contact the administrator'
      };
    }

    // Development fallback for localhost test tokens if network is offline
    if (!isProduction && secretKey === CF_TEST_SECRET_KEY) {
      if (token.startsWith('XXXX.') || token.includes('test') || token.length > 10) {
        return { success: true };
      }
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
  const rawSiteKey = (process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.CF_TURNSTILE_SITE_KEY || '').trim();
  const host = (req && req.headers && req.headers.host ? req.headers.host : '').split(':')[0].toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';

  // Cloudflare Official Test Site Key (Always Passes)
  const CF_TEST_SITE_KEY = '1x00000000000000000000AA';

  let siteKey;
  let isTestKey = false;

  if (isProduction) {
    // In production, use ONLY real keys
    siteKey = rawSiteKey;
    isTestKey = false;
    if (!siteKey) {
      console.error('[SECURITY AUDIT] Cloudflare Turnstile public site key (TURNSTILE_SITE_KEY) is missing in production!');
    }
  } else {
    // When NODE_ENV is not production:
    // On localhost, automatically use Cloudflare's official test site key so development login always works
    if (isLocalhost) {
      siteKey = CF_TEST_SITE_KEY;
      isTestKey = true;
    } else {
      // Non-production on custom/real domain: use real key if configured, otherwise fallback to test key
      siteKey = rawSiteKey || CF_TEST_SITE_KEY;
      isTestKey = siteKey === CF_TEST_SITE_KEY;
    }
  }

  const policy = process.env.CAPTCHA_POLICY || db?.settings?.captchaPolicy || 'smart';
  const clientIp = (req && req.headers && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1') || '127.0.0.1').replace(/^.*:/, '');
  const username = (req && req.query && req.query.username) ? req.query.username : '';
  const required = isCaptchaRequired(username, clientIp, policy);

  return {
    provider: 'turnstile',
    siteKey,
    policy,
    required,
    isDev: !isProduction,
    isTestKey
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

const {
  sendMailWithRetry,
  templateLoginCode,
  templateLockoutAlert,
  templateNewDeviceLogin,
  templatePasswordChanged,
  templatePasswordReset,
  getISTTimestamp
} = require('./email_service');

// Deliver 2FA code via SMTP (or console in development)
async function sendAuthCodeEmail({ to, code, ip, device, db }) {
  const isProduction = process.env.NODE_ENV === 'production';
  const timeStr = getISTTimestamp();
  const template = templateLoginCode({ code, ip, device, timeStr });

  // Terminal fallback: ONLY on localhost/development when not in production
  if (!isProduction) {
    console.log(`\n==================================================`);
    console.log(`🔑 [DEV 2FA AUTHENTICATION CODE] ${code} (for ${to})`);
    console.log(`==================================================\n`);
  }

  // Attempt real SMTP delivery via email_service
  const sendRes = await sendMailWithRetry({
    db,
    type: 'Login 2FA Code',
    to,
    subject: template.subject,
    html: template.html,
    text: template.text
  });

  if (sendRes.success) {
    return { success: true, deliveredVia: 'SMTP' };
  }

  // In non-production development environments, allow login testing even if SMTP is unconfigured or network is offline
  if (!isProduction) {
    return { success: true, deliveredVia: 'DevConsole', devCode: code };
  }

  // In production, fallback is STRICTLY PROHIBITED
  return {
    success: false,
    error: 'SMTP mail delivery failed. The second verification step cannot be bypassed.'
  };
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

// --- ENCRYPTION AT REST FOR MFA SECRETS (AES-256-GCM) ---
function encryptMfaSecret(plainSecret) {
  if (!plainSecret) return null;
  const rawKey = process.env.MFA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!rawKey) {
    throw new Error('MFA encryption key not configured');
  }
  const key = crypto.createHash('sha256').update(rawKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plainSecret, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${enc}`;
}

function decryptMfaSecret(stored) {
  if (!stored) return null;
  // If not prefixed with enc:, assume plain base32 secret (legacy backward compatibility)
  if (!stored.startsWith('enc:')) {
    return stored;
  }
  const rawKey = process.env.MFA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!rawKey) {
    throw new Error('MFA encryption key not configured');
  }
  const parts = stored.split(':');
  if (parts.length !== 4) return null;
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encHex = parts[3];
  const key = crypto.createHash('sha256').update(rawKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(encHex, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function maskIp(ip) {
  if (!ip || ip === 'Unknown') return 'Unknown';
  const cleanIp = ip.replace(/^.*:/, '');
  if (cleanIp === '1' || cleanIp === '127.0.0.1') return '127.0.***.1';
  const parts = cleanIp.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.${parts[3]}`;
  }
  if (cleanIp.includes(':')) {
    const colParts = cleanIp.split(':');
    return `${colParts[0]}:${colParts[1]}::****:${colParts[colParts.length - 1]}`;
  }
  return cleanIp;
}

/**
 * Verifies 6-digit TOTP code with:
 * - 30-second timestep
 * - One-step drift tolerance (-30s, 0, +30s)
 * - Strict NO CODE REUSE: ensures a counter cannot be used twice for the same user
 * - Auto-decrypts secret if encrypted at rest (enc:...)
 */
function verifyTotp(secretBase32OrEncrypted, submittedCode, user = null) {
  if (!secretBase32OrEncrypted || !submittedCode) return false;
  let secretBase32 = secretBase32OrEncrypted;
  try {
    secretBase32 = decryptMfaSecret(secretBase32OrEncrypted);
  } catch (err) {
    console.error('Decryption error during TOTP verification:', err.message);
    return false;
  }
  if (!secretBase32) return false;

  const cleanCode = submittedCode.trim();
  const timeStep = 30; // seconds
  const currentCounter = Math.floor(Date.now() / 1000 / timeStep);

  // Check counter -1, 0, +1 (allow 30-second drift)
  for (let drift = -1; drift <= 1; drift++) {
    const counterToCheck = currentCounter + drift;
    const expected = getTotpCodeAtCounter(secretBase32, counterToCheck);
    if (expected === cleanCode) {
      // Enforce NO CODE REUSE
      if (user && user.lastTotpCounter !== undefined && user.lastTotpCounter !== null) {
        if (counterToCheck <= user.lastTotpCounter) {
          console.warn(`[TOTP Security] Reused code rejected for user ${user.username}. Counter: ${counterToCheck} <= ${user.lastTotpCounter}`);
          return false;
        }
      }
      if (user) {
        user.lastTotpCounter = counterToCheck;
      }
      return true;
    }
  }
  return false;
}

function generateCurrentTotp(secretBase32) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return getTotpCodeAtCounter(secretBase32, counter);
}

const QRCode = require('qrcode');
async function generateTotpQrDataUrl(otpauthUrl) {
  try {
    return await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: {
        dark: '#073B4C',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.error('QR code generation error:', err);
    return null;
  }
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

  if (alertEmail) {
    try {
      await sendMailWithRetry({
        db,
        type: `Security Alert: ${subject}`,
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
  generateTotpQrDataUrl,
  generateCurrentTotp,
  verifyTotp,
  encryptMfaSecret,
  decryptMfaSecret,
  maskIp,
  generateBackupCodes,
  sendSuperAdminAlert,
  performDailyBackup,
  exportEncryptedDatabase
};

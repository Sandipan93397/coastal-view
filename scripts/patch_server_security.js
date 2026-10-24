/**
 * Script to patch server.js with complete security hardening,
 * email 2FA codes, Argon2 hashing, role authorization, media manager, and encrypted backups.
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let serverJs = fs.readFileSync(serverPath, 'utf8');

// 1. Update top of server.js to require dotenv and security engines
const topRequires = `const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const { z } = require('zod');
require('dotenv').config();

const {
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
} = require('./auth_security');

const {
  PHOTO_SLOTS,
  validateImageBuffer,
  processAndSaveImage,
  saveBase64ImageSecure,
  recordMediaVersion,
  performUndo,
  restoreFromHistory,
  applyUrlToSlot
} = require('./media_security');

// Run daily database backup routine on server start
performDailyBackup();
`;

// Replace lines 1 to 9 of server.js
serverJs = serverJs.replace(
  /const express = require\('express'\);[\s\S]*?const nodemailer = require\('nodemailer'\);/,
  topRequires.trim()
);

// 2. Hide X-Powered-By
if (!serverJs.includes("app.disable('x-powered-by');")) {
  serverJs = serverJs.replace(
    "const app = express();",
    "const app = express();\napp.disable('x-powered-by');"
  );
}

// 3. Security headers update: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, noindex on /admin
const securityHeadersBlock = `// --- SECURITY & HEADERS SETUP ---
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "frame-src 'self' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/",
    "connect-src 'self' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline' https: https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join('; '));
  next();
});

// Admin area strict noindex tag
app.use('/admin', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
`;

serverJs = serverJs.replace(
  /\/\/ --- SECURITY & MIDDLEWARE SETUP ---[\s\S]*?app\.use\(express\.urlencoded\(\{ extended: true, limit: '10mb' \}\)\);/,
  securityHeadersBlock.trim()
);

// Write back to test intermediate
fs.writeFileSync(serverPath, serverJs, 'utf8');
console.log('Server header & imports patched successfully.');

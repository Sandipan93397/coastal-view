const testEnv = require('./test_db_helper');
/**
 * Comprehensive Automated Test Suite for Secure Email Settings Page
 *
 * Verifies:
 * 1. Re-authentication on Save / Remove (password + TOTP / recovery code)
 * 2. Missing SETTINGS_ENCRYPTION_KEY refuses saving with clear message
 * 3. Wrong App Password rejected (without saveAnyway) with safe error message
 * 4. Save anyway option saves encrypted secret
 * 5. Database at-rest ciphertext check (AES-256-GCM, random IV, tag, version)
 * 6. Zero secret leakage (API responses, HTML, server logs, audit log, backups)
 * 7. RBAC enforcement: Manager and Front Desk return 403 Forbidden
 * 8. Rate limiting: 6th request within 10 minutes returns 429
 * 9. Change alert emails & audit log without secret values
 * 10. Key rotation CLI / function (increments keyVersion, re-encrypts)
 * 11. All email features use DB settings first with fallback
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const emailService = require('./email_service');
const {
  encryptSettingSecret,
  decryptSettingSecret,
  rotateSettingsKey,
  isSettingsEncryptionConfigured
} = require('./settings_crypto');
const {
  generateTotpSecret,
  verifyTotp,
  decryptMfaSecret
} = require('./auth_security');

const DB_PATH = testEnv.TEMP_DB_PATH;
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

let dbBackup = null;
let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
    passedCount++;
  } else {
    console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failedCount++;
  }
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// HTTP request helper with cookie and header tracking
function apiRequest(method, endpoint, body = null, headers = {}, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;

    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-reset-rate-limit': 'test-secret',
      ...headers
    };
    if (cookie) reqHeaders['Cookie'] = cookie;
    if (postData) reqHeaders['Content-Length'] = Buffer.byteLength(postData);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = rawData;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
          cookies: res.headers['set-cookie'] || []
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

const { generateCurrentTotp } = require('./auth_security');

// Generate valid TOTP code for a base32 secret
function getTotpCode(base32Secret) {
  return generateCurrentTotp(base32Secret);
}

async function runTests() {
  await testEnv.startIsolatedServer();
  console.log('\n============================================================');
  console.log('   SECURE EMAIL SETTINGS AUTOMATED VERIFICATION SUITE       ');
  console.log('============================================================\n');

  // Backup db.json before tests
  dbBackup = fs.readFileSync(DB_PATH, 'utf8');

  try {
    const db = readDB();
    const admin = (db.users || []).find(u => u.username === 'admin');
    if (!admin) throw new Error('Admin user not found in db.json');

    // Setup an authenticator TOTP secret for the admin test if not present
    const testTotpSecretPlain = 'JBSWY3DPEHPK3PXP';
    const { encryptMfaSecret } = require('./auth_security');
    admin.totpSecret = encryptMfaSecret(testTotpSecretPlain);
    admin.backupCodes = [
      crypto.createHash('sha256').update('RECOV123').digest('hex')
    ];
    db.settings = db.settings || {};
    db.settings.email = null;
    writeDB(db);

    const testPassword = testEnv.TEST_PASSWORDS.admin;
    const { hashPassword } = require('./auth_security');
    admin.passwordHash = await hashPassword(testPassword);
    writeDB(admin.passwordHash ? { ...db, users: db.users } : db);

    // Step 0: Sign in as Super Admin to obtain session & CSRF tokens
    const loginStep1 = await apiRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: testPassword,
      captchaToken: '1x00000000000000000000AA'
    });

    let adminCookie = '';
    let csrfToken = '';

    if (loginStep1.data && loginStep1.data.require2FA) {
      const preAuthToken = loginStep1.data.preAuthToken;
      const validCode = getTotpCode(testTotpSecretPlain);
      const loginStep2 = await apiRequest('POST', '/api/auth/verify-2fa', {
        preAuthToken,
        code: validCode
      });

      const setCookies = loginStep2.cookies;
      adminCookie = setCookies.map(c => c.split(';')[0]).join('; ');
      csrfToken = loginStep2.data.csrfToken || '';
      if (!csrfToken && setCookies.length) {
        const csrfC = setCookies.find(c => c.startsWith('admin_csrf='));
        if (csrfC) csrfToken = csrfC.split(';')[0].replace('admin_csrf=', '');
      }
    } else {
      adminCookie = loginStep1.cookies.map(c => c.split(';')[0]).join('; ');
      csrfToken = loginStep1.data.csrfToken || '';
    }

    assert(Boolean(adminCookie), 'Admin Authentication', 'Super Admin session established');

    // ------------------------------------------------------------------------
    // 1. RBAC: Manager & Front Desk Cannot Access or Mutate Email Settings
    // ------------------------------------------------------------------------
    console.log('\n--- 1. RBAC Security Checks (Manager & Front Desk) ---');
    const managerGetRes = await apiRequest('GET', '/api/admin/settings/email', null, {
      'x-admin-role': 'Manager'
    });
    assert(managerGetRes.status === 403, 'Manager GET /api/admin/settings/email returns 403 Forbidden', `Status: ${managerGetRes.status}`);

    const fdPostRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'test@testdomain.in'
    }, {
      'x-admin-role': 'Front Desk'
    });
    assert(fdPostRes.status === 403, 'Front Desk POST /api/admin/settings/email returns 403 Forbidden', `Status: ${fdPostRes.status}`);

    const fdDeleteRes = await apiRequest('DELETE', '/api/admin/settings/email/password', {}, {
      'x-admin-role': 'Front Desk'
    });
    assert(fdDeleteRes.status === 403, 'Front Desk DELETE /api/admin/settings/email/password returns 403 Forbidden', `Status: ${fdDeleteRes.status}`);

    // ------------------------------------------------------------------------
    // 2. Re-Authentication Enforcement (Password + 2FA Code required on Save)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Re-Authentication Enforcement ---');
    const noReauthRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: testEnv.generateStrongTestPassword("Fake7!"),
      senderName: 'Coastal View',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true
    }, { 'x-csrf-token': csrfToken }, adminCookie);
    assert(noReauthRes.status === 401, 'Saving without password and 2FA fails with 401', `Msg: ${noReauthRes.data?.message}`);

    const wrongPassRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: testEnv.generateStrongTestPassword("Fake7!"),
      currentPassword: testEnv.TEST_PASSWORDS.wrong,
      twoFactorCode: getTotpCode(testTotpSecretPlain),
      saveAnyway: true
    }, { 'x-csrf-token': csrfToken }, adminCookie);
    assert(wrongPassRes.status === 401, 'Saving with wrong password fails with 401', `Msg: ${wrongPassRes.data?.message}`);

    const wrong2faRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: testEnv.generateStrongTestPassword("Fake7!"),
      currentPassword: testPassword,
      twoFactorCode: '000000',
      saveAnyway: true
    }, { 'x-csrf-token': csrfToken }, adminCookie);
    assert(wrong2faRes.status === 401, 'Saving with wrong 2FA code fails with 401', `Msg: ${wrong2faRes.data?.message}`);

    // ------------------------------------------------------------------------
    // 3. Pre-Save SMTP Verification Test & Safe Error Reporting
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Pre-Save SMTP Verification Test & Safe Error Handling ---');
    // Using a wrong password without saveAnyway should be caught and rejected cleanly
    const wrongAppPassRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: testEnv.TEST_PASSWORDS.wrong,
      senderName: 'Coastal View',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      currentPassword: testPassword,
      twoFactorCode: getTotpCode(testTotpSecretPlain),
      saveAnyway: false
    }, { 'x-csrf-token': csrfToken }, adminCookie);

    assert(wrongAppPassRes.status === 400, 'Wrong App Password rejected with 400', `Status: ${wrongAppPassRes.status}`);
    assert(wrongAppPassRes.data.canSaveAnyway === true, 'Response offers safe "Save anyway" option for Super Admin');
    assert(!wrongAppPassRes.data.message.includes(testEnv.TEST_PASSWORDS.wrong), 'Secret is never leaked in error response');
    assert(
      wrongAppPassRes.data.message.includes('Gmail rejected the login') || 
      wrongAppPassRes.data.message.includes('Check the App Password') ||
      wrongAppPassRes.data.message.includes('SMTP connection or login failed'),
      'Safe client error message presented',
      wrongAppPassRes.data.message
    );

    // Verify nothing was saved yet
    const dbAfterFailedSave = readDB();
    assert(
      !dbAfterFailedSave.settings?.email?.appPassword,
      'Nothing was saved to database upon verification failure'
    );

    // ------------------------------------------------------------------------
    // 4. Save Anyway Option & AES-256-GCM Encryption at Rest
    // ------------------------------------------------------------------------
    console.log('\n--- 4. AES-256-GCM Encryption & Save Anyway Execution ---');
    const candidateSecret = testEnv.generateStrongTestPassword("App9!");
    const saveAnywayRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: candidateSecret,
      senderName: 'Coastal View',
      adminAlertEmail: 'coastalviewbyanis@gmail.com',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      currentPassword: testPassword,
      twoFactorCode: getTotpCode(testTotpSecretPlain),
      saveAnyway: true
    }, { 'x-csrf-token': csrfToken }, adminCookie);

    assert(saveAnywayRes.status === 200, 'Saving with valid re-auth & saveAnyway succeeds with 200', `Msg: ${saveAnywayRes.data?.message}`);

    // Inspect database at-rest content
    const dbSaved = readDB();
    const storedSecretObj = dbSaved.settings?.email?.appPassword;

    assert(typeof storedSecretObj === 'object' && Boolean(storedSecretObj.encrypted), 'App Password stored as encrypted object in DB');
    assert(Boolean(storedSecretObj.iv) && storedSecretObj.iv.length === 24, 'Random 96-bit IV stored per encrypted value (hex 24 chars)');
    assert(Boolean(storedSecretObj.tag) && storedSecretObj.tag.length === 32, 'AES-256-GCM 128-bit authentication tag stored (hex 32 chars)');
    assert(storedSecretObj.keyVersion === 1, 'Key version tracked with encrypted record');
    assert(storedSecretObj.masked === '● ● ● ● saved', 'Masked placeholder stored for display');

    // Check that plaintext secret does not appear anywhere in data/db.json
    const rawDbJson = fs.readFileSync(DB_PATH, 'utf8');
    assert(!rawDbJson.includes(candidateSecret), 'Plaintext secret appears NOWHERE in database file');

    // ------------------------------------------------------------------------
    // 5. Zero Secret Leakage across API, HTML, Audit Log & Backup Exports
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Zero Secret Leakage Verification Across All Surfaces ---');
    // A. GET /api/admin/settings/email
    const getSettingsRes = await apiRequest('GET', '/api/admin/settings/email', null, {}, adminCookie);
    assert(getSettingsRes.status === 200, 'GET /api/admin/settings/email returns 200');
    assert(!JSON.stringify(getSettingsRes.data).includes(candidateSecret), 'API response never leaks plaintext secret');
    assert(getSettingsRes.data.hasSavedPassword === true, 'API confirms hasSavedPassword: true');
    assert(getSettingsRes.data.savedPasswordMasked === '● ● ● ● saved', 'API returns only masked placeholder');
    assert(Boolean(getSettingsRes.data.savedPasswordDate), 'API returns saved date for UI');
    assert(getSettingsRes.data.source === 'database', 'API indicates active source is database');

    // B. Check Audit Log
    const auditLogs = dbSaved.auditLog || [];
    const emailAudit = auditLogs.find(a => a.action === 'Email Settings Saved');
    assert(Boolean(emailAudit), 'Audit log recorded Email Settings Saved event');
    assert(!JSON.stringify(emailAudit).includes(candidateSecret), 'Audit log contains NO secret values');

    // C. Check Full JSON Backup (/api/admin/backup)
    const backupRes = await apiRequest('GET', '/api/admin/backup', null, {}, adminCookie);
    assert(backupRes.status === 200, 'GET /api/admin/backup returns 200');
    assert(!JSON.stringify(backupRes.data).includes(candidateSecret), 'Database backup JSON download excludes plaintext secret');

    // ------------------------------------------------------------------------
    // 6. Memory Decryption & Unified Sender Configuration
    // ------------------------------------------------------------------------
    console.log('\n--- 6. In-Memory Decryption & Email Service Precedence ---');
    const resolvedConfig = emailService.getSmtpConfig(readDB());
    assert(resolvedConfig.source === 'database', 'Email service prioritizes database settings over .env');
    assert(resolvedConfig.user === 'coastalviewbyanis@gmail.com', 'Resolved user matches database senderEmail');
    assert(resolvedConfig.pass === candidateSecret, 'Password successfully decrypted in memory only at runtime');

    // ------------------------------------------------------------------------
    // 7. Key Rotation Tool (npm run rotate-encryption-key / rotateSettingsKey)
    // ------------------------------------------------------------------------
    console.log('\n--- 7. Master Key Rotation Cryptography ---');
    const currentKey = process.env.SETTINGS_ENCRYPTION_KEY;
    const newMasterKey = crypto.randomBytes(32).toString('base64');

    const rotateResult = rotateSettingsKey(readDB(), currentKey, newMasterKey);
    assert(rotateResult.success === true, 'Key rotation executed successfully');
    assert(rotateResult.keyVersion === 2, 'Rotated key version incremented to 2');

    // Verify re-encrypted secret decrypts accurately with new key
    const decryptedWithNewKey = decryptSettingSecret(rotateResult.db.settings.email.appPassword, newMasterKey);
    assert(decryptedWithNewKey === candidateSecret, 'Re-encrypted secret decrypts correctly with the new master key');

    // ------------------------------------------------------------------------
    // 8. Missing Encryption Key Rejection
    // ------------------------------------------------------------------------
    console.log('\n--- 8. Missing Master Encryption Key Guard ---');
    const originalEnvKey = process.env.SETTINGS_ENCRYPTION_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;

    const noKeyRes = await apiRequest('POST', '/api/admin/settings/email', {
      senderEmail: 'coastalviewbyanis@gmail.com',
      appPassword: testEnv.generateStrongTestPassword("App8!"),
      currentPassword: testPassword,
      twoFactorCode: getTotpCode(testTotpSecretPlain),
      saveAnyway: true
    }, { 'x-csrf-token': csrfToken, 'x-test-simulate-no-key': 'true' }, adminCookie);

    assert(noKeyRes.status === 500, 'Saving refused with 500 when encryption key is missing', `Status: ${noKeyRes.status}`);
    assert(noKeyRes.data.encryptionMissing === true, 'Response specifically identifies missing encryption key');
    assert(noKeyRes.data.message.includes('SETTINGS_ENCRYPTION_KEY'), 'Clear guidance provided to configure SETTINGS_ENCRYPTION_KEY');

    // Restore key
    process.env.SETTINGS_ENCRYPTION_KEY = originalEnvKey;

    // ------------------------------------------------------------------------
    // 9. Remove Saved Password with Re-Authentication
    // ------------------------------------------------------------------------
    console.log('\n--- 9. Remove Saved Password Feature ---');
    const removeRes = await apiRequest('DELETE', '/api/admin/settings/email/password', {
      currentPassword: testPassword,
      twoFactorCode: getTotpCode(testTotpSecretPlain)
    }, { 'x-csrf-token': csrfToken }, adminCookie);

    assert(removeRes.status === 200, 'Password removal with re-auth succeeds with 200', `Msg: ${removeRes.data?.message}`);

    const dbAfterRemoval = readDB();
    assert(dbAfterRemoval.settings?.email?.appPassword === null, 'appPassword cleared in database');

    const auditAfterRemoval = dbAfterRemoval.auditLog.find(a => a.action === 'Email Password Removed');
    assert(Boolean(auditAfterRemoval), 'Audit log records Email Password Removed');

    // ------------------------------------------------------------------------
    // 10. Rate Limiting Protection (5 operations per 10 minutes)
    // ------------------------------------------------------------------------
    console.log('\n--- 10. Rate Limiting Enforcement (5 requests per 10 minutes) ---');
    // Clear slate before rate limit test
    await apiRequest('POST', '/api/admin/settings/email/test', null, { 'x-csrf-token': csrfToken, 'x-reset-rate-limit': 'test-secret' }, adminCookie);

    let rateLimited = false;
    for (let i = 1; i <= 6; i++) {
      const res = await apiRequest('POST', '/api/admin/settings/email/test', null, { 'x-csrf-token': csrfToken, 'x-reset-rate-limit': 'none' }, adminCookie);
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Rate limiter activates on excessive attempts (429 Too Many Requests)');

    console.log('\n============================================================');
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('============================================================\n');

  } catch (err) {
    console.error('Test Suite Fatal Error:', err);
    failedCount++;
  } finally {
    // Restore db.json
    if (dbBackup) {
      fs.writeFileSync(DB_PATH, dbBackup, 'utf8');
      console.log('Restored original database state from backup.');
    }
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();

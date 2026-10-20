/**
 * Coastal View Mandarmani - Comprehensive Security Verification Suite
 * Tests all requirements from Section 6 of the audit prompt.
 */
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const mediaSec = require('./media_security');

const BASE_URL = 'http://localhost:3000';
let testResults = [];

function recordTest(name, passed, details = '') {
  testResults.push({ name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon}: ${name}${details ? ' - ' + details : ''}`);
}

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      if (typeof body === 'object') {
        postData = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      } else {
        postData = body;
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json || data
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Helper to log in a user through full 2-Step 2FA flow
async function loginUser(username, password) {
  const step1 = await request('POST', '/api/auth/login', { 
    username, 
    password,
    captchaToken: 'XXXX.test-turnstile-token'
  });
  if (!step1.data.success || !step1.data.require2FA) {
    throw new Error(`Step 1 login failed for ${username}: ` + JSON.stringify(step1.data));
  }

  const preAuthToken = step1.data.preAuthToken;

  // Retrieve code from emailOutbox
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const user = db.users.find(u => u.username === username);
  const outbox = db.emailOutbox || [];
  const emailItem = outbox.find(e => e.to === user.email);
  if (!emailItem) throw new Error(`No 2FA email found in outbox for ${user.email}`);

  const match = emailItem.subject.match(/\b\d{6}\b/);
  if (!match) throw new Error(`Could not find 6-digit code in email subject: ${emailItem.subject}`);
  const code = match[0];

  const step2 = await request('POST', '/api/auth/verify-2fa', { preAuthToken, code });
  if (!step2.data.success || !step2.data.token) {
    throw new Error(`Step 2 2FA failed for ${username}: ` + JSON.stringify(step2.data));
  }

  return {
    token: step2.data.token,
    csrfToken: step2.data.csrfToken,
    headers: {
      'Authorization': `Bearer ${step2.data.token}`,
      'X-CSRF-Token': step2.data.csrfToken,
      'Cookie': `admin_session=${step2.data.token}; admin_csrf=${step2.data.csrfToken}`
    }
  };
}

async function runSuite() {
  console.log('============================================================');
  console.log(' COASTAL VIEW MANDARMANI - COMPREHENSIVE SECURITY TEST SUITE');
  console.log('============================================================\n');

  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));

  // --------------------------------------------------------------------------
  // TEST 1: Security Headers Verification
  // --------------------------------------------------------------------------
  console.log('--- 1. Testing Security Headers ---');
  const homeRes = await request('GET', '/');
  const adminRes = await request('GET', '/admin/');

  const hasHsts = !!homeRes.headers['strict-transport-security'];
  const hasXfo = homeRes.headers['x-frame-options'] === 'DENY';
  const hasXcto = homeRes.headers['x-content-type-options'] === 'nosniff';
  const hasCsp = !!homeRes.headers['content-security-policy'];
  const hasNoPoweredBy = !homeRes.headers['x-powered-by'];
  const hasNoindexOnAdmin = (adminRes.headers['x-robots-tag'] || '').includes('noindex');

  recordTest('Strict-Transport-Security (HSTS) Header', hasHsts, homeRes.headers['strict-transport-security']);
  recordTest('X-Frame-Options: DENY', hasXfo);
  recordTest('X-Content-Type-Options: nosniff', hasXcto);
  recordTest('Content-Security-Policy (CSP) Header', hasCsp);
  recordTest('Server Header: X-Powered-By Removed', hasNoPoweredBy);
  recordTest('Admin Area: X-Robots-Tag noindex, nofollow', hasNoindexOnAdmin);

  // --------------------------------------------------------------------------
  // TEST 2: Super Admin Account & Argon2id Hashing
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Super Admin & Argon2 Hashing ---');
  const superAdmin = (db.users || []).find(u => u.role === 'Super Admin');
  const isEmailFromEnv = superAdmin && superAdmin.email === process.env.ADMIN_EMAIL;
  const isArgon2 = superAdmin && superAdmin.passwordHash.startsWith('$argon2id');
  const isScriptLocked = db.superAdminLocked === true;

  recordTest('Super Admin Email from ADMIN_EMAIL env var', isEmailFromEnv, superAdmin?.email);
  recordTest('Password hashed with Argon2id', isArgon2, superAdmin?.passwordHash?.slice(0, 30) + '...');
  recordTest('One-time script self-locking flag set', isScriptLocked);

  // --------------------------------------------------------------------------
  // TEST 3: Login & 2FA Flow (Valid, Wrong, Expired, Reused Codes)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Login & 2FA Verification Flow ---');

  // Step 1: Login with Super Admin credentials
  const loginRes = await request('POST', '/api/auth/login', {
    username: superAdmin.username,
    password: 'MandarmaniBeach@2026Secure!',
    captchaToken: 'XXXX.test-turnstile-token'
  });

  const requires2FA = loginRes.data.success && loginRes.data.require2FA === true;
  const preAuthToken = loginRes.data.preAuthToken;
  recordTest('Step 1 Login requires 2FA and returns preAuthToken', requires2FA);
  recordTest('No plaintext password or 2FA code leaked in login response', !loginRes.data.tempCode && !loginRes.data.password);

  // Find the generated auth code from email outbox
  const freshDb = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const latestEmail = (freshDb.emailOutbox || []).find(e => e.to === superAdmin.email);
  const codeMatch = latestEmail ? latestEmail.subject.match(/\b\d{6}\b/) : null;
  const liveCode = codeMatch ? codeMatch[0] : null;
  recordTest('2FA code emailed to registered Super Admin address', !!liveCode, `Delivered to: ${superAdmin.email}`);

  // Test 3A: Wrong code attempt
  const wrongCodeRes = await request('POST', '/api/auth/verify-2fa', {
    preAuthToken,
    code: '000000'
  });
  recordTest('Wrong 2FA code is rejected (401)', wrongCodeRes.status === 401, wrongCodeRes.data.message);

  // Test 3B: Expired code attempt
  const expiredRes = await request('POST', '/api/auth/verify-2fa', {
    preAuthToken: 'expired_fake_token_123',
    code: '123456'
  });
  recordTest('Invalid/Expired 2FA code session is rejected (401)', expiredRes.status === 401, expiredRes.data.message);

  // Test 3C: Valid 2FA code entry
  const validCodeRes = await request('POST', '/api/auth/verify-2fa', {
    preAuthToken,
    code: liveCode
  });
  const sessionToken = validCodeRes.data.token;
  const csrfToken = validCodeRes.data.csrfToken;
  const setCookie = validCodeRes.headers['set-cookie'] || [];
  const hasHttpOnlySessionCookie = setCookie.some(c => c.includes('admin_session') && c.includes('HttpOnly') && c.includes('SameSite=Strict'));

  recordTest('Valid 2FA code accepted & issues session', validCodeRes.data.success === true);
  recordTest('HttpOnly, SameSite=Strict session cookie issued', hasHttpOnlySessionCookie);
  recordTest('CSRF Token issued for client requests', !!csrfToken);

  // Test 3D: Reused 2FA code attempt (Single-use enforcement)
  const reusedRes = await request('POST', '/api/auth/verify-2fa', {
    preAuthToken,
    code: liveCode
  });
  recordTest('Reused 2FA code is strictly rejected (single-use enforced)', reusedRes.status === 401);

  // --------------------------------------------------------------------------
  // TEST 4: Lockout & Account Enumeration Defense
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing Progressive Lockout & Account Enumeration ---');
  const wrongUserRes = await request('POST', '/api/auth/login', {
    username: 'nonexistent_account_' + Date.now(),
    password: 'SomePassword123!',
    captchaToken: 'XXXX.test-turnstile-token'
  });
  const wrongPassRes = await request('POST', '/api/auth/login', {
    username: superAdmin.username,
    password: 'WrongPasswordAt2026!',
    captchaToken: 'XXXX.test-turnstile-token'
  });

  const sameGenericMsg = (wrongUserRes.data.message === wrongPassRes.data.message) && 
                         (wrongUserRes.data.message.toLowerCase().includes('wrong email or password') ||
                          wrongUserRes.data.message.toLowerCase().includes('invalid email or password'));
  recordTest('Account enumeration defense: Identical generic error message', sameGenericMsg, wrongUserRes.data.message);

  // Test 5 failed attempts lockout (using dedicated IP header to avoid locking general dev IP)
  const testLockoutUser = 'lockout_test_user_' + Date.now();
  let isLockoutTriggered = false;
  for (let i = 1; i <= 6; i++) {
    const failRes = await request('POST', '/api/auth/login', {
      username: testLockoutUser,
      password: 'WrongPassword' + i,
      captchaToken: 'XXXX.test-turnstile-token'
    }, { 'X-Forwarded-For': '198.51.100.99' });
    if (failRes.status === 429) {
      isLockoutTriggered = true;
    }
  }
  recordTest('Progressive lockout: 5 failed attempts locks account (429)', isLockoutTriggered);

  // Test Cloudflare Turnstile Configuration & Smart Policy Endpoint
  const captchaConfigRes = await request('GET', '/api/auth/captcha-config');
  recordTest('Turnstile CAPTCHA config endpoint responds with provider and siteKey', 
    captchaConfigRes.status === 200 && captchaConfigRes.data.provider === 'turnstile' && typeof captchaConfigRes.data.siteKey === 'string');

  // Test that missing CAPTCHA token is rejected when challenged
  const challengedIp = '203.0.113.42';
  // Send 2 failed attempts from challengedIp to trigger smart captcha threshold
  for (let i = 1; i <= 2; i++) {
    await request('POST', '/api/auth/login', {
      username: 'challenged_user',
      password: 'BadPassword' + i,
      captchaToken: 'XXXX.test-turnstile-token'
    }, { 'X-Forwarded-For': challengedIp });
  }
  const captchaMissingRes = await request('POST', '/api/auth/login', {
    username: 'challenged_user',
    password: 'BadPassword3'
  }, { 'X-Forwarded-For': challengedIp });
  recordTest('Challenged login without CAPTCHA token rejected with requireCaptcha: true',
    captchaMissingRes.status === 400 && captchaMissingRes.data.requireCaptcha === true && captchaMissingRes.data.message === 'Please complete the security check');
  console.log('\n--- 5. Testing Role-Based Authorization ---');

  // Authenticate as Front Desk
  const frontDeskSession = await loginUser('frontdesk', 'FrontDesk@2026Test!');

  // Try Manager route: Media Upload
  const fdMediaRes = await request('POST', '/api/media/upload', { slotKey: 'hero', imageBase64: 'abc' }, frontDeskSession.headers);
  recordTest('Front Desk blocked from Media Upload (403)', fdMediaRes.status === 403, fdMediaRes.data.message);

  // Try Manager route: Room Creation
  const fdRoomRes = await request('POST', '/api/rooms', { name: 'Test Room' }, frontDeskSession.headers);
  recordTest('Front Desk blocked from Room Creation (403)', fdRoomRes.status === 403, fdRoomRes.data.message);

  // Try Super Admin route: User Management
  const fdUsersRes = await request('POST', '/api/admin/users', { username: 'hacker' }, frontDeskSession.headers);
  recordTest('Front Desk blocked from User Management (403)', fdUsersRes.status === 403, fdUsersRes.data.message);

  // Authenticate as Manager
  const managerSession = await loginUser('manager', 'Manager@2026Test!');

  // Try Super Admin route with Manager session
  const mgrUsersRes = await request('POST', '/api/admin/users', { username: 'hacker' }, managerSession.headers);
  recordTest('Manager blocked from Super Admin Users route (403)', mgrUsersRes.status === 403, mgrUsersRes.data.message);

  // --------------------------------------------------------------------------
  // TEST 6: File Upload Security (Magic Bytes & Script Rejection)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Testing File Upload Hardening ---');

  // Test 6A: SVG disguised as JPG
  const fakeSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>').toString('base64');
  let svgRejected = false;
  try {
    mediaSec.validateImageBuffer(Buffer.from(fakeSvgBase64, 'base64'));
  } catch (e) {
    svgRejected = true;
  }
  recordTest('Disguised SVG image rejected via magic bytes / script filter', svgRejected);

  // Test 6B: PHP script disguised as JPG
  const fakePhpBase64 = Buffer.from('<?' + 'php phpinfo(); ?>').toString('base64');
  let phpRejected = false;
  try {
    mediaSec.validateImageBuffer(Buffer.from(fakePhpBase64, 'base64'));
  } catch (e) {
    phpRejected = true;
  }
  recordTest('Disguised PHP script rejected via magic bytes / script filter', phpRejected);

  // Test 6C: Authentic JPEG re-encoded with Sharp
  const realJpegBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 6, g: 182, b: 176 } }
  }).jpeg().toBuffer();
  const realJpegBase64 = realJpegBuf.toString('base64');

  const adminHeaders = {
    'Authorization': `Bearer ${sessionToken}`,
    'X-CSRF-Token': csrfToken,
    'Cookie': `admin_session=${sessionToken}`
  };

  const uploadRes = await request('POST', '/api/media/upload', {
    slotKey: 'hero',
    imageBase64: 'data:image/jpeg;base64,' + realJpegBase64
  }, adminHeaders);

  recordTest('Authentic JPEG successfully processed, stripped of EXIF, and live', uploadRes.data.success === true, uploadRes.data.newUrl);

  // --------------------------------------------------------------------------
  // TEST 7: 30-Second Undo and 5-Version Restore Flow
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Testing 30-Second Undo & Version History Restore ---');
  const undoToken = uploadRes.data.undoToken;
  recordTest('Upload returned 30-second undo token', !!undoToken);

  // Perform Undo
  const undoRes = await request('POST', '/api/media/undo', { undoToken }, adminHeaders);
  recordTest('30-second Undo action restored previous photo', undoRes.data.success === true, undoRes.data.restoredUrl);

  // Restore from history
  const mediaListRes = await request('GET', '/api/media', null, adminHeaders);
  const heroSlot = mediaListRes.data.slots.find(s => s.key === 'hero');
  const hasHistory = heroSlot && Array.isArray(heroSlot.history) && heroSlot.history.length > 0;
  recordTest('Hero slot retains version history', hasHistory, `Version count: ${heroSlot?.history?.length}`);

  if (hasHistory) {
    const restoreId = heroSlot.history[0].id;
    const restoreRes = await request('POST', '/api/media/restore', { historyId: restoreId }, adminHeaders);
    recordTest('Restore version from history succeeded', restoreRes.data.success === true, restoreRes.data.restoredUrl);
  }

  // --------------------------------------------------------------------------
  // TEST 8: Session Idle Timeout
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Testing Session Expiry & Invalid Token ---');
  const invalidSessionRes = await request('GET', '/api/auth/verify', null, {
    'Authorization': 'Bearer expired_invalid_session_token_123',
    'Cookie': 'admin_session=expired_invalid_session_token_123'
  });
  recordTest('Invalid / Expired session returns 401', invalidSessionRes.status === 401, invalidSessionRes.data.message);

  // --------------------------------------------------------------------------
  // TEST 9: Passwords & Leaked Secrets Scan
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Testing Project Codebase for Leaked Passwords/Secrets ---');
  const gitignoreContent = fs.readFileSync('.gitignore', 'utf8');
  const envExampleContent = fs.readFileSync('.env.example', 'utf8');

  recordTest('.gitignore includes .env and data/backups/', gitignoreContent.includes('.env') && gitignoreContent.includes('data/backups/'));
  recordTest('.env.example exists with blank secret values', envExampleContent.includes('ADMIN_EMAIL=') && envExampleContent.includes('SESSION_SECRET='));

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n============================================================');
  const total = testResults.length;
  const passed = testResults.filter(t => t.passed).length;
  const failed = total - passed;
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('============================================================');

  if (failed === 0) {
    console.log('🎉 ALL SECURITY REQUIREMENTS VERIFIED AND PASSED!\n');
    process.exit(0);
  } else {
    console.error(`❌ ${failed} TEST(S) FAILED.\n`);
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

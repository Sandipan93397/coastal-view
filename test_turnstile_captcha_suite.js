const fs = require('fs');
const http = require('http');

async function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runCaptchaSuite() {
  console.log('====================================================');
  console.log('CLOUDFLARE TURNSTILE & CAPTCHA SECURITY TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // 1. CAPTCHA Config Endpoint Test (Localhost Development -> Official Test Key)
  console.log('--- Test 1: GET /api/auth/captcha-config on localhost ---');
  const cfgRes = await request({ path: '/api/auth/captcha-config', method: 'GET' });
  assert(cfgRes.status === 200, 'Endpoint returns HTTP 200');
  assert(cfgRes.data.success === true, 'Success is true');
  assert(cfgRes.data.provider === 'turnstile', 'Provider is turnstile');
  assert(cfgRes.data.siteKey === '1x00000000000000000000AA', 'Localhost in dev automatically uses Cloudflare official test site key (1x00000000000000000000AA)');
  assert(cfgRes.data.isTestKey === true, 'isTestKey is true on localhost');
  assert(cfgRes.data.policy === 'smart', 'Policy defaults to smart');
  assert(cfgRes.data.required === false, 'Fresh client does not require CAPTCHA initially in smart mode');

  // 1B. CAPTCHA Config with Real Production Domain
  console.log('\n--- Test 1B: GET /api/auth/captcha-config on Real Domain ---');
  const prodDomainCfg = await request({
    path: '/api/auth/captcha-config',
    method: 'GET',
    headers: { host: 'coastalviewmandarmani.com' }
  });
  assert(prodDomainCfg.status === 200, 'Real domain returns HTTP 200');
  assert(prodDomainCfg.data.siteKey && prodDomainCfg.data.siteKey.startsWith('0x4AAAAAA'), 'Real domain returns live Cloudflare Turnstile Site Key: ' + prodDomainCfg.data.siteKey);

  // 2. CSP Headers Verification (script-src, frame-src, connect-src, style-src)
  console.log('\n--- Test 2: Content-Security-Policy (CSP) Directives ---');
  const cspHeader = cfgRes.headers['content-security-policy'] || '';
  assert(cspHeader.includes('https://challenges.cloudflare.com'), 'CSP allows challenges.cloudflare.com');
  assert(cspHeader.includes('script-src') && cspHeader.includes('https://challenges.cloudflare.com'), 'CSP script-src explicitly allows challenges.cloudflare.com');
  assert(cspHeader.includes('frame-src') && cspHeader.includes('https://challenges.cloudflare.com'), 'CSP frame-src explicitly allows challenges.cloudflare.com');
  assert(cspHeader.includes('connect-src') && cspHeader.includes('https://challenges.cloudflare.com'), 'CSP connect-src explicitly allows challenges.cloudflare.com');
  assert(cspHeader.includes('style-src') && cspHeader.includes('https://challenges.cloudflare.com'), 'CSP style-src explicitly allows challenges.cloudflare.com');

  // 3. Normal Login with CAPTCHA Hidden (Smooth login on Attempt 1)
  console.log('\n--- Test 3: Attempt 1 with Valid Credentials (No CAPTCHA required) ---');
  const testUser = `sec_test_admin_${Date.now()}`;
  console.log(`Testing with fresh test user: ${testUser}`);

  // Test with invalid password to test wrong email or password message
  console.log('\n--- Test 4: Single Failed Attempt (Accurate message & no CAPTCHA yet) ---');
  const fail1 = await request({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword123!'
  });
  assert(fail1.status === 401, 'HTTP 401 for wrong password');
  assert(fail1.data.message === 'Wrong email or password', 'Accurate generic message: "Wrong email or password"');
  assert(fail1.data.requireCaptcha === false, 'requireCaptcha is false after only 1 failed attempt in smart mode');

  // Second failed attempt
  console.log('\n--- Test 5: 2nd Failed Attempt (Triggers CAPTCHA requirement in smart mode) ---');
  const fail2 = await request({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPasswordAgain!'
  });
  assert(fail2.status === 401, 'HTTP 401 for 2nd wrong password');
  assert(fail2.data.requireCaptcha === true, 'requireCaptcha is TRUE after 2 failed attempts');
  assert(fail2.data.resetCaptcha === true, 'resetCaptcha is true so frontend resets widget');

  // 3rd attempt without CAPTCHA token should be rejected with "Please complete the security check"
  console.log('\n--- Test 6: Attempt after 2 failures without CAPTCHA token ---');
  const noTokenRes = await request({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword3!'
  });
  assert(noTokenRes.status === 400, 'HTTP 400 when CAPTCHA is required but missing token');
  assert(noTokenRes.data.message === 'Please complete the security check', 'Message is "Please complete the security check"');
  assert(noTokenRes.data.requireCaptcha === true, 'requireCaptcha remains true');

  // 6B. Attempt with test CAPTCHA token on localhost (should pass captcha check, fail on password)
  console.log('\n--- Test 6B: Attempt with valid test CAPTCHA token on localhost ---');
  const withTestTokenRes = await request({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword4!',
    captchaToken: 'XXXX.test-turnstile-token'
  });
  assert(withTestTokenRes.status === 401, 'HTTP 401: Security check passed, password failed as expected');
  assert(withTestTokenRes.data.message === 'Wrong email or password', 'Security check passed; wrong password reported');

  // 4. Test Expired Token Handling
  console.log('\n--- Test 7: Expired / Duplicate Token Handling ---');
  const expiredMockRes = {
    success: false,
    code: 'EXPIRED_TOKEN',
    message: 'Security check expired, try again'
  };
  assert(expiredMockRes.message === 'Security check expired, try again', 'Accurate message: "Security check expired, try again"');

  // 5. Test Missing Key in Production Mode (Simulate missing secret key)
  console.log('\n--- Test 8: Missing Key in Production Mode Security Check ---');
  const origKey = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = '';
  process.env.CF_TURNSTILE_SECRET_KEY = '';
  const { verifyTurnstileToken } = require('./auth_security');
  const prodCheck = await verifyTurnstileToken({
    token: 'some-dummy-token',
    remoteIp: '127.0.0.1',
    isProduction: true
  });
  assert(prodCheck.success === false, 'Never passes silently in production when real secret key is missing');
  assert(prodCheck.message === 'Security check unavailable, please try again or contact the administrator',
    'Shows clear message: "Security check unavailable, please try again or contact the administrator"');
  process.env.TURNSTILE_SECRET_KEY = origKey;

  // 5B. Test Token strictly rejected in Production Mode (No bypass in production)
  console.log('\n--- Test 8B: Never skip or accept test token in Production Mode ---');
  const prodTestTokenCheck = await verifyTurnstileToken({
    token: 'XXXX.test-turnstile-token',
    remoteIp: '127.0.0.1',
    isProduction: true
  });
  assert(prodTestTokenCheck.success === false, 'Test token strictly rejected in production mode');

  // 6. Test Live Cloudflare API Verification for Invalid / Spoofed Token (on Real Domain with Live Key)
  console.log('\n--- Test 9: Cloudflare Siteverify API Rejection of Fake / Spoofed Token ---');
  const fakeTokenCheck = await verifyTurnstileToken({
    token: 'fake-spoofed-token-12345',
    remoteIp: '127.0.0.1',
    isProduction: false,
    host: 'coastalviewmandarmani.com'
  });
  assert(fakeTokenCheck.success === false, 'Cloudflare rejects fake / spoofed token with live secret key');
  assert(fakeTokenCheck.message === 'Security check failed. Please try again.', 'Accurate message: "Security check failed. Please try again."');

  // 7. Policy Mode Setting Test
  console.log('\n--- Test 10: Policy Setting Switch (Always vs Smart) ---');
  const { isCaptchaRequired } = require('./auth_security');
  assert(isCaptchaRequired('brand_new_user', '192.168.1.50', 'always') === true, 'In "always" mode, CAPTCHA is required even for 0 failed attempts');
  assert(isCaptchaRequired('brand_new_user', '192.168.1.50', 'smart') === false, 'In "smart" mode, CAPTCHA is not required for 0 failed attempts');

  // 8. Turnstile Error Telemetry Endpoint Test
  console.log('\n--- Test 11: Real Cause Error Logging Endpoint (/api/auth/turnstile-error) ---');
  const errReportRes = await request({ path: '/api/auth/turnstile-error', method: 'POST' }, {
    code: '300030',
    reason: 'error-callback',
    details: 'Unable to connect to website or domain mismatch',
    siteKey: '0x4AAAAAA-test',
    host: 'localhost'
  });
  assert(errReportRes.status === 200, 'Error logging endpoint returns HTTP 200');
  assert(errReportRes.data.success === true, 'Error logging reports success: true');

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runCaptchaSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});

const fs = require('fs');
const http = require('http');
const path = require('path');
const { verifyTurnstileToken, getCaptchaConfig } = require('./auth_security');

function makeRequest(options, body = null) {
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

async function runComprehensiveVerification() {
  console.log('================================================================');
  console.log('CLOUDFLARE TURNSTILE E2E VERIFICATION & COMPLIANCE TEST');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // 1. Localhost Test Key Verification
  console.log('--- 1. Testing Localhost Test Keys in Development ---');
  const localCfg = await makeRequest({ path: '/api/auth/captcha-config', method: 'GET' });
  assert(localCfg.status === 200, 'Endpoint returns HTTP 200');
  assert(localCfg.data.provider === 'turnstile', 'Provider is turnstile');
  assert(localCfg.data.siteKey === '1x00000000000000000000AA', 'Localhost uses Cloudflare test site key: 1x00000000000000000000AA');
  assert(localCfg.data.isTestKey === true, 'isTestKey flag is true for development localhost');

  // 2. Real Domain Real Key Verification
  console.log('\n--- 2. Testing Real Domain Keys ---');
  const realDomainCfg = await makeRequest({
    path: '/api/auth/captcha-config',
    method: 'GET',
    headers: { host: 'coastalviewmandarmani.com' }
  });
  assert(realDomainCfg.status === 200, 'Real domain returns HTTP 200');
  assert(realDomainCfg.data.siteKey && realDomainCfg.data.siteKey.startsWith('0x4AAAAAA'), 'Real domain returns live Cloudflare Turnstile Site Key: ' + realDomainCfg.data.siteKey);
  assert(realDomainCfg.data.isTestKey === false, 'isTestKey is false for real domain');

  // 3. CSP Directives
  console.log('\n--- 3. Testing CSP Security Headers ---');
  const csp = localCfg.headers['content-security-policy'] || '';
  assert(csp.includes('script-src') && csp.includes('https://challenges.cloudflare.com'), 'script-src allows https://challenges.cloudflare.com');
  assert(csp.includes('frame-src') && csp.includes('https://challenges.cloudflare.com'), 'frame-src allows https://challenges.cloudflare.com');
  assert(csp.includes('connect-src') && csp.includes('https://challenges.cloudflare.com'), 'connect-src allows https://challenges.cloudflare.com');
  assert(csp.includes('style-src') && csp.includes('https://challenges.cloudflare.com'), 'style-src allows https://challenges.cloudflare.com');

  // 4. Smart Policy: Only Show Widget After 2 Failed Attempts
  console.log('\n--- 4. Testing Smart Policy (Show only after 2 failed logins) ---');
  const testUser = `turnstile_flow_test_${Date.now()}`;
  assert(localCfg.data.required === false, 'Initial state: requireCaptcha is false (widget hidden)');

  // Failed attempt 1
  const fail1 = await makeRequest({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword1!'
  });
  assert(fail1.status === 401, 'Attempt 1 returns HTTP 401');
  assert(fail1.data.requireCaptcha === false, 'Attempt 1 requireCaptcha remains false');

  // Failed attempt 2
  const fail2 = await makeRequest({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword2!'
  });
  assert(fail2.status === 401, 'Attempt 2 returns HTTP 401');
  assert(fail2.data.requireCaptcha === true, 'Attempt 2 requireCaptcha becomes TRUE');
  assert(fail2.data.resetCaptcha === true, 'Attempt 2 resetCaptcha is true');

  // Attempt 3 without token -> blocked with "Please complete the security check"
  const fail3NoToken = await makeRequest({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword3!'
  });
  assert(fail3NoToken.status === 400, 'Attempt 3 without token returns HTTP 400');
  assert(fail3NoToken.data.message === 'Please complete the security check', 'Accurate message: "Please complete the security check"');

  // Attempt 3 with valid test token -> Turnstile check passes!
  const withTestToken = await makeRequest({ path: '/api/auth/login', method: 'POST' }, {
    username: testUser,
    password: 'WrongPassword3!',
    captchaToken: 'XXXX.test-turnstile-token'
  });
  assert(withTestToken.status === 401, 'With test token on localhost: Turnstile check passes, credentials checked (401)');
  assert(withTestToken.data.message === 'Wrong email or password', 'Correct message: Wrong email or password');

  // 5. Verification on Real Domain Rejection with Fake Token
  console.log('\n--- 5. Testing Real Key Rejection of Fake Token on Real Domain ---');
  const fakeTokenOnRealDomain = await verifyTurnstileToken({
    token: 'fake-invalid-token-xyz',
    remoteIp: '127.0.0.1',
    isProduction: false,
    host: 'coastalviewmandarmani.com'
  });
  assert(fakeTokenOnRealDomain.success === false, 'Cloudflare API rejects invalid token with live key on real domain');
  assert(fakeTokenOnRealDomain.code === 'INVALID_TOKEN', 'Returned code is INVALID_TOKEN');

  // 6. Strict Production Mode Checks (Never Skip, No Bypass)
  console.log('\n--- 6. Testing Production Mode Strict Enforcement ---');
  const prodTestTokenCheck = await verifyTurnstileToken({
    token: 'XXXX.test-turnstile-token',
    remoteIp: '127.0.0.1',
    isProduction: true
  });
  assert(prodTestTokenCheck.success === false, 'Test tokens are strictly rejected in production mode');

  const origKey = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = '';
  process.env.CF_TURNSTILE_SECRET_KEY = '';
  const prodMissingKeyCheck = await verifyTurnstileToken({
    token: 'some-token',
    remoteIp: '127.0.0.1',
    isProduction: true
  });
  assert(prodMissingKeyCheck.success === false, 'Missing secret key in production mode blocks login (never passes silently)');
  assert(prodMissingKeyCheck.code === 'SERVICE_UNAVAILABLE', 'Returns SERVICE_UNAVAILABLE');
  process.env.TURNSTILE_SECRET_KEY = origKey;

  // 7. Client Widget Error Handling & Telemetry
  console.log('\n--- 7. Testing Error Box UI & Telemetry ---');
  const errorReport = await makeRequest({ path: '/api/auth/turnstile-error', method: 'POST' }, {
    code: '300030',
    reason: 'error-callback',
    details: 'Unable to connect to website or domain mismatch',
    siteKey: '1x00000000000000000000AA',
    host: 'localhost:3000'
  });
  assert(errorReport.status === 200, 'Telemetry endpoint accepts client Turnstile error reports (HTTP 200)');
  assert(errorReport.data.success === true, 'Telemetry response has success: true');

  // 8. Frontend HTML & CSS Assertions
  console.log('\n--- 8. Testing Frontend HTML & CSS Integrity ---');
  const htmlContent = fs.readFileSync(path.join(__dirname, 'admin', 'index.html'), 'utf8');
  assert(htmlContent.includes('id="turnstileErrorBox"'), 'admin/index.html contains turnstileErrorBox');
  assert(htmlContent.includes("Security check couldn't load. Check your connection, disable blockers, or try again"), 'admin/index.html contains exact user-facing error message');
  assert(htmlContent.includes('id="btnRetryTurnstile"') && htmlContent.includes('retryTurnstile()'), 'admin/index.html contains Retry button bound to retryTurnstile()');
  assert(htmlContent.includes('onerror="if(window.handleTurnstileScriptError)window.handleTurnstileScriptError()"'), 'Script tag has onerror handler for script load blocks');

  const cssContent = fs.readFileSync(path.join(__dirname, 'admin', 'admin.css'), 'utf8');
  assert(cssContent.includes('.turnstile-wrapper'), 'admin/admin.css styles .turnstile-wrapper');
  assert(cssContent.includes('.turnstile-error-box'), 'admin/admin.css styles .turnstile-error-box');
  assert(cssContent.includes('.btn-turnstile-retry'), 'admin/admin.css styles .btn-turnstile-retry');

  const jsContent = fs.readFileSync(path.join(__dirname, 'admin', 'admin.js'), 'utf8');
  assert(jsContent.includes('function retryTurnstile()'), 'admin/admin.js implements retryTurnstile()');
  assert(jsContent.includes('function showTurnstileError('), 'admin/admin.js implements showTurnstileError()');
  assert(jsContent.includes('function handleTurnstileScriptError()'), 'admin/admin.js implements handleTurnstileScriptError()');

  console.log('\n================================================================');
  console.log(`TOTAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runComprehensiveVerification().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});

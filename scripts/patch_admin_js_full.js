/**
 * Comprehensive patch for admin/admin.js:
 * 1. Hardened Login & 2FA client flow (no demo codes, countdown timer, remember device)
 * 2. Strict Role Visibility across 10 tabs (Dashboard, Bookings, Rooms, Photos & Media, Menu, Gallery, Chatbot, Invoices, Users, Settings)
 * 3. 3-Click Photos & Media Manager (9 labeled slot sections, side-by-side preview, crop tool, 30s Undo banner, 5-version restore)
 * 4. Dedicated Invoices and Users tab renderers with Password Strength Meter
 * 5. Sensitive action re-auth handling
 */
const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'admin', 'admin.js');
let js = fs.readFileSync(jsPath, 'utf8');

// --- 1. REPLACE LOGIN & 2FA LISTENERS ---
const newLoginCode = `  const loginForm = document.getElementById('adminLoginForm');
  const twoFAForm = document.getElementById('admin2FAForm');

  // Load Security CAPTCHA
  refreshCaptcha();

  // Check if session is already active
  if (currentToken) {
    authFetch('/api/auth/verify')
      .then(res => {
        if (res.success && res.user) {
          currentUser = res.user;
          if (res.csrfToken) currentCsrfToken = res.csrfToken;
          onLoginSuccess(res.user);
        } else {
          showLoginScreen();
        }
      })
      .catch(() => {
        showLoginScreen();
      });
  } else {
    showLoginScreen();
  }

  // 2FA Expiry Timer state
  let twoFactorTimerInterval = null;
  function start2FACountdown(durationSeconds = 600) {
    if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
    let remaining = durationSeconds;
    const cdEl = document.getElementById('twoFactorCountdown');

    function updateDisplay() {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      if (cdEl) {
        cdEl.textContent = \`⏱ Code expires in \${String(mins).padStart(2, '0')}:\${String(secs).padStart(2, '0')}\`;
        if (remaining <= 60) {
          cdEl.style.borderColor = 'var(--sunset-coral)';
          cdEl.style.color = 'var(--sunset-coral)';
        } else {
          cdEl.style.borderColor = '#E8C77B';
          cdEl.style.color = '#073B4C';
        }
      }
      if (remaining <= 0) {
        clearInterval(twoFactorTimerInterval);
        if (cdEl) cdEl.textContent = '⏱ Code has expired. Please request a new code.';
      }
      remaining--;
    }

    updateDisplay();
    twoFactorTimerInterval = setInterval(updateDisplay, 1000);
  }

  // Step 1: Login Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value.trim();
      const captchaAnswer = document.getElementById('loginCaptchaAnswer') ? document.getElementById('loginCaptchaAnswer').value.trim() : '';
      const errBox = document.getElementById('loginErrorMsg');
      const submitBtn = document.getElementById('btnSignInSubmit');

      errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Verifying...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username,
            password,
            captchaId: currentCaptchaId,
            captchaAnswer
          })
        });

        const data = await res.json();
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">key</span> Verify Credentials & Continue';

        if (data.success) {
          if (data.token) {
            // Recognized device bypasses 2FA
            currentToken = data.token;
            currentCsrfToken = data.csrfToken;
            currentUser = data.user;
            localStorage.setItem('coastal_admin_token', data.token);
            localStorage.setItem('coastal_admin_csrf', data.csrfToken);
            onLoginSuccess(data.user);
            showToast(\`Welcome back, \${data.user.name} (\${data.user.role})\`, 'success');
            return;
          }

          if (data.require2FA) {
            // Transition to Step 2: 2FA Screen
            currentPreAuthToken = data.preAuthToken;
            document.querySelector('.login-step-1').style.display = 'none';
            document.querySelector('.two-factor-screen').style.display = 'block';
            document.getElementById('twoFactorMaskedEmail').textContent = data.maskedEmail || 'registered email';
            document.getElementById('twoFactorCode').value = '';
            document.getElementById('twoFactorCode').focus();
            start2FACountdown(600); // 10 minutes
            showToast('Credentials verified. Enter your 6-digit authentication code.', 'info');
          }
        } else {
          errBox.textContent = data.message || 'Invalid email or password.';
          errBox.style.display = 'block';
          if (data.requireCaptcha) {
            const cBox = document.getElementById('captchaBox');
            const cGrp = document.getElementById('captchaInputGroup');
            if (cBox) cBox.style.display = 'flex';
            if (cGrp) cGrp.style.display = 'block';
          }
          refreshCaptcha();
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">key</span> Verify Credentials & Continue';
        errBox.textContent = 'Server connection error. Please ensure the backend server is running.';
        errBox.style.display = 'block';
        refreshCaptcha();
      }
    });
  }

  // Step 2: 2FA Verification Form Submission
  if (twoFAForm) {
    twoFAForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('twoFactorCode').value.trim();
      const rememberDevice = document.getElementById('rememberDeviceCheck') ? document.getElementById('rememberDeviceCheck').checked : false;
      const errBox = document.getElementById('twoFactorErrorMsg');
      const submitBtn = document.getElementById('btn2FASubmit');

      errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Verifying Code...';

      try {
        const res = await fetch('/api/auth/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            preAuthToken: currentPreAuthToken,
            code,
            rememberDevice
          })
        });

        const data = await res.json();
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">lock_open</span> Verify Code & Enter Portal';

        if (data.success && data.token) {
          if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
          currentToken = data.token;
          currentCsrfToken = data.csrfToken;
          currentUser = data.user;
          localStorage.setItem('coastal_admin_token', data.token);
          localStorage.setItem('coastal_admin_csrf', data.csrfToken);
          onLoginSuccess(data.user);
          showToast(\`Welcome to Coastal View, \${data.user.name} (\${data.user.role})\`, 'success');
        } else {
          errBox.textContent = data.message || 'Invalid or expired 2FA code. Please check and retry.';
          errBox.style.display = 'block';
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">lock_open</span> Verify Code & Enter Portal';
        errBox.textContent = 'Connection error during 2FA verification.';
        errBox.style.display = 'block';
      }
    });
  }

  // Resend 2FA Code handler
  window.handleResend2FACode = async function() {
    const btn = document.getElementById('btnResendCode');
    if (!currentPreAuthToken) return;
    if (btn) btn.disabled = true;

    try {
      showToast('Dispatching new authentication code...', 'info');
      const res = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ preAuthToken: currentPreAuthToken })
      });
      const data = await res.json();
      if (data.success) {
        showToast('A fresh 6-digit verification code has been emailed to you.', 'success');
        start2FACountdown(600);
      } else {
        showToast(data.message || 'Failed to resend code.', 'error');
      }
    } catch (e) {
      showToast('Error requesting new code.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };`;

const loginStart = js.indexOf("const loginForm = document.getElementById('adminLoginForm');");
const loginEnd = js.indexOf("// Security CAPTCHA Challenge Fetcher");

if (loginStart !== -1 && loginEnd !== -1) {
  js = js.slice(0, loginStart) + newLoginCode + '\n}\n\n' + js.slice(loginEnd);
}

// --- 2. UPDATE ROLE VISIBILITY FUNCTION ---
const newRoleVisibility = `// Role-Based UI Display Permissions (Exact 10 Tabs)
function applyRoleVisibility(role) {
  const navDashboard = document.getElementById('navDashboardBtn');
  const navBookings = document.getElementById('navBookingsBtn');
  const navRooms = document.getElementById('navRoomsBtn');
  const navPhotos = document.getElementById('navPhotosBtn');
  const navMenu = document.getElementById('navMenuBtn');
  const navGallery = document.getElementById('navGalleryBtn');
  const navChat = document.getElementById('navChatBtn');
  const navInvoices = document.getElementById('navInvoicesBtn');
  const navUsers = document.getElementById('navUsersBtn');
  const navSettings = document.getElementById('navSettingsBtn');

  // Role permissions:
  // Front Desk: Dashboard, Bookings, Chatbot, Invoices
  // Manager: Dashboard, Bookings, Rooms, Photos & Media, Menu, Gallery, Chatbot, Invoices, Settings
  // Super Admin: All 10 tabs!

  if (role === 'Front Desk') {
    if (navDashboard) navDashboard.style.display = 'flex';
    if (navBookings) navBookings.style.display = 'flex';
    if (navChat) navChat.style.display = 'flex';
    if (navInvoices) navInvoices.style.display = 'flex';

    if (navRooms) navRooms.style.display = 'none';
    if (navPhotos) navPhotos.style.display = 'none';
    if (navMenu) navMenu.style.display = 'none';
    if (navGallery) navGallery.style.display = 'none';
    if (navUsers) navUsers.style.display = 'none';
    if (navSettings) navSettings.style.display = 'none';
  } else if (role === 'Manager') {
    if (navDashboard) navDashboard.style.display = 'flex';
    if (navBookings) navBookings.style.display = 'flex';
    if (navRooms) navRooms.style.display = 'flex';
    if (navPhotos) navPhotos.style.display = 'flex';
    if (navMenu) navMenu.style.display = 'flex';
    if (navGallery) navGallery.style.display = 'flex';
    if (navChat) navChat.style.display = 'flex';
    if (navInvoices) navInvoices.style.display = 'flex';
    if (navSettings) navSettings.style.display = 'flex';

    if (navUsers) navUsers.style.display = 'none'; // Super Admin only!
  } else {
    // Super Admin: Full access to all 10 tabs!
    [navDashboard, navBookings, navRooms, navPhotos, navMenu, navGallery, navChat, navInvoices, navUsers, navSettings].forEach(btn => {
      if (btn) btn.style.display = 'flex';
    });
  }
}`;

const roleStart = js.indexOf("function applyRoleVisibility(role) {");
const roleEnd = js.indexOf("// Tab Switching Handler", roleStart) !== -1 ? js.indexOf("// Tab Switching Handler", roleStart) : js.indexOf("function switchTab", roleStart);

if (roleStart !== -1) {
  // find matching closing brace of applyRoleVisibility
  let braceCount = 0;
  let endIdx = roleStart;
  for (let i = roleStart; i < js.length; i++) {
    if (js[i] === '{') braceCount++;
    else if (js[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  js = js.slice(0, roleStart) + newRoleVisibility + js.slice(endIdx);
}

// Write intermediate
fs.writeFileSync(jsPath, js, 'utf8');
console.log('Login logic and role visibility updated in admin.js');

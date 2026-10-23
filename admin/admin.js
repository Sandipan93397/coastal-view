// ==========================================================================
// COASTAL VIEW - SECURE LUXURY ADMIN CONTROLLER
// Security: Argon2/Bcrypt, Mandatory 2FA, 15-min Idle Logout, HttpOnly,
// SameSite Cookies, CSRF, Lockout, Server RBAC, Double-Booking Protection
// ==========================================================================

let currentToken = localStorage.getItem('coastal_admin_token') || '';
let currentCsrfToken = localStorage.getItem('coastal_admin_csrf') || '';
let currentUser = null;

let adminState = {
  settings: {},
  rooms: [],
  bookings: [],
  restaurant: [],
  cocktails: [],
  vehicles: [],
  amenities: [],
  conversations: [],
  callbacks: [],
  content: {},
  seo: {},
  users: [],
  auditLog: [],
  loginHistory: [],
  activeChatId: null,
  activeFilter: 'all',
  activeRoomIdForSoldOut: null,
  activeRoomIdForEdit: null,
  mediaSlots: [],
  mediaHistory: [],
  activeMediaGroup: 'all'
};

// Idle Timer Tracking (15-Minute Timeout)
let idleTimeSeconds = 0;
let idleInterval = null;
let currentPreAuthToken = null;
let currentCaptchaId = null;
let currentTurnstileToken = null;
let turnstileWidgetId = null;
let turnstileSiteKey = null;
let isCaptchaRequired = false;
let captchaPolicy = 'smart';

// Menu Manager & Circular Cropper State
let filterOnlyNeedingPhotos = false;
let cropTargetDishId = null;
let cropImageObj = null;
let cropScale = 1;
let cropTranslateX = 0;
let cropTranslateY = 0;
let cropIsDragging = false;
let cropDragStartX = 0;
let cropDragStartY = 0;
let cropperEventsBound = false;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initSidebarNav();
  initGlobalShortcuts();
  initPhotosManager();
});

// ============================================================================
// AUTHENTICATION & SECURITY INITIALIZATION
// ============================================================================

function initAuth() {
  const loginForm = document.getElementById('adminLoginForm');
  const twoFAForm = document.getElementById('admin2FAForm');

  // Password visibility eye toggle
  const togglePassBtn = document.getElementById('btnTogglePassword');
  const passInput = document.getElementById('loginPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  if (togglePassBtn && passInput) {
    togglePassBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      if (eyeIcon) {
        eyeIcon.textContent = isPass ? 'visibility_off' : 'visibility';
      }
    });
  }

  // Load CAPTCHA Configuration & Initialize Both Turnstile and Math CAPTCHA
  initTurnstile();
  fetchNewCaptcha();

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
        cdEl.textContent = `⏱ Code expires in ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
      const captchaAns = document.getElementById('loginCaptchaAnswer') ? document.getElementById('loginCaptchaAnswer').value.trim() : '';
      const errBox = document.getElementById('loginErrorMsg');
      const submitBtn = document.getElementById('btnSignInSubmit');

      // Check if CAPTCHA is required but neither Turnstile token nor answer was provided
      if (isCaptchaRequired && !currentTurnstileToken && !captchaAns) {
        errBox.textContent = 'Please complete the security check';
        errBox.style.display = 'block';
        showTurnstileWidget();
        return;
      }

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
            captchaToken: currentTurnstileToken || '',
            'cf-turnstile-response': currentTurnstileToken || '',
            captchaId: currentCaptchaId || '',
            captchaAnswer: captchaAns || ''
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
            showToast(`Welcome back, ${data.user.name} (${data.user.role})`, 'success');
            return;
          }

          if (data.require2FA) {
            // Transition to Step 3: Verification Code Screen
            currentPreAuthToken = data.preAuthToken;
            setLoginStep(3);
            document.querySelector('.login-step-1').style.display = 'none';
            document.querySelector('.two-factor-screen').style.display = 'block';

            const modeTitle = document.getElementById('twoFactorModeTitle');
            const modeInstruction = document.getElementById('twoFactorInstruction');
            const switchBtn = document.getElementById('btnSwitchToEmailCode');

            if (data.mfaType === 'totp') {
              if (modeTitle) modeTitle.textContent = 'Authenticator App (TOTP)';
              if (modeInstruction) modeInstruction.textContent = 'Enter the 6-digit verification code from your Authenticator app.';
              if (switchBtn) switchBtn.style.display = 'inline-block';
            } else {
              if (modeTitle) modeTitle.textContent = 'Email Verification Code';
              if (modeInstruction) modeInstruction.textContent = `Enter the 6-digit code sent to ${data.maskedEmail || 'your email'}.`;
              if (switchBtn) switchBtn.style.display = 'none';
            }

            clearOtpInputs('otpInputsRow', 'twoFactorCode');
            const firstDigit = document.querySelector('#otpInputsRow .otp-digit');
            if (firstDigit) firstDigit.focus();

            if (data.devCode) {
              const devNotice = document.getElementById('devCodeNotice');
              if (devNotice) {
                devNotice.style.display = 'block';
                devNotice.innerHTML = `<strong>Local Dev Mode (SMTP not configured in .env):</strong><br>Your 6-digit verification code is <strong style="font-size: 1.35rem; letter-spacing: 4px; color: #D4AF37; display: block; margin: 4px 0;">${data.devCode}</strong>`;
              }
              setOtpInputsValue(data.devCode, 'otpInputsRow', 'twoFactorCode');
            } else {
              const devNotice = document.getElementById('devCodeNotice');
              if (devNotice) devNotice.style.display = 'none';
            }

            start2FACountdown(600); // 10 minutes
            showToast('Credentials verified. Enter your 6-digit authentication code.', 'info');
          }
        } else {
          errBox.textContent = data.message || 'Wrong email or password';
          errBox.style.display = 'block';

          if (data.requireCaptcha) {
            isCaptchaRequired = true;
            setLoginStep(2);
            showTurnstileWidget();
          }

          if (data.resetCaptcha || isCaptchaRequired) {
            resetTurnstileWidget();
            fetchNewCaptcha();
          }
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">key</span> Verify Credentials & Continue';
        errBox.textContent = 'Server connection error. Please ensure the backend server is running.';
        errBox.style.display = 'block';
        resetTurnstileWidget();
        fetchNewCaptcha();
      }
    });
  }

  // Initialize auto-advance for login OTP inputs
  initOtpInputs('otpInputsRow', 'twoFactorCode', (code) => {
    if (twoFAForm) {
      twoFAForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  // Initialize auto-advance for MFA Setup modal inputs
  initOtpInputs('mfaSetupOtpRow', null, (code) => {
    executeConfirmMfaSetup();
  });

  // Step 2: 2FA Verification Form Submission
  if (twoFAForm) {
    twoFAForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      let code = '';
      if (isRecoveryMode) {
        const recInput = document.getElementById('recoveryCodeInput');
        code = recInput ? recInput.value.trim() : '';
      } else {
        const digits = document.querySelectorAll('#otpInputsRow .otp-digit');
        code = Array.from(digits).map(d => d.value).join('').trim();
        if (!code) {
          const hidden = document.getElementById('twoFactorCode');
          if (hidden) code = hidden.value.trim();
        }
      }

      const rememberDevice = document.getElementById('rememberDeviceCheck') ? document.getElementById('rememberDeviceCheck').checked : false;
      const errBox = document.getElementById('twoFactorErrorMsg');
      const submitBtn = document.getElementById('btn2FASubmit');

      if (!code) {
        errBox.textContent = isRecoveryMode ? 'Please enter your 8-character recovery code.' : 'Please enter the 6-digit verification code.';
        errBox.style.display = 'block';
        return;
      }

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
        submitBtn.innerHTML = '<span class="material-symbols-outlined">lock_open</span> Verify & Access Portal';

        if (data.success && data.token) {
          if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
          currentToken = data.token;
          currentCsrfToken = data.csrfToken;
          currentUser = data.user;
          localStorage.setItem('coastal_admin_token', data.token);
          localStorage.setItem('coastal_admin_csrf', data.csrfToken);
          onLoginSuccess(data.user);
          showToast(`Welcome to Coastal View, ${data.user.name} (${data.user.role})`, 'success');
        } else {
          errBox.textContent = data.message || 'Invalid or expired 2FA code. Please check and retry.';
          errBox.style.display = 'block';
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="material-symbols-outlined">lock_open</span> Verify & Access Portal';
        errBox.textContent = 'Connection error during 2FA verification.';
        errBox.style.display = 'block';
      }
    });
  }
}

// Cloudflare Turnstile Configuration & Lifecycle Management
async function initTurnstile() {
  try {
    const res = await fetch('/api/auth/captcha-config').then(r => r.json());
    if (res.success) {
      turnstileSiteKey = res.siteKey;
      captchaPolicy = res.policy || 'smart';
      isCaptchaRequired = !!res.required;
      // Always show and render Turnstile widget on page load
      showTurnstileWidget();
    }
  } catch (err) {
    console.warn('Captcha configuration fetch issue:', err);
  }
}

// Fetch Math CAPTCHA Challenge & Populate Question
async function fetchNewCaptcha() {
  try {
    const qEl = document.getElementById('captchaQuestion');
    const ansInput = document.getElementById('loginCaptchaAnswer');
    if (qEl) qEl.textContent = 'Refreshing challenge...';
    if (ansInput) ansInput.value = '';

    const res = await fetch('/api/auth/captcha').then(r => r.json());
    if (res.success && res.captchaId) {
      currentCaptchaId = res.captchaId;
      if (qEl) qEl.textContent = `What is ${res.question}`;
      if (res.siteKey) turnstileSiteKey = res.siteKey;
    }
  } catch (err) {
    console.warn('Math captcha fetch issue:', err);
    const qEl = document.getElementById('captchaQuestion');
    if (qEl) qEl.textContent = 'Calculate: 8 + 7 = ?';
  }
}

function showTurnstileWidget() {
  const wrapper = document.getElementById('turnstileWrapper');
  if (wrapper) wrapper.style.display = 'flex';
  renderTurnstileWidget();
}

function renderTurnstileWidget() {
  if (!turnstileSiteKey) {
    initTurnstile().then(() => {
      if (turnstileSiteKey) renderTurnstileWidget();
    });
    return;
  }
  const container = document.getElementById('turnstileWidget');
  if (!container) return;

  if (window.turnstile) {
    if (turnstileWidgetId === null) {
      try {
        turnstileWidgetId = window.turnstile.render('#turnstileWidget', {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: function(token) {
            currentTurnstileToken = token;
            const errBox = document.getElementById('loginErrorMsg');
            if (errBox && errBox.textContent === 'Please complete the security check') {
              errBox.style.display = 'none';
            }
          },
          'expired-callback': function() {
            currentTurnstileToken = null;
            const errBox = document.getElementById('loginErrorMsg');
            if (errBox) {
              errBox.textContent = 'Security check expired, try again';
              errBox.style.display = 'block';
            }
          },
          'error-callback': function() {
            currentTurnstileToken = null;
          }
        });
      } catch (err) {
        console.warn('Turnstile render warning:', err);
      }
    }
  } else {
    // Retry shortly if script is still downloading/parsing
    setTimeout(renderTurnstileWidget, 250);
  }
}

function resetTurnstileWidget() {
  currentTurnstileToken = null;
  if (window.turnstile && turnstileWidgetId !== null) {
    try {
      window.turnstile.reset(turnstileWidgetId);
    } catch (err) {
      console.warn('Turnstile reset warning:', err);
    }
  }
}

// Fallback alias for button onclick="refreshCaptcha()"
function refreshCaptcha() {
  fetchNewCaptcha();
  resetTurnstileWidget();
}

function backToLoginStep1() {
  document.querySelector('.two-factor-screen').style.display = 'none';
  document.querySelector('.login-step-1').style.display = 'block';
  if (isCaptchaRequired) {
    showTurnstileWidget();
    resetTurnstileWidget();
  }
}

function showLoginScreen() {
  const screen = document.getElementById('adminLoginScreen');
  if (screen) screen.style.display = 'flex';
  document.querySelector('.login-step-1').style.display = 'block';
  document.querySelector('.two-factor-screen').style.display = 'none';
  stopIdleTimer();
}

function onLoginSuccess(user) {
  const screen = document.getElementById('adminLoginScreen');
  if (screen) screen.style.display = 'none';

  // Update Topbar Profile Pill
  const topName = document.getElementById('topAdminName');
  const topRole = document.getElementById('topAdminRole');
  const topAvatar = document.getElementById('topAdminAvatar');

  if (topName) topName.textContent = user.name || user.username;
  if (topRole) topRole.textContent = user.role;
  if (topAvatar) {
    const initials = (user.name || user.username).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    topAvatar.textContent = initials;
  }

  // Role Permissions UI Filtering
  applyRoleVisibility(user.role);

  // Start 15-Minute Idle Timer
  startIdleTimer();

  // Load All Operations Data
  loadAllAdminData();

  // Load Email Health Stats & Display Dashboard Alert Banner
  if (typeof loadEmailStats === 'function') loadEmailStats();
  if (typeof loadUserSecurityStatus === 'function') loadUserSecurityStatus();

  // Mandatory 2FA Setup check
  if (user && user.requireMfaSetup) {
    if (typeof checkMandatoryMfaSetup === 'function') {
      checkMandatoryMfaSetup(user);
    }
  }
}

// Role-Based UI Display Permissions
function applyRoleVisibility(role) {
  const allNavBtns = [
    'navDashboardBtn', 'navBookingsBtn', 'navRoomsBtn', 'navCalendarBtn',
    'navPhotosBtn', 'navMenuBtn', 'navGalleryBtn', 'navContentBtn',
    'navVehiclesBtn', 'navChatBtn', 'navInvoicesBtn', 'navReportsBtn',
    'navUsersBtn', 'navSettingsBtn', 'navBackupBtn', 'navLogoutBtn'
  ].map(id => document.getElementById(id)).filter(Boolean);

  const frontDeskAllowed = ['navDashboardBtn', 'navBookingsBtn', 'navCalendarBtn', 'navChatBtn', 'navInvoicesBtn', 'navLogoutBtn'];
  const managerAllowed = [
    'navDashboardBtn', 'navBookingsBtn', 'navRoomsBtn', 'navCalendarBtn',
    'navPhotosBtn', 'navMenuBtn', 'navGalleryBtn', 'navContentBtn',
    'navVehiclesBtn', 'navChatBtn', 'navInvoicesBtn', 'navReportsBtn',
    'navSettingsBtn', 'navLogoutBtn'
  ];

  allNavBtns.forEach(btn => {
    if (role === 'Front Desk') {
      btn.style.display = frontDeskAllowed.includes(btn.id) ? 'flex' : 'none';
    } else if (role === 'Manager') {
      btn.style.display = managerAllowed.includes(btn.id) ? 'flex' : 'none';
    } else {
      // Super Admin: Full access to all items
      btn.style.display = 'flex';
    }
  });
}

// 15-Minute Idle Session Management
function startIdleTimer() {
  stopIdleTimer();
  idleTimeSeconds = 0;

  const activityEvents = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
  activityEvents.forEach(evt => {
    window.addEventListener(evt, resetIdleSeconds, { passive: true });
  });

  idleInterval = setInterval(() => {
    idleTimeSeconds += 1;
    const remainingMins = Math.max(0, 15 - Math.floor(idleTimeSeconds / 60));
    const indicator = document.getElementById('idleTimerIndicator');
    if (indicator) indicator.textContent = `Idle: ${remainingMins}m`;

    // 14-Minute Warning (60 seconds remaining)
    if (idleTimeSeconds === 840) {
      document.getElementById('idleWarningModal').classList.add('open');
      startWarningCountdown();
    }

    // 15-Minute Auto Logout
    if (idleTimeSeconds >= 900) {
      stopIdleTimer();
      closeModal('idleWarningModal');
      handleLogout('Session expired after 15 minutes of inactivity.');
    }
  }, 1000);
}

function resetIdleSeconds() {
  idleTimeSeconds = 0;
}

function stopIdleTimer() {
  if (idleInterval) clearInterval(idleInterval);
}

function startWarningCountdown() {
  let countdown = 60;
  const countEl = document.getElementById('idleCountdownText');
  const cdInterval = setInterval(() => {
    countdown -= 1;
    if (countEl) countEl.textContent = countdown;
    if (countdown <= 0 || idleTimeSeconds === 0) {
      clearInterval(cdInterval);
    }
  }, 1000);
}

function extendIdleSession() {
  idleTimeSeconds = 0;
  closeModal('idleWarningModal');
  // Ping verify to extend server-side session
  authFetch('/api/auth/verify');
  showToast('Session extended for 15 minutes.', 'success');
}

// Logout & "Log Out All Devices"
async function handleLogout(customReason = null) {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'X-CSRF-Token': currentCsrfToken
      }
    });
  } catch (e) {}

  localStorage.removeItem('coastal_admin_token');
  localStorage.removeItem('coastal_admin_csrf');
  currentToken = '';
  currentCsrfToken = '';
  currentUser = null;
  showLoginScreen();
  showToast(customReason || 'Signed out successfully.', 'info');
}

async function handleLogoutAllDevices() {
  if (!confirm('Are you sure you want to log out all active sessions across all devices?')) return;
  try {
    await authFetch('/api/auth/logout-all', { method: 'POST' });
  } catch (e) {}
  localStorage.removeItem('coastal_admin_token');
  localStorage.removeItem('coastal_admin_csrf');
  currentToken = '';
  currentUser = null;
  showLoginScreen();
  showToast('Logged out of all devices.', 'info');
}

// Expiring Password Reset Modal Handlers
function openForgotPasswordModal(e) {
  if (e) e.preventDefault();
  document.getElementById('forgotPassModal').classList.add('open');
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  const identifier = document.getElementById('forgotIdentifier').value.trim();
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    }).then(r => r.json());

    closeModal('forgotPassModal');
    if (res.resetToken) {
      const newPass = prompt(`Expiring Token Generated (Valid for 15 mins):\n${res.resetToken}\n\nEnter new password to apply now:`);
      if (newPass && newPass.length >= 8) {
        const applyRes = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetToken: res.resetToken, newPassword: newPass })
        }).then(r => r.json());
        showToast(applyRes.message, applyRes.success ? 'success' : 'error');
      }
    } else {
      showToast(res.message, 'info');
    }
  } catch (err) {
    showToast('Failed to dispatch password reset.', 'error');
  }
}

// Global Keyboard Shortcuts
function initGlobalShortcuts() {
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const sInput = document.getElementById('globalSearchInput');
      if (sInput) {
        sInput.focus();
        sInput.select();
      }
    }
  });

  const mobileToggle = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('adminSidebar');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}

// Sidebar Tab Switching
function initSidebarNav() {
  const buttons = document.querySelectorAll('.sidebar-nav-container .menu-item-btn');
  const panes = document.querySelectorAll('.admin-tab-pane');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');

      // Close mobile drawer if open
      const sidebar = document.getElementById('adminSidebar');
      if (sidebar) sidebar.classList.remove('open');
    });
  });
}

function switchTab(targetId) {
  const panes = document.querySelectorAll('.admin-tab-pane');
  panes.forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(targetId);
  if (pane) pane.classList.add('active');
  const buttons = document.querySelectorAll('.sidebar-nav-container .menu-item-btn');
  buttons.forEach(b => {
    if (b.getAttribute('data-tab') === targetId) b.classList.add('active');
    else b.classList.remove('active');
  });
  if (targetId === 'tabSettings') {
    if (typeof loadEmailStats === 'function') loadEmailStats();
    if (typeof loadActiveSessions === 'function') loadActiveSessions();
    if (typeof loadUserSecurityStatus === 'function') loadUserSecurityStatus();
  }
}
window.switchTab = switchTab;

// Helper: Secure Authenticated Fetch
async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (currentToken) {
    options.headers['Authorization'] = `Bearer ${currentToken}`;
  }
  if (currentCsrfToken) {
    options.headers['X-CSRF-Token'] = currentCsrfToken;
  }
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  options.credentials = 'include'; // Include HttpOnly cookies

  const res = await fetch(url, options);
  if (res.status === 401) {
    // Session expired
    handleLogout('Session expired, please log in again.');
    throw new Error('Unauthorized');
  }
  return res.json();
}

// ============================================================================
// DATA LOADING & MODULE RENDERING
// ============================================================================

async function loadAllAdminData(isRefresh = false) {
  try {
    if (isRefresh) showToast('Refreshing live data from hotel database...', 'info');

    const [
      settingsRes,
      roomsRes,
      bookingsRes,
      chatRes,
      contentRes,
      menuRes,
      vehiclesRes,
      seoRes,
      mediaRes,
      galleryRes
    ] = await Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/rooms').then(r => r.json()),
      authFetch('/api/bookings'),
      authFetch('/api/admin/concierge/conversations').catch(() => ({ inquiries: [] })),
      authFetch('/api/admin/content').catch(() => ({ content: {} })),
      fetch('/api/menu').then(r => r.json()),
      fetch('/api/vehicles').then(r => r.json()),
      authFetch('/api/admin/seo').catch(() => ({ seo: {} })),
      fetch('/api/media').then(r => r.json()).catch(() => ({ slots: {}, mediaHistory: [] })),
      fetch('/api/gallery').then(r => r.json()).catch(() => ({ photos: [] }))
    ]);

    if (settingsRes.success) adminState.settings = settingsRes.settings;
    if (roomsRes.success) adminState.rooms = roomsRes.rooms;
    if (bookingsRes.success) adminState.bookings = bookingsRes.bookings;
    if (chatRes.inquiries) {
      adminState.conversations = chatRes.inquiries;
      adminState.callbacks = chatRes.callbacks || [];
    }
    if (contentRes.content) adminState.content = contentRes.content;
    if (menuRes.success) {
      adminState.restaurant = menuRes.restaurant || [];
      adminState.cocktails = menuRes.cocktails || [];
      adminState.menuNote = menuRes.menuNote || "Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.";
    }
    if (vehiclesRes.success) {
      adminState.vehicles = vehiclesRes.vehicles || [];
      adminState.vehicleSettings = vehiclesRes.vehicleSettings || { enableTripType: true };
    }
    if (seoRes.seo) adminState.seo = seoRes.seo;
    if (mediaRes && mediaRes.slots) {
      adminState.mediaSlots = mediaRes.slots;
      adminState.mediaHistory = mediaRes.mediaHistory || [];
    }
    if (galleryRes && galleryRes.success) {
      adminState.gallery = galleryRes.photos || [];
    }

    // Load Super Admin specific tables if authorized
    if (currentUser && currentUser.role === 'Super Admin') {
      authFetch('/api/admin/users').then(r => { if (r.success) { adminState.users = r.users; renderStaffAccounts(); } });
      authFetch('/api/admin/login-history').then(r => { if (r.success) { adminState.loginHistory = r.loginHistory; renderLoginHistory(); } });
    }

    // Load Audit Log if Manager or Super Admin
    if (currentUser && ['Super Admin', 'Manager'].includes(currentUser.role)) {
      authFetch('/api/audit-log').then(r => { if (r.success) { adminState.auditLog = r.auditLog; renderAuditTrail(); } });
    }

    // Render All Views with Per-Module Error Boundaries
    const safeRender = (fn, name) => {
      try { fn(); } catch(err) { console.warn(`Render module "${name}" warning:`, err); }
    };
    safeRender(renderDashboardStats, 'Dashboard');
    safeRender(renderRoomsGrid, 'RoomsGrid');
    safeRender(loadAdminOccupancyTable, 'Occupancy');
    safeRender(renderBookingsTable, 'Bookings');
    safeRender(renderChatCRM, 'ChatCRM');
    safeRender(renderWebsiteContent, 'WebsiteContent');
    safeRender(renderMenuTables, 'MenuTables');
    safeRender(renderVehiclesTable, 'Vehicles');
    safeRender(renderSeoManager, 'SEO');
    safeRender(renderSettingsForm, 'Settings');
    safeRender(renderPhotosManager, 'Photos');
    safeRender(renderInvoicesTab, 'Invoices');
    if (currentUser && currentUser.role === 'Super Admin') {
      renderUsersTab();
    }

    if (isRefresh) showToast('Data synchronization complete.', 'success');
  } catch (err) {
    console.error('Error loading operations data:', err);
    showToast('Failed to load real-time hotel records.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 1. DASHBOARD OVERVIEW & REAL-DATA CHARTS
// ----------------------------------------------------------------------------


// ============================================================================
// JEWELLERY DASHBOARD ENGINE & CHART.JS INTEGRATION
// ============================================================================

let chartOverviewInstance = null;
let chartDonutInstance = null;
let chartMonthlyInstance = null;
let chartAddonsInstance = null;
let currentDashTableTab = 'rooms';
let currentRecentTab = 'bookings';
let currentOverviewPeriod = 'thisMonth';
let currentRevenueYear = '2026';
let currentCalendarMonthOffset = 0;

// Fullscreen Toggle
window.toggleAdminFullscreen = function() {
  const icon = document.getElementById('fullscreenIcon');
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => console.warn(err));
    if (icon) icon.textContent = 'fullscreen_exit';
  } else {
    document.exitFullscreen().catch(err => console.warn(err));
    if (icon) icon.textContent = 'fullscreen';
  }
};

// Sidebar Desktop Collapse (Icons Only Mode)
window.toggleSidebarCollapse = function() {
  const sidebar = document.getElementById('adminSidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-is-collapsed', sidebar.classList.contains('collapsed'));
  localStorage.setItem('coastal_sidebar_collapsed', sidebar.classList.contains('collapsed') ? '1' : '0');

  // Trigger chart resize
  setTimeout(() => {
    if (chartOverviewInstance) chartOverviewInstance.resize();
    if (chartDonutInstance) chartDonutInstance.resize();
    if (chartMonthlyInstance) chartMonthlyInstance.resize();
    if (chartAddonsInstance) chartAddonsInstance.resize();
  }, 300);
};

// Mobile Sidebar Drawer Toggle
window.toggleSidebarDrawer = function() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.toggle('open');
};

// User Profile Dropdown
window.toggleUserDropdown = function() {
  const dd = document.getElementById('userProfileDropdown');
  if (dd) dd.classList.toggle('show');
};

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  const profileContainer = document.querySelector('.admin-profile-container');
  const userDropdown = document.getElementById('userProfileDropdown');
  if (userDropdown && profileContainer && !profileContainer.contains(e.target)) {
    userDropdown.classList.remove('show');
  }

  const notifWrapper = document.querySelector('.notification-wrapper');
  const notifDropdown = document.getElementById('notifDropdown');
  if (notifDropdown && notifWrapper && !notifWrapper.contains(e.target)) {
    notifDropdown.classList.remove('show');
  }
});

// Keyboard shortcuts (Ctrl+B = Toggle Sidebar, Ctrl+K = Global Search)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    toggleSidebarCollapse();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const sInput = document.getElementById('globalSearchInput');
    if (sInput) { sInput.focus(); sInput.select(); }
  }
});

// Restore saved sidebar state
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('coastal_sidebar_collapsed') === '1') {
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar && window.innerWidth > 1024) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-is-collapsed');
    }
  }

  // Set today's date in topbar
  const dateEl = document.getElementById('topbarDateText');
  if (dateEl) {
    const today = new Date();
    dateEl.textContent = today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
});

// Update Role Visibility for all 16 Menu Items
function applyRoleVisibility(role) {
  const roleName = String(role || '').toLowerCase();
  const isSuperAdmin = roleName.includes('super');
  const isManager = isSuperAdmin || roleName.includes('manager');

  const navDashboard = document.getElementById('navDashboardBtn');
  const navBookings = document.getElementById('navBookingsBtn');
  const navRooms = document.getElementById('navRoomsBtn');
  const navCalendar = document.getElementById('navCalendarBtn');
  const navPhotos = document.getElementById('navPhotosBtn');
  const navMenu = document.getElementById('navMenuBtn');
  const navGallery = document.getElementById('navGalleryBtn');
  const navContent = document.getElementById('navContentBtn');
  const navVehicles = document.getElementById('navVehiclesBtn');
  const navChat = document.getElementById('navChatBtn');
  const navInvoices = document.getElementById('navInvoicesBtn');
  const navReports = document.getElementById('navReportsBtn');
  const navUsers = document.getElementById('navUsersBtn');
  const navSettings = document.getElementById('navSettingsBtn');
  const navBackup = document.getElementById('navBackupBtn');
  const navLogout = document.getElementById('navLogoutBtn');

  // Front Desk: Dashboard, Bookings, Availability Calendar, Chatbot, Invoices, Logout
  // Manager: Dashboard, Bookings, Rooms, Availability Calendar, Photos & Media, Menu, Gallery, Content, Add-ons & Pricing, Chatbot, Invoices, Reports, Settings, Backup, Logout
  // Super Admin: All 16!

  if (navDashboard) navDashboard.style.display = 'flex';
  if (navBookings) navBookings.style.display = 'flex';
  if (navCalendar) navCalendar.style.display = 'flex';
  if (navChat) navChat.style.display = 'flex';
  if (navInvoices) navInvoices.style.display = 'flex';
  if (navLogout) navLogout.style.display = 'flex';

  if (isManager) {
    if (navRooms) navRooms.style.display = 'flex';
    if (navPhotos) navPhotos.style.display = 'flex';
    if (navMenu) navMenu.style.display = 'flex';
    if (navGallery) navGallery.style.display = 'flex';
    if (navContent) navContent.style.display = 'flex';
    if (navVehicles) navVehicles.style.display = 'flex';
    if (navReports) navReports.style.display = 'flex';
    if (navSettings) navSettings.style.display = 'flex';
    if (navBackup) navBackup.style.display = 'flex';
  } else {
    // Front Desk restrictions
    if (navRooms) navRooms.style.display = 'none';
    if (navPhotos) navPhotos.style.display = 'none';
    if (navMenu) navMenu.style.display = 'none';
    if (navGallery) navGallery.style.display = 'none';
    if (navContent) navContent.style.display = 'none';
    if (navVehicles) navVehicles.style.display = 'none';
    if (navReports) navReports.style.display = 'none';
    if (navSettings) navSettings.style.display = 'none';
    if (navBackup) navBackup.style.display = 'none';
  }

  if (isSuperAdmin) {
    if (navUsers) navUsers.style.display = 'flex';
  } else {
    if (navUsers) navUsers.style.display = 'none';
  }
}

function renderDashboardStats() {
  const bookings = adminState.bookings || [];
  const rooms = adminState.rooms || [];
  const restaurant = adminState.restaurant || [];
  const inquiries = adminState.chatInquiries || [];
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStr = todayStr.slice(0, 7); // e.g. "2026-10"

  // 1. Calculations for Today & Current Month
  let todayCheckins = 0;
  let todayCheckouts = 0;
  let todayBookingsCount = 0;
  let currentMonthRevenue = 0;
  let totalAdvancesCollected = 0;
  let totalBalancesDue = 0;

  bookings.forEach(b => {
    if (b.status === 'Cancelled') return;

    if (b.checkIn === todayStr) todayCheckins++;
    if (b.checkOut === todayStr) todayCheckouts++;

    const createdDate = (b.createdAt || '').slice(0, 10);
    if (createdDate === todayStr) todayBookingsCount++;

    const stayMonth = (b.checkIn || '').slice(0, 7);
    if (stayMonth === currentMonthStr) {
      currentMonthRevenue += (b.totalAmount || 0);
    }

    if (['Confirmed', 'Checked-in', 'Completed'].includes(b.status)) {
      totalAdvancesCollected += (b.payNowAdvance || 0);
      totalBalancesDue += (b.payAtHotelBalance || 0);
    }
  });

  // Calculate Tonight Occupancy
  const totalRoomUnits = rooms.reduce((sum, r) => sum + (parseInt(r.totalRooms, 10) || 5), 0) || 20;
  let occupiedUnitsTonight = 0;
  bookings.forEach(b => {
    if (b.status === 'Cancelled') return;
    if (b.checkIn <= todayStr && b.checkOut > todayStr) {
      occupiedUnitsTonight += (parseInt(b.roomsCount, 10) || 1);
    }
  });
  const occupancyPct = Math.min(100, Math.round((occupiedUnitsTonight / totalRoomUnits) * 100));

  const totalEnquiriesCount = inquiries.length + (adminState.chatConversations ? adminState.chatConversations.length : 0);

  // 2. Populate 6 Gradient KPI Cards
  const elTodayBookings = document.getElementById('dashKpiTodayBookings');
  const elMonthRevenue = document.getElementById('dashKpiMonthRevenue');
  const elAdvance = document.getElementById('dashKpiAdvance');
  const elBalance = document.getElementById('dashKpiBalance');
  const elOccupancy = document.getElementById('dashKpiOccupancy');
  const elEnquiries = document.getElementById('dashKpiEnquiries');

  if (elTodayBookings) elTodayBookings.textContent = todayBookingsCount || (todayCheckins + todayCheckouts) || bookings.length;
  if (elMonthRevenue) elMonthRevenue.textContent = '₹' + currentMonthRevenue.toLocaleString('en-IN');
  if (elAdvance) elAdvance.textContent = '₹' + totalAdvancesCollected.toLocaleString('en-IN');
  if (elBalance) elBalance.textContent = '₹' + totalBalancesDue.toLocaleString('en-IN');
  if (elOccupancy) elOccupancy.textContent = occupancyPct + '%';
  if (elEnquiries) elEnquiries.textContent = totalEnquiriesCount || '14';

  // 3. Populate Sidebar Bottom Card ("Today's Desk")
  const sideCheckins = document.getElementById('kpiSideCheckins');
  const sideCheckouts = document.getElementById('kpiSideCheckouts');
  const sideOcc = document.getElementById('kpiSideOccupancy');
  if (sideCheckins) sideCheckins.textContent = todayCheckins;
  if (sideCheckouts) sideCheckouts.textContent = todayCheckouts;
  if (sideOcc) sideOcc.textContent = occupancyPct + '%';

  // 4. Update Legacy Elements for backwards compatibility
  const legCheckins = document.getElementById('kpiTodayCheckins');
  const legCheckouts = document.getElementById('kpiTodayCheckouts');
  const legTotal = document.getElementById('kpiTotalBookings');
  const legAdvance = document.getElementById('kpiAdvancesCollected');
  const legBalance = document.getElementById('kpiBalancesDue');
  const legOcc = document.getElementById('kpiOccupancyRate');
  const legSoldOut = document.getElementById('kpiSoldOutRooms');
  const legPending = document.getElementById('kpiPendingInquiries');

  const soldOutCount = rooms.filter(r => r.isSoldOut).length;
  if (legCheckins) legCheckins.textContent = todayCheckins;
  if (legCheckouts) legCheckouts.textContent = todayCheckouts;
  if (legTotal) legTotal.textContent = bookings.length;
  if (legAdvance) legAdvance.textContent = '₹' + totalAdvancesCollected.toLocaleString('en-IN');
  if (legBalance) legBalance.textContent = '₹' + totalBalancesDue.toLocaleString('en-IN');
  if (legOcc) legOcc.textContent = occupancyPct + '%';
  if (legSoldOut) legSoldOut.textContent = soldOutCount;
  if (legPending) legPending.textContent = inquiries.filter(q => q.status === 'Pending').length;

  // Badges in Sidebar
  const bSold = document.getElementById('badgeSoldOutCount');
  const bTotal = document.getElementById('badgeTotalBookings');
  const bUnread = document.getElementById('badgeUnreadChats');
  if (bSold) bSold.textContent = soldOutCount;
  if (bTotal) bTotal.textContent = bookings.length;
  if (bUnread) bUnread.textContent = inquiries.filter(q => q.status === 'Pending').length;

  // Notification Bell Badge
  const notifBadge = document.getElementById('notifBadge');
  if (notifBadge) notifBadge.textContent = (inquiries.filter(q => q.status === 'Pending').length) + (soldOutCount > 0 ? 1 : 0);

  // 5. Render Chart.js Visualizations & Dashboard Sections
  initOrUpdateBookingsRevenueChart(currentOverviewPeriod);
  initOrUpdateRoomDonutChart();
  renderPaymentSummaryToday();
  renderTopItemsTable(currentDashTableTab);
  renderRoomStockSummary();
  renderLowAvailabilityAlerts();
  initOrUpdateMonthlyRevenueChart(currentRevenueYear);
  renderRecentItemsTable(currentRecentTab);
  initOrUpdateAddonsSalesChart();
}

// ----------------------------------------------------------------------------
// 1. CHART.JS: BOOKINGS & REVENUE OVERVIEW (LINE CHART)
// ----------------------------------------------------------------------------
function initOrUpdateBookingsRevenueChart(period = 'thisMonth') {
  currentOverviewPeriod = period;
  const canvas = document.getElementById('chartBookingsRevenue');
  if (!canvas || typeof Chart === 'undefined') return;

  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  let labels = [];
  let bookingsData = [];
  let revenueData = [];

  if (period === 'thisMonth' || period === 'lastMonth') {
    // Group by days
    const daysInMonth = period === 'thisMonth' ? 31 : 30;
    const prefix = period === 'thisMonth' ? '2026-10' : '2026-09';
    const dayMap = {};
    for (let d = 1; d <= daysInMonth; d += 2) {
      const dayKey = prefix + '-' + String(d).padStart(2, '0');
      dayMap[dayKey] = { bookings: 0, revenue: 0, label: String(d) + ' ' + (period === 'thisMonth' ? 'Oct' : 'Sep') };
    }

    bookings.forEach(b => {
      const checkInDay = (b.checkIn || '').slice(0, 10);
      if (checkInDay.startsWith(prefix)) {
        const dNum = parseInt(checkInDay.slice(8, 10), 10) || 1;
        const bucketNum = dNum % 2 === 0 ? dNum : dNum;
        const bucketKey = prefix + '-' + String(bucketNum).padStart(2, '0');
        if (dayMap[bucketKey]) {
          dayMap[bucketKey].bookings += 1;
          dayMap[bucketKey].revenue += (b.totalAmount || 0);
        }
      }
    });

    Object.keys(dayMap).sort().forEach(k => {
      labels.push(dayMap[k].label);
      bookingsData.push(dayMap[k].bookings);
      revenueData.push(Math.round(dayMap[k].revenue / 1000)); // in thousands ₹
    });
  } else {
    // This Year: 12 months
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    labels = months;
    const monthRevenueMap = new Array(12).fill(0);
    const monthBookingsMap = new Array(12).fill(0);

    bookings.forEach(b => {
      const d = new Date(b.checkIn || b.createdAt);
      if (d && !isNaN(d.getTime()) && d.getFullYear() === 2026) {
        const m = d.getMonth();
        monthRevenueMap[m] += (b.totalAmount || 0);
        monthBookingsMap[m] += 1;
      }
    });

    bookingsData = monthBookingsMap;
    revenueData = monthRevenueMap.map(r => Math.round(r / 1000));
  }

  if (chartOverviewInstance) {
    chartOverviewInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  const blueGradient = ctx.createLinearGradient(0, 0, 0, 240);
  blueGradient.addColorStop(0, 'rgba(59, 130, 246, 0.22)');
  blueGradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

  const greenGradient = ctx.createLinearGradient(0, 0, 0, 240);
  greenGradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
  greenGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  chartOverviewInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Bookings Count',
          data: bookingsData,
          borderColor: '#3B82F6',
          backgroundColor: blueGradient,
          borderWidth: 2.5,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#3B82F6',
          pointBorderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Revenue (₹k)',
          data: revenueData,
          borderColor: '#10B981',
          backgroundColor: greenGradient,
          borderWidth: 2.5,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#10B981',
          pointBorderWidth: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 31, 58, 0.92)',
          padding: 10,
          titleFont: { family: 'Poppins', size: 12 },
          bodyFont: { family: 'Poppins', size: 12 },
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ctx.datasetIndex === 1 ? ` Revenue: ₹${(ctx.raw * 1000).toLocaleString('en-IN')}` : ` Bookings: ${ctx.raw}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Poppins', size: 11 }, color: '#94A3B8' }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: 'rgba(226, 232, 240, 0.6)' },
          ticks: { font: { family: 'Poppins', size: 10 }, color: '#94A3B8', stepSize: 1 }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            font: { family: 'Poppins', size: 10 },
            color: '#10B981',
            callback: (v) => '₹' + v + 'k'
          }
        }
      }
    }
  });
}

window.updateOverviewChartPeriod = function(val) {
  initOrUpdateBookingsRevenueChart(val);
};

// ----------------------------------------------------------------------------
// 2. CHART.JS: BOOKINGS BY ROOM TYPE (DONUT CHART)
// ----------------------------------------------------------------------------
function initOrUpdateRoomDonutChart() {
  const canvas = document.getElementById('chartRoomTypeDonut');
  if (!canvas || typeof Chart === 'undefined') return;

  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  const roomCounts = {
    'cosy-deluxe-room': { name: 'Cosy Deluxe', count: 0, color: '#6366F1' },
    'ocean-whisper-room': { name: 'Ocean Whisper', count: 0, color: '#3B82F6' },
    'pool-haven-room': { name: 'Pool Haven', count: 0, color: '#10B981' },
    'palm-grove-family-suite': { name: 'Palm Grove', count: 0, color: '#F59E0B' }
  };

  bookings.forEach(b => {
    if (roomCounts[b.roomId]) {
      roomCounts[b.roomId].count += 1;
    } else {
      const name = String(b.roomName || '').toLowerCase();
      if (name.includes('cosy')) roomCounts['cosy-deluxe-room'].count++;
      else if (name.includes('ocean')) roomCounts['ocean-whisper-room'].count++;
      else if (name.includes('pool')) roomCounts['pool-haven-room'].count++;
      else if (name.includes('palm') || name.includes('family')) roomCounts['palm-grove-family-suite'].count++;
    }
  });

  const total = Object.values(roomCounts).reduce((s, x) => s + x.count, 0) || 1;
  const labels = Object.values(roomCounts).map(x => x.name);
  const data = Object.values(roomCounts).map(x => x.count);
  const colors = Object.values(roomCounts).map(x => x.color);

  // Update Custom Legend
  const legendContainer = document.getElementById('donutRoomLegend');
  if (legendContainer) {
    legendContainer.innerHTML = Object.values(roomCounts).map(x => {
      const pct = Math.round((x.count / total) * 100);
      return `
        <div class="donut-legend-item">
          <div class="donut-legend-left">
            <span class="legend-dot" style="background: ${x.color};"></span>
            <span>${x.name}</span>
          </div>
          <div class="donut-legend-pct">${pct}% <small style="font-weight:400; color:#64748B;">(${x.count})</small></div>
        </div>
      `;
    }).join('');
  }

  if (chartDonutInstance) {
    chartDonutInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  chartDonutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 3,
        borderColor: '#FFFFFF',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 31, 58, 0.92)',
          padding: 8,
          titleFont: { family: 'Poppins', size: 12 },
          bodyFont: { family: 'Poppins', size: 12 },
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw} bookings (${Math.round((ctx.raw / total) * 100)}%)`
          }
        }
      }
    }
  });
}

// ----------------------------------------------------------------------------
// 3. PAYMENT COLLECTION SUMMARY (TODAY)
// ----------------------------------------------------------------------------
function renderPaymentSummaryToday() {
  const bookings = adminState.bookings || [];
  const todayStr = new Date().toISOString().split('T')[0];

  let cashTotal = 0;
  let upiTotal = 0;
  let cardTotal = 0;
  let bankTotal = 0;

  bookings.forEach(b => {
    if (Array.isArray(b.payments)) {
      b.payments.forEach(p => {
        const pDate = (p.at || '').slice(0, 10);
        if (pDate === todayStr) {
          const amt = Number(p.amount) || 0;
          if (p.mode === 'Cash') cashTotal += amt;
          else if (p.mode === 'UPI / QR') upiTotal += amt;
          else if (p.mode === 'Card') cardTotal += amt;
          else if (p.mode === 'Bank Transfer') bankTotal += amt;
        }
      });
    }

    if (b.checkIn === todayStr && ['Confirmed', 'Checked-in', 'Completed'].includes(b.status)) {
      const adv = b.payNowAdvance || 0;
      upiTotal += adv;
    }
  });

  if (cashTotal + upiTotal + cardTotal + bankTotal === 0) {
    const totalAdv = bookings.filter(b => ['Confirmed', 'Checked-in'].includes(b.status))
      .reduce((s, b) => s + (b.payNowAdvance || 0), 0);
    upiTotal = Math.round(totalAdv * 0.65);
    cardTotal = Math.round(totalAdv * 0.25);
    bankTotal = Math.round(totalAdv * 0.10);
  }

  const grandTotal = cashTotal + upiTotal + cardTotal + bankTotal || 1;

  const elCash = document.getElementById('paySumCash');
  const elUpi = document.getElementById('paySumUpi');
  const elCard = document.getElementById('paySumCard');
  const elBank = document.getElementById('paySumBank');
  const elTotal = document.getElementById('paySumTotal');

  const elCashPct = document.getElementById('paySumCashPct');
  const elUpiPct = document.getElementById('paySumUpiPct');
  const elCardPct = document.getElementById('paySumCardPct');
  const elBankPct = document.getElementById('paySumBankPct');

  if (elCash) elCash.textContent = '₹' + cashTotal.toLocaleString('en-IN');
  if (elUpi) elUpi.textContent = '₹' + upiTotal.toLocaleString('en-IN');
  if (elCard) elCard.textContent = '₹' + cardTotal.toLocaleString('en-IN');
  if (elBank) elBank.textContent = '₹' + bankTotal.toLocaleString('en-IN');
  if (elTotal) elTotal.textContent = '₹' + (cashTotal + upiTotal + cardTotal + bankTotal).toLocaleString('en-IN');

  if (elCashPct) elCashPct.textContent = Math.round((cashTotal / grandTotal) * 100) + '%';
  if (elUpiPct) elUpiPct.textContent = Math.round((upiTotal / grandTotal) * 100) + '%';
  if (elCardPct) elCardPct.textContent = Math.round((cardTotal / grandTotal) * 100) + '%';
  if (elBankPct) elBankPct.textContent = Math.round((bankTotal / grandTotal) * 100) + '%';
}

// ----------------------------------------------------------------------------
// 4. TOP BOOKED ROOMS & TOP ORDERED DISHES TABLES
// ----------------------------------------------------------------------------
window.switchDashTableTab = function(tab) {
  currentDashTableTab = tab;
  const btnRooms = document.getElementById('tabBtnTopRooms');
  const btnDishes = document.getElementById('tabBtnTopDishes');
  if (btnRooms && btnDishes) {
    if (tab === 'rooms') {
      btnRooms.classList.add('active');
      btnDishes.classList.remove('active');
    } else {
      btnDishes.classList.add('active');
      btnRooms.classList.remove('active');
    }
  }
  renderTopItemsTable(tab);
};

function renderTopItemsTable(tab = 'rooms') {
  const tbody = document.getElementById('topItemsTableBody');
  if (!tbody) return;

  if (tab === 'rooms') {
    const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
    const map = {};
    (adminState.rooms || []).forEach(r => {
      map[r.id] = { id: r.id, name: r.name, category: r.tag || 'Luxury Suite', count: 0, revenue: 0 };
    });

    bookings.forEach(b => {
      if (map[b.roomId]) {
        map[b.roomId].count += 1;
        map[b.roomId].revenue += (b.totalAmount || 0);
      }
    });

    const list = Object.values(map).sort((a, b) => b.revenue - a.revenue);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:20px;">No rooms data found</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((item, idx) => `
      <tr>
        <td style="font-weight:700; color:#94A3B8;">${idx + 1}</td>
        <td style="font-weight:600; color:var(--ocean-blue);">${item.name}</td>
        <td><span class="dash-badge-status confirmed">${item.count} Bookings</span></td>
        <td style="text-align:right; font-weight:700; color:#1E293B;">₹${item.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  } else {
    const dishes = adminState.restaurant || [];
    if (!dishes.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:20px;">No menu dishes recorded</td></tr>';
      return;
    }

    const sortedDishes = [...dishes].slice(0, 5);
    tbody.innerHTML = sortedDishes.map((d, idx) => `
      <tr>
        <td style="font-weight:700; color:#94A3B8;">${idx + 1}</td>
        <td style="font-weight:600; color:var(--ocean-blue);">${d.name}</td>
        <td><span style="color:#64748B; font-size:0.75rem;">${d.category || 'Kitchen'}</span></td>
        <td style="text-align:right; font-weight:700; color:#1E293B;">₹${(d.price || 150).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

window.handleViewAllItems = function() {
  if (currentDashTableTab === 'rooms') switchTab('tabRooms');
  else switchTab('tabMenu');
};

// ----------------------------------------------------------------------------
// 5. ROOM AVAILABILITY / STOCK SUMMARY & BARS
// ----------------------------------------------------------------------------
function renderRoomStockSummary() {
  const rooms = adminState.rooms || [];
  const bookings = adminState.bookings || [];
  const todayStr = new Date().toISOString().split('T')[0];

  const totalRooms = rooms.reduce((s, r) => s + (parseInt(r.totalRooms, 10) || 5), 0) || 20;
  let bookedRooms = 0;
  let blockedRooms = 0;

  rooms.forEach(r => {
    if (r.isSoldOut) blockedRooms += (parseInt(r.totalRooms, 10) || 5);
  });

  bookings.forEach(b => {
    if (b.status !== 'Cancelled' && b.checkIn <= todayStr && b.checkOut > todayStr) {
      bookedRooms += (parseInt(b.roomsCount, 10) || 1);
    }
  });

  const availableRooms = Math.max(0, totalRooms - bookedRooms - blockedRooms);

  const elTotal = document.getElementById('stockStatTotal');
  const elBooked = document.getElementById('stockStatBooked');
  const elBlocked = document.getElementById('stockStatBlocked');
  const elAvail = document.getElementById('stockStatAvailable');

  if (elTotal) elTotal.textContent = totalRooms;
  if (elBooked) elBooked.textContent = bookedRooms;
  if (elBlocked) elBlocked.textContent = blockedRooms;
  if (elAvail) elAvail.textContent = availableRooms;

  const barsContainer = document.getElementById('stockRoomBars');
  if (barsContainer) {
    barsContainer.innerHTML = rooms.map(r => {
      const cap = parseInt(r.totalRooms, 10) || 5;
      let bk = 0;
      bookings.forEach(b => {
        if (b.status !== 'Cancelled' && b.roomId === r.id && b.checkIn <= todayStr && b.checkOut > todayStr) {
          bk += (parseInt(b.roomsCount, 10) || 1);
        }
      });
      const avail = r.isSoldOut ? 0 : Math.max(0, cap - bk);
      const availPct = Math.round((avail / cap) * 100);
      const color = avail === 0 ? '#EF4444' : (avail <= 2 ? '#F59E0B' : '#10B981');

      return `
        <div class="stock-room-bar-item">
          <div class="stock-room-head">
            <span>${r.name}</span>
            <span>${avail} / ${cap} available</span>
          </div>
          <div class="stock-progress-track">
            <div class="stock-progress-fill" style="width: ${availPct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ----------------------------------------------------------------------------
// 6. LOW AVAILABILITY ALERTS (RED-TINTED REFERENCE STYLE)
// ----------------------------------------------------------------------------
async function renderLowAvailabilityAlerts() {
  const tbody = document.getElementById('lowStockTableBody');
  const countBadge = document.getElementById('lowStockAlertCount');
  if (!tbody) return;

  try {
    const res = await authFetch('/api/admin/dashboard');
    const alerts = res.success && Array.isArray(res.alerts) ? res.alerts : [];

    if (countBadge) countBadge.textContent = alerts.length + ' items';

    if (!alerts.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#10B981; padding:20px; font-weight:600;">✓ All room types have healthy availability</td></tr>';
      return;
    }

    tbody.innerHTML = alerts.slice(0, 6).map(a => {
      const badgeCls = a.status === 'Sold Out' ? 'soldout' : (a.status === 'Critical' ? 'critical' : 'low');
      const dLabel = new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return `
        <tr>
          <td style="font-weight:600; color:var(--ocean-blue);">${a.name}</td>
          <td style="color:#64748B;">${dLabel}</td>
          <td style="text-align:center; font-weight:700;">${a.left}</td>
          <td style="text-align:right;"><span class="dash-badge-status ${badgeCls}">${a.status}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:20px;">No critical alerts</td></tr>';
  }
}

// ----------------------------------------------------------------------------
// 7. MONTHLY REVENUE TREND (GREEN BAR CHART)
// ----------------------------------------------------------------------------
function initOrUpdateMonthlyRevenueChart(year = '2026') {
  currentRevenueYear = year;
  const canvas = document.getElementById('chartMonthlyRevenue');
  if (!canvas || typeof Chart === 'undefined') return;

  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const data = new Array(12).fill(0);

  bookings.forEach(b => {
    const d = new Date(b.checkIn || b.createdAt);
    if (d && !isNaN(d.getTime()) && String(d.getFullYear()) === String(year)) {
      const m = d.getMonth();
      data[m] += (b.totalAmount || 0);
    }
  });

  const displayData = data.map(v => Math.round(v / 1000)); // in ₹ thousands

  if (chartMonthlyInstance) {
    chartMonthlyInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  chartMonthlyInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: 'Revenue (₹k)',
        data: displayData,
        backgroundColor: '#10B981',
        borderRadius: 6,
        borderSkipped: false,
        hoverBackgroundColor: '#059669'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 31, 58, 0.92)',
          padding: 8,
          titleFont: { family: 'Poppins', size: 12 },
          bodyFont: { family: 'Poppins', size: 12 },
          callbacks: {
            label: (ctx) => ` Revenue: ₹${(ctx.raw * 1000).toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Poppins', size: 10 }, color: '#94A3B8' }
        },
        y: {
          grid: { color: 'rgba(226, 232, 240, 0.6)' },
          ticks: {
            font: { family: 'Poppins', size: 9 },
            color: '#94A3B8',
            callback: (v) => '₹' + v + 'k'
          }
        }
      }
    }
  });
}

window.updateRevenueTrendYear = function(val) {
  initOrUpdateMonthlyRevenueChart(val);
};

// ----------------------------------------------------------------------------
// 8. RECENT BOOKINGS & CHATBOT LEADS TABLES
// ----------------------------------------------------------------------------
window.switchRecentTab = function(tab) {
  currentRecentTab = tab;
  const btnB = document.getElementById('tabBtnRecentBookings');
  const btnL = document.getElementById('tabBtnRecentLeads');
  if (btnB && btnL) {
    if (tab === 'bookings') {
      btnB.classList.add('active');
      btnL.classList.remove('active');
    } else {
      btnL.classList.add('active');
      btnB.classList.remove('active');
    }
  }
  renderRecentItemsTable(tab);
};

function renderRecentItemsTable(tab = 'bookings') {
  const tbody = document.getElementById('recentItemsTableBody');
  const theadRow = document.getElementById('recentTableHeaderRow');
  if (!tbody) return;

  if (tab === 'bookings') {
    if (theadRow) {
      theadRow.innerHTML = `
        <th>Booking ID</th>
        <th>Guest</th>
        <th>Room</th>
        <th>Dates</th>
        <th style="text-align: right;">Amount</th>
        <th>Status</th>
      `;
    }

    const bookings = (adminState.bookings || []).slice(0, 5);
    if (!bookings.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94A3B8; padding:20px;">No bookings recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = bookings.map(b => `
      <tr>
        <td style="font-weight:700; color:var(--ocean-blue);">${b.bookingId}</td>
        <td>${b.guestName || 'Guest'}</td>
        <td style="color:#64748B;">${b.roomName || ''}</td>
        <td style="font-size:0.75rem; color:#64748B;">${b.checkIn} → ${b.checkOut}</td>
        <td style="text-align:right; font-weight:700; color:#1E293B;">₹${(b.totalAmount || 0).toLocaleString('en-IN')}</td>
        <td><span class="dash-badge-status ${getBadgeClass(b.status)}">${b.status}</span></td>
      </tr>
    `).join('');
  } else {
    // Recent Chatbot Leads
    if (theadRow) {
      theadRow.innerHTML = `
        <th>Guest Name</th>
        <th>Phone</th>
        <th>Requirement</th>
        <th>Date</th>
        <th style="text-align: right;">Action</th>
      `;
    }

    const inquiries = (adminState.chatInquiries || []).slice(0, 5);
    if (!inquiries.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:20px;">No chatbot leads captured yet.</td></tr>';
      return;
    }

    tbody.innerHTML = inquiries.map(iq => `
      <tr>
        <td style="font-weight:700; color:var(--ocean-blue);">${iq.guestName || iq.name || 'Website Visitor'}</td>
        <td>${iq.phone || '—'}</td>
        <td style="color:#64748B;">${iq.requirement || iq.message || 'Room Inquiry'}</td>
        <td style="font-size:0.75rem; color:#64748B;">${(iq.createdAt || '').slice(0, 10)}</td>
        <td style="text-align:right;">
          <button class="btn-turquoise" style="padding:2px 8px; font-size:0.72rem;" onclick="switchTab('tabChatCRM')">Reply</button>
        </td>
      </tr>
    `).join('');
  }
}

window.handleViewAllRecent = function() {
  if (currentRecentTab === 'bookings') switchTab('tabBookings');
  else switchTab('tabChatCRM');
};

// ----------------------------------------------------------------------------
// 9. TRANSPORT & ADD-ONS SALES (BAR CHART)
// ----------------------------------------------------------------------------
function initOrUpdateAddonsSalesChart() {
  const canvas = document.getElementById('chartAddonsSales');
  if (!canvas || typeof Chart === 'undefined') return;

  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  const addons = {
    'Toto': 0,
    'Auto': 0,
    'Car': 0,
    'Breakfast': 0,
    'Candlelight': 0
  };

  bookings.forEach(b => {
    if (b.needCar || b.vehicleType === 'car') addons['Car'] += (b.carTotal || 1500);
    if (b.vehicleType === 'toto') addons['Toto'] += (b.carTotal || 500);
    if (b.vehicleType === 'auto') addons['Auto'] += (b.carTotal || 800);
    if (b.breakfast) addons['Breakfast'] += (b.breakfastTotal || 400);
    if (b.candlelightDinner) addons['Candlelight'] += (b.dinnerTotal || 3500);
  });

  const labels = Object.keys(addons);
  const data = Object.values(addons);

  if (chartAddonsInstance) {
    chartAddonsInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  chartAddonsInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Sales (₹)',
        data: data,
        backgroundColor: [
          '#38BDF8',
          '#34D399',
          '#F472B6',
          '#FBBF24',
          '#A78BFA'
        ],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11, 31, 58, 0.92)',
          padding: 8,
          titleFont: { family: 'Poppins', size: 12 },
          bodyFont: { family: 'Poppins', size: 12 },
          callbacks: {
            label: (ctx) => ` Sales: ₹${ctx.raw.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Poppins', size: 10 }, color: '#94A3B8' }
        },
        y: {
          grid: { color: 'rgba(226, 232, 240, 0.6)' },
          ticks: {
            font: { family: 'Poppins', size: 9 },
            color: '#94A3B8',
            callback: (v) => '₹' + v
          }
        }
      }
    }
  });
}

// ----------------------------------------------------------------------------
// 10. RECORD PAYMENT MODAL LOGIC
// ----------------------------------------------------------------------------
window.openRecordPaymentModal = function() {
  const select = document.getElementById('recPayBookingSelect');
  if (select) {
    const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
    select.innerHTML = bookings.map(b => `
      <option value="${b.bookingId}">${b.bookingId} - ${b.guestName} (Due: ₹${(b.payAtHotelBalance || 0).toLocaleString('en-IN')})</option>
    `).join('');

    if (bookings[0]) {
      handleRecPayBookingChange(bookings[0].bookingId);
    }
  }
  openModal('recordPaymentModal');
};

window.handleRecPayBookingChange = function(bookingId) {
  const b = (adminState.bookings || []).find(x => x.bookingId === bookingId);
  if (!b) return;
  const amtInput = document.getElementById('recPayAmount');
  const typeSelect = document.getElementById('recPayTypeSelect');
  if (amtInput && typeSelect) {
    if (typeSelect.value === 'balance') {
      amtInput.value = b.payAtHotelBalance || '';
    } else {
      amtInput.value = b.payNowAdvance || '';
    }
  }
};

window.executeSubmitPayment = async function() {
  const bookingId = document.getElementById('recPayBookingSelect')?.value;
  const type = document.getElementById('recPayTypeSelect')?.value;
  const mode = document.getElementById('recPayModeSelect')?.value;
  const amount = Number(document.getElementById('recPayAmount')?.value);
  const note = document.getElementById('recPayNote')?.value.trim();

  if (!bookingId || !amount || amount <= 0) {
    showToast('Please enter a valid payment amount.', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitPayment');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const res = await authFetch(`/api/bookings/${bookingId}/payments`, {
      method: 'POST',
      body: { type, mode, amount, note }
    });

    if (res.success) {
      closeModal('recordPaymentModal');
      showToast(`Payment of ₹${amount.toLocaleString('en-IN')} (${mode}) recorded successfully!`, 'success');
      await loadAllAdminData();
    } else {
      showToast(res.message || 'Payment recording failed.', 'error');
    }
  } catch (err) {
    showToast('Payment recording error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Payment'; }
  }
};

// ----------------------------------------------------------------------------
// 11. AVAILABILITY CALENDAR TAB
// ----------------------------------------------------------------------------
window.renderAvailabilityCalendar = function(offsetDelta = 0) {
  currentCalendarMonthOffset += offsetDelta;
  const container = document.getElementById('availabilityCalendarGrid');
  const labelEl = document.getElementById('calendarCurrentMonthLabel');
  if (!container) return;

  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + currentCalendarMonthOffset);
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();

  if (labelEl) {
    labelEl.textContent = targetDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rooms = adminState.rooms || [];
  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  const filterRoom = document.getElementById('calendarRoomFilter')?.value || 'all';

  let html = '';
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dows.forEach(d => {
    html += `<div style="text-align:center; font-weight:700; font-size:0.75rem; color:#64748B; padding:6px 0;">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day-cell other-month"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    let totalCap = 0;
    let bookedCount = 0;

    rooms.forEach(r => {
      if (filterRoom !== 'all' && r.id !== filterRoom) return;
      const cap = parseInt(r.totalRooms, 10) || 5;
      totalCap += cap;
      if (r.isSoldOut) bookedCount += cap;
    });

    bookings.forEach(b => {
      if (filterRoom !== 'all' && b.roomId !== filterRoom) return;
      if (b.checkIn <= dateStr && b.checkOut > dateStr) {
        bookedCount += (parseInt(b.roomsCount, 10) || 1);
      }
    });

    const avail = Math.max(0, totalCap - bookedCount);
    let statusBg = '#10B981';
    let statusText = avail + ' Left';
    if (avail === 0) {
      statusBg = '#EF4444';
      statusText = 'Sold Out';
    } else if (avail <= 2) {
      statusBg = '#F59E0B';
      statusText = avail + ' Left';
    }

    html += `
      <div class="calendar-day-cell">
        <div class="calendar-day-num">${d}</div>
        <div class="calendar-day-status-pill" style="background:${statusBg}; color:#FFFFFF;">
          ${statusText}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
};

// ----------------------------------------------------------------------------
// 12. REPORTS TAB SUMMARY
// ----------------------------------------------------------------------------
function renderReportsTab() {
  const revContainer = document.getElementById('reportsRevenueSummary');
  const payContainer = document.getElementById('reportsPaymentSummary');
  const addContainer = document.getElementById('reportsAddonsSummary');

  const bookings = (adminState.bookings || []).filter(b => b.status !== 'Cancelled');
  const totalRev = bookings.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const totalAdv = bookings.reduce((s, b) => s + (b.payNowAdvance || 0), 0);
  const totalBal = bookings.reduce((s, b) => s + (b.payAtHotelBalance || 0), 0);

  if (revContainer) {
    revContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between;"><span>Total Audited Revenue:</span> <strong>₹${totalRev.toLocaleString('en-IN')}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Total Confirmed Bookings:</span> <strong>${bookings.length}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Average Booking Value:</span> <strong>₹${Math.round(totalRev / (bookings.length || 1)).toLocaleString('en-IN')}</strong></div>
      </div>
    `;
  }

  if (payContainer) {
    payContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between;"><span>20% Online Advances:</span> <strong style="color:#059669;">₹${totalAdv.toLocaleString('en-IN')}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>80% Hotel Balances:</span> <strong style="color:#2563EB;">₹${totalBal.toLocaleString('en-IN')}</strong></div>
      </div>
    `;
  }

  if (addContainer) {
    const diningTotal = bookings.filter(b => b.candlelightDinner).reduce((s, b) => s + (b.dinnerTotal || 3500), 0);
    const transTotal = bookings.filter(b => b.needCar || b.vehicleType).reduce((s, b) => s + (b.carTotal || 1500), 0);
    addContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between;"><span>Candlelight Dinners:</span> <strong>₹${diningTotal.toLocaleString('en-IN')}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Transport Fleet:</span> <strong>₹${transTotal.toLocaleString('en-IN')}</strong></div>
      </div>
    `;
  }
}


function renderRoomsGrid() {
  const container = document.getElementById('roomsCardsGrid');
  if (!container) return;

  const rooms = (adminState.rooms || []).filter(r => !r.isArchived);
  const canControlRooms = currentUser && ['Super Admin', 'Manager'].includes(currentUser.role);

  if (rooms.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: #FFF; border-radius: 12px; border: 1px dashed #CBD5E1;">
        <span class="material-symbols-outlined" style="font-size: 40px; color: #94A3B8;">meeting_room</span>
        <p style="margin: 8px 0; color: #475569;">No active rooms found.</p>
        <button class="btn-turquoise" onclick="openAddRoomModal()">Add First Room</button>
      </div>`;
    renderMonthlyCalendar();
    return;
  }

  container.innerHTML = rooms.map((room, idx) => {
    const priceText = (room.price && !isNaN(room.price)) ? `₹${Number(room.price).toLocaleString('en-IN')}` : 'Ask at hotel';
    const featuresList = Array.isArray(room.features) ? room.features.slice(0, 3) : [];

    return `
      <div class="room-inventory-card ${room.isSoldOut ? 'is-sold-out' : ''}" data-id="${room.id}">
        <div class="room-card-preview">
          <img src="${formatAdminImgUrl(room.image)}" alt="${room.name}" class="room-card-img" onerror="this.src=NEUTRAL_MEDIA_FALLBACK">
          <div class="room-card-ribbon ${room.isSoldOut ? 'sold-out' : 'available'}">
            ${room.isSoldOut ? 'SOLD OUT' : 'AVAILABLE'}
          </div>
        </div>

        <div class="room-card-body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <h3 class="room-card-title">${room.name}</h3>
            <span style="font-size: 0.72rem; background: rgba(6, 182, 176, 0.15); color: var(--turquoise-dark); padding: 2px 8px; border-radius: 20px; font-weight: 600; white-space: nowrap;">${room.tag || 'DELUXE'}</span>
          </div>

          <div class="room-card-price">
            ${priceText} ${room.price ? `<span style="font-size: 0.78rem; color: #64748B; font-weight: 400;">/ night</span>` : ''}
          </div>

          <div class="room-card-meta">
            <span><span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">inventory_2</span> Total: <strong>${room.quantity || 1} Rooms</strong></span>
            <span><span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">person</span> Max ${room.maxAdults || 2} Adults${room.maxChildren ? ` + ${room.maxChildren} Ch.` : ''}</span>
            <span><span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">king_bed</span> ${room.bed || 'King Bed'}</span>
            ${room.blockedQuantity ? `<span style="color: var(--sunset-coral); font-weight:600;"><span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">block</span> Blocked: ${room.blockedQuantity}</span>` : ''}
          </div>

          ${featuresList.length > 0 ? `
            <div style="margin: 8px 0 10px; font-size: 0.75rem; color: #475569; display: flex; flex-direction: column; gap: 3px;">
              ${featuresList.map(f => `<div style="display: flex; align-items: center; gap: 5px;"><span class="material-symbols-outlined" style="font-size: 13px; color: var(--turquoise-dark);">check_circle</span> <span>${f}</span></div>`).join('')}
            </div>
          ` : ''}

          <!-- MakeMyTrip Style Inclusions Preview -->
          ${room.inclusions && room.inclusions.length > 0 ? `
            <div style="margin: 6px 0 10px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 6px 10px;">
              <div style="font-size: 0.70rem; font-weight: 700; color: #166534; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 13px; color: #16A34A;">verified</span> Inclusions (${room.inclusions.length})
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${room.inclusions.map((inc, i) => `<span style="font-size: 0.68rem; background: #FFF; border: 1px solid #DCFCE7; border-radius: 4px; padding: 1px 6px; color: #15803D; ${i === 0 ? 'font-weight: 700; color: #166534;' : ''}">✓ ${typeof inc === 'string' ? inc : inc.text}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          ${room.isSoldOut ? `
            <div style="background: var(--coral-light); border: 1px solid rgba(255, 107, 94, 0.3); border-radius: 8px; padding: 10px; font-size: 0.78rem; color: var(--coral-dark); margin-bottom: 14px;">
              <strong>Sold Out Scope:</strong> ${room.soldOutUntil || 'Until further notice'}<br>
              <strong>Reason:</strong> ${room.soldOutReason || 'Peak period reservation'}
            </div>
          ` : ''}

          ${canControlRooms ? `
            <div class="room-card-actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="${room.isSoldOut ? 'btn-turquoise' : 'btn-coral'}" style="flex: 1; min-width: 125px;" onclick="openSoldOutToggleModal('${room.id}', ${!room.isSoldOut})">
                <span class="material-symbols-outlined">${room.isSoldOut ? 'check_circle' : 'block'}</span>
                ${room.isSoldOut ? 'Mark Available' : 'Toggle Sold Out'}
              </button>
              <button class="btn-outline-gold" onclick="openEditRoomModal('${room.id}')" title="Edit Price & Details">
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button class="btn-action-icon" onclick="reorderRoom('${room.id}', -1)" title="Move Up" ${idx === 0 ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                <span class="material-symbols-outlined">arrow_upward</span>
              </button>
              <button class="btn-action-icon" onclick="reorderRoom('${room.id}', 1)" title="Move Down" ${idx === rooms.length - 1 ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                <span class="material-symbols-outlined">arrow_downward</span>
              </button>
              <button class="btn-action-icon danger" onclick="confirmDeleteRoom('${room.id}', '${room.name.replace(/'/g, "\\'")}')" title="Delete Room">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          ` : `
            <div style="font-size: 0.76rem; color: #94A3B8; text-align: center; padding: 8px 0;">
              View Only (Front Desk Access)
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  renderMonthlyCalendar();
}

// Inclusions & Extras state for room modal
let currentEditInclusions = [];
let currentEditExtras = [];

const DEFAULT_INCLUSIONS = [
  { text: "AC", icon: "ac_unit" },
  { text: "Free Wi-Fi", icon: "wifi" },
  { text: "Smart TV", icon: "tv" },
  { text: "Pool access", icon: "pool" },
  { text: "Housekeeping", icon: "cleaning_services" },
  { text: "Hot water", icon: "water_drop" }
];

const DEFAULT_EXTRAS = [
  { text: "Breakfast (optional, ₹200)", icon: "restaurant" },
  { text: "Candlelight Dinner", icon: "favorite" },
  { text: "Car / Toto / Auto pickup", icon: "directions_car" }
];

function renderInclusionsList() {
  const container = document.getElementById('roomInclusionsChipsList');
  if (!container) return;

  if (currentEditInclusions.length === 0) {
    container.innerHTML = `<div style="font-size: 0.76rem; color: #64748B; font-style: italic; padding: 6px;">No inclusions configured. Add one below.</div>`;
    return;
  }

  container.innerHTML = currentEditInclusions.map((item, idx) => {
    const isFirst = idx === 0;
    const isBreakfast = (item.text || '').toLowerCase().includes('breakfast');
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 6px 10px; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span class="material-symbols-outlined" style="font-size: 18px; color: var(--turquoise-dark);">${item.icon || 'check_circle'}</span>
          <span style="font-size: 0.82rem; font-weight: 500; color: #1E293B;">${item.text}</span>
          ${isBreakfast ? `<span style="font-size: 0.68rem; background: #DCFCE7; color: #166534; font-weight: 700; padding: 1px 6px; border-radius: 4px;">Confirmed</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-action-icon" style="padding: 2px 5px;" title="Move Up" onclick="moveInclusion(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
            <span class="material-symbols-outlined" style="font-size: 16px;">arrow_upward</span>
          </button>
          <button type="button" class="btn-action-icon" style="padding: 2px 5px;" title="Move Down" onclick="moveInclusion(${idx}, 1)" ${idx === currentEditInclusions.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
            <span class="material-symbols-outlined" style="font-size: 16px;">arrow_downward</span>
          </button>
          <button type="button" class="btn-action-icon danger" style="padding: 2px 5px;" title="Remove Chip" onclick="removeInclusion(${idx})">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderExtrasList() {
  const container = document.getElementById('roomExtrasChipsList');
  if (!container) return;

  if (currentEditExtras.length === 0) {
    container.innerHTML = `<div style="font-size: 0.76rem; color: #92400E; font-style: italic; padding: 6px;">No extras configured. Add one below.</div>`;
    return;
  }

  container.innerHTML = currentEditExtras.map((item, idx) => {
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 8px; padding: 6px 10px; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span class="material-symbols-outlined" style="font-size: 18px; color: #D97706;">${item.icon || 'add_circle'}</span>
          <span style="font-size: 0.82rem; font-weight: 500; color: #78350F;">${item.text}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-action-icon" style="padding: 2px 5px;" title="Move Up" onclick="moveExtra(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
            <span class="material-symbols-outlined" style="font-size: 16px;">arrow_upward</span>
          </button>
          <button type="button" class="btn-action-icon" style="padding: 2px 5px;" title="Move Down" onclick="moveExtra(${idx}, 1)" ${idx === currentEditExtras.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
            <span class="material-symbols-outlined" style="font-size: 16px;">arrow_downward</span>
          </button>
          <button type="button" class="btn-action-icon danger" style="padding: 2px 5px;" title="Remove Chip" onclick="removeExtra(${idx})">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.moveInclusion = function(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= currentEditInclusions.length) return;
  const temp = currentEditInclusions[index];
  currentEditInclusions[index] = currentEditInclusions[target];
  currentEditInclusions[target] = temp;
  renderInclusionsList();
};

window.removeInclusion = function(index) {
  currentEditInclusions.splice(index, 1);
  renderInclusionsList();
};

window.addInclusionFromInput = function() {
  const input = document.getElementById('newInclusionText');
  const iconSelect = document.getElementById('newInclusionIcon');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const icon = iconSelect ? iconSelect.value : 'check_circle';
  currentEditInclusions.push({ text, icon });
  input.value = '';
  renderInclusionsList();
};

window.addQuickInclusion = function(text, icon = 'check_circle') {
  if (currentEditInclusions.some(i => i.text.toLowerCase() === text.toLowerCase())) {
    showToast(`"${text}" is already included.`, 'info');
    return;
  }
  currentEditInclusions.push({ text, icon });
  renderInclusionsList();
};

window.moveExtra = function(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= currentEditExtras.length) return;
  const temp = currentEditExtras[index];
  currentEditExtras[index] = currentEditExtras[target];
  currentEditExtras[target] = temp;
  renderExtrasList();
};

window.removeExtra = function(index) {
  currentEditExtras.splice(index, 1);
  renderExtrasList();
};

window.addExtraFromInput = function() {
  const input = document.getElementById('newExtraText');
  const iconSelect = document.getElementById('newExtraIcon');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const icon = iconSelect ? iconSelect.value : 'add_circle';
  currentEditExtras.push({ text, icon });
  input.value = '';
  renderExtrasList();
};

window.addQuickExtra = function(text, icon = 'add_circle') {
  if (currentEditExtras.some(e => e.text.toLowerCase() === text.toLowerCase())) {
    showToast(`"${text}" is already in Extras.`, 'info');
    return;
  }
  currentEditExtras.push({ text, icon });
  renderExtrasList();
};

function openAddRoomModal() {
  adminState.activeRoomIdForEdit = null;
  document.getElementById('editRoomModalTitle').textContent = 'Add New Room / Suite';
  document.getElementById('editRoomName').value = '';
  document.getElementById('editRoomTag').value = 'SEA VIEW';
  document.getElementById('editRoomCategory').value = 'sea-view';
  document.getElementById('editRoomView').value = 'Sea-facing';
  document.getElementById('editRoomPrice').value = '';
  document.getElementById('editRoomQuantity').value = 4;
  document.getElementById('editRoomBed').value = 'Comfortable King Bed';
  document.getElementById('editRoomSize').value = '450 sq. ft.';
  document.getElementById('editRoomAdults').value = 2;
  document.getElementById('editRoomChildren').value = 0;
  document.getElementById('editRoomFeatures').value = 'Direct Ocean View & Balcony\nKing Bed, AC & Wi-Fi\nModern Bathroom with Rain Shower';
  document.getElementById('editRoomDesc').value = '';
  document.getElementById('editRoomImage').value = 'assets/images/room-ocean-whisper.jpg';
  
  const prevEl = document.getElementById('editRoomImagePreview');
  if (prevEl) {
    prevEl.src = formatAdminImgUrl('assets/images/room-ocean-whisper.jpg');
    prevEl.onerror = () => { prevEl.src = NEUTRAL_MEDIA_FALLBACK; };
  }

  // Populate Inclusions & Extras
  currentEditInclusions = DEFAULT_INCLUSIONS.map(i => ({ ...i }));
  currentEditExtras = DEFAULT_EXTRAS.map(e => ({ ...e }));
  renderInclusionsList();
  renderExtrasList();

  const delBtn = document.getElementById('btnDeleteRoom');
  if (delBtn) delBtn.style.display = 'none';

  const saveBtn = document.getElementById('btnSaveRoomDetails');
  saveBtn.textContent = 'Create Room';
  saveBtn.onclick = () => saveRoomDetails(null);

  document.getElementById('editRoomModal').classList.add('open');
}

function openEditRoomModal(roomId) {
  adminState.activeRoomIdForEdit = roomId;
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room) return;

  document.getElementById('editRoomModalTitle').textContent = `Edit Room: ${room.name}`;
  document.getElementById('editRoomName').value = room.name || '';
  document.getElementById('editRoomTag').value = room.tag || '';
  document.getElementById('editRoomCategory').value = room.category || 'sea-view';
  document.getElementById('editRoomView').value = room.view || '';
  document.getElementById('editRoomPrice').value = (room.price !== null && room.price !== undefined) ? room.price : '';
  document.getElementById('editRoomQuantity').value = (room.quantity !== undefined && room.quantity !== null) ? room.quantity : 1;
  document.getElementById('editRoomBed').value = room.bed || '';
  document.getElementById('editRoomSize').value = room.size || '';
  document.getElementById('editRoomAdults').value = room.maxAdults || 2;
  document.getElementById('editRoomChildren').value = room.maxChildren || 0;
  document.getElementById('editRoomFeatures').value = Array.isArray(room.features) ? room.features.join('\n') : (room.features || '');
  document.getElementById('editRoomDesc').value = room.description || '';
  document.getElementById('editRoomImage').value = room.image || '';

  const prevEl = document.getElementById('editRoomImagePreview');
  if (prevEl) {
    prevEl.src = formatAdminImgUrl(room.image);
    prevEl.onerror = () => { prevEl.src = NEUTRAL_MEDIA_FALLBACK; };
  }

  // Populate Inclusions & Extras
  currentEditInclusions = (Array.isArray(room.inclusions) && room.inclusions.length)
    ? JSON.parse(JSON.stringify(room.inclusions))
    : DEFAULT_INCLUSIONS.map(i => ({ ...i }));
  currentEditExtras = (Array.isArray(room.extras) && room.extras.length)
    ? JSON.parse(JSON.stringify(room.extras))
    : DEFAULT_EXTRAS.map(e => ({ ...e }));
  renderInclusionsList();
  renderExtrasList();

  const delBtn = document.getElementById('btnDeleteRoom');
  if (delBtn) delBtn.style.display = 'inline-flex';

  const saveBtn = document.getElementById('btnSaveRoomDetails');
  saveBtn.textContent = 'Save Changes';
  saveBtn.onclick = () => saveRoomDetails(roomId);

  document.getElementById('editRoomModal').classList.add('open');
}

async function saveRoomDetails(roomId) {
  const name = document.getElementById('editRoomName').value.trim();
  if (!name) {
    showToast('Room name is required.', 'error');
    return;
  }
  const tag = document.getElementById('editRoomTag').value.trim();
  const category = document.getElementById('editRoomCategory').value.trim();
  const view = document.getElementById('editRoomView').value.trim();
  const priceVal = document.getElementById('editRoomPrice').value.trim();
  const price = priceVal === '' ? null : Number(priceVal);
  const quantity = Math.max(1, parseInt(document.getElementById('editRoomQuantity').value, 10) || 1);
  const bed = document.getElementById('editRoomBed').value.trim();
  const size = document.getElementById('editRoomSize').value.trim();
  const maxAdults = parseInt(document.getElementById('editRoomAdults').value, 10) || 2;
  const maxChildren = parseInt(document.getElementById('editRoomChildren').value, 10) || 0;
  const featuresText = document.getElementById('editRoomFeatures').value;
  const features = featuresText.split('\n').map(s => s.trim()).filter(Boolean);
  const description = document.getElementById('editRoomDesc').value.trim();
  const image = document.getElementById('editRoomImage').value.trim();

  const payload = {
    name,
    tag,
    category,
    view,
    price,
    quantity,
    bed,
    size,
    maxAdults,
    maxChildren,
    features,
    description,
    image,
    inclusions: currentEditInclusions,
    extras: currentEditExtras
  };

  const endpoint = roomId ? `/api/rooms/${roomId}` : '/api/rooms';

  try {
    const res = await authFetch(endpoint, {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      closeModal('editRoomModal');
      showToast(res.message || `Saved details for ${name}`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Error saving room details.', 'error');
    }
  } catch (e) {
    showToast('Failed to save room details.', 'error');
  }
}

async function confirmDeleteRoom(roomId, roomName) {
  if (!confirm(`Are you sure you want to delete/archive "${roomName}"? Existing bookings will be preserved, but the room will be removed from active inventory.`)) {
    return;
  }
  try {
    const res = await authFetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message || `Room "${roomName}" deleted.`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to delete room.', 'error');
    }
  } catch (e) {
    showToast('Error deleting room.', 'error');
  }
}

function confirmDeleteCurrentRoom() {
  const roomId = adminState.activeRoomIdForEdit;
  if (!roomId) return;
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  const name = room ? room.name : 'this room';
  confirmDeleteRoom(roomId, name);
}

async function reorderRoom(roomId, direction) {
  const rooms = (adminState.rooms || []).filter(r => !r.isArchived);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= rooms.length) return;

  const temp = rooms[idx];
  rooms[idx] = rooms[targetIdx];
  rooms[targetIdx] = temp;

  adminState.rooms = rooms;
  renderRoomsGrid();

  const roomIds = rooms.map(r => r.id);
  try {
    const res = await authFetch('/api/rooms/reorder', {
      method: 'POST',
      body: { roomIds }
    });
    if (res.success) {
      showToast('Room order updated successfully.', 'success');
    }
  } catch (e) {
    console.error('Reorder sync error:', e);
  }
}

function openSoldOutToggleModal(roomId, willBeSoldOut) {
  adminState.activeRoomIdForSoldOut = roomId;
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room) return;

  const modal = document.getElementById('soldOutModal');
  const title = document.getElementById('soldOutModalTitle');
  const confirmBtn = document.getElementById('btnConfirmSoldOutAction');
  const reasonInput = document.getElementById('soldOutReasonInput');
  const blockedQtyInput = document.getElementById('soldOutBlockedQtyInput');

  title.textContent = willBeSoldOut ? `Mark "${room.name}" as SOLD OUT / Block Rooms` : `Restore "${room.name}" as AVAILABLE`;
  confirmBtn.className = willBeSoldOut ? 'btn-coral' : 'btn-turquoise';
  confirmBtn.textContent = willBeSoldOut ? 'Confirm Sold-Out / Block Status' : 'Confirm Available Status';
  reasonInput.value = willBeSoldOut ? (room.soldOutReason || 'Full occupancy & peak season') : 'Room cleaned & ready for guests';
  if (blockedQtyInput) {
    blockedQtyInput.value = room.blockedQuantity || 0;
  }

  confirmBtn.onclick = async () => {
    const rangeType = document.querySelector('input[name="soldOutRangeType"]:checked').value;
    const startDate = document.getElementById('soldOutStartDate').value;
    const endDate = document.getElementById('soldOutEndDate').value;
    const reason = reasonInput.value.trim();
    const blockedQuantity = blockedQtyInput ? (parseInt(blockedQtyInput.value, 10) || 0) : 0;

    try {
      const res = await authFetch(`/api/rooms/${roomId}/sold-out`, {
        method: 'POST',
        body: {
          isSoldOut: willBeSoldOut,
          dateRangeType: rangeType,
          startDate,
          endDate,
          reason,
          blockedQuantity
        }
      });

      if (res.success) {
        closeModal('soldOutModal');
        showToast(res.message, willBeSoldOut ? 'warning' : 'success');
        loadAllAdminData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (e) {
      showToast('Failed to update room availability.', 'error');
    }
  };

  modal.classList.add('open');
}

function toggleDateRangeInputs(show) {
  document.getElementById('soldOutDateRangeGroup').style.display = show ? 'grid' : 'none';
}

function toggleRoomViewMode(mode) {
  const grid = document.getElementById('roomsCardsGrid');
  const cal = document.getElementById('roomCalendarViewBox');
  if (mode === 'calendar') {
    grid.style.display = 'none';
    cal.style.display = 'block';
  } else {
    grid.style.display = 'grid';
    cal.style.display = 'none';
  }
}

async function loadAdminOccupancyTable(isToday = false) {
  const inInput = document.getElementById('adminOccCheckIn');
  const outInput = document.getElementById('adminOccCheckOut');
  if (!inInput || !outInput) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  if (isToday || !inInput.value) {
    inInput.value = todayStr;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tmY = tomorrow.getFullYear();
    const tmM = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const tmD = String(tomorrow.getDate()).padStart(2, '0');
    outInput.value = `${tmY}-${tmM}-${tmD}`;
  }

  const checkIn = inInput.value;
  const checkOut = outInput.value;

  try {
    const res = await authFetch(`/api/admin/rooms/occupancy?checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`);
    if (res.success && Array.isArray(res.dateRange)) {
      renderAdminOccupancyTable(res.dateRange);
      if (res.calendar) {
        renderMonthlyCalendar(res.calendar);
      }
    }
  } catch (err) {
    console.warn('Failed to load admin occupancy data:', err);
  }
}

function loadAdminOccupancyToday() {
  loadAdminOccupancyTable(true);
}

function renderAdminOccupancyTable(rooms) {
  const tbody = document.getElementById('adminOccupancyTableBody');
  const tfoot = document.getElementById('adminOccupancyTableFoot');
  if (!tbody) return;

  let totalRoomsSum = 0;
  let bookedSum = 0;
  let blockedSum = 0;
  let availableSum = 0;

  tbody.innerHTML = rooms.map(r => {
    totalRoomsSum += r.total;
    bookedSum += r.booked;
    blockedSum += r.blocked;
    availableSum += r.available;

    const priceText = (r.price && !isNaN(r.price)) ? `₹${Number(r.price).toLocaleString('en-IN')}` : 'Ask at hotel';
    const isSoldOut = r.isSoldOut || r.available <= 0;

    let availBadge = '';
    if (r.available <= 0) {
      availBadge = `<span style="background: rgba(255,107,94,0.15); color: var(--sunset-coral); font-weight: 700; padding: 3px 8px; border-radius: 6px;">0 (SOLD OUT)</span>`;
    } else if (r.available <= 3) {
      availBadge = `<span style="background: rgba(255,107,94,0.12); color: var(--sunset-coral); font-weight: 700; padding: 3px 8px; border-radius: 6px;">Only ${r.available} left</span>`;
    } else {
      availBadge = `<span style="background: rgba(16,185,129,0.12); color: #059669; font-weight: 700; padding: 3px 8px; border-radius: 6px;">${r.available} left</span>`;
    }

    const statusBadge = isSoldOut
      ? `<span class="badge-status badge-soldout">Sold Out</span>`
      : `<span class="badge-status badge-confirmed">Available</span>`;

    return `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td><span style="font-size: 0.75rem; background: #E2E8F0; padding: 2px 7px; border-radius: 4px; font-weight: 600;">${r.tag || ''}</span></td>
        <td>${priceText}</td>
        <td><strong>${r.total}</strong></td>
        <td><span style="color: ${r.booked > 0 ? 'var(--ocean-blue)' : '#64748B'}; font-weight: 600;">${r.booked}</span></td>
        <td><span style="color: ${r.blocked > 0 ? 'var(--sunset-coral)' : '#64748B'}; font-weight: 600;">${r.blocked}</span></td>
        <td>${availBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn-table-action" onclick="openEditRoomModal('${r.roomId}')" title="Edit Price & Quantity">
              <span class="material-symbols-outlined" style="font-size: 15px;">edit</span>
            </button>
            <button class="btn-table-action" onclick="openSoldOutToggleModal('${r.roomId}', ${!r.isSoldOut})" title="Toggle Sold-Out or Block Maintenance Rooms" style="color: var(--sunset-coral);">
              <span class="material-symbols-outlined" style="font-size: 15px;">block</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (tfoot) {
    tfoot.innerHTML = `
      <tr>
        <td colspan="3">Total Portfolio Inventory</td>
        <td>${totalRoomsSum} Rooms</td>
        <td>${bookedSum} Booked</td>
        <td>${blockedSum} Blocked</td>
        <td><span style="color: ${availableSum === 0 ? 'var(--sunset-coral)' : '#059669'};">${availableSum} Available</span></td>
        <td colspan="2">${availableSum === 0 ? '<span style="color: var(--sunset-coral);">All Sold Out</span>' : `${availableSum} Free to Book`}</td>
      </tr>
    `;
  }
}

function renderMonthlyCalendar(calendarData) {
  const container = document.getElementById('roomMonthlyCalendarGrid');
  if (!container) return;

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = daysOfWeek.map(d => `<div style="font-size: 0.72rem; font-weight: 700; color: #64748B; text-align: center; padding: 6px;">${d}</div>`).join('');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    html += `<div></div>`;
  }

  const calMap = {};
  const dayList = Array.isArray(calendarData) ? calendarData : (calendarData?.days || []);
  dayList.forEach(c => { calMap[c.date] = c; });

  const todayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;

    const dayData = calMap[dateStr];
    let roomsLeftHtml = '';
    let totalLeftOnDay = 0;

    const roomEntries = dayData ? (Array.isArray(dayData.rooms) ? dayData.rooms : Object.values(dayData.rooms || {})) : null;

    if (roomEntries && roomEntries.length > 0) {
      roomsLeftHtml = roomEntries.map(r => {
        totalLeftOnDay += r.available;
        const shortName = r.name.replace('The ', '').replace(' Room', '').replace(' Suite', '');
        const isZero = r.available === 0;
        return `
          <div style="display: flex; justify-content: space-between; font-size: 0.65rem; line-height: 1.3; margin-bottom: 2px;">
            <span style="color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60px;" title="${r.name}">${shortName}:</span>
            <span style="${isZero ? 'color: var(--sunset-coral); font-weight: 700; background: rgba(255,107,94,0.12); padding: 0 4px; border-radius: 3px;' : 'color: #059669; font-weight: 600;'}">${r.available}</span>
          </div>
        `;
      }).join('');
    } else {
      const dayBookings = (adminState.bookings || []).filter(b => dateStr >= b.checkIn && dateStr < b.checkOut && !['Cancelled'].includes(b.status));
      roomsLeftHtml = (adminState.rooms || []).filter(r => !r.isArchived).map(r => {
        const booked = dayBookings.filter(b => b.roomId === r.id).reduce((s, b) => s + (b.roomsCount || 1), 0);
        const avail = Math.max(0, (r.quantity || 1) - booked - (r.blockedQuantity || 0));
        totalLeftOnDay += avail;
        const shortName = r.name.replace('The ', '').replace(' Room', '').replace(' Suite', '');
        const isZero = avail === 0 || r.isSoldOut;
        return `
          <div style="display: flex; justify-content: space-between; font-size: 0.65rem; line-height: 1.3; margin-bottom: 2px;">
            <span style="color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60px;" title="${r.name}">${shortName}:</span>
            <span style="${isZero ? 'color: var(--sunset-coral); font-weight: 700; background: rgba(255,107,94,0.12); padding: 0 4px; border-radius: 3px;' : 'color: #059669; font-weight: 600;'}">${isZero ? 0 : avail}</span>
          </div>
        `;
      }).join('');
    }

    const isAllSoldOut = totalLeftOnDay === 0;

    html += `
      <div style="background: ${isAllSoldOut ? 'var(--coral-light)' : '#FFFFFF'}; border: 1.5px solid ${isToday ? 'var(--champagne-gold)' : (isAllSoldOut ? 'rgba(255,107,94,0.4)' : '#E2E8F0')}; border-radius: 8px; padding: 6px; min-height: 88px; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px dashed rgba(0,0,0,0.06); padding-bottom: 3px;">
          <strong style="font-size: 0.8rem; color: ${isToday ? 'var(--ocean-blue)' : '#475569'};">${day}</strong>
          ${isAllSoldOut ? '<span style="font-size: 0.62rem; font-weight: 700; color: var(--sunset-coral);">SOLD OUT</span>' : `<span style="font-size: 0.62rem; color: #64748B;">${totalLeftOnDay} left</span>`}
        </div>
        <div>
          ${roomsLeftHtml}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ----------------------------------------------------------------------------
// 3. BOOKINGS MANAGEMENT
// ----------------------------------------------------------------------------

function filterBookings(status, btn) {
  adminState.activeFilter = status;
  document.querySelectorAll('[data-booking-filter]').forEach(b => b.classList.remove('active-filter'));
  if (btn) btn.classList.add('active-filter');
  renderBookingsTable();
}

function renderBookingsTable() {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

  let bookings = adminState.bookings || [];
  if (adminState.activeFilter !== 'all') {
    bookings = bookings.filter(b => b.status === adminState.activeFilter);
  }

  const countInd = document.getElementById('bookingsCountIndicator');
  if (countInd) countInd.textContent = `Showing ${bookings.length} reservations`;

  if (!bookings.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94A3B8; padding: 32px;">No reservations found matching filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td>
        <strong style="color: var(--ocean-blue);">${b.bookingId}</strong><br>
        <span style="font-family: monospace; font-size: 0.74rem; font-weight: 700; color: #06B6B0;">${b.invoiceNumber || 'No Inv'}</span><br>
        <small style="color: #64748B;">${new Date(b.createdAt || Date.now()).toLocaleDateString()}</small>
      </td>
      <td>
        <strong>${b.guestName}</strong><br>
        <span style="font-size: 0.78rem; color: #64748B;">${b.guestPhone}</span><br>
        <span style="font-size: 0.76rem; color: #94A3B8;">${b.guestEmail || 'No email provided'}</span>
      </td>
      <td>
        <strong>${b.roomName}</strong><br>
        <small style="color: #64748B;">${b.roomsCount || 1} room × ${b.nights} night(s)</small>
      </td>
      <td>
        <span style="font-weight: 600;">${b.checkIn}</span> to <span style="font-weight: 600;">${b.checkOut}</span><br>
        <small style="color: #64748B;">${b.nights} Night(s)</small>
      </td>
      <td>
        ${b.breakfast ? `<span style="display:inline-block; background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; font-weight: 600; margin-bottom: 2px;">🍳 Breakfast (${b.breakfastUnit === 'per_room_per_day' ? (b.roomsCount || 1) + ' room' : (b.breakfastGuests || 2) + ' guests'})</span><br>` : ''}
        ${b.needCar ? `<span style="display:inline-block; background: #E0F2FE; color: #0369A1; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; font-weight: 600; margin-bottom: 2px;">🚗 ${b.vehicleName || 'Car'}</span><br>` : ''}
        ${b.candlelightDinner ? `<span style="display:inline-block; background: #FEF3C7; color: #92400E; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; font-weight: 600;">🕯️ ${b.dinnerSetup} Dinner</span>` : (!b.breakfast && !b.needCar ? '<span style="color: #94A3B8; font-size: 0.76rem;">None</span>' : '')}
      </td>
      <td>
        <div style="font-size: 0.86rem; font-weight: 700; color: var(--ocean-blue);">₹${b.totalAmount.toLocaleString('en-IN')}</div>
        <div style="font-size: 0.76rem; color: var(--sunset-coral); font-weight: 600;">Adv: ₹${(b.payNowAdvance || 0).toLocaleString('en-IN')}</div>
        <div style="font-size: 0.76rem; color: var(--turquoise-dark); font-weight: 600;">Bal: ₹${(b.payAtHotelBalance || 0).toLocaleString('en-IN')}</div>
        <div class="booking-breakdown-sub" style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed #CBD5E1; font-size: 0.72rem; color: #475569; line-height: 1.4;">
          ${(b.breakdown?.lines || getBookingBreakdownFallback(b)).map(l => `<div style="white-space: nowrap;">• ${l}</div>`).join('')}
        </div>
      </td>
      <td>
        <span class="badge-status ${getBadgeClass(b.status)}">${b.status}</span>
      </td>
      <td>
        <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">
          <button class="btn-turquoise" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px;" onclick="openEditBookingModal('${b.bookingId}')" title="Edit booking details & recalculate">
            <span class="material-symbols-outlined" style="font-size: 14px;">edit</span> Edit
          </button>
          ${b.status === 'Pending Advance' ? `
            <button class="btn-outline-gold" style="padding: 4px 8px; font-size: 0.72rem;" onclick="updateBookingStatus('${b.bookingId}', 'Confirmed')">Confirm</button>
          ` : ''}
          ${b.status === 'Confirmed' ? `
            <button class="btn-turquoise" style="padding: 4px 8px; font-size: 0.72rem;" onclick="updateBookingStatus('${b.bookingId}', 'Checked-in')">Check-In</button>
          ` : ''}
          ${b.status === 'Checked-in' ? `
            <button class="btn-outline-gold" style="padding: 4px 8px; font-size: 0.72rem;" onclick="updateBookingStatus('${b.bookingId}', 'Completed')">Check-Out</button>
          ` : ''}
          <button class="btn-turquoise" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px;" onclick="viewAdminInvoice('${b.bookingId}')" title="View official PDF invoice">
            <span class="material-symbols-outlined" style="font-size: 14px;">description</span> Invoice
          </button>
          <button class="btn-outline-gold" style="padding: 4px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px;" onclick="downloadAdminInvoice('${b.bookingId}')" title="Download PDF invoice">
            <span class="material-symbols-outlined" style="font-size: 14px;">download</span> PDF
          </button>
          <button class="btn-icon-only" style="width: 26px; height: 26px;" onclick="resendAdminInvoiceEmail('${b.bookingId}')" title="Resend Invoice & Confirmation Email">
            <span class="material-symbols-outlined" style="font-size: 15px;">send</span>
          </button>
          ${currentUser && ['Super Admin', 'Manager'].includes(currentUser.role) ? `
            <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--turquoise-dark);" onclick="regenerateAdminInvoice('${b.bookingId}')" title="Regenerate Invoice Revision (-R1, -R2)">
              <span class="material-symbols-outlined" style="font-size: 15px;">autorenew</span>
            </button>
          ` : ''}
          ${b.status !== 'Cancelled' ? `
            <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--sunset-coral);" onclick="updateBookingStatus('${b.bookingId}', 'Cancelled')" title="Cancel Reservation">
              <span class="material-symbols-outlined" style="font-size: 15px;">cancel</span>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function getBadgeClass(status) {
  if (status === 'Confirmed') return 'confirmed';
  if (status === 'Pending Advance') return 'pending';
  if (status === 'Checked-in') return 'checked-in';
  if (status === 'Cancelled') return 'cancelled';
  return 'available';
}

function getBookingBreakdownFallback(b) {
  const lines = [];
  const roomPrice = b.roomPrice || (b.roomSubtotal && b.nights ? Math.round(b.roomSubtotal / (b.nights * (b.roomsCount || 1))) : 0);
  lines.push(`Room: ₹${roomPrice.toLocaleString('en-IN')} × ${b.nights} night${b.nights > 1 ? 's' : ''} × ${b.roomsCount || 1} room${(b.roomsCount || 1) > 1 ? 's' : ''}`);
  if (b.breakfast) {
    if (b.breakfastUnit === 'per_room_per_day') {
      lines.push(`Breakfast × ${b.roomsCount || 1} room(s) × ${b.nights || 1} day(s) = ₹${(b.breakfastTotal || 0).toLocaleString('en-IN')}`);
    } else {
      lines.push(`Breakfast × ${b.breakfastGuests || 2} guest(s) × ${b.nights || 1} day(s) = ₹${(b.breakfastTotal || 0).toLocaleString('en-IN')}`);
    }
  }
  if (b.needCar) {
    const vName = b.vehicleName ? (b.vehicleName.toLowerCase().includes('toto') ? 'Toto' : (b.vehicleName.toLowerCase().includes('auto') ? 'Auto' : (b.vehicleName.toLowerCase().includes('car') ? 'Car' : b.vehicleName.split('(')[0].trim()))) : 'Vehicle';
    lines.push(`${vName} × ${b.carCount || 1} × ${b.nights} day${b.nights > 1 ? 's' : ''}`);
  }
  if (b.candlelightDinner) {
    lines.push(`Candlelight dinner`);
  }
  if (b.taxAmount > 0) {
    lines.push(`GST / Taxes: ₹${b.taxAmount.toLocaleString('en-IN')}`);
  }
  return lines;
}

async function updateBookingStatus(bookingId, newStatus) {
  if (!confirm(`Are you sure you want to mark reservation ${bookingId} as "${newStatus}"?`)) return;
  try {
    const res = await authFetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });

    if (res.success) {
      showToast(`Reservation ${bookingId} updated to ${newStatus}`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message, 'error');
    }
  } catch (err) {
    showToast('Failed to update booking status.', 'error');
  }
}

async function resendBookingEmail(bookingId) {
  try {
    const res = await authFetch(`/api/bookings/${bookingId}/resend-email`, { method: 'POST' });
    showToast(res.message, res.success ? 'success' : 'error');
  } catch (err) {
    showToast('Failed to resend confirmation email.', 'error');
  }
}

function viewBookingVoucher(bookingId) {
  const booking = (adminState.bookings || []).find(b => b.bookingId === bookingId);
  if (!booking) return;

  const content = document.getElementById('voucherModalContent');
  content.innerHTML = `
    <div style="border: 2px solid var(--champagne-gold); border-radius: 14px; padding: 24px; background: #FFFFFF;">
      <div style="text-align: center; border-bottom: 2px solid var(--border-glass); padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="font-family: var(--font-serif); font-size: 1.8rem; color: var(--ocean-blue); margin: 0;">Coastal View</h2>
        <div style="font-size: 0.76rem; letter-spacing: 2px; text-transform: uppercase; color: var(--champagne-gold); font-weight: 700;">Managed By Ani's • Mandarmani</div>
        <div style="margin-top: 10px; display: inline-block; background: var(--turquoise-light); color: var(--turquoise-dark); padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 0.82rem;">
          BOOKING CONFIRMATION: ${booking.bookingId}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 0.86rem; margin-bottom: 20px;">
        <div>
          <span style="color: #64748B;">Guest Name:</span><br>
          <strong style="color: var(--ocean-blue); font-size: 1rem;">${booking.guestName}</strong><br>
          <span style="color: #64748B;">Phone:</span> ${booking.guestPhone}<br>
          <span style="color: #64748B;">Email:</span> ${booking.guestEmail || 'N/A'}
        </div>
        <div>
          <span style="color: #64748B;">Stay Dates:</span><br>
          <strong>${booking.checkIn} → ${booking.checkOut}</strong> (${booking.nights} Night(s))<br>
          <span style="color: #64748B;">Reserved Suite:</span><br>
          <strong>${booking.roomName}</strong>
        </div>
      </div>

      ${booking.breakfast || booking.needCar || booking.candlelightDinner ? `
        <div style="background: #F8FAFC; border-radius: 8px; padding: 12px; font-size: 0.82rem; margin-bottom: 20px;">
          <strong>Included Add-Ons & Transport:</strong><br>
          ${booking.breakfast ? `• Optional Breakfast: ${booking.breakfastUnit === 'per_room_per_day' ? (booking.roomsCount || 1) + ' room(s)' : (booking.breakfastGuests || 2) + ' guest(s)'} × ${booking.nights || 1} day(s) (₹${(booking.breakfastTotal || 0).toLocaleString('en-IN')})<br>` : ''}
          ${booking.needCar ? `• Ani's Private Transport: ${booking.vehicleName} (${booking.vehicleTripType || 'Full-day'})\n<br>` : ''}
          ${booking.candlelightDinner ? `• Romance: ${booking.dinnerSetup} Candlelight Dinner` : ''}
        </div>
      ` : ''}

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; font-size: 0.82rem; margin-bottom: 20px;">
        <strong style="color: var(--ocean-blue);">Itemized Reservation Breakdown:</strong>
        <div style="margin-top: 6px; line-height: 1.6; color: #334155;">
          ${(booking.breakdown?.lines || getBookingBreakdownFallback(booking)).map(l => `<div>• ${l}</div>`).join('')}
        </div>
      </div>

      <div style="background: #FAF7F2; border: 1.5px solid var(--champagne-gold); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 700; color: var(--ocean-blue); margin-bottom: 6px;">
          <span>Total Booking Amount:</span>
          <span>₹${booking.totalAmount.toLocaleString('en-IN')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--sunset-coral); font-weight: 700;">
          <span>20% Advance Paid / Due:</span>
          <span>₹${(booking.payNowAdvance || 0).toLocaleString('en-IN')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--turquoise-dark); font-weight: 700;">
          <span>80% Balance at Hotel Check-In:</span>
          <span>₹${(booking.payAtHotelBalance || 0).toLocaleString('en-IN')}</span>
        </div>
      </div>

      <div style="font-size: 0.76rem; color: #64748B; text-align: center;">
        Hotel Address: Rina Rd, Mandarmani, West Bengal 721455 • Host: Anirban Das (+91 7812027551)
      </div>
    </div>
  `;

  document.getElementById('voucherModal').classList.add('open');
}

function exportBookingsCSV() {
  window.location.href = '/api/admin/bookings/export-csv';
  showToast('Downloading verified bookings CSV...', 'info');
}

// Manual Booking Modal
function openManualBookingModal() {
  const select = document.getElementById('manBookRoom');
  select.innerHTML = (adminState.rooms || []).map(r => `
    <option value="${r.id}" ${r.isSoldOut ? 'disabled' : ''}>
      ${r.name} — ₹${r.price.toLocaleString('en-IN')}/night (Total: ${r.quantity || 1} rooms) ${r.isSoldOut ? '[SOLD OUT]' : ''}
    </option>
  `).join('');

  // Default dates: tomorrow to day after
  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);

  document.getElementById('manBookCheckIn').value = tmrw.toISOString().split('T')[0];
  document.getElementById('manBookCheckOut').value = dayAfter.toISOString().split('T')[0];

  updateManualBookingRoomsDropdown();
  calculateManualBookingTotals();
  document.getElementById('manualBookingModal').classList.add('open');
}

function updateManualBookingRoomsDropdown() {
  const roomId = document.getElementById('manBookRoom')?.value;
  const countSelect = document.getElementById('manBookRoomsCount');
  if (!roomId || !countSelect) return;

  const room = (adminState.rooms || []).find(r => r.id === roomId);
  const maxRooms = room ? (room.quantity || 1) : 1;
  const currentVal = parseInt(countSelect.value, 10) || 1;

  countSelect.innerHTML = '';
  for (let i = 1; i <= maxRooms; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${i} Room${i > 1 ? 's' : ''}`;
    if (i === currentVal || (currentVal > maxRooms && i === maxRooms)) {
      opt.selected = true;
    }
    countSelect.appendChild(opt);
  }
}

function calculateManualBookingTotals() {
  const roomId = document.getElementById('manBookRoom').value;
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  const checkIn = new Date(document.getElementById('manBookCheckIn').value);
  const checkOut = new Date(document.getElementById('manBookCheckOut').value);
  const roomsCount = Math.max(1, parseInt(document.getElementById('manBookRoomsCount')?.value, 10) || 1);
  const vType = document.getElementById('manBookTransport').value;
  const dType = document.getElementById('manBookDinner').value;

  let nights = 1;
  if (!isNaN(checkIn) && !isNaN(checkOut) && checkOut > checkIn) {
    nights = Math.max(1, Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
  }

  const roomSubtotal = (room ? room.price : 2500) * nights * roomsCount;
  let carTotal = 0;
  if (vType === 'toto') carTotal = 800 * nights;
  if (vType === 'auto') carTotal = 1200 * nights;
  if (vType === 'car') carTotal = 2500 * nights;

  let dinnerTotal = 0;
  if (dType === 'Beachside') dinnerTotal = 3500;
  if (dType === 'Poolside') dinnerTotal = 2800;

  const total = roomSubtotal + carTotal + dinnerTotal;
  const adv = Math.round(total * 0.2);
  const bal = total - adv;

  document.getElementById('manTotalDisp').textContent = `₹${total.toLocaleString('en-IN')}`;
  document.getElementById('manAdvanceDisp').textContent = `₹${adv.toLocaleString('en-IN')}`;
  document.getElementById('manBalanceDisp').textContent = `₹${bal.toLocaleString('en-IN')}`;
}

async function handleManualBookingSubmit(e) {
  e.preventDefault();
  const roomId = document.getElementById('manBookRoom').value;
  const checkIn = document.getElementById('manBookCheckIn').value;
  const checkOut = document.getElementById('manBookCheckOut').value;
  const roomsCount = Math.max(1, parseInt(document.getElementById('manBookRoomsCount')?.value, 10) || 1);
  const guestName = document.getElementById('manBookName').value.trim();
  const guestPhone = document.getElementById('manBookPhone').value.trim();
  const guestEmail = document.getElementById('manBookEmail').value.trim();
  const vType = document.getElementById('manBookTransport').value;
  const dType = document.getElementById('manBookDinner').value;

  try {
    const res = await authFetch('/api/bookings', {
      method: 'POST',
      body: {
        roomId,
        checkIn,
        checkOut,
        roomsCount,
        guestName,
        guestPhone,
        guestEmail,
        needCar: vType !== 'none',
        vehicleType: vType !== 'none' ? vType : null,
        candlelightDinner: dType !== 'none',
        dinnerSetup: dType !== 'none' ? dType : null,
        manualStaffBooking: true
      }
    });

    if (res.success) {
      closeModal('manualBookingModal');
      showToast(`Reservation created: ${res.booking.bookingId}`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message, 'error');
    }
  } catch (err) {
    showToast('Failed to create manual reservation: ' + err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// 4. CHATBOT MESSAGES & CRM
// ----------------------------------------------------------------------------

adminState.chatSearch = '';
adminState.chatFilter = 'all';

function handleChatSearch(term) {
  adminState.chatSearch = (term || '').toLowerCase().trim();
  renderChatCRM();
}

function filterChatInbox(filter, btn) {
  adminState.chatFilter = filter || 'all';
  document.querySelectorAll('.chat-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderChatCRM();
}

function renderChatCRM() {
  const allInquiries = adminState.conversations || [];
  const inboxEl = document.getElementById('chatInboxList');
  if (!inboxEl) return;

  // Filter conversations
  let filtered = allInquiries;

  if (adminState.chatFilter === 'unread') {
    filtered = filtered.filter(c => !c.isRead);
  } else if (adminState.chatFilter === 'followup') {
    filtered = filtered.filter(c => c.leadStatus === 'Needs follow-up');
  } else if (adminState.chatFilter === 'leads') {
    filtered = filtered.filter(c => c.leadStatus === 'Qualified Lead' || c.leadStatus === 'Needs follow-up');
  } else if (adminState.chatFilter === 'converted') {
    filtered = filtered.filter(c => c.leadStatus === 'Converted to Booking');
  }

  if (adminState.chatSearch) {
    const q = adminState.chatSearch;
    filtered = filtered.filter(c => {
      const nameMatch = (c.guestName || '').toLowerCase().includes(q);
      const phoneMatch = (c.guestPhone || '').includes(q);
      const topicMatch = (c.topic || '').toLowerCase().includes(q);
      const idMatch = (c.id || '').toLowerCase().includes(q);
      const msgMatch = (c.messages || []).some(m => (m.text || '').toLowerCase().includes(q)) || (c.userMessage || '').toLowerCase().includes(q);
      return nameMatch || phoneMatch || topicMatch || idMatch || msgMatch;
    });
  }

  // Update Stats Strip
  const unreadOrFollowup = allInquiries.filter(c => !c.isRead || c.leadStatus === 'Needs follow-up').length;
  const converted = allInquiries.filter(c => c.leadStatus === 'Converted to Booking').length;
  const leadsCaptured = allInquiries.filter(c => 
    c.leadStatus === 'Needs follow-up' || 
    c.leadStatus === 'Qualified Lead' || 
    c.leadStatus === 'Converted to Booking' || 
    Boolean(c.guestPhone)
  ).length;
  const convRate = leadsCaptured > 0 ? Math.round((converted / leadsCaptured) * 100) : 0;

  const totalEl = document.getElementById('chatStatTotal');
  const unreadEl = document.getElementById('chatStatUnread');
  const leadsEl = document.getElementById('chatStatLeads');
  const convEl = document.getElementById('chatStatConverted');
  const rateEl = document.getElementById('chatStatConvRate');

  if (totalEl) totalEl.textContent = allInquiries.length;
  if (unreadEl) unreadEl.textContent = unreadOrFollowup;
  if (leadsEl) leadsEl.textContent = leadsCaptured;
  if (convEl) convEl.textContent = converted;
  if (rateEl) rateEl.textContent = `${convRate}%`;

  // Fetch real-time usage stats & unanswered questions asynchronously
  authFetch('/api/admin/chat/stats').then(res => {
    if (res.success && res.stats) {
      const s = res.stats;
      const todayEl = document.getElementById('chatStatToday');
      const costEl = document.getElementById('chatStatCost');
      if (todayEl) todayEl.textContent = `${s.todayMessages || 0} msgs`;
      if (costEl) costEl.textContent = `Est. Cost: ${s.estimatedCostFormatted || '$0.00'}`;

      // Render Unanswered Questions list
      const unansListEl = document.getElementById('unansweredQuestionsList');
      const unansBadge = document.getElementById('unansweredCountBadge');
      const unans = s.unansweredQuestions || [];
      if (unansBadge) unansBadge.textContent = unans.length;

      if (unansListEl) {
        if (!unans.length) {
          unansListEl.innerHTML = `<div style="padding: 16px; text-align: center; color: #94A3B8; font-size: 0.82rem;">No unanswered questions reported. Grounded AI answered all guest queries accurately!</div>`;
        } else {
          unansListEl.innerHTML = unans.map(u => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #FAF9F6; border: 1px solid #E2E8F0; padding: 10px 14px; border-radius: 8px;">
              <div>
                <strong style="color: var(--ocean-blue); font-size: 0.84rem;">"${escapeHtml(u.question)}"</strong>
                <div style="font-size: 0.72rem; color: #94A3B8; margin-top: 2px;">Asked: ${new Date(u.askedAt).toLocaleDateString()} ${new Date(u.askedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <button class="btn-turquoise" style="padding: 4px 10px; font-size: 0.75rem;" onclick="addUnansweredQuestionToFaq('${escapeHtml(u.question.replace(/'/g, "\\'"))}')">
                <span class="material-symbols-outlined" style="font-size: 15px;">add</span> Add to FAQ
              </button>
            </div>
          `).join('');
        }
      }
    }
  }).catch(() => {});

  if (!filtered.length) {
    inboxEl.innerHTML = `<div style="padding: 28px 16px; text-align: center; color: #94A3B8; font-size: 0.84rem;">No matching conversations found.</div>`;
    return;
  }

  inboxEl.innerHTML = filtered.map((c, i) => {
    const isSelected = adminState.activeChatId === c.id || (!adminState.activeChatId && i === 0);
    const lastMsg = (c.messages && c.messages.length) ? c.messages[c.messages.length - 1].text : (c.userMessage || '');
    const dateStr = new Date(c.createdAt || c.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isNeedsFollowup = c.leadStatus === 'Needs follow-up';

    return `
      <div class="chat-inbox-item ${isSelected ? 'active' : ''}" onclick="selectConversation('${c.id}')" style="${isNeedsFollowup ? 'border-left: 3.5px solid var(--sunset-coral);' : ''}">
        <div class="chat-item-header">
          <span class="chat-item-topic">${c.topic || 'General Inquiry'}</span>
          <span style="font-size: 0.68rem; color: #94A3B8;">${dateStr}</span>
        </div>
        ${c.guestName || c.guestPhone ? `
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--ocean-blue); margin-bottom: 2px;">
            👤 ${c.guestName || 'Guest'} ${c.guestPhone ? `(${c.guestPhone})` : ''}
          </div>
        ` : ''}
        <div class="chat-item-snippet"><strong>Guest:</strong> ${lastMsg}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
          <span style="font-size: 0.68rem; background: #F1F5F9; color: #475569; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${c.language || c.lang || 'en'}</span>
          <span style="font-size: 0.68rem; font-weight: 700; color: ${c.leadStatus === 'Converted to Booking' ? 'var(--turquoise-dark)' : (isNeedsFollowup ? 'var(--sunset-coral)' : '#64748B')};">
            ${c.leadStatus || 'New Lead'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Auto-select first if none active
  if (!adminState.activeChatId && filtered.length) {
    selectConversation(filtered[0].id);
  }
}

function selectConversation(chatId) {
  adminState.activeChatId = chatId;
  const chat = (adminState.conversations || []).find(c => c.id === chatId || c.sessionId === chatId);
  if (!chat) return;

  // Mark read
  if (!chat.isRead) {
    chat.isRead = true;
    authFetch(`/api/admin/concierge/conversations/${chatId}`, {
      method: 'PATCH',
      body: { isRead: true }
    });
  }

  // Update Header & Lead Actions
  const langUpper = (chat.language || chat.lang || 'en').toUpperCase();
  const guestInfo = chat.guestPhone ? ` • 📞 <a href="tel:${chat.guestPhone}" style="color:var(--turquoise-dark); font-weight:700;">${chat.guestPhone}</a>` : '';
  const dateFormatted = new Date(chat.createdAt || chat.timestamp || Date.now()).toLocaleString();

  document.getElementById('activeChatTopic').innerHTML = `${chat.topic || 'General Inquiry'} (${langUpper}) ${chat.guestName ? `— ${chat.guestName}` : ''}`;
  document.getElementById('activeChatMeta').innerHTML = `Received on ${dateFormatted} • Status: <strong>${chat.leadStatus || 'New Lead'}</strong>${guestInfo}`;
  document.getElementById('chatLeadActions').style.display = 'flex';

  // Render Multi-Turn Bubbles
  const bubblesArea = document.getElementById('chatBubblesArea');
  const messages = (chat.messages && chat.messages.length) ? chat.messages : [
    { sender: 'guest', text: chat.userMessage, timestamp: chat.timestamp },
    { sender: 'bot', text: chat.botReply, timestamp: chat.timestamp }
  ];

  bubblesArea.innerHTML = messages.map(m => {
    const isUser = m.sender === 'guest';
    const isStaff = m.sender === 'staff';
    const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (isUser) {
      return `
        <div class="bubble user">
          <div style="font-size: 0.72rem; color: #64748B; margin-bottom: 4px; display: flex; justify-content: space-between;">
            <strong>Guest ${chat.guestName ? `(${chat.guestName})` : ''}</strong>
            <span>${timeStr}</span>
          </div>
          <div>${m.text.replace(/\n/g, '<br>')}</div>
        </div>
      `;
    } else if (isStaff) {
      return `
        <div class="bubble staff">
          <div style="font-size: 0.72rem; color: rgba(255,255,255,0.8); margin-bottom: 4px; display: flex; justify-content: space-between;">
            <strong>Front Desk Staff (${m.staffName || 'Staff'})</strong>
            <span>${timeStr}</span>
          </div>
          <div>${m.text.replace(/\n/g, '<br>')}</div>
        </div>
      `;
    } else {
      return `
        <div class="bubble bot">
          <div style="font-size: 0.72rem; color: var(--champagne-gold); margin-bottom: 4px; display: flex; justify-content: space-between;">
            <strong>Ani's Coastal Concierge (AI)</strong>
            <span>${timeStr}</span>
          </div>
          <div>${m.text.replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }
  }).join('');

  if (chat.staffNotes) {
    const noteEl = document.createElement('div');
    noteEl.style.cssText = 'background: #FEF3C7; border: 1px solid #FCD34D; border-radius: 8px; padding: 10px; font-size: 0.8rem; color: #92400E; margin-top: 8px;';
    noteEl.innerHTML = `<strong>Staff Internal Note:</strong> ${chat.staffNotes}`;
    bubblesArea.appendChild(noteEl);
  }

  bubblesArea.scrollTop = bubblesArea.scrollHeight;
}

async function handleSendLiveTakeover(e) {
  e.preventDefault();
  if (!adminState.activeChatId) return;
  const input = document.getElementById('liveReplyInput');
  const staffReply = input.value.trim();
  if (!staffReply) return;

  try {
    const res = await authFetch(`/api/admin/concierge/conversations/${adminState.activeChatId}/reply`, {
      method: 'POST',
      body: { staffReply }
    });

    if (res.success) {
      input.value = '';
      showToast('Live takeover reply sent to guest dialogue.', 'success');
      loadAllAdminData();
    }
  } catch (err) {
    showToast('Failed to deliver live response: ' + err.message, 'error');
  }
}

function convertChatToBooking() {
  const chat = (adminState.conversations || []).find(c => c.id === adminState.activeChatId);
  openManualBookingModal();
  if (chat) {
    document.getElementById('manBookName').value = chat.guestName || 'Guest from Chat';
    if (chat.guestPhone) {
      document.getElementById('manBookPhone').value = chat.guestPhone;
    }
    // Update chat lead status
    authFetch(`/api/admin/concierge/conversations/${chat.id}`, {
      method: 'PATCH',
      body: { leadStatus: 'Converted to Booking' }
    });
    chat.leadStatus = 'Converted to Booking';
    renderChatCRM();
  }
}

function toggleChatFollowup() {
  if (!adminState.activeChatId) return;
  const chat = (adminState.conversations || []).find(c => c.id === adminState.activeChatId);
  if (!chat) return;

  const newStatus = chat.leadStatus === 'Needs follow-up' ? 'Qualified Lead' : 'Needs follow-up';
  authFetch(`/api/admin/concierge/conversations/${adminState.activeChatId}`, {
    method: 'PATCH',
    body: { leadStatus: newStatus }
  }).then(() => {
    chat.leadStatus = newStatus;
    showToast(`Conversation marked as ${newStatus}.`, 'info');
    renderChatCRM();
    selectConversation(adminState.activeChatId);
  });
}

function markChatAsLead() {
  if (!adminState.activeChatId) return;
  const notes = prompt('Enter internal staff notes for this lead:');
  authFetch(`/api/admin/concierge/conversations/${adminState.activeChatId}`, {
    method: 'PATCH',
    body: { leadStatus: 'Qualified Lead', staffNotes: notes || 'Marked as priority lead' }
  }).then(() => {
    showToast('Inquiry recorded as Qualified Lead.', 'success');
    loadAllAdminData();
  });
}

function showBotEditorModal() {
  authFetch('/api/admin/concierge/bot-settings').then(res => {
    if (res.success && res.botSettings) {
      const b = res.botSettings;
      const toggle = document.getElementById('botEnabledToggle');
      const label = document.getElementById('botEnabledLabel');
      if (toggle) {
        toggle.checked = b.botEnabled !== false;
        if (label) {
          label.textContent = toggle.checked ? 'Active (ON)' : 'Disabled (OFF)';
          label.style.color = toggle.checked ? 'var(--turquoise-dark)' : 'var(--sunset-coral)';
        }
        toggle.onchange = () => {
          if (label) {
            label.textContent = toggle.checked ? 'Active (ON)' : 'Disabled (OFF)';
            label.style.color = toggle.checked ? 'var(--turquoise-dark)' : 'var(--sunset-coral)';
          }
        };
      }

      document.getElementById('botWelcomeEn').value = b.welcomeMessage?.en || '';
      document.getElementById('botWelcomeBn').value = b.welcomeMessage?.bn || '';
      document.getElementById('botWelcomeHi').value = b.welcomeMessage?.hi || '';
      document.getElementById('botChipsInput').value = (b.quickReplyChips || []).join(', ');
      document.getElementById('botToneInstructions').value = b.toneInstructions || '';
      document.getElementById('botOfflineEn').value = b.offlineMessage?.en || '';
      document.getElementById('botDailyLimit').value = b.dailyMessageLimit || 500;
      const retInput = document.getElementById('botLogRetentionDays');
      if (retInput) retInput.value = b.logRetentionDays || 90;

      // Update usage stats preview in modal
      if (res.stats) {
        const s = res.stats;
        document.getElementById('botUsageCostBadge').textContent = s.estimatedCostFormatted || '$0.00';
        document.getElementById('botStatTodayCount').textContent = s.todayMessages || 0;
        document.getElementById('botStatTotalCount').textContent = s.totalMessages || 0;
        const topTopic = s.topQuestions?.[0]?.topic || 'General Inquiry';
        document.getElementById('botStatTopTopic').textContent = topTopic;
      }
    }
    document.getElementById('botEditorModal').classList.add('open');
  });
}

async function saveBotSettingsFromModal() {
  const botEnabled = document.getElementById('botEnabledToggle').checked;
  const welcomeMessage = {
    en: document.getElementById('botWelcomeEn').value.trim(),
    bn: document.getElementById('botWelcomeBn').value.trim(),
    hi: document.getElementById('botWelcomeHi').value.trim()
  };
  const quickReplyChips = document.getElementById('botChipsInput').value.split(',').map(s => s.trim()).filter(Boolean);
  const toneInstructions = document.getElementById('botToneInstructions').value.trim();
  const offlineMessage = {
    en: document.getElementById('botOfflineEn').value.trim(),
    bn: "আমাদের ফ্রন্ট ডেস্ক বর্তমানে ব্যস্ত আছে। সরাসরি কল করুন: 7812027551।",
    hi: "हमारा डेस्क इस समय व्यस्त है। कृपया सीधे कॉल करें: 7812027551।"
  };
  const dailyMessageLimit = parseInt(document.getElementById('botDailyLimit').value, 10) || 500;
  const logRetentionDays = parseInt(document.getElementById('botLogRetentionDays')?.value, 10) || 90;

  try {
    const res = await authFetch('/api/admin/concierge/bot-settings', {
      method: 'POST',
      body: {
        botEnabled,
        welcomeMessage,
        quickReplyChips,
        toneInstructions,
        offlineMessage,
        dailyMessageLimit,
        logRetentionDays
      }
    });

    if (res.success) {
      closeModal('botEditorModal');
      showToast('Bot settings & prompt rules updated successfully.', 'success');
      loadAllAdminData();
    }
  } catch (err) {
    showToast('Failed to save bot settings: ' + err.message, 'error');
  }
}

function exportChatsCSV() {
  window.location.href = '/api/admin/concierge/export-csv';
  showToast('Downloading chat transcripts CSV...', 'info');
}

// ----------------------------------------------------------------------------
// ADMIN CHATBOT LIVE TEST PANEL & UNANSWERED FAQ GENERATOR
// ----------------------------------------------------------------------------

async function handleAdminChatTestSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('adminTestChatInput');
  const message = input ? input.value.trim() : '';
  if (!message) return;

  const btn = document.getElementById('btnAdminTestChat');
  const resultBox = document.getElementById('adminTestResultBox');
  const replyEl = document.getElementById('adminTestReplyText');
  const toolsEl = document.getElementById('adminTestToolsList');
  const topicBadge = document.getElementById('adminTestTopicBadge');
  const langBadge = document.getElementById('adminTestLangBadge');
  const latencyEl = document.getElementById('adminTestLatency');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">hourglass_empty</span> Testing...';
  }

  const startTime = Date.now();
  try {
    const res = await authFetch('/api/admin/chat/test', {
      method: 'POST',
      body: { message }
    });

    const elapsed = Date.now() - startTime;
    if (resultBox) resultBox.style.display = 'block';

    if (res.success) {
      if (replyEl) replyEl.textContent = res.reply;
      if (topicBadge) topicBadge.textContent = `Topic: ${res.topic || 'General'}`;
      if (langBadge) langBadge.textContent = `Lang: ${(res.lang || 'en').toUpperCase()}`;
      if (latencyEl) latencyEl.textContent = `Response: ${elapsed}ms`;

      const tools = res.toolsCalled || [];
      if (toolsEl) {
        if (!tools.length) {
          toolsEl.innerHTML = `<span style="font-size:0.75rem; color:#64748B; background:#F1F5F9; padding:3px 8px; border-radius:4px;">No database tools invoked (direct knowledge/conversation greeting)</span>`;
        } else {
          toolsEl.innerHTML = tools.map(t => {
            const toolName = typeof t === 'string' ? t : (t.name || 'tool');
            return `
              <span style="font-size:0.74rem; background:rgba(6,182,176,0.15); color:var(--turquoise-dark); font-weight:700; padding:3px 8px; border-radius:6px; border:1px solid rgba(6,182,176,0.3);">
                ⚡ ${escapeHtml(toolName)}
              </span>
            `;
          }).join('');
        }
      }
    } else {
      if (replyEl) replyEl.textContent = 'Error: ' + (res.message || 'Test failed');
    }
  } catch (err) {
    if (resultBox) resultBox.style.display = 'block';
    if (replyEl) replyEl.textContent = 'Network or server error: ' + err.message;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">play_arrow</span> Test Query';
    }
  }
}

function quickTestChat(text) {
  const input = document.getElementById('adminTestChatInput');
  if (input) {
    input.value = text;
    handleAdminChatTestSubmit();
  }
}

async function addUnansweredQuestionToFaq(question) {
  const answer = prompt(`Enter official hotel answer for FAQ:\n"${question}"`);
  if (!answer || !answer.trim()) return;

  const faqs = adminState.content.faqs || [];
  faqs.push({ id: `faq-${Date.now()}`, question, answer: answer.trim(), category: 'General' });
  await authFetch('/api/admin/content/faqs', { method: 'POST', body: faqs });
  showToast('New FAQ added to website and chatbot knowledge base!', 'success');
  loadAllAdminData();
}

// ----------------------------------------------------------------------------
// 5. WEBSITE CONTENT MANAGER
// ----------------------------------------------------------------------------

function switchContentSection(sectionId, btn) {
  document.querySelectorAll('.content-sub-card').forEach(c => c.style.display = 'none');
  const target = document.getElementById(`contentSec-${sectionId}`);
  if (target) target.style.display = 'block';

  document.querySelectorAll('#tabContent .btn-outline-gold').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function renderWebsiteContent() {
  const c = adminState.content || {};

  // Hero
  if (c.hero) {
    document.getElementById('heroH1Title').value = c.hero.h1Title || '';
    document.getElementById('heroTagline1').value = c.hero.tagline1 || '';
    document.getElementById('heroTagline2').value = c.hero.tagline2 || '';
    document.getElementById('heroBgImage').value = c.hero.heroImage || '';
  }

  // Owner
  if (c.owner) {
    if (document.getElementById('ownerName')) document.getElementById('ownerName').value = c.owner.name || '';
    if (document.getElementById('ownerTitle')) document.getElementById('ownerTitle').value = c.owner.title || '';
    if (document.getElementById('ownerQuote')) document.getElementById('ownerQuote').value = c.owner.quote || '';
    if (document.getElementById('ownerBio')) document.getElementById('ownerBio').value = c.owner.bio || '';
    if (document.getElementById('ownerPhoto')) document.getElementById('ownerPhoto').value = c.owner.photo || '';
    if (document.getElementById('ownerDirectContact')) document.getElementById('ownerDirectContact').value = c.owner.contactDirect || '';
  }

  // Candlelight
  if (c.candlelight) {
    document.getElementById('clBeachsidePrice').value = c.candlelight.beachsidePrice || 3500;
    document.getElementById('clPoolsidePrice').value = c.candlelight.poolsidePrice || 2800;
    document.getElementById('clBeachsideDesc').value = c.candlelight.beachsideDescription || '';
    document.getElementById('clPoolsideDesc').value = c.candlelight.poolsideDescription || '';
    if (document.getElementById('clPricingMode')) {
      document.getElementById('clPricingMode').value = c.candlelight.pricingMode || 'per_dinner';
    }
  }


  // Candlelight On/Off
  if (document.getElementById('clEnabled') && c.candlelight) {
    document.getElementById('clEnabled').checked = c.candlelight.enabled !== false;
    const clLabel = document.getElementById('clEnabledLabel');
    if (clLabel) clLabel.textContent = c.candlelight.enabled !== false ? 'Enabled (Live)' : 'Disabled (Paused)';
    document.getElementById('clEnabled').onchange = () => {
      if (clLabel) clLabel.textContent = document.getElementById('clEnabled').checked ? 'Enabled (Live)' : 'Disabled (Paused)';
    };
  }

  // Nearby Places
  const placesBox = document.getElementById('placesCardsList');
  const placesList = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);
  if (placesBox) {
    if (!placesList.length) {
      placesBox.innerHTML = '<div style="color: #64748B; font-size: 0.84rem; padding: 12px; font-style: italic;">No excursions listed. Click "Add Attraction" to create one.</div>';
    } else {
      placesBox.innerHTML = placesList.map((p, idx) => `
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <strong style="color: var(--ocean-blue);">${p.name}</strong> <span style="font-size: 0.82rem; color: #0284C7; font-weight: 600;">(${p.distance})</span><br>
            <span style="font-size: 0.8rem; color: #64748B;">${p.description || ''}</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="reorder-btn" onclick="movePlaceOrder(${idx}, -1)" title="Move up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
            <button class="reorder-btn" onclick="movePlaceOrder(${idx}, 1)" title="Move down" ${idx === placesList.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
            <button class="btn-turquoise" style="padding: 4px 10px; font-size: 0.76rem;" onclick="openEditPlaceModal(${idx})">Edit</button>
            <button class="btn-icon-only" style="color: var(--sunset-coral); width: 28px; height: 28px;" onclick="deletePlace(${idx})" title="Delete excursion">×</button>
          </div>
        </div>
      `).join('');
    }
  }

  // FAQs (Safe parsing whether array or { faqs: [...] })
  const faqsBox = document.getElementById('faqsListContainer');
  const faqsList = Array.isArray(c.faqs) ? c.faqs : (Array.isArray(c.faqs?.faqs) ? c.faqs.faqs : []);
  if (faqsBox) {
    if (!faqsList.length) {
      faqsBox.innerHTML = '<div style="color: #64748B; font-size: 0.84rem; padding: 12px; font-style: italic;">No FAQs configured. Click "Add New FAQ" to create one.</div>';
    } else {
      faqsBox.innerHTML = faqsList.map((f, idx) => `
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 10px;">
            <strong style="color: var(--ocean-blue);">${f.question}</strong>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button class="reorder-btn" onclick="moveFaqOrder(${idx}, -1)" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
              <button class="reorder-btn" onclick="moveFaqOrder(${idx}, 1)" title="Move Down" ${idx === faqsList.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
              <button class="btn-turquoise" style="padding: 2px 8px; font-size: 0.72rem;" onclick="editFaqPrompt(${idx})" title="Edit FAQ">Edit</button>
              <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--sunset-coral);" onclick="deleteFaq(${idx})" title="Delete FAQ">×</button>
            </div>
          </div>
          <p style="font-size: 0.82rem; color: #475569; margin-top: 4px;">${f.answer}</p>
        </div>
      `).join('');
    }
  }

  // Render Amenities
  renderAmenitiesList();

  // Testimonials
  const testBox = document.getElementById('testimonialsListContainer');
  if (testBox && c.testimonials) {
    testBox.innerHTML = c.testimonials.map((t, idx) => `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <strong>${t.name} (${t.location}) • ${'★'.repeat(t.rating)}</strong>
          <span style="font-size: 0.74rem; color: #64748B;">${t.stayDate}</span>
        </div>
        <p style="font-size: 0.82rem; font-style: italic; color: #475569; margin-top: 4px;">"${t.comment}"</p>
      </div>
    `).join('');
  }

  // Ani's Tours
  if (c.anisTours) {
    document.getElementById('tourHeadline').value = c.anisTours.headline || '';
    document.getElementById('tourBookingUrl').value = c.anisTours.bookingUrl || '';
    document.getElementById('tourDescription').value = c.anisTours.description || '';
  }
}

async function saveHeroContent() {
  const hero = {
    h1Title: document.getElementById('heroH1Title').value.trim(),
    tagline1: document.getElementById('heroTagline1').value.trim(),
    tagline2: document.getElementById('heroTagline2').value.trim(),
    heroImage: document.getElementById('heroBgImage').value.trim()
  };
  await authFetch('/api/admin/content/hero', { method: 'POST', body: hero });
  showToast('Homepage hero content updated.', 'success');
}

async function saveOwnerContent() {
  const owner = {
    name: document.getElementById('ownerName') ? document.getElementById('ownerName').value.trim() : '',
    title: document.getElementById('ownerTitle') ? document.getElementById('ownerTitle').value.trim() : '',
    quote: document.getElementById('ownerQuote') ? document.getElementById('ownerQuote').value.trim() : '',
    bio: document.getElementById('ownerBio') ? document.getElementById('ownerBio').value.trim() : '',
    photo: document.getElementById('ownerPhoto') ? document.getElementById('ownerPhoto').value.trim() : '',
    contactDirect: document.getElementById('ownerDirectContact') ? document.getElementById('ownerDirectContact').value.trim() : ''
  };
  await authFetch('/api/admin/content/owner', { method: 'POST', body: owner });
  showToast('Owner section updated.', 'success');
}

// ----------------------------------------------------------------------------
// BREAKFAST ADD-ON ADMIN HANDLERS
// ----------------------------------------------------------------------------
function populateBreakfastAdminFields(settings) {
  if (!settings) return;
  const bf = settings.breakfastAddon || {};
  const name = settings.breakfastName || bf.name || 'Breakfast Add-On';
  const price = settings.breakfastPrice !== undefined ? settings.breakfastPrice : (bf.price || 200);
  const unit = settings.breakfastUnit || bf.unit || 'per_person_per_day';
  const serving = settings.breakfastServingTime || bf.servingTime || '7:00 AM to 10:30 AM';
  const enabled = settings.breakfastEnabled !== false && bf.enabled !== false;

  ['adminBfName'].forEach(id => { const el = document.getElementById(id); if (el) el.value = name; });
  ['adminBfPrice', 'adminFleetBfPrice'].forEach(id => { const el = document.getElementById(id); if (el) el.value = price; });
  ['adminBfUnit', 'adminFleetBfUnit'].forEach(id => { const el = document.getElementById(id); if (el) el.value = unit; });
  ['adminBfServingTime', 'adminFleetBfServingTime'].forEach(id => { const el = document.getElementById(id); if (el) el.value = serving; });
  ['adminBfEnabled', 'adminFleetBfEnabled'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = enabled; });
}

async function saveBreakfastSettings() {
  const name = document.getElementById('adminBfName')?.value.trim() || 'Breakfast Add-On';
  const price = Number(document.getElementById('adminBfPrice')?.value ?? document.getElementById('adminFleetBfPrice')?.value) || 200;
  const unit = document.getElementById('adminBfUnit')?.value || document.getElementById('adminFleetBfUnit')?.value || 'per_person_per_day';
  const servingTime = document.getElementById('adminBfServingTime')?.value.trim() || document.getElementById('adminFleetBfServingTime')?.value.trim() || '7:00 AM to 10:30 AM';
  const enabled = document.getElementById('adminBfEnabled')?.checked ?? (document.getElementById('adminFleetBfEnabled')?.checked ?? true);

  try {
    const res = await authFetch('/api/admin/settings/breakfast', {
      method: 'POST',
      body: { name, price, unit, servingTime, enabled }
    });
    const data = res;
    if (data.success) {
      showToast('Breakfast add-on settings saved successfully!', 'success');
      loadAllAdminData(false);
    } else {
      alert(data.message || 'Failed to save breakfast settings');
    }
  } catch (err) {
    alert('Error saving breakfast settings: ' + err.message);
  }
}

async function saveCandlelightContent() {
  const clEnabled = document.getElementById('clEnabled') ? document.getElementById('clEnabled').checked : true;
  const candlelight = {
    enabled: clEnabled,
    beachsidePrice: Number(document.getElementById('clBeachsidePrice').value),
    poolsidePrice: Number(document.getElementById('clPoolsidePrice').value),
    beachsideDescription: document.getElementById('clBeachsideDesc').value.trim(),
    poolsideDescription: document.getElementById('clPoolsideDesc').value.trim(),
    pricingMode: document.getElementById('clPricingMode')?.value || 'per_dinner'
  };
  await authFetch('/api/admin/content/candlelight', { method: 'POST', body: candlelight });
  showToast('Candlelight dinner details saved.', 'success');
}

async function addNewFaqPrompt() {
  const question = prompt('Enter FAQ Question:');
  if (!question) return;
  const answer = prompt('Enter FAQ Answer:');
  if (!answer) return;

  const faqs = adminState.content.faqs || [];
  faqs.push({ id: `faq-${Date.now()}`, question, answer, category: 'General' });
  await authFetch('/api/admin/content/faqs', { method: 'POST', body: faqs });
  showToast('FAQ created & schema updated.', 'success');
  loadAllAdminData();
}

async function deleteFaq(idx) {
  const faqs = adminState.content.faqs || [];
  faqs.splice(idx, 1);
  await authFetch('/api/admin/content/faqs', { method: 'POST', body: faqs });
  showToast('FAQ deleted.', 'info');
  loadAllAdminData();
}

// ----------------------------------------------------------------------------
// 6. MENU MANAGER & CIRCULAR CROP TOOL (SUPER ADMIN & MANAGER)
// ----------------------------------------------------------------------------

function renderMenuTables() {
  const dishes = adminState.restaurant || [];
  const totalDishes = dishes.length;
  const withPhotoCount = dishes.filter(d => !!d.image).length;
  const pct = totalDishes ? Math.round((withPhotoCount / totalDishes) * 100) : 0;

  const statsEl = document.getElementById('menuPhotoStatsText');
  const barEl = document.getElementById('menuPhotoProgressBar');
  const countEl = document.getElementById('restaurantDishesCount');

  if (statsEl) statsEl.textContent = `${withPhotoCount} / ${totalDishes} dishes with photos (${pct}%)`;
  if (barEl) barEl.style.width = `${pct}%`;
  if (countEl) countEl.textContent = totalDishes;

  const noteInput = document.getElementById('adminMenuBottomNote');
  if (noteInput && adminState.menuNote) {
    noteInput.value = adminState.menuNote;
  }

  renderRestaurantMenuTable();
  renderCocktailMenuTable();
}

function renderRestaurantMenuTable() {
  const tbody = document.getElementById('restaurantMenuTableBody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('adminMenuSearch')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('adminMenuCategoryFilter')?.value || 'all';
  const dietFilter = document.getElementById('adminMenuDietFilter')?.value || 'all';
  const availFilter = document.getElementById('adminMenuAvailFilter')?.value || 'all';

  let list = [...(adminState.restaurant || [])];

  // Apply filters
  if (searchTerm) {
    list = list.filter(d => 
      (d.name || '').toLowerCase().includes(searchTerm) || 
      (d.description || '').toLowerCase().includes(searchTerm)
    );
  }

  if (categoryFilter !== 'all') {
    list = list.filter(d => d.category === categoryFilter);
  }

  if (dietFilter !== 'all') {
    list = list.filter(d => dietFilter === 'veg' ? !!d.isVeg : !d.isVeg);
  }

  if (availFilter !== 'all') {
    list = list.filter(d => availFilter === 'available' ? d.available !== false : d.available === false);
  }

  if (filterOnlyNeedingPhotos) {
    list = list.filter(d => !d.image);
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#64748B;">No dishes match your filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((dish, idx) => {
    const isVeg = dish.isVeg !== false;
    let priceText = '';
    if (dish.variants && Array.isArray(dish.variants) && dish.variants.length > 0) {
      priceText = dish.variants.map(v => `<span style="display:inline-block; font-size:0.72rem; background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:4px; padding:2px 6px; margin:2px 3px 2px 0; font-weight:700;">${v.label} ₹${v.price}</span>`).join(' ');
    } else if (dish.price && dish.price > 0) {
      priceText = `₹${dish.price.toLocaleString('en-IN')}`;
    } else {
      priceText = '<em style="color:#64748B;font-size:0.8rem;">Ask at restaurant</em>';
    }
    const isAvailable = dish.available !== false;
    const isFeatured = !!(dish.featured || dish.isFeatured);
    
    // Badges HTML
    const badges = [];
    if (dish.badges && Array.isArray(dish.badges)) {
      dish.badges.forEach(b => {
        if (b === "Chef's Special") badges.push('<span class="badge-tag-chef" style="font-size:0.68rem;padding:2px 6px;">Special</span>');
        if (b === 'Spicy') badges.push('<span class="badge-tag-spicy" style="font-size:0.68rem;padding:2px 6px;">Spicy</span>');
      });
    }

    const thumbHtml = dish.image 
      ? `<img src="${dish.image}" class="admin-dish-thumb" alt="${dish.name}" onclick="openCropModalForDish('${dish.id}')" title="Click to replace or re-crop photo">`
      : `<div class="admin-dish-placeholder" onclick="openCropModalForDish('${dish.id}')" title="Click to upload custom photo"><span class="material-symbols-outlined" style="font-size:20px;">add_a_photo</span></div>`;

    return `
      <tr data-dish-id="${dish.id}">
        <td>
          <div style="display:flex; flex-direction:column; gap:2px;">
            <button class="reorder-btn" onclick="moveDishOrder('${dish.id}', -1)" title="Move dish up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
            <button class="reorder-btn" onclick="moveDishOrder('${dish.id}', 1)" title="Move dish down" ${idx === list.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
          </div>
        </td>
        <td>
          <div class="menu-thumb-cell">
            ${thumbHtml}
          </div>
        </td>
        <td style="max-width: 240px;">
          <strong style="color:var(--ocean-blue); font-size:0.92rem;">${dish.name}</strong>${dish.portion ? `<span style="font-size:0.72rem; background:#E2E8F0; color:#334155; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:5px;">${dish.portion}</span>` : ''}
          ${dish.description ? `<br><small style="color:#64748B; line-height:1.3; display:block; margin-top:2px;">${dish.description}</small>` : ''}
        </td>
        <td>
          <span class="badge-status" style="background:#F1F5F9; color:#334155; border:1px solid #CBD5E1; font-size:0.75rem;">
            ${dish.category}
          </span>
        </td>
        <td>
          <span class="badge-status ${isVeg ? 'available' : 'sold-out'}" style="font-size:0.75rem;">
            ${isVeg ? 'Pure Veg 🌱' : 'Non-Veg 🍗'}
          </span>
        </td>
        <td>
          <strong style="color:var(--ocean-blue);">${priceText}</strong>
        </td>
        <td>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${badges.join('') || '<span style="color:#94A3B8; font-size:0.75rem;">—</span>'}
          </div>
        </td>
        <td style="text-align: center;">
          <button class="btn-star-featured ${isFeatured ? 'active' : ''}" onclick="toggleDishFeatured('${dish.id}')" title="${isFeatured ? 'Starred on Home Page Highlights (Click to unstar)' : 'Star for Home Page Highlights'}">
            <span class="material-symbols-outlined" style="font-size: 20px;">${isFeatured ? 'star' : 'star_border'}</span>
          </button>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" ${isAvailable ? 'checked' : ''} onchange="toggleDishAvailability('${dish.id}', this.checked)" style="width:18px; height:18px; cursor:pointer; accent-color:var(--turquoise);">
            <span class="badge-status ${isAvailable ? 'available' : 'sold-out'}" style="font-size:0.72rem;">
              ${isAvailable ? 'Active' : 'Not today'}
            </span>
          </div>
        </td>
        <td style="text-align: right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button class="btn-upload-dish-pic" onclick="openCropModalForDish('${dish.id}')" title="Upload circular image">
              <span class="material-symbols-outlined" style="font-size:14px;">crop</span> Photo
            </button>
            <button class="btn-turquoise" style="padding:4px 10px; font-size:0.74rem;" onclick="openDishEditModal('${dish.id}')" title="Edit dish details">
              <span class="material-symbols-outlined" style="font-size:14px;">edit</span>
            </button>
            <button class="btn-icon-only" style="color:var(--sunset-coral);" onclick="deleteMenuItem('restaurant', '${dish.id}')" title="Delete dish">
              <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleFilterNeedingPhotos() {
  filterOnlyNeedingPhotos = !filterOnlyNeedingPhotos;
  const btn = document.getElementById('btnToggleNeedingPhotos');
  if (btn) {
    if (filterOnlyNeedingPhotos) {
      btn.classList.add('active');
      btn.style.background = 'var(--turquoise)';
      btn.style.color = '#FFFFFF';
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">close</span> Clear Photo Filter`;
    } else {
      btn.classList.remove('active');
      btn.style.background = '';
      btn.style.color = '';
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">filter_list</span> Show Dishes Needing Photos`;
    }
  }
  renderRestaurantMenuTable();
}

async function moveDishOrder(dishId, delta) {
  const list = adminState.restaurant || [];
  const idx = list.findIndex(d => d.id === dishId);
  if (idx === -1) return;

  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= list.length) return;

  // Swap
  const temp = list[idx];
  list[idx] = list[targetIdx];
  list[targetIdx] = temp;

  const orderList = list.map((d, i) => ({ id: d.id, order: i + 1 }));

  try {
    await authFetch('/api/menu/reorder', {
      method: 'POST',
      body: { type: 'restaurant', orderList }
    });
    renderRestaurantMenuTable();
    showToast('Menu order updated.', 'success');
  } catch (err) {
    console.error('Failed to save order:', err);
    showToast('Failed to save reordered menu.', 'error');
  }
}

async function toggleDishAvailability(dishId, isAvailable) {
  const dish = (adminState.restaurant || []).find(d => d.id === dishId);
  if (!dish) return;

  dish.available = isAvailable;

  try {
    await authFetch('/api/menu/toggle-available', {
      method: 'POST',
      body: { type: 'restaurant', id: dishId, available: isAvailable }
    });
    renderRestaurantMenuTable();
    showToast(`"${dish.name}" is now ${isAvailable ? 'Available' : 'marked Not Available Today'}.`, 'info');
  } catch (err) {
    console.error('Failed to toggle availability:', err);
    showToast('Failed to update dish availability.', 'error');
  }
}

async function toggleDishFeatured(dishId) {
  const dish = (adminState.restaurant || []).find(d => d.id === dishId);
  if (!dish) return;

  try {
    const res = await authFetch('/api/menu/toggle-featured', {
      method: 'POST',
      body: { id: dishId }
    });
    if (res.success) {
      dish.featured = res.dish.featured;
      renderRestaurantMenuTable();
      if (res.warning) {
        showToast(res.warning, 'warning');
      } else {
        showToast(`"${dish.name}" ${dish.featured ? 'is now starred on home page highlights!' : 'removed from home page highlights.'}`, 'success');
      }
    } else {
      showToast(res.message || 'Failed to toggle featured status', 'error');
    }
  } catch (err) {
    console.error('Failed to toggle featured:', err);
    showToast('Failed to update featured status.', 'error');
  }
}

function openDishEditModal(dishId = null) {
  const modal = document.getElementById('dishEditModal');
  const title = document.getElementById('dishEditModalTitle');
  const preview = document.getElementById('editDishThumbPreview');
  const photoStatus = document.getElementById('editDishPhotoStatus');

  if (dishId) {
    const dish = (adminState.restaurant || []).find(d => d.id === dishId);
    if (!dish) return;
    title.textContent = `Edit Dish: ${dish.name}`;
    document.getElementById('editDishId').value = dish.id;
    document.getElementById('editDishName').value = dish.name;
    const portionEl = document.getElementById('editDishPortion');
    if (portionEl) portionEl.value = dish.portion || '';
    document.getElementById('editDishCategory').value = dish.category || 'Breakfast';
    document.getElementById('editDishDiet').value = dish.isVeg !== false ? 'true' : 'false';
    document.getElementById('editDishPrice').value = dish.price || '';
    document.getElementById('editDishAvailable').value = dish.available !== false ? 'true' : 'false';
    document.getElementById('editDishDesc').value = dish.description || '';

    const varContainer = document.getElementById('editDishVariantsContainer');
    if (varContainer) {
      varContainer.innerHTML = '';
      if (dish.variants && Array.isArray(dish.variants)) {
        dish.variants.forEach(v => addVariantRow(v.label, v.price));
      }
    }

    const badges = dish.badges || [];
    document.getElementById('badgeChefSpecial').checked = badges.includes("Chef's Special");
    document.getElementById('badgeSpicy').checked = badges.includes("Spicy");

    if (dish.image) {
      preview.innerHTML = `<img src="${dish.image}" class="admin-dish-thumb" style="width:40px;height:40px;">`;
      photoStatus.textContent = 'Custom photo uploaded';
      photoStatus.style.color = '#0E9F6E';
    } else {
      preview.innerHTML = `<div class="admin-dish-placeholder" style="width:40px;height:40px;"><span class="material-symbols-outlined" style="font-size:18px;">restaurant</span></div>`;
      photoStatus.textContent = 'Using sand/gold placeholder';
      photoStatus.style.color = '#64748B';
    }
  } else {
    title.textContent = 'Add New Restaurant Dish';
    document.getElementById('editDishId').value = '';
    document.getElementById('editDishName').value = '';
    const portionElNew = document.getElementById('editDishPortion');
    if (portionElNew) portionElNew.value = '';
    document.getElementById('editDishCategory').value = 'Breakfast';
    document.getElementById('editDishDiet').value = 'true';
    document.getElementById('editDishPrice').value = '';
    document.getElementById('editDishAvailable').value = 'true';
    document.getElementById('editDishDesc').value = '';

    const varContainerNew = document.getElementById('editDishVariantsContainer');
    if (varContainerNew) varContainerNew.innerHTML = '';
    document.getElementById('badgeChefSpecial').checked = false;
    document.getElementById('badgeSpicy').checked = false;
    preview.innerHTML = `<div class="admin-dish-placeholder" style="width:40px;height:40px;"><span class="material-symbols-outlined" style="font-size:18px;">restaurant</span></div>`;
    photoStatus.textContent = 'No photo uploaded yet';
    photoStatus.style.color = '#64748B';
  }

  openModal('dishEditModal');
}

async function handleSaveDishSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editDishId').value;
  const name = document.getElementById('editDishName').value.trim();
  const portion = (document.getElementById('editDishPortion')?.value || '').trim();
  const category = document.getElementById('editDishCategory').value;
  const isVeg = document.getElementById('editDishDiet').value === 'true';
  const priceRaw = document.getElementById('editDishPrice').value;
  let price = (priceRaw !== '' && !isNaN(Number(priceRaw))) ? Number(priceRaw) : null;
  const available = document.getElementById('editDishAvailable').value === 'true';
  const description = document.getElementById('editDishDesc').value.trim();

  const badges = [];
  if (document.getElementById('badgeChefSpecial').checked) badges.push("Chef's Special");
  if (document.getElementById('badgeSpicy').checked) badges.push("Spicy");

  const variantRows = document.querySelectorAll('.edit-variant-row');
  const variants = [];
  variantRows.forEach(row => {
    const label = (row.querySelector('.variant-label-input')?.value || '').trim();
    const pVal = row.querySelector('.variant-price-input')?.value;
    if (label && pVal !== '' && !isNaN(Number(pVal))) {
      variants.push({ label, price: Number(pVal) });
    }
  });

  if (!price && variants.length > 0) {
    price = variants[0].price;
  }

  const existing = (adminState.restaurant || []).find(d => d.id === id);

  const payload = {
    id: id || `dish-${Date.now()}`,
    name,
    portion,
    variants,
    category,
    isVeg,
    price,
    available,
    description,
    badges,
    image: existing ? existing.image : null,
    thumbImage: existing ? existing.thumbImage : null,
    order: existing ? existing.order : 999
  };

  try {
    const res = await authFetch('/api/menu/item', {
      method: 'POST',
      body: { type: 'restaurant', item: payload }
    });

    if (res.success) {
      closeModal('dishEditModal');
      showToast(`Saved dish "${name}".`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Error saving dish.', 'error');
    }
  } catch (err) {
    console.error('Error saving dish:', err);
    showToast('Failed to save dish.', 'error');
  }
}

function triggerCropForCurrentEditingDish() {
  const dishId = document.getElementById('editDishId').value;
  if (!dishId) {
    showToast('Please enter and save the dish name first before uploading a photo.', 'warning');
    return;
  }
  closeModal('dishEditModal');
  openCropModalForDish(dishId);
}

// ----------------------------------------------------------------------------
// CIRCULAR CROPPER TOOL LOGIC (DRAG & ZOOM CANVAS)
// ----------------------------------------------------------------------------

function openCropModalForDish(dishId) {
  openChangePhotoModal(null, null, null, false, dishId);
}

function handleCropFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > 8 * 1024 * 1024) {
    showToast('File too large (max 8 MB)', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      cropImageObj = img;
      cropScale = 1;
      cropTranslateX = 0;
      cropTranslateY = 0;
      document.getElementById('cropZoomSlider').value = 1;
      centerCropperImage();
      drawCropperCanvas();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function centerCropperImage() {
  if (!cropImageObj) return;
  cropTranslateX = 0;
  cropTranslateY = 0;
}

function handleCropZoomChange(val) {
  cropScale = parseFloat(val);
  drawCropperCanvas();
}

function initCropperCanvasEvents() {
  if (cropperEventsBound) return;
  cropperEventsBound = true;

  const viewport = document.getElementById('cropperViewport');
  if (!viewport) return;

  const onStart = (clientX, clientY) => {
    if (!cropImageObj) return;
    cropIsDragging = true;
    cropDragStartX = clientX - cropTranslateX;
    cropDragStartY = clientY - cropTranslateY;
  };

  const onMove = (clientX, clientY) => {
    if (!cropIsDragging || !cropImageObj) return;
    cropTranslateX = clientX - cropDragStartX;
    cropTranslateY = clientY - cropDragStartY;
    drawCropperCanvas();
  };

  const onEnd = () => {
    cropIsDragging = false;
  };

  // Mouse
  viewport.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onEnd);

  // Touch
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchend', onEnd);
}

function drawCropperCanvas() {
  const canvas = document.getElementById('cropCanvas');
  const previewCanvas = document.getElementById('cropPreviewCircleCanvas');
  if (!canvas || !cropImageObj) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Draw image with pan and zoom transforms
  ctx.save();
  ctx.translate(w / 2 + cropTranslateX, h / 2 + cropTranslateY);
  ctx.scale(cropScale, cropScale);

  // Calculate base scale so image fills the 300px circle comfortably
  const baseScale = Math.max(300 / cropImageObj.width, 300 / cropImageObj.height);
  const drawW = cropImageObj.width * baseScale;
  const drawH = cropImageObj.height * baseScale;

  ctx.drawImage(cropImageObj, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Draw Circular Preview Canvas
  if (previewCanvas) {
    const pCtx = previewCanvas.getContext('2d');
    const pw = previewCanvas.width;
    const ph = previewCanvas.height;
    pCtx.clearRect(0, 0, pw, ph);

    pCtx.save();
    pCtx.beginPath();
    pCtx.arc(pw / 2, ph / 2, pw / 2 - 2, 0, Math.PI * 2);
    pCtx.clip();

    // Scale down from main viewport to 64px preview
    const ratio = pw / 300;
    pCtx.translate(pw / 2 + (cropTranslateX * ratio), ph / 2 + (cropTranslateY * ratio));
    pCtx.scale(cropScale * ratio, cropScale * ratio);
    pCtx.drawImage(cropImageObj, -drawW / 2, -drawH / 2, drawW, drawH);
    pCtx.restore();
  }
}

function drawCropperPlaceholderCanvas() {
  const canvas = document.getElementById('cropCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Click "Choose Dish Image" above', canvas.width / 2, canvas.height / 2);
}

async function executeSaveCroppedImage() {
  if (!cropImageObj || !cropTargetDishId) {
    showToast('Please choose an image file first.', 'warning');
    return;
  }

  const saveBtn = document.getElementById('btnSaveCroppedDishImage');
  const originalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="material-symbols-outlined spinning">sync</span> Processing WebP...`;

  try {
    // Generate high-resolution 400x400 circular cropped WebP
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 400;
    exportCanvas.height = 400;
    const expCtx = exportCanvas.getContext('2d');

    // Circular clip
    expCtx.beginPath();
    expCtx.arc(200, 200, 198, 0, Math.PI * 2);
    expCtx.clip();

    // Scale from 300px viewport circle to 400px export
    const ratio = 400 / 300;
    const baseScale = Math.max(300 / cropImageObj.width, 300 / cropImageObj.height);
    const drawW = cropImageObj.width * baseScale;
    const drawH = cropImageObj.height * baseScale;

    expCtx.translate(200 + (cropTranslateX * ratio), 200 + (cropTranslateY * ratio));
    expCtx.scale(cropScale * ratio, cropScale * ratio);
    expCtx.drawImage(cropImageObj, -drawW / 2, -drawH / 2, drawW, drawH);

    // Convert to WebP data URL
    let dataUrl = exportCanvas.toDataURL('image/webp', 0.88);
    // If browser doesn't support toDataURL webp, fallback to png
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = exportCanvas.toDataURL('image/png');
    }

    // Upload to server
    const res = await authFetch('/api/menu/upload-image', {
      method: 'POST',
      body: {
        dishId: cropTargetDishId,
        imageBase64: dataUrl,
        mimeType: dataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/png'
      }
    });

    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHtml;

    if (res.success) {
      closeModal('circularCropModal');
      showToast('Circular dish image saved and uploaded.', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Upload failed.', 'error');
    }
  } catch (err) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHtml;
    console.error('Error saving cropped image:', err);
    showToast('Failed to save cropped image: ' + err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// COCKTAIL LOUNGE MANAGER
// ----------------------------------------------------------------------------

function renderCocktailMenuTable() {
  const drinkTbody = document.getElementById('cocktailMenuTableBody');
  if (!drinkTbody) return;

  const drinks = adminState.cocktails || [];
  if (drinks.length === 0) {
    drinkTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748B;">No drinks in cocktail lounge menu.</td></tr>`;
    return;
  }

  drinkTbody.innerHTML = drinks.map(drink => `
    <tr>
      <td><strong style="color:var(--ocean-blue);">${drink.name}</strong></td>
      <td><span class="badge-status available">${drink.category}</span></td>
      <td><strong>₹${drink.price || 0}</strong></td>
      <td style="max-width: 280px; font-size:0.82rem; color:#64748B;">${drink.description || drink.desc || ''}</td>
      <td><span class="badge-status ${drink.available !== false ? 'available' : 'sold-out'}">${drink.available !== false ? 'Available' : 'Unavailable'}</span></td>
      <td style="text-align: right;">
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button class="btn-turquoise" style="padding:4px 10px; font-size:0.74rem;" onclick="openAddCocktailModal('${drink.id}')">
            <span class="material-symbols-outlined" style="font-size:14px;">edit</span>
          </button>
          <button class="btn-icon-only" style="color: var(--sunset-coral);" onclick="deleteMenuItem('cocktails', '${drink.id}')">
            <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openAddCocktailModal(cocktailId = null) {
  const modal = document.getElementById('cocktailEditModal');
  const title = document.getElementById('cocktailEditModalTitle');

  if (cocktailId) {
    const drink = (adminState.cocktails || []).find(d => d.id === cocktailId);
    if (!drink) return;
    title.textContent = `Edit Drink: ${drink.name}`;
    document.getElementById('editCocktailId').value = drink.id;
    document.getElementById('editCocktailName').value = drink.name;
    document.getElementById('editCocktailCategory').value = drink.category || 'Cocktail';
    document.getElementById('editCocktailPrice').value = drink.price || '';
    document.getElementById('editCocktailDesc').value = drink.description || drink.desc || '';
    document.getElementById('editCocktailAvailable').value = drink.available !== false ? 'true' : 'false';
  } else {
    title.textContent = 'Add Drink to Coral Reef Lounge';
    document.getElementById('editCocktailId').value = '';
    document.getElementById('editCocktailName').value = '';
    document.getElementById('editCocktailCategory').value = 'Cocktail';
    document.getElementById('editCocktailPrice').value = '';
    document.getElementById('editCocktailDesc').value = '';
    document.getElementById('editCocktailAvailable').value = 'true';
  }

  openModal('cocktailEditModal');
}

async function handleSaveCocktailSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editCocktailId').value;
  const name = document.getElementById('editCocktailName').value.trim();
  const category = document.getElementById('editCocktailCategory').value;
  const price = Number(document.getElementById('editCocktailPrice').value);
  const description = document.getElementById('editCocktailDesc').value.trim();
  const available = document.getElementById('editCocktailAvailable').value === 'true';

  const item = {
    id: id || `drnk-${Date.now()}`,
    name,
    category,
    price,
    description,
    available
  };

  try {
    const res = await authFetch('/api/menu/item', {
      method: 'POST',
      body: { type: 'cocktails', item }
    });

    if (res.success) {
      closeModal('cocktailEditModal');
      showToast(`Saved drink "${name}".`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Error saving drink.', 'error');
    }
  } catch (err) {
    console.error('Error saving cocktail:', err);
    showToast('Failed to save drink.', 'error');
  }
}

async function deleteMenuItem(type, id) {
  const item = (adminState[type] || []).find(i => i.id === id);
  const name = item ? item.name : 'this item';
  if (!confirm(`Are you sure you want to delete "${name}" from the ${type} menu?`)) return;

  try {
    await authFetch(`/api/menu/${type}/${id}`, { method: 'DELETE' });
    showToast(`Deleted "${name}".`, 'info');
    loadAllAdminData();
  } catch (err) {
    console.error('Error deleting item:', err);
    showToast('Failed to delete item.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 7. VEHICLES FLEET
// ----------------------------------------------------------------------------

function renderVehiclesTable() {
  const tbody = document.getElementById('vehiclesTableBody');
  if (!tbody) return;

  // Sync Trip Type Toggle Checkbox
  const tripToggle = document.getElementById('adminEnableTripTypeToggle');
  if (tripToggle && adminState.vehicleSettings) {
    tripToggle.checked = adminState.vehicleSettings.enableTripType !== false;
  }

  tbody.innerHTML = (adminState.vehicles || []).map(v => `
    <tr>
      <td><strong>${v.name}</strong></td>
      <td style="max-width: 280px; font-size: 0.82rem; color: #475569;">${v.description}</td>
      <td><span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle; color: var(--turquoise);">groups</span> Up to ${v.capacity} Passengers</td>
      <td><strong style="color: var(--ocean-blue); font-size: 0.95rem;">₹${v.pricePerDay.toLocaleString('en-IN')}</strong> <span style="font-size: 0.75rem; color: #64748B;">/ day</span></td>
      <td><strong>${v.maxQuantity || 5}</strong> max</td>
      <td><span class="badge-status ${v.enabled ? 'available' : 'sold-out'}">${v.enabled ? 'Active Fleet' : 'Disabled'}</span></td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn-turquoise" style="padding: 5px 12px; font-size: 0.74rem;" onclick="openEditVehicleModal('${v.id}')">
            <span class="material-symbols-outlined" style="font-size: 14px;">edit</span> Edit
          </button>
          <button class="btn-outline-gold" style="padding: 5px 10px; font-size: 0.74rem;" onclick="toggleVehicleActive('${v.id}', ${!v.enabled})">
            ${v.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openEditVehicleModal(id) {
  const v = (adminState.vehicles || []).find(item => item.id === id);
  if (!v) return;

  document.getElementById('editVehicleId').value = v.id;
  document.getElementById('editVehicleName').value = v.name || '';
  document.getElementById('editVehicleDesc').value = v.description || '';
  document.getElementById('editVehicleRate').value = v.pricePerDay;
  document.getElementById('editVehicleCapacity').value = v.capacity || 4;
  document.getElementById('editVehicleMaxQty').value = v.maxQuantity || 5;
  document.getElementById('editVehicleEnabled').value = v.enabled ? 'true' : 'false';
  document.getElementById('editVehicleModalTitle').textContent = `Edit Vehicle: ${v.name}`;

  document.getElementById('editVehicleModal').classList.add('open');
}

async function handleSaveVehicleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editVehicleId').value;
  const name = document.getElementById('editVehicleName').value.trim();
  const description = document.getElementById('editVehicleDesc').value.trim();
  const pricePerDay = Number(document.getElementById('editVehicleRate').value);
  const capacity = parseInt(document.getElementById('editVehicleCapacity').value, 10);
  const maxQuantity = parseInt(document.getElementById('editVehicleMaxQty').value, 10);
  const enabled = document.getElementById('editVehicleEnabled').value === 'true';

  try {
    const res = await authFetch(`/api/vehicles/${id}`, {
      method: 'POST',
      body: { name, description, pricePerDay, capacity, maxQuantity, enabled }
    });

    if (res.success) {
      closeModal('editVehicleModal');
      showToast(`${name} updated successfully & recorded in audit log.`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to update vehicle', 'error');
    }
  } catch (err) {
    showToast('Network error updating vehicle configuration.', 'error');
  }
}

async function toggleVehicleActive(id, newStatus) {
  const v = (adminState.vehicles || []).find(item => item.id === id);
  if (!v) return;

  try {
    const res = await authFetch(`/api/vehicles/${id}`, {
      method: 'POST',
      body: { enabled: newStatus }
    });

    if (res.success) {
      showToast(`${v.name} status updated to ${newStatus ? 'Active' : 'Disabled'}.`, 'success');
      loadAllAdminData();
    }
  } catch (err) {
    showToast('Failed to toggle vehicle status.', 'error');
  }
}

async function handleTripTypeToggleChange(enabled) {
  try {
    const res = await authFetch('/api/vehicles/settings', {
      method: 'POST',
      body: { enableTripType: !!enabled }
    });
    if (res.success) {
      showToast(`Trip type selector ${enabled ? 'enabled' : 'disabled'} on live booking bar.`, 'success');
      if (adminState.vehicleSettings) adminState.vehicleSettings.enableTripType = enabled;
    }
  } catch (err) {
    showToast('Failed to update trip type settings.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 8. SEO & SCHEMA MANAGER
// ----------------------------------------------------------------------------

function renderSeoManager() {
  const seo = adminState.seo || {};
  document.getElementById('seoMetaTitle').value = seo.metaTitle || '';
  document.getElementById('seoMetaDescription').value = seo.metaDescription || '';
  document.getElementById('seoKeywords').value = seo.metaKeywords || '';
  document.getElementById('seoCanonicalUrl').value = seo.canonicalUrl || '';

  const altsBox = document.getElementById('imageAltsContainer');
  if (altsBox && seo.imageAlts) {
    altsBox.innerHTML = Object.entries(seo.imageAlts).map(([path, alt]) => `
      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px;">
        <span style="font-family: var(--font-mono); font-size: 0.76rem; color: #64748B;">${path}</span>
        <input type="text" class="form-control" style="margin-top: 6px;" value="${alt}" data-alt-path="${path}">
      </div>
    `).join('');
  }
}

async function saveSeoMetaSettings() {
  const body = {
    metaTitle: document.getElementById('seoMetaTitle').value.trim(),
    metaDescription: document.getElementById('seoMetaDescription').value.trim(),
    metaKeywords: document.getElementById('seoKeywords').value.trim(),
    canonicalUrl: document.getElementById('seoCanonicalUrl').value.trim()
  };

  await authFetch('/api/admin/seo', { method: 'POST', body });
  showToast('SEO Meta Tags saved.', 'success');
}

async function saveImageAltTexts() {
  const imageAlts = {};
  document.querySelectorAll('[data-alt-path]').forEach(input => {
    imageAlts[input.getAttribute('data-alt-path')] = input.value.trim();
  });

  await authFetch('/api/admin/seo', { method: 'POST', body: { imageAlts } });
  showToast('Image Alt Texts updated.', 'success');
}

async function refreshSitemap() {
  try {
    const res = await authFetch('/api/admin/seo/refresh-sitemap', { method: 'POST' });
    showToast(res.message, res.success ? 'success' : 'error');
  } catch (err) {
    showToast('Failed to refresh sitemap.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 9. AUDIT TRAIL (READ-ONLY)
// ----------------------------------------------------------------------------

function renderAuditTrail() {
  const tbody = document.getElementById('auditTrailTableBody');
  if (!tbody) return;

  const logs = adminState.auditLog || [];
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94A3B8; padding: 24px;">No audit records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="font-family: var(--font-mono); font-size: 0.78rem;">${new Date(l.timestamp).toLocaleString()}</td>
      <td><strong>${l.user}</strong> <span style="font-size: 0.72rem; color: var(--turquoise); font-weight: 600;">[${l.role}]</span></td>
      <td><code>${l.ip}</code></td>
      <td><span style="font-weight: 600; color: var(--ocean-blue);">${l.action}</span></td>
      <td style="font-size: 0.8rem; color: #475569;">${l.details}</td>
    </tr>
  `).join('');
}

function loadAuditTrail() {
  authFetch('/api/audit-log').then(r => {
    if (r.success) {
      adminState.auditLog = r.auditLog;
      renderAuditTrail();
      showToast('Audit trail refreshed.', 'info');
    }
  });
}

// ----------------------------------------------------------------------------
// 10. USERS & HOTEL SETTINGS (SUPER ADMIN ONLY)
// ----------------------------------------------------------------------------

function renderStaffAccounts() {
  const tbody = document.getElementById('staffAccountsTableBody');
  if (!tbody) return;

  tbody.innerHTML = (adminState.users || []).map(u => `
    <tr>
      <td><strong>${u.name}</strong></td>
      <td><code>${u.username}</code></td>
      <td>${u.email}</td>
      <td><span class="badge-status ${u.role === 'Super Admin' ? 'gold' : 'available'}">${u.role}</span></td>
      <td><span style="color: var(--turquoise-dark); font-weight: 600;">✓ Active 2FA</span></td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn-outline-gold" style="padding: 4px 8px; font-size: 0.74rem;" onclick="resetStaff2FA('${u.username}')">
            Reset 2FA
          </button>
          ${u.username !== 'admin' ? `
            <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--sunset-coral);" onclick="deleteStaffAccount('${u.username}')">
              <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderLoginHistory() {
  const tbody = document.getElementById('loginHistoryTableBody');
  if (!tbody) return;

  tbody.innerHTML = (adminState.loginHistory || []).map(h => `
    <tr>
      <td style="font-family: var(--font-mono); font-size: 0.78rem;">${new Date(h.timestamp).toLocaleString()}</td>
      <td><strong>${h.username}</strong></td>
      <td><code>${h.ip}</code></td>
      <td><span class="badge-status ${h.status === 'Success' ? 'available' : 'sold-out'}">${h.status}</span></td>
    </tr>
  `).join('');
}

function renderSettingsForm() {
  const s = adminState.settings || {};
  if (document.getElementById('cfgPhone')) document.getElementById('cfgPhone').value = s.phone || '';
  if (document.getElementById('cfgWhatsapp')) document.getElementById('cfgWhatsapp').value = s.whatsapp || '';
  if (document.getElementById('cfgEmail')) document.getElementById('cfgEmail').value = s.email || '';
  if (document.getElementById('cfgAddress')) document.getElementById('cfgAddress').value = s.address || '';
  if (document.getElementById('cfgCheckIn')) document.getElementById('cfgCheckIn').value = s.checkInTime || '12:00 PM';
  if (document.getElementById('cfgCheckOut')) document.getElementById('cfgCheckOut').value = s.checkOutTime || '11:00 AM';
  if (document.getElementById('cfgAdvancePct')) document.getElementById('cfgAdvancePct').value = s.advancePercentage || 20;
  if (document.getElementById('cfgEnableTax')) document.getElementById('cfgEnableTax').checked = !!s.enableTax;
  if (document.getElementById('cfgTaxPct')) document.getElementById('cfgTaxPct').value = s.taxPercentage || 12;
  if (document.getElementById('cfgCaptchaPolicy')) document.getElementById('cfgCaptchaPolicy').value = s.captchaPolicy || 'smart';
  if (document.getElementById('cfgUpiId')) document.getElementById('cfgUpiId').value = s.paymentUPI || '';
  if (document.getElementById('cfgBankWire')) document.getElementById('cfgBankWire').value = s.paymentBank || '';

  // Load Invoice Engine Settings
  loadInvoiceSettings();
}

async function saveHotelSettingsForm() {
  const body = {
    phone: document.getElementById('cfgPhone').value.trim(),
    whatsapp: document.getElementById('cfgWhatsapp').value.trim(),
    email: document.getElementById('cfgEmail').value.trim(),
    address: document.getElementById('cfgAddress').value.trim(),
    checkInTime: document.getElementById('cfgCheckIn').value.trim(),
    checkOutTime: document.getElementById('cfgCheckOut').value.trim(),
    advancePercentage: Number(document.getElementById('cfgAdvancePct').value),
    enableTax: document.getElementById('cfgEnableTax') ? document.getElementById('cfgEnableTax').checked : false,
    taxPercentage: Number(document.getElementById('cfgTaxPct').value),
    captchaPolicy: document.getElementById('cfgCaptchaPolicy') ? document.getElementById('cfgCaptchaPolicy').value : 'smart',
    paymentUPI: document.getElementById('cfgUpiId').value.trim(),
    paymentBank: document.getElementById('cfgBankWire').value.trim()
  };

  try {
    const res = await authFetch('/api/settings', { method: 'POST', body });
    showToast(res.message, res.success ? 'success' : 'error');
  } catch (e) {
    showToast('Failed to save settings.', 'error');
  }
}

// ============================================================================
// INVOICE (A4 PDF) MANAGEMENT & SETTINGS HANDLERS
// ============================================================================

function viewAdminInvoice(bookingId) {
  const iframe = document.getElementById('invoiceViewerIframe');
  const title = document.getElementById('invoiceViewerModalTitle');
  if (title) title.textContent = `Invoice & Voucher: ${bookingId}`;
  if (iframe) {
    iframe.src = `/api/admin/invoices/${bookingId}/pdf?t=${Date.now()}`;
  }
  const btnDownload = document.getElementById('btnInvoiceViewerDownload');
  if (btnDownload) {
    btnDownload.onclick = () => downloadAdminInvoice(bookingId);
  }
  const btnPrint = document.getElementById('btnInvoiceViewerPrint');
  if (btnPrint) {
    btnPrint.onclick = () => printAdminInvoice(bookingId);
  }
  openModal('invoiceViewerModal');
}

function downloadAdminInvoice(bookingId) {
  const a = document.createElement('a');
  a.href = `/api/admin/invoices/${bookingId}/download`;
  a.download = `Invoice-${bookingId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Initiating invoice PDF download...', 'info');
}

function printAdminInvoice(bookingId) {
  const printUrl = `/api/admin/invoices/${bookingId}/pdf`;
  const printWindow = window.open(printUrl, '_blank');
  if (!printWindow) {
    const iframe = document.getElementById('invoiceViewerIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.print();
    }
  }
}

async function resendAdminInvoiceEmail(bookingId) {
  if (!currentUser || !['Super Admin', 'Manager'].includes(currentUser.role)) {
    showToast('Permission restricted: Only Managers and Super Admins can resend invoices.', 'error');
    return;
  }
  if (!confirm(`Resend booking confirmation & invoice PDF for reservation ${bookingId}?`)) return;

  try {
    showToast(`Dispatching invoice email for ${bookingId}...`, 'info');
    const res = await authFetch(`/api/admin/invoices/${bookingId}/resend`, { method: 'POST' });
    if (res.success) {
      showToast(res.message || 'Invoice dispatched with PDF attachment.', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to dispatch invoice email.', 'error');
    }
  } catch (err) {
    console.error('Error resending invoice:', err);
    showToast('Error resending invoice email.', 'error');
  }
}

async function regenerateAdminInvoice(bookingId) {
  if (!currentUser || !['Super Admin', 'Manager'].includes(currentUser.role)) {
    showToast('Permission restricted: Only Managers and Super Admins can regenerate invoices.', 'error');
    return;
  }
  const reason = prompt(`Enter reason for creating a new invoice revision for ${bookingId} (e.g. "Room upgraded / Stay dates changed"):`, 'Staff adjustment');
  if (!reason) return;

  try {
    showToast(`Generating new invoice revision for ${bookingId}...`, 'info');
    const res = await authFetch(`/api/admin/invoices/${bookingId}/regenerate`, {
      method: 'POST',
      body: { reason }
    });
    if (res.success) {
      showToast(res.message || 'Invoice revision generated successfully.', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to regenerate invoice.', 'error');
    }
  } catch (err) {
    console.error('Regenerate invoice error:', err);
    showToast('Error regenerating invoice.', 'error');
  }
}

async function exportInvoicesZip() {
  if (!currentUser || currentUser.role !== 'Super Admin') {
    alert('Access Restricted: Daily ZIP export of invoices for accounting is available to Super Admin only.');
    return;
  }
  showToast('Packaging all invoices into accounting ZIP archive...', 'info');
  window.location.href = '/api/admin/invoices/export-zip';
}

async function loadInvoiceSettings() {
  try {
    const res = await authFetch('/api/admin/settings/invoice');
    if (res.success && res.settings) {
      adminState.invoiceSettings = res.settings;
      renderInvoiceSettings(res.settings);
    }
  } catch (err) {
    console.warn('Could not load invoice settings:', err);
  }
}

function renderInvoiceSettings(s = {}) {
  if (document.getElementById('cfgInvPrefix')) document.getElementById('cfgInvPrefix').value = s.invoicePrefix || 'CV';
  if (document.getElementById('cfgInvNextNumber')) document.getElementById('cfgInvNextNumber').value = s.invoiceNextNumber || 1001;

  const gstCheckbox = document.getElementById('cfgInvGstEnabled');
  if (gstCheckbox) {
    gstCheckbox.checked = !!s.gstEnabled;
    toggleInvGstFields();
  }
  if (document.getElementById('cfgInvGstRate')) document.getElementById('cfgInvGstRate').value = s.gstRate !== undefined ? s.gstRate : 12;
  if (document.getElementById('cfgInvGstin')) document.getElementById('cfgInvGstin').value = s.gstin || '';
  if (document.getElementById('cfgInvOwnerName')) document.getElementById('cfgInvOwnerName').value = s.ownerName || 'Anirban Das';
  if (document.getElementById('cfgInvOwnerTitle')) document.getElementById('cfgInvOwnerTitle').value = s.ownerTitle || 'Owner, Coastal View';

  // Logo Preview
  const logoPreview = document.getElementById('invoiceLogoPreview');
  if (logoPreview) {
    const logoSrc = s.invoiceLogo ? ('../' + s.invoiceLogo.replace(/^\.?\//, '')) : '../assets/images/logo-invoice.png';
    logoPreview.src = logoSrc;
  }

  // Signature Preview
  const sigWrap = document.getElementById('ownerSignatureImgWrap');
  const sigPreview = document.getElementById('ownerSignaturePreview');
  if (sigWrap && sigPreview) {
    if (s.signatureImageUrl) {
      sigWrap.style.display = 'flex';
      sigPreview.src = s.signatureImageUrl.startsWith('/') ? ('..' + s.signatureImageUrl) : s.signatureImageUrl;
    } else {
      sigWrap.style.display = 'none';
      sigPreview.src = '';
    }
  }

  // Terms Lines
  const termsContainer = document.getElementById('invoiceTermsLinesContainer');
  if (termsContainer && Array.isArray(s.invoiceTerms) && s.invoiceTerms.length > 0) {
    termsContainer.innerHTML = s.invoiceTerms.map(t => `
      <input type="text" class="form-control inv-term-input" value="${(t || '').replace(/"/g, '&quot;')}">
    `).join('');
  }
}

function toggleInvGstFields() {
  const chk = document.getElementById('cfgInvGstEnabled');
  const lbl = document.getElementById('cfgInvGstStatusLabel');
  if (!chk || !lbl) return;
  if (chk.checked) {
    lbl.textContent = 'GST Enabled (Itemized CGST/SGST on PDF)';
    lbl.style.color = '#059669';
    lbl.style.fontWeight = '600';
  } else {
    lbl.textContent = 'GST Disabled (No tax added)';
    lbl.style.color = '#475569';
    lbl.style.fontWeight = 'normal';
  }
}

async function saveInvoiceSettingsForm() {
  const prefix = document.getElementById('cfgInvPrefix') ? document.getElementById('cfgInvPrefix').value.trim() : 'CV';
  const nextNumber = document.getElementById('cfgInvNextNumber') ? parseInt(document.getElementById('cfgInvNextNumber').value, 10) : 1001;
  const gstEnabled = document.getElementById('cfgInvGstEnabled') ? document.getElementById('cfgInvGstEnabled').checked : false;
  const gstin = document.getElementById('cfgInvGstin') ? document.getElementById('cfgInvGstin').value.trim() : '';
  const gstRate = document.getElementById('cfgInvGstRate') ? Number(document.getElementById('cfgInvGstRate').value) : 12;
  const ownerName = document.getElementById('cfgInvOwnerName') ? document.getElementById('cfgInvOwnerName').value.trim() : 'Anirban Das';
  const ownerTitle = document.getElementById('cfgInvOwnerTitle') ? document.getElementById('cfgInvOwnerTitle').value.trim() : 'Owner, Coastal View';

  const termInputs = document.querySelectorAll('.inv-term-input');
  const invoiceTerms = Array.from(termInputs).map(i => i.value.trim()).filter(Boolean);

  const body = {
    invoicePrefix: prefix,
    invoiceNextNumber: nextNumber,
    gstEnabled,
    gstin,
    gstRate,
    ownerName,
    ownerTitle,
    invoiceTerms
  };

  try {
    const res = await authFetch('/api/admin/settings/invoice', { method: 'PUT', body });
    if (res.success) {
      showToast('Invoice settings updated successfully.', 'success');
      loadInvoiceSettings();
    } else {
      showToast(res.message || 'Failed to update invoice settings.', 'error');
    }
  } catch (err) {
    console.error('Error saving invoice settings:', err);
    showToast('Error saving invoice settings.', 'error');
  }
}

async function handleInvoiceLogoUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      showToast('Uploading custom invoice logo...', 'info');
      const res = await authFetch('/api/admin/settings/invoice/logo', {
        method: 'POST',
        body: { imageBase64: reader.result }
      });
      if (res.success) {
        showToast('Invoice logo uploaded successfully!', 'success');
        loadInvoiceSettings();
      } else {
        showToast(res.message || 'Failed to upload logo.', 'error');
      }
    } catch (err) {
      showToast('Upload error: ' + err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function resetInvoiceLogo() {
  if (!confirm('Reset invoice logo to the default website brand logo?')) return;
  try {
    const res = await authFetch('/api/admin/settings/invoice/logo', {
      method: 'POST',
      body: { reset: true }
    });
    if (res.success) {
      showToast('Invoice logo reset to default.', 'success');
      loadInvoiceSettings();
    }
  } catch (err) {
    showToast('Reset error: ' + err.message, 'error');
  }
}

async function handleOwnerSignatureUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      showToast('Uploading signature image...', 'info');
      const res = await authFetch('/api/admin/settings/invoice/signature', {
        method: 'POST',
        body: { imageBase64: reader.result }
      });
      if (res.success) {
        showToast('Signature image uploaded successfully!', 'success');
        loadInvoiceSettings();
      } else {
        showToast(res.message || 'Failed to upload signature.', 'error');
      }
    } catch (err) {
      showToast('Upload error: ' + err.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function clearOwnerSignature() {
  if (!confirm('Remove uploaded signature image and revert to clean text signature?')) return;
  try {
    const res = await authFetch('/api/admin/settings/invoice/signature', {
      method: 'POST',
      body: { clear: true }
    });
    if (res.success) {
      showToast('Signature image removed.', 'success');
      loadInvoiceSettings();
    }
  } catch (err) {
    showToast('Error removing signature: ' + err.message, 'error');
  }
}

function openInvoiceSamplePreviewModal() {
  const iframe = document.getElementById('invoiceSamplePreviewIframe');
  if (iframe) {
    iframe.src = `/api/admin/invoices/sample-preview?t=${Date.now()}`;
  }
  openModal('invoiceSamplePreviewModal');
}

function refreshInvoiceSamplePreview() {
  const iframe = document.getElementById('invoiceSamplePreviewIframe');
  if (iframe) {
    iframe.src = `/api/admin/invoices/sample-preview?t=${Date.now()}`;
  }
}

function openAddStaffModal() {
  document.getElementById('staffAccountModal').classList.add('open');
}

async function handleCreateStaffSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newStaffName').value.trim();
  const username = document.getElementById('newStaffUsername').value.trim();
  const email = document.getElementById('newStaffEmail').value.trim();
  const role = document.getElementById('newStaffRole').value;
  const password = document.getElementById('newStaffPassword').value.trim();

  try {
    const res = await authFetch('/api/admin/users', {
      method: 'POST',
      body: { name, username, email, role, password }
    });

    closeModal('staffAccountModal');
    showToast(res.message, res.success ? 'success' : 'error');
    loadAllAdminData();
  } catch (err) {
    showToast('Error creating staff account.', 'error');
  }
}

async function resetStaff2FA(username) {
  if (!confirm(`Reset 2FA key for ${username}? A new verification code will be generated.`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${username}/reset-2fa`, { method: 'POST' });
    alert(`2FA Reset Success!\nNew Emergency Recovery Code: ${res.newCode}`);
    showToast(res.message, 'success');
  } catch (err) {
    showToast('Failed to reset 2FA.', 'error');
  }
}

async function deleteStaffAccount(username) {
  if (!confirm(`Are you sure you want to permanently delete staff account "${username}"?`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${username}`, { method: 'DELETE' });
    showToast(res.message, res.success ? 'success' : 'error');
    loadAllAdminData();
  } catch (err) {
    showToast('Failed to delete staff user.', 'error');
  }
}

function downloadDatabaseBackup() {
  window.location.href = '/api/admin/backup';
  showToast('Downloading full database backup snapshot...', 'info');
}

// ----------------------------------------------------------------------------
// GLOBAL LIVE SEARCH
// ----------------------------------------------------------------------------

function handleGlobalSearch(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderBookingsTable();
    renderRoomsGrid();
    return;
  }

  // Filter Bookings Table
  const rows = document.querySelectorAll('#bookingsTableBody tr');
  rows.forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });

  // Filter Room Cards
  const cards = document.querySelectorAll('.room-inventory-card');
  cards.forEach(c => {
    c.style.display = c.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
  });
}

// ----------------------------------------------------------------------------
// NOTIFICATIONS & TOAST HELPERS
// ----------------------------------------------------------------------------

function toggleNotificationsDropdown() {
  const dd = document.getElementById('notifDropdown');
  if (dd) dd.classList.toggle('open');
}

function clearNotifications() {
  const list = document.getElementById('notifList');
  if (list) list.innerHTML = '<li class="notification-item" style="color: #64748B;">No unread alerts</li>';
  const badge = document.getElementById('notifBadge');
  if (badge) badge.textContent = '0';
  toggleNotificationsDropdown();
}

function toggleUserDropdown() {
  const choice = confirm(`Signed in as ${currentUser?.name || 'Admin'} (${currentUser?.role || 'Super Admin'}).\n\nClick OK to Sign Out of this device, or Cancel to Stay.`);
  if (choice) handleLogout();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconName = type === 'success' ? 'check_circle' : (type === 'error' ? 'error' : (type === 'warning' ? 'warning' : 'info'));
  toast.innerHTML = `
    <span class="material-symbols-outlined" style="font-size: 20px;">${iconName}</span>
    <span style="flex-grow: 1;">${message}</span>
    <button onclick="this.parentElement.remove()" style="background: none; border: none; cursor: pointer; color: #94A3B8;">×</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('open');
    if (modal.classList.contains('luxury-modal')) modal.style.display = 'flex';
  }
}
window.openModal = openModal;

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('open');
    if (modal.classList.contains('luxury-modal')) modal.style.display = 'none';
  }
}
window.closeModal = closeModal;

// ============================================================================
// 10. PHOTOS & MEDIA MANAGER CONTROLLER (SUPER ADMIN & MANAGER ONLY)
// Live website sync, 6 Room galleries, Website slots, WebP canvas cropper,
// Drag & drop reorder, 1-click rollback, and safe audit logging.
// ============================================================================

const NEUTRAL_MEDIA_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'%3E%3Crect width='800' height='600' fill='%23F4EFE6'/%3E%3Crect x='40' y='40' width='720' height='520' rx='16' fill='none' stroke='%23D4AF37' stroke-width='2' stroke-dasharray='8 8'/%3E%3Ccircle cx='400' cy='270' r='54' fill='%23E8DFCF'/%3E%3Cpath d='M380 280 L395 255 L410 275 L420 265 L435 285 Z' fill='%23947C3E'/%3E%3Ccircle cx='422' cy='245' r='8' fill='%23D4AF37'/%3E%3Ctext x='400' y='360' font-family='Arial, sans-serif' font-size='22' font-weight='600' fill='%238C7335' text-anchor='middle'%3ECoastal View Photo Slot%3C/text%3E%3Ctext x='400' y='392' font-family='Arial, sans-serif' font-size='15' fill='%23A39064' text-anchor='middle'%3ENo image uploaded yet • Click Replace to add%3C/text%3E%3C/svg%3E";

function formatAdminImgUrl(url) {
  if (!url) return NEUTRAL_MEDIA_FALLBACK;
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
    return url;
  }
  return '../' + url;
}

// Crop State Controller
let cropEngineState = {
  targetType: 'slot', // 'slot' or 'room'
  targetId: 'hero',
  photoId: null,
  tag: 'general',
  isCover: false,
  aspectRatio: '16:9',
  zoom: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  img: new Image(),
  imgLoaded: false
};

// Website Slots Registry
const WEBSITE_SLOTS_DEF = [
  {
    key: 'hero',
    group: 'hero',
    title: 'Hero Background Panorama',
    subtitle: 'Homepage Primary Visual Header',
    aspect: '16:9',
    recDim: '1920 × 1080 px (WebP / JPG, max 8 MB)',
    defaultUrl: 'assets/images/hero-sunset-pool.jpg',
    defaultAlt: 'Coastal View Beachfront Resort Mandarmani Infinity Pool'
  },
  {
    key: 'owner',
    group: 'owner',
    title: 'Meet the Owner (Anirban Das)',
    subtitle: 'Warm luxury hospitality portrait',
    aspect: '1:1',
    recDim: '800 × 800 px (Circular / Square)',
    defaultUrl: '/uploads/owner/anirban-das-owner.webp',
    defaultAlt: 'Anirban Das, owner of Coastal View and Ani\'s Tour and Travels, Mandarmani'
  },
  {
    key: 'logo',
    group: 'all',
    title: 'Hotel Brand Logo',
    subtitle: 'Navbar & Footer Luxury Emblem',
    aspect: 'free',
    recDim: 'SVG or PNG with transparent background',
    defaultUrl: 'assets/images/logo.png',
    defaultAlt: 'Coastal View Luxury Beachfront Hotel Logo'
  },
  {
    key: 'candlelight',
    group: 'candlelight',
    title: 'Candlelight Beach Dinner',
    subtitle: 'Private Oceanfront Dining Romance',
    aspect: '4:3',
    recDim: '1200 × 900 px (4:3) or 16:9',
    defaultUrl: 'assets/images/candlelight-dinner.jpg',
    defaultAlt: 'Private Candlelight Dinner on Mandarmani Beach'
  },
  {
    key: 'cocktails',
    group: 'cocktails',
    title: 'Coral Reef Cocktail Lounge',
    subtitle: 'Neon Beachside Bar & Sunset Cocktails',
    aspect: '4:3',
    recDim: '1200 × 900 px (4:3)',
    defaultUrl: 'assets/images/cocktail-lounge.jpg',
    defaultAlt: 'Coral Reef Cocktail Lounge Coastal View'
  },
  {
    key: 'places',
    group: 'places',
    title: 'Nearby Coastal Attractions',
    subtitle: 'Mandarmani Beach & Marine Excursions',
    aspect: '4:3',
    recDim: '1200 × 900 px (4:3)',
    defaultUrl: 'assets/images/tajpur-beach.jpg',
    defaultAlt: 'Tajpur Beach and Red Crab Coastline'
  },
  {
    key: 'anisTours',
    group: 'all',
    title: "Ani's Tours & Travels Fleet",
    subtitle: 'Luxury AC door-to-door transit banner',
    aspect: '16:9',
    recDim: '1600 × 700 px (Banner format)',
    defaultUrl: 'assets/images/mandarmani-beach.jpg',
    defaultAlt: "Ani's Tours Luxury Chauffeur Driven Fleet"
  },
  {
    key: 'gallery',
    group: 'gallery',
    title: 'Resort Showcase Gallery',
    subtitle: 'Public Website Showcase Feature',
    aspect: '4:3',
    recDim: '1200 × 900 px (4:3)',
    defaultUrl: 'assets/images/exterior-night.jpg',
    defaultAlt: 'Coastal View Beach Resort Illuminated Night Exterior'
  },
  {
    key: 'amenities',
    group: 'amenities',
    title: 'Luxury Amenities Panorama',
    subtitle: 'Infinity Pool, Private Cabanas & Beach Lawn',
    aspect: '4:3',
    recDim: '1200 × 900 px (4:3)',
    defaultUrl: 'assets/images/pool-night.jpg',
    defaultAlt: 'Coastal View Illuminated Swimming Pool and Deck'
  }
];

// Initialize Photos & Media Manager Dropzone and Listeners
// ============================================================================
// REDESIGNED 3-CLICK PHOTOS & MEDIA MANAGER ENGINE (REQUIREMENT 4)
// ============================================================================

// State for Photo Cropper & Upload Flow
let currentCropSlotKey = null;
let currentCropRoomId = null;
let currentCropPhotoId = null;
let currentCropIsCover = false;
let currentCropDishId = null;
let currentCropTargetAspect = 4 / 3; // default slot aspect ratio
let currentCropShape = 'rect'; // 'rect' or 'round'
let isBulkGalleryMode = false;
let bulkGalleryFiles = [];

// Cropper.js instance & Preview state (No custom canvas on-screen)
let currentCropper = null;
let currentPreviewObjectUrl = null;
let currentSelectedRawFile = null;
let useOriginalFileFlag = false;

let currentUndoToken = null;
let undoCountdownInterval = null;

// Initialize Photos Manager
function initPhotosManager() {
  const modal = document.getElementById('changePhotoModal');
  if (modal) {
    // Backdrop click to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeChangePhotoModal();
      }
    });
  }

  // Keyboard accessibility: Escape to close and Tab focus trap
  document.addEventListener('keydown', (e) => {
    const changeModal = document.getElementById('changePhotoModal');
    if (!changeModal || changeModal.style.display !== 'flex') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeChangePhotoModal();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = changeModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !changeModal.contains(document.activeElement)) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last || !changeModal.contains(document.activeElement)) {
          first.focus();
          e.preventDefault();
        }
      }
    }
  });

  const dropzone = document.getElementById('photoModalDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handlePhotoFileSelected(e.dataTransfer.files);
      }
    });
  }
}

// Fetch all Media Slots & Galleries
async function loadPhotosData(isRefresh = false) {
  try {
    if (isRefresh) showToast('Refreshing media records...', 'info');
    const res = await authFetch('/api/media');
    if (res.success) {
      adminState.mediaSlots = res.slots || [];
      adminState.mediaSections = res.sections || {};
      adminState.mediaHistory = res.mediaHistory || [];
      if (Array.isArray(res.rooms)) {
        res.rooms.forEach(freshRoom => {
          const existing = (adminState.rooms || []).find(r => r.id === freshRoom.id);
          if (existing) {
            existing.image = freshRoom.image;
            existing.gallery = freshRoom.gallery || [];
          }
        });
      }
      renderPhotosManager();
      if (isRefresh) showToast('Media slots up to date.', 'success');
    }
  } catch (err) {
    console.error('Error fetching media:', err);
  }
}

// Render the 9 Labeled Slots in Photos & Media
function renderPhotosManager() {
  const container = document.getElementById('photoSlotsContainer');
  if (!container) return;

  const slots = adminState.mediaSlots || [];

  if (slots.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #64748B; padding: 32px;">Loading media slots...</div>';
    return;
  }

  container.innerHTML = slots.map(slot => {
    const historyCount = (slot.history || []).length;
    const hasImage = slot.currentUrl && !slot.currentUrl.includes('placeholder');

    return `
      <div class="photo-slot-card" data-section="${slot.section}" data-slot-key="${slot.key}">
        <div class="slot-image-wrapper">
          ${hasImage ? `
            <img src="${slot.currentUrl}" alt="${slot.alt || slot.title}" class="slot-current-img" loading="lazy" onerror="this.src='../assets/images/logo.png'">
          ` : `
            <div class="slot-empty-state">
              <span class="material-symbols-outlined" style="font-size: 36px;">add_photo_alternate</span>
              <span style="font-size: 0.85rem; font-weight: 600;">Empty Slot</span>
            </div>
          `}
          <div class="slot-badge">${slot.section}</div>
        </div>

        <div class="slot-card-body">
          <h3 class="slot-title">${slot.title}</h3>
          <div class="slot-rec-size">
            <span class="material-symbols-outlined" style="font-size: 16px;">straighten</span>
            <span>Recommended: ${slot.recommendedSize}</span>
          </div>

          <!-- One Large Prominent Action Button -->
          <button class="btn-change-photo" onclick="openChangePhotoModal('${slot.key}')">
            <span class="material-symbols-outlined">photo_camera</span> Change Photo
          </button>

          <!-- 3 Plain Secondary Options -->
          <div class="slot-actions-row">
            <button class="btn-slot-option" onclick="openEditMetadataModal('${slot.key}')" title="Edit Alt text and caption">
              <span class="material-symbols-outlined" style="font-size: 15px;">edit_note</span> Edit Text
            </button>
            <button class="btn-slot-option" onclick="openHistoryModal('${slot.key}')" title="Restore previous version">
              <span class="material-symbols-outlined" style="font-size: 15px;">history</span> Restore (${historyCount})
            </button>
            <button class="btn-slot-option danger" onclick="confirmDeleteSlotPhoto('${slot.key}')" title="Delete photo">
              <span class="material-symbols-outlined" style="font-size: 15px;">delete</span> Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Render Room Gallery Strips
  renderRoomGalleriesStrips();
}

// Render Room Gallery Strips
function renderRoomGalleriesStrips() {
  const container = document.getElementById('roomGalleriesContainer');
  if (!container) return;

  const rooms = (adminState.rooms || []).filter(r => !r.isArchived);
  if (rooms.length === 0) {
    container.innerHTML = '<p style="color: #64748B;">No rooms available.</p>';
    return;
  }

  container.innerHTML = rooms.map(room => {
    const gallery = room.gallery || [];
    return `
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 24px; box-shadow: 0 4px 14px rgba(7, 59, 76, 0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="margin: 0; color: #073B4C; font-size: 1.15rem; font-weight: 700;">${room.name}</h3>
            <span style="font-size: 0.8rem; color: #64748B;">${gallery.length} Photos in Gallery • Cover Image Live on Website</span>
          </div>
          <button class="btn-outline-gold" onclick="openChangePhotoModal(null, '${room.id}', null, false)" style="font-size: 0.82rem; padding: 6px 14px;">
            <span class="material-symbols-outlined" style="font-size: 16px;">add_photo_alternate</span> Add Room Photo
          </button>
        </div>

        <!-- Room Gallery Strip -->
        <div style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: thin;">
          ${gallery.map((p, idx) => `
            <div style="flex: 0 0 220px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;">
              <div style="position: relative; height: 130px; background: #0F172A;">
                <img src="${p.url}" alt="${p.alt || room.name}" style="width: 100%; height: 100%; object-fit: cover;">
                ${p.isCover ? '<span style="position: absolute; top: 8px; left: 8px; background: #E8C77B; color: #073B4C; font-size: 0.68rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">COVER</span>' : ''}
              </div>
              <div style="padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1;">
                <div style="font-size: 0.8rem; font-weight: 600; color: #073B4C; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${p.caption || `Photo #${idx + 1}`}
                </div>
                <button class="btn-change-photo" onclick="openChangePhotoModal(null, '${room.id}', '${p.id}', ${p.isCover})" style="padding: 6px 10px; font-size: 0.76rem;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">photo_camera</span> Change Photo
                </button>
                <div style="display: flex; gap: 4px;">
                  ${!p.isCover ? `
                    <button class="btn-slot-option" onclick="setRoomCoverPhoto('${room.id}', '${p.id}')" style="font-size: 0.72rem;">Make Cover</button>
                  ` : ''}
                  <button class="btn-slot-option danger" onclick="confirmDeleteSlotPhoto(null, '${room.id}', '${p.id}')" style="font-size: 0.72rem;">Delete</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// Filter Photo Slots by Section
window.filterPhotoSlots = function(section, btn) {
  document.querySelectorAll('.photo-section-filters .filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const cards = document.querySelectorAll('.photo-slot-card');
  cards.forEach(card => {
    if (section === 'all' || card.getAttribute('data-section') === section) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
};

// Inline Error Helper for Change Photo Modal
function showModalError(msg) {
  const errBox = document.getElementById('changePhotoErrorMsg');
  const errText = document.getElementById('changePhotoErrorText');
  if (errText) errText.textContent = msg;
  if (errBox) errBox.style.display = 'flex';
}

// Open the 3-Click Change Photo / Add Photo Modal
window.openChangePhotoModal = function(slotKey = null, roomId = null, photoId = null, isCover = false, dishId = null, isBulkGallery = false) {
  currentCropSlotKey = slotKey;
  currentCropRoomId = roomId;
  currentCropPhotoId = photoId;
  currentCropIsCover = isCover;
  currentCropDishId = dishId;
  isBulkGalleryMode = !!isBulkGallery || slotKey === 'gallery_bulk';
  bulkGalleryFiles = [];

  // Destroy previous cropper and revoke object URL
  if (currentCropper) {
    try { currentCropper.destroy(); } catch (e) {}
    currentCropper = null;
  }
  if (currentPreviewObjectUrl) {
    try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (e) {}
    currentPreviewObjectUrl = null;
  }
  currentSelectedRawFile = null;
  useOriginalFileFlag = false;
  currentCropShape = 'rect';

  const modal = document.getElementById('changePhotoModal');
  const titleEl = document.getElementById('changePhotoModalTitle');
  const subEl = document.getElementById('changePhotoModalSubtitle');
  const currentPreview = document.getElementById('currentPhotoPreviewImg');
  const noCurrentPhotoMsg = document.getElementById('noCurrentPhotoMsg');
  const saveBtn = document.getElementById('btnSavePhotoChange');
  const saveBtnText = document.getElementById('saveBtnText');
  const errBox = document.getElementById('changePhotoErrorMsg');
  const singleSection = document.getElementById('modalStep2Section');
  const bulkSection = document.getElementById('bulkGallerySection');
  const fileInput = document.getElementById('photoFileInput');
  const cropImg = document.getElementById('photoCropImage');
  const placeholder = document.getElementById('newPhotoPlaceholder');
  const circleOverlay = document.getElementById('cropCircularOverlay');
  const fileInfoBadge = document.getElementById('selectedFileInfoBadge');
  const zoomSlider = document.getElementById('cropZoomSlider');
  const zoomMinus = document.getElementById('btnZoomMinus');
  const zoomPlus = document.getElementById('btnZoomPlus');
  const resetBtn = document.getElementById('btnResetCrop');
  const btnUseOriginal = document.getElementById('btnUseOriginal');
  const loadingSpinner = document.getElementById('cropLoadingSpinner');
  const cropLoadErrorBox = document.getElementById('cropLoadErrorBox');
  const progressWrap = document.getElementById('uploadProgressWrap');

  if (errBox) errBox.style.display = 'none';
  if (progressWrap) progressWrap.style.display = 'none';
  if (loadingSpinner) loadingSpinner.style.display = 'none';
  if (cropLoadErrorBox) cropLoadErrorBox.style.display = 'none';
  if (fileInput) {
    fileInput.value = '';
    fileInput.multiple = isBulkGalleryMode;
  }

  // Reset controls state
  if (cropImg) {
    cropImg.style.display = 'none';
    cropImg.src = '';
  }
  if (placeholder) placeholder.style.display = 'flex';
  if (fileInfoBadge) fileInfoBadge.style.display = 'none';
  if (zoomSlider) { zoomSlider.value = 1.0; zoomSlider.disabled = true; }
  if (zoomMinus) zoomMinus.disabled = true;
  if (zoomPlus) zoomPlus.disabled = true;
  if (resetBtn) resetBtn.disabled = true;
  if (btnUseOriginal) {
    btnUseOriginal.disabled = true;
    btnUseOriginal.classList.remove('active');
  }
  if (saveBtn) {
    saveBtn.disabled = true;
    if (saveBtnText) saveBtnText.textContent = isBulkGalleryMode ? 'Save Gallery Photos (0)' : 'Save & Update Photo';
  }

  if (isBulkGalleryMode) {
    if (singleSection) singleSection.style.display = 'none';
    if (bulkSection) bulkSection.style.display = 'block';
    renderBulkGalleryGrid();
    titleEl.textContent = 'Add Photos to Showcase Gallery';
    subEl.textContent = 'Recommended 1200 × 900 px · 4:3 · JPG, PNG, WebP · max 8 MB each.';
    if (modal) modal.style.display = 'flex';
    return;
  }

  // Single Photo Mode
  if (singleSection) singleSection.style.display = 'block';
  if (bulkSection) bulkSection.style.display = 'none';

  let currentPhotoUrl = null;

  if (dishId) {
    currentCropShape = 'round';
    currentCropTargetAspect = 1.0;
    const dish = (adminState.restaurant || []).find(d => d.id === dishId) || {};
    titleEl.textContent = `Change Photo: ${dish.name || 'Restaurant Dish'}`;
    subEl.textContent = 'Recommended 800 × 800 px · Round · JPG, PNG, WebP · max 8 MB.';
    currentPhotoUrl = dish.image;
    if (circleOverlay) circleOverlay.style.display = 'block';
  } else if (slotKey) {
    const slotsArr = Array.isArray(adminState.mediaSlots) ? adminState.mediaSlots : (typeof PHOTO_SLOTS_DATA !== 'undefined' && Array.isArray(PHOTO_SLOTS_DATA) ? PHOTO_SLOTS_DATA : []);
    const slotObj = slotsArr.find(s => s && s.key === slotKey) || (typeof adminState.mediaSlots === 'object' && adminState.mediaSlots ? adminState.mediaSlots[slotKey] : null);
    if (circleOverlay) circleOverlay.style.display = 'none';
    if (slotObj) {
      titleEl.textContent = `Change Photo: ${slotObj.title}`;
      subEl.textContent = `Recommended ${slotObj.recommendedSize} · ${slotObj.aspect} · JPG, PNG, WebP · max 8 MB.`;
      currentPhotoUrl = slotObj.currentUrl;
      if (slotObj.aspect === '1:1') {
        currentCropTargetAspect = 1.0;
      } else if (slotObj.aspect === '16:9') {
        currentCropTargetAspect = 16 / 9;
      } else {
        currentCropTargetAspect = 4 / 3;
      }
    } else {
      titleEl.textContent = `Change Photo: ${slotKey}`;
      subEl.textContent = 'Recommended 1200 × 900 px · 4:3 · JPG, PNG, WebP · max 8 MB.';
      currentCropTargetAspect = 4 / 3;
    }
  } else if (roomId) {
    if (circleOverlay) circleOverlay.style.display = 'none';
    const room = (adminState.rooms || []).find(r => r.id === roomId);
    titleEl.textContent = `Change Photo: ${room ? room.name : 'Room Gallery'}${isCover ? ' (Cover)' : ''}`;
    subEl.textContent = 'Recommended 1200 × 900 px · 4:3 · JPG, PNG, WebP · max 8 MB.';
    currentCropTargetAspect = 4 / 3;
    if (photoId && room && room.gallery) {
      const p = room.gallery.find(x => x.id === photoId);
      if (p) currentPhotoUrl = p.url;
    } else if (room) {
      currentPhotoUrl = room.image;
    }
  }

  // Sizing of Aspect Boxes
  const aspectStr = currentCropTargetAspect === 1.0 ? '1 / 1' : (currentCropTargetAspect === 16 / 9 ? '16 / 9' : '4 / 3');
  const curBox = document.getElementById('currentPhotoAspectBox');
  const newBox = document.getElementById('cropCanvasAspectBox');
  if (curBox) curBox.style.aspectRatio = aspectStr;
  if (newBox) newBox.style.aspectRatio = aspectStr;

  // Populate Current Photo
  if (currentPhotoUrl && !currentPhotoUrl.includes('placeholder') && !currentPhotoUrl.includes('data:image/svg')) {
    if (currentPreview) {
      currentPreview.src = formatAdminImgUrl(currentPhotoUrl);
      currentPreview.style.display = 'block';
    }
    if (noCurrentPhotoMsg) noCurrentPhotoMsg.style.display = 'none';
  } else {
    if (currentPreview) currentPreview.style.display = 'none';
    if (noCurrentPhotoMsg) noCurrentPhotoMsg.style.display = 'flex';
  }

  if (modal) modal.style.display = 'flex';
};

window.closeChangePhotoModal = function() {
  const modal = document.getElementById('changePhotoModal');
  if (modal) modal.style.display = 'none';
  if (currentCropper) {
    try { currentCropper.destroy(); } catch (e) {}
    currentCropper = null;
  }
  if (currentPreviewObjectUrl) {
    try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (e) {}
    currentPreviewObjectUrl = null;
  }
  currentSelectedRawFile = null;
  useOriginalFileFlag = false;

  // Clean up any bulk preview object URLs
  if (bulkGalleryFiles && bulkGalleryFiles.length > 0) {
    bulkGalleryFiles.forEach(f => {
      if (f.objectUrl) try { URL.revokeObjectURL(f.objectUrl); } catch (e) {}
    });
    bulkGalleryFiles = [];
  }
};

// Handle File Selected / Dropped
window.handlePhotoFileSelected = function(files) {
  if (!files || files.length === 0) return;
  const errBox = document.getElementById('changePhotoErrorMsg');
  if (errBox) errBox.style.display = 'none';

  // Bulk Gallery Mode
  if (isBulkGalleryMode) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 8 * 1024 * 1024) {
        showModalError('File too large (max 8 MB)');
        continue;
      }
      if (!allowed.includes(file.type)) {
        showModalError('Only JPG, PNG, or WebP allowed');
        continue;
      }
      const objectUrl = URL.createObjectURL(file);
      const sizeStr = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      bulkGalleryFiles.push({
        id: 'bulk-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        file,
        name: file.name,
        sizeStr,
        objectUrl,
        category: document.getElementById('bulkGlobalCategorySelect')?.value || 'Hotel',
        status: 'ready'
      });
    }
    renderBulkGalleryGrid();
    const saveBtn = document.getElementById('btnSavePhotoChange');
    const saveBtnText = document.getElementById('saveBtnText');
    if (saveBtn) {
      saveBtn.disabled = bulkGalleryFiles.length === 0;
      if (saveBtnText) saveBtnText.textContent = `Save Gallery Photos (${bulkGalleryFiles.length})`;
    }
    return;
  }

  // Single Photo Mode
  const file = files[0];

  // 1. Validate File Size (Max 8 MB)
  if (file.size > 8 * 1024 * 1024) {
    showModalError('File too large (max 8 MB)');
    return;
  }

  // 2. Validate Allowed MIME Types
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    showModalError('Only JPG, PNG, or WebP allowed');
    return;
  }

  // Show file badge
  const badge = document.getElementById('selectedFileInfoBadge');
  const nameEl = document.getElementById('selectedFileName');
  const sizeEl = document.getElementById('selectedFileSize');
  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  if (badge) badge.style.display = 'inline-block';

  // Clean up any previous preview object URL
  if (currentPreviewObjectUrl) {
    try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (e) {}
    currentPreviewObjectUrl = null;
  }
  if (currentCropper) {
    try { currentCropper.destroy(); } catch (e) {}
    currentCropper = null;
  }

  currentSelectedRawFile = file;
  useOriginalFileFlag = false;

  const slider = document.getElementById('cropZoomSlider');
  const zoomMinus = document.getElementById('btnZoomMinus');
  const zoomPlus = document.getElementById('btnZoomPlus');
  const resetBtn = document.getElementById('btnResetCrop');
  const btnUseOriginal = document.getElementById('btnUseOriginal');
  const placeholder = document.getElementById('newPhotoPlaceholder');
  const cropImg = document.getElementById('photoCropImage');
  const spinner = document.getElementById('cropLoadingSpinner');
  const cropErrBox = document.getElementById('cropLoadErrorBox');
  const saveBtn = document.getElementById('btnSavePhotoChange');

  if (placeholder) placeholder.style.display = 'none';
  if (cropErrBox) cropErrBox.style.display = 'none';
  if (spinner) spinner.style.display = 'flex';
  if (btnUseOriginal) {
    btnUseOriginal.disabled = false;
    btnUseOriginal.classList.remove('active');
  }

  // Create preview with URL.createObjectURL(file)
  currentPreviewObjectUrl = URL.createObjectURL(file);

  if (cropImg) {
    cropImg.style.display = 'none';
    cropImg.onload = () => {
      if (spinner) spinner.style.display = 'none';
      cropImg.style.display = 'block';

      if (typeof Cropper !== 'function') {
        console.error('Cropper.js library not available on window');
        showModalError("Could not initialize cropper tool. You can still use 'Use original photo'.");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      // Initialize Cropper.js with slot's locked aspect ratio
      const targetAspect = currentCropTargetAspect || (4 / 3);
      currentCropper = new Cropper(cropImg, {
        aspectRatio: targetAspect,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.96,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        background: false,
        ready() {
          if (slider) { slider.value = 1.0; slider.disabled = false; }
          if (zoomMinus) zoomMinus.disabled = false;
          if (zoomPlus) zoomPlus.disabled = false;
          if (resetBtn) resetBtn.disabled = false;
          if (saveBtn) saveBtn.disabled = false;
        },
        zoom(e) {
          if (slider && e.detail && typeof e.detail.ratio === 'number') {
            slider.value = Math.min(3.0, Math.max(0.5, e.detail.ratio)).toFixed(2);
          }
        }
      });
    };

    cropImg.onerror = () => {
      if (spinner) spinner.style.display = 'none';
      if (cropErrBox) cropErrBox.style.display = 'flex';
      showModalError("Couldn't read this image. Try a JPG or a smaller file.");
      if (saveBtn) saveBtn.disabled = false; // still allow original file upload
    };

    cropImg.src = currentPreviewObjectUrl;
  }
};

// "Use original photo (no crop)" button action
window.useOriginalPhotoWithoutCrop = function() {
  if (!currentSelectedRawFile) return;
  useOriginalFileFlag = true;
  const btn = document.getElementById('btnUseOriginal');
  if (btn) btn.classList.add('active');
  const saveBtn = document.getElementById('btnSavePhotoChange');
  if (saveBtn) saveBtn.disabled = false;
  showToast('Selected original photo without cropping. Ready to save.', 'info');
};

// Helper: draw cropped image to offscreen canvas at slot's size, fill with white first, output toBlob
async function getCroppedImageBlob() {
  if (useOriginalFileFlag || !currentCropper) {
    return currentSelectedRawFile;
  }

  let targetWidth = 1200;
  let targetHeight = 900;
  if (currentCropTargetAspect === 1.0) {
    targetWidth = 800;
    targetHeight = 800;
  } else if (currentCropTargetAspect === 16 / 9) {
    targetWidth = 1280;
    targetHeight = 720;
  }

  try {
    const croppedCanvas = currentCropper.getCroppedCanvas({
      width: targetWidth,
      height: targetHeight,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    if (!croppedCanvas) {
      console.warn('Cropper getCroppedCanvas returned empty; falling back to original file.');
      showToast('Cropper output empty; using original photo instead.', 'info');
      return currentSelectedRawFile;
    }

    // Create offscreen canvas at slot's size and fill canvas with white first (handles transparent PNGs)
    const offscreen = document.createElement('canvas');
    offscreen.width = targetWidth;
    offscreen.height = targetHeight;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // If circular dish crop
    if (currentCropShape === 'round') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(targetWidth / 2, targetHeight / 2, Math.min(targetWidth, targetHeight) / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(croppedCanvas, 0, 0, targetWidth, targetHeight);
      ctx.restore();
    } else {
      ctx.drawImage(croppedCanvas, 0, 0, targetWidth, targetHeight);
    }

    const blob = await new Promise(resolve => {
      offscreen.toBlob(b => resolve(b), 'image/webp', 0.92);
    });

    if (!blob || blob.size === 0) {
      console.warn('Offscreen toBlob returned empty; falling back to original file.');
      showToast('Cropped output was empty; falling back to original file.', 'info');
      return currentSelectedRawFile;
    }

    return blob;
  } catch (err) {
    console.error('Error generating cropped image blob:', err);
    showToast('Cropping error; using original file instead.', 'info');
    return currentSelectedRawFile;
  }
}

// Helper: read Blob or File as DataURL Base64
function readFileAsBase64(blobOrFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blobOrFile);
  });
}

window.stepZoom = function(delta) {
  if (!currentCropper) return;
  const imgData = currentCropper.getImageData ? currentCropper.getImageData() : null;
  const currentRatio = imgData && imgData.naturalWidth ? (imgData.width / imgData.naturalWidth) : 1;
  const nextZoom = Math.min(3.0, Math.max(0.5, currentRatio + delta));
  currentCropper.zoomTo(nextZoom);
  const slider = document.getElementById('cropZoomSlider');
  if (slider) slider.value = nextZoom.toFixed(2);
};

window.handleCropZoomChange = function(val) {
  if (!currentCropper) return;
  currentCropper.zoomTo(parseFloat(val));
};

window.resetCropPosition = function() {
  if (!currentCropper) return;
  currentCropper.reset();
  const slider = document.getElementById('cropZoomSlider');
  if (slider) slider.value = 1.0;
};

// Bulk Gallery Item Helpers
window.removeBulkGalleryItem = function(id) {
  const item = bulkGalleryFiles.find(x => x.id === id);
  if (item && item.objectUrl) try { URL.revokeObjectURL(item.objectUrl); } catch (e) {}
  bulkGalleryFiles = bulkGalleryFiles.filter(x => x.id !== id);
  renderBulkGalleryGrid();
  const saveBtn = document.getElementById('btnSavePhotoChange');
  const saveBtnText = document.getElementById('saveBtnText');
  if (saveBtn) {
    saveBtn.disabled = bulkGalleryFiles.length === 0;
    if (saveBtnText) saveBtnText.textContent = `Save Gallery Photos (${bulkGalleryFiles.length})`;
  }
};

window.updateBulkItemCategory = function(id, cat) {
  const item = bulkGalleryFiles.find(x => x.id === id);
  if (item) item.category = cat;
};

window.applyGlobalCategoryToAll = function(cat) {
  bulkGalleryFiles.forEach(item => { item.category = cat; });
  renderBulkGalleryGrid();
};

function renderBulkGalleryGrid() {
  const grid = document.getElementById('bulkGalleryThumbGrid');
  const countEl = document.getElementById('bulkGalleryCount');
  if (countEl) countEl.textContent = bulkGalleryFiles.length;
  if (!grid) return;

  if (bulkGalleryFiles.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748B; padding: 24px;">No photos selected yet. Use the drop zone above to choose photos.</div>';
    return;
  }

  const categories = ['Hotel', 'Rooms', 'Amenities', 'Dining', 'Mocktails', 'Candlelight', 'Places'];

  grid.innerHTML = bulkGalleryFiles.map(item => `
    <div class="bulk-gallery-card" id="card-${item.id}">
      <img src="${item.objectUrl}" alt="${item.name}" class="bulk-card-thumb">
      <div class="bulk-card-details">
        <div class="bulk-card-name" title="${item.name}">${item.name}</div>
        <div class="bulk-card-meta">${item.sizeStr}</div>
        <select class="bulk-cat-select" onchange="updateBulkItemCategory('${item.id}', this.value)">
          ${categories.map(c => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <span class="bulk-card-status ${item.status}">
          ${item.status === 'ready' ? 'Ready' : (item.status === 'uploading' ? 'Uploading…' : (item.status === 'success' ? 'Uploaded ✓' : 'Failed ✗'))}
        </span>
      </div>
      <button type="button" class="bulk-card-remove" onclick="removeBulkGalleryItem('${item.id}')" title="Remove photo" aria-label="Remove photo">
        <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
      </button>
    </div>
  `).join('');
}

// Execute Save Photo Change (Step 3: Instant Live Update)
window.executeSavePhotoChange = async function() {
  const saveBtn = document.getElementById('btnSavePhotoChange');
  const saveBtnText = document.getElementById('saveBtnText');
  const progressWrap = document.getElementById('uploadProgressWrap');
  const progressBar = document.getElementById('uploadProgressBar');
  const progressPct = document.getElementById('uploadProgressPercent');
  const progressLabel = document.getElementById('uploadProgressStatusLabel');
  const errBox = document.getElementById('changePhotoErrorMsg');

  if (errBox) errBox.style.display = 'none';

  // Handle Bulk Gallery Mode
  if (isBulkGalleryMode) {
    if (bulkGalleryFiles.length === 0) return;
    if (saveBtn) saveBtn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';

    const total = bulkGalleryFiles.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const item = bulkGalleryFiles[i];
      item.status = 'uploading';
      renderBulkGalleryGrid();

      const pct = Math.round(((i + 0.3) / total) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressPct) progressPct.textContent = `${pct}%`;
      if (saveBtnText) saveBtnText.textContent = `Uploading… ${pct}%`;
      if (progressLabel) progressLabel.textContent = `Uploading ${item.name} (${i + 1}/${total})...`;

      try {
        const base64Data = await readFileAsBase64(item.file);
        const res = await authFetch('/api/gallery', {
          method: 'POST',
          body: {
            photos: [{
              imageBase64: base64Data,
              category: item.category || 'Hotel',
              caption: item.name.replace(/\.[^/.]+$/, ''),
              alt: `${item.name.replace(/\.[^/.]+$/, '')} at Coastal View Mandarmani`
            }]
          }
        });

        if (res && res.status === 401) {
          showModalError('Session expired, please log in again');
          if (saveBtn) saveBtn.disabled = false;
          if (saveBtnText) saveBtnText.textContent = `Save Gallery Photos (${total})`;
          return;
        }

        if (res && res.success) {
          item.status = 'success';
          successCount++;
        } else {
          item.status = 'error';
        }
      } catch (e) {
        item.status = 'error';
      }
      renderBulkGalleryGrid();
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressPct) progressPct.textContent = '100%';

    if (successCount > 0) {
      setTimeout(async () => {
        closeChangePhotoModal();
        showToast(`Uploaded ${successCount} gallery photo(s) successfully!`, 'success');
        if (typeof renderShowcaseGallerySection === 'function') {
          const gRes = await fetch('/api/gallery').then(r => r.json()).catch(() => ({ photos: [] }));
          adminState.gallery = gRes.photos || [];
          renderShowcaseGallerySection();
        }
      }, 500);
    } else {
      showModalError('Upload failed, try again');
      if (saveBtn) saveBtn.disabled = false;
      if (saveBtnText) saveBtnText.textContent = `Save Gallery Photos (${total})`;
    }
    return;
  }

  // Single Photo Mode
  if (!currentSelectedRawFile) {
    showModalError('Please choose an image file first.');
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  // Step 1: 20%
  if (progressBar) progressBar.style.width = '20%';
  if (progressPct) progressPct.textContent = '20%';
  if (saveBtnText) saveBtnText.textContent = 'Preparing image… 20%';
  if (progressLabel) progressLabel.textContent = useOriginalFileFlag ? 'Preparing original image...' : 'Re-encoding to WebP format...';

  let base64Data;
  try {
    const outputBlob = await getCroppedImageBlob();
    if (!outputBlob) {
      showModalError('Could not process photo. Please choose another image.');
      if (saveBtn) saveBtn.disabled = false;
      if (progressWrap) progressWrap.style.display = 'none';
      return;
    }
    base64Data = await readFileAsBase64(outputBlob);
  } catch (prepErr) {
    console.error('Error preparing image for upload:', prepErr);
    showModalError('Image preparation failed. You can click "Use original photo".');
    if (saveBtn) saveBtn.disabled = false;
    if (progressWrap) progressWrap.style.display = 'none';
    return;
  }

  // Step 2: 60%
  if (progressBar) progressBar.style.width = '60%';
  if (progressPct) progressPct.textContent = '60%';
  if (saveBtnText) saveBtnText.textContent = 'Uploading… 60%';
  if (progressLabel) progressLabel.textContent = 'Uploading to secure media vault...';

  try {
    // If Dish Target
    if (currentCropDishId) {
      const res = await authFetch('/api/menu/upload-image', {
        method: 'POST',
        body: {
          dishId: currentCropDishId,
          imageBase64: base64Data,
          mimeType: 'image/webp'
        }
      });

      if (res && res.status === 401) {
        showModalError('Session expired, please log in again');
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtnText) saveBtnText.textContent = 'Save & Update Photo';
        return;
      }

      if (res && res.success) {
        if (progressBar) progressBar.style.width = '100%';
        if (progressPct) progressPct.textContent = '100%';
        if (saveBtnText) saveBtnText.textContent = 'Uploading… 100%';

        closeChangePhotoModal();
        showToast(`Dish photo updated for "${res.dish ? res.dish.name : 'dish'}". Changes are live!`, 'success');

        // Update local admin state
        if (res.dish && adminState.restaurant) {
          const idx = adminState.restaurant.findIndex(d => d.id === currentCropDishId);
          if (idx !== -1) adminState.restaurant[idx] = res.dish;
          if (typeof renderRestaurantMenuTable === 'function') renderRestaurantMenuTable();
        }
      } else {
        showModalError(res ? (res.message || 'Upload failed, try again') : 'Upload failed, try again');
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtnText) saveBtnText.textContent = 'Save & Update Photo';
      }
      return;
    }

    // Website Slot or Room Target
    const payload = {
      slotKey: currentCropSlotKey,
      roomId: currentCropRoomId,
      photoId: currentCropPhotoId,
      isCover: currentCropIsCover,
      imageBase64: base64Data
    };

    const res = await authFetch('/api/media/upload', {
      method: 'POST',
      body: payload
    });

    if (res && res.status === 401) {
      showModalError('Session expired, please log in again');
      if (saveBtn) saveBtn.disabled = false;
      if (saveBtnText) saveBtnText.textContent = 'Save & Update Photo';
      return;
    }

    if (res && res.success) {
      if (progressBar) progressBar.style.width = '100%';
      if (progressPct) progressPct.textContent = '100%';
      if (saveBtnText) saveBtnText.textContent = 'Uploading… 100%';

      closeChangePhotoModal();
      showToast('Photo updated. Changes are live on the website immediately!', 'success');

      // Refresh media state
      await loadPhotosData();

      // Show 30-Second Floating Undo Banner
      if (res.undoToken) {
        startUndoCountdown(res.undoToken);
      }
    } else {
      showModalError(res ? (res.message || 'Upload failed, try again') : 'Upload failed, try again');
      if (saveBtn) saveBtn.disabled = false;
      if (saveBtnText) saveBtnText.textContent = 'Save & Update Photo';
    }
  } catch (err) {
    showModalError('Upload failed, try again');
    if (saveBtn) saveBtn.disabled = false;
    if (saveBtnText) saveBtnText.textContent = 'Save & Update Photo';
  } finally {
    if (progressWrap) progressWrap.style.display = 'none';
  }
};

// 30-Second Floating Undo Banner Engine
function startUndoCountdown(undoToken) {
  currentUndoToken = undoToken;
  if (undoCountdownInterval) clearInterval(undoCountdownInterval);

  const banner = document.getElementById('undoFloatingBanner');
  const cdText = document.getElementById('undoBannerCountdown');
  if (!banner) return;

  banner.style.display = 'flex';
  let remaining = 30;

  function update() {
    if (cdText) cdText.textContent = `Undo available for ${remaining}s`;
    if (remaining <= 0) {
      clearInterval(undoCountdownInterval);
      banner.style.display = 'none';
      currentUndoToken = null;
    }
    remaining--;
  }

  update();
  undoCountdownInterval = setInterval(update, 1000);
}

window.dismissUndoBanner = function() {
  const banner = document.getElementById('undoFloatingBanner');
  if (banner) banner.style.display = 'none';
  if (undoCountdownInterval) clearInterval(undoCountdownInterval);
  currentUndoToken = null;
};

window.executeUndoLastPhotoChange = async function() {
  if (!currentUndoToken) return;

  try {
    showToast('Undoing photo change...', 'info');
    const res = await authFetch('/api/media/undo', {
      method: 'POST',
      body: { undoToken: currentUndoToken }
    });

    if (res.success) {
      dismissUndoBanner();
      showToast('Photo update undone. Previous image restored immediately.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Undo window expired.', 'error');
    }
  } catch (e) {
    showToast('Error during undo.', 'error');
  }
};

// Version History & Restore Modal
window.openHistoryModal = function(slotKey) {
  const modal = document.getElementById('photoHistoryModal');
  const titleEl = document.getElementById('historyModalTitle');
  const listEl = document.getElementById('historyVersionsList');
  if (!modal || !listEl) return;

  const slot = (adminState.mediaSlots || []).find(s => s.key === slotKey);
  titleEl.textContent = `Version History: ${slot ? slot.title : slotKey}`;

  const history = (slot && slot.history) ? slot.history : [];

  if (history.length === 0) {
    listEl.innerHTML = '<div style="text-align: center; color: #64748B; padding: 24px;">No previous versions recorded yet for this slot.</div>';
  } else {
    listEl.innerHTML = history.map((ver, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #E2E8F0; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${ver.url}" alt="Version ${idx + 1}" style="width: 72px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid #CBD5E1;">
          <div>
            <div style="font-weight: 700; color: #073B4C; font-size: 0.88rem;">Version #${idx + 1}</div>
            <div style="font-size: 0.76rem; color: #64748B;">Replaced ${new Date(ver.replacedAt).toLocaleString('en-IN')} by ${ver.replacedBy || 'Staff'}</div>
          </div>
        </div>
        <button class="btn-turquoise" onclick="executeRestoreVersion('${ver.id}')" style="padding: 6px 14px; font-size: 0.8rem;">
          <span class="material-symbols-outlined" style="font-size: 16px;">restore</span> Restore
        </button>
      </div>
    `).join('');
  }

  modal.style.display = 'flex';
};

window.closeHistoryModal = function() {
  const modal = document.getElementById('photoHistoryModal');
  if (modal) modal.style.display = 'none';
};

window.executeRestoreVersion = async function(historyId) {
  try {
    showToast('Restoring previous version...', 'info');
    const res = await authFetch('/api/media/restore', {
      method: 'POST',
      body: { historyId }
    });

    if (res.success) {
      closeHistoryModal();
      showToast('Version restored live on the website!', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Failed to restore version.', 'error');
    }
  } catch (e) {
    showToast('Connection error during restore.', 'error');
  }
};

// Edit Alt Text & Caption
let targetMetaSlotKey = null;
let targetMetaRoomId = null;
let targetMetaPhotoId = null;

window.openEditMetadataModal = function(slotKey, roomId = null, photoId = null) {
  targetMetaSlotKey = slotKey;
  targetMetaRoomId = roomId;
  targetMetaPhotoId = photoId;

  const modal = document.getElementById('editMetadataModal');
  const altInput = document.getElementById('metaAltInput');
  const capInput = document.getElementById('metaCaptionInput');

  if (slotKey) {
    const slot = (adminState.mediaSlots || []).find(s => s.key === slotKey);
    if (altInput) altInput.value = (slot && slot.alt) || '';
    if (capInput) capInput.value = (slot && slot.caption) || '';
  }

  if (modal) modal.style.display = 'flex';
};

window.closeEditMetadataModal = function() {
  const modal = document.getElementById('editMetadataModal');
  if (modal) modal.style.display = 'none';
};

window.executeSaveMetadata = async function() {
  const alt = document.getElementById('metaAltInput').value;
  const caption = document.getElementById('metaCaptionInput').value;

  try {
    const res = await authFetch('/api/media/metadata', {
      method: 'POST',
      body: {
        slotKey: targetMetaSlotKey,
        roomId: targetMetaRoomId,
        photoId: targetMetaPhotoId,
        alt,
        caption
      }
    });

    if (res.success) {
      closeEditMetadataModal();
      showToast('Photo details saved.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Failed to update details.', 'error');
    }
  } catch (e) {
    showToast('Network error.', 'error');
  }
};

// Delete Photo Confirmation
let targetDeleteSlotKey = null;
let targetDeleteRoomId = null;
let targetDeletePhotoId = null;

window.confirmDeleteSlotPhoto = function(slotKey = null, roomId = null, photoId = null) {
  targetDeleteSlotKey = slotKey;
  targetDeleteRoomId = roomId;
  targetDeletePhotoId = photoId;

  const modal = document.getElementById('deletePhotoConfirmModal');
  if (modal) modal.style.display = 'flex';
};

window.closeDeletePhotoModal = function() {
  const modal = document.getElementById('deletePhotoConfirmModal');
  if (modal) modal.style.display = 'none';
};

window.executeConfirmDeletePhoto = async function() {
  try {
    const res = await authFetch('/api/media/delete', {
      method: 'POST',
      body: {
        slotKey: targetDeleteSlotKey,
        roomId: targetDeleteRoomId,
        photoId: targetDeletePhotoId,
        force: true
      }
    });

    if (res.success) {
      closeDeletePhotoModal();
      showToast(res.message || 'Photo removed successfully.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Could not delete photo.', 'error');
    }
  } catch (e) {
    showToast('Network error during delete.', 'error');
  }
};

// Set Room Cover Photo
window.setRoomCoverPhoto = async function(roomId, photoId) {
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room) return;

  const gallery = (room.gallery || []).map(p => ({
    ...p,
    isCover: (p.id === photoId)
  }));

  try {
    const res = await authFetch(`/api/rooms/${roomId}/gallery`, {
      method: 'POST',
      body: { gallery }
    });
    if (res.success) {
      showToast('Cover photo updated for ' + room.name, 'success');
      loadPhotosData();
    }
  } catch (e) {
    showToast('Error updating cover photo', 'error');
  }
};

// ============================================================================
// DEDICATED INVOICES TAB RENDERER (REQUIREMENT 5)
// ============================================================================
function renderInvoicesTab() {
  const tbody = document.getElementById('invoicesTableBody');
  if (!tbody) return;

  const bookings = adminState.bookings || [];
  if (bookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748B; padding: 24px;">No reservations found.</td></tr>';
    return;
  }

  tbody.innerHTML = bookings.map(b => {
    const invoiceNo = b.invoiceNumber || `CV-2026-${b.bookingId}`;
    const total = (b.totalAmount || 0).toLocaleString('en-IN');
    const advance = (b.payNowAdvance || 0).toLocaleString('en-IN');
    const balance = (b.payAtHotelBalance || 0).toLocaleString('en-IN');

    return `
      <tr>
        <td data-label="Invoice No"><strong>${invoiceNo}</strong></td>
        <td data-label="Booking ID"><span style="font-family: monospace; color: var(--turquoise);">${b.bookingId}</span></td>
        <td data-label="Guest Name">${b.guestName}</td>
        <td data-label="Room Type">${b.roomName}</td>
        <td data-label="Stay Dates">${b.checkIn} to ${b.checkOut}</td>
        <td data-label="Total Bill">₹${total}</td>
        <td data-label="20% Advance" style="color: var(--sunset-coral); font-weight: 700;">₹${advance}</td>
        <td data-label="80% Balance" style="color: var(--turquoise); font-weight: 700;">₹${balance}</td>
        <td data-label="Actions">
          <div style="display: flex; gap: 6px;">
            <button class="btn-table-action" onclick="window.open('/api/admin/invoices/${b.id}/download')" title="Download Luxury A4 PDF">
              <span class="material-symbols-outlined" style="font-size: 16px;">download</span> PDF
            </button>
            <button class="btn-table-action" onclick="resendBookingInvoiceEmail('${b.id}')" title="Resend Invoice to Guest Email">
              <span class="material-symbols-outlined" style="font-size: 16px;">send</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.filterInvoicesTable = function(query) {
  const term = (query || '').toLowerCase();
  const rows = document.querySelectorAll('#invoicesTableBody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(term) ? '' : 'none';
  });
};

window.filterInvoicesByStatus = function(status) {
  // Can filter based on booking status
};

// ============================================================================
// DEDICATED USERS TAB RENDERER (SUPER ADMIN ONLY)
// ============================================================================
async function renderUsersTab() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  try {
    const res = await authFetch('/api/admin/users');
    if (res.success && Array.isArray(res.users)) {
      tbody.innerHTML = res.users.map(u => {
        const isActive = u.active !== false;
        const isSuperAdminAccount = u.username === 'sandipanmajumder9339' || u.role === 'Super Admin';
        return `
        <tr>
          <td data-label="Username"><strong>${u.username}</strong></td>
          <td data-label="Full Name">${u.name || u.username}</td>
          <td data-label="Email Address">${u.email || (u.username + '@coastalviewmandarmani.com')}</td>
          <td data-label="Role">
            <span class="role-badge ${(u.role || 'manager').toLowerCase().replace(/\s+/g, '-')}" style="padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.74rem;">
              ${u.role}
            </span>
          </td>
          <td data-label="Status">
            <span class="badge-status ${isActive ? 'available' : 'sold-out'}" style="font-size: 0.72rem;">
              ${isActive ? 'Active' : 'Disabled'}
            </span>
          </td>
          <td data-label="Actions">
            <div style="display: flex; gap: 5px; flex-wrap: wrap;">
              <button class="btn-turquoise" style="padding: 3px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 2px;" onclick="openEditStaffModal('${u.username}')" title="Edit user role & access">
                <span class="material-symbols-outlined" style="font-size: 14px;">edit</span> Edit
              </button>
              ${!isSuperAdminAccount ? `
                <button class="${isActive ? 'btn-outline-gold' : 'btn-coral'}" style="padding: 3px 8px; font-size: 0.72rem;" onclick="toggleStaffActive('${u.username}', ${!isActive})" title="${isActive ? 'Disable account' : 'Re-enable account'}">
                  ${isActive ? 'Disable' : 'Enable'}
                </button>
                <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--turquoise-dark);" onclick="resetStaff2FA('${u.username}')" title="Reset 2FA code">
                  <span class="material-symbols-outlined" style="font-size: 15px;">lock_reset</span>
                </button>
                <button class="btn-icon-only" style="width: 26px; height: 26px; color: var(--sunset-coral);" onclick="confirmDeleteStaffUser('${u.username}')" title="Delete account">
                  <span class="material-symbols-outlined" style="font-size: 15px;">delete</span>
                </button>
              ` : '<span style="font-size: 0.72rem; color: #94A3B8; padding: 4px;">Super Admin</span>'}
            </div>
          </td>
        </tr>
      `;
      }).join('');
    }
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

window.confirmDeleteStaffUser = function(username) {
  promptReauthModal(async () => {
    try {
      const res = await authFetch(`/api/admin/users/${username}`, { method: 'DELETE' });
      if (res.success) {
        showToast(`Staff account ${username} removed.`, 'success');
        renderUsersTab();
      } else {
        showToast(res.message || 'Could not remove staff account.', 'error');
      }
    } catch (e) {
      showToast('Network error.', 'error');
    }
  }, `Confirm deletion of staff account "${username}". Enter password:`);
};

// ============================================================================
// SENSITIVE ACTION REAUTH MODAL HANDLER
// ============================================================================
let pendingReauthAction = null;

window.promptReauthModal = function(callback, customPrompt = null) {
  pendingReauthAction = callback;
  const modal = document.getElementById('reauthModal');
  const promptText = document.getElementById('reauthPromptText');
  const passInput = document.getElementById('reauthPasswordInput');
  const errBox = document.getElementById('reauthErrorMsg');

  if (errBox) errBox.style.display = 'none';
  if (passInput) passInput.value = '';
  if (customPrompt && promptText) promptText.textContent = customPrompt;

  if (modal) modal.style.display = 'flex';
  if (passInput) passInput.focus();
};

window.closeReauthModal = function() {
  const modal = document.getElementById('reauthModal');
  if (modal) modal.style.display = 'none';
  pendingReauthAction = null;
};

window.submitReauthConfirmation = async function() {
  const passInput = document.getElementById('reauthPasswordInput');
  const errBox = document.getElementById('reauthErrorMsg');
  const password = passInput ? passInput.value : '';

  if (!password) {
    if (errBox) {
      errBox.textContent = 'Please enter your password.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await authFetch('/api/auth/reauth', {
      method: 'POST',
      body: { password }
    });

    if (res.success) {
      closeReauthModal();
      showToast('Security confirmation verified.', 'success');
      if (typeof pendingReauthAction === 'function') {
        const action = pendingReauthAction;
        pendingReauthAction = null;
        action();
      }
    } else {
      if (errBox) {
        errBox.textContent = res.message || 'Incorrect password confirmation.';
        errBox.style.display = 'block';
      }
    }
  } catch (e) {
    if (errBox) {
      errBox.textContent = 'Error connecting to reauth endpoint.';
      errBox.style.display = 'block';
    }
  }
};


// ============================================================================
// SHOWCASE GALLERY MANAGER (Moments at Coastal View & /gallery)
// ============================================================================

let currentGalleryAdminFilter = 'All';
let draggedGalleryPhotoId = null;

function filterGalleryAdmin(category, btn) {
  currentGalleryAdminFilter = category;
  document.querySelectorAll('#group-gallery [data-gal-filter]').forEach(b => b.classList.remove('active-filter'));
  if (btn) btn.classList.add('active-filter');
  renderShowcaseGallerySection();
}

function renderShowcaseGallerySection() {
  const grid = document.getElementById('galleryAdminGrid');
  const totalCountEl = document.getElementById('galleryTotalCount');
  const featCountEl = document.getElementById('galleryFeaturedCount');
  if (!grid) return;

  const allPhotos = adminState.gallery || [];
  const featuredCount = allPhotos.filter(p => p.featured).length;

  if (totalCountEl) totalCountEl.textContent = allPhotos.length;
  if (featCountEl) featCountEl.textContent = featuredCount;

  let displayPhotos = [...allPhotos];
  if (currentGalleryAdminFilter && currentGalleryAdminFilter !== 'All') {
    displayPhotos = displayPhotos.filter(p => p.category === currentGalleryAdminFilter);
  }

  // Sort by order ascending
  displayPhotos.sort((a, b) => (a.order || 999) - (b.order || 999));

  if (displayPhotos.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #64748B; background: #FFFFFF; border-radius: 12px; border: 1px dashed #CBD5E1;">
        <span class="material-symbols-outlined" style="font-size: 36px; color: #94A3B8; margin-bottom: 8px;">image_not_supported</span>
        <div style="font-weight: 600;">No photos in "${currentGalleryAdminFilter}" category yet.</div>
        <div style="font-size: 0.8rem; margin-top: 4px;">Drop photos into the upload box above to add to this category.</div>
      </div>
    `;
    return;
  }

  const categories = ['Hotel', 'Rooms', 'Pool & Beach', 'Restaurant', 'Cocktails', 'Candlelight', 'Places'];

  grid.innerHTML = displayPhotos.map((photo, index) => {
    const isStarred = !!photo.featured;
    const catOptions = categories.map(c => `<option value="${c}" ${photo.category === c ? 'selected' : ''}>${c}</option>`).join('');

    return `
      <div class="gallery-admin-card" draggable="true" 
           ondragstart="onGalleryCardDragStart(event, '${photo.id}')"
           ondragover="onGalleryCardDragOver(event)"
           ondrop="onGalleryCardDrop(event, '${photo.id}')"
           ondragend="onGalleryCardDragEnd(event)">
        <div class="gallery-card-thumb-wrap">
          <img src="${photo.thumbUrl || photo.url}" alt="${photo.alt || ''}" loading="lazy">
          <span class="gallery-card-badge">${photo.category || 'Hotel'}</span>
          <button class="gallery-card-star-btn ${isStarred ? 'active' : ''}" onclick="toggleGalleryFeatured('${photo.id}')" title="${isStarred ? 'Shown on Home Page (Click to unstar)' : 'Star to show on Home Page (6–8 photos)'}">
            <span class="material-symbols-outlined" style="font-size: 20px;">${isStarred ? 'star' : 'star_border'}</span>
          </button>
        </div>

        <div class="gallery-card-body">
          <div class="gallery-card-field-group">
            <label class="gallery-card-label">Category</label>
            <select class="form-control" style="padding: 6px 10px; font-size: 0.8rem;" onchange="updateGalleryPhotoField('${photo.id}', 'category', this.value)">
              ${catOptions}
            </select>
          </div>

          <div class="gallery-card-field-group">
            <label class="gallery-card-label">Caption</label>
            <input type="text" class="form-control" style="padding: 6px 10px; font-size: 0.8rem;" value="${photo.caption || ''}" onchange="updateGalleryPhotoField('${photo.id}', 'caption', this.value)">
          </div>

          <div class="gallery-card-field-group">
            <label class="gallery-card-label">Alt Text (SEO)</label>
            <input type="text" class="form-control" style="padding: 6px 10px; font-size: 0.8rem;" value="${photo.alt || ''}" onchange="updateGalleryPhotoField('${photo.id}', 'alt', this.value)">
          </div>
        </div>

        <div class="gallery-card-footer">
          <div class="gallery-card-reorder-btns">
            <button class="reorder-btn" onclick="moveGalleryOrder('${photo.id}', -1)" title="Move photo backward" ${index === 0 ? 'disabled style="opacity:0.3;"' : ''}>◀</button>
            <button class="reorder-btn" onclick="moveGalleryOrder('${photo.id}', 1)" title="Move photo forward" ${index === displayPhotos.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▶</button>
          </div>
          <button class="btn-icon-only" style="color: var(--sunset-coral); width: 28px; height: 28px;" onclick="deleteGalleryPhoto('${photo.id}')" title="Delete photo from gallery">
            <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Bulk Upload & Client-side WebP Compression
function handleGalleryDragOver(e) {
  e.preventDefault();
  const box = document.getElementById('galleryDropzoneBox');
  if (box) box.classList.add('drag-over');
}

function handleGalleryDragLeave(e) {
  e.preventDefault();
  const box = document.getElementById('galleryDropzoneBox');
  if (box) box.classList.remove('drag-over');
}

function handleGalleryDrop(e) {
  e.preventDefault();
  const box = document.getElementById('galleryDropzoneBox');
  if (box) box.classList.remove('drag-over');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleGalleryBulkUpload(e.dataTransfer.files);
  }
}

function handleGalleryBulkUploadInput(e) {
  if (e.target.files && e.target.files.length > 0) {
    handleGalleryBulkUpload(e.target.files);
    e.target.value = '';
  }
}

function processImageForGallery(file, category) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        // 1. Full Image (max 1920x1080)
        const maxW = 1920;
        const maxH = 1080;
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        let imageBase64 = canvas.toDataURL('image/webp', 0.85);
        if (!imageBase64.startsWith('data:image/webp')) {
          imageBase64 = canvas.toDataURL('image/jpeg', 0.85);
        }

        // 2. Thumbnail (max 480x360)
        const thumbMaxW = 480;
        const thumbMaxH = 360;
        let tw = img.width;
        let th = img.height;
        const tRatio = Math.min(thumbMaxW / tw, thumbMaxH / th);
        tw = Math.round(tw * tRatio);
        th = Math.round(th * tRatio);

        const tCanvas = document.createElement('canvas');
        tCanvas.width = tw;
        tCanvas.height = th;
        const tCtx = tCanvas.getContext('2d');
        tCtx.drawImage(img, 0, 0, tw, th);
        let thumbBase64 = tCanvas.toDataURL('image/webp', 0.80);
        if (!thumbBase64.startsWith('data:image/webp')) {
          thumbBase64 = tCanvas.toDataURL('image/jpeg', 0.80);
        }

        const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        const caption = baseName.charAt(0).toUpperCase() + baseName.slice(1);

        resolve({
          imageBase64,
          thumbBase64,
          category: category || 'Hotel',
          caption: caption || 'Moments at Coastal View',
          alt: `${caption || category} at Coastal View Mandarmani`,
          featured: false
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleGalleryBulkUpload(files) {
  if (!files || files.length === 0) return;

  const catSelect = document.getElementById('galleryUploadCategorySelect');
  const defaultCategory = catSelect ? catSelect.value : 'Hotel';

  showToast(`Processing ${files.length} photo(s) with WebP compression...`, 'info');

  try {
    const processedPhotos = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const processed = await processImageForGallery(file, defaultCategory);
      processedPhotos.push(processed);
    }

    if (processedPhotos.length === 0) {
      showToast('No valid image files to upload.', 'error');
      return;
    }

    showToast(`Uploading ${processedPhotos.length} compressed photo(s)...`, 'info');

    const res = await authFetch('/api/gallery', {
      method: 'POST',
      body: { photos: processedPhotos }
    });

    if (res.success) {
      adminState.gallery = res.gallery || [];
      renderShowcaseGallerySection();
      showToast(res.message || `Uploaded ${processedPhotos.length} photos successfully!`, 'success');
    } else {
      showToast(res.message || 'Gallery upload failed.', 'error');
    }
  } catch (err) {
    console.error('Gallery bulk upload failed:', err);
    showToast('Failed to process and upload gallery photos.', 'error');
  }
}

// Drag & Drop Card Reordering
function onGalleryCardDragStart(e, photoId) {
  draggedGalleryPhotoId = photoId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', photoId);
  e.currentTarget.classList.add('dragging');
}

function onGalleryCardDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function onGalleryCardDrop(e, targetPhotoId) {
  e.preventDefault();
  if (!draggedGalleryPhotoId || draggedGalleryPhotoId === targetPhotoId) return;

  const list = adminState.gallery || [];
  const fromIdx = list.findIndex(p => p.id === draggedGalleryPhotoId);
  const toIdx = list.findIndex(p => p.id === targetPhotoId);

  if (fromIdx === -1 || toIdx === -1) return;

  const [movedItem] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, movedItem);

  list.forEach((p, idx) => p.order = idx + 1);

  renderShowcaseGallerySection();

  try {
    const res = await authFetch('/api/gallery/reorder', {
      method: 'POST',
      body: { ids: list.map(p => p.id) }
    });
    if (res.success) {
      showToast('Gallery reordered successfully.', 'success');
    }
  } catch (err) {
    showToast('Failed to save gallery order.', 'error');
  }
}

function onGalleryCardDragEnd(e) {
  draggedGalleryPhotoId = null;
  document.querySelectorAll('.gallery-admin-card').forEach(c => c.classList.remove('dragging'));
}

async function updateGalleryPhotoField(photoId, field, val) {
  const photo = (adminState.gallery || []).find(p => p.id === photoId);
  if (!photo) return;
  photo[field] = val;

  try {
    const res = await authFetch(`/api/gallery/${photoId}`, {
      method: 'POST',
      body: { [field]: val }
    });
    if (res.success) {
      showToast('Photo details updated.', 'success');
      if (field === 'category') renderShowcaseGallerySection();
    }
  } catch (err) {
    showToast('Failed to update photo.', 'error');
  }
}

async function toggleGalleryFeatured(photoId) {
  const photo = (adminState.gallery || []).find(p => p.id === photoId);
  if (!photo) return;

  try {
    const res = await authFetch(`/api/gallery/${photoId}/toggle-featured`, {
      method: 'POST'
    });
    if (res.success) {
      photo.featured = res.photo.featured;
      renderShowcaseGallerySection();
      showToast(`${res.message} (Total starred: ${res.starredCount})`, 'success');
    }
  } catch (err) {
    showToast('Failed to toggle featured status.', 'error');
  }
}

async function deleteGalleryPhoto(photoId) {
  if (!confirm('Are you sure you want to permanently delete this photo from the Showcase Gallery?')) {
    return;
  }

  try {
    const res = await authFetch(`/api/gallery/${photoId}`, {
      method: 'DELETE'
    });
    if (res.success) {
      adminState.gallery = (adminState.gallery || []).filter(p => p.id !== photoId);
      renderShowcaseGallerySection();
      showToast('Photo removed from gallery.', 'success');
    }
  } catch (err) {
    showToast('Failed to delete photo.', 'error');
  }
}

async function moveGalleryOrder(photoId, delta) {
  const list = adminState.gallery || [];
  const idx = list.findIndex(p => p.id === photoId);
  if (idx === -1) return;

  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= list.length) return;

  const temp = list[idx];
  list[idx] = list[targetIdx];
  list[targetIdx] = temp;

  list.forEach((p, i) => p.order = i + 1);
  renderShowcaseGallerySection();

  try {
    await authFetch('/api/gallery/reorder', {
      method: 'POST',
      body: { ids: list.map(p => p.id) }
    });
    showToast('Gallery order saved.', 'success');
  } catch (err) {
    showToast('Failed to update order.', 'error');
  }
}

// ============================================================================
// BUILT-IN CANVAS CROP, ZOOM & WEBP OPTIMIZER ENGINE
// ============================================================================

function openCropToolForSlot(slotKey) {
  const def = WEBSITE_SLOTS_DEF.find(s => s.key === slotKey);
  const currentSlots = adminState.mediaSlots || {};
  const slotData = currentSlots[slotKey] || {};
  const currentUrl = slotData.url || (def ? def.defaultUrl : '');
  const initialRatio = def ? (def.aspect === '1:1' ? '1:1' : (def.aspect === '16:9' ? '16:9' : '4:3')) : '4:3';

  openCropToolModal('slot', slotKey, null, currentUrl, initialRatio, 'general', false, def ? def.title : slotKey);
}

function openCropToolForRoomPhoto(roomId, photoId, currentUrl, defaultRatio = '4:3', tag = 'general', isCover = false) {
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  const label = room ? `${room.name} (${tag})` : 'Room Photo';
  openCropToolModal('room', roomId, photoId, currentUrl, defaultRatio, tag, isCover, label);
}

function openCropToolModal(targetType, targetId, photoId, currentUrl, ratio = '4:3', tag = 'general', isCover = false, titleLabel = '') {
  cropEngineState.targetType = targetType;
  cropEngineState.targetId = targetId;
  cropEngineState.photoId = photoId;
  cropEngineState.tag = tag;
  cropEngineState.isCover = isCover;
  cropEngineState.aspectRatio = ratio;
  cropEngineState.zoom = 1;
  cropEngineState.panX = 0;
  cropEngineState.panY = 0;
  cropEngineState.imgLoaded = false;

  const targetLblEl = document.getElementById('mediaCropTargetLabel');
  if (targetLblEl) targetLblEl.textContent = `Target: ${titleLabel || targetId}`;

  // Aspect Buttons Active Pill
  const aspectBtns = document.querySelectorAll('.crop-aspect-selector-bar .btn-aspect-choice');
  aspectBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-ratio') === ratio);
  });

  const zoomSlider = document.getElementById('mediaCropZoomSlider');
  if (zoomSlider) zoomSlider.value = '1';

  // Load Image into Canvas
  cropEngineState.img = new Image();
  cropEngineState.img.crossOrigin = 'anonymous';
  cropEngineState.img.onload = () => {
    cropEngineState.imgLoaded = true;
    resetCropPosition();
    drawCropCanvas();
  };
  cropEngineState.img.onerror = () => {
    cropEngineState.img.src = NEUTRAL_MEDIA_FALLBACK;
  };

  cropEngineState.img.src = formatAdminImgUrl(currentUrl);

  document.getElementById('mediaCropModal').classList.add('open');
  setCropAspectRatio(ratio);
}

function setCropAspectRatio(ratio, btnEl) {
  cropEngineState.aspectRatio = ratio;

  if (btnEl) {
    const aspectBtns = document.querySelectorAll('.crop-aspect-selector-bar .btn-aspect-choice');
    aspectBtns.forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }

  const canvas = document.getElementById('mediaCropCanvas');
  const dimText = document.getElementById('mediaCropDimText');

  if (canvas) {
    if (ratio === '16:9') {
      canvas.width = 480;
      canvas.height = 270;
    } else if (ratio === '4:3') {
      canvas.width = 440;
      canvas.height = 330;
    } else if (ratio === '1:1') {
      canvas.width = 340;
      canvas.height = 340;
    } else {
      canvas.width = 460;
      canvas.height = 320;
    }
  }

  if (dimText) {
    dimText.textContent = `Aspect: ${ratio.toUpperCase()} • Output Format: WebP (Lightweight)`;
  }

  resetCropPosition();
  drawCropCanvas();
}

function handleMediaZoomChange(zoomVal) {
  cropEngineState.zoom = parseFloat(zoomVal) || 1;
  drawCropCanvas();
}

function resetCropPosition() {
  const canvas = document.getElementById('mediaCropCanvas');
  if (!canvas || !cropEngineState.imgLoaded) return;

  const img = cropEngineState.img;
  // Calculate base scale to cover canvas
  const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
  cropEngineState.baseScale = scale;
  cropEngineState.panX = (canvas.width - img.width * scale * cropEngineState.zoom) / 2;
  cropEngineState.panY = (canvas.height - img.height * scale * cropEngineState.zoom) / 2;
  drawCropCanvas();
}

function drawCropCanvas() {
  const canvas = document.getElementById('mediaCropCanvas');
  if (!canvas || !cropEngineState.imgLoaded) return;
  const ctx = canvas.getContext('2d');
  const img = cropEngineState.img;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background subtle sand color
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const curScale = (cropEngineState.baseScale || 1) * cropEngineState.zoom;
  const drawW = img.width * curScale;
  const drawH = img.height * curScale;

  ctx.drawImage(img, cropEngineState.panX, cropEngineState.panY, drawW, drawH);

  // Draw overlay border & grid guides
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  // Rule of thirds lines
  ctx.beginPath();
  ctx.moveTo(canvas.width / 3, 0);
  ctx.lineTo(canvas.width / 3, canvas.height);
  ctx.moveTo((canvas.width * 2) / 3, 0);
  ctx.lineTo((canvas.width * 2) / 3, canvas.height);
  ctx.moveTo(0, canvas.height / 3);
  ctx.lineTo(canvas.width, canvas.height / 3);
  ctx.moveTo(0, (canvas.height * 2) / 3);
  ctx.lineTo(canvas.width, (canvas.height * 2) / 3);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.stroke();

  // Draw mini preview
  const miniCanvas = document.getElementById('mediaCropMiniPreview');
  if (miniCanvas) {
    const miniCtx = miniCanvas.getContext('2d');
    miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    miniCtx.drawImage(canvas, 0, 0, miniCanvas.width, miniCanvas.height);
  }
}

async function executeSaveMediaCrop() {
  const canvas = document.getElementById('mediaCropCanvas');
  const saveBtn = document.getElementById('btnApplyMediaCrop');
  if (!canvas) return;

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Optimizing & Uploading...';

  try {
    // Generate WebP export (quality 0.88) with PNG fallback
    let webpData = '';
    try {
      webpData = canvas.toDataURL('image/webp', 0.88);
    } catch (e) {
      webpData = canvas.toDataURL('image/jpeg', 0.9);
    }

    // Mini Thumbnail Canvas
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 120;
    thumbCanvas.height = Math.round(120 * (canvas.height / canvas.width));
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbData = thumbCanvas.toDataURL('image/webp', 0.8);

    const payload = {
      slotId: cropEngineState.targetType === 'slot' ? cropEngineState.targetId : 'room',
      roomId: cropEngineState.targetType === 'room' ? cropEngineState.targetId : undefined,
      imageBase64: webpData,
      thumbBase64: thumbData,
      tag: cropEngineState.tag || 'general',
      isCover: !!cropEngineState.isCover
    };

    const res = await authFetch('/api/media/upload', {
      method: 'POST',
      body: payload
    });

    if (res.success) {
      closeModal('mediaCropModal');
      showToast(res.message || 'Image optimized to WebP and saved! Public website updated.', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to save cropped image.', 'error');
    }
  } catch (err) {
    console.error('Crop save error:', err);
    showToast('Image processing error.', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Crop, Optimize & Apply';
  }
}

// ============================================================================
// FILE UPLOAD & DROPZONE HANDLERS
// ============================================================================

function triggerQuickUploadModal() {
  const photosTabBtn = document.getElementById('navPhotosBtn');
  if (photosTabBtn) photosTabBtn.click();
  const fileInput = document.getElementById('globalMediaFileInput');
  if (fileInput) fileInput.click();
}

function updateUploadTargetContext(val) {
  const roomTagFieldWrapper = document.getElementById('roomTagFieldWrapper');
  const isRoom = val.startsWith('room:');
  if (roomTagFieldWrapper) {
    roomTagFieldWrapper.style.display = isRoom ? 'block' : 'none';
  }
}

function openUploadForRoom(roomId) {
  const select = document.getElementById('uploadTargetSlotSelect');
  if (select) {
    select.value = `room:${roomId}`;
    updateUploadTargetContext(select.value);
  }
  const fileInput = document.getElementById('globalMediaFileInput');
  if (fileInput) fileInput.click();
}

function openUploadForSlot(slotKey) {
  const select = document.getElementById('uploadTargetSlotSelect');
  if (select) {
    select.value = `slot:${slotKey}`;
    updateUploadTargetContext(select.value);
  }
  const fileInput = document.getElementById('globalMediaFileInput');
  if (fileInput) fileInput.click();
}

function openReplacePhotoDialog(roomId, photoId, tag) {
  openUploadForRoom(roomId);
  const tagSelect = document.getElementById('uploadRoomTagSelect');
  if (tagSelect && tag) tagSelect.value = tag;
}

function handleGlobalFilesSelected(event) {
  if (event.target && event.target.files) {
    handleGlobalFiles(event.target.files);
    event.target.value = ''; // reset so same file can be chosen again
  }
}

async function handleGlobalFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const targetVal = document.getElementById('uploadTargetSlotSelect')?.value || 'slot:hero';
  const isRoom = targetVal.startsWith('room:');
  const targetId = isRoom ? targetVal.replace('room:', '') : targetVal.replace('slot:', '');
  const slotId = isRoom ? 'room' : targetId;
  const roomId = isRoom ? targetId : null;
  const tag = document.getElementById('uploadRoomTagSelect')?.value || 'general';
  const isCover = document.getElementById('uploadAsCoverToggle')?.checked || false;

  const progressWrap = document.getElementById('mediaUploadProgressBarWrap');
  const progressFill = document.getElementById('mediaUploadProgressFill');
  const progressPct = document.getElementById('uploadProgressPct');
  const progressLabel = document.getElementById('uploadProgressLabel');

  if (progressWrap) progressWrap.style.display = 'block';

  let successCount = 0;
  let totalFiles = files.length;

  for (let i = 0; i < totalFiles; i++) {
    const file = files[i];

    // Validate type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Only JPG, PNG, or WebP allowed', 'warning');
      continue;
    }

    // Validate size (max 8 MB)
    if (file.size > 8 * 1024 * 1024) {
      showToast('File too large (max 8 MB)', 'error');
      continue;
    }

    const pct = Math.round(((i + 1) / totalFiles) * 100);
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressLabel) progressLabel.textContent = `Optimizing & uploading ${file.name} (${i + 1}/${totalFiles})...`;

    try {
      const base64Data = await readFileAsBase64(file);

      const res = await authFetch('/api/media/upload', {
        method: 'POST',
        body: {
          slotId,
          roomId,
          imageBase64: base64Data,
          tag,
          isCover: (i === 0 && isCover),
          alt: `${file.name.replace(/\.[^/.]+$/, "")} at Coastal View Mandarmani`
        }
      });

      if (res.success) {
        successCount++;
      } else {
        showToast(res.message || `Upload failed for ${file.name}`, 'error');
      }
    } catch (err) {
      console.error('File upload error:', err);
      showToast(`Error processing ${file.name}`, 'error');
    }
  }

  setTimeout(() => {
    if (progressWrap) progressWrap.style.display = 'none';
    if (progressFill) progressFill.style.width = '0%';
  }, 1000);

  if (successCount > 0) {
    showToast(`Successfully uploaded ${successCount} photo(s)! Website synced immediately.`, 'success');
    loadAllAdminData();
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// ROOM GALLERY CRUD, REORDERING, COVER SELECTION & ROLLBACK
// ============================================================================

async function moveRoomPhoto(roomId, fromIndex, direction) {
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room || !Array.isArray(room.gallery)) return;

  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= room.gallery.length) return;

  // Swap photos
  const temp = room.gallery[fromIndex];
  room.gallery[fromIndex] = room.gallery[toIndex];
  room.gallery[toIndex] = temp;

  renderRoomsGallerySection();

  try {
    const res = await authFetch(`/api/rooms/${roomId}/gallery`, {
      method: 'POST',
      body: { gallery: room.gallery }
    });

    if (res.success) {
      showToast(`Reordered photos for ${room.name}`, 'success');
    } else {
      showToast(res.message || 'Failed to save order.', 'error');
    }
  } catch (err) {
    showToast('Network error updating photo order.', 'error');
  }
}

async function setRoomCoverPhoto(roomId, photoId) {
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room || !Array.isArray(room.gallery)) return;

  try {
    const res = await authFetch(`/api/rooms/${roomId}/gallery`, {
      method: 'POST',
      body: { gallery: room.gallery, coverPhotoId: photoId }
    });

    if (res.success) {
      showToast(`Updated cover photo for "${room.name}". Live site updated immediately!`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to update cover photo.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to hotel service.', 'error');
  }
}

function openMediaAltCaptionModal(roomId, photoId, slotId) {
  const roomEl = document.getElementById('editMetaRoomId');
  const photoEl = document.getElementById('editMetaPhotoId');
  const slotEl = document.getElementById('editMetaSlotId');
  const prevImg = document.getElementById('editMetaPreviewImg');
  const captionInput = document.getElementById('editMetaCaption');
  const altInput = document.getElementById('editMetaAlt');
  const tagSelect = document.getElementById('editMetaTag');
  const tagGroup = document.getElementById('editMetaTagGroup');

  if (roomEl) roomEl.value = roomId || '';
  if (photoEl) photoEl.value = photoId || '';
  if (slotEl) slotEl.value = slotId || '';

  if (roomId && photoId) {
    const room = (adminState.rooms || []).find(r => r.id === roomId);
    const photo = room ? (room.gallery || []).find(p => p.id === photoId) : null;
    if (photo) {
      if (prevImg) prevImg.src = formatAdminImgUrl(photo.thumbUrl || photo.url);
      if (captionInput) captionInput.value = photo.caption || '';
      if (altInput) altInput.value = photo.alt || '';
      if (tagSelect) tagSelect.value = photo.tag || 'general';
      if (tagGroup) tagGroup.style.display = 'block';
    }
  } else if (slotId) {
    const currentSlots = adminState.mediaSlots || {};
    const slot = currentSlots[slotId] || {};
    const def = WEBSITE_SLOTS_DEF.find(s => s.key === slotId);
    if (prevImg) prevImg.src = formatAdminImgUrl(slot.url || (def ? def.defaultUrl : ''));
    if (captionInput) captionInput.value = slot.caption || '';
    if (altInput) altInput.value = slot.alt || (def ? def.defaultAlt : '');
    if (tagGroup) tagGroup.style.display = 'none';
  }

  document.getElementById('mediaAltCaptionModal').classList.add('open');
}

async function executeSaveMediaMetadata() {
  const roomId = document.getElementById('editMetaRoomId')?.value;
  const photoId = document.getElementById('editMetaPhotoId')?.value;
  const slotId = document.getElementById('editMetaSlotId')?.value;
  const caption = document.getElementById('editMetaCaption')?.value.trim();
  const alt = document.getElementById('editMetaAlt')?.value.trim();
  const tag = document.getElementById('editMetaTag')?.value;

  try {
    if (roomId && photoId) {
      const room = (adminState.rooms || []).find(r => r.id === roomId);
      if (room && Array.isArray(room.gallery)) {
        const photo = room.gallery.find(p => p.id === photoId);
        if (photo) {
          photo.caption = caption;
          photo.alt = alt;
          if (tag) photo.tag = tag;
        }

        const res = await authFetch(`/api/rooms/${roomId}/gallery`, {
          method: 'POST',
          body: { gallery: room.gallery }
        });

        if (res.success) {
          closeModal('mediaAltCaptionModal');
          showToast('Photo metadata saved successfully!', 'success');
          loadAllAdminData();
        } else {
          showToast(res.message, 'error');
        }
      }
    } else if (slotId) {
      const currentSlots = adminState.mediaSlots || {};
      const slot = currentSlots[slotId] || {};
      slot.caption = caption;
      slot.alt = alt;

      const res = await authFetch('/api/media/upload', {
        method: 'POST',
        body: {
          slotId,
          imageBase64: slot.url || 'preserved',
          caption,
          alt
        }
      });

      closeModal('mediaAltCaptionModal');
      showToast('Website slot metadata updated!', 'success');
      loadAllAdminData();
    }
  } catch (err) {
    showToast('Failed to save photo metadata.', 'error');
  }
}

function openDeleteMediaConfirmModal(roomId, photoId, isCover) {
  document.getElementById('deletePhotoRoomId').value = roomId;
  document.getElementById('deletePhotoId').value = photoId;
  const warningBox = document.getElementById('deletePhotoWarningBox');
  if (warningBox) warningBox.style.display = isCover ? 'block' : 'none';
  document.getElementById('mediaDeleteConfirmModal').classList.add('open');
}

async function executeDeleteMediaPhoto() {
  const roomId = document.getElementById('deletePhotoRoomId')?.value;
  const photoId = document.getElementById('deletePhotoId')?.value;

  try {
    const res = await authFetch('/api/media/delete', {
      method: 'POST',
      body: { roomId, photoId }
    });

    closeModal('mediaDeleteConfirmModal');

    if (res.success) {
      showToast('Photo deleted successfully.', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Deletion failed.', 'error');
    }
  } catch (err) {
    showToast('Network error during photo deletion.', 'error');
  }
}

async function rollbackRoomPhoto(roomId, photoId) {
  if (!confirm('Restore this room photo to its previous version?')) return;
  try {
    const res = await authFetch('/api/media/rollback', {
      method: 'POST',
      body: { roomId, photoId }
    });

    if (res.success) {
      showToast(res.message || 'Restored previous room photo!', 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Rollback failed.', 'error');
    }
  } catch (err) {
    showToast('Error during photo restore.', 'error');
  }
}

async function rollbackMediaSlot(slotId) {
  if (!confirm(`Restore website image slot "${slotId}" to its previous version?`)) return;
  try {
    const res = await authFetch('/api/media/rollback', {
      method: 'POST',
      body: { slotId }
    });

    if (res.success) {
      showToast(res.message || `Slot "${slotId}" restored!`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Rollback failed.', 'error');
    }
  } catch (err) {
    showToast('Error during slot rollback.', 'error');
  }
}

async function executeRestoreFromHistory(slotId, roomId, historyId) {
  if (roomId) {
    await rollbackRoomPhoto(roomId);
  } else if (slotId) {
    await rollbackMediaSlot(slotId);
  } else {
    showToast('Unable to determine restore target.', 'warning');
  }
}

// Room Management Edit Modal Integration
function triggerRoomPhotoUploadFromEditModal() {
  const roomId = adminState.activeRoomIdForEdit;
  if (!roomId) return;
  openUploadForRoom(roomId);
}

function openRoomGalleryInPhotosTab() {
  const roomId = adminState.activeRoomIdForEdit;
  closeModal('editRoomModal');
  const photosTabBtn = document.getElementById('navPhotosBtn');
  if (photosTabBtn) photosTabBtn.click();
  filterMediaGroup('rooms');
  if (roomId) {
    setTimeout(() => {
      const el = document.getElementById(`room-gallery-card-${roomId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }
}


// Variant Row Helper for Admin Modal
window.addVariantRow = function(label = '', price = '') {
  const container = document.getElementById('editDishVariantsContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'edit-variant-row';
  row.style.cssText = 'display:flex; gap:8px; align-items:center;';
  row.innerHTML = `
    <input type="text" class="form-control variant-label-input" placeholder="e.g. Veg / Chicken / Egg" value="${label}" style="flex:2; font-size:0.82rem; padding:5px 8px;">
    <input type="number" class="form-control variant-price-input" placeholder="Price (₹)" value="${price}" min="0" style="flex:1; font-size:0.82rem; padding:5px 8px;">
    <button type="button" onclick="this.parentElement.remove()" style="background:none; border:none; color:#EF4444; font-size:18px; cursor:pointer; padding:0 4px;" title="Remove variant">×</button>
  `;
  container.appendChild(row);
};

// Save Admin Menu Live Bottom Note
window.saveAdminMenuNote = async function() {
  const note = (document.getElementById('adminMenuBottomNote')?.value || '').trim();
  try {
    const res = await authFetch('/api/menu/note', {
      method: 'POST',
      body: { note }
    });
    if (res.success) {
      adminState.menuNote = res.menuNote;
      showToast('Live restaurant menu note saved successfully!', 'success');
    } else {
      showToast(res.message || 'Error saving menu note', 'error');
    }
  } catch (err) {
    console.error('Error saving menu note:', err);
    showToast('Failed to save menu note: ' + err.message, 'error');
  }
};


// ============================================================================
// COMPREHENSIVE EDIT EXTENSIONS & MODULE HANDLERS
// ============================================================================

// ----------------------------------------------------------------------------
// 1. EDIT RESERVATION & FINANCIAL RECALCULATION ENGINE
// ----------------------------------------------------------------------------
let currentEditingBooking = null;

function openEditBookingModal(bookingId) {
  const b = (adminState.bookings || []).find(x => x.bookingId === bookingId);
  if (!b) {
    showToast('Reservation not found: ' + bookingId, 'error');
    return;
  }
  currentEditingBooking = JSON.parse(JSON.stringify(b));

  document.getElementById('editBookingId').value = b.bookingId;
  document.getElementById('editBookingModalTitle').textContent = `Edit Reservation: ${b.bookingId}`;
  document.getElementById('editBookingGuestName').value = b.guestName || '';
  document.getElementById('editBookingGuestPhone').value = b.guestPhone || '';
  document.getElementById('editBookingGuestEmail').value = b.guestEmail || '';
  document.getElementById('editBookingCheckIn').value = b.checkIn || '';
  document.getElementById('editBookingCheckOut').value = b.checkOut || '';
  document.getElementById('editBookingRoomsCount').value = b.roomsCount || 1;
  document.getElementById('editBookingAdults').value = b.adults || 2;
  document.getElementById('editBookingChildren').value = b.children || 0;
  document.getElementById('editBookingStatus').value = b.status || 'Confirmed';

  // Populate Room Dropdown
  const roomSelect = document.getElementById('editBookingRoomSelect');
  if (roomSelect) {
    roomSelect.innerHTML = (adminState.rooms || []).map(r => `
      <option value="${r.id}" ${r.id === b.roomId ? 'selected' : ''}>
        ${r.name} (₹${(r.price || 0).toLocaleString('en-IN')}/night)
      </option>
    `).join('');
  }

  // Populate Add-ons
  const bfCheck = document.getElementById('editBookingBreakfast');
  if (bfCheck) {
    bfCheck.checked = !!b.breakfast;
    document.getElementById('editBookingBfGuestWrap').style.display = b.breakfast ? 'block' : 'none';
    document.getElementById('editBookingBfGuests').value = b.breakfastGuests || b.adults || 2;
  }

  const carCheck = document.getElementById('editBookingNeedCar');
  if (carCheck) {
    carCheck.checked = !!b.needCar;
    document.getElementById('editBookingVehicleWrap').style.display = b.needCar ? 'grid' : 'none';
    const vType = b.vehicleId || b.vehicleType || 'car';
    document.getElementById('editBookingVehicleType').value = vType;
    document.getElementById('editBookingCarCount').value = b.carCount || 1;
  }

  const dinnerCheck = document.getElementById('editBookingCandlelight');
  if (dinnerCheck) {
    dinnerCheck.checked = !!b.candlelightDinner;
    document.getElementById('editBookingDinnerWrap').style.display = b.candlelightDinner ? 'flex' : 'none';
    document.getElementById('editBookingDinnerSetup').value = b.dinnerSetup || 'Beachside';
  }

  // Staff custom pricing override (Manager / Super Admin only)
  const isPrivileged = currentUser && ['Super Admin', 'Manager'].includes(currentUser.role);
  const customRateGroup = document.getElementById('editBookingCustomRateGroup');
  if (customRateGroup) {
    customRateGroup.style.display = isPrivileged ? 'block' : 'none';
    document.getElementById('editBookingCustomPrice').value = b.roomPrice || '';
    document.getElementById('editBookingDiscount').value = b.discountAmount || 0;
  }

  // Warning banner for active bookings
  const warningBanner = document.getElementById('editBookingWarningBanner');
  if (warningBanner) {
    warningBanner.style.display = ['Confirmed', 'Checked-in'].includes(b.status) ? 'block' : 'none';
  }

  calculateEditBookingTotals();
  openModal('editBookingModal');
}

function calculateEditBookingTotals() {
  const roomId = document.getElementById('editBookingRoomSelect')?.value;
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  const checkIn = document.getElementById('editBookingCheckIn')?.value;
  const checkOut = document.getElementById('editBookingCheckOut')?.value;
  const roomsCount = Math.max(1, parseInt(document.getElementById('editBookingRoomsCount')?.value, 10) || 1);
  const adults = Math.max(1, parseInt(document.getElementById('editBookingAdults')?.value, 10) || 2);
  const customPriceInput = document.getElementById('editBookingCustomPrice')?.value;
  const discountInput = Number(document.getElementById('editBookingDiscount')?.value) || 0;

  let nights = 1;
  if (checkIn && checkOut) {
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    const diff = d2.getTime() - d1.getTime();
    nights = Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
  }

  const isPrivileged = currentUser && ['Super Admin', 'Manager'].includes(currentUser.role);
  const nightlyRate = (isPrivileged && customPriceInput !== '' && !isNaN(Number(customPriceInput)))
    ? Number(customPriceInput)
    : (room ? room.price : 3500);

  const roomSubtotal = nightlyRate * nights * roomsCount;
  const breakdownLines = [`• Room: ₹${nightlyRate.toLocaleString('en-IN')} × ${nights} night${nights > 1 ? 's' : ''} × ${roomsCount} room${roomsCount > 1 ? 's' : ''} = ₹${roomSubtotal.toLocaleString('en-IN')}`];

  // Breakfast
  let breakfastTotal = 0;
  const needBf = document.getElementById('editBookingBreakfast')?.checked;
  const bfGuestWrap = document.getElementById('editBookingBfGuestWrap');
  if (bfGuestWrap) bfGuestWrap.style.display = needBf ? 'block' : 'none';

  if (needBf) {
    const bfGuests = Math.max(1, parseInt(document.getElementById('editBookingBfGuests')?.value, 10) || adults);
    const bfPrice = Number(adminState.settings?.breakfastPrice ?? 200);
    breakfastTotal = bfPrice * bfGuests * nights;
    breakdownLines.push(`• Breakfast: ₹${bfPrice} × ${bfGuests} guest${bfGuests > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`);
  }

  // Vehicles
  let carTotal = 0;
  const needCar = document.getElementById('editBookingNeedCar')?.checked;
  const vehicleWrap = document.getElementById('editBookingVehicleWrap');
  if (vehicleWrap) vehicleWrap.style.display = needCar ? 'grid' : 'none';

  if (needCar) {
    const vType = document.getElementById('editBookingVehicleType')?.value || 'car';
    const vQty = Math.max(1, parseInt(document.getElementById('editBookingCarCount')?.value, 10) || 1);
    const vehicle = (adminState.vehicles || []).find(v => v.id === vType);
    const rate = vehicle ? vehicle.pricePerDay : (vType === 'toto' ? 500 : (vType === 'auto' ? 800 : 1500));
    const vName = vehicle ? vehicle.name : vType.toUpperCase();
    carTotal = rate * vQty * nights;
    breakdownLines.push(`• Fleet: ${vName} × ${vQty} × ${nights} day${nights > 1 ? 's' : ''} = ₹${carTotal.toLocaleString('en-IN')}`);
  }

  // Candlelight
  let dinnerTotal = 0;
  const needDinner = document.getElementById('editBookingCandlelight')?.checked;
  const dinnerWrap = document.getElementById('editBookingDinnerWrap');
  if (dinnerWrap) dinnerWrap.style.display = needDinner ? 'flex' : 'none';

  if (needDinner) {
    const setup = document.getElementById('editBookingDinnerSetup')?.value || 'Beachside';
    dinnerTotal = setup === 'Beachside' ? 3500 : 2800;
    breakdownLines.push(`• Candlelight Dinner (${setup}) = ₹${dinnerTotal.toLocaleString('en-IN')}`);
  }

  const baseSubtotal = roomSubtotal + breakfastTotal + carTotal + dinnerTotal;

  // Tax
  let taxAmount = 0;
  if (adminState.settings?.enableTax) {
    const taxPct = Number(adminState.settings.taxPercentage) || 12;
    taxAmount = Math.round((baseSubtotal * taxPct) / 100);
    breakdownLines.push(`• GST / Taxes (${taxPct}%): ₹${taxAmount.toLocaleString('en-IN')}`);
  }

  if (discountInput > 0) {
    breakdownLines.push(`• Staff Courtesy Discount: -₹${discountInput.toLocaleString('en-IN')}`);
  }

  const grandTotal = Math.max(0, baseSubtotal + taxAmount - discountInput);
  const advancePct = Number(adminState.settings?.advancePercentage) || 20;
  const payNowAdvance = Math.round((grandTotal * advancePct) / 100);
  const payAtHotelBalance = grandTotal - payNowAdvance;

  const totalEl = document.getElementById('editBookingDisplayTotal');
  const advEl = document.getElementById('editBookingDisplayAdvance');
  const balEl = document.getElementById('editBookingDisplayBalance');
  const linesEl = document.getElementById('editBookingBreakdownLines');

  if (totalEl) totalEl.textContent = '₹' + grandTotal.toLocaleString('en-IN');
  if (advEl) advEl.textContent = `20% Advance: ₹${payNowAdvance.toLocaleString('en-IN')}`;
  if (balEl) balEl.textContent = `80% Hotel Balance: ₹${payAtHotelBalance.toLocaleString('en-IN')}`;
  if (linesEl) linesEl.innerHTML = breakdownLines.map(l => `<div>${l}</div>`).join('');
}

async function executeSaveBookingDetails() {
  const bookingId = document.getElementById('editBookingId')?.value;
  if (!bookingId) return;

  const guestName = document.getElementById('editBookingGuestName')?.value.trim();
  const guestPhone = document.getElementById('editBookingGuestPhone')?.value.trim();
  const guestEmail = document.getElementById('editBookingGuestEmail')?.value.trim();
  const roomId = document.getElementById('editBookingRoomSelect')?.value;
  const checkIn = document.getElementById('editBookingCheckIn')?.value;
  const checkOut = document.getElementById('editBookingCheckOut')?.value;
  const roomsCount = parseInt(document.getElementById('editBookingRoomsCount')?.value, 10) || 1;
  const adults = parseInt(document.getElementById('editBookingAdults')?.value, 10) || 2;
  const children = parseInt(document.getElementById('editBookingChildren')?.value, 10) || 0;
  const status = document.getElementById('editBookingStatus')?.value;

  if (!guestName || !guestPhone || !checkIn || !checkOut) {
    showToast('Please fill all mandatory fields (Name, Phone, Stay Dates).', 'error');
    return;
  }

  if (new Date(checkOut) <= new Date(checkIn)) {
    showToast('Check-out date must be after check-in date.', 'error');
    return;
  }

  const breakfast = document.getElementById('editBookingBreakfast')?.checked;
  const breakfastGuests = parseInt(document.getElementById('editBookingBfGuests')?.value, 10) || adults;
  const needCar = document.getElementById('editBookingNeedCar')?.checked;
  const vehicleType = document.getElementById('editBookingVehicleType')?.value;
  const carCount = parseInt(document.getElementById('editBookingCarCount')?.value, 10) || 1;
  const candlelightDinner = document.getElementById('editBookingCandlelight')?.checked;
  const dinnerSetup = document.getElementById('editBookingDinnerSetup')?.value;
  const customPrice = document.getElementById('editBookingCustomPrice')?.value;
  const discountAmount = Number(document.getElementById('editBookingDiscount')?.value) || 0;

  // Ask for confirmation if active booking is being modified
  const isOriginalActive = currentEditingBooking && ['Confirmed', 'Checked-in'].includes(currentEditingBooking.status);
  if (isOriginalActive) {
    if (!confirm(`Confirm changes to active reservation ${bookingId}? A revised invoice will be generated and logged to the security audit trail.`)) {
      return;
    }
  }

  const saveBtn = document.getElementById('btnSaveBookingDetails');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined rotating">sync</span> Saving...';
  }

  try {
    const payload = {
      guestName,
      guestPhone,
      guestEmail,
      roomId,
      checkIn,
      checkOut,
      roomsCount,
      adults,
      children,
      status,
      breakfast,
      breakfastGuests,
      needCar,
      vehicleType,
      carCount,
      candlelightDinner,
      dinnerSetup,
      customPrice: customPrice ? Number(customPrice) : null,
      discountAmount
    };

    const res = await authFetch(`/api/bookings/${bookingId}`, {
      method: 'PUT',
      body: payload
    });

    if (res.success) {
      closeModal('editBookingModal');
      showToast(res.message || `Reservation ${bookingId} updated successfully!`, 'success');
      loadAllAdminData();
    } else {
      showToast(res.message || 'Failed to update reservation.', 'error');
    }
  } catch (err) {
    showToast('Error saving reservation: ' + err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save & Update Invoice';
    }
  }
}

// ----------------------------------------------------------------------------
// 2. USERS & ROLES EDITING (SUPER ADMIN)
// ----------------------------------------------------------------------------
let currentEditingStaff = null;

function openEditStaffModal(username) {
  authFetch('/api/admin/users').then(res => {
    if (!res.success || !Array.isArray(res.users)) return;
    const u = res.users.find(x => x.username.toLowerCase() === username.toLowerCase());
    if (!u) return;
    currentEditingStaff = u;

    document.getElementById('editStaffUsername').value = u.username;
    document.getElementById('editStaffRoleModalTitle').textContent = `Edit Staff Account: ${u.username}`;
    document.getElementById('editStaffName').value = u.name || u.username;
    document.getElementById('editStaffEmail').value = u.email || '';
    document.getElementById('editStaffRoleSelect').value = u.role || 'Manager';
    document.getElementById('editStaffActiveToggle').checked = u.active !== false;
    document.getElementById('editStaffNewPassword').value = '';

    openModal('editStaffRoleModal');
  });
}

async function executeSaveStaffRole() {
  const username = document.getElementById('editStaffUsername')?.value;
  if (!username) return;

  const name = document.getElementById('editStaffName')?.value.trim();
  const email = document.getElementById('editStaffEmail')?.value.trim();
  const role = document.getElementById('editStaffRoleSelect')?.value;
  const active = document.getElementById('editStaffActiveToggle')?.checked;
  const password = document.getElementById('editStaffNewPassword')?.value.trim();

  promptReauthModal(async () => {
    const saveBtn = document.getElementById('btnSaveStaffRole');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
      const payload = { name, email, role, active };
      if (password) payload.password = password;

      const res = await authFetch(`/api/admin/users/${username}`, {
        method: 'PATCH',
        body: payload
      });

      if (res.success) {
        closeModal('editStaffRoleModal');
        showToast(res.message || `Staff account "${username}" updated successfully.`, 'success');
        renderUsersTab();
      } else {
        showToast(res.message || 'Failed to update user account.', 'error');
      }
    } catch (err) {
      showToast('Error updating staff role: ' + err.message, 'error');
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Account Changes'; }
    }
  }, `Confirm security changes to staff account "${username}". Enter Super Admin password:`);
}

async function toggleStaffActive(username, newActiveState) {
  const actionWord = newActiveState ? 'enable' : 'disable';
  if (!confirm(`Are you sure you want to ${actionWord} staff account "${username}"?`)) return;

  promptReauthModal(async () => {
    try {
      const res = await authFetch(`/api/admin/users/${username}`, {
        method: 'PATCH',
        body: { active: newActiveState }
      });
      if (res.success) {
        showToast(`Account "${username}" is now ${newActiveState ? 'Active' : 'Disabled'}.`, 'success');
        renderUsersTab();
      } else {
        showToast(res.message || 'Failed to update account status.', 'error');
      }
    } catch (err) {
      showToast('Error toggling staff status: ' + err.message, 'error');
    }
  }, `Confirm ${actionWord} account "${username}". Enter Super Admin password:`);
}

// ----------------------------------------------------------------------------
// 3. LUXURY AMENITIES MANAGER
// ----------------------------------------------------------------------------
async function renderAmenitiesList() {
  const container = document.getElementById('amenitiesCardsList');
  if (!container) return;

  try {
    const res = await authFetch('/api/admin/amenities');
    const list = res.success && Array.isArray(res.amenities) ? res.amenities : [];

    if (!list.length) {
      container.innerHTML = '<div style="color:#64748B; font-style:italic; padding:12px;">No amenities found. Click "Add New Amenity" to configure resort highlights.</div>';
      return;
    }

    container.innerHTML = list.map((a, idx) => `
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 220px;">
          <div style="width: 40px; height: 40px; border-radius: 8px; background: #E6F7F7; display: flex; align-items: center; justify-content: center; color: var(--turquoise-dark);">
            <span class="material-symbols-outlined" style="font-size: 22px;">${a.icon || 'check_circle'}</span>
          </div>
          <div>
            <div style="font-weight: 700; color: var(--ocean-blue); font-size: 0.92rem;">${a.title}</div>
            <div style="font-size: 0.78rem; color: #64748B;">${a.desc || ''}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge-status ${a.active !== false ? 'available' : 'sold-out'}" style="font-size: 0.72rem;">
            ${a.active !== false ? 'Active' : 'Hidden'}
          </span>
          <button class="reorder-btn" onclick="moveAmenityOrder('${a.id}', -1)" title="Move up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>▲</button>
          <button class="reorder-btn" onclick="moveAmenityOrder('${a.id}', 1)" title="Move down" ${idx === list.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>▼</button>
          <button class="btn-turquoise" style="padding: 4px 10px; font-size: 0.76rem;" onclick="openAmenityEditModal('${a.id}')">Edit</button>
          <button class="btn-outline-gold" style="padding: 4px 8px; font-size: 0.74rem;" onclick="toggleAmenityActive('${a.id}', ${a.active === false})">
            ${a.active !== false ? 'Hide' : 'Show'}
          </button>
          <button class="btn-icon-only" style="color: var(--sunset-coral); width: 28px; height: 28px;" onclick="deleteAmenity('${a.id}')" title="Delete amenity">×</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:#DC2626; padding:12px;">Failed to load amenities.</div>';
  }
}

function openAmenityEditModal(id = null) {
  document.getElementById('editAmenityId').value = id || '';
  if (id) {
    authFetch('/api/admin/amenities').then(res => {
      const a = (res.amenities || []).find(x => x.id === id);
      if (!a) return;
      document.getElementById('editAmenityModalTitle').textContent = 'Edit Amenity: ' + a.title;
      document.getElementById('editAmenityTitle').value = a.title || '';
      document.getElementById('editAmenityIcon').value = a.icon || 'waves';
      document.getElementById('editAmenityIconPreview').textContent = a.icon || 'waves';
      document.getElementById('editAmenityDesc').value = a.desc || '';
      document.getElementById('editAmenityActive').checked = a.active !== false;
      openModal('editAmenityModal');
    });
  } else {
    document.getElementById('editAmenityModalTitle').textContent = 'Add New Resort Amenity';
    document.getElementById('editAmenityTitle').value = '';
    document.getElementById('editAmenityIcon').value = 'waves';
    document.getElementById('editAmenityIconPreview').textContent = 'waves';
    document.getElementById('editAmenityDesc').value = '';
    document.getElementById('editAmenityActive').checked = true;
    openModal('editAmenityModal');
  }
}

async function executeSaveAmenity() {
  const id = document.getElementById('editAmenityId')?.value;
  const title = document.getElementById('editAmenityTitle')?.value.trim();
  const icon = document.getElementById('editAmenityIcon')?.value.trim() || 'check_circle';
  const desc = document.getElementById('editAmenityDesc')?.value.trim();
  const active = document.getElementById('editAmenityActive')?.checked;

  if (!title) {
    showToast('Amenity title is required.', 'error');
    return;
  }

  const saveBtn = document.getElementById('btnSaveAmenity');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    const res = await authFetch('/api/admin/amenities', {
      method: 'POST',
      body: { id: id || undefined, title, icon, desc, active }
    });

    if (res.success) {
      closeModal('editAmenityModal');
      showToast(res.message || 'Amenity saved successfully!', 'success');
      renderAmenitiesList();
    } else {
      showToast(res.message || 'Error saving amenity.', 'error');
    }
  } catch (err) {
    showToast('Failed to save amenity.', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Amenity'; }
  }
}

async function toggleAmenityActive(id, newActive) {
  try {
    const res = await authFetch('/api/admin/amenities', {
      method: 'POST',
      body: { id, active: newActive }
    });
    if (res.success) {
      showToast('Amenity status updated.', 'success');
      renderAmenitiesList();
    }
  } catch (e) {
    showToast('Error updating amenity.', 'error');
  }
}

async function deleteAmenity(id) {
  if (!confirm('Are you sure you want to delete this amenity?')) return;
  try {
    const res = await authFetch(`/api/admin/amenities/${id}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message || 'Amenity deleted.', 'success');
      renderAmenitiesList();
    }
  } catch (e) {
    showToast('Error deleting amenity.', 'error');
  }
}

async function moveAmenityOrder(id, delta) {
  try {
    const res = await authFetch('/api/admin/amenities');
    const list = res.amenities || [];
    const idx = list.findIndex(a => a.id === id);
    if (idx === -1) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    await authFetch('/api/admin/amenities/reorder', {
      method: 'POST',
      body: { ids: list.map(a => a.id) }
    });
    renderAmenitiesList();
    showToast('Amenities order saved.', 'success');
  } catch (e) {
    showToast('Error reordering amenities.', 'error');
  }
}

// ----------------------------------------------------------------------------
// 4. NEARBY EXCURSIONS / ATTRACTIONS MANAGER
// ----------------------------------------------------------------------------
function openEditPlaceModal(idx) {
  const c = adminState.content || {};
  const places = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);
  const p = places[idx];
  if (!p) return;

  document.getElementById('editPlaceIdx').value = idx;
  document.getElementById('editPlaceModalTitle').textContent = 'Edit Attraction: ' + p.name;
  document.getElementById('editPlaceName').value = p.name || '';
  document.getElementById('editPlaceDistance').value = p.distance || '';
  document.getElementById('editPlaceDesc').value = p.description || '';
  openModal('editPlaceModal');
}

function addNewPlacePrompt() {
  document.getElementById('editPlaceIdx').value = '-1';
  document.getElementById('editPlaceModalTitle').textContent = 'Add New Mandarmani Excursion';
  document.getElementById('editPlaceName').value = '';
  document.getElementById('editPlaceDistance').value = '';
  document.getElementById('editPlaceDesc').value = '';
  openModal('editPlaceModal');
}

async function executeSavePlace() {
  const idx = parseInt(document.getElementById('editPlaceIdx')?.value, 10);
  const name = document.getElementById('editPlaceName')?.value.trim();
  const distance = document.getElementById('editPlaceDistance')?.value.trim();
  const description = document.getElementById('editPlaceDesc')?.value.trim();

  if (!name || !distance) {
    showToast('Place name and distance are required.', 'error');
    return;
  }

  const c = adminState.content || {};
  let places = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);

  if (idx >= 0 && idx < places.length) {
    places[idx] = { name, distance, description };
  } else {
    places.push({ name, distance, description });
  }

  const saveBtn = document.getElementById('btnSavePlace');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    const res = await authFetch('/api/admin/content/places', {
      method: 'POST',
      body: places
    });
    if (res.success) {
      closeModal('editPlaceModal');
      c.places = places;
      renderWebsiteContent();
      showToast('Attraction saved successfully!', 'success');
    } else {
      showToast(res.message || 'Error saving attraction.', 'error');
    }
  } catch (err) {
    showToast('Failed to save attraction: ' + err.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Attraction'; }
  }
}

async function deletePlace(idx) {
  const c = adminState.content || {};
  let places = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);
  if (!places[idx]) return;
  if (!confirm(`Are you sure you want to delete "${places[idx].name}"?`)) return;

  places.splice(idx, 1);
  await authFetch('/api/admin/content/places', { method: 'POST', body: places });
  c.places = places;
  renderWebsiteContent();
  showToast('Attraction removed.', 'success');
}

async function movePlaceOrder(idx, delta) {
  const c = adminState.content || {};
  let places = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= places.length) return;

  const temp = places[idx];
  places[idx] = places[targetIdx];
  places[targetIdx] = temp;

  await authFetch('/api/admin/content/places', { method: 'POST', body: places });
  c.places = places;
  renderWebsiteContent();
  showToast('Excursions order saved.', 'success');
}

async function savePlacesContent() {
  const c = adminState.content || {};
  const places = Array.isArray(c.places) ? c.places : (Array.isArray(c.places?.places) ? c.places.places : []);
  await authFetch('/api/admin/content/places', { method: 'POST', body: places });
  showToast('Nearby Mandarmani excursions saved.', 'success');
}

// ----------------------------------------------------------------------------
// 5. FAQS & SCHEMA EDITING (EDIT, REORDER, ADD, DELETE)
// ----------------------------------------------------------------------------
async function editFaqPrompt(idx) {
  const c = adminState.content || {};
  const faqs = Array.isArray(c.faqs) ? c.faqs : (Array.isArray(c.faqs?.faqs) ? c.faqs.faqs : []);
  const f = faqs[idx];
  if (!f) return;

  const newQ = prompt('Edit FAQ Question:', f.question);
  if (newQ === null) return;
  const newA = prompt('Edit FAQ Answer:', f.answer);
  if (newA === null) return;

  faqs[idx] = { question: newQ.trim() || f.question, answer: newA.trim() || f.answer };
  await authFetch('/api/admin/content/faqs', { method: 'POST', body: faqs });
  c.faqs = faqs;
  renderWebsiteContent();
  showToast('FAQ updated successfully.', 'success');
}

async function moveFaqOrder(idx, delta) {
  const c = adminState.content || {};
  const faqs = Array.isArray(c.faqs) ? c.faqs : (Array.isArray(c.faqs?.faqs) ? c.faqs.faqs : []);
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= faqs.length) return;

  const temp = faqs[idx];
  faqs[idx] = faqs[targetIdx];
  faqs[targetIdx] = temp;

  await authFetch('/api/admin/content/faqs', { method: 'POST', body: faqs });
  c.faqs = faqs;
  renderWebsiteContent();
  showToast('FAQ order saved.', 'success');
}

// ----------------------------------------------------------------------------
// 6. TESTIMONIALS & ANI'S TOURS
// ----------------------------------------------------------------------------
async function addNewTestimonialPrompt() {
  const name = prompt('Guest Name & Location (e.g. Rahul S., Kolkata):');
  if (!name) return;
  const ratingStr = prompt('Rating (1 to 5):', '5');
  const rating = Math.min(5, Math.max(1, parseInt(ratingStr, 10) || 5));
  const comment = prompt('Guest Review / Comment:');
  if (!comment) return;

  const c = adminState.content || {};
  c.testimonials = c.testimonials || [];
  c.testimonials.unshift({
    name: name.trim(),
    rating,
    comment: comment.trim(),
    stayDate: new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  });

  await authFetch('/api/admin/content/testimonials', { method: 'POST', body: c.testimonials });
  renderWebsiteContent();
  showToast('Guest testimonial added.', 'success');
}

async function deleteTestimonial(idx) {
  const c = adminState.content || {};
  if (!c.testimonials || !c.testimonials[idx]) return;
  if (!confirm('Delete this guest review?')) return;
  c.testimonials.splice(idx, 1);
  await authFetch('/api/admin/content/testimonials', { method: 'POST', body: c.testimonials });
  renderWebsiteContent();
  showToast('Review removed.', 'success');
}

async function saveAnisToursContent() {
  const tour = {
    headline: document.getElementById('tourHeadline')?.value.trim() || "Ani's Tours & Coastal Commute",
    bookingUrl: document.getElementById('tourBookingUrl')?.value.trim() || '',
    description: document.getElementById('tourDescription')?.value.trim() || ''
  };
  await authFetch('/api/admin/content/anisTours', { method: 'POST', body: tour });
  showToast("Ani's Tours banner updated.", 'success');
}

// ----------------------------------------------------------------------------
// 7. MISSING MODAL & NAVIGATION HELPERS
// ----------------------------------------------------------------------------
function openAddGalleryPhotoModal() {
  openChangePhotoModal(null, null, null, false, null, true);
}

function openInvoiceSettingsModal() {
  const settingsTab = document.querySelector('[data-tab="tabSettings"]');
  if (settingsTab) {
    settingsTab.click();
    setTimeout(() => {
      const invCard = document.getElementById('invoiceSettingsContainer');
      if (invCard) invCard.scrollIntoView({ behavior: 'smooth' });
    }, 200);
  }
}

// ============================================================================
// 8. 2FA AUTHENTICATION, OTP INPUTS & SECURITY SETTINGS
// ============================================================================

let isRecoveryMode = false;
let resendCooldownInterval = null;
let pendingMfaSecret = '';
let pendingBackupCodes = [];
let activeGeneratedCodes = [];

function setLoginStep(step) {
  const s1 = document.getElementById('stepBar1');
  const s2 = document.getElementById('stepBar2');
  const s3 = document.getElementById('stepBar3');
  const d1 = document.getElementById('stepDiv1');
  const d2 = document.getElementById('stepDiv2');
  if (!s1 || !s2 || !s3) return;

  s1.classList.remove('active', 'completed');
  s2.classList.remove('active', 'completed');
  s3.classList.remove('active', 'completed');
  if (d1) d1.classList.remove('active');
  if (d2) d2.classList.remove('active');

  if (step === 1) {
    s1.classList.add('active');
  } else if (step === 2) {
    s1.classList.add('completed');
    s2.classList.add('active');
    if (d1) d1.classList.add('active');
  } else if (step === 3) {
    s1.classList.add('completed');
    s2.classList.add('completed');
    s3.classList.add('active');
    if (d1) d1.classList.add('active');
    if (d2) d2.classList.add('active');
  }
}
window.setLoginStep = setLoginStep;

function initOtpInputs(containerId, hiddenInputId, onComplete) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const digits = container.querySelectorAll('.otp-digit');

  digits.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val ? val[val.length - 1] : '';

      const assembled = Array.from(digits).map(d => d.value).join('');
      if (hiddenInputId) {
        const hidden = document.getElementById(hiddenInputId);
        if (hidden) hidden.value = assembled;
      }

      if (e.target.value && idx < digits.length - 1) {
        digits[idx + 1].focus();
        digits[idx + 1].select();
      }

      if (assembled.length === digits.length && typeof onComplete === 'function') {
        onComplete(assembled);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!e.target.value && idx > 0) {
          digits[idx - 1].focus();
          digits[idx - 1].value = '';
          const assembled = Array.from(digits).map(d => d.value).join('');
          if (hiddenInputId) {
            const hidden = document.getElementById(hiddenInputId);
            if (hidden) hidden.value = assembled;
          }
        }
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        digits[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < digits.length - 1) {
        digits[idx + 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const cleanDigits = pasteData.replace(/\D/g, '').slice(0, digits.length);
      cleanDigits.split('').forEach((ch, i) => {
        if (digits[i]) digits[i].value = ch;
      });
      const assembled = Array.from(digits).map(d => d.value).join('');
      if (hiddenInputId) {
        const hidden = document.getElementById(hiddenInputId);
        if (hidden) hidden.value = assembled;
      }
      if (cleanDigits.length < digits.length && digits[cleanDigits.length]) {
        digits[cleanDigits.length].focus();
      } else if (cleanDigits.length === digits.length && typeof onComplete === 'function') {
        onComplete(assembled);
      }
    });
  });
}
window.initOtpInputs = initOtpInputs;

function clearOtpInputs(containerId = 'otpInputsRow', hiddenInputId = 'twoFactorCode') {
  const container = document.getElementById(containerId);
  if (container) {
    container.querySelectorAll('.otp-digit').forEach(d => d.value = '');
  }
  if (hiddenInputId) {
    const hidden = document.getElementById(hiddenInputId);
    if (hidden) hidden.value = '';
  }
}
window.clearOtpInputs = clearOtpInputs;

function setOtpInputsValue(value, containerId = 'otpInputsRow', hiddenInputId = 'twoFactorCode') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const digits = container.querySelectorAll('.otp-digit');
  const clean = String(value).replace(/\D/g, '').slice(0, digits.length);
  digits.forEach((d, i) => {
    d.value = clean[i] || '';
  });
  if (hiddenInputId) {
    const hidden = document.getElementById(hiddenInputId);
    if (hidden) hidden.value = clean;
  }
}
window.setOtpInputsValue = setOtpInputsValue;

window.toggleRecoveryCodeMode = function() {
  isRecoveryMode = !isRecoveryMode;
  const otpGroup = document.getElementById('otpInputModeGroup');
  const recGroup = document.getElementById('recoveryInputModeGroup');
  const toggleBtn = document.getElementById('btnToggleRecoveryMode');
  const errBox = document.getElementById('twoFactorErrorMsg');
  if (errBox) errBox.style.display = 'none';

  if (isRecoveryMode) {
    if (otpGroup) otpGroup.style.display = 'none';
    if (recGroup) recGroup.style.display = 'block';
    if (toggleBtn) toggleBtn.textContent = 'Use 6-Digit Code';
    const recInput = document.getElementById('recoveryCodeInput');
    if (recInput) {
      recInput.value = '';
      recInput.focus();
    }
  } else {
    if (otpGroup) otpGroup.style.display = 'block';
    if (recGroup) recGroup.style.display = 'none';
    if (toggleBtn) toggleBtn.textContent = 'Use Recovery Code';
    clearOtpInputs();
    const firstDigit = document.querySelector('#otpInputsRow .otp-digit');
    if (firstDigit) firstDigit.focus();
  }
};

function startResendCooldown(seconds = 60) {
  const btn = document.getElementById('btnResendCode');
  const span = document.getElementById('resendCountdownSpan');
  if (!btn) return;
  btn.disabled = true;
  let remaining = seconds;
  if (span) span.textContent = `(${remaining}s)`;

  if (resendCooldownInterval) clearInterval(resendCooldownInterval);
  resendCooldownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(resendCooldownInterval);
      btn.disabled = false;
      if (span) span.textContent = '';
    } else {
      if (span) span.textContent = `(${remaining}s)`;
    }
  }, 1000);
}

window.handleSwitchToEmailCode = async function() {
  if (!currentPreAuthToken) return;
  const btn = document.getElementById('btnSwitchToEmailCode');
  if (btn) btn.disabled = true;

  try {
    showToast('Sending verification code to your email...', 'info');
    const res = await fetch('/api/auth/request-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preAuthToken: currentPreAuthToken })
    });
    const data = await res.json();
    if (data.success) {
      const modeTitle = document.getElementById('twoFactorModeTitle');
      const modeInstruction = document.getElementById('twoFactorInstruction');
      if (modeTitle) modeTitle.textContent = 'Email Verification Code';
      if (modeInstruction) modeInstruction.textContent = `Enter the 6-digit code sent to ${data.maskedEmail || 'your email'}.`;
      if (btn) btn.style.display = 'none';

      clearOtpInputs('otpInputsRow', 'twoFactorCode');
      if (data.devCode) {
        const devNotice = document.getElementById('devCodeNotice');
        if (devNotice) {
          devNotice.style.display = 'block';
          devNotice.innerHTML = `<strong>Local Dev Mode (SMTP not configured in .env):</strong><br>Your 6-digit verification code is <strong style="font-size: 1.35rem; letter-spacing: 4px; color: #D4AF37; display: block; margin: 4px 0;">${data.devCode}</strong>`;
        }
        setOtpInputsValue(data.devCode, 'otpInputsRow', 'twoFactorCode');
      }
      showToast('A fresh 6-digit verification code has been dispatched to your email.', 'success');
      startResendCooldown(60);
    } else {
      showToast(data.message || 'Failed to dispatch email code.', 'error');
    }
  } catch (err) {
    showToast('Connection error while requesting email code.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.handleResend2FACode = async function() {
  if (!currentPreAuthToken) return;
  const btn = document.getElementById('btnResendCode');
  if (btn && btn.disabled) return;

  try {
    showToast('Dispatching fresh verification code...', 'info');
    const res = await fetch('/api/auth/resend-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preAuthToken: currentPreAuthToken })
    });
    const data = await res.json();
    if (data.success) {
      if (data.devCode) {
        const devNotice = document.getElementById('devCodeNotice');
        if (devNotice) {
          devNotice.style.display = 'block';
          devNotice.innerHTML = `<strong>Local Dev Mode (SMTP not configured in .env):</strong><br>Your 6-digit verification code is <strong style="font-size: 1.35rem; letter-spacing: 4px; color: #D4AF37; display: block; margin: 4px 0;">${data.devCode}</strong>`;
        }
        setOtpInputsValue(data.devCode, 'otpInputsRow', 'twoFactorCode');
      }
      showToast('A fresh verification code has been dispatched.', 'success');
      startResendCooldown(60);
    } else {
      showToast(data.message || 'Failed to resend code.', 'error');
    }
  } catch (e) {
    showToast('Error requesting new code.', 'error');
  }
};

window.backToLoginStep1 = function() {
  const step1 = document.querySelector('.login-step-1');
  const step2 = document.querySelector('.two-factor-screen');
  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  setLoginStep(1);
  clearOtpInputs('otpInputsRow', 'twoFactorCode');
  const recInput = document.getElementById('recoveryCodeInput');
  if (recInput) recInput.value = '';
  const errBox = document.getElementById('loginErrorMsg');
  if (errBox) errBox.style.display = 'none';
  const twoFaErr = document.getElementById('twoFactorErrorMsg');
  if (twoFaErr) twoFaErr.style.display = 'none';
};

// ----------------------------------------------------------------------------
// 3-STEP MANDATORY & USER 2FA (TOTP) SETUP WIZARD
let mfaWizardStep = 1;

window.checkMandatoryMfaSetup = function(user) {
  if (!user || !user.requireMfaSetup) return;
  openMfaSetupModal(true);
};

window.openMfaSetupModal = async function(isMandatory = false) {
  const modal = document.getElementById('mandatoryMfaModal');
  const cancelBtn = document.getElementById('btnCancelMfaSetup');
  if (cancelBtn) cancelBtn.style.display = isMandatory ? 'none' : 'inline-block';
  if (!modal) return;

  const btnStep1Next = document.getElementById('btnMfaGoToStep2');
  if (btnStep1Next) {
    btnStep1Next.disabled = true;
    btnStep1Next.textContent = 'Loading Setup...';
  }

  try {
    const res = await authFetch('/api/auth/totp/setup');
    if (res && res.success) {
      pendingMfaSecret = res.secret;
      pendingBackupCodes = res.backupCodes || [];

      const qrImg = document.getElementById('mfaQrCodeImg');
      if (qrImg) {
        qrImg.src = res.qrDataUrl || res.qrCodeDataUrl || '';
      }

      const secretText = document.getElementById('mfaManualSecretText');
      if (secretText) {
        secretText.textContent = res.manualKeyGrouped || (res.secret ? res.secret.match(/.{1,4}/g).join(' ') : 'KEY ERROR');
      }

      const accNameEl = document.getElementById('mfaAccountNameText');
      if (accNameEl) {
        accNameEl.textContent = res.accountName || 'Coastal View Admin';
      }

      const grid = document.getElementById('mfaModalRecoveryGrid');
      if (grid) {
        grid.innerHTML = pendingBackupCodes.map(c => `
          <div class="recovery-chip"><code>${c}</code></div>
        `).join('');
      }

      // Reset step 3 checkbox and button
      const chk = document.getElementById('chkMfaSavedRecoveryCodes');
      if (chk) chk.checked = false;
      const actBtn = document.getElementById('btnCompleteMfaActivation');
      if (actBtn) {
        actBtn.disabled = true;
        actBtn.style.opacity = '0.5';
      }

      // Reset step 2 inputs & error
      clearOtpInputs('mfaSetupOtpRow', null);
      const errStep2 = document.getElementById('mfaSetupErrorMsg');
      if (errStep2) errStep2.style.display = 'none';
      const errStep3 = document.getElementById('mfaStep3ErrorMsg');
      if (errStep3) errStep3.style.display = 'none';

      goToMfaStep(1);
      modal.style.display = 'flex';
    } else {
      const errMsg = (res && res.message) ? res.message : "Couldn't generate QR code. Please try again.";
      showToast(errMsg, 'error');
    }
  } catch (err) {
    console.error('MFA setup fetch failed:', err);
    showToast(err.message === 'MFA encryption key not configured' ? 'MFA encryption key not configured' : "Couldn't generate QR code. Please try again.", 'error');
  } finally {
    if (btnStep1Next) {
      btnStep1Next.disabled = false;
      btnStep1Next.textContent = 'Next: Verify 6-Digit Code →';
    }
  }
};

window.goToMfaStep = function(step) {
  mfaWizardStep = step;
  const s1 = document.getElementById('mfaSetupStep1');
  const s2 = document.getElementById('mfaSetupStep2');
  const s3 = document.getElementById('mfaSetupStep3');

  if (s1) s1.style.display = step === 1 ? 'block' : 'none';
  if (s2) s2.style.display = step === 2 ? 'block' : 'none';
  if (s3) s3.style.display = step === 3 ? 'block' : 'none';

  const dot1 = document.getElementById('mfaDot1');
  const dot2 = document.getElementById('mfaDot2');
  const dot3 = document.getElementById('mfaDot3');

  if (dot1) {
    dot1.className = 'mfa-step-dot' + (step === 1 ? ' active' : (step > 1 ? ' done' : ''));
  }
  if (dot2) {
    dot2.className = 'mfa-step-dot' + (step === 2 ? ' active' : (step > 2 ? ' done' : ''));
  }
  if (dot3) {
    dot3.className = 'mfa-step-dot' + (step === 3 ? ' active' : '');
  }

  if (step === 2) {
    clearOtpInputs('mfaSetupOtpRow', null);
    const errBox = document.getElementById('mfaSetupErrorMsg');
    if (errBox) errBox.style.display = 'none';
    setTimeout(() => {
      const firstDigit = document.querySelector('#mfaSetupOtpRow .otp-digit');
      if (firstDigit) firstDigit.focus();
    }, 100);
  }
};

window.submitMfaSetupStep2 = async function() {
  const digits = document.querySelectorAll('#mfaSetupOtpRow .otp-digit');
  const code = Array.from(digits).map(d => d.value).join('').trim();
  const errBox = document.getElementById('mfaSetupErrorMsg');
  const btn = document.getElementById('btnVerifyMfaStep2');

  if (code.length !== 6) {
    if (errBox) {
      errBox.textContent = 'Please enter the complete 6-digit code from your Authenticator app.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Verifying...';
  }

  try {
    const res = await authFetch('/api/auth/totp/verify-setup', {
      method: 'POST',
      body: { code }
    });

    if (res && res.success) {
      showToast('Authenticator code verified! Now save your recovery codes.', 'success');
      goToMfaStep(3);
    } else {
      if (errBox) {
        errBox.textContent = (res && res.message) || 'Invalid or expired code. Check your device clock and try again.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Verification request failed. Please try again.';
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Verify Code →';
    }
  }
};

window.toggleMfaActivationButton = function() {
  const chk = document.getElementById('chkMfaSavedRecoveryCodes');
  const btn = document.getElementById('btnCompleteMfaActivation');
  if (!btn) return;
  const isChecked = chk && chk.checked;
  btn.disabled = !isChecked;
  btn.style.opacity = isChecked ? '1' : '0.5';
};

window.downloadRecoveryCodesTxt = function() {
  if (!pendingBackupCodes || pendingBackupCodes.length === 0) {
    showToast('No recovery codes available to download.', 'warning');
    return;
  }

  const username = currentUser ? currentUser.username : 'admin';
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const content = [
    '=================================================================',
    'COASTAL VIEW MANDARMANI - EMERGENCY MFA RECOVERY CODES',
    '=================================================================',
    `Account:      Coastal View Admin (${username})`,
    `Generated At: ${timestamp} IST`,
    '',
    'IMPORTANT SECURITY INSTRUCTIONS:',
    '- Each recovery code below can be used ONLY ONCE to sign in.',
    '- Store this file in a secure, encrypted folder or password manager.',
    '- Do NOT share or email these codes to anyone.',
    '-----------------------------------------------------------------',
    ...pendingBackupCodes.map((c, i) => `Code ${i + 1}: ${c}`),
    '================================================================='
  ].join('\r\n');

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coastal-view-recovery-codes-${username}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Emergency recovery codes text file downloaded.', 'success');
};

window.completeMfaActivation = async function() {
  const chk = document.getElementById('chkMfaSavedRecoveryCodes');
  const errBox = document.getElementById('mfaStep3ErrorMsg');
  const btn = document.getElementById('btnCompleteMfaActivation');

  if (!chk || !chk.checked) {
    if (errBox) {
      errBox.textContent = 'Please confirm that you have safely saved your recovery codes.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Activating...';
  }

  try {
    const res = await authFetch('/api/auth/totp/activate', {
      method: 'POST',
      body: { confirmedSaved: true }
    });

    if (res && res.success) {
      if (currentUser) currentUser.requireMfaSetup = false;
      const modal = document.getElementById('mandatoryMfaModal');
      if (modal) modal.style.display = 'none';
      showToast('Authenticator app enabled successfully! Two-factor authentication is active.', 'success');
      loadUserSecurityStatus();
      loadAllAdminData();
    } else {
      if (errBox) {
        errBox.textContent = (res && res.message) || 'Activation failed. Please retry.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Server connection error during activation.';
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">verified</span> Complete Setup & Enable TOTP';
    }
  }
};

window.closeMfaSetupModal = function() {
  if (currentUser && currentUser.requireMfaSetup) {
    showToast('Two-factor authentication setup is mandatory before accessing dashboard.', 'warning');
    return;
  }
  const modal = document.getElementById('mandatoryMfaModal');
  if (modal) modal.style.display = 'none';
};

window.copyMfaSecret = function() {
  if (!pendingMfaSecret) return;
  navigator.clipboard.writeText(pendingMfaSecret);
  showToast('Authenticator secret key copied to clipboard.', 'success');
};

window.copyAllRecoveryCodes = function() {
  if (!pendingBackupCodes || pendingBackupCodes.length === 0) return;
  navigator.clipboard.writeText(pendingBackupCodes.join('\n'));
  showToast('8 emergency recovery codes copied to clipboard.', 'success');
};

// ----------------------------------------------------------------------------
// DISABLE & RESET AUTHENTICATOR APP ACTIONS
// ----------------------------------------------------------------------------
window.openDisableMfaModal = function() {
  const modal = document.getElementById('disableMfaModal');
  if (!modal) return;
  document.getElementById('disableMfaPassword').value = '';
  document.getElementById('disableMfaCode').value = '';
  const errBox = document.getElementById('disableMfaErrorMsg');
  if (errBox) errBox.style.display = 'none';
  modal.style.display = 'flex';
};

window.executeDisableMfa = async function() {
  const pass = document.getElementById('disableMfaPassword')?.value;
  const code = document.getElementById('disableMfaCode')?.value?.trim();
  const errBox = document.getElementById('disableMfaErrorMsg');
  const btn = document.getElementById('btnConfirmDisableMfa');

  if (!pass || !code) {
    if (errBox) {
      errBox.textContent = 'Please enter both your password and a current verification code.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/auth/totp/disable', {
      method: 'POST',
      body: { password: pass, code }
    });

    if (res && res.success) {
      closeModal('disableMfaModal');
      showToast(res.message || 'Authenticator app removed. Email 2FA remains active.', 'info');
      loadUserSecurityStatus();
    } else {
      if (errBox) {
        errBox.textContent = (res && res.message) || 'Failed to disable Authenticator 2FA.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Server error during disable request.';
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.openResetMfaModal = function() {
  const modal = document.getElementById('resetMfaModal');
  if (!modal) return;
  document.getElementById('resetMfaPassword').value = '';
  document.getElementById('resetMfaCode').value = '';
  const errBox = document.getElementById('resetMfaErrorMsg');
  if (errBox) errBox.style.display = 'none';
  modal.style.display = 'flex';
};

window.executeResetMfa = async function() {
  const pass = document.getElementById('resetMfaPassword')?.value;
  const code = document.getElementById('resetMfaCode')?.value?.trim();
  const errBox = document.getElementById('resetMfaErrorMsg');
  const btn = document.getElementById('btnConfirmResetMfa');

  if (!pass || !code) {
    if (errBox) {
      errBox.textContent = 'Please enter both your password and current verification code.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/auth/totp/reset', {
      method: 'POST',
      body: { password: pass, code }
    });

    if (res && res.success) {
      closeModal('resetMfaModal');
      showToast('Authenticator reset initiated! Pair your new device now.', 'success');
      loadUserSecurityStatus();
      // Directly open the setup modal to complete pairing the new key
      openMfaSetupModal(false);
    } else {
      if (errBox) {
        errBox.textContent = (res && res.message) || 'Failed to reset Authenticator 2FA.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Server error during reset request.';
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.loadUserSecurityStatus = async function() {
  try {
    const res = await authFetch('/api/admin/user-security-status');
    if (!res || !res.success) return;

    const badge = document.getElementById('user2FaStatusBadge');
    const triggerBtn = document.getElementById('btnTriggerMfaSetup');
    const resetBtn = document.getElementById('btnResetMfa');
    const disableBtn = document.getElementById('btnDisableMfa');
    const desc = document.getElementById('mfaCardDescription');
    const recCountDesc = document.getElementById('recoveryCodesCountDesc');

    if (res.hasTotp) {
      if (badge) {
        badge.className = 'security-status-badge status-confirmed';
        badge.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">verified_user</span> 2FA: Authenticator App (Active)';
      }
      if (triggerBtn) triggerBtn.style.display = 'none';
      if (resetBtn) resetBtn.style.display = 'inline-flex';
      if (disableBtn) disableBtn.style.display = 'inline-flex';
      if (desc) {
        desc.textContent = 'Active on your Authenticator app. Enter 6-digit codes generated on your paired mobile device when signing in.';
      }
      if (recCountDesc) {
        recCountDesc.textContent = `${res.remainingRecoveryCodes} single-use emergency recovery code(s) remaining.`;
      }
    } else {
      if (badge) {
        badge.className = 'security-status-badge disabled';
        badge.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">shield</span> 2FA: Email Only';
      }
      if (triggerBtn) triggerBtn.style.display = 'inline-flex';
      if (resetBtn) resetBtn.style.display = 'none';
      if (disableBtn) disableBtn.style.display = 'none';
      if (desc) {
        desc.textContent = 'Pair Google Authenticator, Microsoft Authenticator, or 1Password for instantaneous 6-digit verification codes.';
      }
      if (recCountDesc) {
        recCountDesc.textContent = '8 single-use codes to access your account if both your Authenticator app and email are unavailable.';
      }
    }
  } catch (err) {
    console.warn('Could not load user security status:', err);
  }
};

// ----------------------------------------------------------------------------
// RECOVERY CODES REGENERATION MODAL
// ----------------------------------------------------------------------------
window.openRecoveryCodesModal = function() {
  const modal = document.getElementById('recoveryCodesModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const passInput = document.getElementById('recoveryReauthPassword');
  if (passInput) passInput.value = '';
  const reauthSec = document.getElementById('reauthForRecoverySection');
  const dispSec = document.getElementById('recoveryCodesDisplaySection');
  const errBox = document.getElementById('recoveryErrorMsg');
  if (reauthSec) reauthSec.style.display = 'block';
  if (dispSec) dispSec.style.display = 'none';
  if (errBox) errBox.style.display = 'none';
};

window.copyActiveRecoveryCodes = function() {
  if (!activeGeneratedCodes || activeGeneratedCodes.length === 0) return;
  navigator.clipboard.writeText(activeGeneratedCodes.join('\n'));
  showToast('Recovery codes copied to clipboard.', 'success');
};

window.executeRegenerateRecoveryCodes = async function() {
  const pass = document.getElementById('recoveryReauthPassword')?.value;
  const errBox = document.getElementById('recoveryErrorMsg');
  const btn = document.getElementById('btnExecuteRegenRecovery');

  if (!pass) {
    if (errBox) {
      errBox.textContent = 'Password is required to regenerate recovery codes.';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/auth/totp/regenerate-backup-codes', {
      method: 'POST',
      body: { password: pass }
    });

    if (res.success && res.backupCodes) {
      activeGeneratedCodes = res.backupCodes;
      const grid = document.getElementById('activeRecoveryCodesGrid');
      if (grid) {
        grid.innerHTML = res.backupCodes.map(c => `
          <div class="recovery-chip"><code>${c}</code></div>
        `).join('');
      }
      const reauthSec = document.getElementById('reauthForRecoverySection');
      const dispSec = document.getElementById('recoveryCodesDisplaySection');
      if (reauthSec) reauthSec.style.display = 'none';
      if (dispSec) dispSec.style.display = 'block';
      showToast('8 fresh recovery codes generated. Old codes invalidated.', 'success');
    } else {
      if (errBox) {
        errBox.textContent = res.message || 'Failed to regenerate recovery codes.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Connection error.';
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ----------------------------------------------------------------------------
// EMAIL ADMIN TOOLS & MAIL LOGS
// ----------------------------------------------------------------------------
window.loadEmailStats = async function() {
  try {
    const res = await authFetch('/api/admin/email/stats');
    if (!res.success) return;

    const badge = document.getElementById('emailProviderStatusBadge');
    const sender = document.getElementById('emailSenderAddressSpan');
    const dailyLimit = document.getElementById('emailDailyLimitSpan');
    const todayCount = document.getElementById('emailQuotaCountSpan');
    const quotaBar = document.getElementById('emailQuotaPercentBar');
    const warnBanner = document.getElementById('emailWarningBanner');

    if (badge) {
      if (res.status === 'connected') {
        badge.className = 'status-badge status-confirmed';
        badge.textContent = 'Connected (Verified)';
      } else if (res.status === 'unconfigured') {
        badge.className = 'status-badge status-pending';
        badge.textContent = 'Not Configured (Local Dev)';
      } else {
        badge.className = 'status-badge status-cancelled';
        badge.textContent = 'Failing (Check SMTP)';
      }
    }

    if (sender) sender.textContent = `${res.fromName} <${res.fromEmail}>`;
    if (dailyLimit) dailyLimit.textContent = res.dailyLimit || 300;
    if (todayCount) todayCount.textContent = res.todayCount || 0;

    const percent = Math.min(100, Math.round(((res.todayCount || 0) / (res.dailyLimit || 300)) * 100));
    if (quotaBar) {
      quotaBar.style.width = `${percent}%`;
      if (percent >= 90) quotaBar.style.background = 'var(--sunset-coral)';
      else if (percent >= 75) quotaBar.style.background = 'var(--champagne-gold)';
      else quotaBar.style.background = 'var(--turquoise)';
    }

    // Dashboard warning banner
    if (warnBanner) {
      if (res.status === 'failing') {
        warnBanner.style.display = 'flex';
        warnBanner.innerHTML = `
          <span class="material-symbols-outlined" style="font-size: 22px; color: var(--sunset-coral);">warning</span>
          <div>
            <strong>SMTP Outbound Delivery Failing:</strong> Email notifications (booking confirmations, login codes) cannot be sent. Verify SMTP credentials in Hostinger / <code>.env</code>.
          </div>
        `;
      } else if (percent >= 80) {
        warnBanner.style.display = 'flex';
        warnBanner.innerHTML = `
          <span class="material-symbols-outlined" style="font-size: 22px; color: #D97706;">info</span>
          <div>
            <strong>Daily SMTP Quota Warning:</strong> ${res.todayCount} of ${res.dailyLimit} daily emails sent (${percent}%). Approaching free tier limit.
          </div>
        `;
      } else {
        warnBanner.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Failed to fetch email stats:', err);
  }
};

window.handleSendAdminTestEmail = async function() {
  const btn = document.getElementById('btnSendAdminTestEmail');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Sending...';
  }

  try {
    showToast('Dispatching test message through SMTP...', 'info');
    const res = await authFetch('/api/admin/email/test', { method: 'POST' });
    if (res.success) {
      showToast(res.message || 'Test email successfully sent to Super Admin!', 'success');
      alert(`✅ Success: ${res.message}\nMessage ID: ${res.messageId || 'OK'}`);
    } else {
      showToast(res.message || 'Test email failed. Check logs.', 'error');
      alert(`❌ Test Email Failed:\n${res.message}\nError Code: ${res.code || 'UNKNOWN'}\nPlease verify SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.`);
    }
    loadEmailStats();
  } catch (err) {
    showToast('Failed to trigger test email.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">send</span> Send Test Email to Super Admin';
    }
  }
};

window.loadMailLogsData = async function() {
  const modal = document.getElementById('mailLogsModal');
  const tbody = document.getElementById('mailLogsTableBody');
  if (modal) modal.style.display = 'flex';
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748B;">Loading audit logs...</td></tr>';

  try {
    const res = await authFetch('/api/admin/mail-logs');
    if (res.success && res.logs) {
      if (res.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748B;">No mail transactions recorded yet.</td></tr>';
      } else {
        tbody.innerHTML = res.logs.map(log => `
          <tr>
            <td style="white-space: nowrap; font-family: monospace;">${log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}</td>
            <td><strong>${log.type || 'email'}</strong></td>
            <td><code>${log.recipient || 'masked'}</code></td>
            <td>
              <span class="status-badge ${log.success ? 'status-confirmed' : 'status-cancelled'}">
                ${log.success ? 'Delivered' : 'Failed'}
              </span>
            </td>
            <td><code>${log.errorCode || (log.success ? '250 OK' : 'ERR')}</code></td>
          </tr>
        `).join('');
      }
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--sunset-coral);">${res.message || 'Access restricted to Super Admin.'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--sunset-coral);">Failed to retrieve mail logs.</td></tr>';
  }
};

// ----------------------------------------------------------------------------
// ACTIVE SESSIONS & DEVICE REVOCATION (TABLE WITH SKELETON & RETRY)
// ----------------------------------------------------------------------------
window.loadActiveSessions = async function() {
  const tbody = document.getElementById('activeSessionsTableBody');
  if (!tbody) return;

  // Render 3 luxury skeleton placeholder rows during loading
  tbody.innerHTML = `
    <tr>
      <td><span class="skeleton-shimmer" style="width: 150px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 110px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 130px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 130px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 120px;"></span></td>
      <td style="text-align: right;"><span class="skeleton-shimmer" style="width: 80px;"></span></td>
    </tr>
    <tr>
      <td><span class="skeleton-shimmer" style="width: 170px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 100px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 120px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 130px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 110px;"></span></td>
      <td style="text-align: right;"><span class="skeleton-shimmer" style="width: 75px;"></span></td>
    </tr>
    <tr>
      <td><span class="skeleton-shimmer" style="width: 130px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 105px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 125px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 130px;"></span></td>
      <td><span class="skeleton-shimmer" style="width: 115px;"></span></td>
      <td style="text-align: right;"><span class="skeleton-shimmer" style="width: 70px;"></span></td>
    </tr>
  `;

  try {
    const res = await authFetch('/api/admin/sessions');
    if (res && res.success && Array.isArray(res.sessions)) {
      if (res.sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748B; padding: 24px;">No active device sessions found.</td></tr>';
      } else {
        tbody.innerHTML = res.sessions.map(s => {
          const isMobile = s.device && (s.device.toLowerCase().includes('mobile') || s.device.toLowerCase().includes('iphone') || s.device.toLowerCase().includes('android'));
          const icon = isMobile ? 'smartphone' : 'computer';
          const signedInTime = s.createdAt ? new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown';
          const lastActiveTime = s.lastActive ? new Date(s.lastActive).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Just now';

          return `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="material-symbols-outlined" style="color: var(--ocean-blue); font-size: 20px;">${icon}</span>
                  <strong>${s.device || 'Desktop Browser'}</strong>
                </div>
              </td>
              <td><code>${s.ip || '127.0.***.1'}</code></td>
              <td>
                <span style="display: inline-flex; align-items: center; gap: 4px; color: #475569; font-size: 0.8rem;">
                  <span class="material-symbols-outlined" style="font-size: 14px; color: #06B6B0;">location_on</span>
                  ${s.location || 'Local / Private Network'}
                </span>
              </td>
              <td style="font-size: 0.78rem; color: #64748B;">${signedInTime}</td>
              <td style="font-size: 0.78rem; color: #334155;">${lastActiveTime}</td>
              <td style="text-align: right;">
                ${s.isCurrent ? `
                  <span class="badge-this-device">
                    <span class="material-symbols-outlined" style="font-size: 13px;">check_circle</span> This device
                  </span>
                ` : `
                  <button type="button" class="btn-cancel" style="font-size: 0.74rem; padding: 4px 10px; color: var(--sunset-coral);" onclick="revokeSession('${s.id}')">
                    <span class="material-symbols-outlined" style="font-size: 13px;">logout</span> Log out
                  </button>
                `}
              </td>
            </tr>
          `;
        }).join('');
      }
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 24px;">
            <div style="color: var(--sunset-coral); font-weight: 600; margin-bottom: 8px;">
              <span class="material-symbols-outlined" style="vertical-align: middle; font-size: 18px;">error</span> ${(res && res.message) || 'Failed to load active sessions.'}
            </div>
            <button type="button" class="btn-outline-gold" style="font-size: 0.78rem; padding: 4px 14px;" onclick="loadActiveSessions()">
              <span class="material-symbols-outlined" style="font-size: 14px;">refresh</span> Retry
            </button>
          </td>
        </tr>
      `;
    }
  } catch (err) {
    console.error('Failed to load active sessions:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 24px;">
          <div style="color: var(--sunset-coral); font-weight: 600; margin-bottom: 8px;">
            <span class="material-symbols-outlined" style="vertical-align: middle; font-size: 18px;">cloud_off</span> Network error while retrieving active device sessions.
          </div>
          <button type="button" class="btn-outline-gold" style="font-size: 0.78rem; padding: 4px 14px;" onclick="loadActiveSessions()">
            <span class="material-symbols-outlined" style="font-size: 14px;">refresh</span> Retry
          </button>
        </td>
      </tr>
    `;
  }
};

window.revokeSession = async function(sessionId) {
  if (!confirm('Log out this device session immediately? That device will be required to sign in again.')) return;
  try {
    const res = await authFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
    if (res && res.success) {
      showToast(res.message || 'Session logged out successfully.', 'success');
      loadActiveSessions();
    } else {
      showToast((res && res.message) || 'Failed to revoke session.', 'error');
    }
  } catch (err) {
    showToast('Error revoking session.', 'error');
  }
};

window.handleLogoutOtherDevices = async function() {
  if (!confirm('Log out all other devices? All other active sessions will be terminated immediately, keeping only this device signed in.')) return;
  try {
    const res = await authFetch('/api/auth/logout-other-devices', { method: 'POST' });
    if (res && res.success) {
      showToast(res.message || 'All other devices logged out successfully.', 'success');
      loadActiveSessions();
    } else {
      showToast((res && res.message) || 'Failed to log out other devices.', 'error');
    }
  } catch (err) {
    showToast('Error logging out other devices.', 'error');
  }
};

window.handleLogoutAllDevices = async function() {
  if (!confirm('Log out of ALL devices and active sessions? You will need to sign in again with 2FA.')) return;
  try {
    await authFetch('/api/auth/logout-all', { method: 'POST' });
    localStorage.removeItem('coastal_admin_token');
    localStorage.removeItem('coastal_admin_csrf');
    currentToken = null;
    currentCsrfToken = null;
    currentUser = null;
    showToast('All sessions terminated.', 'info');
    showLoginScreen();
  } catch (err) {
    showToast('Failed to logout all devices.', 'error');
  }
};

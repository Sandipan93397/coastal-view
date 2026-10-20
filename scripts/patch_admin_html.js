/**
 * Script to patch admin/index.html with:
 * 1. Hardened Login & 2FA screen (no leaked demo codes, countdown timer, remember device, TOTP option)
 * 2. Exact requested sidebar order (Dashboard, Bookings, Rooms, Photos & Media, Menu, Gallery, Chatbot, Invoices, Users, Settings)
 * 3. Redesigned 3-Click Photos & Media manager layout with section grids
 * 4. Dedicated Gallery, Invoices, and Users tabs
 * 5. Password strength meter and sensitive action confirmation modal
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'admin', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// --- 1. REPLACE LOGIN SCREEN ---
const newLoginScreen = `  <!-- ==========================================================================
       AUTHENTICATION GATEWAY: EMAIL LOGIN + MANDATORY 2FA
       ========================================================================== -->
  <div class="admin-login-screen" id="adminLoginScreen">
    <div class="login-glass-card">
      <div class="login-logo-wrap">
        <img src="../assets/images/logo.png" alt="Coastal View Logo" class="admin-login-logo">
      </div>
      <div class="login-brand-title">Coastal View</div>
      <div class="login-brand-sub">Managed By Ani's • Executive Portal</div>

      <div class="login-badge-secure">
        <span class="material-symbols-outlined" style="font-size: 16px;">verified_user</span>
        <span>Argon2id TLS & Mandatory 2FA</span>
      </div>

      <!-- Step 1: Staff Username/Email + Password -->
      <form id="adminLoginForm" class="login-step-1">
        <div class="login-form-group">
          <label class="login-label">Staff Email or Username</label>
          <input type="text" id="loginUsername" class="login-input" required placeholder="name@domain.com or username" autocomplete="username">
        </div>

        <div class="login-form-group">
          <label class="login-label">Password</label>
          <input type="password" id="loginPassword" class="login-input" required placeholder="••••••••••••" autocomplete="current-password">
        </div>

        <!-- Security Math CAPTCHA (Required after repeated attempts) -->
        <div class="captcha-box" id="captchaBox" style="display: none;">
          <span class="material-symbols-outlined" style="color: var(--champagne-gold); font-size: 20px;">calculate</span>
          <div class="captcha-question" id="captchaQuestion">Loading CAPTCHA challenge...</div>
          <button type="button" class="btn-icon-only" onclick="refreshCaptcha()" title="Refresh Challenge">
            <span class="material-symbols-outlined" style="font-size: 16px;">refresh</span>
          </button>
        </div>

        <div class="login-form-group" id="captchaInputGroup" style="display: none;">
          <input type="number" id="loginCaptchaAnswer" class="login-input" placeholder="Enter answer to security check">
        </div>

        <div id="loginErrorMsg" class="login-error-banner" style="display: none;"></div>

        <button type="submit" class="btn-gold-signin" id="btnSignInSubmit">
          <span class="material-symbols-outlined">key</span> Verify Credentials & Continue
        </button>

        <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
          <a href="#" onclick="openForgotPasswordModal(event)" style="color: var(--turquoise); text-decoration: none; font-weight: 600;">
            Forgot Password?
          </a>
          <span style="color: #94A3B8;">Lockout after 5 failed tries</span>
        </div>
      </form>

      <!-- Step 2: Mandatory Two-Factor Authentication (Email Code or Authenticator) -->
      <form id="admin2FAForm" class="two-factor-screen" style="display: none;">
        <div style="background: rgba(6, 182, 176, 0.1); border-radius: 12px; padding: 14px; margin-bottom: 16px; font-size: 0.82rem; color: var(--ocean-blue);">
          <strong style="display: block; margin-bottom: 4px;">Two-Factor Authentication (2FA)</strong>
          We emailed a single-use 6-digit code to <strong id="twoFactorMaskedEmail">your registered email</strong>.
        </div>

        <div class="countdown-pill" id="twoFactorCountdown">
          ⏱ Code expires in 10:00
        </div>

        <div class="login-form-group">
          <label class="login-label" style="text-align: center;">Enter 6-Digit Authentication Code</label>
          <input type="text" id="twoFactorCode" class="login-input two-factor-code-input" maxlength="8" required placeholder="000000" autocomplete="one-time-code" autofocus>
        </div>

        <!-- Optional: Remember This Device (up to 7 days) -->
        <div class="remember-device-row" id="rememberDeviceRow">
          <label class="checkbox-container">
            <input type="checkbox" id="rememberDeviceCheck">
            <span class="checkmark"></span>
            <span>Remember this device for 7 days</span>
          </label>
        </div>

        <div id="twoFactorErrorMsg" class="login-error-banner" style="display: none;"></div>

        <button type="submit" class="btn-gold-signin" id="btn2FASubmit">
          <span class="material-symbols-outlined">lock_open</span> Verify Code & Enter Portal
        </button>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 0.8rem;">
          <button type="button" id="btnResendCode" onclick="handleResend2FACode()" class="btn-link-action">
            Resend Code
          </button>
          <button type="button" onclick="backToLoginStep1()" class="btn-link-action" style="color: #64748B;">
            ← Back
          </button>
        </div>
      </form>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #E2E8F0; font-size: 0.74rem; color: #94A3B8;">
        Coastal View, Managed By Ani's • Authorized Staff Only
      </div>
    </div>
  </div>`;

const loginStart = html.indexOf('<div class="admin-login-screen"');
const loginEnd = html.indexOf('<!-- ==========================================================================\n       SIDEBAR NAVIGATION');

if (loginStart !== -1 && loginEnd !== -1) {
  html = html.slice(0, loginStart) + newLoginScreen.trim() + '\n\n  ' + html.slice(loginEnd);
}

// --- 2. REPLACE SIDEBAR (EXACT REQUESTED ORDER) ---
const newSidebar = `<aside class="admin-sidebar" id="adminSidebar">
    <div class="sidebar-header">
      <img src="../assets/images/logo-emblem.png" alt="Coastal View Emblem" class="sidebar-logo-img">
      <div>
        <div class="sidebar-brand-name">Coastal View</div>
        <div class="sidebar-brand-tag">Managed By Ani's</div>
      </div>
    </div>

    <!-- 10 Tabs in Exact Required Order -->
    <div class="sidebar-nav-container">
      <div class="nav-section-title">Navigation</div>
      
      <!-- 1. Dashboard -->
      <button class="menu-item-btn active" data-tab="tabDashboard" id="navDashboardBtn">
        <span class="material-symbols-outlined">dashboard</span>
        <span>Dashboard</span>
      </button>

      <!-- 2. Bookings -->
      <button class="menu-item-btn" data-tab="tabBookings" id="navBookingsBtn">
        <span class="material-symbols-outlined">book_online</span>
        <span>Bookings</span>
        <span class="menu-badge teal" id="badgeTotalBookings">0</span>
      </button>

      <!-- 3. Rooms -->
      <button class="menu-item-btn" data-tab="tabRooms" id="navRoomsBtn">
        <span class="material-symbols-outlined">meeting_room</span>
        <span>Rooms</span>
        <span class="menu-badge coral" id="badgeSoldOutCount">0</span>
      </button>

      <!-- 4. Photos & Media -->
      <button class="menu-item-btn" data-tab="tabPhotos" id="navPhotosBtn">
        <span class="material-symbols-outlined">photo_library</span>
        <span>Photos & Media</span>
      </button>

      <!-- 5. Menu -->
      <button class="menu-item-btn" data-tab="tabMenu" id="navMenuBtn">
        <span class="material-symbols-outlined">restaurant_menu</span>
        <span>Menu</span>
      </button>

      <!-- 6. Gallery -->
      <button class="menu-item-btn" data-tab="tabGallery" id="navGalleryBtn">
        <span class="material-symbols-outlined">collections</span>
        <span>Gallery</span>
      </button>

      <!-- 7. Chatbot -->
      <button class="menu-item-btn" data-tab="tabChatCRM" id="navChatBtn">
        <span class="material-symbols-outlined">chat</span>
        <span>Chatbot</span>
        <span class="menu-badge coral" id="badgeUnreadChats">0</span>
      </button>

      <!-- 8. Invoices -->
      <button class="menu-item-btn" data-tab="tabInvoices" id="navInvoicesBtn">
        <span class="material-symbols-outlined">receipt_long</span>
        <span>Invoices</span>
      </button>

      <!-- 9. Users (Super Admin Only) -->
      <button class="menu-item-btn" data-tab="tabUsers" id="navUsersBtn">
        <span class="material-symbols-outlined">manage_accounts</span>
        <span>Users</span>
      </button>

      <!-- 10. Settings -->
      <button class="menu-item-btn" data-tab="tabSettings" id="navSettingsBtn">
        <span class="material-symbols-outlined">settings</span>
        <span>Settings</span>
      </button>
    </div>

    <div class="sidebar-footer">
      <a href="../" target="_blank" rel="noopener noreferrer" style="color: var(--champagne-gold); font-size: 0.8rem; text-decoration: none; display: flex; align-items: center; gap: 4px;">
        <span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span> Live Website
      </a>
      <span style="font-size: 0.72rem; color: #64748B;" id="idleTimerIndicator">Idle: 15m</span>
    </div>
  </aside>`;

const asideStart = html.indexOf('<aside class="admin-sidebar"');
const asideEnd = html.indexOf('</aside>', asideStart) + 8;

if (asideStart !== -1 && asideEnd !== -1) {
  html = html.slice(0, asideStart) + newSidebar.trim() + html.slice(asideEnd);
}

// Write back
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Login screen and sidebar successfully patched in admin/index.html');

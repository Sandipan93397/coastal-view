/**
 * Script to apply full server.js security patches
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let serverJs = fs.readFileSync(serverPath, 'utf8');

const authSectionReplacement = `// --- AUTHENTICATION & SESSION MIDDLEWARE ---

// Middleware: Authenticate Session and update idle timer
function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\\s+/i, '').trim() : null);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
  }

  const session = activeSessions.get(token);
  if (!session) {
    res.clearCookie('admin_session');
    res.clearCookie('admin_csrf');
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please sign in again.' });
  }

  const now = Date.now();
  if (now - session.lastActive > IDLE_TIMEOUT_MS) {
    activeSessions.delete(token);
    res.clearCookie('admin_session');
    res.clearCookie('admin_csrf');
    return res.status(401).json({ success: false, message: 'Session expired due to 15 minutes of inactivity.' });
  }

  // Slide idle timeout window
  session.lastActive = now;
  req.user = session;
  req.token = token;
  next();
}

// Middleware: Role-Based Access Control
function requireRole(allowedRoles) {
  return (req, res, next) => {
    requireAdmin(req, res, () => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: \`Access denied. Role "\${req.user.role}" does not have permission for this action.\`
        });
      }
      next();
    });
  };
}

const requireSuperAdmin = requireRole(['Super Admin']);
const requireManager = requireRole(['Super Admin', 'Manager']);
const requireAnyStaff = requireRole(['Super Admin', 'Manager', 'Front Desk']);

// Sensitive action re-auth middleware (requires password entry within last 5 minutes)
function requireReauth(req, res, next) {
  if (!req.user || !req.user.reauthUntil || Date.now() > req.user.reauthUntil) {
    return res.status(403).json({
      success: false,
      requireReauth: true,
      message: 'Sensitive action requires password re-entry for security confirmation.'
    });
  }
  next();
}

// CSRF validation on state-changing requests
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const publicPrefixes = [
    '/api/bookings',
    '/api/chat',
    '/api/concierge',
    '/api/auth/login',
    '/api/auth/verify-2fa',
    '/api/auth/resend-code',
    '/api/auth/captcha',
    '/api/auth/forgot-password',
    '/api/auth/reset-password'
  ];
  if (publicPrefixes.some(p => req.path.startsWith(p))) {
    return next();
  }

  if (req.cookies.admin_session) {
    const clientCsrf = req.headers['x-csrf-token'];
    if (!clientCsrf || !req.user || clientCsrf !== req.user.csrfToken) {
      return res.status(403).json({ success: false, message: 'Security token mismatch (CSRF protected).' });
    }
  }
  next();
}

app.use(verifyCsrf);

// ============================================================================
// AUTHENTICATION & SECURITY APIS
// ============================================================================

// 1. CAPTCHA Challenge Generator
app.get('/api/auth/captcha', (req, res) => {
  const num1 = Math.floor(Math.random() * 12) + 3;
  const num2 = Math.floor(Math.random() * 9) + 2;
  const captchaId = crypto.randomBytes(16).toString('hex');
  const answer = num1 + num2;

  captchaStore.set(captchaId, {
    answer,
    expiresAt: Date.now() + 3 * 60 * 1000 // 3 minutes validity
  });

  res.json({
    success: true,
    captchaId,
    question: \`\${num1} + \${num2} = ?\`
  });
});

// 2. Step 1: Primary Authentication (Email/Username + Password)
app.post('/api/auth/login', async (req, res) => {
  try {
    const loginSchema = z.object({
      username: z.string().min(1).max(128),
      password: z.string().min(1).max(128),
      captchaId: z.string().optional(),
      captchaAnswer: z.string().optional()
    });

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid credentials format.' });
    }

    const { username, password, captchaId, captchaAnswer } = parsed.data;
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');

    // Check progressive brute-force lockout
    const lockout = checkLockout(username, clientIp);
    if (lockout.isLocked) {
      return res.status(429).json({ success: false, message: lockout.message });
    }

    // Check CAPTCHA if challenge passed
    if (captchaId) {
      const captcha = captchaStore.get(captchaId);
      if (!captcha || Date.now() > captcha.expiresAt) {
        captchaStore.delete(captchaId);
        return res.status(400).json({ success: false, message: 'Security CAPTCHA challenge expired. Please refresh.' });
      }
      if (parseInt(captchaAnswer, 10) !== captcha.answer) {
        return res.status(400).json({ success: false, message: 'Incorrect CAPTCHA answer.' });
      }
      captchaStore.delete(captchaId);
    }

    const db = readDB();
    if (!db) return res.status(500).json({ success: false, message: 'Database error' });

    // Look up user by username or email
    const user = (db.users || []).find(u => 
      u.username.toLowerCase() === username.toLowerCase() || 
      (u.email && u.email.toLowerCase() === username.toLowerCase())
    );

    let isMatch = false;
    if (user) {
      isMatch = await verifyPassword(password, user.passwordHash, user, db);
    }

    if (!user || !isMatch) {
      const failedCount = recordFailedAttempt(username, clientIp);
      db.loginHistory = db.loginHistory || [];
      db.loginHistory.unshift({
        id: \`login-\${Date.now()}\`,
        timestamp: new Date().toISOString(),
        username: username || 'Unknown',
        ip: clientIp,
        status: failedCount >= 5 ? 'Locked Out' : 'Failed'
      });
      logAudit(db, username || 'Anonymous', 'Failed Login Attempt', \`Failed login attempt from IP \${clientIp} for "\${username}". Attempts: \${failedCount}/5\`, req);

      // Alert Super Admin if lockout triggered
      if (failedCount >= 5) {
        sendSuperAdminAlert(
          \`Repeated Failed Login Attempts Lockout (\${username})\`,
          \`5 consecutive failed login attempts detected for account <strong>\${username}</strong> from IP <code>\${clientIp}</code>. Account is locked for 15 minutes.\`,
          db
        );
      }

      writeDB(db);

      // Generic error response to prevent account enumeration
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        requireCaptcha: failedCount >= 3
      });
    }

    // Reset failed login attempts on credential success
    resetFailedAttempts(username, clientIp);

    // Check if device is remembered (up to 7 days)
    const rememberCookie = req.cookies.remember_device;
    const allowRemember = db.settings?.allowRememberDevice !== false;

    if (allowRemember && rememberCookie && db.rememberedDevices) {
      const hashedCookie = crypto.createHash('sha256').update(rememberCookie).digest('hex');
      const remembered = db.rememberedDevices.find(d => d.tokenHash === hashedCookie && d.username === user.username && Date.now() < d.expiresAt);
      if (remembered) {
        // Device is verified! Issue session directly
        const token = crypto.randomBytes(32).toString('hex');
        const csrfToken = crypto.randomBytes(32).toString('hex');

        activeSessions.set(token, {
          token,
          username: user.username,
          role: user.role,
          name: user.name,
          email: user.email,
          csrfToken,
          lastActive: Date.now(),
          createdAt: Date.now(),
          ip: clientIp,
          device: parseDeviceString(req.headers['user-agent'])
        });

        res.cookie('admin_session', token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: IDLE_TIMEOUT_MS
        });
        res.cookie('admin_csrf', csrfToken, {
          sameSite: 'strict',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: IDLE_TIMEOUT_MS
        });

        logAudit(db, user, 'Staff Login (Remembered Device)', \`User \${user.username} signed in from recognized device (\${clientIp}).\`, req);
        writeDB(db);

        return res.json({
          success: true,
          token,
          csrfToken,
          user: { username: user.username, role: user.role, name: user.name, email: user.email },
          message: 'Welcome back. Device recognized.'
        });
      }
    }

    // MANDATORY STEP 2: Issue 6-digit cryptographic code via Email
    const rawCode = generateAuthCode();
    const codeHash = hashAuthCode(rawCode);
    const preAuthToken = crypto.randomBytes(32).toString('hex');
    const device = parseDeviceString(req.headers['user-agent']);

    preAuthStore.set(preAuthToken, {
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      codeHash,
      codeAttempts: 0,
      totpSecret: user.totpSecret || null,
      backupCodes: user.backupCodes || [],
      hasTotp: !!user.totpSecret,
      ip: clientIp,
      device,
      expiresAt: Date.now() + CODE_EXPIRY_MS
    });

    // Send code via SMTP
    const emailResult = await sendAuthCodeEmail({
      to: user.email,
      code: rawCode,
      ip: clientIp,
      device,
      db
    });

    if (!emailResult.success) {
      preAuthStore.delete(preAuthToken);
      return res.status(502).json({
        success: false,
        message: 'Could not deliver the authentication code email. Please verify SMTP settings in .env. The second verification step cannot be bypassed.'
      });
    }

    logAudit(db, user, '2FA Code Dispatched', \`6-digit login verification code sent to \${user.email} from IP \${clientIp}.\`, req);
    writeDB(db);

    const maskedEmail = user.email ? user.email.replace(/(.{2})(.*)(@.*)/, '$1••••$3') : 'Registered Email';

    return res.json({
      success: true,
      require2FA: true,
      preAuthToken,
      maskedEmail,
      hasTotp: !!user.totpSecret,
      message: \`A 6-digit verification code has been dispatched to \${maskedEmail}. Enter the code within 10 minutes to access the admin portal.\`
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Authentication processing error' });
  }
});

// 3. Resend 2FA Code
app.post('/api/auth/resend-code', async (req, res) => {
  const { preAuthToken } = req.body;
  if (!preAuthToken) {
    return res.status(400).json({ success: false, message: 'Missing pre-authentication session token.' });
  }

  const preAuth = preAuthStore.get(preAuthToken);
  if (!preAuth || Date.now() > preAuth.expiresAt) {
    preAuthStore.delete(preAuthToken);
    return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
  }

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');
  const throttleCheck = canRequestCode(\`\${preAuth.username}_\${clientIp}\`);
  if (!throttleCheck.allowed) {
    return res.status(429).json({ success: false, message: throttleCheck.message });
  }

  const newCode = generateAuthCode();
  preAuth.codeHash = hashAuthCode(newCode);
  preAuth.codeAttempts = 0;
  preAuth.expiresAt = Date.now() + CODE_EXPIRY_MS;

  const db = readDB();
  const emailResult = await sendAuthCodeEmail({
    to: preAuth.email,
    code: newCode,
    ip: clientIp,
    device: preAuth.device,
    db
  });

  if (!emailResult.success) {
    return res.status(502).json({ success: false, message: 'Failed to deliver new code. Please check SMTP settings.' });
  }

  if (db) writeDB(db);

  res.json({
    success: true,
    message: 'A fresh 6-digit authentication code has been sent to your email.'
  });
});

// 4. Verify 2FA Code (or TOTP / Backup Code) & Issue Session
app.post('/api/auth/verify-2fa', async (req, res) => {
  const { preAuthToken, code, rememberDevice } = req.body;
  if (!preAuthToken || !code) {
    return res.status(400).json({ success: false, message: 'Please provide both preAuthToken and the 6-digit verification code.' });
  }

  const preAuth = preAuthStore.get(preAuthToken);
  if (!preAuth || Date.now() > preAuth.expiresAt) {
    preAuthStore.delete(preAuthToken);
    return res.status(401).json({ success: false, message: 'Verification code session expired. Please sign in again.' });
  }

  if (preAuth.codeAttempts >= 5) {
    preAuthStore.delete(preAuthToken);
    return res.status(429).json({ success: false, message: 'Maximum attempts (5) exceeded for this code. Please sign in again.' });
  }

  const cleanCode = code.trim();
  let isValid = false;

  // A. Check Email 6-Digit Code
  const inputHash = hashAuthCode(cleanCode);
  if (inputHash === preAuth.codeHash) {
    isValid = true;
  }

  // B. Check TOTP Authenticator App if enabled
  if (!isValid && preAuth.totpSecret) {
    isValid = verifyTotp(preAuth.totpSecret, cleanCode);
  }

  // C. Check One-time Backup Codes
  if (!isValid && Array.isArray(preAuth.backupCodes) && preAuth.backupCodes.length > 0) {
    const backupHash = crypto.createHash('sha256').update(cleanCode.toUpperCase()).digest('hex');
    const backupIdx = preAuth.backupCodes.indexOf(backupHash);
    if (backupIdx !== -1) {
      isValid = true;
      // Consume backup code
      preAuth.backupCodes.splice(backupIdx, 1);
      const db = readDB();
      const user = (db.users || []).find(u => u.username === preAuth.username);
      if (user) {
        user.backupCodes = preAuth.backupCodes;
        writeDB(db);
      }
    }
  }

  if (!isValid) {
    preAuth.codeAttempts += 1;
    const remaining = 5 - preAuth.codeAttempts;
    if (preAuth.codeAttempts >= 5) {
      preAuthStore.delete(preAuthToken);
      return res.status(429).json({ success: false, message: 'Maximum attempts exceeded. Code invalidated.' });
    }
    return res.status(401).json({
      success: false,
      message: \`Invalid verification code. \${remaining} attempt(s) remaining.\`
    });
  }

  // Code verified! Remove preAuth
  preAuthStore.delete(preAuthToken);

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');
  const device = parseDeviceString(req.headers['user-agent']);

  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');

  const sessionData = {
    token,
    username: preAuth.username,
    role: preAuth.role,
    name: preAuth.name,
    email: preAuth.email,
    csrfToken,
    ip: clientIp,
    device,
    createdAt: new Date().toISOString(),
    lastActive: Date.now()
  };

  activeSessions.set(token, sessionData);

  // Set HttpOnly, SameSite=Strict cookies
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: IDLE_TIMEOUT_MS
  });

  res.cookie('admin_csrf', csrfToken, {
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: IDLE_TIMEOUT_MS
  });

  const db = readDB();
  db.loginHistory = db.loginHistory || [];

  // Check if new device / new IP
  const pastLogins = db.loginHistory.filter(l => l.username === preAuth.username && l.status === 'Success');
  const isNewDeviceOrIp = pastLogins.length > 0 && !pastLogins.some(l => l.ip === clientIp);

  db.loginHistory.unshift({
    id: \`login-\${Date.now()}\`,
    timestamp: new Date().toISOString(),
    username: preAuth.username,
    role: preAuth.role,
    ip: clientIp,
    device,
    status: 'Success'
  });
  if (db.loginHistory.length > 500) db.loginHistory = db.loginHistory.slice(0, 500);

  // Handle "Remember this device" (up to 7 days)
  if (rememberDevice && db.settings?.allowRememberDevice !== false) {
    const rawDeviceToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
    db.rememberedDevices = db.rememberedDevices || [];
    db.rememberedDevices.push({
      tokenHash,
      username: preAuth.username,
      device,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    // Set 7-day device cookie
    res.cookie('remember_device', rawDeviceToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  logAudit(db, sessionData, 'Staff Login Success', \`\${sessionData.role} "\${sessionData.username}" signed in with verified 2FA code from IP \${clientIp}.\`, req);

  // Send alert if new device
  if (isNewDeviceOrIp) {
    sendSuperAdminAlert(
      \`New Device Sign-In: \${preAuth.username}\`,
      \`A successful 2FA login was completed for user <strong>\${preAuth.username}</strong> from a new IP address <code>\${clientIp}</code> (\${device}). If this wasn’t authorized, change your password immediately.\`,
      db
    );
  }

  writeDB(db);

  return res.json({
    success: true,
    token,
    csrfToken,
    user: {
      username: sessionData.username,
      role: sessionData.role,
      name: sessionData.name,
      email: sessionData.email
    },
    message: 'Two-factor authentication verified. Welcome to Coastal View Management.'
  });
});

// 5. Verify Active Session
app.get('/api/auth/verify', requireAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Session valid',
    csrfToken: req.user.csrfToken,
    user: {
      username: req.user.username,
      role: req.user.role,
      name: req.user.name,
      email: req.user.email
    }
  });
});

// 6. Sensitive Action Re-Authentication (elevates session for 5 minutes)
app.post('/api/auth/reauth', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required for sensitive confirmation.' });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const isMatch = await verifyPassword(password, user.passwordHash, user, db);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Incorrect password confirmation.' });
  }

  req.user.reauthUntil = Date.now() + SENSITIVE_REAUTH_WINDOW_MS;
  res.json({ success: true, message: 'Sensitive action confirmed. Access elevated for 5 minutes.' });
});

// 7. Logout Current Device
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.admin_session || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\\s+/i, '').trim() : null);

  if (token) {
    const session = activeSessions.get(token);
    if (session) {
      const db = readDB();
      logAudit(db, session, 'Staff Logout', \`\${session.role} "\${session.username}" logged out.\`, req);
      writeDB(db);
      activeSessions.delete(token);
    }
  }

  res.clearCookie('admin_session');
  res.clearCookie('admin_csrf');
  res.json({ success: true, message: 'Logged out successfully' });
});

// 8. Log Out All Devices
app.post('/api/auth/logout-all', requireAdmin, (req, res) => {
  const currentUsername = req.user.username;
  let count = 0;

  for (const [t, s] of activeSessions.entries()) {
    if (s.username === currentUsername) {
      activeSessions.delete(t);
      count++;
    }
  }

  res.clearCookie('admin_session');
  res.clearCookie('admin_csrf');

  const db = readDB();
  logAudit(db, req.user, 'Log Out All Devices', \`User \${currentUsername} terminated all active sessions (\${count}) across all devices.\`, req);
  writeDB(db);

  res.json({ success: true, message: \`Terminated \${count} active session(s). Please sign in again.\` });
});

// 9. Change Password (Authenticated) - Enforces Argon2 & terminates other sessions
app.post('/api/auth/change-password', requireAnyStaff, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const isMatch = await verifyPassword(currentPassword, user.passwordHash, user, db);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  user.passwordHash = await hashPassword(newPassword);

  // Terminate all OTHER sessions for this user
  for (const [t, s] of activeSessions.entries()) {
    if (s.username === req.user.username && t !== req.token) {
      activeSessions.delete(t);
    }
  }

  logAudit(db, req.user, 'Password Changed', \`User \${req.user.username} changed account password. All other active sessions terminated.\`, req);

  // Alert Super Admin
  sendSuperAdminAlert(
    \`Password Changed: \${req.user.username}\`,
    \`The account password for <strong>\${req.user.username}</strong> was successfully changed. All other sessions have been logged out.\`,
    db
  );

  writeDB(db);

  res.json({ success: true, message: 'Password updated successfully with Argon2id. All other sessions have been signed out.' });
});

// 10. Forgot Password Flow: 30-Minute Expiring Single-Use Token
app.post('/api/auth/forgot-password', async (req, res) => {
  const { identifier } = req.body;
  const db = readDB();
  const user = (db.users || []).find(u => 
    u.username.toLowerCase() === (identifier || '').toLowerCase() || 
    (u.email && u.email.toLowerCase() === (identifier || '').toLowerCase())
  );

  if (!user) {
    // Prevent account enumeration
    return res.json({ success: true, message: 'If that account exists, a 30-minute password reset link has been dispatched to its registered email.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes validity

  db.passwordResetTokens = db.passwordResetTokens || [];
  db.passwordResetTokens.push({
    token: resetToken,
    username: user.username,
    expiresAt,
    used: false
  });

  const resetLink = \`http://localhost:\${PORT}/admin/?reset_token=\${resetToken}\`;

  db.emailOutbox = db.emailOutbox || [];
  db.emailOutbox.unshift({
    id: \`reset-\${Date.now()}\`,
    to: user.email,
    subject: 'Coastal View Admin - Single-Use 30-Minute Password Reset Link',
    html: \`<p>Hello \${user.name},</p><p>A password reset was requested for your Coastal View account. This link expires in 30 minutes and can only be used once:</p><p><a href="\${resetLink}">Reset Password</a></p><p>Token: <code>\${resetToken}</code></p>\`,
    sentAt: new Date().toISOString(),
    status: 'Dispatched'
  });

  logAudit(db, user, 'Password Reset Requested', \`Single-use 30-minute password reset token generated for \${user.username}.\`, req);
  writeDB(db);

  res.json({
    success: true,
    message: 'If that account exists, a 30-minute password reset link has been dispatched to its registered email.'
  });
});

// 11. Reset Password Flow: Apply New Password & Invalidate All Sessions
app.post('/api/auth/reset-password', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing token or password.' });
  }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  db.passwordResetTokens = db.passwordResetTokens || [];
  const tokenIdx = db.passwordResetTokens.findIndex(t => t.token === resetToken && !t.used && Date.now() < t.expiresAt);

  if (tokenIdx === -1) {
    return res.status(400).json({ success: false, message: 'Password reset link is invalid or has expired (30-minute window).' });
  }

  const item = db.passwordResetTokens[tokenIdx];
  const user = (db.users || []).find(u => u.username === item.username);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User account not found.' });
  }

  user.passwordHash = await hashPassword(newPassword);
  item.used = true; // Single-use!
  db.passwordResetTokens.splice(tokenIdx, 1);

  // Terminate ALL sessions for this user
  for (const [t, s] of activeSessions.entries()) {
    if (s.username === user.username) activeSessions.delete(t);
  }

  logAudit(db, user, 'Password Reset Completed', \`Password successfully updated via expiring reset token for \${user.username}. All active sessions invalidated.\`, req);
  writeDB(db);

  res.json({ success: true, message: 'Password reset successfully with Argon2id! Please sign in with your new password.' });
});

// 12. Optional TOTP Authenticator Setup
app.post('/api/auth/totp/setup', requireAdmin, requireReauth, (req, res) => {
  const secret = generateTotpSecret();
  const { codes, hashed } = generateBackupCodes();
  const issuer = process.env.TOTP_ISSUER || 'CoastalViewMandarmani';
  const otpauthUrl = \`otpauth://totp/\${issuer}:\${req.user.username}?secret=\${secret}&issuer=\${issuer}\`;

  res.json({
    success: true,
    secret,
    otpauthUrl,
    backupCodes: codes,
    hashedBackupCodes: hashed,
    message: 'Scan the QR code or enter the secret in your authenticator app, then confirm with a 6-digit code.'
  });
});

app.post('/api/auth/totp/confirm', requireAdmin, (req, res) => {
  const { secret, code, hashedBackupCodes } = req.body;
  if (!secret || !code) {
    return res.status(400).json({ success: false, message: 'Secret and verification code are required.' });
  }

  const isValid = verifyTotp(secret, code);
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Invalid authenticator code. Check your device clock.' });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.totpSecret = secret;
  user.backupCodes = hashedBackupCodes || [];

  logAudit(db, req.user, 'TOTP 2FA Enabled', \`Authenticator app 2FA enabled for \${req.user.username}.\`, req);
  writeDB(db);

  res.json({ success: true, message: 'Authenticator app enabled successfully for your account!' });
});

app.post('/api/auth/totp/disable', requireAdmin, requireReauth, (req, res) => {
  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.totpSecret = null;
  user.backupCodes = [];

  logAudit(db, req.user, 'TOTP 2FA Disabled', \`Authenticator app 2FA disabled for \${req.user.username}.\`, req);
  writeDB(db);

  res.json({ success: true, message: 'Authenticator app removed. Email 2FA remains active.' });
});

// 13. Super Admin Encrypted Database Export (AES-256-GCM)
app.get('/api/admin/backup/export-encrypted', requireSuperAdmin, requireReauth, (req, res) => {
  try {
    const encryptedBuffer = exportEncryptedDatabase(process.env.SESSION_SECRET);
    const today = new Date().toISOString().split('T')[0];
    const filename = \`coastalview-db-encrypted-\${today}.enc\`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', \`attachment; filename="\${filename}"\`);
    res.send(encryptedBuffer);

    const db = readDB();
    logAudit(db, req.user, 'Encrypted Backup Exported', \`Super Admin downloaded AES-256-GCM encrypted database export.\`, req);
    writeDB(db);
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});
`;

const startMarker = '// --- SESSION & RATE LIMITING STATE (IN-MEMORY) ---';
const endMarker = '// ============================================================================\n// ROOM INVENTORY & SOLD-OUT CONTROL APIS';

const startIdx = serverJs.indexOf(startMarker);
const endIdx = serverJs.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Failed to find auth replacement range');
  process.exit(1);
}

serverJs = serverJs.slice(0, startIdx) + authSectionReplacement.trim() + '\n\n' + serverJs.slice(endIdx);

fs.writeFileSync(serverPath, serverJs, 'utf8');
console.log('Auth & Session replacement applied successfully.');

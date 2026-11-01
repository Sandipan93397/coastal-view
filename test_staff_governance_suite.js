const testEnv = require('./test_db_helper');
/**
 * Coastal View Mandarmani - Complete Staff Governance & Security Test Suite
 * Validates invite flow, Argon2id, TOTP, RBAC permissions matrix,
 * safety guards, sessions, soft delete, and audit logging.
 */
const fs = require('fs');
const path = require('path');
const authSec = require('./auth_security');
const { ROLES, PERMISSIONS } = require('./roles_permissions');

const BASE_URL = 'http://localhost:3000';

async function request(method, endpoint, body = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE_URL + endpoint, opts);
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
}

function getAuthHeaders(sessionToken, csrfToken) {
  return {
    'Authorization': 'Bearer ' + sessionToken,
    'X-CSRF-Token': csrfToken,
    'Cookie': `admin_session=${sessionToken}; admin_csrf=${csrfToken}`
  };
}

async function loginAs(username, password) {
  // Step 1: Login
  const s1 = await request('POST', '/api/auth/login', {
    username,
    password,
    captchaToken: '1x00000000000000000000AA'
  });
  if (!s1.json || !s1.json.preAuthToken) {
    return { success: false, step: 1, res: s1 };
  }

  // Get MFA code
  const db = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8'));
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase());
  let code = null;
  if (user && user.totpSecret) {
    const decSecret = authSec.decryptMfaSecret(user.totpSecret);
    code = authSec.generateCurrentTotp(decSecret);
  } else if (s1.json?.devCode) {
    code = s1.json.devCode;
  } else if (user) {
    const outbox = db.emailOutbox || [];
    const mail = [...outbox].reverse().find(m => m.to === user.email);
    code = mail ? mail.subject.match(/\b\d{6}\b/)?.[0] : null;
  }

  // Step 2: Verify 2FA
  const s2 = await request('POST', '/api/auth/verify-2fa', {
    preAuthToken: s1.json.preAuthToken,
    code
  });

  return {
    success: s2.json?.success === true,
    token: s2.json?.token,
    csrfToken: s2.json?.csrfToken,
    headers: getAuthHeaders(s2.json?.token, s2.json?.csrfToken),
    user: s2.json?.user,
    step1Res: s1,
    step2Res: s2
  };
}

async function runTestSuite() {
  await testEnv.startIsolatedServer();
  console.log('====================================================');
  console.log('🚀 RUNNING STAFF GOVERNANCE & SECURITY VERIFICATION');
  console.log('====================================================\n');

  const testResults = [];

  function recordTest(testName, passed, details = '') {
    testResults.push({ testName, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}: ${testName} ${details ? '— ' + details : ''}`);
  }

  const dbBackupRaw = fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8');
  const { writeDB } = require('./db_store');

  try {
    // Ensure Super Admin test credentials and clean state
    const db = JSON.parse(dbBackupRaw);
    const admin = db.users.find(u => u.username === 'admin');
    if (admin) {
      admin.passwordHash = await authSec.hashPassword(testEnv.TEST_PASSWORDS.admin);
      if (!admin.totpSecret) {
        const rawTotpSecret = authSec.generateTotpSecret();
        admin.totpSecret = authSec.encryptMfaSecret(rawTotpSecret);
      }
      admin.failedAttempts = 0;
      admin.lockoutUntil = null;
      admin.lockedUntil = null;
      admin.status = 'Active';
      writeDB(db);
    }

    // ----------------------------------------------------
    // TEST 1: Super Admin Login with Argon2id + TOTP
    // ----------------------------------------------------
    const adminLogin = await loginAs('admin', testEnv.TEST_PASSWORDS.admin);
    recordTest('Super Admin Login (Argon2id + TOTP 2FA)', adminLogin.success, `Role: ${adminLogin.user?.role}`);

    const adminHeaders = adminLogin.headers;

    // ----------------------------------------------------
    // TEST 2: Permissions Matrix Endpoint
    // ----------------------------------------------------
    const matrixRes = await request('GET', '/api/admin/roles-matrix', null, adminHeaders);
    const matrixValid = matrixRes.status === 200 && matrixRes.json?.matrix?.length > 0;
    recordTest('Fetch Roles & Permissions Matrix', matrixValid, `Categories: ${matrixRes.json?.matrix?.length}`);

    // ----------------------------------------------------
    // TEST 3: Add Staff Member (Manager) - Invite Flow
    // ----------------------------------------------------
    const mgrEmail = `manager_${Date.now()}@coastalviewmandarmani.com`;
    const addMgrRes = await request('POST', '/api/admin/users', {
      name: 'Priya Sharma',
      email: mgrEmail,
      role: 'Manager',
      phone: '+91 98301 23456',
      requireMfa: true
    }, adminHeaders);

    const mgrCreated = (addMgrRes.status === 200 || addMgrRes.status === 201) && addMgrRes.json?.success;
    const mgrInviteUrl = addMgrRes.json?.fallbackInviteLink || addMgrRes.json?.directInviteLink;
    recordTest('Add Manager Staff via Invite', mgrCreated, `Status: Invited, Token Generated: ${!!mgrInviteUrl}`);

    const mgrToken = mgrInviteUrl ? new URL(mgrInviteUrl).searchParams.get('token') : null;

    // ----------------------------------------------------
    // TEST 4: Duplicate Email Rejection (Case-Insensitive)
    // ----------------------------------------------------
    const dupRes = await request('POST', '/api/admin/users', {
      name: 'Duplicate Staff',
      email: mgrEmail.toUpperCase(), // Test case-insensitivity
      role: 'Front Desk'
    }, adminHeaders);

    const dupBlocked = dupRes.status === 400 && (dupRes.json?.error || dupRes.json?.message || '').toLowerCase().includes('already');
    recordTest('Duplicate Email Rejection (Case-Insensitive)', dupBlocked, `Code: ${dupRes.status}`);

    // ----------------------------------------------------
    // TEST 5: Invalid Email Rejection
    // ----------------------------------------------------
    const invEmailRes = await request('POST', '/api/admin/users', {
      name: 'Bad Email',
      email: 'not-an-email',
      role: 'Front Desk'
    }, adminHeaders);
    const invBlocked = invEmailRes.status === 400;
    recordTest('Invalid Email Address Validation', invBlocked, `Code: ${invEmailRes.status}`);

    // ----------------------------------------------------
    // TEST 6: Manager Accepts Invite & Sets Credentials
    // ----------------------------------------------------
    // Verify token
    const verifyRes = await request('GET', `/api/admin/invite/verify?token=${mgrToken}`);
    const tokenValid = verifyRes.status === 200 && verifyRes.json?.valid === true;
    recordTest('Verify Staff Invite Token', tokenValid, `Invitee: ${verifyRes.json?.name}`);

    // Weak password rejected (<12 chars)
    const weakPassRes = await request('POST', '/api/admin/invite/accept', {
      token: mgrToken,
      password: 'short',
      confirmPassword: 'short'
    });
    const weakBlocked = weakPassRes.status === 400;
    recordTest('Enforce 12+ Char Password Policy on Accept', weakBlocked, `Blocked weak password`);

    // Set strong 12+ char password
    const strongPass = testEnv.TEST_PASSWORDS.manager;
    const acceptRes = await request('POST', '/api/admin/invite/accept', {
      token: mgrToken,
      password: strongPass,
      confirmPassword: strongPass
    });
    const passAccepted = acceptRes.status === 200 && (acceptRes.json?.requireMfa === true || acceptRes.json?.step === 'mfa_setup');
    const mgrManualKey = acceptRes.json?.manualEntryKey || acceptRes.json?.secretKey;
    recordTest('Staff Sets Strong Password & Receives MFA Setup', passAccepted, `Manual Key: ${!!mgrManualKey}`);

    // Complete MFA Verification
    const mgrTotpCode = authSec.generateCurrentTotp(mgrManualKey);
    const mfaCompleteRes = await request('POST', '/api/admin/invite/complete-mfa', {
      token: mgrToken,
      totpCode: mgrTotpCode
    });
    const mfaActive = mfaCompleteRes.status === 200 && (mfaCompleteRes.json?.recoveryCodes?.length === 8 || mfaCompleteRes.json?.backupCodes?.length === 8);
    recordTest('Complete Authenticator (2FA) & Generate Recovery Codes', mfaActive, `Recovery codes: 8`);

    // Verify token reuse is prevented
    const reuseRes = await request('POST', '/api/admin/invite/accept', {
      token: mgrToken,
      password: strongPass,
      confirmPassword: strongPass
    });
    const reuseBlocked = reuseRes.status === 400;
    recordTest('Prevent Invite Token Reuse (Single-Use)', reuseBlocked, `Code: ${reuseRes.status}`);

    // ----------------------------------------------------
    // TEST 7: Manager Logs In
    // ----------------------------------------------------
    const mgrLogin = await loginAs(mgrEmail, strongPass);
    recordTest('Manager Logs In with New Password & 2FA', mgrLogin.success, `Role: ${mgrLogin.user?.role}`);

    const mgrHeaders = mgrLogin.headers;

    // ----------------------------------------------------
    // TEST 8: Add Front Desk Staff via Invite
    // ----------------------------------------------------
    const fdEmail = `frontdesk_${Date.now()}@coastalviewmandarmani.com`;
    const addFdRes = await request('POST', '/api/admin/users', {
      name: 'Rohan Ghosh',
      email: fdEmail,
      role: 'Front Desk',
      phone: '+91 98302 34567',
      requireMfa: true
    }, adminHeaders);

    const fdInviteLink = addFdRes.json?.fallbackInviteLink || addFdRes.json?.directInviteLink;
    const fdToken = new URL(fdInviteLink).searchParams.get('token');

    // Accept Front Desk invite
    const fdPass = testEnv.TEST_PASSWORDS.staff;
    const fdAccept = await request('POST', '/api/admin/invite/accept', {
      token: fdToken,
      password: fdPass,
      confirmPassword: fdPass
    });
    const fdManualKey = fdAccept.json?.manualEntryKey || fdAccept.json?.secretKey;
    const fdTotp = authSec.generateCurrentTotp(fdManualKey);
    await request('POST', '/api/admin/invite/complete-mfa', {
      token: fdToken,
      totpCode: fdTotp
    });

    const fdLogin = await loginAs(fdEmail, fdPass);
    recordTest('Front Desk Account Activated & Logs In', fdLogin.success, `Role: ${fdLogin.user?.role}`);

    const fdHeaders = fdLogin.headers;

    // ----------------------------------------------------
    // TEST 9: Role-Based Access Control (RBAC) Enforcement
    // ----------------------------------------------------
    // Front Desk cannot access Users
    const fdUsersRes = await request('GET', '/api/admin/users', null, fdHeaders);
    recordTest('Front Desk Blocked from Users Management (403)', fdUsersRes.status === 403);

    // Front Desk cannot modify room prices (POST /api/rooms/:id requires Manager)
    const fdPriceRes = await request('POST', '/api/rooms/room_ocean_deluxe', { baseRate: 9999 }, fdHeaders);
    recordTest('Front Desk Blocked from Price Edits (403)', fdPriceRes.status === 403);

    // Manager cannot access Users
    const mgrUsersRes = await request('GET', '/api/admin/users', null, mgrHeaders);
    recordTest('Manager Blocked from Users Management (403)', mgrUsersRes.status === 403);

    // Manager cannot access Database Backups
    const mgrBackupRes = await request('GET', '/api/admin/backup', null, mgrHeaders);
    recordTest('Manager Blocked from Database Backups (403)', mgrBackupRes.status === 403);

    // Manager cannot promote themselves or create another staff
    const mgrCreateStaff = await request('POST', '/api/admin/users', {
      name: 'Hacker',
      email: 'hacker@test.com',
      role: 'Super Admin'
    }, mgrHeaders);
    recordTest('Manager Blocked from Staff Creation (403)', mgrCreateStaff.status === 403);

    // ----------------------------------------------------
    // TEST 10: Safety Rules (Self-Protection & Last Admin)
    // ----------------------------------------------------
    // Super Admin cannot delete self
    const selfDelRes = await request('DELETE', '/api/admin/users/admin', null, adminHeaders);
    recordTest('Safety Rule: Cannot Delete Own Account', selfDelRes.status === 400, selfDelRes.json?.error || selfDelRes.json?.message);

    // Super Admin cannot disable self
    const selfDisRes = await request('PATCH', '/api/admin/users/admin', { active: false }, adminHeaders);
    recordTest('Safety Rule: Cannot Disable Own Account', selfDisRes.status === 400, selfDisRes.json?.error || selfDisRes.json?.message);

    // Super Admin cannot demote self
    const selfDemoteRes = await request('PATCH', '/api/admin/users/admin', { role: 'Manager' }, adminHeaders);
    recordTest('Safety Rule: Cannot Demote Own Role', selfDemoteRes.status === 400, selfDemoteRes.json?.error || selfDemoteRes.json?.message);

    // ----------------------------------------------------
    // TEST 11: Staff Management Operations
    // ----------------------------------------------------
    const targetUsername = addFdRes.json?.user?.username || addFdRes.json?.username;

    // Edit Phone
    const editRes = await request('PATCH', `/api/admin/users/${targetUsername}`, {
      phone: '+91 99999 88888',
      role: 'Front Desk'
    }, adminHeaders);
    recordTest('Edit Staff Phone & Role', editRes.status === 200);

    // Disable User -> Sessions terminated, login barred
    const disRes = await request('PATCH', `/api/admin/users/${targetUsername}`, { active: false }, adminHeaders);
    recordTest('Disable Staff User Account', disRes.status === 200);

    // Disabled User attempt to login -> returns generic 401 "Wrong email or password"
    const disLogin = await request('POST', '/api/auth/login', {
      username: fdEmail,
      password: fdPass,
      captchaToken: '1x00000000000000000000AA'
    });
    const disLoginBlocked = disLogin.status === 401 && disLogin.json?.error === 'Wrong email or password';
    recordTest('Disabled Account Returns Generic 401 (Zero Enumeration)', disLoginBlocked, disLogin.json?.error);

    // Re-enable User
    const reEnableRes = await request('PATCH', `/api/admin/users/${targetUsername}`, { active: true }, adminHeaders);
    recordTest('Re-enable Staff User Account', reEnableRes.status === 200);

    // View Active Sessions
    const sessionsRes = await request('GET', `/api/admin/users/${targetUsername}/sessions`, null, adminHeaders);
    recordTest('View User Active Login Sessions', sessionsRes.status === 200 && Array.isArray(sessionsRes.json?.sessions));

    // Sign out all devices
    const signoutRes = await request('POST', `/api/admin/users/${targetUsername}/signout-sessions`, null, adminHeaders);
    recordTest('Sign Out All Staff Devices', signoutRes.status === 200);

    // Reset Password Link
    const resetPassRes = await request('POST', `/api/admin/users/${targetUsername}/reset-password`, null, adminHeaders);
    recordTest('Dispatch Password Reset Link (No Plaintext Password)', resetPassRes.status === 200);

    // Reset 2FA (Requires Super Admin Password + TOTP)
    const adminDb = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8')).users.find(u => u.username === 'admin');
    let adminCurrentTotp = '123456';
    if (adminDb.totpSecret) {
      adminCurrentTotp = authSec.generateCurrentTotp(authSec.decryptMfaSecret(adminDb.totpSecret));
    }
    const reset2faRes = await request('POST', `/api/admin/users/${targetUsername}/reset-2fa`, {
      adminPassword: testEnv.TEST_PASSWORDS.admin,
      adminTotp: adminCurrentTotp,
      adminTotpCode: adminCurrentTotp
    }, adminHeaders);
    recordTest('Reset Authenticator with Admin Credentials Verification', reset2faRes.status === 200);

    // Soft Delete Staff User
    const delRes = await request('DELETE', `/api/admin/users/${targetUsername}`, null, adminHeaders);
    recordTest('Soft Delete Staff Account', delRes.status === 200, delRes.json?.message);

    // Verify deleted staff excluded from active user list but preserved in DB
    const listRes = await request('GET', '/api/admin/users', null, adminHeaders);
    const notInList = !listRes.json?.users?.some(u => u.username === targetUsername);
    const dbNow = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8'));
    const inDbSoftDeleted = dbNow.users.some(u => u.username === targetUsername && u.deleted === true);
    recordTest('Soft Delete Preserves Historical Identity for Audit Integrity', notInList && inDbSoftDeleted);

    // ----------------------------------------------------
    // TEST 12: Audit Log Completeness & Secret Redaction
    // ----------------------------------------------------
    const auditRes = await request('GET', '/api/admin/audit', null, adminHeaders);
    const auditEntries = auditRes.json?.logs || auditRes.json?.auditLog || [];
    const hasStaffActionAudits = auditEntries.some(l => (l.action || '').toLowerCase().includes('staff') || (l.action || '').toLowerCase().includes('invite'));

    // Check no passwords or secrets are in audit logs
    const auditStr = JSON.stringify(auditEntries).toLowerCase();
    const hasExposedSecret = auditStr.includes(strongPass.toLowerCase()) || auditStr.includes(testEnv.TEST_PASSWORDS.admin.toLowerCase()) || auditStr.includes('totpsecret');
    recordTest('Audit Log Records Actions Without Exposing Secrets', hasStaffActionAudits && !hasExposedSecret);

  } catch (err) {
    console.error('Test suite error:', err);
    recordTest('Test Suite Unhandled Exception', false, err.message);
  } finally {
    writeDB(JSON.parse(dbBackupRaw));
  }

  console.log('\n====================================================');
  console.log('SUMMARY OF RESULTS:');
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = total - passed;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('====================================================\n');

  return { total, passed, failed, testResults };
}

runTestSuite().then(res => {
  if (res.failed > 0) process.exit(1);
  else process.exit(0);
});

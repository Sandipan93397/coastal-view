/**
 * Coastal View Mandarmani - Admin MFA / 2FA Reset Tool
 * Resets TOTP Authenticator pairing and backup recovery codes for the Super Admin
 * account, revokes active sessions, clears lockouts, and flags the account to set up
 * a fresh Authenticator on next sign-in (using email/localhost verification code).
 *
 * Usage: npm run reset-admin-mfa
 */
require('dotenv').config({ quiet: true });
const { readDB, writeDB } = require('../db_store');

async function main() {
  console.log('\n============================================================');
  console.log('        COASTAL VIEW MANDARMANI - RESET ADMIN MFA/2FA       ');
  console.log('============================================================\n');

  const db = readDB();
  const users = db.users || [];
  if (users.length === 0) {
    console.error('❌ No user accounts found in database.');
    process.exit(1);
  }

  const superAdmin = users.find(u => u.role === 'Super Admin' || u.username === 'admin') || users[0];
  const hadTotp = Boolean(superAdmin.totpSecret);

  const nowMs = Date.now();
  superAdmin.totpSecret = null;
  superAdmin.pendingTotpSecret = null;
  superAdmin.pendingBackupCodes = null;
  superAdmin.pendingPlainBackupCodes = null;
  superAdmin.pendingCodeVerified = false;
  superAdmin.lastTotpCounter = null;
  superAdmin.backupCodes = [];
  superAdmin.requireMfaSetup = true;

  // Also ensure account is unlocked and active
  superAdmin.status = 'Active';
  superAdmin.active = true;
  delete superAdmin.deleted;
  superAdmin.failedAttempts = 0;
  superAdmin.lockoutUntil = null;
  superAdmin.lockedUntil = null;
  superAdmin.lockoutReason = null;
  superAdmin.unlockedAt = nowMs;
  superAdmin.sessionsRevokedAt = nowMs;
  superAdmin.updatedAt = new Date(nowMs).toISOString();

  db.adminUnlockedAt = nowMs;
  db.lockouts = {};

  // Revoke any existing active sessions for the Super Admin
  if (db.sessions && typeof db.sessions === 'object') {
    if (Array.isArray(db.sessions)) {
      db.sessions = db.sessions.filter(s => s.userId !== superAdmin.id && s.username !== superAdmin.username);
    } else {
      for (const token of Object.keys(db.sessions)) {
        const s = db.sessions[token];
        if (s && (s.userId === superAdmin.id || s.username === superAdmin.username)) {
          delete db.sessions[token];
        }
      }
    }
  }

  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    id: `audit-${nowMs}`,
    timestamp: new Date(nowMs).toISOString(),
    user: superAdmin.username,
    role: superAdmin.role || 'Super Admin',
    ip: '127.0.0.1 (CLI)',
    action: 'Admin MFA Reset',
    details: 'Super Admin MFA/TOTP authenticator reset via terminal command (npm run reset-admin-mfa). Fresh MFA setup required on next login.'
  });

  if (!writeDB(db)) {
    console.error('❌ Failed to write database file.');
    process.exit(1);
  }

  console.log('✅ ADMIN MFA / 2FA SUCCESSFULLY RESET!');
  console.log(`  • Username:          ${superAdmin.username}`);
  console.log(`  • Email:             ${superAdmin.email}`);
  console.log(`  • Role:              ${superAdmin.role}`);
  console.log(`  • Previous TOTP:     ${hadTotp ? 'Configured (Cleared)' : 'Not configured'}`);
  console.log(`  • Next Sign-In Mode: Email 6-Digit Code (or Dev Console Code on localhost)`);
  console.log(`  • Require MFA Setup: true (you can pair a new Authenticator app after signing in)`);
  console.log(`  • Audit Log:         Recorded\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Failed to reset admin MFA:', err.message);
  process.exit(1);
});


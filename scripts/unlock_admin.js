/**
 * Coastal View Mandarmani - Admin Account Unlock Tool
 * Clears brute-force lockouts, failed login attempt counters, rate limits,
 * and re-enables the Super Admin account if disabled.
 *
 * Usage: npm run unlock-admin
 */
require('dotenv').config({ quiet: true });
const { readDB, writeDB } = require('../db_store');

async function main() {
  console.log('\n============================================================');
  console.log('       COASTAL VIEW MANDARMANI - UNLOCK ADMIN ACCOUNT       ');
  console.log('============================================================\n');

  const db = readDB();
  const users = db.users || [];
  if (users.length === 0) {
    console.error('❌ No user accounts found in database.');
    process.exit(1);
  }

  const superAdmin = users.find(u => u.role === 'Super Admin' || u.username === 'admin') || users[0];
  const prevStatus = superAdmin.status || (superAdmin.active === false ? 'Disabled' : 'Active');
  const prevFailed = superAdmin.failedAttempts || 0;
  const wasLocked = Boolean(superAdmin.lockedUntil || superAdmin.lockoutUntil || prevFailed >= 5);

  const nowMs = Date.now();
  superAdmin.status = 'Active';
  superAdmin.active = true;
  delete superAdmin.deleted;
  superAdmin.failedAttempts = 0;
  superAdmin.lockoutUntil = null;
  superAdmin.lockedUntil = null;
  superAdmin.lockoutReason = null;
  superAdmin.unlockedAt = nowMs;
  superAdmin.updatedAt = new Date(nowMs).toISOString();

  db.adminUnlockedAt = nowMs;
  db.lockouts = {};

  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    id: `audit-${nowMs}`,
    timestamp: new Date(nowMs).toISOString(),
    user: superAdmin.username,
    role: superAdmin.role || 'Super Admin',
    ip: '127.0.0.1 (CLI)',
    action: 'Admin Account Unlocked',
    details: 'Super Admin account unlocked and rate-limit/lockout counters cleared via terminal command (npm run unlock-admin).'
  });

  if (!writeDB(db)) {
    console.error('❌ Failed to write database file.');
    process.exit(1);
  }

  console.log('✅ ADMIN ACCOUNT UNLOCKED SUCCESSFULLY!');
  console.log(`  • Username:        ${superAdmin.username}`);
  console.log(`  • Email:           ${superAdmin.email}`);
  console.log(`  • Role:            ${superAdmin.role}`);
  console.log(`  • Previous Status: ${prevStatus}${wasLocked ? ' (Locked)' : ''}`);
  console.log(`  • Current Status:  Active (Unlocked)`);
  console.log(`  • Failed Attempts: Cleared (was ${prevFailed})`);
  console.log(`  • Audit Log:       Recorded\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Failed to unlock admin account:', err.message);
  process.exit(1);
});


/**
 * Coastal View Mandarmani - Server-Side Last-Resort Account Recovery Tool
 * Can ONLY be executed directly by the hosting/server owner with terminal access.
 * Securely resets 2FA / regenerates recovery codes / resets password for Super Admin.
 * Usage: npm run recover-account
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const argon2 = require('argon2');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error('Error reading database file:', err.message);
    process.exit(1);
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing database file:', err.message);
    return false;
  }
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function generateBackupCodes() {
  const codes = [];
  const hashed = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8-char hex code
    codes.push(raw);
    hashed.push(crypto.createHash('sha256').update(raw).digest('hex'));
  }
  return { codes, hashed };
}

async function main() {
  console.log('\n============================================================');
  console.log('   COASTAL VIEW MANDARMANI - EMERGENCY ACCOUNT RECOVERY     ');
  console.log('============================================================\n');
  console.log('⚠️  This tool is reserved for hosting owners who have direct');
  console.log('    server shell / SSH access.\n');

  const db = readDB();
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
  const superAdmin = (db.users || []).find(u => u.role === 'Super Admin' || u.email === adminEmail);

  if (!superAdmin) {
    console.error('❌ No Super Admin account was found in data/db.json.');
    console.error('Run "npm run create-super-admin" to create the initial account.\n');
    process.exit(1);
  }

  console.log(`Identified Super Admin Account:`);
  console.log(`  • Username: ${superAdmin.username}`);
  console.log(`  • Email:    ${superAdmin.email}`);
  console.log(`  • Status:   ${superAdmin.status || 'Active'}\n`);

  console.log('Choose recovery action:');
  console.log('  1) Reset 2FA & Generate 8 Fresh Recovery Codes (Requires re-pairing TOTP on next login)');
  console.log('  2) Unlock Account (Clear failed login lockout and rate limit counters)');
  console.log('  3) Reset Super Admin Password');
  console.log('  4) Cancel / Exit\n');

  const choice = await prompt('Enter choice (1-4): ');

  if (choice === '1') {
    const { codes, hashed } = generateBackupCodes();
    superAdmin.totpSecret = null;
    superAdmin.backupCodes = hashed;
    superAdmin.requireMfaSetup = true;

    // Log emergency audit
    db.auditLog = db.auditLog || [];
    db.auditLog.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: superAdmin.username,
      role: 'Super Admin',
      ip: '127.0.0.1 (CLI)',
      action: 'Emergency 2FA Reset',
      details: 'Super Admin 2FA reset via server CLI tool. New recovery codes generated.'
    });

    writeDB(db);

    console.log('\n✅ 2FA HAS BEEN RESET FOR SUPER ADMIN!');
    console.log('On your next login, you will be prompted to set up your Authenticator app.\n');
    console.log('Here are your 8 new single-use emergency recovery codes (save these safely):');
    console.log('------------------------------------------------------------');
    codes.forEach((c, idx) => console.log(`  [Code ${idx + 1}]  ${c}`));
    console.log('------------------------------------------------------------\n');
  } else if (choice === '2') {
    // Unlock account
    db.loginHistory = db.loginHistory || [];
    db.auditLog = db.auditLog || [];
    db.auditLog.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: superAdmin.username,
      role: 'Super Admin',
      ip: '127.0.0.1 (CLI)',
      action: 'Emergency Account Unlock',
      details: 'Super Admin account unlocked via server CLI tool.'
    });
    writeDB(db);

    console.log(`\n✅ Super Admin account (${superAdmin.username}) lockout cleared!\n`);
  } else if (choice === '3') {
    const newPwd = await prompt('Enter new strong password (min 12 chars, upper, lower, number, symbol): ');
    if (newPwd.length < 12 || !/[A-Z]/.test(newPwd) || !/[a-z]/.test(newPwd) || !/[0-9]/.test(newPwd) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(newPwd)) {
      console.error('\n❌ Password rejected. Must be at least 12 chars with upper, lower, number, and symbol.\n');
      process.exit(1);
    }

    console.log('Hashing password with Argon2id...');
    superAdmin.passwordHash = await argon2.hash(newPwd, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4
    });

    db.auditLog = db.auditLog || [];
    db.auditLog.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: superAdmin.username,
      role: 'Super Admin',
      ip: '127.0.0.1 (CLI)',
      action: 'Emergency Password Reset',
      details: 'Super Admin password reset via server CLI tool.'
    });
    writeDB(db);

    console.log('\n✅ Super Admin password updated successfully with Argon2id!\n');
  } else {
    console.log('\nExiting without making changes.\n');
  }
}

main().catch(err => {
  console.error('Emergency recovery failed:', err);
  process.exit(1);
});

/**
 * Coastal View Mandarmani - One-Time Super Admin Creation Script
 * Enforces strong password rules, hashes via Argon2id, and locks itself permanently.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const argon2 = require('argon2');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

// Common weak password dictionary
const COMMON_PASSWORDS = new Set([
  'password', 'password123', 'password1234', '123456789012', 'admin1234567',
  'coastalview123', 'coastalview@2026', 'administrator1', 'qwertyuiop12',
  'welcome123456', 'superadmin123', 'mandarmani2026', 'letmein123456',
  'iloveyou12345', 'changeme12345', 'sunshine12345', 'trustnoone123',
  'master123456', 'football1234', 'dragon123456', 'monkey123456',
  'shadow123456', 'secret123456', 'testing12345', 'hoteladmin123',
  'resortadmin123', 'beachresort123', 'anisresort123', 'coastaladmin'
]);

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

function validatePassword(pwd) {
  const issues = [];
  if (!pwd || pwd.length < 12) {
    issues.push('Password must be at least 12 characters long');
  }
  if (!/[A-Z]/.test(pwd)) {
    issues.push('Must contain at least one uppercase letter (A-Z)');
  }
  if (!/[a-z]/.test(pwd)) {
    issues.push('Must contain at least one lowercase letter (a-z)');
  }
  if (!/[0-9]/.test(pwd)) {
    issues.push('Must contain at least one number (0-9)');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pwd)) {
    issues.push('Must contain at least one symbol (!@#$%^&*...)');
  }
  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) {
    issues.push('Password is in the common-passwords list and is too easily guessed');
  }
  return issues;
}

// Prompt for hidden password input in terminal
function askHiddenPassword(promptText) {
  return new Promise((resolve) => {
    // If running in automated testing with pre-provided input
    if (process.env.SUPER_ADMIN_PASSWORD_INPUT) {
      return resolve(process.env.SUPER_ADMIN_PASSWORD_INPUT);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (process.stdin.isTTY) {
      process.stdout.write(promptText);
      let password = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.exit(1);
            break;
          case '\u0008':
          case '\x7f': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY fallback (piped or scripted input)
      rl.question(promptText, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

async function main() {
  console.log('\n============================================================');
  console.log('   COASTAL VIEW MANDARMANI - SUPER ADMIN INITIALIZATION     ');
  console.log('============================================================\n');

  const db = readDB();

  // Self-locking check: check if super admin is already locked or exists
  const existingSuperAdmin = (db.users || []).find(u => u.role === 'Super Admin');
  if (db.superAdminLocked || existingSuperAdmin) {
    console.error('⛔ ACCESS DENIED: The one-time Super Admin creation script is permanently LOCKED.');
    console.error('A Super Admin account has already been initialized. To protect security,');
    console.error('this script cannot be executed again.');
    console.error('To reset credentials or recover the account, use the secure reset flow:');
    console.error('  • Web Reset:  Use the "Forgot Password" link on /admin');
    console.error('  • Emergency:  Run "npm run recover-account" on the server.\n');
    process.exit(1);
  }

  // Get Admin Email from environment variable
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
  if (!adminEmail) {
    console.error('⛔ CONFIGURATION ERROR: Environment variable ADMIN_EMAIL is not set.');
    console.error('Please configure ADMIN_EMAIL in your .env file before running this script.\n');
    process.exit(1);
  }

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(adminEmail)) {
    console.error(`⛔ INVALID EMAIL: "${adminEmail}" is not a valid email address.\n`);
    process.exit(1);
  }

  console.log(`Target Super Admin Email: ${adminEmail}`);
  console.log('Requirements: At least 12 chars, uppercase, lowercase, number, symbol, not on common list.\n');

  let password = await askHiddenPassword('Enter new Super Admin password: ');
  let validationIssues = validatePassword(password);

  if (validationIssues.length > 0) {
    console.error('\n❌ Password rejected due to security policy:');
    validationIssues.forEach(issue => console.error(`   • ${issue}`));
    console.error('\nPlease re-run the script with a stronger password.\n');
    process.exit(1);
  }

  let confirmPassword = await askHiddenPassword('Confirm new Super Admin password: ');
  if (password !== confirmPassword) {
    console.error('\n❌ Passwords do not match. Aborting.\n');
    process.exit(1);
  }

  console.log('\nHashing password securely with Argon2id...');
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  // Extract username from email or default to 'superadmin'
  const username = adminEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'superadmin';

  db.users = db.users || [];

  // Remove any legacy admin or placeholder accounts
  db.users = db.users.filter(u => u.role !== 'Super Admin' && u.email !== adminEmail && u.username !== username && u.username !== 'admin');

  // Add the newly created Super Admin
  const superAdminUser = {
    username,
    name: 'Super Admin',
    email: adminEmail,
    role: 'Super Admin',
    passwordHash,
    requireMfaSetup: true,
    status: 'Active',
    createdAt: new Date().toISOString(),
    lastLogin: null
  };

  db.users.unshift(superAdminUser);

  // Permanently lock the script
  db.superAdminLocked = true;
  db.superAdminCreatedAt = new Date().toISOString();

  // Audit trail
  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    id: `audit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: username,
    role: 'Super Admin',
    name: 'Super Admin',
    ip: '127.0.0.1',
    action: 'Super Admin Created',
    details: `Super Admin account initialized for ${adminEmail}. Argon2id hashing applied. One-time setup script locked.`
  });

  // Purge any legacy admin object
  delete db.admin;

  writeDB(db);

  console.log('✅ Super Admin account created successfully!');
  console.log(`   • Username: ${username}`);
  console.log(`   • Email: ${adminEmail}`);
  console.log(`   • Role: Super Admin`);
  console.log(`   • Algorithm: Argon2id (m=65536, t=3, p=4)`);
  console.log(`   • 2FA on First Login: Mandatory (Email verification code / TOTP)`);
  console.log('🔒 This setup script is now PERMANENTLY LOCKED.\n');
}

main().catch(err => {
  console.error('Fatal error during Super Admin creation:', err);
  process.exit(1);
});

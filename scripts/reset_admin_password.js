/**
 * Coastal View Mandarmani - Last-Resort Admin Password Reset Tool
 * Executable ONLY from the hosting terminal by server administrators.
 * Prompts with hidden terminal input, enforces strong password rules,
 * checks last 5 passwords, hashes with Argon2id, terminates active sessions,
 * clears lockouts, and writes an audit log.
 *
 * Usage: npm run reset-admin-password
 */
require('dotenv').config({ quiet: true });
const readline = require('readline');
const argon2 = require('argon2');
const { checkPasswordHistory } = require('../auth_security');
const { readDB, writeDB } = require('../db_store');

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
  if (COMMON_PASSWORDS.has((pwd || '').toLowerCase())) {
    issues.push('Password matches a common password and cannot be used');
  }
  return issues;
}

// Buffered line reader for non-TTY piped stdin
let pipedLines = null;
let pipedEnded = false;
let pipedWaiters = [];

function initPipedReader() {
  if (pipedLines !== null) return;
  pipedLines = [];
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });
  rl.on('line', (line) => {
    if (pipedWaiters.length > 0) {
      const next = pipedWaiters.shift();
      next(line.trim());
    } else {
      pipedLines.push(line.trim());
    }
  });
  rl.on('close', () => {
    pipedEnded = true;
    while (pipedWaiters.length > 0) {
      const next = pipedWaiters.shift();
      next('');
    }
  });
}

// Prompt for hidden password input in terminal (never echoes characters in TTY)
function askHiddenPassword(promptText) {
  return new Promise((resolve) => {
    if (process.env.RESET_ADMIN_PASSWORD_INPUT) {
      return resolve(process.env.RESET_ADMIN_PASSWORD_INPUT);
    }

    if (process.stdin.isTTY) {
      process.stdout.write(promptText);
      let password = '';
      process.stdin.setEncoding('utf8');
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (chunk) => {
        const str = String(chunk);
        for (let i = 0; i < str.length; i++) {
          const char = str[i];
          if (char === '\n' || char === '\r' || char === '\u0004') {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(password);
            return;
          }
          if (char === '\u0003') { // Ctrl+C
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            process.exit(1);
          }
          if (char === '\u0008' || char === '\x7f') { // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else if (char >= ' ') {
            password += char;
            process.stdout.write('*');
          }
        }
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY fallback (piped input in test automation)
      process.stdout.write(promptText);
      initPipedReader();
      if (pipedLines.length > 0) {
        process.stdout.write('\n');
        return resolve(pipedLines.shift());
      }
      if (pipedEnded) {
        process.stdout.write('\n');
        return resolve('');
      }
      pipedWaiters.push((val) => {
        process.stdout.write('\n');
        resolve(val);
      });
    }
  });
}

async function main() {
  console.log('\n============================================================');
  console.log('   COASTAL VIEW MANDARMANI - LAST-RESORT PASSWORD RESET    ');
  console.log('============================================================\n');
  console.log('🔒 This command directly alters admin credentials on the server.');
  console.log('   Run only by authorized server personnel.\n');

  const db = readDB();
  const users = db.users || [];
  if (users.length === 0) {
    console.error('❌ No user accounts found in database.');
    process.exit(1);
  }

  const superAdmin = users.find(u => u.role === 'Super Admin' || u.username === 'admin') || users[0];
  console.log(`Identified Super Admin account:`);
  console.log(`  • Username: ${superAdmin.username}`);
  console.log(`  • Email:    ${superAdmin.email}`);
  console.log(`  • Role:     ${superAdmin.role}\n`);
  console.log('Password policy: min 12 chars, uppercase, lowercase, number, symbol (!@#$%...), not in last 5 passwords.\n');

  // Prompt for new password with hidden terminal input
  const newPassword = await askHiddenPassword('Enter new password: ');
  const confirmPassword = await askHiddenPassword('Confirm new password: ');

  if (!newPassword || newPassword !== confirmPassword) {
    console.error('\n❌ Passwords do not match. Reset cancelled.');
    process.exit(1);
  }

  // Validate password rules
  const issues = validatePassword(newPassword);
  if (issues.length > 0) {
    console.error('\n❌ Password validation failed:');
    issues.forEach(iss => console.error(`  - ${iss}`));
    process.exit(1);
  }

  // Check last 5 passwords
  const historyCheck = await checkPasswordHistory(newPassword, superAdmin, 5);
  if (historyCheck && !historyCheck.allowed) {
    console.error('\n❌ ' + (historyCheck.message || 'Password cannot be the same as any of the last 5 passwords used.'));
    process.exit(1);
  }

  console.log('\nHashing new password with Argon2id...');
  const newHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  // Maintain password history (last 5)
  superAdmin.passwordHistory = superAdmin.passwordHistory || [];
  if (superAdmin.passwordHash) {
    superAdmin.passwordHistory.unshift(superAdmin.passwordHash);
    if (superAdmin.passwordHistory.length > 5) {
      superAdmin.passwordHistory = superAdmin.passwordHistory.slice(0, 5);
    }
  }

  const nowMs = Date.now();
  // Apply new hash, ensure active status, and clear lockouts
  superAdmin.passwordHash = newHash;
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

  // Invalidate all active sessions for this user
  if (db.sessions && typeof db.sessions === 'object') {
    let invalidated = 0;
    if (Array.isArray(db.sessions)) {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter(s => s.userId !== superAdmin.id && s.username !== superAdmin.username);
      invalidated = before - db.sessions.length;
    } else {
      for (const token of Object.keys(db.sessions)) {
        const s = db.sessions[token];
        if (s && (s.userId === superAdmin.id || s.username === superAdmin.username)) {
          delete db.sessions[token];
          invalidated++;
        }
      }
    }
    if (invalidated > 0) {
      console.log(`Terminated ${invalidated} active session(s).`);
    }
  }

  // Audit log entry
  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    id: `audit-${nowMs}`,
    timestamp: new Date(nowMs).toISOString(),
    user: superAdmin.username,
    role: superAdmin.role,
    ip: '127.0.0.1 (CLI)',
    action: 'Last-Resort Password Reset',
    details: 'Admin password reset executed via terminal command (npm run reset-admin-password). All active sessions terminated.'
  });

  if (!writeDB(db)) {
    console.error('\n❌ Failed to persist database update.');
    process.exit(1);
  }

  console.log('\n✅ PASSWORD SUCCESSFULLY RESET!');
  console.log(`  • Account:    ${superAdmin.username} (${superAdmin.email})`);
  console.log(`  • Algorithm:  Argon2id (m=64MB, t=3, p=4)`);
  console.log(`  • Lockouts:   Cleared`);
  console.log(`  • Sessions:   All previous sessions revoked`);
  console.log(`  • Audit Log:  Recorded\n`);
  console.log('You can now log in at /admin using your new password.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Password reset failed with error:', err.message);
  process.exit(1);
});

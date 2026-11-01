/**
 * Coastal View Mandarmani - Settings Encryption Key Rotation CLI
 * Rotates the AES-256-GCM encryption key for stored email app passwords.
 * Reads previous key, decrypts in memory, re-encrypts with new key,
 * increments keyVersion, and logs an audit trail.
 *
 * Usage: npm run rotate-encryption-key
 * Optional env vars for automation:
 *   OLD_SETTINGS_ENCRYPTION_KEY=...
 *   NEW_SETTINGS_ENCRYPTION_KEY=...
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getSettingsEncryptionKey, rotateSettingsKey } = require('../settings_crypto');
const { readDB, writeDB } = require('../db_store');

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (process.stdin.isTTY) {
      process.stdout.write(question);
      let text = '';
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
            resolve(text.trim());
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.exit(1);
            break;
          case '\u0008':
          case '\x7f':
            if (text.length > 0) {
              text = text.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            text += char;
            process.stdout.write('*');
            break;
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

async function main() {
  console.log('\n============================================================');
  console.log('   COASTAL VIEW MANDARMANI - ENCRYPTION KEY ROTATION        ');
  console.log('============================================================\n');

  const db = readDB();
  const emailSettings = db?.settings?.email;
  if (!emailSettings || !emailSettings.appPassword?.encrypted) {
    console.log('ℹ️  No encrypted App Password found in data/db.json. Nothing to rotate.\n');
    process.exit(0);
  }

  const currentVer = emailSettings.appPassword.keyVersion || 1;
  console.log(`Current Stored Key Version: v${currentVer}`);
  console.log(`Ciphertext saved on: ${emailSettings.appPassword.savedAt || 'Unknown'}\n`);

  let oldKeyStr = process.env.OLD_SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ENCRYPTION_KEY;
  if (!oldKeyStr) {
    oldKeyStr = await promptHidden('Enter OLD SETTINGS_ENCRYPTION_KEY (base64/hex/32-byte): ');
  }

  let newKeyStr = process.env.NEW_SETTINGS_ENCRYPTION_KEY;
  if (!newKeyStr) {
    newKeyStr = await promptHidden('Enter NEW SETTINGS_ENCRYPTION_KEY (base64/hex/32-byte): ');
  }

  if (!oldKeyStr || !newKeyStr) {
    console.error('❌ Both old and new encryption keys are required for rotation.');
    process.exit(1);
  }

  const oldKeyBuf = getSettingsEncryptionKey(oldKeyStr);
  const newKeyBuf = getSettingsEncryptionKey(newKeyStr);

  if (!oldKeyBuf || !newKeyBuf) {
    console.error('❌ Invalid key formats provided.');
    process.exit(1);
  }

  console.log('\nRe-encrypting stored secret with new master key...');
  try {
    const res = rotateSettingsKey(db, oldKeyBuf, newKeyBuf);
    if (!res.rotated) {
      console.log('Rotation cancelled:', res.message);
      process.exit(0);
    }

    db.auditLog = db.auditLog || [];
    db.auditLog.unshift({
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: 'Super Admin (CLI)',
      role: 'Super Admin',
      ip: '127.0.0.1 (CLI)',
      action: 'Settings Encryption Key Rotated',
      details: `App password re-encrypted with key version v${res.nextVersion}.`
    });

    writeDB(db);

    console.log(`✅ SUCCESS: Key rotated to Version v${res.nextVersion}!`);
    console.log('Remember to update SETTINGS_ENCRYPTION_KEY in your server .env file and restart the server.\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Key rotation failed:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error during key rotation:', err);
  process.exit(1);
});

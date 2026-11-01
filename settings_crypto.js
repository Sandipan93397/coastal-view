/**
 * Coastal View Mandarmani - Settings Cryptography Engine
 * Encrypts and decrypts sensitive settings (such as SMTP App Passwords) at rest using AES-256-GCM.
 * Enforces key versioning for future key rotations.
 *
 * Rules:
 * 1. Master key is read exclusively from SETTINGS_ENCRYPTION_KEY in .env.
 * 2. Key is NEVER stored in database, code, or Git.
 * 3. Decrypted secrets exist ONLY in server memory at send time and are NEVER persisted or returned to browser.
 * 4. Missing key refuses to encrypt/save (never falls back to plaintext).
 */
require('dotenv').config();
const crypto = require('crypto');

/**
 * Derives a 32-byte key from SETTINGS_ENCRYPTION_KEY environment variable.
 * Returns null if variable is missing or empty.
 */
function getSettingsEncryptionKey(customKeyString = null) {
  const rawKey = (customKeyString !== null ? customKeyString : (process.env.SETTINGS_ENCRYPTION_KEY || '')).trim();
  if (!rawKey) return null;

  // 1. If base64-encoded 32 bytes (44 chars with padding e.g. from openssl rand -base64 32)
  try {
    const buf = Buffer.from(rawKey, 'base64');
    if (buf.length === 32) return buf;
  } catch (e) {}

  // 2. If hex-encoded 32 bytes (64 hex characters)
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    try {
      const buf = Buffer.from(rawKey, 'hex');
      if (buf.length === 32) return buf;
    } catch (e) {}
  }

  // 3. If raw 32-byte UTF-8 string
  const buf = Buffer.from(rawKey, 'utf8');
  if (buf.length === 32) return buf;

  // 4. Cryptographic fallback for any non-32 length string: derive 256-bit key via SHA-256
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Checks whether settings encryption master key is configured
 */
function isSettingsEncryptionConfigured() {
  return Boolean((process.env.SETTINGS_ENCRYPTION_KEY || '').trim());
}

/**
 * Encrypts a plaintext secret using AES-256-GCM with a fresh random 96-bit IV.
 * Throws ENCRYPTION_KEY_NOT_CONFIGURED if master key is missing.
 *
 * @param {string} plainText Plain text to encrypt
 * @param {number} keyVersion Key version number for future rotation
 * @param {Buffer|null} customKey Optional override key buffer (e.g. for key rotation)
 * @returns {object} Ciphertext container with iv, tag, keyVersion, savedAt, masked
 */
function encryptSettingSecret(plainText, keyVersion = 1, customKey = null) {
  if (!plainText) return null;

  const key = (Buffer.isBuffer(customKey) && customKey.length === 32)
    ? customKey
    : getSettingsEncryptionKey(customKey);

  if (!key) {
    const err = new Error('Encryption key not configured. Please set SETTINGS_ENCRYPTION_KEY in .env.');
    err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
    throw err;
  }

  const iv = crypto.randomBytes(12); // 96-bit random IV per value (NIST recommendation for GCM)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex'); // 128-bit authentication tag

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag,
    keyVersion: Number(keyVersion) || 1,
    savedAt: new Date().toISOString(),
    masked: '● ● ● ● saved'
  };
}

/**
 * Decrypts an AES-256-GCM ciphertext container in server memory.
 * Never persists or exposes the decrypted result.
 *
 * @param {object} storedObj Ciphertext container with { encrypted, iv, tag }
 * @param {Buffer|string|null} customKey Optional override key buffer or base64/hex string
 * @returns {string|null} Plaintext secret or null
 */
function decryptSettingSecret(storedObj, customKey = null) {
  if (!storedObj || typeof storedObj !== 'object') return null;
  const { encrypted, iv, tag } = storedObj;
  if (!encrypted || !iv || !tag) return null;

  const key = (Buffer.isBuffer(customKey) && customKey.length === 32)
    ? customKey
    : getSettingsEncryptionKey(customKey);

  if (!key) {
    const err = new Error('Encryption key not configured. Please set SETTINGS_ENCRYPTION_KEY in .env.');
    err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
    throw err;
  }

  const ivBuf = Buffer.from(iv, 'hex');
  const tagBuf = Buffer.from(tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
  decipher.setAuthTag(tagBuf);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Rotates the encryption key for the stored App Password.
 * Decrypts using oldKey, re-encrypts using newKey, increments keyVersion.
 *
 * @param {object} db Database reference
 * @param {Buffer|string} oldKey Old key buffer or string
 * @param {Buffer|string} newKey New key buffer or string
 * @returns {object} { success: boolean, rotated: boolean, keyVersion: number, db: object }
 */
function rotateSettingsKey(db, oldKey, newKey) {
  if (!db?.settings?.email?.appPassword?.encrypted) {
    return { success: false, rotated: false, message: 'No stored app password to rotate.' };
  }

  const current = db.settings.email.appPassword;
  const plain = decryptSettingSecret(current, oldKey);
  if (!plain) {
    throw new Error('Authentication tag or ciphertext mismatch while decrypting with old key.');
  }

  const nextVersion = (Number(current.keyVersion) || 1) + 1;
  const reEncrypted = encryptSettingSecret(plain, nextVersion, newKey);
  db.settings.email.appPassword = reEncrypted;
  db.settings.email.keyRotatedAt = new Date().toISOString();

  return { success: true, rotated: true, keyVersion: nextVersion, db };
}

module.exports = {
  getSettingsEncryptionKey,
  isSettingsEncryptionConfigured,
  encryptSettingSecret,
  decryptSettingSecret,
  rotateSettingsKey
};

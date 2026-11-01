/**
 * Coastal View Mandarmani - Persistent Database & Admin/Staff Storage Engine
 *
 * Ensures admin and staff accounts (users, roles, Argon2id hashes, MFA state,
 * sessions, lockouts, remembered devices, and reset tokens) are stored in a
 * persistent SQLite database (via built-in node:sqlite) plus an atomic JSON
 * store outside git-tracked seed state so server restarts, git pulls, seeds,
 * or redeploys can never wipe or reset admin/staff accounts.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');

function getDataDir() {
  if (process.env.DB_PATH) {
    return path.dirname(path.resolve(process.env.DB_PATH));
  }
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  return DEFAULT_DATA_DIR;
}

function getDbPath() {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(getDataDir(), 'db.json');
}

function getSqlitePath() {
  if (process.env.AUTH_SQLITE_PATH) {
    return path.resolve(process.env.AUTH_SQLITE_PATH);
  }
  return path.join(getDataDir(), 'admin_staff.sqlite');
}

function getPersistentUsersJsonPath() {
  return path.join(getDataDir(), 'admin_staff_persistent.json');
}

// Ensure data directory exists
function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Optional built-in SQLite (Node >= 22.5)
let sqliteDbCache = new Map(); // sqlitePath -> DatabaseSync instance

function getSqliteDb() {
  ensureDataDir();
  const sqlitePath = getSqlitePath();
  if (sqliteDbCache.has(sqlitePath)) {
    return sqliteDbCache.get(sqlitePath);
  }
  try {
    // Suppress experimental warning in CLI output
    const origEmitWarning = process.emitWarning;
    process.emitWarning = function (warning, ...args) {
      if (typeof warning === 'string' && warning.includes('SQLite')) return;
      if (warning && warning.name === 'ExperimentalWarning' && String(warning.message || '').includes('SQLite')) return;
      return origEmitWarning.call(this, warning, ...args);
    };
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(sqlitePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS staff_users (
        username TEXT PRIMARY KEY,
        email TEXT,
        role TEXT,
        status TEXT,
        updated_at TEXT,
        user_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_meta (
        meta_key TEXT PRIMARY KEY,
        meta_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    sqliteDbCache.set(sqlitePath, db);
    return db;
  } catch (err) {
    sqliteDbCache.set(sqlitePath, null);
    return null;
  }
}

/**
 * Save admin & staff accounts and auth metadata to persistent SQLite + JSON backup
 */
function syncAuthToPersistentStore(dbData) {
  if (!dbData || typeof dbData !== 'object') return;
  ensureDataDir();

  const users = Array.isArray(dbData.users) ? dbData.users : [];
  const metaPayload = {
    superAdminLocked: Boolean(dbData.superAdminLocked || users.some(u => u.role === 'Super Admin')),
    superAdminCreatedAt: dbData.superAdminCreatedAt || null,
    rememberedDevices: Array.isArray(dbData.rememberedDevices) ? dbData.rememberedDevices : [],
    passwordResetTokens: Array.isArray(dbData.passwordResetTokens) ? dbData.passwordResetTokens : [],
    sessions: dbData.sessions && typeof dbData.sessions === 'object' ? dbData.sessions : {},
    lockouts: dbData.lockouts && typeof dbData.lockouts === 'object' ? dbData.lockouts : {},
    updatedAt: new Date().toISOString()
  };

  // 1. Sync to SQLite persistent database if available
  const sqlite = getSqliteDb();
  if (sqlite) {
    try {
      sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        sqlite.exec('DELETE FROM staff_users');
        const insertUser = sqlite.prepare(`
          INSERT OR REPLACE INTO staff_users (username, email, role, status, updated_at, user_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const u of users) {
          if (!u || !u.username) continue;
          insertUser.run(
            String(u.username),
            u.email ? String(u.email) : null,
            u.role ? String(u.role) : 'Staff',
            u.status ? String(u.status) : 'Active',
            u.updatedAt || u.createdAt || new Date().toISOString(),
            JSON.stringify(u)
          );
        }

        const upsertMeta = sqlite.prepare(`
          INSERT OR REPLACE INTO auth_meta (meta_key, meta_json, updated_at)
          VALUES (?, ?, ?)
        `);
        const nowIso = new Date().toISOString();
        for (const [k, v] of Object.entries(metaPayload)) {
          upsertMeta.run(k, JSON.stringify(v), nowIso);
        }
        sqlite.exec('COMMIT');
      } catch (txErr) {
        try { sqlite.exec('ROLLBACK'); } catch (_) {}
        throw txErr;
      }
    } catch (e) {
      // Fallback to JSON mirror below
    }
  }

  // 2. Only use standard custom persistent path when not running with a custom temp DB_PATH
  if (!process.env.DB_PATH) {
    try {
      const jsonPath = getPersistentUsersJsonPath();
      const tmpPath = `${jsonPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify({ users, meta: metaPayload }, null, 2), 'utf8');
      fs.renameSync(tmpPath, jsonPath);
    } catch (e) {
      // Ignore secondary mirror write error
    }
  }
}

/**
 * Load admin & staff accounts and auth metadata from persistent SQLite / JSON store
 */
function loadAuthFromPersistentStore() {
  ensureDataDir();
  const sqlite = getSqliteDb();
  if (sqlite) {
    try {
      const userRows = sqlite.prepare('SELECT user_json FROM staff_users').all();
      const metaRows = sqlite.prepare('SELECT meta_key, meta_json FROM auth_meta').all();
      if (userRows.length > 0 || metaRows.length > 0) {
        const users = userRows.map(r => JSON.parse(r.user_json));
        const meta = {};
        for (const r of metaRows) {
          try { meta[r.meta_key] = JSON.parse(r.meta_json); } catch (_) {}
        }
        return { users, meta };
      }
    } catch (e) {
      // Fallback to JSON mirror
    }
  }

  if (!process.env.DB_PATH) {
    const jsonPath = getPersistentUsersJsonPath();
    if (fs.existsSync(jsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (e) {}
    }
  }

  return null;
}

/**
 * Reconcile db.json with the persistent Admin/Staff store so a restart, git pull,
 * seed script, or redeploy can never wipe admin or staff accounts.
 */
function reconcilePersistentAuth(dbData) {
  if (!dbData || typeof dbData !== 'object') return { dbData, changed: false };
  const persisted = loadAuthFromPersistentStore();
  if (!persisted || !Array.isArray(persisted.users) || persisted.users.length === 0) {
    // Initial bootstrap: persist existing users from db.json into persistent store
    if (Array.isArray(dbData.users) && dbData.users.length > 0) {
      syncAuthToPersistentStore(dbData);
    }
    return { dbData, changed: false };
  }

  let changed = false;
  dbData.users = Array.isArray(dbData.users) ? dbData.users : [];

  // Ensure every persisted user (especially Super Admin and active staff) exists in dbData.users
  // and that critical auth fields from the persistent SQLite store cannot be overwritten by a stale db.json seed
  for (const pUser of persisted.users) {
    if (!pUser || !pUser.username) continue;
    const existingIdx = dbData.users.findIndex(
      u => u && (
        u.username.toLowerCase() === pUser.username.toLowerCase() ||
        (u.id && pUser.id && u.id === pUser.id)
      )
    );
    if (existingIdx === -1) {
      // Missing in db.json (e.g. wiped by git checkout or seed) -> restore from persistent DB
      if (pUser.role === 'Super Admin') {
        dbData.users.unshift(pUser);
      } else {
        dbData.users.push(pUser);
      }
      changed = true;
    } else {
      const cur = dbData.users[existingIdx];
      const authFields = ['passwordHash', 'totpSecret', 'totpEnabled', 'backupCodes', 'role', 'status', 'failedLoginAttempts', 'lockedUntil', 'passwordHistory'];
      for (const field of authFields) {
        if (pUser[field] !== undefined && JSON.stringify(cur[field]) !== JSON.stringify(pUser[field])) {
          cur[field] = pUser[field];
          changed = true;
        }
      }
    }
  }

  const meta = persisted.meta || {};
  if (meta.superAdminLocked && !dbData.superAdminLocked) {
    dbData.superAdminLocked = true;
    changed = true;
  }
  if (meta.superAdminCreatedAt && !dbData.superAdminCreatedAt) {
    dbData.superAdminCreatedAt = meta.superAdminCreatedAt;
    changed = true;
  }
  if (!dbData.sessions && meta.sessions && Object.keys(meta.sessions).length > 0) {
    dbData.sessions = meta.sessions;
    changed = true;
  }
  if (!dbData.lockouts && meta.lockouts && Object.keys(meta.lockouts).length > 0) {
    dbData.lockouts = meta.lockouts;
    changed = true;
  }
  if ((!Array.isArray(dbData.rememberedDevices) || dbData.rememberedDevices.length === 0) &&
      Array.isArray(meta.rememberedDevices) && meta.rememberedDevices.length > 0) {
    dbData.rememberedDevices = meta.rememberedDevices;
    changed = true;
  }

  return { dbData, changed };
}

/**
 * Atomic write helper for JSON files
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
    // Direct fallback on Windows if file lock prevents rename
    fs.writeFileSync(filePath, serialized, 'utf8');
  }
}

/**
 * Read database and automatically heal/restore admin & staff data if needed
 */
function readDB() {
  ensureDataDir();
  const dbPath = getDbPath();
  let dbData = null;

  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      dbData = JSON.parse(raw);
    } catch (err) {
      console.error('Error reading db.json:', err.message);
    }
  }

  if (!dbData || typeof dbData !== 'object') {
    dbData = { users: [], rooms: [], bookings: [], settings: {}, auditLog: [], loginHistory: [] };
  }

  const { changed } = reconcilePersistentAuth(dbData);
  if (changed) {
    try {
      writeJsonAtomic(dbPath, dbData);
    } catch (_) {}
  }

  return dbData;
}

/**
 * Write database atomically and sync admin & staff data to persistent SQLite store
 */
function writeDB(data) {
  if (!data || typeof data !== 'object') return false;
  ensureDataDir();
  const dbPath = getDbPath();

  try {
    // Protection guard: never allow an accidental write to wipe all Super Admin accounts
    // if a Super Admin already exists in the persistent store
    const hasSuperAdminInPayload = Array.isArray(data.users) && data.users.some(u => u && u.role === 'Super Admin');
    if (!hasSuperAdminInPayload) {
      const persisted = loadAuthFromPersistentStore();
      const persistedSuperAdmin = persisted && Array.isArray(persisted.users)
        ? persisted.users.find(u => u && u.role === 'Super Admin')
        : null;
      if (persistedSuperAdmin) {
        data.users = Array.isArray(data.users) ? data.users : [];
        data.users.unshift(persistedSuperAdmin);
      }
    }

    writeJsonAtomic(dbPath, data);
    syncAuthToPersistentStore(data);
    return true;
  } catch (err) {
    console.error('Error writing db.json:', err.message);
    return false;
  }
}

function closeAllSqliteDbs() {
  for (const [, db] of sqliteDbCache.entries()) {
    if (db && typeof db.close === 'function') {
      try { db.close(); } catch (_) {}
    }
  }
  sqliteDbCache.clear();
}

module.exports = {
  getDataDir,
  getDbPath,
  getSqlitePath,
  readDB,
  writeDB,
  syncAuthToPersistentStore,
  loadAuthFromPersistentStore,
  reconcilePersistentAuth,
  closeAllSqliteDbs
};


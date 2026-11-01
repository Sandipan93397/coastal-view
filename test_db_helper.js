/**
 * Coastal View Mandarmani - Isolated Test Database, Server & Runtime Credential Helper
 *
 * Guarantees that EVERY test script:
 * 1. Uses a temporary copy of the database in os.tmpdir() (separate DATA_DIR / DB_PATH)
 * 2. Can NEVER read or write the real ./data files (enforced by fs redirection guard)
 * 3. Uses runtime-generated random test passwords (zero hardcoded passwords or hashes)
 * 4. Routes any localhost:3000 HTTP requests to an isolated test server instance backed
 *    by the temporary DATA_DIR so a running dev server's real database is never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REAL_DATA_DIR = path.resolve(__dirname, 'data');

// Create or reuse the isolated temp directory for this test run
const TEMP_DATA_DIR = (process.env.CV_IS_TEST_ISOLATED === '1' && process.env.DATA_DIR && path.resolve(process.env.DATA_DIR) !== REAL_DATA_DIR)
  ? path.resolve(process.env.DATA_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'coastalview-test-data-'));

const TEMP_DB_PATH = path.join(TEMP_DATA_DIR, 'db.json');
const TEMP_SQLITE_PATH = path.join(TEMP_DATA_DIR, 'admin_staff.sqlite');
const TEMP_UPLOADS_DIR = path.join(TEMP_DATA_DIR, 'uploads');
const TEMP_INVOICES_DIR = path.join(TEMP_DATA_DIR, 'invoices');
const TEMP_BACKUPS_DIR = path.join(TEMP_DATA_DIR, 'backups');

fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TEMP_INVOICES_DIR, { recursive: true });
fs.mkdirSync(TEMP_BACKUPS_DIR, { recursive: true });

// Copy public owner photo assets into temp uploads dir for media/owner tests
const realOwnerUploads = path.join(__dirname, 'uploads', 'owner');
const tempOwnerUploads = path.join(TEMP_UPLOADS_DIR, 'owner');
if (fs.existsSync(realOwnerUploads) && !fs.existsSync(tempOwnerUploads)) {
  try {
    fs.cpSync(realOwnerUploads, tempOwnerUploads, { recursive: true });
  } catch (_) {}
}

process.env.CV_IS_TEST_ISOLATED = '1';
process.env.DATA_DIR = TEMP_DATA_DIR;
process.env.DB_PATH = TEMP_DB_PATH;
process.env.AUTH_SQLITE_PATH = TEMP_SQLITE_PATH;
process.env.UPLOADS_DIR = TEMP_UPLOADS_DIR;
process.env.INVOICES_DIR = TEMP_INVOICES_DIR;
if (!process.env.ADMIN_EMAIL) {
  process.env.ADMIN_EMAIL = 'admin@coastalview.test';
}

// Runtime-generated random passwords (never hardcoded in repo)
function generateStrongTestPassword(suffix = 'A1!#') {
  return `CvTest_${crypto.randomBytes(10).toString('base64url')}_${suffix}`;
}

const TEST_PASSWORDS = {
  admin: process.env.CV_TEST_ADMIN_PW || generateStrongTestPassword('Adm9!'),
  newAdmin: process.env.CV_TEST_NEW_ADMIN_PW || generateStrongTestPassword('New8@'),
  altAdmin: process.env.CV_TEST_ALT_ADMIN_PW || generateStrongTestPassword('Alt7#'),
  staff: process.env.CV_TEST_STAFF_PW || generateStrongTestPassword('Stf6$'),
  manager: process.env.CV_TEST_MANAGER_PW || generateStrongTestPassword('Mgr5%'),
  editor: process.env.CV_TEST_EDITOR_PW || generateStrongTestPassword('Edt4^'),
  viewer: process.env.CV_TEST_VIEWER_PW || generateStrongTestPassword('Vwr3&'),
  wrong: process.env.CV_TEST_WRONG_PW || generateStrongTestPassword('Wrg2*'),
  weak: 'weak_' + crypto.randomBytes(2).toString('hex')
};

process.env.CV_TEST_ADMIN_PW = TEST_PASSWORDS.admin;
process.env.CV_TEST_NEW_ADMIN_PW = TEST_PASSWORDS.newAdmin;
process.env.CV_TEST_ALT_ADMIN_PW = TEST_PASSWORDS.altAdmin;
process.env.CV_TEST_STAFF_PW = TEST_PASSWORDS.staff;
process.env.CV_TEST_MANAGER_PW = TEST_PASSWORDS.manager;
process.env.CV_TEST_EDITOR_PW = TEST_PASSWORDS.editor;
process.env.CV_TEST_VIEWER_PW = TEST_PASSWORDS.viewer;
process.env.CV_TEST_WRONG_PW = TEST_PASSWORDS.wrong;

// Filesystem Guard: redirect any accidental access to REAL_DATA_DIR into TEMP_DATA_DIR
const origReadFileSync = fs.readFileSync.bind(fs);
const origWriteFileSync = fs.writeFileSync.bind(fs);
const origCopyFileSync = fs.copyFileSync.bind(fs);
const origExistsSync = fs.existsSync.bind(fs);
const origUnlinkSync = fs.unlinkSync.bind(fs);

function redirectDataPath(targetPath) {
  if (typeof targetPath !== 'string') return targetPath;
  const resolved = path.resolve(targetPath);
  if (resolved === REAL_DATA_DIR) return TEMP_DATA_DIR;
  if (resolved.startsWith(REAL_DATA_DIR + path.sep)) {
    const rel = path.relative(REAL_DATA_DIR, resolved);
    const redirected = path.join(TEMP_DATA_DIR, rel);
    fs.mkdirSync(path.dirname(redirected), { recursive: true });
    return redirected;
  }
  return targetPath;
}

let inSyncHook = false;
fs.readFileSync = function (file, ...args) {
  return origReadFileSync(redirectDataPath(file), ...args);
};
fs.writeFileSync = function (file, data, ...args) {
  const target = redirectDataPath(file);
  const res = origWriteFileSync(target, data, ...args);
  if (!inSyncHook && path.resolve(String(target)) === TEMP_DB_PATH && typeof data === 'string') {
    try {
      inSyncHook = true;
      const parsed = JSON.parse(data);
      const { syncAuthToPersistentStore } = require('./db_store');
      syncAuthToPersistentStore(parsed);
    } catch (_) {
    } finally {
      inSyncHook = false;
    }
  }
  return res;
};
fs.copyFileSync = function (src, dest, ...args) {
  return origCopyFileSync(redirectDataPath(src), redirectDataPath(dest), ...args);
};
fs.existsSync = function (file) {
  return origExistsSync(redirectDataPath(file));
};
fs.unlinkSync = function (file) {
  return origUnlinkSync(redirectDataPath(file));
};

function buildCleanSeedDatabase() {
  return {
    superAdminLocked: true,
    superAdminCreatedAt: new Date().toISOString(),
    users: [
      {
        id: 'user-super-admin',
        username: 'admin',
        name: 'Super Admin',
        email: process.env.ADMIN_EMAIL || 'admin@coastalview.test',
        role: 'Super Admin',
        status: 'Active',
        passwordHash: '',
        totpSecret: null,
        totpEnabled: false,
        requireMfaSetup: false,
        backupCodes: [],
        passwordHistory: [],
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: new Date().toISOString()
      }
    ],
    rooms: [
      {
        id: 'cosy-deluxe-room',
        name: 'Cosy Deluxe Room',
        tag: 'Non-Sea Facing',
        price: 1800,
        quantity: 7,
        blockedQuantity: 0,
        maxAdults: 2,
        maxChildren: 1,
        capacity: 'Max 2 Adults + 1 Child',
        isSoldOut: false,
        soldOutUntil: null,
        soldOutReason: null,
        image: 'assets/images/room-cosy-deluxe.jpg',
        images: ['assets/images/room-cosy-deluxe.jpg'],
        amenities: ['King Bed', 'AC', 'Wi-Fi', 'Smart TV', 'Complimentary Breakfast']
      },
      {
        id: 'ocean-whisper-room',
        name: 'The Ocean Whisper Room',
        tag: 'Sea View',
        price: 2500,
        quantity: 4,
        blockedQuantity: 0,
        maxAdults: 2,
        maxChildren: 1,
        capacity: 'Max 2 Adults + 1 Child',
        isSoldOut: false,
        soldOutUntil: null,
        soldOutReason: null,
        image: 'assets/images/room-ocean-whisper.jpg',
        images: ['assets/images/room-ocean-whisper.jpg'],
        amenities: ['Private Balcony', 'Direct Sea View', 'King Bed', 'AC', 'Wi-Fi']
      },
      {
        id: 'pool-haven-room',
        name: 'The Pool Haven Room',
        tag: 'Pool View',
        price: 2200,
        quantity: 4,
        blockedQuantity: 0,
        maxAdults: 2,
        maxChildren: 1,
        capacity: 'Max 2 Adults + 1 Child',
        isSoldOut: false,
        soldOutUntil: null,
        soldOutReason: null,
        image: 'assets/images/room-pool-haven.jpg',
        images: ['assets/images/room-pool-haven.jpg'],
        amenities: ['Pool View Deck', 'King Bed', 'AC', 'Wi-Fi', 'Mini Bar']
      },
      {
        id: 'palm-grove-family-suite',
        name: 'The Palm Grove Family Suite',
        tag: 'Family Suite',
        price: 2700,
        quantity: 2,
        blockedQuantity: 0,
        maxAdults: 4,
        maxChildren: 2,
        capacity: 'Max 4 Adults + 2 Children',
        isSoldOut: false,
        soldOutUntil: null,
        soldOutReason: null,
        image: 'assets/images/room-palm-grove.jpg',
        images: ['assets/images/room-palm-grove.jpg'],
        amenities: ['Two Queen Beds', 'Living Area', 'AC', 'Wi-Fi', 'Family Balcony']
      }
    ],
    archivedRooms: [
      { id: 'sunset-horizon-suite', name: 'The Sunset Horizon Suite', price: 8500, isArchived: true },
      { id: 'coral-retreat', name: 'The Coral Retreat', price: 6500, isArchived: true },
      { id: 'royal-pearl-villa-suite', name: 'The Royal Pearl Villa-Style Suite', price: 14500, isArchived: true }
    ],
    roomBlocks: [],
    bookings: [],
    invoices: [],
    vehicles: [
      {
        id: 'toto',
        name: 'Toto (E-Rickshaw)',
        description: 'Local short trips around Mandarmani, up to 4 passengers.',
        capacity: 4,
        enabled: true,
        maxQuantity: 5,
        pricePerDay: null,
        services: {
          pickup: { price: null, enabled: false },
          drop: { price: null, enabled: false },
          pickup_drop: { price: null, enabled: false },
          tour: { price: null, enabled: false }
        }
      },
      {
        id: 'auto',
        name: 'Auto',
        description: 'Local sightseeing and station/bus-stand pickup, up to 3 passengers.',
        capacity: 3,
        enabled: true,
        maxQuantity: 5,
        pricePerDay: null,
        services: {
          pickup: { price: null, enabled: false },
          drop: { price: null, enabled: false },
          pickup_drop: { price: null, enabled: false },
          tour: { price: null, enabled: false }
        }
      },
      {
        id: 'car',
        name: 'Car',
        description: 'Luxury AC pickup or Mandarmani tour cab, up to 4 passengers.',
        capacity: 4,
        enabled: true,
        maxQuantity: 5,
        pricePerDay: 2500,
        services: {
          pickup: { price: null, enabled: false },
          drop: { price: null, enabled: false },
          pickup_drop: { price: null, enabled: false },
          tour: { price: 2500, enabled: true }
        }
      }
    ],
    vehicleSettings: {
      enableTripType: true,
      enableRoutePricing: false,
      routes: [
        { id: 'route-1', name: 'Contai / Kanthi Railway Station', pickupPrice: null, dropPrice: null },
        { id: 'route-2', name: 'Digha Railway Station', pickupPrice: null, dropPrice: null }
      ]
    },
    menuCategories: [
      { id: 'Breakfast', name: 'Breakfast', timing: '7:00 AM to 10:30 AM', order: 1 },
      { id: 'Vegetable / Dal', name: 'Vegetable / Dal', timing: '', order: 2 },
      { id: 'Rice / Roti / Chowmin', name: 'Rice / Roti / Chowmin', timing: '', order: 3 },
      { id: 'Fish / Sea Food', name: 'Fish / Sea Food', timing: '', order: 4 },
      { id: 'Egg / Chicken / Mutton', name: 'Egg / Chicken / Mutton', timing: '', order: 5 },
      { id: 'Starters & Pakora', name: 'Starters & Pakora', timing: '5:00 PM to 9:30 PM', order: 6 },
      { id: 'Soup & Salad', name: 'Soup & Salad', timing: '', order: 7 },
      { id: 'Beverages & Desserts', name: 'Beverages & Desserts', timing: '', order: 8 }
    ],
    restaurant: [
      { id: 'dish-sf-1', name: 'Chingri Malai Curry', category: 'Fish / Sea Food', price: 450, isVeg: false, available: true, featured: true, isFeatured: true, image: 'assets/images/dish_chingri_malaikari_1792138359063.jpg' },
      { id: 'dish-sf-2', name: 'Bhetki Fish Fry', category: 'Starters & Pakora', price: 220, isVeg: false, available: true, featured: true, isFeatured: true, image: 'assets/images/dish_fish_fry_1792300461754.jpg' },
      { id: 'dish-rrc-1', name: 'Special Chicken Biryani', category: 'Rice / Roti / Chowmin', price: 280, isVeg: false, available: true, featured: true, isFeatured: true, image: 'assets/images/dish_biryani_1792300439453.jpg' }
    ],
    gallery: [
      { id: 'gallery-hotel-1', url: '/uploads/gallery/exterior-night.jpg', thumbUrl: '/uploads/gallery/exterior-night.jpg', category: 'Hotel', caption: 'Coastal View Grand Facade', alt: 'Coastal View luxury hotel exterior', featured: true, order: 1 },
      { id: 'gallery-pool-1', url: '/uploads/gallery/pool-night.jpg', thumbUrl: '/uploads/gallery/pool-night.jpg', category: 'Pool & Beach', caption: 'Infinity Pool at Night', alt: 'Swimming pool at night', featured: true, order: 2 }
    ],
    websiteContent: {
      hero: {
        h1Title: 'Coastal View: Luxury Beachfront Hotel in Mandarmani',
        tagline1: 'Where the Ocean Meets Your Escape.',
        tagline2: 'Your Coastal Escape. Your Timeless Memories.',
        heroImage: 'assets/images/hero-sunset-pool.jpg',
        ctaText: 'Reserve Your Sanctuary'
      },
      owner: {
        name: 'Anirban Das',
        title: '',
        quote: 'Welcome to Coastal View.',
        bio: 'Host of Coastal View Mandarmani.',
        photo: '/uploads/owner/anirban-das-owner.webp',
        contactDirect: '+91 7812027551'
      },
      candlelight: {
        beachsidePrice: 3500,
        poolsidePrice: 2800,
        inclusions: ['Chef-curated 4-course gourmet dinner', 'Dedicated private butler service']
      },
      places: [],
      faqs: []
    },
    mediaSlots: {
      owner: {
        url: '/uploads/owner/anirban-das-owner.webp',
        prevUrl: 'assets/images/anirban-das-owner.jpg',
        alt: "Anirban Das, owner of Coastal View and Ani's Tour and Travels, Mandarmani",
        updatedAt: new Date().toISOString()
      }
    },
    mediaHistory: [
      {
        id: 'hist-owner-init',
        slotId: 'owner',
        url: 'assets/images/anirban-das-owner.jpg',
        timestamp: new Date().toISOString()
      }
    ],
    settings: {
      taxPercentage: 12,
      enableTax: false,
      childComplimentaryAgeLimit: 5,
      extraPersonAllowed: false,
      extraPersonPrice: 0,
      captchaPolicy: 'smart',
      menuPhone: '+91 7812027551',
      menuNote: 'Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg.'
    },
    seo: {
      schema: {
        hotelType: 'Hotel',
        priceRange: '₹1,800 - ₹2,700'
      }
    },
    botSettings: {},
    chatConversations: [],
    chatInquiries: [],
    auditLog: [],
    loginHistory: [],
    emailLogs: [],
    emailOutbox: [],
    emailDailyStats: {},
    rememberedDevices: [],
    passwordResetTokens: [],
    sessions: {},
    lockouts: {}
  };
}

// Seed initial temp DB if not yet created in this temp dir
if (!origExistsSync(TEMP_DB_PATH)) {
  const initialDb = buildCleanSeedDatabase();
  origWriteFileSync(TEMP_DB_PATH, JSON.stringify(initialDb, null, 2), 'utf8');
}

/**
 * Hashes TEST_PASSWORDS.admin with Argon2id at runtime and seeds the isolated
 * temporary database + SQLite store. Never touches ./data.
 */
async function seedTestAdmin(overrides = {}) {
  const argon2 = require('argon2');
  const { readDB, writeDB } = require('./db_store');
  const db = readDB() || buildCleanSeedDatabase();
  const passwordPlain = overrides.password || TEST_PASSWORDS.admin;
  const passwordHash = await argon2.hash(passwordPlain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  const adminEmail = overrides.email || process.env.ADMIN_EMAIL || 'admin@coastalview.test';
  const adminUsername = overrides.username || 'admin';

  db.users = Array.isArray(db.users) ? db.users : [];
  const adminObj = {
    id: overrides.id || 'user-super-admin',
    username: adminUsername,
    name: overrides.name || 'Super Admin',
    email: adminEmail,
    role: 'Super Admin',
    status: 'Active',
    passwordHash,
    totpSecret: overrides.totpSecret ?? null,
    totpEnabled: Boolean(overrides.totpEnabled),
    requireMfaSetup: Boolean(overrides.requireMfaSetup),
    backupCodes: overrides.backupCodes || [],
    passwordHistory: [passwordHash],
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString()
  };

  const idx = db.users.findIndex(u => u.role === 'Super Admin' || u.username === adminUsername);
  if (idx >= 0) {
    db.users[idx] = { ...db.users[idx], ...adminObj };
  } else {
    db.users.unshift(adminObj);
  }
  db.superAdminLocked = true;
  writeDB(db);
  return { admin: adminObj, password: passwordPlain, db };
}

// Isolated Test Server Management:
// Spawns a dedicated server.js child process on an ephemeral port using TEMP_DATA_DIR
// and redirects any localhost:3000 HTTP calls in this test process to that ephemeral port.
let isolatedServerProc = null;
let isolatedServerPort = null;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function startIsolatedServer() {
  if (isolatedServerPort) return isolatedServerPort;
  await seedTestAdmin();
  const port = await findFreePort();
  isolatedServerPort = port;
  process.env.PORT = String(port);

  isolatedServerProc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: TEMP_DATA_DIR,
      DB_PATH: TEMP_DB_PATH,
      AUTH_SQLITE_PATH: TEMP_SQLITE_PATH,
      UPLOADS_DIR: TEMP_UPLOADS_DIR,
      INVOICES_DIR: TEMP_INVOICES_DIR,
      CV_IS_TEST_ISOLATED: '1'
    },
    stdio: 'ignore'
  });

  // Wait until isolated server is listening
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ok = await new Promise(r => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.destroy();
        r(true);
      });
      sock.on('error', () => r(false));
    });
    if (ok) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return port;
}

// Intercept http.request and global.fetch to route port 3000 to isolatedServerPort when active
const origHttpRequest = http.request.bind(http);
http.request = function (...args) {
  if (isolatedServerPort) {
    if (typeof args[0] === 'string' || args[0] instanceof URL) {
      const u = new URL(args[0].toString());
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.port === '3000' || u.port === '')) {
        u.port = String(isolatedServerPort);
        args[0] = u;
      }
    } else if (args[0] && typeof args[0] === 'object') {
      const opts = { ...args[0] };
      if ((!opts.hostname || opts.hostname === 'localhost' || opts.hostname === '127.0.0.1') && Number(opts.port) === 3000) {
        opts.port = isolatedServerPort;
      }
      args[0] = opts;
    }
  }
  return origHttpRequest(...args);
};

if (typeof global.fetch === 'function') {
  const origFetch = global.fetch.bind(global);
  global.fetch = async function (input, init) {
    if (!isolatedServerPort) {
      await startIsolatedServer();
    }
    if (typeof input === 'string') {
      input = input.replace(/^http:\/\/(localhost|127\.0\.0\.1):3000\b/i, `http://127.0.0.1:${isolatedServerPort}`);
    } else if (input instanceof URL) {
      if ((input.hostname === 'localhost' || input.hostname === '127.0.0.1') && input.port === '3000') {
        const cloned = new URL(input.toString());
        cloned.port = String(isolatedServerPort);
        input = cloned;
      }
    }
    return origFetch(input, init);
  };
}

function stopIsolatedServer() {
  if (isolatedServerProc) {
    try {
      isolatedServerProc.kill();
    } catch (_) {}
    isolatedServerProc = null;
  }
}

function cleanupTempDataDir() {
  stopIsolatedServer();
  try {
    const { closeAllSqliteDbs } = require('./db_store');
    closeAllSqliteDbs();
  } catch (_) {}
  try {
    if (TEMP_DATA_DIR && TEMP_DATA_DIR !== REAL_DATA_DIR && origExistsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
  } catch (_) {}
}

process.on('exit', () => {
  if (process.env.KEEP_TEST_DATA_DIR !== '1') {
    cleanupTempDataDir();
  }
});

module.exports = {
  TEMP_DATA_DIR,
  TEMP_DB_PATH,
  TEMP_SQLITE_PATH,
  TEMP_UPLOADS_DIR,
  TEMP_INVOICES_DIR,
  TEST_PASSWORDS,
  origReadFileSync,
  origExistsSync,
  generateStrongTestPassword,
  buildCleanSeedDatabase,
  seedTestAdmin,
  startIsolatedServer,
  stopIsolatedServer,
  cleanupTempDataDir
};

/**
 * Coastal View Mandarmani - Media Security & Processing Engine
 * Magic bytes validation, script filtering, EXIF stripping, Sharp re-encoding,
 * 30-second Undo safety net, and 5-version rollback history.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB limit
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// 30-second undo map: undoToken -> { slotId, roomId, photoId, previousUrl, expiresAt }
const undoStore = new Map();

// Supported slot definitions grouped by section (Requirement 4)
const PHOTO_SLOTS = [
  // 1. Hero
  {
    key: 'hero',
    section: 'Hero',
    title: 'Hero Background Panorama',
    recommendedSize: '1920 × 1080 px • 16:9',
    aspect: '16:9',
    defaultUrl: 'assets/images/hero-sunset-pool.jpg',
    defaultAlt: 'Coastal View Beachfront Resort Mandarmani Infinity Pool'
  },
  // 2. Owner
  {
    key: 'owner',
    section: 'Owner',
    title: 'Meet the Owner (Anirban Das)',
    recommendedSize: '800 × 800 px • 1:1 Square',
    aspect: '1:1',
    defaultUrl: '/uploads/owner/anirban-das-owner.webp',
    defaultAlt: 'Anirban Das, Owner & Host of Coastal View Mandarmani'
  },
  // 3. Rooms
  {
    key: 'room:cosy-deluxe-room',
    roomId: 'cosy-deluxe-room',
    section: 'Rooms',
    title: 'Cosy Deluxe Room: Cover',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/cosy-deluxe-room.jpg',
    defaultAlt: 'Cosy Deluxe Room with AC & Queen Bed'
  },
  {
    key: 'room:ocean-whisper-room',
    roomId: 'ocean-whisper-room',
    section: 'Rooms',
    title: 'Ocean Whisper Room: Cover',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/ocean-whisper-room.jpg',
    defaultAlt: 'Ocean Whisper Room Sea View Balcony'
  },
  {
    key: 'room:pool-haven-room',
    roomId: 'pool-haven-room',
    section: 'Rooms',
    title: 'Pool Haven Room: Cover',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/pool-haven-room.jpg',
    defaultAlt: 'Pool Haven Room with Direct Pool Access'
  },
  {
    key: 'room:palm-grove-family-suite',
    roomId: 'palm-grove-family-suite',
    section: 'Rooms',
    title: 'Palm Grove Family Suite: Cover',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/palm-grove-family-suite.jpg',
    defaultAlt: 'Palm Grove Family Suite for 4 Guests'
  },
  // 4. Amenities
  {
    key: 'amenity:pool',
    section: 'Amenities',
    title: 'Infinity Swimming Pool',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/hero-sunset-pool.jpg',
    defaultAlt: 'Luxury Infinity Pool with Sunset Ocean View'
  },
  {
    key: 'amenity:beach',
    section: 'Amenities',
    title: 'Direct Beach Access Pathway',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/mandarmani-beach.jpg',
    defaultAlt: 'Private Golden Sand Beach Access Mandarmani'
  },
  // 5. Candlelight
  {
    key: 'candlelight',
    section: 'Candlelight',
    title: 'Candlelight Beach Dinner',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/candlelight-dinner.jpg',
    defaultAlt: 'Private Candlelight Dinner on Mandarmani Beach'
  },
  // 6. Mocktails/Menu
  {
    key: 'cocktails',
    section: 'Mocktails/Menu',
    title: 'Coral Reef Lounge & Mocktails',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/cocktail-lounge.jpg',
    defaultAlt: 'Coral Reef Mocktail Lounge and Beachside Bar'
  },
  // 7. Places
  {
    key: 'places',
    section: 'Places',
    title: 'Nearby Coastal Attractions',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/tajpur-beach.jpg',
    defaultAlt: 'Tajpur Beach and Red Crab Coastline Mandarmani'
  },
  // 8. Gallery
  {
    key: 'gallery',
    section: 'Gallery',
    title: 'Resort Night Showcase',
    recommendedSize: '1200 × 900 px • 4:3',
    aspect: '4:3',
    defaultUrl: 'assets/images/exterior-night.jpg',
    defaultAlt: 'Coastal View Beach Resort Illuminated Night Exterior'
  },
  // 9. Logo
  {
    key: 'logo',
    section: 'Logo',
    title: 'Coastal View Brand Emblem & Logo',
    recommendedSize: '512 × 512 px • Transparent PNG/WebP',
    aspect: '1:1',
    defaultUrl: 'assets/images/logo.png',
    defaultAlt: 'Coastal View Luxury Beachfront Resort Emblem'
  }
];

/**
 * Validate image buffer using magic bytes and strict script checks.
 */
function validateImageBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty image buffer provided.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`File too large, max 8 MB (uploaded file is ${(buffer.length / (1024 * 1024)).toFixed(2)} MB).`);
  }

  // Magic bytes check
  // JPEG: FF D8 FF
  const isJpeg = (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF);
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng = (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47);
  // WebP: RIFF ... WEBP
  const isWebp = (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');

  if (!isJpeg && !isPng && !isWebp) {
    throw new Error('Unsupported file format. Only authentic JPG, PNG, and WebP images are permitted (SVG, scripts, and disguised executables are strictly rejected).');
  }

  // Deep check for injected scripts, PHP tags, or SVG XML
  const headStr = buffer.slice(0, 4096).toString('utf8').toLowerCase();
  const dangerousTokens = ['<?php', '<?=', '<svg', 'xmlns', '<script', 'eval(', 'base64_decode', '<html', '<!doctype'];
  for (const token of dangerousTokens) {
    if (headStr.includes(token)) {
      throw new Error(`Potentially malicious content (${token}) detected in image payload. Upload permanently blocked.`);
    }
  }

  return isJpeg ? 'jpg' : (isPng ? 'png' : 'webp');
}

/**
 * Re-encode image using Sharp to strip EXIF & GPS, and save with random filename.
 */
async function processAndSaveImage(buffer, subDir = 'general', filePrefix = 'media', targetExt = 'webp') {
  const detectedFormat = validateImageBuffer(buffer);

  // Re-encode via sharp (strips EXIF and GPS metadata by default)
  let cleanBuffer;
  let finalExt = 'webp';

  try {
    const sharpInstance = sharp(buffer).rotate(); // auto-orient based on EXIF before stripping
    if (targetExt === 'png' && detectedFormat === 'png') {
      cleanBuffer = await sharpInstance.png({ compressionLevel: 8 }).toBuffer();
      finalExt = 'png';
    } else {
      cleanBuffer = await sharpInstance.webp({ quality: 86, effort: 4 }).toBuffer();
      finalExt = 'webp';
    }
  } catch (sharpErr) {
    throw new Error('Corrupted or unreadable image file: ' + sharpErr.message);
  }

  // Safe random filename outside executable paths
  const cleanPrefix = (filePrefix || 'media').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const randomHex = crypto.randomBytes(8).toString('hex');
  const filename = `${cleanPrefix}-${Date.now()}-${randomHex}.${finalExt}`;

  const targetDir = path.join(UPLOADS_ROOT, subDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, cleanBuffer);

  return `/uploads/${subDir}/${filename}`;
}

/**
 * Handle Base64 image payload and safely persist it.
 */
async function saveBase64ImageSecure(base64Str, subDir = 'general', filePrefix = 'media') {
  if (!base64Str) throw new Error('No image payload received.');
  let rawData = base64Str;
  const match = base64Str.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
  if (match) {
    rawData = match[2];
  }
  const buffer = Buffer.from(rawData, 'base64');
  return processAndSaveImage(buffer, subDir, filePrefix);
}

/**
 * Record media version history (keeps last 5 versions per slot/photo).
 */
function recordMediaVersion(db, slotKey, previousUrl, user) {
  if (!previousUrl) return null;
  db.mediaHistory = db.mediaHistory || [];

  const historyEntry = {
    id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    slotKey,
    url: previousUrl,
    replacedAt: new Date().toISOString(),
    replacedBy: user ? (user.name || user.username) : 'System',
    replacedByRole: user ? user.role : 'Super Admin'
  };

  db.mediaHistory.unshift(historyEntry);

  // Keep last 5 versions for this specific slotKey
  const slotVersions = db.mediaHistory.filter(h => h.slotKey === slotKey);
  if (slotVersions.length > 5) {
    const toRemove = new Set(slotVersions.slice(5).map(h => h.id));
    db.mediaHistory = db.mediaHistory.filter(h => !toRemove.has(h.id));
  }

  // Create 30-second undo token
  const undoToken = crypto.randomBytes(16).toString('hex');
  undoStore.set(undoToken, {
    slotKey,
    previousUrl,
    expiresAt: Date.now() + 30 * 1000 // 30 seconds
  });

  return { historyEntry, undoToken };
}

/**
 * Undo photo change within 30 seconds.
 */
function performUndo(undoToken, db) {
  const item = undoStore.get(undoToken);
  if (!item || Date.now() > item.expiresAt) {
    undoStore.delete(undoToken);
    return { success: false, message: 'Undo window has expired (valid for 30 seconds after change).' };
  }

  const { slotKey, previousUrl } = item;
  undoStore.delete(undoToken);

  // Restore the previous URL
  applyUrlToSlot(db, slotKey, previousUrl);
  return {
    success: true,
    slotKey,
    restoredUrl: previousUrl,
    message: 'Photo change undone successfully. Previous image restored.'
  };
}

/**
 * Restore from history (last 5 versions).
 */
function restoreFromHistory(historyId, db) {
  db.mediaHistory = db.mediaHistory || [];
  const entry = db.mediaHistory.find(h => h.id === historyId);
  if (!entry) {
    return { success: false, message: 'Version record not found in history.' };
  }

  const { slotKey, url } = entry;
  applyUrlToSlot(db, slotKey, url);
  return {
    success: true,
    slotKey,
    restoredUrl: url,
    message: 'Version restored successfully from history.'
  };
}

/**
 * Apply URL to corresponding slot in db.
 */
function applyUrlToSlot(db, slotKey, url) {
  db.mediaSlots = db.mediaSlots || {};

  // Check if room cover slot
  if (slotKey.startsWith('room:')) {
    const roomId = slotKey.replace('room:', '');
    const room = (db.rooms || []).find(r => r.id === roomId);
    if (room) {
      room.image = url;
      if (room.gallery && room.gallery.length > 0) {
        room.gallery.forEach(p => { p.isCover = (p.url === url); });
      }
    }
    db.mediaSlots[slotKey] = { ...(db.mediaSlots[slotKey] || {}), slotKey, url, updatedAt: new Date().toISOString() };
    return;
  }

  // Website slots
  db.mediaSlots[slotKey] = {
    ...(db.mediaSlots[slotKey] || {}),
    slotKey,
    url,
    updatedAt: new Date().toISOString()
  };

  // Propagate to websiteContent / settings
  if (slotKey === 'hero') {
    db.websiteContent = db.websiteContent || {};
    db.websiteContent.hero = db.websiteContent.hero || {};
    db.websiteContent.hero.heroImage = url;
  } else if (slotKey === 'owner') {
    db.websiteContent = db.websiteContent || {};
    db.websiteContent.owner = db.websiteContent.owner || {};
    db.websiteContent.owner.photo = url;
    if (db.mediaSlots && db.mediaSlots.owner) {
      db.mediaSlots.owner.photo = url;
    }
  } else if (slotKey === 'logo') {
    db.settings = db.settings || {};
    db.settings.invoiceLogo = url;
  } else if (slotKey === 'candlelight') {
    db.mediaSlots.candlelight = { url, updatedAt: new Date().toISOString() };
  } else if (slotKey === 'cocktails') {
    db.mediaSlots.cocktails = { url, updatedAt: new Date().toISOString() };
  }
}

module.exports = {
  PHOTO_SLOTS,
  validateImageBuffer,
  processAndSaveImage,
  saveBase64ImageSecure,
  recordMediaVersion,
  performUndo,
  restoreFromHistory,
  applyUrlToSlot,
  undoStore
};

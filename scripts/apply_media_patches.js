/**
 * Script to apply media security and photo slots manager to server.js
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let serverJs = fs.readFileSync(serverPath, 'utf8');

const mediaStartMarker = '// ============================================================================\n// PHOTOS & MEDIA MANAGER APIS (SUPER ADMIN & MANAGER ONLY)';
const mediaEndMarker = '// ============================================================================\n// GALLERY SHOWCASE API (Moments at Coastal View)';

const mediaSectionReplacement = `// ============================================================================
// PHOTOS & MEDIA MANAGER APIS (SUPER ADMIN & MANAGER ONLY)
// ============================================================================

// 1. Get All Labeled Slots, Grouped by Section, with History & Room Galleries
app.get('/api/media', requireAnyStaff, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  db.mediaSlots = db.mediaSlots || {};
  db.mediaHistory = db.mediaHistory || [];

  // Build full slots list with live URLs
  const enrichedSlots = PHOTO_SLOTS.map(slot => {
    let currentUrl = slot.defaultUrl;
    let alt = slot.defaultAlt;
    let caption = '';

    // Check specific slot overrides
    if (db.mediaSlots[slot.key]) {
      currentUrl = db.mediaSlots[slot.key].url || currentUrl;
      alt = db.mediaSlots[slot.key].alt || alt;
      caption = db.mediaSlots[slot.key].caption || '';
    } else if (slot.key === 'hero' && db.websiteContent?.hero?.heroImage) {
      currentUrl = db.websiteContent.hero.heroImage;
    } else if (slot.key === 'owner' && (db.websiteContent?.owner?.photo || db.mediaSlots?.owner?.photo)) {
      currentUrl = db.websiteContent?.owner?.photo || db.mediaSlots?.owner?.photo;
    } else if (slot.key.startsWith('room:')) {
      const rId = slot.roomId;
      const room = (db.rooms || []).find(r => r.id === rId);
      if (room && room.image) currentUrl = room.image;
    }

    // Get last 5 version history for this slot
    const slotHistory = (db.mediaHistory || [])
      .filter(h => h.slotKey === slot.key)
      .slice(0, 5);

    return {
      ...slot,
      currentUrl,
      alt,
      caption,
      history: slotHistory
    };
  });

  // Group slots by section
  const sections = {};
  enrichedSlots.forEach(s => {
    sections[s.section] = sections[s.section] || [];
    sections[s.section].push(s);
  });

  res.json({
    success: true,
    slots: enrichedSlots,
    sections,
    rooms: (db.rooms || []).map(r => ({
      id: r.id,
      name: r.name,
      image: r.image,
      gallery: r.gallery || []
    })),
    mediaHistory: (db.mediaHistory || []).slice(0, 50)
  });
});

// 2. Upload / Replace Photo (Enforces Magic Bytes, Strips EXIF, 30s Undo, 5-Version History)
app.post('/api/media/upload', requireManager, async (req, res) => {
  try {
    const { slotKey, roomId, imageBase64, alt = '', caption = '', isCover = false, tag = 'general' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
    }

    const db = readDB();
    if (!db) return res.status(500).json({ success: false, message: 'Database connection error' });

    // Determine target folder
    let subDir = 'general';
    let filePrefix = 'photo';

    if (roomId) {
      subDir = 'rooms';
      filePrefix = \`room-\${roomId}\`;
    } else if (slotKey) {
      const cleanKey = slotKey.replace(/[^a-zA-Z0-9]/g, '-');
      subDir = ['hero', 'owner', 'logo', 'candlelight', 'cocktails', 'places', 'gallery'].some(s => cleanKey.includes(s)) ? cleanKey.split('-')[0] : 'general';
      filePrefix = \`slot-\${cleanKey}\`;
    }

    // Securely process image: checks magic bytes, strips EXIF/GPS, re-encodes to WebP
    const savedUrl = await saveBase64ImageSecure(imageBase64, subDir, filePrefix);

    // Case A: Room Gallery Upload
    if (roomId) {
      const room = (db.rooms || []).find(r => r.id === roomId);
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

      room.gallery = room.gallery || [];
      const previousCover = room.image;
      const photoId = \`photo-\${roomId}-\${Date.now()}\`;

      if (isCover || room.gallery.length === 0) {
        room.gallery.forEach(p => p.isCover = false);
        room.image = savedUrl;
      }

      const photoEntry = {
        id: photoId,
        url: savedUrl,
        alt: alt || \`\${room.name} Photo\`,
        caption: caption || room.name,
        tag,
        isCover: isCover || room.gallery.length === 0,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.username
      };

      room.gallery.push(photoEntry);

      // Record version history for rollback / undo
      const versionResult = recordMediaVersion(db, \`room:\${roomId}\`, previousCover, req.user);

      logAudit(db, req.user, 'Room Photo Uploaded', \`\${req.user.name} uploaded new photo for \${room.name}.\`, req);
      writeDB(db);

      return res.json({
        success: true,
        message: \`Photo uploaded for \${room.name}! Changes are live.\`,
        photo: photoEntry,
        room,
        undoToken: versionResult ? versionResult.undoToken : null
      });
    }

    // Case B: Labeled Website Slot Upload
    if (!slotKey) {
      return res.status(400).json({ success: false, message: 'Missing slotKey for media upload.' });
    }

    // Find previous URL for this slot
    db.mediaSlots = db.mediaSlots || {};
    let previousUrl = null;
    if (db.mediaSlots[slotKey]) {
      previousUrl = db.mediaSlots[slotKey].url;
    } else {
      const def = PHOTO_SLOTS.find(s => s.key === slotKey);
      if (def) previousUrl = def.defaultUrl;
    }

    // Record previous version in history & create 30-second undo token
    const versionResult = recordMediaVersion(db, slotKey, previousUrl, req.user);

    // Apply new URL
    applyUrlToSlot(db, slotKey, savedUrl);
    if (alt || caption) {
      db.mediaSlots[slotKey].alt = alt || db.mediaSlots[slotKey].alt || '';
      db.mediaSlots[slotKey].caption = caption || db.mediaSlots[slotKey].caption || '';
    }

    logAudit(db, req.user, 'Photo Slot Changed', \`\${req.user.name} updated photo slot "\${slotKey}" to \${savedUrl}.\`, req);
    writeDB(db);

    return res.json({
      success: true,
      message: 'Photo updated. Changes are live on the website immediately.',
      slotKey,
      newUrl: savedUrl,
      undoToken: versionResult ? versionResult.undoToken : null,
      history: (db.mediaHistory || []).filter(h => h.slotKey === slotKey).slice(0, 5)
    });
  } catch (err) {
    console.error('Media upload error:', err);
    res.status(400).json({ success: false, message: err.message || 'Image processing failed' });
  }
});

// 3. 30-Second Undo Action
app.post('/api/media/undo', requireManager, (req, res) => {
  const { undoToken } = req.body;
  if (!undoToken) {
    return res.status(400).json({ success: false, message: 'Missing undo authorization token.' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const result = performUndo(undoToken, db);
  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  logAudit(db, req.user, 'Photo Change Undone', \`\${req.user.name} triggered 30-second undo for slot "\${result.slotKey}".\`, req);
  writeDB(db);

  res.json({
    success: true,
    message: result.message,
    slotKey: result.slotKey,
    restoredUrl: result.restoredUrl
  });
});

// 4. Restore Any of the Last 5 Versions from History
app.post('/api/media/restore', requireManager, (req, res) => {
  const { historyId } = req.body;
  if (!historyId) {
    return res.status(400).json({ success: false, message: 'Missing historyId for version restore.' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const result = restoreFromHistory(historyId, db);
  if (!result.success) {
    return res.status(404).json({ success: false, message: result.message });
  }

  logAudit(db, req.user, 'Photo Version Restored', \`\${req.user.name} restored previous photo version for slot "\${result.slotKey}".\`, req);
  writeDB(db);

  res.json({
    success: true,
    message: result.message,
    slotKey: result.slotKey,
    restoredUrl: result.restoredUrl
  });
});

// 5. Update Photo Metadata (Alt Text & Caption)
app.post('/api/media/metadata', requireManager, (req, res) => {
  const { slotKey, roomId, photoId, alt, caption } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  if (roomId && photoId) {
    const room = (db.rooms || []).find(r => r.id === roomId);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    const photo = (room.gallery || []).find(p => p.id === photoId);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });
    if (alt !== undefined) photo.alt = alt.trim();
    if (caption !== undefined) photo.caption = caption.trim();
  } else if (slotKey) {
    db.mediaSlots = db.mediaSlots || {};
    db.mediaSlots[slotKey] = db.mediaSlots[slotKey] || {};
    if (alt !== undefined) db.mediaSlots[slotKey].alt = alt.trim();
    if (caption !== undefined) db.mediaSlots[slotKey].caption = caption.trim();
  }

  logAudit(db, req.user, 'Photo Metadata Updated', \`\${req.user.name} updated alt/caption for \${slotKey || (roomId + ':' + photoId)}.\`, req);
  writeDB(db);

  res.json({ success: true, message: 'Photo details saved successfully.' });
});

// 6. Delete Photo (with in-use warning)
app.post('/api/media/delete', requireManager, (req, res) => {
  const { slotKey, roomId, photoId, force = false } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  // Case A: Room gallery photo delete
  if (roomId && photoId) {
    const room = (db.rooms || []).find(r => r.id === roomId);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const photoIdx = (room.gallery || []).findIndex(p => p.id === photoId);
    if (photoIdx === -1) return res.status(404).json({ success: false, message: 'Photo not found in room gallery' });

    const photo = room.gallery[photoIdx];
    if (photo.isCover && room.gallery.length > 1 && !force) {
      return res.status(400).json({
        success: false,
        warning: true,
        message: 'This photo is currently set as the room cover image. Please select another cover photo first, or confirm deletion.'
      });
    }

    room.gallery.splice(photoIdx, 1);
    if (photo.isCover && room.gallery.length > 0) {
      room.gallery[0].isCover = true;
      room.image = room.gallery[0].url;
    }

    logAudit(db, req.user, 'Room Photo Deleted', \`\${req.user.name} removed photo from \${room.name}.\`, req);
    writeDB(db);
    return res.json({ success: true, message: 'Photo removed from room gallery.', room });
  }

  // Case B: Slot photo delete (resets to default fallback)
  if (slotKey) {
    const def = PHOTO_SLOTS.find(s => s.key === slotKey);
    const fallbackUrl = def ? def.defaultUrl : '';

    db.mediaSlots = db.mediaSlots || {};
    if (db.mediaSlots[slotKey]) {
      db.mediaSlots[slotKey].url = fallbackUrl;
    }
    applyUrlToSlot(db, slotKey, fallbackUrl);

    logAudit(db, req.user, 'Photo Slot Reset', \`\${req.user.name} reset slot "\${slotKey}" to default fallback.\`, req);
    writeDB(db);

    return res.json({
      success: true,
      message: 'Photo slot reset to default placeholder image.',
      slotKey,
      currentUrl: fallbackUrl
    });
  }

  res.status(400).json({ success: false, message: 'Invalid deletion target.' });
});

// 7. Room Gallery Management (Reorder, Set Cover, Delete)
app.post('/api/rooms/:id/gallery', requireManager, (req, res) => {
  const { id } = req.params;
  const { gallery = [] } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const room = (db.rooms || []).find(r => r.id === id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  room.gallery = gallery.map((item, idx) => ({
    id: item.id || \`photo-\${id}-\${Date.now()}-\${idx}\`,
    url: item.url,
    alt: item.alt || room.name,
    caption: item.caption || '',
    isCover: !!item.isCover,
    tag: item.tag || 'general',
    uploadedAt: item.uploadedAt || new Date().toISOString(),
    uploadedBy: item.uploadedBy || req.user.username
  }));

  const cover = room.gallery.find(p => p.isCover) || room.gallery[0];
  if (cover) {
    cover.isCover = true;
    room.image = cover.url;
  }

  logAudit(db, req.user, 'Room Gallery Updated', \`\${req.user.name} updated gallery for "\${room.name}" (\${room.gallery.length} photos).\`, req);
  writeDB(db);

  res.json({ success: true, message: \`Gallery updated for \${room.name}.\`, room });
});
`;

const startIdx = serverJs.indexOf(mediaStartMarker);
const endIdx = serverJs.indexOf(mediaEndMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Failed to find media replacement range');
  process.exit(1);
}

serverJs = serverJs.slice(0, startIdx) + mediaSectionReplacement.trim() + '\n\n' + serverJs.slice(endIdx);

fs.writeFileSync(serverPath, serverJs, 'utf8');
console.log('Media manager replacement applied successfully.');

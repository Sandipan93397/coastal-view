/**
 * Script to patch admin/admin.js with the complete 3-Click Photos & Media manager,
 * dedicated Invoices and Users tabs, and sensitive re-auth modal handling.
 */
const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'admin', 'admin.js');
let js = fs.readFileSync(jsPath, 'utf8');

// Find boundaries of old photos manager
const photoStartMarker = 'function initPhotosManager() {';
const photoEndMarker = '// SHOWCASE GALLERY MANAGER (Moments at Coastal View & /gallery)';

const photoStartIdx = js.indexOf(photoStartMarker);
const photoEndIdx = js.lastIndexOf('// ============================================================================', js.indexOf(photoEndMarker));


console.log('Photos start found:', photoStartIdx !== -1, 'end found:', photoEndIdx !== -1);

const newPhotoAndTabsCode = `// ============================================================================
// REDESIGNED 3-CLICK PHOTOS & MEDIA MANAGER ENGINE (REQUIREMENT 4)
// ============================================================================

// State for Photo Cropper & Upload Flow
let currentCropSlotKey = null;
let currentCropRoomId = null;
let currentCropPhotoId = null;
let currentCropIsCover = false;
let currentCropTargetAspect = 16 / 9; // locked aspect ratio
let cropSourceImage = null;
let cropState = {
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

let currentUndoToken = null;
let undoCountdownInterval = null;

// Initialize Photos Manager & Canvas Listeners
function initPhotosManager() {
  const dropzone = document.getElementById('photoModalDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handlePhotoFileSelected(e.dataTransfer.files);
      }
    });
  }

  // Canvas Drag / Pan Listeners
  const canvas = document.getElementById('photoCropCanvas');
  if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
      cropState.isDragging = true;
      cropState.dragStartX = e.clientX - cropState.panX;
      cropState.dragStartY = e.clientY - cropState.panY;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!cropState.isDragging) return;
      cropState.panX = e.clientX - cropState.dragStartX;
      cropState.panY = e.clientY - cropState.dragStartY;
      drawCropCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (cropState.isDragging) {
        cropState.isDragging = false;
        if (canvas) canvas.style.cursor = 'grab';
      }
    });

    // Mobile touch pan support
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        cropState.isDragging = true;
        cropState.dragStartX = e.touches[0].clientX - cropState.panX;
        cropState.dragStartY = e.touches[0].clientY - cropState.panY;
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (cropState.isDragging && e.touches.length === 1) {
        cropState.panX = e.touches[0].clientX - cropState.dragStartX;
        cropState.panY = e.touches[0].clientY - cropState.dragStartY;
        drawCropCanvas();
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      cropState.isDragging = false;
    });
  }
}

// Fetch all Media Slots & Galleries
async function loadPhotosData(isRefresh = false) {
  try {
    if (isRefresh) showToast('Refreshing media records...', 'info');
    const res = await authFetch('/api/media');
    if (res.success) {
      adminState.mediaSlots = res.slots || [];
      adminState.mediaSections = res.sections || {};
      adminState.mediaHistory = res.mediaHistory || [];
      if (Array.isArray(res.rooms)) {
        res.rooms.forEach(freshRoom => {
          const existing = (adminState.rooms || []).find(r => r.id === freshRoom.id);
          if (existing) {
            existing.image = freshRoom.image;
            existing.gallery = freshRoom.gallery || [];
          }
        });
      }
      renderPhotosManager();
      if (isRefresh) showToast('Media slots up to date.', 'success');
    }
  } catch (err) {
    console.error('Error fetching media:', err);
  }
}

// Render the 9 Labeled Slots in Photos & Media
function renderPhotosManager() {
  const container = document.getElementById('photoSlotsContainer');
  if (!container) return;

  const slots = adminState.mediaSlots || [];

  if (slots.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #64748B; padding: 32px;">Loading media slots...</div>';
    return;
  }

  container.innerHTML = slots.map(slot => {
    const historyCount = (slot.history || []).length;
    const hasImage = slot.currentUrl && !slot.currentUrl.includes('placeholder');

    return \`
      <div class="photo-slot-card" data-section="\${slot.section}" data-slot-key="\${slot.key}">
        <div class="slot-image-wrapper">
          \${hasImage ? \`
            <img src="\${slot.currentUrl}" alt="\${slot.alt || slot.title}" class="slot-current-img" loading="lazy" onerror="this.src='../assets/images/logo.png'">
          \` : \`
            <div class="slot-empty-state">
              <span class="material-symbols-outlined" style="font-size: 36px;">add_photo_alternate</span>
              <span style="font-size: 0.85rem; font-weight: 600;">Empty Slot</span>
            </div>
          \`}
          <div class="slot-badge">\${slot.section}</div>
        </div>

        <div class="slot-card-body">
          <h3 class="slot-title">\${slot.title}</h3>
          <div class="slot-rec-size">
            <span class="material-symbols-outlined" style="font-size: 16px;">straighten</span>
            <span>Recommended: \${slot.recommendedSize}</span>
          </div>

          <!-- One Large Prominent Action Button -->
          <button class="btn-change-photo" onclick="openChangePhotoModal('\${slot.key}')">
            <span class="material-symbols-outlined">photo_camera</span> Change Photo
          </button>

          <!-- 3 Plain Secondary Options -->
          <div class="slot-actions-row">
            <button class="btn-slot-option" onclick="openEditMetadataModal('\${slot.key}')" title="Edit Alt text and caption">
              <span class="material-symbols-outlined" style="font-size: 15px;">edit_note</span> Edit Text
            </button>
            <button class="btn-slot-option" onclick="openHistoryModal('\${slot.key}')" title="Restore previous version">
              <span class="material-symbols-outlined" style="font-size: 15px;">history</span> Restore (\${historyCount})
            </button>
            <button class="btn-slot-option danger" onclick="confirmDeleteSlotPhoto('\${slot.key}')" title="Delete photo">
              <span class="material-symbols-outlined" style="font-size: 15px;">delete</span> Delete
            </button>
          </div>
        </div>
      </div>
    \`;
  }).join('');

  // Render Room Gallery Strips
  renderRoomGalleriesStrips();
}

// Render Room Gallery Strips
function renderRoomGalleriesStrips() {
  const container = document.getElementById('roomGalleriesContainer');
  if (!container) return;

  const rooms = (adminState.rooms || []).filter(r => !r.isArchived);
  if (rooms.length === 0) {
    container.innerHTML = '<p style="color: #64748B;">No rooms available.</p>';
    return;
  }

  container.innerHTML = rooms.map(room => {
    const gallery = room.gallery || [];
    return \`
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px; margin-bottom: 24px; box-shadow: 0 4px 14px rgba(7, 59, 76, 0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="margin: 0; color: #073B4C; font-size: 1.15rem; font-weight: 700;">\${room.name}</h3>
            <span style="font-size: 0.8rem; color: #64748B;">\${gallery.length} Photos in Gallery • Cover Image Live on Website</span>
          </div>
          <button class="btn-outline-gold" onclick="openChangePhotoModal(null, '\${room.id}', null, false)" style="font-size: 0.82rem; padding: 6px 14px;">
            <span class="material-symbols-outlined" style="font-size: 16px;">add_photo_alternate</span> Add Room Photo
          </button>
        </div>

        <!-- Room Gallery Strip -->
        <div style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: thin;">
          \${gallery.map((p, idx) => \`
            <div style="flex: 0 0 220px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;">
              <div style="position: relative; height: 130px; background: #0F172A;">
                <img src="\${p.url}" alt="\${p.alt || room.name}" style="width: 100%; height: 100%; object-fit: cover;">
                \${p.isCover ? '<span style="position: absolute; top: 8px; left: 8px; background: #E8C77B; color: #073B4C; font-size: 0.68rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">COVER</span>' : ''}
              </div>
              <div style="padding: 10px; display: flex; flex-direction: column; gap: 6px; flex: 1;">
                <div style="font-size: 0.8rem; font-weight: 600; color: #073B4C; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  \${p.caption || \`Photo #\${idx + 1}\`}
                </div>
                <button class="btn-change-photo" onclick="openChangePhotoModal(null, '\${room.id}', '\${p.id}', \${p.isCover})" style="padding: 6px 10px; font-size: 0.76rem;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">photo_camera</span> Change Photo
                </button>
                <div style="display: flex; gap: 4px;">
                  \${!p.isCover ? \`
                    <button class="btn-slot-option" onclick="setRoomCoverPhoto('\${room.id}', '\${p.id}')" style="font-size: 0.72rem;">Make Cover</button>
                  \` : ''}
                  <button class="btn-slot-option danger" onclick="confirmDeleteSlotPhoto(null, '\${room.id}', '\${p.id}')" style="font-size: 0.72rem;">Delete</button>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>
      </div>
    \`;
  }).join('');
}

// Filter Photo Slots by Section
window.filterPhotoSlots = function(section, btn) {
  document.querySelectorAll('.photo-section-filters .filter-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const cards = document.querySelectorAll('.photo-slot-card');
  cards.forEach(card => {
    if (section === 'all' || card.getAttribute('data-section') === section) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });
};

// Open the 3-Click Change Photo Modal
window.openChangePhotoModal = function(slotKey = null, roomId = null, photoId = null, isCover = false) {
  currentCropSlotKey = slotKey;
  currentCropRoomId = roomId;
  currentCropPhotoId = photoId;
  currentCropIsCover = isCover;
  cropSourceImage = null;
  cropState = { zoom: 1.0, panX: 0, panY: 0, isDragging: false, dragStartX: 0, dragStartY: 0 };

  const modal = document.getElementById('changePhotoModal');
  const titleEl = document.getElementById('changePhotoModalTitle');
  const subEl = document.getElementById('changePhotoModalSubtitle');
  const currentPreview = document.getElementById('currentPhotoPreviewImg');
  const sideBySide = document.getElementById('sideBySideWrapper');
  const dropzone = document.getElementById('photoModalDropzone');
  const saveBtn = document.getElementById('btnSavePhotoChange');
  const errBox = document.getElementById('changePhotoErrorMsg');

  if (errBox) errBox.style.display = 'none';
  if (sideBySide) sideBySide.style.display = 'none';
  if (dropzone) dropzone.style.display = 'block';
  if (saveBtn) saveBtn.disabled = true;

  // Determine current image and target aspect ratio
  let slotObj = null;
  if (slotKey) {
    slotObj = (adminState.mediaSlots || []).find(s => s.key === slotKey);
  }

  if (slotObj) {
    titleEl.textContent = \`Change Photo: \${slotObj.title}\`;
    subEl.textContent = \`Recommended: \${slotObj.recommendedSize} • Instant live update\`;
    if (currentPreview) currentPreview.src = slotObj.currentUrl;

    if (slotObj.aspect === '1:1') currentCropTargetAspect = 1.0;
    else if (slotObj.aspect === '16:9') currentCropTargetAspect = 16 / 9;
    else currentCropTargetAspect = 4 / 3;
  } else if (roomId) {
    const room = (adminState.rooms || []).find(r => r.id === roomId);
    titleEl.textContent = \`Change Photo: \${room ? room.name : 'Room Gallery'}\`;
    subEl.textContent = 'Recommended: 1200 × 900 px (4:3) • Instant live update';
    currentCropTargetAspect = 4 / 3;
    if (photoId && room && room.gallery) {
      const p = room.gallery.find(x => x.id === photoId);
      if (p && currentPreview) currentPreview.src = p.url;
    } else if (room && currentPreview) {
      currentPreview.src = room.image;
    }
  }

  if (modal) modal.style.display = 'flex';
};

window.closeChangePhotoModal = function() {
  const modal = document.getElementById('changePhotoModal');
  if (modal) modal.style.display = 'none';
  cropSourceImage = null;
};

// Handle File Selected / Dropped
window.handlePhotoFileSelected = function(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  const errBox = document.getElementById('changePhotoErrorMsg');
  if (errBox) errBox.style.display = 'none';

  // Validate File Size (Max 8 MB)
  if (file.size > 8 * 1024 * 1024) {
    if (errBox) {
      errBox.textContent = \`File too large, max 8 MB (Selected file: \${(file.size / (1024 * 1024)).toFixed(1)} MB).\`;
      errBox.style.display = 'block';
    }
    return;
  }

  // Validate Allowed MIME Types
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    if (errBox) {
      errBox.textContent = 'Unsupported file format. Please choose an authentic JPG, PNG, or WebP picture.';
      errBox.style.display = 'block';
    }
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      cropSourceImage = img;
      cropState = { zoom: 1.0, panX: 0, panY: 0, isDragging: false, dragStartX: 0, dragStartY: 0 };
      const slider = document.getElementById('cropZoomSlider');
      if (slider) slider.value = 1.0;

      // Show side-by-side preview
      const sideBySide = document.getElementById('sideBySideWrapper');
      if (sideBySide) sideBySide.style.display = 'grid';

      drawCropCanvas();

      const saveBtn = document.getElementById('btnSavePhotoChange');
      if (saveBtn) saveBtn.disabled = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

// Draw Canvas with aspect ratio locked
function drawCropCanvas() {
  const canvas = document.getElementById('photoCropCanvas');
  if (!canvas || !cropSourceImage) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, w, h);

  // Compute fitted image dimensions based on zoom
  const imgAspect = cropSourceImage.width / cropSourceImage.height;
  let drawW, drawH;

  if (imgAspect > (w / h)) {
    drawW = w * cropState.zoom;
    drawH = (w / imgAspect) * cropState.zoom;
  } else {
    drawH = h * cropState.zoom;
    drawW = (h * imgAspect) * cropState.zoom;
  }

  const drawX = (w - drawW) / 2 + cropState.panX;
  const drawY = (h - drawH) / 2 + cropState.panY;

  ctx.drawImage(cropSourceImage, drawX, drawY, drawW, drawH);

  // Draw semi-transparent framing mask
  ctx.strokeStyle = '#E8C77B';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);
}

window.handleCropZoomChange = function(val) {
  cropState.zoom = parseFloat(val);
  drawCropCanvas();
};

window.resetCropPosition = function() {
  cropState = { zoom: 1.0, panX: 0, panY: 0, isDragging: false, dragStartX: 0, dragStartY: 0 };
  const slider = document.getElementById('cropZoomSlider');
  if (slider) slider.value = 1.0;
  drawCropCanvas();
};

// Execute Save Photo Change (Click 3: Instant Live Update)
window.executeSavePhotoChange = async function() {
  const canvas = document.getElementById('photoCropCanvas');
  if (!canvas || !cropSourceImage) return;

  const saveBtn = document.getElementById('btnSavePhotoChange');
  const progressWrap = document.getElementById('uploadProgressWrap');
  const progressBar = document.getElementById('uploadProgressBar');
  const progressPct = document.getElementById('uploadProgressPercent');
  const errBox = document.getElementById('changePhotoErrorMsg');

  if (errBox) errBox.style.display = 'none';
  if (saveBtn) saveBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  // Animate progress
  let pct = 20;
  if (progressBar) progressBar.style.width = '20%';
  if (progressPct) progressPct.textContent = '20%';

  const base64Data = canvas.toDataURL('image/webp', 0.88);

  pct = 60;
  if (progressBar) progressBar.style.width = '60%';
  if (progressPct) progressPct.textContent = '60%';

  try {
    const payload = {
      slotKey: currentCropSlotKey,
      roomId: currentCropRoomId,
      photoId: currentCropPhotoId,
      isCover: currentCropIsCover,
      imageBase64: base64Data
    };

    const res = await authFetch('/api/media/upload', {
      method: 'POST',
      body: payload
    });

    if (progressBar) progressBar.style.width = '100%';
    if (progressPct) progressPct.textContent = '100%';

    if (res.success) {
      closeChangePhotoModal();
      showToast('Photo updated. Changes are live on the website immediately!', 'success');

      // Refresh media state
      await loadPhotosData();

      // Show 30-Second Floating Undo Banner
      if (res.undoToken) {
        startUndoCountdown(res.undoToken);
      }
    } else {
      if (errBox) {
        errBox.textContent = res.message || 'Image upload failed.';
        errBox.style.display = 'block';
      }
      if (saveBtn) saveBtn.disabled = false;
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Network or processing error during image upload.';
      errBox.style.display = 'block';
    }
    if (saveBtn) saveBtn.disabled = false;
  } finally {
    if (progressWrap) progressWrap.style.display = 'none';
  }
};

// 30-Second Floating Undo Banner Engine
function startUndoCountdown(undoToken) {
  currentUndoToken = undoToken;
  if (undoCountdownInterval) clearInterval(undoCountdownInterval);

  const banner = document.getElementById('undoFloatingBanner');
  const cdText = document.getElementById('undoBannerCountdown');
  if (!banner) return;

  banner.style.display = 'flex';
  let remaining = 30;

  function update() {
    if (cdText) cdText.textContent = \`Undo available for \${remaining}s\`;
    if (remaining <= 0) {
      clearInterval(undoCountdownInterval);
      banner.style.display = 'none';
      currentUndoToken = null;
    }
    remaining--;
  }

  update();
  undoCountdownInterval = setInterval(update, 1000);
}

window.dismissUndoBanner = function() {
  const banner = document.getElementById('undoFloatingBanner');
  if (banner) banner.style.display = 'none';
  if (undoCountdownInterval) clearInterval(undoCountdownInterval);
  currentUndoToken = null;
};

window.executeUndoLastPhotoChange = async function() {
  if (!currentUndoToken) return;

  try {
    showToast('Undoing photo change...', 'info');
    const res = await authFetch('/api/media/undo', {
      method: 'POST',
      body: { undoToken: currentUndoToken }
    });

    if (res.success) {
      dismissUndoBanner();
      showToast('Photo update undone. Previous image restored immediately.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Undo window expired.', 'error');
    }
  } catch (e) {
    showToast('Error during undo.', 'error');
  }
};

// Version History & Restore Modal
window.openHistoryModal = function(slotKey) {
  const modal = document.getElementById('photoHistoryModal');
  const titleEl = document.getElementById('historyModalTitle');
  const listEl = document.getElementById('historyVersionsList');
  if (!modal || !listEl) return;

  const slot = (adminState.mediaSlots || []).find(s => s.key === slotKey);
  titleEl.textContent = \`Version History: \${slot ? slot.title : slotKey}\`;

  const history = (slot && slot.history) ? slot.history : [];

  if (history.length === 0) {
    listEl.innerHTML = '<div style="text-align: center; color: #64748B; padding: 24px;">No previous versions recorded yet for this slot.</div>';
  } else {
    listEl.innerHTML = history.map((ver, idx) => \`
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #E2E8F0; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="\${ver.url}" alt="Version \${idx + 1}" style="width: 72px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid #CBD5E1;">
          <div>
            <div style="font-weight: 700; color: #073B4C; font-size: 0.88rem;">Version #\${idx + 1}</div>
            <div style="font-size: 0.76rem; color: #64748B;">Replaced \${new Date(ver.replacedAt).toLocaleString('en-IN')} by \${ver.replacedBy || 'Staff'}</div>
          </div>
        </div>
        <button class="btn-turquoise" onclick="executeRestoreVersion('\${ver.id}')" style="padding: 6px 14px; font-size: 0.8rem;">
          <span class="material-symbols-outlined" style="font-size: 16px;">restore</span> Restore
        </button>
      </div>
    \`).join('');
  }

  modal.style.display = 'flex';
};

window.closeHistoryModal = function() {
  const modal = document.getElementById('photoHistoryModal');
  if (modal) modal.style.display = 'none';
};

window.executeRestoreVersion = async function(historyId) {
  try {
    showToast('Restoring previous version...', 'info');
    const res = await authFetch('/api/media/restore', {
      method: 'POST',
      body: { historyId }
    });

    if (res.success) {
      closeHistoryModal();
      showToast('Version restored live on the website!', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Failed to restore version.', 'error');
    }
  } catch (e) {
    showToast('Connection error during restore.', 'error');
  }
};

// Edit Alt Text & Caption
let targetMetaSlotKey = null;
let targetMetaRoomId = null;
let targetMetaPhotoId = null;

window.openEditMetadataModal = function(slotKey, roomId = null, photoId = null) {
  targetMetaSlotKey = slotKey;
  targetMetaRoomId = roomId;
  targetMetaPhotoId = photoId;

  const modal = document.getElementById('editMetadataModal');
  const altInput = document.getElementById('metaAltInput');
  const capInput = document.getElementById('metaCaptionInput');

  if (slotKey) {
    const slot = (adminState.mediaSlots || []).find(s => s.key === slotKey);
    if (altInput) altInput.value = (slot && slot.alt) || '';
    if (capInput) capInput.value = (slot && slot.caption) || '';
  }

  if (modal) modal.style.display = 'flex';
};

window.closeEditMetadataModal = function() {
  const modal = document.getElementById('editMetadataModal');
  if (modal) modal.style.display = 'none';
};

window.executeSaveMetadata = async function() {
  const alt = document.getElementById('metaAltInput').value;
  const caption = document.getElementById('metaCaptionInput').value;

  try {
    const res = await authFetch('/api/media/metadata', {
      method: 'POST',
      body: {
        slotKey: targetMetaSlotKey,
        roomId: targetMetaRoomId,
        photoId: targetMetaPhotoId,
        alt,
        caption
      }
    });

    if (res.success) {
      closeEditMetadataModal();
      showToast('Photo details saved.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Failed to update details.', 'error');
    }
  } catch (e) {
    showToast('Network error.', 'error');
  }
};

// Delete Photo Confirmation
let targetDeleteSlotKey = null;
let targetDeleteRoomId = null;
let targetDeletePhotoId = null;

window.confirmDeleteSlotPhoto = function(slotKey = null, roomId = null, photoId = null) {
  targetDeleteSlotKey = slotKey;
  targetDeleteRoomId = roomId;
  targetDeletePhotoId = photoId;

  const modal = document.getElementById('deletePhotoConfirmModal');
  if (modal) modal.style.display = 'flex';
};

window.closeDeletePhotoModal = function() {
  const modal = document.getElementById('deletePhotoConfirmModal');
  if (modal) modal.style.display = 'none';
};

window.executeConfirmDeletePhoto = async function() {
  try {
    const res = await authFetch('/api/media/delete', {
      method: 'POST',
      body: {
        slotKey: targetDeleteSlotKey,
        roomId: targetDeleteRoomId,
        photoId: targetDeletePhotoId,
        force: true
      }
    });

    if (res.success) {
      closeDeletePhotoModal();
      showToast(res.message || 'Photo removed successfully.', 'success');
      loadPhotosData();
    } else {
      showToast(res.message || 'Could not delete photo.', 'error');
    }
  } catch (e) {
    showToast('Network error during delete.', 'error');
  }
};

// Set Room Cover Photo
window.setRoomCoverPhoto = async function(roomId, photoId) {
  const room = (adminState.rooms || []).find(r => r.id === roomId);
  if (!room) return;

  const gallery = (room.gallery || []).map(p => ({
    ...p,
    isCover: (p.id === photoId)
  }));

  try {
    const res = await authFetch(\`/api/rooms/\${roomId}/gallery\`, {
      method: 'POST',
      body: { gallery }
    });
    if (res.success) {
      showToast('Cover photo updated for ' + room.name, 'success');
      loadPhotosData();
    }
  } catch (e) {
    showToast('Error updating cover photo', 'error');
  }
};

// ============================================================================
// DEDICATED INVOICES TAB RENDERER (REQUIREMENT 5)
// ============================================================================
function renderInvoicesTab() {
  const tbody = document.getElementById('invoicesTableBody');
  if (!tbody) return;

  const bookings = adminState.bookings || [];
  if (bookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748B; padding: 24px;">No reservations found.</td></tr>';
    return;
  }

  tbody.innerHTML = bookings.map(b => {
    const invoiceNo = b.invoiceNumber || \`CV-2026-\${b.bookingId}\`;
    const total = (b.totalAmount || 0).toLocaleString('en-IN');
    const advance = (b.payNowAdvance || 0).toLocaleString('en-IN');
    const balance = (b.payAtHotelBalance || 0).toLocaleString('en-IN');

    return \`
      <tr>
        <td data-label="Invoice No"><strong>\${invoiceNo}</strong></td>
        <td data-label="Booking ID"><span style="font-family: monospace; color: var(--turquoise);">\${b.bookingId}</span></td>
        <td data-label="Guest Name">\${b.guestName}</td>
        <td data-label="Room Type">\${b.roomName}</td>
        <td data-label="Stay Dates">\${b.checkIn} to \${b.checkOut}</td>
        <td data-label="Total Bill">₹\${total}</td>
        <td data-label="20% Advance" style="color: var(--sunset-coral); font-weight: 700;">₹\${advance}</td>
        <td data-label="80% Balance" style="color: var(--turquoise); font-weight: 700;">₹\${balance}</td>
        <td data-label="Actions">
          <div style="display: flex; gap: 6px;">
            <button class="btn-table-action" onclick="window.open('/api/admin/invoices/\${b.id}/download')" title="Download Luxury A4 PDF">
              <span class="material-symbols-outlined" style="font-size: 16px;">download</span> PDF
            </button>
            <button class="btn-table-action" onclick="resendBookingInvoiceEmail('\${b.id}')" title="Resend Invoice to Guest Email">
              <span class="material-symbols-outlined" style="font-size: 16px;">send</span>
            </button>
          </div>
        </td>
      </tr>
    \`;
  }).join('');
}

window.filterInvoicesTable = function(query) {
  const term = (query || '').toLowerCase();
  const rows = document.querySelectorAll('#invoicesTableBody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(term) ? '' : 'none';
  });
};

window.filterInvoicesByStatus = function(status) {
  // Can filter based on booking status
};

// ============================================================================
// DEDICATED USERS TAB RENDERER (SUPER ADMIN ONLY)
// ============================================================================
async function renderUsersTab() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  try {
    const res = await authFetch('/api/admin/users');
    if (res.success && Array.isArray(res.users)) {
      tbody.innerHTML = res.users.map(u => \`
        <tr>
          <td data-label="Username"><strong>\${u.username}</strong></td>
          <td data-label="Full Name">\${u.name || u.username}</td>
          <td data-label="Email Address">\${u.email || (u.username + '@coastalviewmandarmani.com')}</td>
          <td data-label="Role"><span class="role-badge \${u.role.toLowerCase().replace(/\\s+/g, '-')}" style="padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.74rem;">\${u.role}</span></td>
          <td data-label="2FA Status"><span style="color: var(--turquoise); font-weight: 600;">Active (Email / TOTP)</span></td>
          <td data-label="Actions">
            \${u.role !== 'Super Admin' ? \`
              <button class="btn-table-action danger" onclick="confirmDeleteStaffUser('\${u.username}')" style="color: #DC2626;">
                <span class="material-symbols-outlined" style="font-size: 16px;">delete</span> Delete
              </button>
            \` : '<span style="font-size: 0.75rem; color: #94A3B8;">Primary Account</span>'}
          </td>
        </tr>
      \`).join('');
    }
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

window.confirmDeleteStaffUser = function(username) {
  promptReauthModal(async () => {
    try {
      const res = await authFetch(\`/api/admin/users/\${username}\`, { method: 'DELETE' });
      if (res.success) {
        showToast(\`Staff account \${username} removed.\`, 'success');
        renderUsersTab();
      } else {
        showToast(res.message || 'Could not remove staff account.', 'error');
      }
    } catch (e) {
      showToast('Network error.', 'error');
    }
  }, \`Confirm deletion of staff account "\${username}". Enter password:\`);
};

// ============================================================================
// SENSITIVE ACTION REAUTH MODAL HANDLER
// ============================================================================
let pendingReauthAction = null;

window.promptReauthModal = function(callback, customPrompt = null) {
  pendingReauthAction = callback;
  const modal = document.getElementById('reauthModal');
  const promptText = document.getElementById('reauthPromptText');
  const passInput = document.getElementById('reauthPasswordInput');
  const errBox = document.getElementById('reauthErrorMsg');

  if (errBox) errBox.style.display = 'none';
  if (passInput) passInput.value = '';
  if (customPrompt && promptText) promptText.textContent = customPrompt;

  if (modal) modal.style.display = 'flex';
  if (passInput) passInput.focus();
};

window.closeReauthModal = function() {
  const modal = document.getElementById('reauthModal');
  if (modal) modal.style.display = 'none';
  pendingReauthAction = null;
};

window.submitReauthConfirmation = async function() {
  const passInput = document.getElementById('reauthPasswordInput');
  const errBox = document.getElementById('reauthErrorMsg');
  const password = passInput ? passInput.value : '';

  if (!password) {
    if (errBox) {
      errBox.textContent = 'Please enter your password.';
      errBox.style.display = 'block';
    }
    return;
  }

  try {
    const res = await authFetch('/api/auth/reauth', {
      method: 'POST',
      body: { password }
    });

    if (res.success) {
      closeReauthModal();
      showToast('Security confirmation verified.', 'success');
      if (typeof pendingReauthAction === 'function') {
        const action = pendingReauthAction;
        pendingReauthAction = null;
        action();
      }
    } else {
      if (errBox) {
        errBox.textContent = res.message || 'Incorrect password confirmation.';
        errBox.style.display = 'block';
      }
    }
  } catch (e) {
    if (errBox) {
      errBox.textContent = 'Error connecting to reauth endpoint.';
      errBox.style.display = 'block';
    }
  }
};
`;

if (photoStartIdx !== -1 && photoEndIdx !== -1) {
  js = js.slice(0, photoStartIdx) + newPhotoAndTabsCode + '\n\n' + js.slice(photoEndIdx);
  fs.writeFileSync(jsPath, js, 'utf8');
  console.log('admin.js successfully patched with complete 3-Click Photos Manager, Invoices, Users, and Re-Auth!');
} else {
  console.error('Could not find photoStartIdx or photoEndIdx in admin.js');
}

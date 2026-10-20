/**
 * Script to patch admin/index.html with:
 * 1. Clean "Change Photo" grid in tabPhotos
 * 2. Dedicated tabGallery, tabInvoices, and tabUsers panes
 * 3. Change Photo modal (Side-by-Side Current vs New + crop tool)
 * 4. 30-Second floating Undo banner
 * 5. Version History & Restore modal
 * 6. Sensitive Action Reauth modal
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'admin', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// --- 1. REDESIGNED TAB PHOTOS PANE ---
const newTabPhotos = `<section class="admin-tab-pane" id="tabPhotos">
        <div class="page-header-block">
          <div>
            <h1 class="page-title">Photos & Media Manager</h1>
            <p class="page-subtitle">Swap any picture across the resort in three clicks. Changes go live on the website immediately.</p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="btn-outline-gold" onclick="loadPhotosData(true)">
              <span class="material-symbols-outlined">sync</span> Refresh Media
            </button>
          </div>
        </div>

        <!-- Role Banner for Front Desk -->
        <div id="photosRoleRestrictedNotice" style="display: none; background: #FFF0EE; border: 1px solid var(--sunset-coral); border-radius: 12px; padding: 18px; margin-bottom: 24px; color: var(--coral-dark);">
          <strong style="display: flex; align-items: center; gap: 8px;">
            <span class="material-symbols-outlined">lock</span> Access Restricted
          </strong>
          <p style="margin: 6px 0 0; font-size: 0.85rem;">Photos and media changes are restricted to Super Admin and Manager accounts.</p>
        </div>

        <!-- Section Navigation Filter Pills -->
        <div class="photo-section-filters" id="photoSectionFilters">
          <button class="filter-pill active" onclick="filterPhotoSlots('all', this)">All Sections (9)</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Hero', this)">Hero</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Owner', this)">Owner</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Rooms', this)">Rooms</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Amenities', this)">Amenities</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Candlelight', this)">Candlelight</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Mocktails/Menu', this)">Mocktails/Menu</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Places', this)">Places</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Gallery', this)">Gallery</button>
          <button class="filter-pill" onclick="filterPhotoSlots('Logo', this)">Logo</button>
        </div>

        <!-- The 9 Labeled Slot Sections Grid -->
        <div class="photo-slots-grid" id="photoSlotsContainer">
          <!-- Rendered dynamically via renderPhotosManager() in admin.js -->
        </div>

        <!-- Room Galleries Strip Section -->
        <div style="margin-top: 48px;">
          <div class="page-header-block" style="margin-bottom: 20px;">
            <div>
              <h2 style="font-size: 1.4rem; color: #073B4C; margin: 0; font-family: 'Playfair Display', Georgia, serif;">
                Room Photo Galleries
              </h2>
              <p style="font-size: 0.85rem; color: #64748B; margin: 4px 0 0;">
                Manage each room's photo collection, change cover images, reorder, and add room showcase views.
              </p>
            </div>
          </div>
          <div id="roomGalleriesContainer">
            <!-- Room gallery strips rendered dynamically -->
          </div>
        </div>
      </section>`;

const photosStart = html.indexOf('<section class="admin-tab-pane" id="tabPhotos">');
const photosEnd = html.indexOf('<section class="admin-tab-pane" id="tabContent">');

if (photosStart !== -1 && photosEnd !== -1) {
  html = html.slice(0, photosStart) + newTabPhotos.trim() + '\n\n      ' + html.slice(photosEnd);
}

// --- 2. ADD DEDICATED TABS: GALLERY, INVOICES, USERS ---
const newDedicatedTabs = `
      <!-- ======================================================================
           6. SHOWCASE GALLERY TAB
           ====================================================================== -->
      <section class="admin-tab-pane" id="tabGallery">
        <div class="page-header-block">
          <div>
            <h1 class="page-title">Moments at Coastal View (Gallery)</h1>
            <p class="page-subtitle">Showcase photos displayed in the public gallery and homepage highlights.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn-turquoise" onclick="openAddGalleryPhotoModal()">
              <span class="material-symbols-outlined">add_photo_alternate</span> Add Photo to Gallery
            </button>
            <button class="btn-outline-gold" onclick="loadPhotosData(true)">
              <span class="material-symbols-outlined">sync</span> Refresh
            </button>
          </div>
        </div>

        <div id="galleryShowcaseGrid" class="gallery-showcase-grid">
          <!-- Rendered dynamically -->
        </div>
      </section>

      <!-- ======================================================================
           8. OFFICIAL INVOICES TAB
           ====================================================================== -->
      <section class="admin-tab-pane" id="tabInvoices">
        <div class="page-header-block">
          <div>
            <h1 class="page-title">Official Invoices & Tax Receipts</h1>
            <p class="page-subtitle">Manage guest invoices, 20% advance vouchers, GST receipts, and Luxury A4 PDF downloads.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn-outline-gold" onclick="openInvoiceSettingsModal()">
              <span class="material-symbols-outlined">tune</span> Invoice & GST Settings
            </button>
            <button class="btn-turquoise" onclick="loadAllAdminData(true)">
              <span class="material-symbols-outlined">sync</span> Refresh Invoices
            </button>
          </div>
        </div>

        <!-- Invoices Filter Bar -->
        <div class="table-controls-bar" style="margin-bottom: 20px;">
          <div class="table-search-box">
            <span class="material-symbols-outlined">search</span>
            <input type="text" id="invoiceSearchInput" placeholder="Search by Invoice No, Booking ID, Guest Name..." oninput="filterInvoicesTable(this.value)">
          </div>
          <select id="invoiceStatusFilter" class="luxury-select" onchange="filterInvoicesByStatus(this.value)">
            <option value="ALL">All Reservation Statuses</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Checked-In">Checked-In</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <div class="table-responsive">
          <table class="luxury-table" id="invoicesTable">
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Booking ID</th>
                <th>Guest Name</th>
                <th>Room Type</th>
                <th>Stay Dates</th>
                <th>Total Bill</th>
                <th>20% Advance</th>
                <th>80% Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="invoicesTableBody">
              <!-- Rendered dynamically via admin.js -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- ======================================================================
           9. STAFF USER GOVERNANCE TAB (SUPER ADMIN ONLY)
           ====================================================================== -->
      <section class="admin-tab-pane" id="tabUsers">
        <div class="page-header-block">
          <div>
            <h1 class="page-title">Staff Accounts & Access Governance</h1>
            <p class="page-subtitle">Manage administrative personnel, roles (Super Admin, Manager, Front Desk), and security credentials.</p>
          </div>
          <div>
            <button class="btn-turquoise" onclick="openAddStaffModal()">
              <span class="material-symbols-outlined">person_add</span> Add Staff Account
            </button>
          </div>
        </div>

        <div class="table-responsive">
          <table class="luxury-table" id="usersTable">
            <thead>
              <tr>
                <th>Username</th>
                <th>Full Name</th>
                <th>Email Address</th>
                <th>Operational Role</th>
                <th>2FA Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="usersTableBody">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </section>
`;

// Insert the new tabs right before </main> or right before the modals
const contentAreaEnd = html.indexOf('</div>\n  </div>\n\n  <!-- ==========================================================================');
if (contentAreaEnd !== -1) {
  html = html.slice(0, contentAreaEnd) + newDedicatedTabs + html.slice(contentAreaEnd);
} else {
  const adminContentEnd = html.indexOf('</div><!-- content area -->') || html.indexOf('</main>');
  if (adminContentEnd !== -1) {
    html = html.slice(0, adminContentEnd) + newDedicatedTabs + html.slice(adminContentEnd);
  }
}

// --- 3. ADD MODALS & 30-SECOND UNDO BANNER ---
const newModalsAndBanners = `
  <!-- ==========================================================================
       3-CLICK "CHANGE PHOTO" MODAL (SIDE-BY-SIDE CURRENT VS NEW + CROP TOOL)
       ========================================================================== -->
  <div class="luxury-modal" id="changePhotoModal" style="display: none;">
    <div class="luxury-modal-content" style="max-width: 900px;">
      <div class="luxury-modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="material-symbols-outlined" style="color: var(--turquoise); font-size: 28px;">photo_camera</span>
          <div>
            <h3 class="luxury-modal-title" id="changePhotoModalTitle">Change Photo</h3>
            <p style="margin: 2px 0 0; font-size: 0.8rem; color: #64748B;" id="changePhotoModalSubtitle">
              Pick a new image, crop to the recommended shape, and save. Goes live immediately.
            </p>
          </div>
        </div>
        <button class="btn-close-modal" onclick="closeChangePhotoModal()">&times;</button>
      </div>

      <div class="luxury-modal-body">
        <!-- Dropzone / Picker -->
        <div class="photo-upload-dropzone" id="photoModalDropzone" onclick="document.getElementById('photoFileInput').click()">
          <span class="material-symbols-outlined" style="font-size: 42px; color: var(--turquoise);">cloud_upload</span>
          <p style="font-size: 1rem; font-weight: 700; color: #073B4C; margin: 8px 0 4px;">
            Drag & drop new photo here, or <span style="color: var(--turquoise); text-decoration: underline;">browse computer</span>
          </p>
          <span style="font-size: 0.78rem; color: #94A3B8;">
            Supports JPG, PNG, and WebP (Max 8 MB). All EXIF and GPS data stripped automatically.
          </span>
          <input type="file" id="photoFileInput" accept="image/jpeg,image/png,image/webp" style="display: none;" onchange="handlePhotoFileSelected(this.files)">
        </div>

        <!-- Side-by-Side Comparison (Current vs New) -->
        <div class="side-by-side-preview-wrapper" id="sideBySideWrapper" style="display: none; margin-top: 20px;">
          <!-- Left: Current Live Photo -->
          <div class="preview-box">
            <div class="preview-box-header">
              <span class="material-symbols-outlined">visibility</span> Current Photo
            </div>
            <div class="preview-image-container">
              <img id="currentPhotoPreviewImg" src="" alt="Current Photo" class="preview-fitted-img">
            </div>
          </div>

          <!-- Right: New Photo with Crop & Zoom Tool -->
          <div class="preview-box">
            <div class="preview-box-header">
              <span class="material-symbols-outlined">crop</span> New Photo (Crop & Zoom)
            </div>
            <div class="preview-image-container" id="cropCanvasContainer">
              <canvas id="photoCropCanvas" width="400" height="300" style="cursor: grab; display: block; max-width: 100%; border-radius: 8px;"></canvas>
            </div>
            
            <!-- Zoom Slider Controls -->
            <div class="crop-controls-row">
              <span class="material-symbols-outlined" style="font-size: 18px; color: #64748B;">zoom_out</span>
              <input type="range" id="cropZoomSlider" min="0.5" max="3.0" step="0.05" value="1.0" oninput="handleCropZoomChange(this.value)" style="flex: 1;">
              <span class="material-symbols-outlined" style="font-size: 18px; color: #64748B;">zoom_in</span>
              <button type="button" class="btn-outline-gold" onclick="resetCropPosition()" style="padding: 4px 10px; font-size: 0.75rem;">Reset</button>
            </div>
          </div>
        </div>

        <!-- Upload Progress & Status -->
        <div id="uploadProgressWrap" style="display: none; margin-top: 16px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 6px; font-weight: 600; color: #073B4C;">
            <span>Processing and re-encoding image...</span>
            <span id="uploadProgressPercent">0%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" id="uploadProgressBar" style="width: 0%;"></div>
          </div>
        </div>

        <div id="changePhotoErrorMsg" class="login-error-banner" style="display: none; margin-top: 14px;"></div>
      </div>

      <div class="luxury-modal-footer">
        <button type="button" class="btn-cancel" onclick="closeChangePhotoModal()">Cancel</button>
        <button type="button" class="btn-turquoise" id="btnSavePhotoChange" onclick="executeSavePhotoChange()" disabled>
          <span class="material-symbols-outlined">check_circle</span> Save & Update Photo
        </button>
      </div>
    </div>
  </div>

  <!-- ==========================================================================
       30-SECOND FLOATING UNDO BANNER
       ========================================================================== -->
  <div class="undo-floating-banner" id="undoFloatingBanner" style="display: none;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <span class="material-symbols-outlined" style="color: var(--champagne-gold); font-size: 24px;">check_circle</span>
      <div>
        <div style="font-weight: 700; font-size: 0.9rem; color: #FFFFFF;" id="undoBannerText">Photo updated. Changes are live on website.</div>
        <div style="font-size: 0.74rem; color: var(--champagne-gold);" id="undoBannerCountdown">Undo available for 30s</div>
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn-undo-action" onclick="executeUndoLastPhotoChange()">
        <span class="material-symbols-outlined" style="font-size: 16px;">undo</span> Undo
      </button>
      <button onclick="dismissUndoBanner()" style="background: none; border: none; color: #94A3B8; cursor: pointer; font-size: 20px;">&times;</button>
    </div>
  </div>

  <!-- ==========================================================================
       5-VERSION HISTORY & RESTORE MODAL
       ========================================================================== -->
  <div class="luxury-modal" id="photoHistoryModal" style="display: none;">
    <div class="luxury-modal-content" style="max-width: 680px;">
      <div class="luxury-modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="material-symbols-outlined" style="color: var(--champagne-gold); font-size: 26px;">history</span>
          <div>
            <h3 class="luxury-modal-title" id="historyModalTitle">Version History (Last 5)</h3>
            <p style="margin: 2px 0 0; font-size: 0.8rem; color: #64748B;">Restore any previous version with 1 click.</p>
          </div>
        </div>
        <button class="btn-close-modal" onclick="closeHistoryModal()">&times;</button>
      </div>
      <div class="luxury-modal-body" id="historyVersionsList">
        <!-- Rendered dynamically -->
      </div>
      <div class="luxury-modal-footer">
        <button type="button" class="btn-cancel" onclick="closeHistoryModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- ==========================================================================
       EDIT PHOTO METADATA MODAL (ALT TEXT & CAPTION)
       ========================================================================== -->
  <div class="luxury-modal" id="editMetadataModal" style="display: none;">
    <div class="luxury-modal-content" style="max-width: 500px;">
      <div class="luxury-modal-header">
        <h3 class="luxury-modal-title">Edit Photo Details</h3>
        <button class="btn-close-modal" onclick="closeEditMetadataModal()">&times;</button>
      </div>
      <div class="luxury-modal-body">
        <div class="login-form-group">
          <label class="login-label">Alt Text (Search Engines & Accessibility)</label>
          <input type="text" id="metaAltInput" class="login-input" placeholder="Descriptive description of the image">
        </div>
        <div class="login-form-group">
          <label class="login-label">Caption (Optional text displayed with photo)</label>
          <input type="text" id="metaCaptionInput" class="login-input" placeholder="Display caption">
        </div>
      </div>
      <div class="luxury-modal-footer">
        <button type="button" class="btn-cancel" onclick="closeEditMetadataModal()">Cancel</button>
        <button type="button" class="btn-turquoise" onclick="executeSaveMetadata()">Save Details</button>
      </div>
    </div>
  </div>

  <!-- ==========================================================================
       DELETE PHOTO CONFIRMATION DIALOG
       ========================================================================== -->
  <div class="luxury-modal" id="deletePhotoConfirmModal" style="display: none;">
    <div class="luxury-modal-content" style="max-width: 480px;">
      <div class="luxury-modal-header">
        <h3 class="luxury-modal-title" style="color: var(--sunset-coral);">Delete Photo Confirmation</h3>
        <button class="btn-close-modal" onclick="closeDeletePhotoModal()">&times;</button>
      </div>
      <div class="luxury-modal-body">
        <div style="background: #FFF0EE; border: 1px solid var(--sunset-coral); border-radius: 10px; padding: 14px; font-size: 0.85rem; color: var(--coral-dark);" id="deletePhotoWarningBox">
          Are you sure you want to delete this photo? If this photo is currently in use, the slot will be reset to the resort's default placeholder image.
        </div>
      </div>
      <div class="luxury-modal-footer">
        <button type="button" class="btn-cancel" onclick="closeDeletePhotoModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="executeConfirmDeletePhoto()">Confirm Delete</button>
      </div>
    </div>
  </div>

  <!-- ==========================================================================
       SENSITIVE ACTION REAUTH MODAL (PASSWORD CONFIRMATION)
       ========================================================================== -->
  <div class="luxury-modal" id="reauthModal" style="display: none;">
    <div class="luxury-modal-content" style="max-width: 460px;">
      <div class="luxury-modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-outlined" style="color: var(--sunset-coral); font-size: 24px;">security</span>
          <h3 class="luxury-modal-title">Security Confirmation</h3>
        </div>
        <button class="btn-close-modal" onclick="closeReauthModal()">&times;</button>
      </div>
      <div class="luxury-modal-body">
        <p style="font-size: 0.86rem; color: #334155; margin-top: 0;" id="reauthPromptText">
          This sensitive action requires password re-entry for security confirmation.
        </p>
        <div class="login-form-group">
          <label class="login-label">Enter Account Password</label>
          <input type="password" id="reauthPasswordInput" class="login-input" placeholder="••••••••••••" autofocus>
        </div>
        <div id="reauthErrorMsg" class="login-error-banner" style="display: none;"></div>
      </div>
      <div class="luxury-modal-footer">
        <button type="button" class="btn-cancel" onclick="closeReauthModal()">Cancel</button>
        <button type="button" class="btn-turquoise" onclick="submitReauthConfirmation()">Confirm Password</button>
      </div>
    </div>
  </div>
`;

// Insert modals before closing </body>
const bodyEnd = html.lastIndexOf('</body>');
if (bodyEnd !== -1) {
  html = html.slice(0, bodyEnd) + newModalsAndBanners + '\n' + html.slice(bodyEnd);
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('admin/index.html patched with redesigned photos grid, dedicated tabs, and security modals.');

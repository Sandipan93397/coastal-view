/**
 * Additional Luxury CSS for Photos & Media Grid, Modals, 2FA, and Mobile Responsiveness
 */
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'admin', 'admin.css');
let css = fs.readFileSync(cssPath, 'utf8');

const additionalStyles = `
/* ==========================================================================
   PHOTO MANAGER SLOTS GRID & CARD STYLING (REQUIREMENT 4)
   ========================================================================== */
.photo-section-filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 6px 0 18px;
  margin-bottom: 12px;
  scrollbar-width: thin;
}

.filter-pill {
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.filter-pill:hover,
.filter-pill.active {
  background: var(--ocean-blue, #073B4C);
  color: #FFFFFF;
  border-color: var(--ocean-blue, #073B4C);
  box-shadow: 0 4px 12px rgba(7, 59, 76, 0.15);
}

.photo-slots-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

.photo-slot-card {
  background: #FFFFFF;
  border-radius: 14px;
  border: 1px solid #E2E8F0;
  overflow: hidden;
  box-shadow: 0 4px 18px rgba(7, 59, 76, 0.05);
  display: flex;
  flex-direction: column;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.photo-slot-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(7, 59, 76, 0.1);
  border-color: #CBD5E1;
}

.slot-image-wrapper {
  position: relative;
  width: 100%;
  height: 200px;
  background: #0F172A;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slot-current-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}

.photo-slot-card:hover .slot-current-img {
  transform: scale(1.03);
}

.slot-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  gap: 6px;
  padding: 20px;
  text-align: center;
}

.slot-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(7, 59, 76, 0.85);
  color: var(--champagne-gold, #E8C77B);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 12px;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(232, 199, 123, 0.3);
}

.slot-card-body {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.slot-title {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #073B4C;
  line-height: 1.3;
}

.slot-rec-size {
  font-size: 0.78rem;
  color: #64748B;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
}

.btn-change-photo {
  width: 100%;
  background: linear-gradient(135deg, #073B4C 0%, #0c4d63 100%);
  color: #FFFFFF;
  border: none;
  border-radius: 10px;
  padding: 12px 18px;
  font-size: 0.92rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 14px rgba(7, 59, 76, 0.18);
}

.btn-change-photo:hover {
  background: linear-gradient(135deg, #06B6B0 0%, #089792 100%);
  box-shadow: 0 6px 18px rgba(6, 182, 176, 0.28);
  transform: translateY(-1px);
}

.slot-actions-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #F1F5F9;
}

.btn-slot-option {
  flex: 1;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.15s ease;
}

.btn-slot-option:hover {
  background: #EDF2F7;
  color: #073B4C;
}

.btn-slot-option.danger:hover {
  background: #FEF2F2;
  color: #DC2626;
  border-color: #FECACA;
}

/* ==========================================================================
   SIDE-BY-SIDE PREVIEW & CROP TOOL
   ========================================================================== */
.photo-upload-dropzone {
  border: 2px dashed #CBD5E1;
  border-radius: 14px;
  padding: 32px 20px;
  text-align: center;
  background: #F8FAFC;
  cursor: pointer;
  transition: all 0.2s ease;
}

.photo-upload-dropzone:hover,
.photo-upload-dropzone.drag-over {
  border-color: var(--turquoise, #06B6B0);
  background: #F0FDFA;
}

.side-by-side-preview-wrapper {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

@media (max-width: 768px) {
  .side-by-side-preview-wrapper {
    grid-template-columns: 1fr;
  }
}

.preview-box {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.preview-box-header {
  font-size: 0.82rem;
  font-weight: 700;
  color: #073B4C;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.preview-image-container {
  width: 100%;
  height: 240px;
  background: #0F172A;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-fitted-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.crop-controls-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

/* ==========================================================================
   30-SECOND FLOATING UNDO BANNER
   ========================================================================== */
.undo-floating-banner {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 99999;
  background: #073B4C;
  border: 1.5px solid var(--champagne-gold, #E8C77B);
  border-radius: 14px;
  padding: 16px 20px;
  box-shadow: 0 12px 36px rgba(7, 59, 76, 0.35);
  display: flex;
  align-items: center;
  gap: 18px;
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.btn-undo-action {
  background: var(--champagne-gold, #E8C77B);
  color: #073B4C;
  font-weight: 800;
  font-size: 0.85rem;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 2px 8px rgba(232, 199, 123, 0.3);
}

.btn-undo-action:hover {
  background: #F4D38E;
}

/* Countdown Pill in 2FA screen */
.countdown-pill {
  display: inline-block;
  background: #FAF6EE;
  border: 1px solid #E8C77B;
  color: #073B4C;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 14px;
  margin-bottom: 14px;
  text-align: center;
}

.remember-device-row {
  margin: 12px 0 16px;
  font-size: 0.82rem;
  color: #334155;
}

/* ==========================================================================
   MOBILE RESPONSIVENESS: TABLES BECOME CARDS ON SMALL SCREENS (REQUIREMENT 5)
   ========================================================================== */
@media (max-width: 768px) {
  .luxury-table thead {
    display: none;
  }

  .luxury-table,
  .luxury-table tbody,
  .luxury-table tr,
  .luxury-table td {
    display: block;
    width: 100%;
  }

  .luxury-table tr {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 2px 8px rgba(7, 59, 76, 0.04);
  }

  .luxury-table td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px dashed #F1F5F9;
    font-size: 0.88rem;
    text-align: right;
  }

  .luxury-table td:last-child {
    border-bottom: none;
    padding-top: 12px;
    justify-content: flex-end;
  }

  .luxury-table td::before {
    content: attr(data-label);
    font-weight: 700;
    color: #64748B;
    font-size: 0.78rem;
    text-transform: uppercase;
    text-align: left;
  }
}
`;

fs.writeFileSync(cssPath, css + '\n' + additionalStyles, 'utf8');
console.log('admin.css successfully enhanced with photo slots, preview modals, undo banner, and mobile table cards.');

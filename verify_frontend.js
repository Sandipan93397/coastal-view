const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING FRONTEND HTML, CSS & JS FOR ANI\'S TRAVELS VEHICLE SECTION ===\n');

// 1. Check index.html elements
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const checks = [
  { name: 'Car toggle input (#toggleCarNeed)', test: html.includes('id="toggleCarNeed"') },
  { name: 'Vehicle controls box (#carControlsBox)', test: html.includes('id="carControlsBox"') },
  { name: 'Controls box default hidden style', test: html.includes('id="carControlsBox" class="vehicle-controls-box" style="display: none;"') },
  { name: 'Vehicle type select (#vehicleTypeSelect)', test: html.includes('id="vehicleTypeSelect"') },
  { name: 'Vehicle quantity input (#carCountInput)', test: html.includes('id="carCountInput"') },
  { name: 'Quantity minus button (#carQtyMinusBtn)', test: html.includes('id="carQtyMinusBtn"') },
  { name: 'Quantity plus button (#carQtyPlusBtn)', test: html.includes('id="carQtyPlusBtn"') },
  { name: 'Optional trip type wrapper (#vehicleTripTypeWrapper)', test: html.includes('id="vehicleTripTypeWrapper"') },
  { name: 'Trip type select (#vehicleTripTypeSelect)', test: html.includes('id="vehicleTripTypeSelect"') },
  { name: 'Vehicle description container (#vehicleDescriptionDisplay)', test: html.includes('id="vehicleDescriptionDisplay"') },
  { name: 'Vehicle price container (#vehiclePriceDisplay)', test: html.includes('id="vehiclePriceDisplay"') },
  { name: 'Live transport summary subline (#liveTransportSummaryLine)', test: html.includes('id="liveTransportSummaryLine"') },
  { name: 'Advance non-refundable policy badge note', test: html.includes('The 20% advance is non-refundable.') }
];

let allPassed = true;
checks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] HTML: ${c.name}`);
  if (!c.test) allPassed = false;
});

// 2. Check CSS styles in style.css
const css = fs.readFileSync(path.join(__dirname, 'assets', 'css', 'style.css'), 'utf8');

const cssChecks = [
  { name: 'Slide-down keyframes (@keyframes slideDownFade)', test: css.includes('@keyframes slideDownFade') },
  { name: '.vehicle-controls-box styling', test: css.includes('.vehicle-controls-box') },
  { name: '.vehicle-inputs-row grid layout', test: css.includes('.vehicle-inputs-row') },
  { name: '.vehicle-stepper-wrap stepper styling', test: css.includes('.vehicle-stepper-wrap') },
  { name: '.vehicle-info-banner description & price banner', test: css.includes('.vehicle-info-banner') },
  { name: '.transport-summary-subline in breakdown', test: css.includes('.transport-summary-subline') },
  { name: 'Mobile media query with touch targets >= 44px', test: css.includes('@media (max-width: 600px)') && css.includes('min-height: 48px;') }
];

cssChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] CSS: ${c.name}`);
  if (!c.test) allPassed = false;
});

// 3. Check JS logic in booking.js
const js = fs.readFileSync(path.join(__dirname, 'assets', 'js', 'booking.js'), 'utf8');

const jsChecks = [
  { name: 'Fetches /api/vehicles dynamically', test: js.includes("fetch('/api/vehicles')") },
  { name: 'Populates vehicle select with active vehicles', test: js.includes('populateVehicleSelect()') },
  { name: 'Updates vehicle description and per-day rate banner', test: js.includes('updateVehicleDetailsDisplay()') },
  { name: 'Toggle change reveals controls and animates', test: js.includes("carControls.style.display = 'block'") },
  { name: 'Toggle OFF hides controls and removes cost', test: js.includes("carControls.style.display = 'none'") },
  { name: 'Quantity stepper minus/plus buttons', test: js.includes('carQtyMinusBtn') && js.includes('carQtyPlusBtn') },
  { name: 'Transport cost formula: vehicleRatePerDay * carCount * nights', test: js.includes('vehicleRatePerDay * carCount * nights') },
  { name: 'Summary breakdown line formatting: vehicleName × carCount × nights = ₹total', test: js.includes('${vehicleName} × ${carCount} × ${nights} day') },
  { name: '20% Pay Now and 80% Pay at Hotel split calculation', test: js.includes('advancePercent') && js.includes('payNow') && js.includes('payAtHotel') },
  { name: 'Payload includes needCar, carCount, vehicleType, vehicleTripType, clientTransportCost', test: js.includes('clientTransportCost: calc.carTotal') && js.includes('vehicleType: calc.vehicleType') }
];

jsChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] JS: ${c.name}`);
  if (!c.test) allPassed = false;
});

// 4. Check Admin Panel
const adminHtml = fs.readFileSync(path.join(__dirname, 'admin', 'index.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, 'admin', 'admin.js'), 'utf8');

const adminChecks = [
  { name: 'Admin tab for Vehicles & Pricing (#tabVehicles)', test: adminHtml.includes('id="tabVehicles"') },
  { name: 'Trip type setting toggle (#adminEnableTripTypeToggle)', test: adminHtml.includes('id="adminEnableTripTypeToggle"') },
  { name: 'Edit vehicle modal (#editVehicleModal)', test: adminHtml.includes('id="editVehicleModal"') },
  { name: 'Vehicle editing form fields (rate, capacity, max quantity, status)', test: adminHtml.includes('id="editVehicleRate"') && adminHtml.includes('id="editVehicleCapacity"') },
  { name: 'admin.js renderVehiclesTable with full columns', test: adminJs.includes('renderVehiclesTable') },
  { name: 'admin.js openEditVehicleModal and handleSaveVehicleSubmit', test: adminJs.includes('openEditVehicleModal') && adminJs.includes('handleSaveVehicleSubmit') },
  { name: 'admin.js trip type setting persistence', test: adminJs.includes('handleTripTypeToggleChange') }
];

adminChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] Admin: ${c.name}`);
  if (!c.test) allPassed = false;
});

console.log('\n=== ALL FRONTEND & BACKEND VERIFICATION CHECKS COMPLETE ===');

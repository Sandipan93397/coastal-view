// Coastal View - Live Booking Calculation Engine & Reservation Flow

let hotelSettings = {
  advancePercentage: 20,
  balancePercentage: 80,
  carRentalPricePerDay: 2500,
  candlelightDinnerBeachside: 3500,
  candlelightDinnerPoolside: 2800,
  candlelightPricingMode: "per_dinner",
  breakfastPrice: 200,
  breakfastUnit: "per_person_per_day",
  breakfastServingTime: "7:00 AM to 10:30 AM",
  breakfastEnabled: true,
  breakfastAddon: {
    enabled: true,
    name: "Breakfast Add-On",
    price: 200,
    unit: "per_person_per_day",
    servingTime: "7:00 AM to 10:30 AM",
    note: "Served 7:00 AM to 10:30 AM."
  },
  enableTax: false,
  taxPercentage: 12,
  advancePolicyNote: "The 20% advance is non-refundable."
};

let hotelRooms = [];
let hotelVehicles = [];
let vehicleSettings = { enableTripType: true };
let currentAvailabilityMap = {};

document.addEventListener('DOMContentLoaded', async () => {
  setupBookingDates();
  await loadInitialBookingData();
  setupBookingEventListeners();
  await fetchAndApplyAvailability();
  calculateLivePrice();

  // Auto-apply prefill parameters from URL if present (e.g. from concierge links)
  try {
    const searchStr = window.location.search || (window.location.hash.includes('?') ? window.location.hash.slice(window.location.hash.indexOf('?')) : '');
    if (searchStr) {
      const urlParams = Object.fromEntries(new URLSearchParams(searchStr).entries());
      window.prefillBookingForm(urlParams);
    }
  } catch (err) {
    console.warn('URL prefill error:', err);
  }
});

// Global prefill helper accessible by Chatbot links
window.prefillBookingForm = function(params = {}) {
  if (typeof params === 'string') {
    try {
      const u = new URL(params, window.location.origin);
      params = Object.fromEntries(u.searchParams.entries());
    } catch(e) {}
  }

  const { room, checkIn, checkOut, rooms, guests, vehicle, carCount, candlelight } = params;

  if (room) {
    const roomSelect = document.getElementById('bookRoomSelect');
    if (roomSelect) {
      for (const opt of roomSelect.options) {
        if (opt.value === room || opt.text.toLowerCase().includes(room.toLowerCase())) {
          roomSelect.value = opt.value;
          break;
        }
      }
      updateRoomsCountDropdown();
    }
  }

  if (checkIn) {
    const inEl = document.getElementById('bookCheckIn');
    if (inEl) inEl.value = checkIn;
  }
  if (checkOut) {
    const outEl = document.getElementById('bookCheckOut');
    if (outEl) outEl.value = checkOut;
  }
  if (rooms) {
    const roomsEl = document.getElementById('bookRoomsCount');
    if (roomsEl) roomsEl.value = String(rooms);
  }
  if (guests) {
    const adultsEl = document.getElementById('bookAdults');
    if (adultsEl) adultsEl.value = String(guests);
  }

  if (vehicle) {
    const carToggle = document.getElementById('toggleCarNeed');
    const carControls = document.getElementById('carControlsBox');
    const carCard = document.getElementById('carAddonCard');
    if (carToggle) {
      carToggle.checked = true;
      if (carControls) carControls.style.display = 'block';
      if (carCard) carCard.classList.add('active');
    }
    const vSelect = document.getElementById('vehicleTypeSelect');
    if (vSelect) {
      for (const opt of vSelect.options) {
        if (opt.value === vehicle.toLowerCase() || opt.text.toLowerCase().includes(vehicle.toLowerCase())) {
          vSelect.value = opt.value;
          break;
        }
      }
      updateVehicleDetailsDisplay();
    }
    if (carCount) {
      const qEl = document.getElementById('carCountInput');
      if (qEl) qEl.value = String(carCount);
    }
  }

  if (candlelight) {
    const cToggle = document.getElementById('toggleCandlelight');
    const cControls = document.getElementById('candleControlsBox');
    const cCard = document.getElementById('candlelightAddonCard');
    if (cToggle) {
      cToggle.checked = true;
      if (cControls) cControls.style.display = 'block';
      if (cCard) cCard.classList.add('active');
    }
    const setupSelect = document.getElementById('dinnerSetupSelect');
    if (setupSelect) {
      if (candlelight.toLowerCase().includes('beach')) setupSelect.value = 'Beachside';
      else if (candlelight.toLowerCase().includes('pool')) setupSelect.value = 'Poolside';
    }
  }

  calculateLivePrice();

  const sec = document.getElementById('bookingSection');
  if (sec) sec.scrollIntoView({ behavior: 'smooth' });
};

function renderRoomLoadError(show) {
  let errBox = document.getElementById('roomLoadErrorBox');
  if (!errBox) {
    const sel = document.getElementById('bookRoomSelect');
    if (sel && sel.parentElement) {
      errBox = document.createElement('div');
      errBox.id = 'roomLoadErrorBox';
      errBox.className = 'room-load-error-box';
      errBox.style.cssText = 'color: #EF4444; font-size: 0.8rem; margin-top: 6px; display: none; align-items: center; gap: 8px;';
      errBox.innerHTML = '<span class="material-symbols-outlined" style="font-size: 16px;">error</span> Failed to load suites. <button type="button" class="btn btn-sm btn-outline-gold" style="padding: 2px 8px; font-size: 0.75rem;" onclick="window.loadInitialBookingData()">Retry</button>';
      sel.parentElement.appendChild(errBox);
    }
  }
  if (errBox) {
    errBox.style.display = show ? 'inline-flex' : 'none';
  }
}

// Load real settings, rooms, and vehicles from API
async function loadInitialBookingData() {
  try {
    const [settingsRes, roomsRes, vehiclesRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()).catch(() => ({ success: false })),
      fetch('/api/rooms').then(r => r.json()).catch(() => ({ success: false })),
      fetch('/api/vehicles').then(r => r.json()).catch(() => ({ success: false }))
    ]);

    if (settingsRes.success && settingsRes.settings) {
      hotelSettings = { ...hotelSettings, ...settingsRes.settings };
      updateDinnerSelectLabels();
      updateBreakfastAddonDisplay();
      updateCapacityPolicyNotes();
    }
    if (roomsRes.success && Array.isArray(roomsRes.rooms) && roomsRes.rooms.length > 0) {
      hotelRooms = roomsRes.rooms;
      window.hotelRooms = hotelRooms;
      renderRoomLoadError(false);
      populateRoomSelect();
      updateRoomCardsStatus();
      updateGuestDropdownLimits();
    } else {
      renderRoomLoadError(true);
    }
    if (vehiclesRes.success && vehiclesRes.vehicles) {
      hotelVehicles = vehiclesRes.vehicles;
      if (vehiclesRes.vehicleSettings) {
        vehicleSettings = vehiclesRes.vehicleSettings;
      }
      populateVehicleSelect();
    }
  } catch (err) {
    console.warn('Using local fallback data if server is loading:', err);
    renderRoomLoadError(true);
  }
}
window.loadInitialBookingData = loadInitialBookingData;

// Populate the vehicle select dropdown with dynamic enabled vehicles from the admin panel / DB

let bookingVehicleLines = [];

function initVehicleLines() {
  if (bookingVehicleLines.length === 0) {
    const activeVehicles = (hotelVehicles || []).filter(v => v.enabled);
    let chosenVehicle = activeVehicles.find(v => getAvailableServicesForVehicle(v.id).some(s => s.hasPrice)) || activeVehicles[0];
    let chosenVehicleId = chosenVehicle ? chosenVehicle.id : 'car';
    let availableSvcs = getAvailableServicesForVehicle(chosenVehicleId);
    let chosenSvc = availableSvcs.find(s => s.hasPrice)?.key || (availableSvcs.length > 0 ? availableSvcs[0].key : 'tour');
    bookingVehicleLines.push({
      id: 'vl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      vehicleId: chosenVehicleId,
      serviceType: chosenSvc,
      quantity: 1,
      days: 1,
      pickupPoint: '',
      pickupTime: '',
      dropPoint: '',
      dropTime: '',
      tourNotes: ''
    });
  }
}

function getAvailableServicesForVehicle(vId) {
  const v = (hotelVehicles || []).find(item => item.id === vId);
  const defs = [
    { key: 'pickup', label: 'Pickup', isTour: false },
    { key: 'drop', label: 'Drop', isTour: false },
    { key: 'pickup_drop', label: 'Pickup + Drop', isTour: false },
    { key: 'tour', label: 'Tour (per day)', isTour: true }
  ];
  if (!v || !v.services) {
    return defs.map(d => ({ key: d.key, label: d.label, price: null, isTour: d.isTour, hasPrice: false }));
  }
  return defs.map(d => {
    const s = v.services[d.key];
    const hasPrice = s && s.enabled !== false && s.price != null && Number(s.price) > 0;
    return {
      key: d.key,
      label: d.label,
      price: hasPrice ? Number(s.price) : null,
      isTour: d.isTour,
      hasPrice
    };
  });
}

function syncVehicleTextInDom() {
  const car = (hotelVehicles || []).find(v => v.id === 'car');
  const carTourPrice = car?.services?.tour?.enabled && car?.services?.tour?.price
    ? ('₹' + Number(car.services.tour.price).toLocaleString('en-IN') + '/day')
    : 'Ask us';
  document.querySelectorAll('.dyn-car-tour-price').forEach(el => {
    el.textContent = carTourPrice;
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calculateNights(checkInVal, checkOutVal) {
  if (!checkInVal || !checkOutVal) return 1;
  const inDate = new Date(checkInVal);
  const outDate = new Date(checkOutVal);
  if (isNaN(inDate.getTime()) || isNaN(outDate.getTime()) || outDate <= inDate) return 1;
  return Math.max(1, Math.round((outDate - inDate) / (1000 * 60 * 60 * 24)));
}

function renderVehicleLines() {
  const container = document.getElementById('vehicleLinesContainer');
  if (!container) return;

  initVehicleLines();
  const activeVehicles = (hotelVehicles || []).filter(v => v.enabled);
  const checkIn = document.getElementById('bookCheckIn')?.value;
  const checkOut = document.getElementById('bookCheckOut')?.value;
  const nights = calculateNights(checkIn, checkOut);

  container.innerHTML = bookingVehicleLines.map((line, idx) => {
    const currentV = activeVehicles.find(v => v.id === line.vehicleId) || activeVehicles[0];
    const availableSvcs = currentV ? getAvailableServicesForVehicle(currentV.id) : [];
    
    if (availableSvcs.length > 0 && !availableSvcs.some(s => s.key === line.serviceType)) {
      line.serviceType = availableSvcs[0].key;
    }
    const currentSvc = availableSvcs.find(s => s.key === line.serviceType);
    const unitPrice = currentSvc ? currentSvc.price : 0;
    const isTour = line.serviceType === 'tour';
    const days = Math.max(1, line.days || nights || 1);
    const lineTotal = isTour ? (unitPrice * line.quantity * days) : (unitPrice * line.quantity);

    const routes = (vehicleSettings && vehicleSettings.enableRoutePricing && vehicleSettings.routes) 
      ? vehicleSettings.routes.filter(r => r.enabled) 
      : [];
    const routeOptionsHtml = routes.map(r => '<option value="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</option>').join('') + '<option value="Other">Other (ask us)</option>';

    return '<div class="vehicle-line-card" data-line-index="' + idx + '">' +
      '<div class="vehicle-line-header">' +
        '<div class="vehicle-line-title">' +
          '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--turquoise);">directions_car</span> ' +
          'Vehicle Service #' + (idx + 1) +
        '</div>' +
        (bookingVehicleLines.length > 1 ? '<button type="button" class="btn-remove-line" onclick="removeVehicleLine(' + idx + ')" title="Remove vehicle line"><span class="material-symbols-outlined" style="font-size: 16px;">delete</span> Remove</button>' : '') +
      '</div>' +
      '<div class="vehicle-selectors-grid">' +
        '<div>' +
          '<label class="vehicle-sublabel">Vehicle Type (Capacity)</label>' +
          '<select class="booking-input vehicle-line-type-select" onchange="changeVehicleLineType(' + idx + ', this.value)">' +
            activeVehicles.map(v => '<option value="' + v.id + '" ' + (v.id === line.vehicleId ? 'selected' : '') + '>' + v.name + ' (Up to ' + (v.capacity || 4) + ' passengers)</option>').join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label class="vehicle-sublabel">Service Type</label>' +
          '<select class="booking-input vehicle-line-svc-select" onchange="changeVehicleLineService(' + idx + ', this.value)">' +
            (availableSvcs.length > 0 ? availableSvcs.map(s => '<option value="' + s.key + '" ' + (s.key === line.serviceType ? 'selected' : '') + '>' + s.label + (s.hasPrice ? (' (₹' + s.price.toLocaleString('en-IN') + (s.isTour ? '/day' : '') + ')') : ' (Ask us)') + '</option>').join('') : '<option value="">No services available (Ask us)</option>') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label class="vehicle-sublabel">Quantity</label>' +
          '<div class="vehicle-stepper-wrap">' +
            '<button type="button" class="vehicle-stepper-btn" onclick="stepVehicleLineQty(' + idx + ', -1)">−</button>' +
            '<input type="number" class="booking-input vehicle-qty-input" value="' + (line.quantity || 1) + '" readonly>' +
            '<button type="button" class="vehicle-stepper-btn" onclick="stepVehicleLineQty(' + idx + ', 1)">+</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="vehicle-extra-fields">' +
        ((line.serviceType === 'pickup' || line.serviceType === 'pickup_drop') ? 
          '<div class="field-item"><label class="vehicle-sublabel">Pickup Point</label>' +
          (routes.length > 0 ? '<select class="booking-input" onchange="updateVehicleLineField(' + idx + ', \'pickupPoint\', this.value)"><option value="">Select Station / Area</option>' + routeOptionsHtml + '</select>' : '<input type="text" class="booking-input" placeholder="Station, Bus Stand or Address" value="' + escapeHtml(line.pickupPoint || '') + '" oninput="updateVehicleLineField(' + idx + ', \'pickupPoint\', this.value)">') +
          '</div><div class="field-item"><label class="vehicle-sublabel">Pickup Time</label><input type="time" class="booking-input" value="' + escapeHtml(line.pickupTime || '') + '" onchange="updateVehicleLineField(' + idx + ', \'pickupTime\', this.value)"></div>' : '') +
        ((line.serviceType === 'drop' || line.serviceType === 'pickup_drop') ? 
          '<div class="field-item"><label class="vehicle-sublabel">Drop Point</label>' +
          (routes.length > 0 ? '<select class="booking-input" onchange="updateVehicleLineField(' + idx + ', \'dropPoint\', this.value)"><option value="">Select Destination</option>' + routeOptionsHtml + '</select>' : '<input type="text" class="booking-input" placeholder="Station, Airport or City" value="' + escapeHtml(line.dropPoint || '') + '" oninput="updateVehicleLineField(' + idx + ', \'dropPoint\', this.value)">') +
          '</div><div class="field-item"><label class="vehicle-sublabel">Drop Time</label><input type="time" class="booking-input" value="' + escapeHtml(line.dropTime || '') + '" onchange="updateVehicleLineField(' + idx + ', \'dropTime\', this.value)"></div>' : '') +
        (line.serviceType === 'tour' ? 
          '<div class="field-item" style="flex: 0 0 160px;"><label class="vehicle-sublabel">Tour Days</label><div class="vehicle-stepper-wrap"><button type="button" class="vehicle-stepper-btn" onclick="stepVehicleLineDays(' + idx + ', -1)">−</button><input type="number" class="booking-input vehicle-qty-input" value="' + days + '" readonly><button type="button" class="vehicle-stepper-btn" onclick="stepVehicleLineDays(' + idx + ', 1)">+</button></div></div><div class="field-item" style="flex: 1; min-width: 200px;"><label class="vehicle-sublabel">Sightseeing Notes (Optional)</label><input type="text" class="booking-input" placeholder="e.g. Tajpur, Digha, Udaipur beach" value="' + escapeHtml(line.tourNotes || '') + '" oninput="updateVehicleLineField(' + idx + ', \'tourNotes\', this.value)"></div>' : '') +
      '</div>' +
      '<div class="vehicle-line-price-strip">' +
        (unitPrice > 0 ? 
          ('<span class="rate-formula">' + (isTour ? ('Rate: ₹' + unitPrice.toLocaleString('en-IN') + '/day × ' + line.quantity + ' vehicle' + (line.quantity > 1 ? 's' : '') + ' × ' + days + ' day' + (days > 1 ? 's' : '')) : ('Rate: ₹' + unitPrice.toLocaleString('en-IN') + ' × ' + line.quantity + ' vehicle' + (line.quantity > 1 ? 's' : ''))) + '</span><span class="rate-line-total">= ₹' + lineTotal.toLocaleString('en-IN') + '</span>') :
          ('<span class="rate-formula" style="color: #94A3B8;">Price on request</span><span class="rate-line-total" style="color: var(--champagne-gold); font-weight: 600;">Ask us</span>')) +
      '</div>' +
    '</div>';
  }).join('');
}

function changeVehicleLineType(idx, vehicleId) {
  if (!bookingVehicleLines[idx]) return;
  bookingVehicleLines[idx].vehicleId = vehicleId;
  const svcs = getAvailableServicesForVehicle(vehicleId);
  bookingVehicleLines[idx].serviceType = svcs.length > 0 ? svcs[0].key : 'tour';
  renderVehicleLines();
  calculateLivePrice();
}

function changeVehicleLineService(idx, serviceType) {
  if (!bookingVehicleLines[idx]) return;
  bookingVehicleLines[idx].serviceType = serviceType;
  renderVehicleLines();
  calculateLivePrice();
}

function stepVehicleLineQty(idx, delta) {
  if (!bookingVehicleLines[idx]) return;
  const current = parseInt(bookingVehicleLines[idx].quantity, 10) || 1;
  const vObj = (hotelVehicles || []).find(v => v.id === bookingVehicleLines[idx].vehicleId);
  const maxQ = vObj?.maxQuantity || 5;
  const next = Math.max(1, Math.min(maxQ, current + delta));
  bookingVehicleLines[idx].quantity = next;
  renderVehicleLines();
  calculateLivePrice();
}

function stepVehicleLineDays(idx, delta) {
  if (!bookingVehicleLines[idx]) return;
  const current = parseInt(bookingVehicleLines[idx].days, 10) || 1;
  const next = Math.max(1, Math.min(30, current + delta));
  bookingVehicleLines[idx].days = next;
  renderVehicleLines();
  calculateLivePrice();
}

function updateVehicleLineField(idx, field, val) {
  if (!bookingVehicleLines[idx]) return;
  bookingVehicleLines[idx][field] = val;
}

function addVehicleLine() {
  const activeVehicles = (hotelVehicles || []).filter(v => v.enabled);
  let chosenVehicle = activeVehicles.find(v => getAvailableServicesForVehicle(v.id).length > 0) || activeVehicles[0];
  let chosenVehicleId = chosenVehicle ? chosenVehicle.id : 'car';
  let availableSvcs = getAvailableServicesForVehicle(chosenVehicleId);
  let chosenSvc = availableSvcs.length > 0 ? availableSvcs[0].key : 'tour';
  const checkIn = document.getElementById('bookCheckIn')?.value;
  const checkOut = document.getElementById('bookCheckOut')?.value;
  const nights = calculateNights(checkIn, checkOut);

  bookingVehicleLines.push({
    id: 'vl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    vehicleId: chosenVehicleId,
    serviceType: chosenSvc,
    quantity: 1,
    days: nights,
    pickupPoint: '',
    pickupTime: '',
    dropPoint: '',
    dropTime: '',
    tourNotes: ''
  });
  renderVehicleLines();
  calculateLivePrice();
}

function removeVehicleLine(idx) {
  if (bookingVehicleLines.length <= 1) return;
  bookingVehicleLines.splice(idx, 1);
  renderVehicleLines();
  calculateLivePrice();
}

window.changeVehicleLineType = changeVehicleLineType;
window.changeVehicleLineService = changeVehicleLineService;
window.stepVehicleLineQty = stepVehicleLineQty;
window.stepVehicleLineDays = stepVehicleLineDays;
window.updateVehicleLineField = updateVehicleLineField;
window.addVehicleLine = addVehicleLine;
window.removeVehicleLine = removeVehicleLine;

function populateVehicleSelect() {
  initVehicleLines();
  renderVehicleLines();
  syncVehicleTextInDom();
}

// Update vehicle description and per-day rate banner under the dropdown
function updateVehicleDetailsDisplay() {
  const select = document.getElementById('vehicleTypeSelect');
  const descEl = document.getElementById('vehicleDescriptionDisplay');
  const priceEl = document.getElementById('vehiclePriceDisplay');
  if (!select || !descEl || !priceEl) return;

  const selectedOpt = select.options[select.selectedIndex];
  if (!selectedOpt) return;

  const vehicleId = selectedOpt.value;
  const vehicleObj = hotelVehicles.find(v => v.id === vehicleId);

  const name = vehicleObj ? vehicleObj.name : selectedOpt.text.split('(')[0].trim();
  const desc = vehicleObj ? vehicleObj.description : selectedOpt.getAttribute('data-desc');
  const capacity = vehicleObj ? vehicleObj.capacity : selectedOpt.getAttribute('data-capacity');
  const price = vehicleObj ? vehicleObj.pricePerDay : parseFloat(selectedOpt.getAttribute('data-price')) || 2500;
  const maxQ = vehicleObj ? (vehicleObj.maxQuantity || 5) : (parseInt(selectedOpt.getAttribute('data-max'), 10) || 5);

  descEl.innerHTML = `<strong>${name}:</strong> ${desc} <span style="color:#A5D8D5;">(Up to ${capacity} passengers)</span>`;
  priceEl.textContent = `₹${price.toLocaleString('en-IN')} / day`;

  // Adjust input max
  const qtyInput = document.getElementById('carCountInput');
  if (qtyInput) {
    qtyInput.max = maxQ;
    if (parseInt(qtyInput.value, 10) > maxQ) {
      qtyInput.value = maxQ;
    }
  }
}

// Dynamically sync candlelight dinner prices from admin panel/DB to dropdown options

// Update breakfast addon banner, title, subtitle, unit label and visibility from settings
function updateBreakfastAddonDisplay() {
  const card = document.getElementById('breakfastAddonCard');
  if (!card) return;

  const isEnabled = hotelSettings.breakfastEnabled !== false && (!hotelSettings.breakfastAddon || hotelSettings.breakfastAddon.enabled !== false);
  if (!isEnabled) {
    card.style.display = 'none';
    const toggle = document.getElementById('toggleBreakfast');
    if (toggle) toggle.checked = false;
    const ctrl = document.getElementById('breakfastControlsBox');
    if (ctrl) ctrl.style.display = 'none';
    card.classList.remove('active');
    calculateLivePrice();
    return;
  } else {
    card.style.display = 'flex';
  }

  const price = Number(hotelSettings.breakfastPrice !== undefined ? hotelSettings.breakfastPrice : (hotelSettings.breakfastAddon?.price || 200));
  const unit = hotelSettings.breakfastUnit || hotelSettings.breakfastAddon?.unit || 'per_person_per_day';
  const serving = hotelSettings.breakfastServingTime || hotelSettings.breakfastAddon?.servingTime || '7:00 AM to 10:30 AM';

  const titleEl = document.getElementById('bfAddonTitle');
  const subEl = document.getElementById('bfAddonSubtitle');
  const labelEl = document.getElementById('bfSelectorLabel');
  const rateEl = document.getElementById('bfRateDisplay');
  const qtyInput = document.getElementById('breakfastGuestsInput');

  if (titleEl) titleEl.textContent = `Add Breakfast (₹${price})`;
  if (subEl) subEl.textContent = `Served ${serving}.`;

  if (unit === 'per_room_per_day') {
    if (labelEl) labelEl.textContent = 'Rooms:';
    if (rateEl) rateEl.textContent = `₹${price} per room / day`;
    const rooms = parseInt(document.getElementById('bookRoomsCount')?.value, 10) || 1;
    if (qtyInput) qtyInput.value = rooms;
  } else {
    if (labelEl) labelEl.textContent = 'Guests:';
    if (rateEl) rateEl.textContent = `₹${price} per person / day`;
    const adults = parseInt(document.getElementById('bookAdults')?.value, 10) || 2;
    const children = parseInt(document.getElementById('bookChildren')?.value, 10) || 0;
    if (qtyInput && (!qtyInput.dataset.userEdited || parseInt(qtyInput.value, 10) < 1)) {
      qtyInput.value = Math.max(1, adults + children);
    }
  }
}

function updateDinnerSelectLabels() {
  const select = document.getElementById('dinnerSetupSelect');
  if (!select) return;

  const beachPrice = hotelSettings.candlelightDinnerBeachside || 3500;
  const poolPrice = hotelSettings.candlelightDinnerPoolside || 2800;

  Array.from(select.options).forEach(opt => {
    if (opt.value === 'Beachside') {
      opt.textContent = `Beachside Canopy (₹${beachPrice.toLocaleString('en-IN')})`;
    } else if (opt.value === 'Poolside') {
      opt.textContent = `Poolside Romance (₹${poolPrice.toLocaleString('en-IN')})`;
    }
  });
}

// Populate the room select dropdown with all room types from database
function populateRoomSelect() {
  const select = document.getElementById('bookRoomSelect');
  if (!select) return;

  const prevSelected = select.value;
  select.innerHTML = '';

  const activeRooms = (hotelRooms || []).filter(r => !r.isArchived);

  if (activeRooms.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'Suites unavailable (please retry)';
    select.appendChild(opt);
    renderRoomLoadError(true);
    return;
  }

  renderRoomLoadError(false);
  let firstAvailableId = null;

  activeRooms.forEach(room => {
    const avail = currentAvailabilityMap[room.id];
    const isSold = room.isSoldOut || (avail && (avail.available <= 0 || avail.isSoldOut));
    const opt = document.createElement('option');
    opt.value = room.id;
    opt.setAttribute('data-price', (room.price !== null && room.price !== undefined) ? room.price : '');
    opt.setAttribute('data-soldout', isSold ? 'true' : 'false');

    const priceFormatted = (room.price !== null && room.price !== undefined && !isNaN(room.price))
      ? `₹${Number(room.price).toLocaleString('en-IN')}/night`
      : 'Ask at hotel';

    if (isSold) {
      opt.disabled = true;
      opt.textContent = `${room.name} — ${priceFormatted} (Sold out)`;
    } else {
      opt.disabled = false;
      opt.textContent = `${room.name} — ${priceFormatted}`;
      if (!firstAvailableId) {
        firstAvailableId = room.id;
      }
    }
    select.appendChild(opt);
  });

  // Preserve selected value if still available and not sold out, else choose first available
  const prevOpt = prevSelected ? select.querySelector(`option[value="${prevSelected}"]`) : null;
  if (prevOpt && !prevOpt.disabled) {
    select.value = prevSelected;
  } else if (firstAvailableId) {
    select.value = firstAvailableId;
  } else if (activeRooms[0]) {
    select.value = activeRooms[0].id;
  }

  syncToMobileRoomOptions(select.value);
}

function syncToMobileRoomOptions(selectedId) {
  const mOptions = document.querySelectorAll('.m-room-option');
  mOptions.forEach(opt => {
    const rId = opt.getAttribute('data-room-id');
    const avail = currentAvailabilityMap[rId];
    const rObj = (hotelRooms || []).find(r => r.id === rId);
    const isSold = (rObj && rObj.isSoldOut) || (avail && (avail.available <= 0 || avail.isSoldOut));
    const radio = opt.querySelector('.m-room-radio');

    if (isSold) {
      opt.classList.add('is-sold-out');
      if (radio) radio.disabled = true;
      let badge = opt.querySelector('.m-room-sold-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'm-room-sold-badge';
        badge.style.cssText = 'background: #EF4444; color: #fff; font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;';
        badge.textContent = 'Sold out';
        const nameRow = opt.querySelector('.m-room-name-row') || opt;
        nameRow.appendChild(badge);
      }
    } else {
      opt.classList.remove('is-sold-out');
      if (radio) radio.disabled = false;
      const badge = opt.querySelector('.m-room-sold-badge');
      if (badge) badge.remove();
    }

    const isMatch = rId === selectedId;
    opt.classList.toggle('selected', isMatch);
    if (radio && isMatch && !isSold) {
      radio.checked = true;
    }
  });
}
window.syncToMobileRoomOptions = syncToMobileRoomOptions;

// Update the room cards in DOM to reflect live sold-out status, prices, summary strip & MakeMyTrip inclusions
function updateRoomCardsStatus() {
  hotelRooms.forEach(room => {
    const card = document.querySelector(`.room-card[data-id="${room.id}"]`);
    if (!card) return;

    // Live Image & Alt Sync
    const cardImg = card.querySelector('.room-img');
    if (cardImg && room.image && !cardImg.src.endsWith(room.image)) {
      cardImg.src = room.image;
      if (room.gallery && room.gallery[0] && room.gallery[0].alt) {
        cardImg.alt = room.gallery[0].alt;
      }
    }

    // Summary strip at top of card (Size, Bed Type, Max Guests)
    const summaryStrip = card.querySelector('.room-summary-strip');
    if (summaryStrip) {
      const maxGuestsStr = room.capacity || (() => {
        const a = parseInt(room.maxAdults, 10) || 2;
        const c = (room.maxChildren !== undefined && room.maxChildren !== null) ? parseInt(room.maxChildren, 10) : 0;
        const adultStr = `${a} Adult${a > 1 ? 's' : ''}`;
        const childStr = c > 0 ? ` + ${c} Child${c > 1 ? 'ren' : ''}` : '';
        return `Max ${adultStr}${childStr}`;
      })();
      summaryStrip.innerHTML = `
        <span class="summary-item"><span class="material-symbols-outlined">aspect_ratio</span> ${room.size || '450 sq.ft.'}</span>
        <span class="summary-divider">•</span>
        <span class="summary-item"><span class="material-symbols-outlined">bed</span> ${room.bed || 'King Bed'}</span>
        <span class="summary-divider">•</span>
        <span class="summary-item"><span class="material-symbols-outlined">group</span> ${maxGuestsStr}</span>
      `;
    }

    // Price & Policy note & Balance Note
    const priceVal = card.querySelector('.room-price-val');
    const policyNote = card.querySelector('.room-policy-note');
    const balanceNote = card.querySelector('.room-balance-note');
    if (priceVal) {
      if (room.price !== null && room.price !== undefined && !isNaN(room.price)) {
        priceVal.textContent = `₹${Number(room.price).toLocaleString('en-IN')}`;
        if (policyNote) {
          const adv = Math.round(room.price * (hotelSettings.advancePercentage || 20) / 100);
          policyNote.textContent = `Pay 20% to confirm (₹${adv.toLocaleString('en-IN')})`;
        }
      } else {
        priceVal.textContent = 'Ask at hotel';
        if (policyNote) {
          policyNote.textContent = 'Budget-Friendly · Pay 20% advance';
        }
      }
    }
    if (balanceNote) {
      balanceNote.textContent = 'Remaining 80% at the hotel.';
    }

    // MakeMyTrip Style Inclusions Block
    const incBlock = card.querySelector('.room-inclusions-block');
    if (incBlock && Array.isArray(room.inclusions)) {
      const chipsWrap = incBlock.querySelector('.inclusions-chips-wrap');
      if (chipsWrap) {
        // Filter out any breakfast from confirmed inclusions
        const confirmedIncs = room.inclusions.filter(inc => {
          const txt = typeof inc === 'string' ? inc : inc.text;
          return !txt.toLowerCase().includes('breakfast');
        });
        chipsWrap.innerHTML = confirmedIncs.map(inc => {
          const txt = typeof inc === 'string' ? inc : inc.text;
          const ico = (typeof inc === 'object' && inc.icon) ? inc.icon : 'check_circle';
          return `
            <span class="inc-chip">
              <span class="material-symbols-outlined check-icon">${ico}</span>
              ${txt}
            </span>
          `;
        }).join('');
      }

      // Add small line under it: "Breakfast available (optional): ₹200."
      let bfNote = incBlock.querySelector('.room-breakfast-note');
      const currentBfPrice = hotelSettings.breakfastPrice || (hotelSettings.breakfastAddon ? hotelSettings.breakfastAddon.price : 200);
      if (!bfNote) {
        bfNote = document.createElement('div');
        bfNote.className = 'room-breakfast-note';
        const extrasGrp = incBlock.querySelector('.extras-group');
        if (extrasGrp) {
          incBlock.insertBefore(bfNote, extrasGrp);
        } else {
          incBlock.appendChild(bfNote);
        }
      }
      bfNote.textContent = `Breakfast available (optional): ₹${currentBfPrice}`;

      const extrasWrap = incBlock.querySelector('.extras-chips-wrap');
      const extrasGroup = incBlock.querySelector('.extras-group');
      if (extrasWrap && Array.isArray(room.extras) && room.extras.length > 0) {
        if (extrasGroup) extrasGroup.style.display = 'flex';
        extrasWrap.innerHTML = room.extras.map(ex => {
          const txt = typeof ex === 'string' ? ex : ex.text;
          const ico = (typeof ex === 'object' && ex.icon) ? ex.icon : (txt.toLowerCase().includes('breakfast') ? 'restaurant' : 'add_circle');
          return `
            <span class="extra-chip">
              <span class="material-symbols-outlined plus-icon">${ico}</span>
              ${txt}
            </span>
          `;
        }).join('');
      } else if (extrasGroup) {
        extrasGroup.style.display = 'none';
      }
    }

    // Mobile drawer option subtext sync
    const mOption = document.querySelector(`.m-room-option[data-room-id="${room.id}"]`);
    if (mOption) {
      const mSub = mOption.querySelector('.m-room-sub');
      if (mSub) {
        const bedStr = room.bed || (room.id === 'palm-grove-family-suite' ? '2 Beds (King + Extra)' : 'King Bed');
        mSub.textContent = `${bedStr} • ${room.capacity || 'Max 2 Adults + 1 Child'}`;
      }
    }
  });

  applyAvailabilityToCards();
}

// Fetch live inventory availability for selected stay dates
async function fetchAndApplyAvailability() {
  const checkIn = document.getElementById('bookCheckIn')?.value;
  const checkOut = document.getElementById('bookCheckOut')?.value;
  if (!checkIn || !checkOut) return;

  try {
    const res = await fetch(`/api/rooms/availability?checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.availability)) {
      currentAvailabilityMap = {};
      data.availability.forEach(item => {
        currentAvailabilityMap[item.roomId] = item;
      });
      applyAvailabilityToCards();
      updateRoomsCountDropdown();
      calculateLivePrice();
    }
  } catch (err) {
    console.warn('Failed to fetch availability:', err);
  }
}

// Update the room cards in DOM to reflect live inventory, sold-out ribbon, and coral availability hints
function applyAvailabilityToCards() {
  hotelRooms.forEach(room => {
    const card = document.querySelector(`.room-card[data-id="${room.id}"]`);
    if (!card) return;

    const avail = currentAvailabilityMap[room.id] || {
      available: (room.quantity !== undefined ? room.quantity : 1),
      isSoldOut: room.isSoldOut
    };

    const bookBtn = card.querySelector('.btn-book-room');
    let ribbon = card.querySelector('.sold-out-ribbon');
    let hint = card.querySelector('.room-avail-hint');
    if (!hint) {
      const pricingBox = card.querySelector('.room-footer-pricing');
      if (pricingBox) {
        hint = document.createElement('span');
        hint.className = 'room-avail-hint';
        pricingBox.appendChild(hint);
      }
    }

    if (avail.isSoldOut || avail.available <= 0) {
      card.classList.add('is-sold-out');
      if (!ribbon) {
        ribbon = document.createElement('div');
        ribbon.className = 'sold-out-ribbon';
        ribbon.textContent = 'SOLD OUT';
        card.querySelector('.room-img-wrapper')?.appendChild(ribbon);
      }
      if (bookBtn) {
        bookBtn.className = 'btn btn-disabled btn-book-room';
        bookBtn.textContent = 'Sold Out';
        bookBtn.disabled = true;
      }
      if (hint) {
        hint.innerHTML = '';
      }
    } else {
      card.classList.remove('is-sold-out');
      if (ribbon) ribbon.remove();
      if (bookBtn) {
        bookBtn.className = 'btn btn-gold btn-book-room';
        bookBtn.textContent = 'Book This Room';
        bookBtn.disabled = false;
      }
      if (hint) {
        if (avail.available <= 3) {
          hint.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">warning</span> Only ${avail.available} room${avail.available > 1 ? 's' : ''} left`;
        } else {
          hint.innerHTML = '';
        }
      }
    }
  });
}

// Dynamically clamp and populate Rooms dropdown based on available count for selected room & dates
function updateRoomsCountDropdown() {
  const roomSelect = document.getElementById('bookRoomSelect');
  const countSelect = document.getElementById('bookRoomsCount');
  if (!roomSelect || !countSelect) return;

  const roomId = roomSelect.value;
  const avail = currentAvailabilityMap[roomId];
  const maxAvailable = avail ? Math.max(0, avail.available) : 1;
  const currentVal = parseInt(countSelect.value, 10) || 1;

  countSelect.innerHTML = '';
  if (maxAvailable <= 0) {
    const opt = document.createElement('option');
    opt.value = '0';
    opt.textContent = '0 Rooms (Sold Out)';
    opt.disabled = true;
    opt.selected = true;
    countSelect.appendChild(opt);
  } else {
    for (let i = 1; i <= maxAvailable; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i} Room${i > 1 ? 's' : ''}`;
      if (i === currentVal || (currentVal > maxAvailable && i === maxAvailable)) {
        opt.selected = true;
      }
      countSelect.appendChild(opt);
    }
    if (!countSelect.value) {
      countSelect.value = '1';
    }
  }
  updateGuestDropdownLimits();
}

// Update Children Age Policy & Extra Bed Notes from Admin Settings
function updateCapacityPolicyNotes() {
  const childAge = hotelSettings.childComplimentaryAgeLimit || 5;
  const childNote = document.getElementById('bookingChildAgeNote');
  if (childNote) {
    childNote.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px; color: var(--turquoise);">child_care</span> Children up to ${childAge} years stay complimentary without extra bed.`;
  }
  const extraBedNote = document.getElementById('bookingExtraBedNote');
  if (extraBedNote) {
    const ph = hotelSettings.phone || '7812027551';
    extraBedNote.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px; color: var(--champagne-gold);">call</span> Need an extra bed? Please call front desk at +91 ${ph}.`;
  }
}

// Dynamic scaling of Adults and Children dropdown limits: N rooms => max adults = (room.maxAdults || 2) * N, max children = (room.maxChildren || 1) * N
function updateGuestDropdownLimits() {
  const roomSelect = document.getElementById('bookRoomSelect');
  const roomsCountSelect = document.getElementById('bookRoomsCount');
  const adultsSelect = document.getElementById('bookAdults');
  const childrenSelect = document.getElementById('bookChildren');
  if (!adultsSelect || !childrenSelect) return;

  const selectedRoomId = roomSelect ? roomSelect.value : null;
  const selectedRoom = (hotelRooms || []).find(r => r.id === selectedRoomId);
  const roomsCount = Math.max(1, parseInt(roomsCountSelect?.value, 10) || 1);

  const roomMaxAdults = selectedRoom ? (parseInt(selectedRoom.maxAdults, 10) || 2) : 2;
  const roomMaxChildren = selectedRoom ? ((selectedRoom.maxChildren !== undefined && selectedRoom.maxChildren !== null) ? parseInt(selectedRoom.maxChildren, 10) : 1) : 1;

  const maxAllowedAdults = roomMaxAdults * roomsCount;
  const maxAllowedChildren = roomMaxChildren * roomsCount;

  const currentAdults = parseInt(adultsSelect.value, 10) || 2;
  const currentChildren = parseInt(childrenSelect.value, 10) || 0;

  // Rebuild Adults options - show at least up to maxAllowedAdults, but if current exceeds, keep current so it's not silently reset
  const topAdult = Math.max(maxAllowedAdults, currentAdults);
  adultsSelect.innerHTML = '';
  for (let i = 1; i <= topAdult; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${i} Adult${i > 1 ? 's' : ''}${i > maxAllowedAdults ? ' (Exceeds capacity)' : ''}`;
    if (i === currentAdults) {
      opt.selected = true;
    }
    adultsSelect.appendChild(opt);
  }
  if (!adultsSelect.value && maxAllowedAdults >= 1) {
    adultsSelect.value = String(Math.min(2, maxAllowedAdults));
  }

  // Rebuild Children options
  const topChildren = Math.max(maxAllowedChildren, currentChildren);
  childrenSelect.innerHTML = '';
  for (let i = 0; i <= topChildren; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = i === 0 ? '0 Children' : `${i} Child${i > 1 ? 'ren' : ''}${i > maxAllowedChildren ? ' (Exceeds capacity)' : ''}`;
    if (i === currentChildren) {
      opt.selected = true;
    }
    childrenSelect.appendChild(opt);
  }

  // Enforce Capacity Warning Banner with One-Click Add Room Button
  const alertEl = document.getElementById('roomCapacityAlert');
  const alertMsg = document.getElementById('roomCapacityAlertMsg');
  const isCapacityExceeded = (currentAdults > maxAllowedAdults) || (currentChildren > maxAllowedChildren);
  if (isCapacityExceeded) {
    if (alertEl) alertEl.style.display = 'flex';
    if (alertMsg) {
      alertMsg.textContent = (selectedRoom && selectedRoom.id === 'palm-grove-family-suite')
        ? `Each suite accommodates up to ${roomMaxAdults} adults and ${roomMaxChildren} children (${roomsCount} suite${roomsCount > 1 ? 's' : ''} = max ${maxAllowedAdults} adults, ${maxAllowedChildren} children). Please add another room.`
        : `Each room accommodates up to 2 adults and 1 child (${roomsCount} room${roomsCount > 1 ? 's' : ''} = max ${maxAllowedAdults} adults, ${maxAllowedChildren} children). Please add another room.`;
    }
  } else {
    if (alertEl) alertEl.style.display = 'none';
  }

  // Also sync to mobile sheet stepper displays
  const mRoomVal = document.getElementById('mRoomCountVal');
  const mAdultVal = document.getElementById('mAdultCountVal');
  const mChildVal = document.getElementById('mChildCountVal');
  if (mRoomVal) mRoomVal.textContent = String(roomsCount);
  if (mAdultVal) mAdultVal.textContent = String(currentAdults);
  if (mChildVal) mChildVal.textContent = String(currentChildren);
}

// One-click "Add another room" button handler
window.addAnotherRoomForCapacity = function() {
  const roomsCountSelect = document.getElementById('bookRoomsCount');
  const roomSelect = document.getElementById('bookRoomSelect');
  if (!roomsCountSelect) return;

  const currentVal = parseInt(roomsCountSelect.value, 10) || 1;
  const avail = currentAvailabilityMap[roomSelect?.value];
  const maxAvailable = avail ? Math.max(1, avail.available) : 10;
  const nextVal = currentVal + 1;

  if (currentVal < maxAvailable) {
    roomsCountSelect.value = String(nextVal);
  } else {
    let opt = roomsCountSelect.querySelector(`option[value="${nextVal}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = String(nextVal);
      opt.textContent = `${nextVal} Rooms`;
      roomsCountSelect.appendChild(opt);
    }
    roomsCountSelect.value = String(nextVal);
  }

  updateGuestDropdownLimits();
  calculateLivePrice();
  const alertEl = document.getElementById('roomCapacityAlert');
  if (alertEl) alertEl.style.display = 'none';
};

// Setup minimum dates (Check-in today, Check-out tomorrow, min 1 night)
function setupBookingDates() {
  const checkInInput = document.getElementById('bookCheckIn');
  const checkOutInput = document.getElementById('bookCheckOut');
  if (!checkInInput || !checkOutInput) return;

  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const yyyy = nowIST.getFullYear();
  const mm = String(nowIST.getMonth() + 1).padStart(2, '0');
  const dd = String(nowIST.getDate()).padStart(2, '0');
  const minCheckIn = `${yyyy}-${mm}-${dd}`;

  checkInInput.min = minCheckIn;
  if (!checkInInput.value || checkInInput.value < minCheckIn) {
    checkInInput.value = minCheckIn;
  }

  const inDate = new Date(checkInInput.value);
  const nextDay = new Date(inDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const tY = nextDay.getFullYear();
  const tM = String(nextDay.getMonth() + 1).padStart(2, '0');
  const tD = String(nextDay.getDate()).padStart(2, '0');
  const minCheckOut = `${tY}-${tM}-${tD}`;

  checkOutInput.min = minCheckOut;
  if (!checkOutInput.value || checkOutInput.value <= checkInInput.value) {
    checkOutInput.value = minCheckOut;
  }

  // Sync to mobile sheet inputs
  const mCheckIn = document.getElementById('mCheckIn');
  const mCheckOut = document.getElementById('mCheckOut');
  if (mCheckIn) {
    mCheckIn.min = minCheckIn;
    if (!mCheckIn.value || mCheckIn.value < minCheckIn) mCheckIn.value = checkInInput.value;
  }
  if (mCheckOut) {
    mCheckOut.min = minCheckOut;
    if (!mCheckOut.value || mCheckOut.value <= mCheckIn.value) mCheckOut.value = checkOutInput.value;
  }
}

// Event Listeners for Live Price Calculation
function setupBookingEventListeners() {
  const inputs = [
    'bookCheckIn',
    'bookCheckOut',
    'bookAdults',
    'bookChildren',
    'bookRoomsCount',
    'bookRoomSelect',
    'toggleBreakfast',
    'breakfastGuestsInput',
    'toggleCarNeed',
    'vehicleTypeSelect',
    'vehicleTripTypeSelect',
    'carCountInput',
    'toggleCandlelight',
    'dinnerSetupSelect',
    'dinnerOccasionSelect',
    'dinnerCountInput'
  ];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        if (id === 'vehicleTypeSelect') {
          updateVehicleDetailsDisplay();
        }
        if (id === 'bookCheckIn' || id === 'bookCheckOut') {
          await fetchAndApplyAvailability();
        }
        if (id === 'bookRoomSelect' || id === 'bookRoomsCount') {
          updateRoomsCountDropdown();
          updateGuestDropdownLimits();
        }
        calculateLivePrice();
      });
      el.addEventListener('input', () => {
        if (id === 'bookRoomsCount' || id === 'bookRoomSelect') {
          updateGuestDropdownLimits();
        }
        calculateLivePrice();
      });
    }
  });

  // Toggle Breakfast controls visibility
  const bfToggle = document.getElementById('toggleBreakfast');
  const bfControls = document.getElementById('breakfastControlsBox');
  const bfCard = document.getElementById('breakfastAddonCard');

  if (bfToggle && bfControls) {
    bfToggle.addEventListener('change', () => {
      if (bfToggle.checked) {
        bfControls.style.display = 'block';
        if (bfCard) bfCard.classList.add('active');
        updateBreakfastAddonDisplay();
      } else {
        bfControls.style.display = 'none';
        if (bfCard) bfCard.classList.remove('active');
      }
      calculateLivePrice();
    });
  }

  // Stepper buttons for breakfast quantity
  const bfMinusBtn = document.getElementById('bfQtyMinusBtn');
  const bfPlusBtn = document.getElementById('bfQtyPlusBtn');
  const bfQtyInput = document.getElementById('breakfastGuestsInput');

  if (bfMinusBtn && bfQtyInput) {
    bfMinusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(bfQtyInput.value, 10) || 1;
      if (current > 1) {
        bfQtyInput.value = current - 1;
        bfQtyInput.dataset.userEdited = 'true';
        calculateLivePrice();
      }
    });
  }

  if (bfPlusBtn && bfQtyInput) {
    bfPlusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(bfQtyInput.value, 10) || 1;
      if (current < 20) {
        bfQtyInput.value = current + 1;
        bfQtyInput.dataset.userEdited = 'true';
        calculateLivePrice();
      }
    });
  }

  // Sync default guests/rooms count on change
  const adultsSelect = document.getElementById('bookAdults');
  const childrenSelect = document.getElementById('bookChildren');
  const roomsCountSelect = document.getElementById('bookRoomsCount');

  const syncBfDefaults = () => {
    const unit = hotelSettings.breakfastUnit || hotelSettings.breakfastAddon?.unit || 'per_person_per_day';
    if (!bfQtyInput) return;
    if (unit === 'per_room_per_day') {
      bfQtyInput.value = parseInt(roomsCountSelect?.value, 10) || 1;
    } else if (!bfQtyInput.dataset.userEdited) {
      const a = parseInt(adultsSelect?.value, 10) || 2;
      const c = parseInt(childrenSelect?.value, 10) || 0;
      bfQtyInput.value = Math.max(1, a + c);
    }
  };

  if (adultsSelect) adultsSelect.addEventListener('change', syncBfDefaults);
  if (childrenSelect) childrenSelect.addEventListener('change', syncBfDefaults);
  if (roomsCountSelect) roomsCountSelect.addEventListener('change', syncBfDefaults);

  // Toggle Car controls visibility with smooth slide-down animation
  const carToggle = document.getElementById('toggleCarNeed');
  const carControls = document.getElementById('carControlsBox');
  const carCard = document.getElementById('carAddonCard');

  if (carToggle && carControls) {
    carToggle.addEventListener('change', () => {
      if (carToggle.checked) {
        carControls.style.display = 'block';
        if (carCard) carCard.classList.add('active');
        initVehicleLines();
        renderVehicleLines();
      } else {
        carControls.style.display = 'none';
        if (carCard) carCard.classList.remove('active');
      }
      calculateLivePrice();
    });
  }

  const addLineBtn = document.getElementById('addVehicleLineBtn');
  if (addLineBtn) {
    addLineBtn.addEventListener('click', (e) => {
      e.preventDefault();
      addVehicleLine();
    });
  }

  // Toggle Candlelight controls visibility
  const candleToggle = document.getElementById('toggleCandlelight');
  const candleControls = document.getElementById('candleControlsBox');
  const candleCard = document.getElementById('candlelightAddonCard');
  if (candleToggle && candleControls) {
    candleToggle.addEventListener('change', () => {
      candleControls.style.display = candleToggle.checked ? 'block' : 'none';
      if (candleCard) {
        if (candleToggle.checked) candleCard.classList.add('active');
        else candleCard.classList.remove('active');
      }
      calculateLivePrice();
    });
  }

  // Stepper buttons for dinner quantity
  const dinnerMinusBtn = document.getElementById('dinnerQtyMinusBtn');
  const dinnerPlusBtn = document.getElementById('dinnerQtyPlusBtn');
  const dinnerQtyInput = document.getElementById('dinnerCountInput');

  if (dinnerMinusBtn && dinnerQtyInput) {
    dinnerMinusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(dinnerQtyInput.value, 10) || 1;
      if (current > 1) {
        dinnerQtyInput.value = current - 1;
        calculateLivePrice();
      }
    });
  }

  if (dinnerPlusBtn && dinnerQtyInput) {
    dinnerPlusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = parseInt(dinnerQtyInput.value, 10) || 1;
      if (current < 5) {
        dinnerQtyInput.value = current + 1;
        calculateLivePrice();
      }
    });
  }

  // Open Checkout Modal
  const checkoutBtn = document.getElementById('openCheckoutModalBtn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCheckoutModal();
    });
  }

  // Handle Booking Form Submission
  const bookingForm = document.getElementById('checkoutReservationForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', handleReservationSubmit);
  }
}

// Calculate Live Total, Pay Now (20%), and Pay at Hotel (80%)
function calculateLivePrice() {
  const checkInVal = document.getElementById('bookCheckIn')?.value;
  const checkOutVal = document.getElementById('bookCheckOut')?.value;
  const roomSelect = document.getElementById('bookRoomSelect');
  const roomsCount = Math.max(1, parseInt(document.getElementById('bookRoomsCount')?.value, 10) || 1);
  const carNeed = document.getElementById('toggleCarNeed')?.checked;
  let carCount = Math.max(1, parseInt(document.getElementById('carCountInput')?.value, 10) || 1);
  const vehicleSelect = document.getElementById('vehicleTypeSelect');
  const tripSelect = document.getElementById('vehicleTripTypeSelect');
  const candleNeed = document.getElementById('toggleCandlelight')?.checked;
  const dinnerSetup = document.getElementById('dinnerSetupSelect')?.value || 'Beachside';
  const dinnerCount = Math.max(1, parseInt(document.getElementById('dinnerCountInput')?.value, 10) || 1);
  const adultsCount = Math.max(1, parseInt(document.getElementById('bookAdults')?.value, 10) || 2);

  if (!checkInVal || !checkOutVal || !roomSelect) return;

  const inDate = new Date(checkInVal);
  const outDate = new Date(checkOutVal);

  if (outDate <= inDate) {
    // Auto-adjust checkout to 1 day after checkin
    const nextDay = new Date(inDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const y = nextDay.getFullYear();
    const m = String(nextDay.getMonth() + 1).padStart(2, '0');
    const d = String(nextDay.getDate()).padStart(2, '0');
    document.getElementById('bookCheckOut').value = `${y}-${m}-${d}`;
    return calculateLivePrice();
  }

  // Minimum 1 night
  const nights = Math.max(1, Math.round((outDate - inDate) / (1000 * 60 * 60 * 24)));

  const selectedOpt = roomSelect.options[roomSelect.selectedIndex];
  const priceAttr = selectedOpt?.getAttribute('data-price');
  const hasNumericPrice = priceAttr !== '' && priceAttr !== 'null' && priceAttr !== null && !isNaN(parseFloat(priceAttr));
  const roomPrice = hasNumericPrice ? parseFloat(priceAttr) : null;
  const currentRoomAvail = currentAvailabilityMap[roomSelect.value];
  const maxRoomAvail = currentRoomAvail ? currentRoomAvail.available : 1;
  const isSoldOut = (selectedOpt ? selectedOpt.getAttribute('data-soldout') === 'true' : false) || 
                    (currentRoomAvail && (currentRoomAvail.available <= 0 || currentRoomAvail.isSoldOut));

  // Formula 1: Room cost = room price per night × number of nights × number of rooms
  const roomSubtotal = hasNumericPrice ? (roomPrice * nights * roomsCount) : 0;

  // Formula 2: Transport cost (only if “Need a car?” is ON) = sum of all configured vehicle lines
  let carTotal = 0;
  const vehicleBreakdownLines = [];
  const activeVehicleLines = [];
  let vehicleName = 'Vehicle';
  let vehicleShortName = 'Vehicle';
  let vehicleType = 'car';
  let vehicleRatePerDay = 0;
  let vehicleTripType = 'tour';
  let hasUnpricedVehicle = false;
  carCount = 1;

  if (carNeed) {
    initVehicleLines();
    bookingVehicleLines.forEach(line => {
      const vObj = (hotelVehicles || []).find(v => v.id === line.vehicleId);
      const vName = vObj ? vObj.name : 'Vehicle';
      const svc = vObj?.services?.[line.serviceType];
      const hasPrice = svc && svc.enabled !== false && svc.price != null && Number(svc.price) > 0;
      const unitPrice = hasPrice ? Number(svc.price) : 0;
      const isTour = line.serviceType === 'tour';
      const lineDays = isTour ? Math.max(1, line.days || nights || 1) : 1;
      const qty = Math.max(1, line.quantity || 1);
      const lineTotal = isTour ? (unitPrice * qty * lineDays) : (unitPrice * qty);

      let sLabel = 'Trip';
      if (line.serviceType === 'pickup') sLabel = 'Pickup';
      else if (line.serviceType === 'drop') sLabel = 'Drop';
      else if (line.serviceType === 'pickup_drop') sLabel = 'Pickup + Drop';
      else if (line.serviceType === 'tour') sLabel = 'Tour';

      carTotal += lineTotal;
      
      let lineDesc = '';
      if (!hasPrice || unitPrice === 0) {
        hasUnpricedVehicle = true;
        lineDesc = `${vName} · ${sLabel} × ${qty} (Ask us)`;
      } else if (isTour) {
        lineDesc = `${vName} · ${sLabel} × ${qty} veh × ${lineDays} day${lineDays > 1 ? 's' : ''} = ₹${lineTotal.toLocaleString('en-IN')}`;
      } else {
        lineDesc = `${vName} · ${sLabel} × ${qty} = ₹${lineTotal.toLocaleString('en-IN')}`;
      }
      vehicleBreakdownLines.push(lineDesc);

      activeVehicleLines.push({
        vehicleId: line.vehicleId,
        vehicleName: vName,
        serviceType: line.serviceType,
        serviceLabel: sLabel,
        quantity: qty,
        days: lineDays,
        unitPrice,
        lineTotal,
        hasPrice,
        pickupPoint: line.pickupPoint || '',
        pickupTime: line.pickupTime || '',
        dropPoint: line.dropPoint || '',
        dropTime: line.dropTime || '',
        tourNotes: line.tourNotes || ''
      });
    });

    if (activeVehicleLines.length > 0) {
      vehicleType = activeVehicleLines[0].vehicleId;
      vehicleName = activeVehicleLines[0].vehicleName;
      vehicleShortName = activeVehicleLines[0].vehicleName;
      vehicleRatePerDay = activeVehicleLines[0].unitPrice || 0;
      vehicleTripType = activeVehicleLines[0].serviceType || 'tour';
      carCount = activeVehicleLines[0].quantity;
    }
  }

  const vBanner = document.getElementById('vehiclesTotalBanner');
  if (vBanner) {
    if (carNeed) {
      if (carTotal > 0 && hasUnpricedVehicle) {
        vBanner.textContent = `Total Transport: ₹${carTotal.toLocaleString('en-IN')} (+ Ask us for unpriced)`;
      } else if (carTotal > 0) {
        vBanner.textContent = `Total Transport: ₹${carTotal.toLocaleString('en-IN')}`;
      } else if (hasUnpricedVehicle) {
        vBanner.textContent = `Total Transport: Ask us (rate on request)`;
      } else {
        vBanner.textContent = '';
      }
    } else {
      vBanner.textContent = '';
    }
  }

  // Formula 3: Candlelight dinner (only if selected) = dinner price × number of dinners (or guests, as set in admin)
  let dinnerTotal = 0;
  let dinnerUnitPrice = 0;
  let dinnerMultiplier = 1;

  if (candleNeed) {
    dinnerUnitPrice = dinnerSetup === 'Beachside'
      ? (hotelSettings.candlelightDinnerBeachside || 3500)
      : (hotelSettings.candlelightDinnerPoolside || 2800);

    const isPerGuest = hotelSettings.candlelightPricingMode === 'per_guest';
    dinnerMultiplier = isPerGuest ? adultsCount : dinnerCount;
    dinnerTotal = dinnerUnitPrice * dinnerMultiplier;
  }

  // Formula: Optional Breakfast Add-on
  const bfEnabled = hotelSettings.breakfastEnabled !== false && (!hotelSettings.breakfastAddon || hotelSettings.breakfastAddon.enabled !== false);
  const bfNeed = document.getElementById('toggleBreakfast')?.checked && bfEnabled;
  const bfPrice = Number(hotelSettings.breakfastPrice !== undefined ? hotelSettings.breakfastPrice : (hotelSettings.breakfastAddon?.price || 200));
  const bfUnit = hotelSettings.breakfastUnit || hotelSettings.breakfastAddon?.unit || 'per_person_per_day';
  const childrenCount = parseInt(document.getElementById('bookChildren')?.value, 10) || 0;
  const totalGuests = adultsCount + childrenCount;

  let bfCount = parseInt(document.getElementById('breakfastGuestsInput')?.value, 10) || totalGuests;
  if (bfUnit === 'per_room_per_day') {
    bfCount = roomsCount;
  }

  let breakfastTotal = 0;
  let breakfastBreakdownText = '';

  if (bfNeed) {
    breakfastTotal = bfPrice * bfCount * nights;
    if (bfUnit === 'per_room_per_day') {
      breakfastBreakdownText = `Breakfast × ${bfCount} room${bfCount > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
    } else {
      breakfastBreakdownText = `Breakfast × ${bfCount} guest${bfCount > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
    }
  }

  // Formula 4: Estimated Total = room cost + transport cost + candlelight dinner + breakfast
  const baseSubtotal = roomSubtotal + carTotal + dinnerTotal + breakfastTotal;

  // Tax setting: All prices come from admin/DB only. Don't add taxes unless a tax setting is enabled in admin.
  let taxAmount = 0;
  const isTaxEnabled = !!hotelSettings.enableTax;
  const taxPct = Number(hotelSettings.taxPercentage) || 0;
  if (isTaxEnabled && taxPct > 0) {
    taxAmount = Math.round((baseSubtotal * taxPct) / 100);
  }

  const grandTotal = baseSubtotal + taxAmount;
  const advancePercent = hotelSettings.advancePercentage || 20;
  const payNow = hasNumericPrice ? Math.round((grandTotal * advancePercent) / 100) : Math.round((carTotal + dinnerTotal + breakfastTotal + taxAmount) * advancePercent / 100);
  const payAtHotel = hasNumericPrice ? (grandTotal - payNow) : null;

  // Breakdown lines formatting as specified in Prompt 2:
  // Examples: “Room: ₹X × 2 nights × 1 room,” “Toto × 1 × 2 days,” “Candlelight dinner.” Only show lines that apply.
  const roomBreakdownText = hasNumericPrice
    ? `Room: ₹${roomPrice.toLocaleString('en-IN')} × ${nights} night${nights > 1 ? 's' : ''} × ${roomsCount} room${roomsCount > 1 ? 's' : ''}`
    : `Room: ${selectedOpt ? selectedOpt.text.split('—')[0].trim() : 'Room'} (Ask at hotel)`;

  const transportBreakdownText = carNeed
    ? `${vehicleName} × ${carCount} × ${nights} day${nights > 1 ? 's' : ''}`
    : '';

  let dinnerBreakdownText = '';
  if (candleNeed) {
    if (hotelSettings.candlelightPricingMode === 'per_guest') {
      dinnerBreakdownText = `Candlelight dinner (${dinnerSetup}) × ${adultsCount} guests`;
    } else if (dinnerMultiplier > 1) {
      dinnerBreakdownText = `Candlelight dinner (${dinnerSetup}) × ${dinnerMultiplier}`;
    } else {
      dinnerBreakdownText = `Candlelight dinner`;
    }
  }

  const taxBreakdownText = (isTaxEnabled && taxAmount > 0)
    ? `GST / Taxes (${taxPct}%): ₹${taxAmount.toLocaleString('en-IN')}`
    : '';

  // Update Total, Pay Now (20%), and Pay at Hotel (80%)
  const totalEl = document.getElementById('liveTotalAmount');
  const payNowEl = document.getElementById('livePayNow');
  const payHotelEl = document.getElementById('livePayHotel');
  const nightsLabel = document.getElementById('liveNightsCount');
  const checkoutBtn = document.getElementById('openCheckoutModalBtn');

  if (totalEl) {
    if (hasNumericPrice) {
      totalEl.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
    } else {
      totalEl.textContent = (carTotal + dinnerTotal + breakfastTotal + taxAmount > 0) ? `Ask at hotel (+ ₹${(carTotal + dinnerTotal + breakfastTotal + taxAmount).toLocaleString('en-IN')})` : 'Ask at hotel';
    }
  }

  if (payNowEl) {
    if (hasNumericPrice) {
      payNowEl.textContent = `₹${payNow.toLocaleString('en-IN')}`;
    } else {
      payNowEl.textContent = (payNow > 0) ? `₹${payNow.toLocaleString('en-IN')} (Add-ons)` : 'Ask at hotel';
    }
  }

  if (payHotelEl) {
    if (hasNumericPrice) {
      payHotelEl.textContent = `₹${payAtHotel.toLocaleString('en-IN')}`;
    } else {
      payHotelEl.textContent = 'Pay balance at hotel';
    }
  }

  if (nightsLabel) nightsLabel.textContent = `${nights} night${nights > 1 ? 's' : ''}`;

  // Sync to Mobile Summary Card & Bottom Sheet
  if (typeof window.syncMobileBookingDisplays === 'function') {
    window.syncMobileBookingDisplays({
      checkIn: checkInVal,
      checkOut: checkOutVal,
      nights,
      roomsCount,
      adultsCount,
      currentChildren: parseInt(document.getElementById('bookChildren')?.value, 10) || 0,
      grandTotal,
      payNow,
      isSoldOut
    });
  }

  // Update itemized breakdown lines under the total (only show lines that apply)
  const roomLineEl = document.getElementById('liveRoomSummaryLine');
  const transportSummaryLine = document.getElementById('liveTransportSummaryLine');
  const dinnerLineEl = document.getElementById('liveDinnerSummaryLine');
  const taxLineEl = document.getElementById('liveTaxSummaryLine');

  if (roomLineEl) {
    roomLineEl.textContent = roomBreakdownText;
    roomLineEl.style.display = 'block';
  }

  if (transportSummaryLine) {
    if (carNeed && vehicleBreakdownLines.length > 0) {
      transportSummaryLine.style.display = 'block';
      transportSummaryLine.innerHTML = vehicleBreakdownLines.map(l => '<div class="transport-subline-item">• ' + l + '</div>').join('');
    } else {
      transportSummaryLine.style.display = 'none';
      transportSummaryLine.innerHTML = '';
    }
  }

  const breakfastLineEl = document.getElementById('liveBreakfastSummaryLine');
  if (breakfastLineEl) {
    if (bfNeed && breakfastTotal > 0) {
      breakfastLineEl.style.display = 'flex';
      breakfastLineEl.textContent = breakfastBreakdownText;
    } else {
      breakfastLineEl.style.display = 'none';
      breakfastLineEl.textContent = '';
    }
  }

  if (dinnerLineEl) {
    if (candleNeed && dinnerTotal > 0) {
      dinnerLineEl.style.display = 'flex';
      dinnerLineEl.textContent = dinnerBreakdownText;
    } else {
      dinnerLineEl.style.display = 'none';
      dinnerLineEl.textContent = '';
    }
  }

  if (taxLineEl) {
    if (isTaxEnabled && taxAmount > 0) {
      taxLineEl.style.display = 'flex';
      taxLineEl.textContent = taxBreakdownText;
    } else {
      taxLineEl.style.display = 'none';
      taxLineEl.textContent = '';
    }
  }

  // Validate Capacity Limits and enforce 2 Adults + 1 Child per room rule
  const selectedRoomObj = hotelRooms.find(r => r.id === roomSelect.value);
  const rMaxA = selectedRoomObj ? (parseInt(selectedRoomObj.maxAdults, 10) || 2) : 2;
  const rMaxC = selectedRoomObj ? ((selectedRoomObj.maxChildren !== undefined && selectedRoomObj.maxChildren !== null) ? parseInt(selectedRoomObj.maxChildren, 10) : 1) : 1;
  const maxAllowedAdults = rMaxA * roomsCount;
  const maxAllowedChildren = rMaxC * roomsCount;

  const currentAdults = parseInt(document.getElementById('bookAdults')?.value, 10) || 2;
  const currentChildren = parseInt(document.getElementById('bookChildren')?.value, 10) || 0;

  const isCapacityExceeded = (currentAdults > maxAllowedAdults) || (currentChildren > maxAllowedChildren);
  const capacityAlertEl = document.getElementById('roomCapacityAlert');
  const capacityAlertMsg = document.getElementById('roomCapacityAlertMsg');

  if (isCapacityExceeded) {
    if (capacityAlertEl) capacityAlertEl.style.display = 'flex';
    if (capacityAlertMsg) {
      capacityAlertMsg.textContent = (selectedRoomObj && selectedRoomObj.id === 'palm-grove-family-suite')
        ? `Each suite accommodates up to ${rMaxA} adults and ${rMaxC} children. Please add another room.`
        : 'Each room accommodates up to 2 adults and 1 child. Please add another room.';
    }
  } else {
    if (capacityAlertEl) capacityAlertEl.style.display = 'none';
  }

  if (checkoutBtn) {
    if (isSoldOut || maxRoomAvail <= 0) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Room Sold Out for Selected Dates';
      checkoutBtn.className = 'btn btn-disabled';
    } else if (isCapacityExceeded) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = 'Capacity Exceeded · Please Add Another Room';
      checkoutBtn.className = 'btn btn-disabled';
    } else {
      checkoutBtn.disabled = false;
      checkoutBtn.innerHTML = `<span class="material-symbols-outlined">verified</span> Reserve Stay (Pay 20% Now)`;
      checkoutBtn.className = 'btn btn-coral';
    }
  }

  // Retrieve room inclusions & extras from admin data
  const suiteInclusions = (selectedRoomObj && Array.isArray(selectedRoomObj.inclusions)) ? selectedRoomObj.inclusions.filter(inc => {
    const txt = typeof inc === 'string' ? inc : inc.text;
    return !txt.toLowerCase().includes('breakfast');
  }) : [
    { text: "AC", icon: "ac_unit" },
    { text: "Free Wi-Fi", icon: "wifi" },
    { text: "Smart TV", icon: "tv" },
    { text: "Pool access", icon: "pool" },
    { text: "Housekeeping", icon: "cleaning_services" },
    { text: "Hot water", icon: "water_drop" }
  ];
  const suiteExtras = (selectedRoomObj && Array.isArray(selectedRoomObj.extras)) ? selectedRoomObj.extras : [
    { text: "Breakfast (optional, ₹200)", icon: "restaurant" },
    { text: "Candlelight Dinner", icon: "favorite" },
    { text: "Car / Toto / Auto pickup", icon: "directions_car" }
  ];

  // Update live suite inclusions banner in live booking form
  const incBanner = document.getElementById('liveSuiteInclusionsBanner');
  const incChipsContainer = document.getElementById('liveSuiteInclusionsChips');
  if (incBanner && incChipsContainer) {
    if (suiteInclusions.length > 0) {
      incBanner.style.display = 'flex';
      incChipsContainer.innerHTML = suiteInclusions.map((inc, i) => {
        const txt = typeof inc === 'string' ? inc : inc.text;
        return `<span class="inc-pill"><span class="material-symbols-outlined" style="font-size:12px; color:#10B981;">check_circle</span> ${txt}</span>`;
      }).join('');
    } else {
      incBanner.style.display = 'none';
      incChipsContainer.innerHTML = '';
    }
  }

  return {
    roomId: roomSelect.value,
    roomName: selectedOpt ? selectedOpt.text.split('—')[0].trim() : '',
    roomPrice,
    checkIn: checkInVal,
    checkOut: checkOutVal,
    nights,
    roomsCount,
    carNeed,
    vehicleType,
    vehicleName,
    vehicleShortName,
    vehicleRatePerDay,
    vehicleTripType,
    carCount,
    carTotal,
    vehicleLines: activeVehicleLines,
    vehicleBreakdownLines,
    candleNeed,
    dinnerSetup,
    dinnerCount,
    dinnerMultiplier,
    dinnerTotal,
    roomSubtotal,
    breakfastNeed: bfNeed,
    breakfastPrice: bfPrice,
    breakfastUnit: bfUnit,
    breakfastCount: bfCount,
    breakfastTotal,
    breakfastBreakdownText,
    taxAmount,
    grandTotal,
    payNow,
    payAtHotel,
    isSoldOut,
    inclusions: suiteInclusions,
    extras: suiteExtras,
    roomBreakdownText,
    transportBreakdownText,
    dinnerBreakdownText,
    taxBreakdownText
  };
}

// "Book This Room" button handler
window.selectRoomForBooking = function(roomId) {
  const avail = currentAvailabilityMap[roomId];
  if (avail && (avail.available <= 0 || avail.isSoldOut)) {
    alert('This room is sold out for the selected dates. Please choose different dates or select another suite.');
    return;
  }

  const roomSelect = document.getElementById('bookRoomSelect');
  if (roomSelect) {
    roomSelect.value = roomId;
    updateRoomsCountDropdown();
    updateGuestDropdownLimits();
    calculateLivePrice();
  }
  
  // Smooth scroll to booking section
  const bookingSec = document.getElementById('bookingSection');
  if (bookingSec) {
    bookingSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Open the checkout modal
  setTimeout(() => {
    openCheckoutModal();
  }, 450);
};

// "Reserve Candlelight Dinner" CTA handler
window.selectCandlelightAddon = function(setup = 'Beachside') {
  const candleToggle = document.getElementById('toggleCandlelight');
  const setupSelect = document.getElementById('dinnerSetupSelect');
  if (candleToggle) {
    candleToggle.checked = true;
    const controls = document.getElementById('candleControlsBox');
    if (controls) controls.style.display = 'block';
  }
  if (setupSelect) {
    setupSelect.value = setup;
  }
  calculateLivePrice();

  const bookingSec = document.getElementById('bookingSection');
  if (bookingSec) {
    bookingSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Open Reservation Checkout Modal
function openCheckoutModal() {
  const calc = calculateLivePrice();
  if (!calc || calc.isSoldOut) {
    alert('The selected room is currently Sold Out. Please select an available suite.');
    return;
  }

  // Capacity validation gate
  const selRoomObj = hotelRooms.find(r => r.id === calc.roomSelectVal || r.id === calc.roomId);
  const rLimitA = selRoomObj ? (parseInt(selRoomObj.maxAdults, 10) || 2) : 2;
  const rLimitC = selRoomObj ? ((selRoomObj.maxChildren !== undefined && selRoomObj.maxChildren !== null) ? parseInt(selRoomObj.maxChildren, 10) : 1) : 1;
  const maxCapA = rLimitA * calc.roomsCount;
  const maxCapC = rLimitC * calc.roomsCount;
  const curA = parseInt(document.getElementById('bookAdults')?.value, 10) || 2;
  const curC = parseInt(document.getElementById('bookChildren')?.value, 10) || 0;

  if (curA > maxCapA || curC > maxCapC) {
    const alertMsg = (selRoomObj && selRoomObj.id === 'palm-grove-family-suite')
      ? `Each suite accommodates up to ${rLimitA} adults and ${rLimitC} children. Please add another room.`
      : 'Each room accommodates up to 2 adults and 1 child. Please add another room.';
    alert(alertMsg);
    const alertBox = document.getElementById('roomCapacityAlert');
    if (alertBox) alertBox.style.display = 'flex';
    return;
  }

  const modal = document.getElementById('checkoutModal');
  const summaryBox = document.getElementById('modalPriceSummaryBox');
  if (!modal || !summaryBox) return;

  summaryBox.innerHTML = `
    <div style="background: #FAF6EE; border: 1px solid var(--champagne-gold); border-radius: 12px; padding: 18px; margin-bottom: 20px;">
      <div style="font-size: 0.82rem; color: #666; margin-bottom: 12px; border-bottom: 1px solid #EAE0D0; padding-bottom: 8px;">
        Dates: <strong>${calc.checkIn}</strong> to <strong>${calc.checkOut}</strong> (${calc.nights} night${calc.nights > 1 ? 's' : ''})
      </div>

      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 600; color: var(--ocean-blue); margin-bottom: 6px;">
          <span>${calc.roomBreakdownText}</span>
          <span>₹${calc.roomSubtotal.toLocaleString('en-IN')}</span>
        </div>
        ${calc.carNeed && calc.vehicleLines && calc.vehicleLines.length > 0 ? calc.vehicleLines.map(vl => `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #444; margin-bottom: 4px;">
            <span>• ${vl.vehicleName} · ${vl.serviceLabel}${vl.serviceType === 'tour' ? ' (' + vl.quantity + ' veh × ' + vl.days + 'd)' : ' (×' + vl.quantity + ')'}</span>
            <span>₹${(vl.lineTotal || 0).toLocaleString('en-IN')}</span>
          </div>
        `).join('') : ''}
        ${calc.breakfastNeed && calc.breakfastTotal > 0 ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #444; margin-bottom: 6px;">
            <span>${calc.breakfastBreakdownText}</span>
            <span>₹${calc.breakfastTotal.toLocaleString('en-IN')}</span>
          </div>` : ''}
        ${calc.candleNeed ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #444; margin-bottom: 6px;">
            <span>${calc.dinnerBreakdownText}</span>
            <span>₹${calc.dinnerTotal.toLocaleString('en-IN')}</span>
          </div>` : ''}
        ${calc.taxAmount > 0 ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #444; margin-bottom: 6px;">
            <span>${calc.taxBreakdownText}</span>
            <span>₹${calc.taxAmount.toLocaleString('en-IN')}</span>
          </div>` : ''}
      </div>

      <!-- MakeMyTrip Style Inclusions Block in Checkout Summary -->
      ${calc.inclusions && calc.inclusions.length ? `
        <div style="background: #E8F5E9; border: 1px solid #A5D6A7; border-radius: 8px; padding: 10px 12px; margin: 10px 0 12px;">
          <div style="font-size: 0.72rem; font-weight: 700; color: #1B5E20; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined" style="font-size: 15px; color: #2E7D32;">verified</span> Included in your stay:
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${calc.inclusions.filter(inc => {
              const txt = typeof inc === 'string' ? inc : inc.text;
              return !txt.toLowerCase().includes('breakfast');
            }).map((inc) => {
              const txt = typeof inc === 'string' ? inc : inc.text;
              return `<span style="display:inline-flex; align-items:center; gap:3px; background:#fff; border:1px solid #C8E6C9; padding:2px 8px; border-radius:12px; font-size:0.72rem; color:#2E7D32;"><span class="material-symbols-outlined" style="font-size:12px; color:#2E7D32;">check_circle</span> ${txt}</span>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <hr style="border: none; border-top: 1px dashed #DDD; margin: 12px 0;">
      <div style="display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 700; color: var(--ocean-blue); margin-bottom: 8px;">
        <span>Estimated Total</span>
        <span style="color: var(--champagne-gold); font-size: 1.25rem;">₹${calc.grandTotal.toLocaleString('en-IN')}</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
        <div style="background: rgba(255, 107, 94, 0.15); border: 1px solid var(--sunset-coral); padding: 8px 12px; border-radius: 8px;">
          <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: var(--sunset-coral);">Pay Now (20% Advance)</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #333;">₹${calc.payNow.toLocaleString('en-IN')}</div>
        </div>
        <div style="background: rgba(6, 182, 176, 0.15); border: 1px solid var(--turquoise); padding: 8px 12px; border-radius: 8px;">
          <div style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: var(--turquoise);">Pay at Hotel (80%)</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #333;">₹${calc.payAtHotel.toLocaleString('en-IN')}</div>
        </div>
      </div>
      <div style="font-size: 0.76rem; color: var(--sunset-coral); margin-top: 10px; font-weight: 600;">
        * ${hotelSettings.advancePolicyNote}
      </div>
    </div>
  `;

  modal.classList.add('open');
}

// Handle Reservation Form Submission
async function handleReservationSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  // Field-level error elements
  const nameError = document.getElementById('nameFieldError');
  const phoneError = document.getElementById('phoneFieldError');
  const emailError = document.getElementById('emailFieldError');
  const submitError = document.getElementById('checkoutFormErrorBanner');
  if (nameError) nameError.style.display = 'none';
  if (phoneError) phoneError.style.display = 'none';
  if (emailError) emailError.style.display = 'none';
  if (submitError) submitError.style.display = 'none';

  const guestNameInput = document.getElementById('guestNameInput');
  const guestPhoneInput = document.getElementById('guestPhoneInput');
  const guestEmailInput = document.getElementById('guestEmailInput');
  const guestSpecialRequests = document.getElementById('guestSpecialRequests');

  const guestName = guestNameInput?.value.trim() || '';
  const guestPhone = guestPhoneInput?.value.trim() || '';
  const guestEmail = guestEmailInput?.value.trim() || '';
  const specialRequests = guestSpecialRequests?.value.trim() || '';

  let hasError = false;

  if (guestName.length < 2) {
    if (nameError) {
      nameError.textContent = 'Please enter your full name (at least 2 characters).';
      nameError.style.display = 'block';
    }
    if (guestNameInput) guestNameInput.style.borderColor = '#EF4444';
    hasError = true;
  } else if (guestNameInput) {
    guestNameInput.style.borderColor = '';
  }

  const phoneDigits = guestPhone.replace(/\D/g, '');
  if (phoneDigits.length < 10) {
    if (phoneError) {
      phoneError.textContent = 'Please enter a valid phone number (at least 10 digits).';
      phoneError.style.display = 'block';
    }
    if (guestPhoneInput) guestPhoneInput.style.borderColor = '#EF4444';
    hasError = true;
  } else if (guestPhoneInput) {
    guestPhoneInput.style.borderColor = '';
  }

  if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
    if (emailError) {
      emailError.textContent = 'Please enter a valid email address.';
      emailError.style.display = 'block';
    }
    if (guestEmailInput) guestEmailInput.style.borderColor = '#EF4444';
    hasError = true;
  } else if (guestEmailInput) {
    guestEmailInput.style.borderColor = '';
  }

  if (hasError) return;

  const calc = calculateLivePrice();

  // Enforce Capacity Rules on submit
  const submitRoomObj = (hotelRooms || []).find(r => r.id === calc.roomId);
  const sMaxA = submitRoomObj ? (parseInt(submitRoomObj.maxAdults, 10) || 2) : 2;
  const sMaxC = submitRoomObj ? ((submitRoomObj.maxChildren !== undefined && submitRoomObj.maxChildren !== null) ? parseInt(submitRoomObj.maxChildren, 10) : 1) : 1;
  const maxAllowA = sMaxA * calc.roomsCount;
  const maxAllowC = sMaxC * calc.roomsCount;
  const reqA = parseInt(document.getElementById('bookAdults')?.value, 10) || 2;
  const reqC = parseInt(document.getElementById('bookChildren')?.value, 10) || 0;

  if (reqA > maxAllowA || reqC > maxAllowC) {
    const capMsg = (submitRoomObj && submitRoomObj.id === 'palm-grove-family-suite')
      ? `Each suite accommodates up to ${sMaxA} adults and ${sMaxC} children. Please add another room.`
      : `Each room accommodates up to 2 adults and 1 child. Please add another room.`;
    if (submitError) {
      submitError.textContent = capMsg;
      submitError.style.display = 'block';
    } else {
      alert(capMsg);
    }
    const alertBox = document.getElementById('roomCapacityAlert');
    if (alertBox) alertBox.style.display = 'flex';
    return;
  }

  const payload = {
    roomId: calc.roomId,
    checkIn: calc.checkIn,
    checkOut: calc.checkOut,
    adults: reqA,
    children: reqC,
    roomsCount: calc.roomsCount,
    clientTotal: calc.grandTotal,
    needCar: calc.carNeed,
    carCount: calc.carCount,
    vehicleType: calc.vehicleType,
    vehicleQuantity: calc.carCount,
    vehicleTripType: calc.vehicleTripType,
    clientTransportCost: calc.carTotal,
    vehicleLines: calc.vehicleLines || [],
    breakfast: calc.breakfastNeed,
    breakfastGuests: calc.breakfastCount,
    breakfastCount: calc.breakfastCount,
    breakfastPrice: calc.breakfastPrice,
    breakfastUnit: calc.breakfastUnit,
    breakfastTotal: calc.breakfastTotal,
    candlelightDinner: calc.candleNeed,
    dinnerSetup: calc.dinnerSetup,
    dinnerCount: calc.dinnerCount,
    dinnerOccasion: document.getElementById('dinnerOccasionSelect')?.value || 'Romantic Getaway',
    guestName,
    guestPhone,
    guestEmail,
    specialRequests
  };

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Securing Reservation...';

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success && data.booking) {
      document.getElementById('checkoutModal').classList.remove('open');
      renderBookingVoucher(data.booking);
      fetchAndApplyAvailability();
    } else {
      if (submitError) {
        submitError.textContent = data.message || 'Unable to complete reservation. Please try again.';
        submitError.style.display = 'block';
      } else {
        alert(data.message || 'Unable to complete reservation. Please try again.');
      }
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Confirm Reservation';
      fetchAndApplyAvailability();
    }
  } catch (err) {
    console.error('Booking submission error:', err);
    if (submitError) {
      submitError.textContent = 'Network error. Please try again.';
      submitError.style.display = 'block';
    } else {
      alert('Network error. Please try again.');
    }
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Confirm Reservation';
  }
}

// Render Printable/Downloadable Luxury Voucher
function renderBookingVoucher(booking) {
  const modal = document.getElementById('voucherModal');
  const body = document.getElementById('voucherModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    <div class="voucher-card" id="printableVoucher">
      <div class="voucher-header">
        <h2 style="font-family: var(--font-serif); font-size: 1.8rem; color: var(--ocean-blue); margin-bottom: 2px;">Coastal View</h2>
        <div style="font-size: 0.76rem; letter-spacing: 2px; text-transform: uppercase; color: var(--champagne-gold); margin-bottom: 6px;">Managed By Ani's</div>
        <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 6px;">
          <div class="voucher-ref" style="font-weight: 700; color: var(--ocean-blue); background: #E0F2FE; border-color: #BAE6FD;">
            INVOICE NO: ${booking.invoiceNumber || 'CV-2026-Pending'}
          </div>
          <div class="voucher-ref" style="background: rgba(7, 59, 76, 0.06);">
            BOOKING ID: ${booking.bookingId}
          </div>
        </div>
        <div style="margin-top: 4px;">
          ${booking.status === 'Confirmed' || booking.status === 'Checked-in'
            ? '<span style="display:inline-block; padding: 4px 12px; border-radius: 20px; background: #D1FAE5; color: #065F46; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.5px;">✓ ADVANCE PAID</span>'
            : '<span style="display:inline-block; padding: 4px 12px; border-radius: 20px; background: #FEF3C7; color: #92400E; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.5px;">⏳ PAYMENT PENDING</span>'
          }
        </div>
      </div>

      <div style="margin-bottom: 18px;">
        <div class="voucher-row"><span>Guest Name:</span> <strong>${booking.guestName}</strong></div>
        <div class="voucher-row"><span>Phone Number:</span> <strong>${booking.guestPhone}</strong></div>
        ${booking.guestEmail ? `<div class="voucher-row"><span>Email Address:</span> <strong>${booking.guestEmail}</strong></div>` : ''}
        <div class="voucher-row"><span>Suite Booked:</span> <strong>${booking.roomName} (${booking.roomsCount} room)</strong></div>
        <div class="voucher-row"><span>Included in Stay:</span> <strong style="color: #10B981;">AC, Free Wi-Fi, Smart TV, Pool access, Housekeeping, Hot water</strong></div>
        ${booking.breakfast ? `<div class="voucher-row"><span>Optional Breakfast:</span> <strong>Breakfast Add-on (${booking.breakfastUnit === 'per_room_per_day' ? (booking.roomsCount || 1) + ' room' : (booking.breakfastGuests || 2) + ' guest(s)'}, ${booking.nights} day(s) - ₹${(booking.breakfastTotal || 0).toLocaleString('en-IN')})</strong></div>` : ''}
        <div class="voucher-row"><span>Check-In:</span> <strong>${booking.checkIn} (from ${hotelSettings.checkInTime || '12:00 PM'})</strong></div>
        <div class="voucher-row"><span>Check-Out:</span> <strong>${booking.checkOut} (until ${hotelSettings.checkOutTime || '11:00 AM'})</strong></div>
        <div class="voucher-row"><span>Duration:</span> <strong>${booking.nights} night(s)</strong></div>
        ${booking.vehicleLines && booking.vehicleLines.length > 0 
          ? booking.vehicleLines.map(vl => `<div class="voucher-row"><span>Transport (${vl.vehicleName}):</span> <strong>${vl.serviceLabel || vl.serviceType} (×${vl.quantity}${vl.serviceType === 'tour' ? ', ' + (vl.days || 1) + 'd' : ''}) - ₹${(vl.lineTotal || 0).toLocaleString('en-IN')}${vl.pickupPoint ? ' | Pick: ' + vl.pickupPoint + (vl.pickupTime ? ' ' + vl.pickupTime : '') : ''}${vl.dropPoint ? ' | Drop: ' + vl.dropPoint + (vl.dropTime ? ' ' + vl.dropTime : '') : ''}</strong></div>`).join('')
          : (booking.needCar ? `<div class="voucher-row"><span>Private Transport:</span> <strong>${booking.vehicleName || 'Vehicle'} (${booking.carCount} vehicle, ${booking.nights} day(s))</strong></div>` : '')
        }
        ${booking.candlelightDinner ? `<div class="voucher-row"><span>Candlelight Dinner:</span> <strong>Yes (${booking.dinnerSetup} - ${booking.dinnerOccasion})</strong></div>` : ''}
      </div>

      <div style="background: #FFFFFF; border: 1px solid var(--champagne-gold); border-radius: 10px; padding: 14px 18px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>Total Booking Amount:</span> <strong>₹${booking.totalAmount.toLocaleString('en-IN')}</strong>
        </div>
        ${booking.breakfast ? `
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #555; margin-bottom: 4px;">
          <span>Breakfast Subtotal:</span> <strong>₹${(booking.breakfastTotal || 0).toLocaleString('en-IN')}</strong>
        </div>` : ''}
        ${booking.needCar ? `
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #555; margin-bottom: 4px;">
          <span>Transport Subtotal:</span> <strong>₹${(booking.carTotal || 0).toLocaleString('en-IN')}</strong>
        </div>` : ''}
        <div style="display: flex; justify-content: space-between; color: var(--sunset-coral); font-weight: 700; margin-bottom: 4px;">
          <span>20% Advance Due (Pay Now):</span> <span>₹${booking.payNowAdvance.toLocaleString('en-IN')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; color: var(--turquoise); font-weight: 700;">
          <span>80% Balance Payable at Hotel:</span> <span>₹${booking.payAtHotelBalance.toLocaleString('en-IN')}</span>
        </div>
        <div style="font-size: 0.72rem; color: var(--sunset-coral); margin-top: 6px;">
          * ${booking.advancePolicyNote}
        </div>
      </div>

      <div style="background: rgba(7, 59, 76, 0.05); border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; font-size: 0.8rem; color: #444;">
        <strong style="color: var(--ocean-blue);">To Complete 20% Advance Transfer:</strong><br>
        UPI ID: <strong style="color: var(--turquoise);">${hotelSettings.paymentUPI || 'coastalview@upi'}</strong><br>
        Bank Details: ${hotelSettings.paymentBank || 'Contact hotel for bank wire details'}<br>
        <em>Please send your transfer screenshot on WhatsApp to <strong>${hotelSettings.whatsapp || '+91 7812027551'}</strong> with Booking ID <strong>${booking.bookingId}</strong>.</em>
      </div>

      <div style="display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
        ${booking.invoiceToken ? `
          <a class="btn btn-gold" href="/api/invoices/public/download/${booking.invoiceToken}" target="_blank" download="Invoice-${booking.invoiceNumber || booking.bookingId}.pdf" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined">download</span> Download Invoice (PDF)
          </a>
          <button class="btn btn-outline-gold" onclick="window.open('/api/invoices/public/view/${booking.invoiceToken}', '_blank')">
            <span class="material-symbols-outlined">print</span> Print Invoice
          </button>
        ` : `
          <button class="btn btn-outline-gold" onclick="window.print()">
            <span class="material-symbols-outlined">print</span> Print Voucher
          </button>
        `}
        <button class="btn btn-outline-gold" onclick="document.getElementById('voucherModal').classList.remove('open')">
          Done
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
}


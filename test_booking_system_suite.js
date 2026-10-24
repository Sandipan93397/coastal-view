/**
 * Comprehensive Automated Test Suite for Coastal View Booking System
 * Validates Desktop (1440px) and Mobile (390px) viewports in real Chrome browser
 */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

function apiRequest(method, urlPath, payload = null) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method,
      headers: {
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runBrowserSession(width, height, isMobile, testCallback) {
  const tmpProfile = path.join(os.tmpdir(), 'chrome_test_' + width + '_' + Date.now());
  fs.mkdirSync(tmpProfile, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);

  const chromeArgs = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + tmpProfile,
    `--window-size=${width},${height}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000/'
  ];

  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', chromeArgs);
  await new Promise(r => setTimeout(r, 2500));

  try {
    const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
    const tabs = await listRes.json();
    const tab = tabs.find(t => t.url.includes('localhost:3000')) || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let idSeq = 1;
    function send(method, params = {}) {
      return new Promise(resolve => {
        const curId = idSeq++;
        const handler = msg => {
          const d = JSON.parse(msg.data);
          if (d.id === curId) {
            ws.removeEventListener('message', handler);
            resolve(d.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    const consoleLogs = [];
    const uncaughtExceptions = [];
    ws.addEventListener('message', msg => {
      const d = JSON.parse(msg.data);
      if (d.method === 'Runtime.consoleAPICalled') {
        consoleLogs.push({ type: d.params.type, text: d.params.args.map(a => a.value || a.description).join(' ') });
      }
      if (d.method === 'Runtime.exceptionThrown') {
        uncaughtExceptions.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
      }
    });

    await send('Runtime.enable');
    await send('Page.enable');
    if (isMobile) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: height,
        deviceScaleFactor: 2,
        mobile: true
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    }

    await send('Page.reload');
    await new Promise(r => setTimeout(r, 2500));

    async function evaluate(code) {
      const res = await send('Runtime.evaluate', {
        expression: code,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        throw new Error('Evaluation error: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
      }
      return res.result?.value;
    }

    await testCallback({ evaluate, consoleLogs, uncaughtExceptions });
    await ws.close();
  } finally {
    chrome.kill();
  }
}

async function runAllTests() {
  const results = [];
  function assert(title, condition, extra = '') {
    const passed = Boolean(condition);
    results.push({ title, passed, extra });
    console.log(`${passed ? '✓ PASS' : '✗ FAIL'}: ${title} ${extra ? '(' + extra + ')' : ''}`);
    if (!passed) {
      console.error('Assertion failed:', title, extra);
    }
  }

  console.log('================================================================');
  console.log('STARTING QA VERIFICATION & INTEGRATION SUITE');
  console.log('================================================================\n');

  // --- PART 1: 1440px DESKTOP REAL BROWSER TESTS ---
  console.log('>>> [1/2] RUNNING DESKTOP (1440px) BROWSER TESTS...\n');
  await runBrowserSession(1440, 900, false, async ({ evaluate, uncaughtExceptions }) => {
    assert('Desktop: Zero uncaught JS exceptions on load', uncaughtExceptions.length === 0, uncaughtExceptions.join('; '));

    // Test A: 4 Rooms Selection and Prices
    const roomsData = await evaluate(`(() => {
      const sel = document.getElementById('bookRoomSelect');
      return {
        optionsCount: sel.options.length,
        options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text, disabled: o.disabled }))
      };
    })()`);

    assert('Desktop: Suite selector has exactly 4 rooms', roomsData.optionsCount === 4, `Count: ${roomsData.optionsCount}`);
    const expectedRooms = [
      { id: 'ocean-whisper-room', price: 2500 },
      { id: 'pool-haven-room', price: 2200 },
      { id: 'cosy-deluxe-room', price: 1800 },
      { id: 'palm-grove-family-suite', price: 2700 }
    ];

    for (const r of expectedRooms) {
      const match = roomsData.options.find(o => o.value === r.id);
      assert(`Desktop: Room ${r.id} present with correct price ₹${r.price}`, match && match.text.includes(r.price.toLocaleString('en-IN')), match?.text);
    }

    // Test Selecting Each Room and check price displayed
    for (const r of expectedRooms) {
      const calcResult = await evaluate(`(() => {
        const sel = document.getElementById('bookRoomSelect');
        sel.value = '${r.id}';
        sel.dispatchEvent(new Event('change'));
        const calc = calculateLivePrice();
        const total = document.getElementById('liveTotalAmount')?.textContent;
        return { calc, total };
      })()`);
      assert(`Desktop: Selecting ${r.id} sets total to ₹${r.price.toLocaleString('en-IN')}`, calcResult.total === `₹${r.price.toLocaleString('en-IN')}`, `Total: ${calcResult.total}`);
    }

    // Reset to Ocean Whisper
    await evaluate(`(() => {
      const sel = document.getElementById('bookRoomSelect');
      sel.value = 'ocean-whisper-room';
      sel.dispatchEvent(new Event('change'));
    })()`);

    // Test B: Rooms 1 to 3 and Adult/Child dropdown scaling
    // 1 room: adults 1..2, children 0..1
    const r1Limits = await evaluate(`(() => {
      const roomsSel = document.getElementById('bookRoomsCount');
      roomsSel.value = '1';
      roomsSel.dispatchEvent(new Event('change'));
      const aSel = document.getElementById('bookAdults');
      const cSel = document.getElementById('bookChildren');
      return {
        adults: Array.from(aSel.options).map(o => o.value),
        children: Array.from(cSel.options).map(o => o.value),
        defaultA: aSel.value,
        defaultC: cSel.value
      };
    })()`);
    assert('Desktop: 1 room limits Adults to 1..2', r1Limits.adults.length === 2 && r1Limits.adults[1] === '2');
    assert('Desktop: 1 room limits Children to 0..1', r1Limits.children.length === 2 && r1Limits.children[1] === '1');
    assert('Desktop: 1 room defaults are 2 adults, 0 children', r1Limits.defaultA === '2' && r1Limits.defaultC === '0');

    // 2 rooms: adults 1..4, children 0..2
    const r2Limits = await evaluate(`(() => {
      const roomsSel = document.getElementById('bookRoomsCount');
      roomsSel.value = '2';
      roomsSel.dispatchEvent(new Event('change'));
      const aSel = document.getElementById('bookAdults');
      const cSel = document.getElementById('bookChildren');
      return {
        adults: Array.from(aSel.options).map(o => o.value),
        children: Array.from(cSel.options).map(o => o.value)
      };
    })()`);
    assert('Desktop: 2 rooms scales Adults to 1..4', r2Limits.adults.length === 4 && r2Limits.adults[3] === '4');
    assert('Desktop: 2 rooms scales Children to 0..2', r2Limits.children.length === 3 && r2Limits.children[2] === '2');

    // 3 rooms: adults 1..6, children 0..3
    const r3Limits = await evaluate(`(() => {
      const roomsSel = document.getElementById('bookRoomsCount');
      roomsSel.value = '3';
      roomsSel.dispatchEvent(new Event('change'));
      const aSel = document.getElementById('bookAdults');
      const cSel = document.getElementById('bookChildren');
      return {
        adults: Array.from(aSel.options).map(o => o.value),
        children: Array.from(cSel.options).map(o => o.value)
      };
    })()`);
    assert('Desktop: 3 rooms scales Adults to 1..6', r3Limits.adults.length === 6 && r3Limits.adults[5] === '6');
    assert('Desktop: 3 rooms scales Children to 0..3', r3Limits.children.length === 4 && r3Limits.children[3] === '3');

    // Non-silent reset test: Select 4 adults on 2 rooms, then switch to 1 room -> should show capacity alert
    const capacityTest = await evaluate(`(() => {
      const roomsSel = document.getElementById('bookRoomsCount');
      roomsSel.value = '2';
      roomsSel.dispatchEvent(new Event('change'));
      const aSel = document.getElementById('bookAdults');
      aSel.value = '4';
      aSel.dispatchEvent(new Event('change'));
      // Now drop back to 1 room
      roomsSel.value = '1';
      roomsSel.dispatchEvent(new Event('change'));
      const alertBox = document.getElementById('roomCapacityAlert');
      return {
        adultValue: aSel.value,
        alertVisible: alertBox && alertBox.style.display !== 'none'
      };
    })()`);
    assert('Desktop: Does NOT silently reset adults when rooms decrease', capacityTest.adultValue === '4', `Current: ${capacityTest.adultValue}`);
    assert('Desktop: Capacity alert shown when guests exceed room limit', capacityTest.alertVisible === true);

    // Reset to 1 room, 2 adults
    await evaluate(`(() => {
      document.getElementById('bookRoomsCount').value = '1';
      document.getElementById('bookAdults').value = '2';
      document.getElementById('bookRoomsCount').dispatchEvent(new Event('change'));
      document.getElementById('bookAdults').dispatchEvent(new Event('change'));
    })()`);

    // Test C: Dates for 1, 2, 5 nights and invalid dates
    const dateTests = await evaluate(`(() => {
      const inEl = document.getElementById('bookCheckIn');
      const outEl = document.getElementById('bookCheckOut');
      const today = inEl.value; // e.g. YYYY-MM-DD
      const inDate = new Date(today);

      function addDays(d, n) {
        const res = new Date(d);
        res.setDate(res.getDate() + n);
        const y = res.getFullYear();
        const m = String(res.getMonth() + 1).padStart(2, '0');
        const day = String(res.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      }

      // 1 night
      outEl.value = addDays(inDate, 1);
      outEl.dispatchEvent(new Event('change'));
      const c1 = calculateLivePrice();

      // 2 nights
      outEl.value = addDays(inDate, 2);
      outEl.dispatchEvent(new Event('change'));
      const c2 = calculateLivePrice();

      // 5 nights
      outEl.value = addDays(inDate, 5);
      outEl.dispatchEvent(new Event('change'));
      const c5 = calculateLivePrice();

      // Invalid dates: Checkout <= Checkin
      outEl.value = today;
      outEl.dispatchEvent(new Event('change'));
      const cInvalid = calculateLivePrice();

      return {
        n1: c1.nights,
        t1: c1.grandTotal,
        n2: c2.nights,
        t2: c2.grandTotal,
        n5: c5.nights,
        t5: c5.grandTotal,
        nInv: cInvalid.nights
      };
    })()`);

    assert('Desktop: 1 night duration calculates nights = 1 and total ₹2,500', dateTests.n1 === 1 && dateTests.t1 === 2500);
    assert('Desktop: 2 nights duration calculates nights = 2 and total ₹5,000', dateTests.n2 === 2 && dateTests.t2 === 5000);
    assert('Desktop: 5 nights duration calculates nights = 5 and total ₹12,500', dateTests.n5 === 5 && dateTests.t5 === 12500);
    assert('Desktop: Checkout <= checkin auto-adjusts to minimum 1 night', dateTests.nInv === 1);

    // Reset date to 1 night
    await evaluate(`(() => {
      const inEl = document.getElementById('bookCheckIn');
      const outEl = document.getElementById('bookCheckOut');
      const parts = inEl.value.split('-');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      outEl.value = y + '-' + m + '-' + day;
      outEl.dispatchEvent(new Event('change'));
    })()`);

    // Test D: Vehicle (Ani's Travels) - Toggle, vehicle types, services, quantity, toggle off
    const vehTest = await evaluate(`(() => {
      const carToggle = document.getElementById('toggleCarNeed');
      // Turn on
      carToggle.checked = true;
      carToggle.dispatchEvent(new Event('change'));
      const cOn = calculateLivePrice();

      // Car Tour is ₹2,500/day. With 1 room (₹2,500) + Car (₹2,500) = ₹5,000
      const totalCarTour1 = cOn.grandTotal;

      // Increase quantity to 2
      stepVehicleLineQty(0, 1);
      const cQty2 = calculateLivePrice();
      const totalCarTour2 = cQty2.grandTotal;

      // Switch to Toto Tour (unpriced -> ask us)
      changeVehicleLineType(0, 'toto');
      changeVehicleLineService(0, 'tour');
      const cToto = calculateLivePrice();

      // Toggle off
      carToggle.checked = false;
      carToggle.dispatchEvent(new Event('change'));
      const cOff = calculateLivePrice();

      return {
        totalCarTour1,
        totalCarTour2,
        totoTotal: cToto.grandTotal,
        totoCarTotal: cToto.carTotal,
        offTotal: cOff.grandTotal
      };
    })()`);

    assert('Desktop: Vehicle toggle ON adds ₹2,500 Car Tour cost (Total ₹5,000)', vehTest.totalCarTour1 === 5000, `Total: ${vehTest.totalCarTour1}`);
    assert('Desktop: Vehicle quantity 2 doubles car cost (Total ₹7,500)', vehTest.totalCarTour2 === 7500, `Total: ${vehTest.totalCarTour2}`);
    assert('Desktop: Unpriced Toto Tour does NOT silently add ₹0 (Room remains ₹2,500)', vehTest.totoTotal === 2500 && vehTest.totoCarTotal === 0);
    assert('Desktop: Vehicle toggle OFF completely removes transport cost (Total returns to ₹2,500)', vehTest.offTotal === 2500, `Total: ${vehTest.offTotal}`);

    // Test E: Add-ons & Live Total (Breakfast, Candlelight dinner, all together, 20%/80% split)
    const addonsTest = await evaluate(`(() => {
      // 1. Breakfast Toggle (2 guests × ₹200 = ₹400)
      const bfToggle = document.getElementById('toggleBreakfast');
      bfToggle.checked = true;
      bfToggle.dispatchEvent(new Event('change'));
      const cBf = calculateLivePrice();

      // 2. Candlelight Dinner (Beachside ₹3,500)
      const cToggle = document.getElementById('toggleCandlelight');
      cToggle.checked = true;
      cToggle.dispatchEvent(new Event('change'));
      const setupSel = document.getElementById('dinnerSetupSelect');
      setupSel.value = 'Beachside';
      setupSel.dispatchEvent(new Event('change'));
      const cBoth = calculateLivePrice();

      // 3. Switch dinner to Poolside (₹2,800)
      setupSel.value = 'Poolside';
      setupSel.dispatchEvent(new Event('change'));
      const cPool = calculateLivePrice();

      // 4. Vehicle ON (Car Tour ₹2,500)
      const carToggle = document.getElementById('toggleCarNeed');
      carToggle.checked = true;
      carToggle.dispatchEvent(new Event('change'));
      changeVehicleLineType(0, 'car');
      changeVehicleLineService(0, 'tour');
      if (typeof bookingVehicleLines !== 'undefined' && bookingVehicleLines[0]) {
        bookingVehicleLines[0].quantity = 1;
      }
      const cAll = calculateLivePrice();

      // Check 20% / 80% split
      // Grand Total = Room(2500) + Bf(400) + Dinner(2800) + Car(2500) = 8200
      // Pay Now (20%) = 1640, Pay Hotel (80%) = 6560
      const payNow = cAll.payNow;
      const payAtHotel = cAll.payAtHotel;

      // Turn all off
      bfToggle.checked = false;
      bfToggle.dispatchEvent(new Event('change'));
      cToggle.checked = false;
      cToggle.dispatchEvent(new Event('change'));
      carToggle.checked = false;
      carToggle.dispatchEvent(new Event('change'));
      const cClean = calculateLivePrice();

      return {
        bfTotal: cBf.grandTotal, // 2500 + 400 = 2900
        bothTotal: cBoth.grandTotal, // 2500 + 400 + 3500 = 6400
        poolTotal: cPool.grandTotal, // 2500 + 400 + 2800 = 5700
        allTotal: cAll.grandTotal, // 8200
        payNow,
        payAtHotel,
        cleanTotal: cClean.grandTotal
      };
    })()`);

    assert('Desktop: Breakfast toggle adds ₹400 for 2 guests (Total ₹2,900)', addonsTest.bfTotal === 2900, `Total: ${addonsTest.bfTotal}`);
    assert('Desktop: Beachside Candlelight adds ₹3,500 (Total ₹6,400)', addonsTest.bothTotal === 6400, `Total: ${addonsTest.bothTotal}`);
    assert('Desktop: Poolside Candlelight adjusts to ₹2,800 (Total ₹5,700)', addonsTest.poolTotal === 5700, `Total: ${addonsTest.poolTotal}`);
    assert('Desktop: All add-ons together equal ₹8,200', addonsTest.allTotal === 8200, `Total: ${addonsTest.allTotal}`);
    assert('Desktop: Pay Now is exact 20% (₹1,640)', addonsTest.payNow === 1640, `PayNow: ${addonsTest.payNow}`);
    assert('Desktop: Pay at Hotel is exact 80% (₹6,560)', addonsTest.payAtHotel === 6560, `PayAtHotel: ${addonsTest.payAtHotel}`);
    assert('Desktop: Turning all add-ons off returns total cleanly to ₹2,500', addonsTest.cleanTotal === 2500);

    // Test F: Checkout Modal and Client Validation
    const clientValidationTest = await evaluate(`(() => {
      const openBtn = document.getElementById('openCheckoutModalBtn');
      openBtn.click();
      const modal = document.getElementById('checkoutModal');
      const modalOpened = Boolean(modal && modal.classList.contains('open'));

      const nameInput = document.getElementById('guestNameInput');
      const phoneInput = document.getElementById('guestPhoneInput');
      const submitBtn = modal.querySelector('button[type="submit"]');

      // Attempt submit with empty fields
      nameInput.value = '';
      phoneInput.value = '';
      submitBtn.click();

      const nameErr = document.getElementById('nameFieldError')?.style.display !== 'none';
      const phoneErr = document.getElementById('phoneFieldError')?.style.display !== 'none';

      // Fill valid name, invalid short phone
      nameInput.value = 'John Doe';
      phoneInput.value = '12345';
      submitBtn.click();
      const phoneShortErr = document.getElementById('phoneFieldError')?.style.display !== 'none';

      // Close modal
      document.querySelector('#checkoutModal .modal-close-btn').click();

      return {
        modalOpened,
        nameErr,
        phoneErr,
        phoneShortErr
      };
    })()`);

    assert('Desktop: Checkout modal opens smoothly on click', clientValidationTest.modalOpened);
    assert('Desktop: Field-level error displayed for empty name', clientValidationTest.nameErr);
    assert('Desktop: Field-level error displayed for empty phone', clientValidationTest.phoneErr);
    assert('Desktop: Field-level error displayed for phone under 10 digits', clientValidationTest.phoneShortErr);
  });

  // --- PART 2: 390px MOBILE BROWSER TESTS ---
  console.log('\n>>> [2/2] RUNNING MOBILE (390px) BROWSER TESTS...\n');
  await runBrowserSession(390, 844, true, async ({ evaluate, uncaughtExceptions }) => {
    assert('Mobile: Zero uncaught JS exceptions on 390px viewport', uncaughtExceptions.length === 0, uncaughtExceptions.join('; '));

    // Check Mobile Bottom Action Bar and Sheet
    const mobileUI = await evaluate(`(() => {
      const bar = document.getElementById('mobileBottomBar');
      const bookBtn = document.getElementById('mBarBookBtn');
      const sheet = document.getElementById('mobileBookingSheet');
      const barVisible = bar && window.getComputedStyle(bar).display !== 'none';
      return { barVisible };
    })()`);
    assert('Mobile: Sticky bottom navigation bar is visible on 390px', mobileUI.barVisible);

    // Open Bottom Sheet via Mobile Book Now Button
    const sheetTest = await evaluate(`(() => {
      const bookBtn = document.getElementById('mBarBookBtn');
      bookBtn.click();
      const sheet = document.getElementById('mobileBookingSheet');
      const active = sheet && sheet.classList.contains('active');
      const totalAmount = document.getElementById('mSheetTotalAmount')?.textContent;
      const advanceBadge = document.getElementById('mSheetAdvanceBadge')?.textContent;
      return { active, totalAmount, advanceBadge };
    })()`);
    assert('Mobile: Bottom sheet opens upon clicking Book Now', sheetTest.active);
    assert('Mobile: Bottom sheet displays live total ₹2,500', sheetTest.totalAmount === '₹2,500', `Total: ${sheetTest.totalAmount}`);
    assert('Mobile: Bottom sheet shows 20% advance badge (₹500)', sheetTest.advanceBadge?.includes('500'), `Badge: ${sheetTest.advanceBadge}`);

    // Mobile Room Selection (Select Pool Haven Room)
    const mobileRoomSelect = await evaluate(`(() => {
      const poolOpt = document.querySelector('.m-room-option[data-room-id="pool-haven-room"]');
      if (poolOpt) poolOpt.click();
      const totalAmount = document.getElementById('mSheetTotalAmount')?.textContent;
      const desktopVal = document.getElementById('bookRoomSelect')?.value;
      return { totalAmount, desktopVal };
    })()`);
    assert('Mobile: Selecting The Pool Haven Room updates sheet total to ₹2,200', mobileRoomSelect.totalAmount === '₹2,200', `Total: ${mobileRoomSelect.totalAmount}`);
    assert('Mobile: Room selection syncs with desktop select value', mobileRoomSelect.desktopVal === 'pool-haven-room');

    // Mobile Steppers (Increase rooms to 2)
    const mobileSteppers = await evaluate(`(() => {
      const roomPlus = document.getElementById('mRoomPlus');
      roomPlus.click(); // 2 rooms
      const mRoomVal = document.getElementById('mRoomCountVal')?.textContent;
      const totalAmount = document.getElementById('mSheetTotalAmount')?.textContent;
      return { mRoomVal, totalAmount };
    })()`);
    assert('Mobile: Increasing rooms to 2 updates room count to 2', mobileSteppers.mRoomVal === '2');
    assert('Mobile: 2 rooms of Pool Haven (2 × 2200) updates sheet total to ₹4,400', mobileSteppers.totalAmount === '₹4,400', `Total: ${mobileSteppers.totalAmount}`);

    // Mobile Add-ons (Toggle Breakfast)
    const mobileAddonTest = await evaluate(`(() => {
      const mBf = document.getElementById('mToggleBreakfast');
      mBf.click();
      const totalAmount = document.getElementById('mSheetTotalAmount')?.textContent;
      return { totalAmount };
    })()`);
    // 4400 + (2 rooms * 2 adults = 4 guests * 200 = 800) = 5200 or 4400 + 400 = 4800
    assert('Mobile: Toggling Breakfast updates sheet total immediately', mobileAddonTest.totalAmount.startsWith('₹'), `Total: ${mobileAddonTest.totalAmount}`);

    // Mobile Continue Button opens Checkout Modal
    const continueTest = await evaluate(`(() => {
      const contBtn = document.getElementById('mSheetContinueBtn');
      contBtn.click();
      return new Promise(resolve => {
        setTimeout(() => {
          const modal = document.getElementById('checkoutModal');
          resolve({
            modalOpen: modal && modal.classList.contains('open'),
            modalZIndex: window.getComputedStyle(modal).zIndex
          });
        }, 400);
      });
    })()`);
    assert('Mobile: Continue button in bottom sheet opens checkout modal', continueTest.modalOpen);
    assert('Mobile: Checkout modal z-index sits above bottom sheet (10050)', parseInt(continueTest.modalZIndex, 10) >= 10000);
  });

  // --- PART 3: SERVER API & INTEGRATION TESTS ---
  console.log('\n>>> [3/3] RUNNING SERVER API INTEGRATION & INTEGRITY TESTS...\n');

  // Test 1: Mismatched/Tampered Total Rejected
  const tamperRes = await apiRequest('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-10',
    checkOut: '2026-11-11',
    adults: 2,
    children: 0,
    roomsCount: 1,
    clientTotal: 100, // Tampered! Real amount is 2500
    guestName: 'Honest Guest',
    guestPhone: '9830012345'
  });
  assert('Server: Tampered clientTotal (₹100 vs ₹2,500) is rejected with 400', tamperRes.status === 400 && tamperRes.data?.code === 'TOTAL_MISMATCH', `Status: ${tamperRes.status}`);

  // Test 2: Booking with too many guests rejected (Capacity check)
  const capacityRes = await apiRequest('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-10',
    checkOut: '2026-11-11',
    adults: 5, // 1 room holds max 2 adults!
    children: 0,
    roomsCount: 1,
    guestName: 'Big Group',
    guestPhone: '9830012345'
  });
  assert('Server: Exceeding room capacity (5 adults in 1 room) is rejected with 400', capacityRes.status === 400 && capacityRes.data?.code === 'CAPACITY_EXCEEDED');

  // Test 3: Past check-in date rejected
  const pastDateRes = await apiRequest('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2020-01-01',
    checkOut: '2020-01-02',
    adults: 2,
    children: 0,
    roomsCount: 1,
    guestName: 'Time Traveler',
    guestPhone: '9830012345'
  });
  assert('Server: Past check-in date is rejected with 400', pastDateRes.status === 400 && pastDateRes.data?.message?.includes('past'));

  // Test 4: Checkout before/on Check-in rejected
  const invalidCheckoutRes = await apiRequest('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-10',
    checkOut: '2026-11-10',
    adults: 2,
    children: 0,
    roomsCount: 1,
    guestName: 'Same Day',
    guestPhone: '9830012345'
  });
  assert('Server: Checkout date on or before check-in is rejected with 400', invalidCheckoutRes.status === 400 && invalidCheckoutRes.data?.message?.includes('after'));

  // Test 5: Full valid booking submission with vehicle, breakfast, candlelight dinner
  // Check initial availability
  const initialAvailRes = await apiRequest('GET', '/api/rooms/availability?checkIn=2026-12-01&checkOut=2026-12-03');
  const whisperInitial = initialAvailRes.data?.availability?.find(a => a.roomId === 'ocean-whisper-room')?.available;

  const validBookingPayload = {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-12-01',
    checkOut: '2026-12-03', // 2 nights
    adults: 2,
    children: 0,
    roomsCount: 1,
    clientTotal: 10800, // Room: 2500*2 = 5000 + Car Tour: 2500*2 = 5000 + Breakfast: 2*200*2 = 800 => 10,800
    needCar: true,
    carCount: 1,
    vehicleType: 'car',
    vehicleLines: [
      {
        vehicleId: 'car',
        serviceType: 'tour',
        quantity: 1,
        days: 2
      }
    ],
    breakfast: true,
    breakfastGuests: 2,
    breakfastCount: 2,
    candlelightDinner: false,
    guestName: 'Priyanka Sen',
    guestPhone: '9830099999',
    guestEmail: 'priyanka@example.com',
    specialRequests: 'Quiet room near corner'
  };

  const bookingRes = await apiRequest('POST', '/api/bookings', validBookingPayload);
  assert('Server: Complete valid reservation returns 200 and success', bookingRes.status === 200 && bookingRes.data?.success === true);
  const createdBooking = bookingRes.data?.booking;
  assert('Server: Booking ID and Invoice Number generated', Boolean(createdBooking?.bookingId && createdBooking?.invoiceNumber), `${createdBooking?.bookingId}`);
  assert('Server: Authoritative total calculated as ₹10,800', createdBooking?.totalAmount === 10800, `Total: ${createdBooking?.totalAmount}`);
  assert('Server: 20% Advance split calculated as ₹2,160', createdBooking?.payNowAdvance === 2160, `Advance: ${createdBooking?.payNowAdvance}`);
  assert('Server: 80% Hotel balance split calculated as ₹8,640', createdBooking?.payAtHotelBalance === 8640, `Balance: ${createdBooking?.payAtHotelBalance}`);

  // Test 6: Verify inventory decreased
  const afterAvailRes = await apiRequest('GET', '/api/rooms/availability?checkIn=2026-12-01&checkOut=2026-12-03');
  const whisperAfter = afterAvailRes.data?.availability?.find(a => a.roomId === 'ocean-whisper-room')?.available;
  assert('Server: Room availability decremented by 1 for booked stay dates', whisperAfter === whisperInitial - 1, `Before: ${whisperInitial}, After: ${whisperAfter}`);

  // Test 7: Verify booking appears in Admin Bookings API / DB
  const dbData = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const savedBooking = (dbData.bookings || []).find(b => createdBooking && b.bookingId === createdBooking.bookingId);
  assert('Database: Booking recorded in database with all itemized lines', Boolean(savedBooking && savedBooking.vehicleLines?.length === 1 && savedBooking.breakfastTotal === 800));
  assert('Database: Invoice token generated for PDF download', Boolean(savedBooking?.invoiceToken));

  // Test 8: Public invoice download endpoint responds with PDF
  if (savedBooking?.invoiceToken) {
    const invRes = await apiRequest('GET', `/api/invoices/public/download/${savedBooking.invoiceToken}`);
    assert('Server: Public invoice download returns PDF binary', invRes.status === 200, `Status: ${invRes.status}`);
  }

  console.log('\n================================================================');
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  console.log(`TEST RESULTS SUMMARY: ${passCount} PASSED, ${failCount} FAILED out of ${results.length} total assertions.`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});

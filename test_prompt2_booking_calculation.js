const http = require('http');
const fs = require('fs');
const path = require('path');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function post(endpoint, data, token = null) {
  const postData = JSON.stringify(data);
  return request({
    hostname: 'localhost',
    port: 3000,
    path: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  }, data);
}

function get(endpoint, token = null) {
  return request({
    hostname: 'localhost',
    port: 3000,
    path: endpoint,
    method: 'GET',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  });
}

async function runAllTests() {
  console.log('================================================================');
  console.log('   PROMPT 2: BOOKING TOTAL CALCULATION & BREAKDOWN TEST SUITE   ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // --- PART 1: TEST SCENARIOS FROM PROMPT 2 VIA SERVER API ---

  // Admin login to verify settings & email
  const loginRes = await post('/api/auth/login', { username: 'admin', password: 'CoastalAdmin@2026' });
  assert(loginRes.data.success, 'Super Admin logged in successfully');
  const token = loginRes.data.token;

  // Ensure tax is not enabled by default as per prompt
  await post('/api/settings', { enableTax: false, taxPercentage: 12 }, token);
  const settingsRes = await get('/api/settings');
  assert(settingsRes.data.settings.enableTax === false, 'Admin tax setting verified as OFF');

  // Generate dynamic future dates so double booking doesn't collide
  const baseDate = Date.now() + 50000000000 + Math.floor(Math.random() * 50000000000);
  function makeDates(daysStay, offsetDays = 0) {
    const inD = new Date(baseDate + offsetDays * 86400000);
    const outD = new Date(baseDate + (offsetDays + daysStay) * 86400000);
    return {
      checkIn: inD.toISOString().split('T')[0],
      checkOut: outD.toISOString().split('T')[0]
    };
  }

  // TEST SCENARIO A: 1 night room only
  console.log('\n--- SCENARIO A: 1 night room only ---');
  const datesA = makeDates(1, 10);
  const resA = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: datesA.checkIn,
    checkOut: datesA.checkOut,
    roomsCount: 1,
    needCar: false,
    candlelightDinner: false,
    guestName: 'Ananya Roy',
    guestPhone: '+91 98300 11111',
    guestEmail: 'ananya.roy@example.com',
    clientTotal: 999999 // Must be IGNORED by server!
  });

  assert(resA.status === 200 && resA.data.success, 'Scenario A booking created successfully');
  const bA = resA.data.booking;
  assert(bA.roomSubtotal === 2500, `Scenario A room cost is ₹2,500 (actual: ₹${bA.roomSubtotal})`);
  assert(bA.carTotal === 0, `Scenario A transport cost is ₹0 (actual: ₹${bA.carTotal})`);
  assert(bA.dinnerTotal === 0, `Scenario A dinner cost is ₹0 (actual: ₹${bA.dinnerTotal})`);
  assert(bA.totalAmount === 2500, `Scenario A Estimated Total is ₹2,500 (actual: ₹${bA.totalAmount})`);
  assert(bA.payNowAdvance === 500, `Scenario A Pay Now (20%) is ₹500 (actual: ₹${bA.payNowAdvance})`);
  assert(bA.payAtHotelBalance === 2000, `Scenario A Pay at Hotel (80%) is ₹2,000 (actual: ₹${bA.payAtHotelBalance})`);
  assert(bA.breakdown && bA.breakdown.lines.length === 1, 'Scenario A breakdown has only 1 line');
  assert(bA.breakdown.lines[0].includes('Room: ₹2,500 × 1 night × 1 room'), `Scenario A breakdown line: "${bA.breakdown.lines[0]}"`);

  // TEST SCENARIO B: 2 nights + Toto
  console.log('\n--- SCENARIO B: 2 nights + Toto ---');
  const datesB = makeDates(2, 20);
  const resB = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: datesB.checkIn,
    checkOut: datesB.checkOut,
    roomsCount: 1,
    needCar: true,
    vehicleType: 'toto',
    carCount: 1,
    candlelightDinner: false,
    guestName: 'Debashis Mukherjee',
    guestPhone: '+91 98300 22222',
    guestEmail: 'debashis@example.com',
    clientTotal: 10 // Must be IGNORED by server!
  });

  assert(resB.status === 200 && resB.data.success, 'Scenario B booking created successfully');
  const bB = resB.data.booking;
  // Room: 2500 * 2 * 1 = 5000
  // Toto: 800 * 1 * 2 = 1600
  // Total = 6600
  assert(bB.roomSubtotal === 5000, `Scenario B room cost is ₹5,000 (actual: ₹${bB.roomSubtotal})`);
  assert(bB.carTotal === 1600, `Scenario B Toto transport cost is ₹1,600 (actual: ₹${bB.carTotal})`);
  assert(bB.dinnerTotal === 0, `Scenario B dinner cost is ₹0 (actual: ₹${bB.dinnerTotal})`);
  assert(bB.totalAmount === 6600, `Scenario B Estimated Total is ₹6,600 (actual: ₹${bB.totalAmount})`);
  assert(bB.payNowAdvance === 1320, `Scenario B Pay Now (20%) is ₹1,320 (actual: ₹${bB.payNowAdvance})`);
  assert(bB.payAtHotelBalance === 5280, `Scenario B Pay at Hotel (80%) is ₹5,280 (actual: ₹${bB.payAtHotelBalance})`);
  assert(bB.breakdown && bB.breakdown.lines.length === 2, 'Scenario B breakdown has exactly 2 lines');
  assert(bB.breakdown.lines[0].includes('Room: ₹2,500 × 2 nights × 1 room'), `Scenario B room line: "${bB.breakdown.lines[0]}"`);
  assert(bB.breakdown.lines[1].includes('Toto × 1 × 2 days'), `Scenario B transport line: "${bB.breakdown.lines[1]}"`);

  // TEST SCENARIO C: 2 rooms + car + candlelight
  console.log('\n--- SCENARIO C: 2 rooms + car + candlelight ---');
  const datesC = makeDates(2, 30);
  const resC = await post('/api/bookings', {
    roomId: 'palm-grove-family-suite',
    checkIn: datesC.checkIn,
    checkOut: datesC.checkOut,
    roomsCount: 2,
    needCar: true,
    vehicleType: 'car',
    carCount: 1,
    candlelightDinner: true,
    dinnerSetup: 'Beachside',
    dinnerCount: 1,
    guestName: 'Subhasish Ghosh',
    guestPhone: '+91 98300 33333',
    guestEmail: 'subhasish@example.com'
  });

  assert(resC.status === 200 && resC.data.success, 'Scenario C booking created successfully');
  const bC = resC.data.booking;
  // Room: 2700 * 2 nights * 2 rooms = 10800
  // Car: 2500 * 1 car * 2 days = 5000
  // Candlelight Beachside: 3500
  // Total = 10800 + 5000 + 3500 = 19300
  // 20% = 3860, 80% = 15440
  assert(bC.roomSubtotal === 10800, `Scenario C room cost is ₹10,800 (actual: ₹${bC.roomSubtotal})`);
  assert(bC.carTotal === 5000, `Scenario C Car transport cost is ₹5,000 (actual: ₹${bC.carTotal})`);
  assert(bC.dinnerTotal === 3500, `Scenario C Candlelight cost is ₹3,500 (actual: ₹${bC.dinnerTotal})`);
  assert(bC.totalAmount === 19300, `Scenario C Estimated Total is ₹19,300 (actual: ₹${bC.totalAmount})`);
  assert(bC.payNowAdvance === 3860, `Scenario C Pay Now (20%) is ₹3,860 (actual: ₹${bC.payNowAdvance})`);
  assert(bC.payAtHotelBalance === 15440, `Scenario C Pay at Hotel (80%) is ₹15,440 (actual: ₹${bC.payAtHotelBalance})`);
  assert(bC.breakdown && bC.breakdown.lines.length === 3, 'Scenario C breakdown has exactly 3 lines');
  assert(bC.breakdown.lines[0].includes('Room: ₹2,700 × 2 nights × 2 rooms'), `Scenario C room line: "${bC.breakdown.lines[0]}"`);
  assert(bC.breakdown.lines[1].includes('Car × 1 × 2 days'), `Scenario C transport line: "${bC.breakdown.lines[1]}"`);
  assert(bC.breakdown.lines[2].includes('Candlelight dinner'), `Scenario C dinner line: "${bC.breakdown.lines[2]}"`);

  // TEST SCENARIO D: Turning options on and off
  console.log('\n--- SCENARIO D: Turning options on and off ---');
  // First booking with both ON:
  const datesD1 = makeDates(1, 40);
  const resD1 = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: datesD1.checkIn,
    checkOut: datesD1.checkOut,
    roomsCount: 1,
    needCar: true,
    vehicleType: 'auto',
    carCount: 2,
    candlelightDinner: true,
    dinnerSetup: 'Poolside',
    guestName: 'Sanjay Dutt',
    guestPhone: '+91 98300 44444'
  });
  // Auto: 1200 * 2 * 1 = 2400. Poolside: 2800. Room: 2500. Total = 7700
  assert(resD1.data.totalAmount === 7700, `Turned ON: Total is ₹7,700 (actual: ₹${resD1.data.totalAmount})`);

  // Same stay with both turned OFF:
  const datesD2 = makeDates(1, 45);
  const resD2 = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: datesD2.checkIn,
    checkOut: datesD2.checkOut,
    roomsCount: 1,
    needCar: false,
    candlelightDinner: false,
    guestName: 'Sanjay Dutt',
    guestPhone: '+91 98300 44444'
  });
  assert(resD2.data.totalAmount === 2500, `Turned OFF: Total dropped back to ₹2,500 (actual: ₹${resD2.data.totalAmount})`);
  assert(resD2.data.booking.carTotal === 0, 'Transport cost is 0 when turned off');
  assert(resD2.data.booking.dinnerTotal === 0, 'Dinner cost is 0 when turned off');
  assert(resD2.data.booking.breakdown.lines.length === 1, 'Only room line shown when add-ons are turned off');

  // TEST SCENARIO E: Admin Tax Setting ON vs OFF
  console.log('\n--- SCENARIO E: Admin Tax Setting ---');
  // With tax disabled:
  assert(resA.data.booking.taxAmount === 0, 'No taxes added when tax is disabled in admin');

  // Turn tax ON in admin:
  await post('/api/settings', { enableTax: true, taxPercentage: 12 }, token);
  const datesE = makeDates(1, 50);
  const resE = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: datesE.checkIn,
    checkOut: datesE.checkOut,
    roomsCount: 1,
    needCar: false,
    candlelightDinner: false,
    guestName: 'Tax Test Guest',
    guestPhone: '+91 98300 55555'
  });
  // Subtotal = 2500. 12% tax = 300. Total = 2800
  assert(resE.data.booking.taxAmount === 300, `Tax calculated when enabled in admin (actual: ₹${resE.data.booking.taxAmount})`);
  assert(resE.data.booking.totalAmount === 2800, `Estimated Total with tax is ₹2,800 (actual: ₹${resE.data.booking.totalAmount})`);
  assert(resE.data.booking.breakdown.lines.some(l => l.includes('GST / Taxes (12%): ₹300')), 'Breakdown includes tax line when tax is enabled');

  // Reset tax back to OFF for default behavior
  await post('/api/settings', { enableTax: false, taxPercentage: 12 }, token);

  // --- PART 2: ADMIN BOOKINGS TABLE & CONFIRMATION EMAIL VERIFICATION ---
  console.log('\n--- PART 2: Admin Bookings Table & Confirmation Email Verification ---');
  const adminBookingsRes = await get('/api/bookings', token);
  assert(adminBookingsRes.data.success, 'Admin retrieved bookings table list');
  const foundBookingC = adminBookingsRes.data.bookings.find(b => b.bookingId === bC.bookingId);
  assert(foundBookingC !== undefined, 'Scenario C booking exists in admin bookings list');
  assert(foundBookingC.breakdown !== undefined, 'Saved breakdown exists in admin booking object');
  assert(foundBookingC.breakdown.lines.length === 3, 'Admin booking object has all 3 breakdown lines');

  // Check confirmation email in outbox
  const outboxRes = await get('/api/admin/emails', token);
  assert(outboxRes.data.success, 'Admin retrieved email outbox');
  const confirmationEmail = outboxRes.data.emails.find(e => e.to === 'subhasish@example.com');
  assert(confirmationEmail !== undefined, 'Confirmation email dispatched to guest email');
  assert(confirmationEmail.html.includes('Room: ₹2,700 × 2 nights × 2 rooms'), 'Confirmation email table contains itemized room breakdown');
  assert(confirmationEmail.html.includes('Car × 1 × 2 days'), 'Confirmation email table contains transport breakdown');
  assert(confirmationEmail.html.includes('Candlelight dinner'), 'Confirmation email table contains candlelight breakdown');
  assert(confirmationEmail.html.includes('Itemized Breakdown:'), 'Confirmation email contains Itemized Breakdown section');

  console.log('\n================================================================');
  console.log(`   ALL ${passedTests}/${totalTests} TESTS PASSED PERFECTLY!                     `);
  console.log('================================================================\n');
}

runAllTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

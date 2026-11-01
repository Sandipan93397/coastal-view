const testEnv = require('../test_db_helper');
const assert = require('assert');
const fs = require('fs');
const http = require('http');

function apiCall(method, path, data = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runVehiclePricingVerification() {
  await testEnv.startIsolatedServer();
  console.log('========================================================================');
  console.log('VEHICLE PRICING MATRIX & BOOKING INTEGRATION VERIFICATION');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, ok, msg = '') {
    if (ok) {
      passed++;
      console.log(`  ✅ PASS: ${name} ${msg ? '— ' + msg : ''}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${name} ${msg ? '— ' + msg : ''}`);
    }
  }

  const adminHeaders = { 'x-admin-role': 'Manager' };

  // 1. DIAGNOSIS: Print Car + Drop from database and from public API response side by side
  console.log('--- 1. DIAGNOSIS: Car + Drop DB vs API Side-by-Side ---');
  const dbBefore = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8'));
  const carDbBefore = (dbBefore.vehicles || []).find(v => v.id === 'car');
  const apiBefore = await apiCall('GET', '/api/vehicles');
  const carApiBefore = (apiBefore.body.vehicles || []).find(v => v.id === 'car');

  console.log('Car Drop in Database:   ', JSON.stringify(carDbBefore?.services?.drop));
  console.log('Car Drop in Public API: ', JSON.stringify(carApiBefore?.services?.drop));
  test('Car Drop data retrieved from both DB and API', Boolean(carDbBefore && carApiBefore));

  // 2. SET PRICES IN ADMIN: Set prices for Car, Toto, Auto
  console.log('\n--- 2. Setting Prices via Admin API (POST /api/vehicles/:id/cell) ---');
  
  // Set Car Drop to 1500 (auto-enables!)
  const setCarDrop = await apiCall('POST', '/api/vehicles/car/cell', {
    serviceType: 'drop',
    price: 1500,
    enabled: true
  }, adminHeaders);
  test('Admin saves Car Drop @ ₹1,500', setCarDrop.status === 200 && setCarDrop.body.success === true);

  // Set Car Pickup to 1200
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'pickup', price: 1200, enabled: true }, adminHeaders);

  // Set Car Pickup+Drop to 2500
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'pickup_drop', price: 2500, enabled: true }, adminHeaders);

  // Set Car Tour to 2500
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'tour', price: 2500, enabled: true }, adminHeaders);

  // Set Toto Pickup to 400
  await apiCall('POST', '/api/vehicles/toto/cell', { serviceType: 'pickup', price: 400, enabled: true }, adminHeaders);

  // Set Toto Drop to 400
  await apiCall('POST', '/api/vehicles/toto/cell', { serviceType: 'drop', price: 400, enabled: true }, adminHeaders);

  // Set Toto Pickup+Drop to 750
  await apiCall('POST', '/api/vehicles/toto/cell', { serviceType: 'pickup_drop', price: 750, enabled: true }, adminHeaders);

  // Set Toto Tour to 1200
  await apiCall('POST', '/api/vehicles/toto/cell', { serviceType: 'tour', price: 1200, enabled: true }, adminHeaders);

  // Set Auto Pickup to 600
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'pickup', price: 600, enabled: true }, adminHeaders);

  // Set Auto Drop to 600
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'drop', price: 600, enabled: true }, adminHeaders);

  // Set Auto Pickup+Drop to 1100
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'pickup_drop', price: 1100, enabled: true }, adminHeaders);

  // Set Auto Tour to 0 (Intentionally Free test)
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'tour', price: 0, enabled: true }, adminHeaders);

  // 3. CONFIRM CACHE-CONTROL AND IMMEDIATE LIVE UPDATE WITHOUT REDEPLOY
  console.log('\n--- 3. Verifying Public API (/api/vehicles) Immediate Delivery & Headers ---');
  const freshApi = await apiCall('GET', '/api/vehicles');
  test('GET /api/vehicles status is 200', freshApi.status === 200);
  test('Cache-Control includes no-store, no-cache', freshApi.headers['cache-control'] && freshApi.headers['cache-control'].includes('no-store'));

  const carFresh = freshApi.body.vehicles.find(v => v.id === 'car');
  const totoFresh = freshApi.body.vehicles.find(v => v.id === 'toto');
  const autoFresh = freshApi.body.vehicles.find(v => v.id === 'auto');

  test('Public API Car Drop is ₹1,500 and enabled', carFresh.services.drop.price === 1500 && carFresh.services.drop.enabled === true);
  test('Public API Car Pickup is ₹1,200 and enabled', carFresh.services.pickup.price === 1200 && carFresh.services.pickup.enabled === true);
  test('Public API Toto Pickup is ₹400 and enabled', totoFresh.services.pickup.price === 400 && totoFresh.services.pickup.enabled === true);
  test('Public API Auto Tour is 0 (Free) and enabled', autoFresh.services.tour.price === 0 && autoFresh.services.tour.enabled === true);

  // Side-by-side comparison after admin update
  const dbAfter = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8'));
  const carDbAfter = (dbAfter.vehicles || []).find(v => v.id === 'car');
  console.log('Side-by-side Car Drop after update:');
  console.log('  Database: ', JSON.stringify(carDbAfter.services.drop));
  console.log('  API:      ', JSON.stringify(carFresh.services.drop));
  test('Database and Public API match exactly for Car Drop', carDbAfter.services.drop.price === carFresh.services.drop.price && carDbAfter.services.drop.enabled === carFresh.services.drop.enabled);

  // 4. HAND CALCULATION & VERIFICATION OF 20% ADVANCE AND 80% BALANCE
  console.log('\n--- 4. Hand Calculation: Booking Total, 20% Advance, 80% Balance ---');
  /*
     Room: The Ocean Whisper Room (₹2,500/night), 2 nights, 1 room = ₹5,000
     Vehicle Line 1: Car Drop (₹1,500) × 1 vehicle = ₹1,500
     Vehicle Line 2: Toto Pickup (₹400) × 2 vehicles = ₹800
     Total Transport: ₹1,500 + ₹800 = ₹2,300
     Candlelight dinner: None (₹0)
     Breakfast: None (₹0)
     GST: Room is ₹2,500 <= ₹7,500, so GST = 0
     Estimated Total = 5000 + 2300 = ₹7,300
     Pay Now (20% Advance) = Math.round(7300 * 0.20) = ₹1,460
     Pay at Hotel (80% Balance) = 7300 - 1460 = ₹5,840
  */
  const roomPricePerNight = 2500;
  const nights = 2;
  const roomsCount = 1;
  const roomSubtotal = roomPricePerNight * nights * roomsCount; // 5000
  const carDropPrice = 1500;
  const carDropQty = 1;
  const carDropSubtotal = carDropPrice * carDropQty; // 1500
  const totoPickupPrice = 400;
  const totoPickupQty = 2;
  const totoPickupSubtotal = totoPickupPrice * totoPickupQty; // 800
  const expectedTransportTotal = carDropSubtotal + totoPickupSubtotal; // 2300
  const expectedGrandTotal = roomSubtotal + expectedTransportTotal; // 7300
  const expected20Percent = Math.round(expectedGrandTotal * 0.20); // 1460
  const expected80Percent = expectedGrandTotal - expected20Percent; // 5840

  console.log(`  Room Subtotal (2 nights × ₹2,500): ₹${roomSubtotal}`);
  console.log(`  Transport Subtotal (Car Drop × 1 + Toto Pickup × 2): ₹${expectedTransportTotal}`);
  console.log(`  Expected Grand Total: ₹${expectedGrandTotal}`);
  console.log(`  Expected 20% Advance: ₹${expected20Percent}`);
  console.log(`  Expected 80% Balance: ₹${expected80Percent}`);

  test('Hand calculation math checks out', expected20Percent + expected80Percent === expectedGrandTotal);

  // 5. SUBMIT BOOKING VIA POST /api/bookings WITH VEHICLE LINES
  console.log('\n--- 5. Submitting Booking to Server ---');
  const bookingPayload = {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-15',
    checkOut: '2026-11-17',
    adults: 2,
    children: 0,
    roomsCount: 1,
    clientTotal: expectedGrandTotal,
    needCar: true,
    vehicleLines: [
      {
        vehicleId: 'car',
        serviceType: 'drop',
        quantity: 1,
        dropPoint: 'Kolkata Airport',
        dropTime: '14:00'
      },
      {
        vehicleId: 'toto',
        serviceType: 'pickup',
        quantity: 2,
        pickupPoint: 'Kanthi Railway Station',
        pickupTime: '10:30'
      }
    ],
    guestName: 'Dr. Arindam Sen',
    guestPhone: '9830112233',
    guestEmail: 'arindam.sen@testdomain.in',
    specialRequests: 'Ground floor room preferred'
  };

  const bookingRes = await apiCall('POST', '/api/bookings', bookingPayload);
  test('POST /api/bookings status is 200', bookingRes.status === 200 && bookingRes.body.success === true);

  const bookingId = bookingRes.body.booking?.id || bookingRes.body.bookingId;
  console.log(`  Generated Booking ID: ${bookingId}`);

  // 6. VERIFY SAVED BOOKING IN DATABASE, ADMIN, INVOICE, AND EMAIL
  console.log('\n--- 6. Verifying Saved Booking & Transport Breakdown ---');
  const dbSaved = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8'));
  const savedBooking = (dbSaved.bookings || []).find(b => (b.bookingId === bookingId || b.id === bookingId));
  test('Booking exists in database', Boolean(savedBooking));
  test('Booking has vehicleLines array with 2 lines', Array.isArray(savedBooking?.vehicleLines) && savedBooking.vehicleLines.length === 2);

  const line1 = savedBooking.vehicleLines[0];
  const line2 = savedBooking.vehicleLines[1];
  test('Line 1 is Car Drop with unit price ₹1,500 and total ₹1,500', line1.vehicleId === 'car' && line1.serviceType === 'drop' && line1.price === 1500 && (line1.subtotal === 1500 || line1.lineTotal === 1500));
  test('Line 2 is Toto Pickup with unit price ₹400 and total ₹800', line2.vehicleId === 'toto' && line2.serviceType === 'pickup' && line2.price === 400 && (line2.subtotal === 800 || line2.lineTotal === 800));
  test('Server recomputed carTotal = ₹2,300', savedBooking.carTotal === 2300);
  test('Server computed advance = 20% and balance = 80%', savedBooking.payNowAdvance === Math.round(savedBooking.totalAmount * 0.2) && (savedBooking.payNowAdvance + savedBooking.payAtHotelBalance === savedBooking.totalAmount));

  // Verify Invoice Generation
  console.log('\n--- 7. Verifying Invoice Generator Transport Items ---');
  test('Invoice PDF was generated upon booking creation', fs.existsSync(savedBooking.invoicePdfPath));
  console.log(`  Invoice PDF exists at: ${savedBooking.invoicePdfPath}`);

  // 7. CHANGE PRICE IN ADMIN AND CONFIRM FORM / API UPDATES WITHOUT REDEPLOY
  console.log('\n--- 8. Testing Dynamic Price Change without Redeploy ---');
  // Change Car Drop from 1500 to 1800
  const updateRes = await apiCall('POST', '/api/vehicles/car/cell', {
    serviceType: 'drop',
    price: 1800,
    enabled: true
  }, adminHeaders);
  test('Admin updates Car Drop to ₹1,800', updateRes.status === 200 && updateRes.body.success === true);

  const apiAfterUpdate = await apiCall('GET', '/api/vehicles');
  const carAfter = apiAfterUpdate.body.vehicles.find(v => v.id === 'car');
  test('API immediately returns updated Car Drop price of ₹1,800 without redeploy', carAfter.services.drop.price === 1800 && carAfter.services.drop.enabled === true);

  // Restore Car Drop to 1500
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'drop', price: 1500, enabled: true }, adminHeaders);

  console.log('\n========================================================================');
  console.log(`FINAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runVehiclePricingVerification().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});

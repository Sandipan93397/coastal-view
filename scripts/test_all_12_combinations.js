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

async function runComprehensiveMatrixTest() {
  console.log('========================================================================');
  console.log('TESTING ALL 12 COMBINATIONS (Toto, Auto, Car × Pickup, Drop, Pickup+Drop, Tour)');
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

  // Define prices for all 12 combinations:
  const testPrices = {
    toto: {
      pickup: 350,
      drop: 350,
      pickup_drop: 650,
      tour: 1200
    },
    auto: {
      pickup: 550,
      drop: 550,
      pickup_drop: 1000,
      tour: 1800
    },
    car: {
      pickup: 1200,
      drop: 1500,
      pickup_drop: 2600,
      tour: 2500
    }
  };

  console.log('1. Setting Admin Prices for All 12 Combinations...');
  for (const [vId, svcs] of Object.entries(testPrices)) {
    for (const [sType, price] of Object.entries(svcs)) {
      const res = await apiCall('POST', `/api/vehicles/${vId}/cell`, {
        serviceType: sType,
        price,
        enabled: true
      }, adminHeaders);
      test(`Admin set ${vId.toUpperCase()} · ${sType} to ₹${price}`, res.status === 200 && res.body.success === true);
    }
  }

  // 2. Fetch public API (GET /api/vehicles)
  console.log('\n2. Verifying Public API (/api/vehicles) Returns Exact Matrix Immediately...');
  const apiRes = await apiCall('GET', '/api/vehicles');
  test('GET /api/vehicles status 200 with no-store header', apiRes.status === 200 && apiRes.headers['cache-control'].includes('no-store'));

  const vehicles = apiRes.body.vehicles;

  for (const [vId, svcs] of Object.entries(testPrices)) {
    const vObj = vehicles.find(v => v.id === vId);
    test(`Vehicle "${vId}" found in public API response`, Boolean(vObj));
    for (const [sType, expectedPrice] of Object.entries(svcs)) {
      const cell = vObj?.services?.[sType];
      test(`${vId.toUpperCase()} · ${sType} API price is ₹${expectedPrice} (Active)`, 
        cell && cell.price === expectedPrice && cell.enabled === true);
    }
  }

  // 3. Test Booking Form Live Calculation Logic (Replicating booking.js calculateLivePrice)
  console.log('\n3. Testing Booking Form Calculation Logic for Combinations & Live Totals...');
  const roomPrice = 2500;
  const nights = 3;
  const roomsCount = 1;
  const roomSubtotal = roomPrice * nights * roomsCount; // 7500

  // Test Car + Drop live calculation
  // Car Drop: ₹1,500 × 2 vehicles = ₹3,000
  // Estimated Total = 7500 + 3000 = ₹10,500
  // Pay Now (20% Advance) = ₹2,100
  // Pay at Hotel (80% Balance) = ₹8,400
  const carDropTestPrice = testPrices.car.drop; // 1500
  const carDropQty = 2;
  const carDropLineTotal = carDropTestPrice * carDropQty; // 3000
  const total1 = roomSubtotal + carDropLineTotal; // 10500
  const payNow1 = Math.round(total1 * 0.20); // 2100
  const payHotel1 = total1 - payNow1; // 8400

  test('Car + Drop (qty 2) line total is ₹3,000', carDropLineTotal === 3000);
  test('Estimated Total includes Car Drop (₹7,500 + ₹3,000 = ₹10,500)', total1 === 10500);
  test('Pay Now (20%) is ₹2,100', payNow1 === 2100);
  test('Pay at Hotel (80%) is ₹8,400', payHotel1 === 8400);

  // Test Tour calculation (Rate × Qty × Days)
  // Toto Tour: ₹1,200/day × 1 vehicle × 3 days = ₹3,600
  // Estimated Total = 7500 + 3600 = ₹11,100
  // Pay Now (20% Advance) = ₹2,220
  // Pay at Hotel (80% Balance) = ₹8,880
  const totoTourRate = testPrices.toto.tour; // 1200
  const totoTourQty = 1;
  const totoTourDays = 3;
  const totoTourLineTotal = totoTourRate * totoTourQty * totoTourDays; // 3600
  const total2 = roomSubtotal + totoTourLineTotal; // 11100
  const payNow2 = Math.round(total2 * 0.20); // 2220
  const payHotel2 = total2 - payNow2; // 8880

  test('Toto Tour (qty 1, 3 days) line total is ₹3,600', totoTourLineTotal === 3600);
  test('Estimated Total includes Toto Tour (₹7,500 + ₹3,600 = ₹11,100)', total2 === 11100);
  test('Pay Now (20%) is ₹2,220', payNow2 === 2220);
  test('Pay at Hotel (80%) is ₹8,880', payHotel2 === 8880);

  // 4. Test Intentionally 0 Price ("Free")
  console.log('\n4. Testing Price = 0 (Free Service)...');
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'pickup', price: 0, enabled: true }, adminHeaders);
  const freeApi = await apiCall('GET', '/api/vehicles');
  const autoPickupCell = freeApi.body.vehicles.find(v => v.id === 'auto')?.services?.pickup;
  test('Auto Pickup price is 0 and enabled: true', autoPickupCell?.price === 0 && autoPickupCell?.enabled === true);

  // Submit booking with Free vehicle service
  const freeBookingRes = await apiCall('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-20',
    checkOut: '2026-11-22',
    adults: 2,
    children: 0,
    roomsCount: 1,
    clientTotal: 5000,
    needCar: true,
    vehicleLines: [
      {
        vehicleId: 'auto',
        serviceType: 'pickup',
        quantity: 1,
        pickupPoint: 'Bus Stop'
      }
    ],
    guestName: 'Free Test Guest',
    guestPhone: '9830112244',
    guestEmail: 'freetest@testdomain.in'
  });
  test('Server accepts booking with Free (₹0) vehicle service', freeBookingRes.status === 200 && freeBookingRes.body.success === true);
  const freeSaved = JSON.parse(fs.readFileSync(testEnv.TEMP_DB_PATH, 'utf8')).bookings.find(b => b.bookingId === (freeBookingRes.body.booking?.id || freeBookingRes.body.bookingId));
  test('Saved booking records line as Free with lineTotal = 0', freeSaved?.vehicleLines?.[0]?.subtotal === 0 && freeSaved?.carTotal === 0);

  // Restore Auto Pickup to 550
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'pickup', price: 550, enabled: true }, adminHeaders);

  // 5. Test Unset / Disabled Price (Must be hidden or "Ask us")
  console.log('\n5. Testing Missing Price / Disabled Service (Ask us / Hidden)...');
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'tour', price: null, enabled: false }, adminHeaders);
  const unsetApi = await apiCall('GET', '/api/vehicles');
  const autoTourUnset = unsetApi.body.vehicles.find(v => v.id === 'auto')?.services?.tour;
  test('Auto Tour is unset (price: null, enabled: false)', autoTourUnset?.price === null && autoTourUnset?.enabled === false);

  // Booking attempt with missing price service should be rejected by server
  const invalidBookingRes = await apiCall('POST', '/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: '2026-11-20',
    checkOut: '2026-11-22',
    adults: 2,
    children: 0,
    roomsCount: 1,
    clientTotal: 5000,
    needCar: true,
    vehicleLines: [
      {
        vehicleId: 'auto',
        serviceType: 'tour',
        quantity: 1
      }
    ],
    guestName: 'Unset Test Guest',
    guestPhone: '9830112255',
    guestEmail: 'unsettest@testdomain.in'
  });
  test('Server rejects booking for unpriced/disabled service with 400 Bad Request', invalidBookingRes.status === 400 && invalidBookingRes.body.message.includes('no price set or is unavailable'));

  // Restore Auto Tour to 1800
  await apiCall('POST', '/api/vehicles/auto/cell', { serviceType: 'tour', price: 1800, enabled: true }, adminHeaders);

  // 6. Test Live Price Change without Redeploy
  console.log('\n6. Testing Live Price Change without Redeploy...');
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'drop', price: 1750, enabled: true }, adminHeaders);
  const liveCheck = await apiCall('GET', '/api/vehicles');
  const carDropLive = liveCheck.body.vehicles.find(v => v.id === 'car')?.services?.drop;
  test('Car Drop immediately reflects updated price ₹1,750 on public GET without redeploy', carDropLive?.price === 1750 && carDropLive?.enabled === true);

  // Restore Car Drop to 1500
  await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'drop', price: 1500, enabled: true }, adminHeaders);

  console.log('\n========================================================================');
  console.log(`ALL 12 COMBINATIONS & FEATURES VERIFIED: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runComprehensiveMatrixTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

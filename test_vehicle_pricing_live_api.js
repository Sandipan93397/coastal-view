const assert = require('assert');
const fs = require('fs');
const http = require('http');

function apiCall(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers['Authorization'] = `Bearer ${token}`;

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
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runLiveApiTests() {
  console.log('========================================================================');
  console.log('STARTING LIVE SERVER & VEHICLE MATRIX VERIFICATION');
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

  try {
    // 1. GET /api/vehicles
    console.log('1. Testing GET /api/vehicles matrix delivery...');
    const vRes = await apiCall('GET', '/api/vehicles');
    test('GET /api/vehicles status is 200', vRes.status === 200);
    test('Response contains vehicles array', Array.isArray(vRes.body.vehicles));

    const toto = vRes.body.vehicles.find(v => v.id === 'toto');
    const auto = vRes.body.vehicles.find(v => v.id === 'auto');
    const car = vRes.body.vehicles.find(v => v.id === 'car');

    test('Toto exists with services matrix', !!toto && !!toto.services && !!toto.services.pickup && toto.capacity === 4);
    test('Auto exists with services matrix', !!auto && !!auto.services && auto.capacity === 3);
    test('Car exists with Tour = ₹2,500 active', !!car && car.services.tour.price === 2500 && car.services.tour.enabled === true);

    // 2. Admin Login to get token for management
    console.log('\n2. Testing Admin Token for Price Matrix Editing...');
    // We can generate a token or login with manager
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'coastal-view-secret-key-2026';
    const managerToken = jwt.sign({
      id: 'usr-admin-test',
      username: 'manager_test',
      role: 'Manager'
    }, JWT_SECRET, { expiresIn: '1h' });
    test('Generated valid Manager JWT for audit logging', !!managerToken);

    // 3. Edit Cell via API: POST /api/vehicles/toto/cell (Set Pickup = ₹800, enabled = true)
    console.log('\n3. Testing Matrix Cell Price Editing with Audit Trail...');
    const cellRes = await apiCall('POST', '/api/vehicles/toto/cell', {
      serviceType: 'pickup',
      price: 800,
      enabled: true
    }, managerToken);

    test('POST /api/vehicles/toto/cell status is 200', cellRes.status === 200 && cellRes.body.success === true);

    // Check GET /api/vehicles immediately updates
    const vResAfter = await apiCall('GET', '/api/vehicles');
    const totoAfter = vResAfter.body.vehicles.find(v => v.id === 'toto');
    test('Toto Pickup price is immediately updated to ₹800 in API', totoAfter.services.pickup.price === 800 && totoAfter.services.pickup.enabled === true);

    // Check Audit Log
    const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
    const lastAudit = db.auditLog && db.auditLog[db.auditLog.length - 1];
    test('Audit log entry created for price change', lastAudit && lastAudit.action.includes('Toto') && lastAudit.details.includes('800'));

    // Check Chatbot immediately answers updated price
    console.log('\n4. Testing Chatbot Dynamic Price Query...');
    const chatRes = await apiCall('POST', '/api/chat', {
      message: 'Toto pickup price?'
    });
    test('Chatbot answers updated Toto pickup price immediately', 
      chatRes.body && chatRes.body.reply && chatRes.body.reply.includes('800'));

    // 4. Booking Submission: Multi-line Vehicles with Tampering Defense
    console.log('\n5. Testing Booking Submission with Multi-line Vehicles & Tampering Defense...');
    
    // Also set Car pickup to ₹1,200 for testing multi-line booking
    await apiCall('POST', '/api/vehicles/car/cell', {
      serviceType: 'pickup',
      price: 1200,
      enabled: true
    }, managerToken);

    const bookingPayload = {
      roomId: 'deluxe-ocean',
      checkIn: '2026-11-10',
      checkOut: '2026-11-12', // 2 nights
      adults: 2,
      children: 0,
      roomsCount: 1,
      needCar: true,
      vehicleLines: [
        {
          vehicleId: 'car',
          serviceType: 'pickup',
          quantity: 1,
          pickupPoint: 'Kanthi Railway Station',
          pickupTime: '10:30 AM'
        },
        {
          vehicleId: 'toto',
          serviceType: 'pickup',
          quantity: 1,
          pickupPoint: 'Chawalkhola Bus Stop',
          pickupTime: '11:00 AM'
        }
      ],
      // Tampered values sent by client:
      totalAmount: 99,
      clientTransportCost: 15,
      payNowAdvance: 10,
      payAtHotelBalance: 89,
      guestName: 'Tamper Tester',
      guestPhone: '9876543210',
      guestEmail: 'tamper@test.com'
    };

    const bookRes = await apiCall('POST', '/api/bookings', bookingPayload);
    test('POST /api/bookings returns 201', bookRes.status === 201 && bookRes.body.success === true);

    const savedBooking = bookRes.body.booking;
    test('Booking saved vehicleLines array with 2 lines', Array.isArray(savedBooking.vehicleLines) && savedBooking.vehicleLines.length === 2);
    test('Vehicle lines saved pickup points & times', 
      savedBooking.vehicleLines[0].pickupPoint === 'Kanthi Railway Station' && 
      savedBooking.vehicleLines[1].pickupPoint === 'Chawalkhola Bus Stop');

    // Expected recalculation:
    // Car Pickup: ₹1,200 × 1 = ₹1,200
    // Toto Pickup: ₹800 × 1 = ₹800
    // Transport Subtotal = ₹2,000
    test('Server authoritative recalculated transport total (₹2,000) ignoring client ₹15', savedBooking.carTotal === 2000);

    const roomSubtotal = savedBooking.roomSubtotal || 0;
    const expectedGrandTotal = roomSubtotal + 2000;
    test(`Server authoritative totalAmount is ₹${expectedGrandTotal} ignoring client ₹99`, savedBooking.totalAmount === expectedGrandTotal);

    const expected20 = Math.round(expectedGrandTotal * 0.20);
    const expected80 = expectedGrandTotal - expected20;
    test(`Server authoritative 20% split: advance ₹${expected20}, hotel ₹${expected80}`, 
      savedBooking.payNowAdvance === expected20 && savedBooking.payAtHotelBalance === expected80);

    // 5. Reset Toto and Car Pickup to null to restore pristine empty state
    console.log('\n6. Restoring Pristine Database Matrix State...');
    await apiCall('POST', '/api/vehicles/toto/cell', { serviceType: 'pickup', price: null, enabled: false }, managerToken);
    await apiCall('POST', '/api/vehicles/car/cell', { serviceType: 'pickup', price: null, enabled: false }, managerToken);
    
    const vResRestored = await apiCall('GET', '/api/vehicles');
    const totoRestored = vResRestored.body.vehicles.find(v => v.id === 'toto');
    test('Toto Pickup restored to null (Not set)', totoRestored.services.pickup.price === null && totoRestored.services.pickup.enabled === false);

    const chatRestored = await apiCall('POST', '/api/chat', { message: 'Toto pickup price?' });
    test('Chatbot returns "not set / please call us" for restored unset price', 
      chatRestored.body.reply.includes('not set') || chatRestored.body.reply.includes('call'));

    console.log('\n========================================================================');
    console.log(`LIVE SERVER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal live test error:', err);
    process.exit(1);
  }
}

runLiveApiTests();

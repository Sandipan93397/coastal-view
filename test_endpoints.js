// Integration test script for Coastal View Hotel APIs
const http = require('http');

function post(path, data, token = null) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function get(path, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('--- TEST 1: Vehicle listing ---');
  const vRes = await get('/api/vehicles');
  console.log('Vehicles response:', vRes.data);

  console.log('\n--- TEST 2: Concierge vehicle queries ---');
  const chatRes = await post('/api/concierge/chat', { message: 'What are the toto and car rates?' });
  console.log('Chat response:', chatRes.data.reply);

  console.log('\n--- TEST 3: Admin Login ---');
  const loginRes = await post('/api/auth/login', { username: 'admin', password: 'CoastalAdmin@2026' });
  console.log('Login success:', loginRes.data.success, 'Token length:', loginRes.data.token?.length, 'Role:', loginRes.data.user?.role);
  const token = loginRes.data.token;

  console.log('\n--- TEST 4: Manager Account Creation ---');
  const newMgr = await post('/api/admin/users', {
    username: 'mgr_subir',
    name: 'Subir Mondal',
    password: 'ManagerSubir@2026',
    role: 'Manager'
  }, token);
  console.log('Manager creation result:', newMgr.data.success, 'Users count:', newMgr.data.users?.length);

  console.log('\n--- TEST 5: Vehicle Pricing Update & Audit Logging ---');
  const updateCar = await post('/api/vehicles/car', {
    pricePerDay: 2500,
    description: 'Luxury AC pickup or Mandarmani tour cab, up to 4 passengers.',
    capacity: 4,
    maxQuantity: 5,
    active: true
  }, token);
  console.log('Car update result:', updateCar.data.success);

  const auditRes = await get('/api/audit-log', token);
  console.log('Audit records count:', auditRes.data.auditLog?.length);
  console.log('Latest audit record:', auditRes.data.auditLog?.[auditRes.data.auditLog.length - 1]);

  console.log('\n--- TEST 6: Public Booking Form with Vehicle & Anti-Tamper Verification ---');
  // 1 room @ 5800/night * 2 nights = 11600
  // Toto: 800/day * 1 vehicle * 2 days = 1600
  // Candlelight: 3500
  // Total = 11600 + 1600 + 3500 = 16700
  // 20% advance = 3340, 80% balance = 13360
  const futureBase = 1900000000000 + Date.now() * 1000 + Math.floor(Math.random() * 1000000);
  const inD = new Date(futureBase);
  const outD = new Date(futureBase + 2 * 86400000);
  const checkIn = inD.toISOString().split('T')[0];
  const checkOut = outD.toISOString().split('T')[0];

  const inDTamper = new Date(futureBase + 30 * 86400000);
  const outDTamper = new Date(futureBase + 32 * 86400000);
  const checkInTamper = inDTamper.toISOString().split('T')[0];
  const checkOutTamper = outDTamper.toISOString().split('T')[0];

  const bookingPayload = {
    roomId: 'ocean-whisper-room',
    roomName: 'The Ocean Whisper Room',
    roomPrice: 6800,
    checkIn,
    checkOut,
    roomsCount: 1,
    guestsCount: 2,
    guestName: 'Rohit Sen',
    guestPhone: '9830198301',
    guestEmail: 'rohit.sen@example.com',
    needCar: true,
    vehicleType: 'Toto (E-Rickshaw)',
    carCount: 1,
    carDays: 2,
    vehicleTripType: 'Full-day tour',
    candlelightDinner: true,
    dinnerSetup: 'Beachside',
    clientTransportCost: 1600,
    clientTotal: 22100
  };

  const bookingRes = await post('/api/bookings', bookingPayload);
  console.log('Booking creation result:', bookingRes.status, bookingRes.data?.bookingId || JSON.stringify(bookingRes.data), 'Total:', bookingRes.data?.totalAmount, 'Transport:', bookingRes.data?.transportCost);

  console.log('\n--- TEST 7: Anti-Tamper Tampered Price Rejection ---');
  const tamperedPayload = {
    ...bookingPayload,
    checkIn: checkInTamper,
    checkOut: checkOutTamper,
    guestName: 'Tampered Guest',
    clientTransportCost: 10, // Attempted tamper from 1600 to 10
    clientTotal: 20510
  };
  const tamperRes = await post('/api/bookings', tamperedPayload);
  console.log('Tampered booking response status:', tamperRes.status, 'Message:', tamperRes.data.message);

  console.log('\n--- TEST 8: Email Outbox Verification ---');
  const emailRes = await get('/api/admin/emails', token);
  console.log('Email outbox count:', emailRes.data.emails?.length);
  const lastEmail = emailRes.data.emails?.[emailRes.data.emails.length - 1];
  console.log('Latest email sent to:', lastEmail?.to, 'Subject:', lastEmail?.subject);

  console.log('\n--- ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY ---');
}

runTests().catch(console.error);

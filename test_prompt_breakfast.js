const fs = require('fs');
const http = require('http');

let totalTests = 0;
let passedTests = 0;

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

// HTTP request helper
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch(e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get = (path, headers) => request('GET', path, null, headers);
const post = (path, body, headers) => request('POST', path, body, headers);

async function run() {
  console.log('================================================================');
  console.log('STARTING BREAKFAST IS OPTIONAL TEST SUITE');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // TEST 1: Source Files Scan for forbidden breakfast claims
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 1: Static Codebase Verification ---');

  const filesToScan = [
    'index.html',
    'admin/index.html',
    'admin/admin.js',
    'assets/js/booking.js',
    'assets/css/style.css',
    'server.js',
    'chatbot_service.js',
    'invoice_generator.js',
    'llms.txt',
    'menu.html',
    'gallery.html',
    'sitemap.xml',
    'api/bookings.php',
    'api/concierge.php',
    'api/rooms.php',
    'api/settings.php'
  ];

  const forbiddenPatterns = [
    { pattern: /breakfast\s+included/i, name: '"breakfast included"' },
    { pattern: /complimentary\s+breakfast/i, name: '"complimentary breakfast"' },
    { pattern: /free\s+breakfast/i, name: '"free breakfast"' }
  ];

  for (const file of filesToScan) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      forbiddenPatterns.forEach(({ pattern, name }) => {
        // Exclude allowed FAQ question or negations like "not included"
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (pattern.test(line)) {
            const isFaqQuestion = line.includes('Is breakfast included in the room rate?') || line.includes('Is breakfast included?');
            const isNegation = line.includes('not included') || line.includes('NOT included') || line.includes('ভাড়ার সাথে ব্রেকফাস্ট অন্তর্ভুক্ত নয়') || line.includes('किराये में नाश्ता शामिल नहीं है');
            const isFilterOrRegex = line.includes('.filter') || line.includes('!txt.toLowerCase().includes') || line.includes('!cleanText.includes');
            if (!isFaqQuestion && !isNegation && !isFilterOrRegex) {
              console.error(`Found unexpected forbidden ${name} in ${file} at line ${idx + 1}: ${line.trim()}`);
              assert(false, `No forbidden ${name} in ${file}`);
            }
          }
        });
      });
      assert(true, `Verified ${file} is clean of forbidden breakfast claims`);
    }
  }

  // Verify index.html room cards have the required note
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  assert(indexHtml.includes('Breakfast available (optional): ₹200'), 'index.html contains "Breakfast available (optional): ₹200" line');
  assert(!indexHtml.includes('Confirmed Complimentary Breakfast'), 'index.html no longer has "Confirmed Complimentary Breakfast" title');
  assert(indexHtml.includes('Add Breakfast (₹200)'), 'index.html contains "Add Breakfast (₹200)" toggle card in booking form');
  assert(indexHtml.includes('Served 7:00 AM to 10:30 AM.'), 'index.html contains "Served 7:00 AM to 10:30 AM." note in booking form');
  assert(indexHtml.includes('liveBreakfastSummaryLine'), 'index.html contains liveBreakfastSummaryLine in breakdown');
  assert(indexHtml.includes('Is breakfast included in the room rate?'), 'index.html FAQ has "Is breakfast included in the room rate?"');

  // Verify db.json rooms
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const allRoomsNoBf = (db.rooms || []).every(r => {
    return (r.inclusions || []).every(inc => {
      const txt = typeof inc === 'string' ? inc : inc.text;
      return !txt.toLowerCase().includes('breakfast');
    });
  });
  assert(allRoomsNoBf, 'All active rooms in db.json have confirmed inclusions without breakfast');

  // --------------------------------------------------------------------------
  // TEST 2: Admin Login & Settings API
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Admin Authentication & Breakfast Add-on Settings ---');
  const loginRes = await post('/api/auth/login', { username: 'admin', password: 'CoastalAdmin@2026' });
  assert(loginRes.status === 200 && loginRes.data.success, 'Admin authenticated');
  const authHeader = { 'Authorization': `Bearer ${loginRes.data.token}` };

  // Update breakfast settings in Admin
  const adminBfSave = await post('/api/admin/settings/breakfast', {
    name: 'Breakfast Add-On',
    price: 200,
    unit: 'per_person_per_day',
    servingTime: '7:00 AM to 10:30 AM',
    enabled: true
  }, authHeader);
  assert(adminBfSave.status === 200 && adminBfSave.data.success, 'Admin successfully saved Breakfast settings');

  const settingsRes = await get('/api/settings');
  assert(settingsRes.data.settings.breakfastPrice === 200, 'Breakfast price verified as 200');
  assert(settingsRes.data.settings.breakfastUnit === 'per_person_per_day', 'Breakfast unit verified as per_person_per_day');
  assert(settingsRes.data.settings.breakfastEnabled === true, 'Breakfast enabled verified as true');

  // --------------------------------------------------------------------------
  // TEST 3: Booking Calculation - Scenario A: Room with NO Breakfast
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Scenario A - Room with NO Breakfast ---');
  const dateSeed = Date.now() + 80000000000 + Math.floor(Math.random() * 10000000000);
  const checkInA = new Date(dateSeed).toISOString().split('T')[0];
  const checkOutA = new Date(dateSeed + 2 * 86400000).toISOString().split('T')[0]; // 2 nights

  const resA = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: checkInA,
    checkOut: checkOutA,
    adults: 2,
    children: 0,
    roomsCount: 1,
    breakfast: false,
    guestName: 'Rahul Verma',
    guestPhone: '+91 98765 43210',
    guestEmail: 'rahul.verma@example.com'
  });

  assert(resA.status === 200 && resA.data.success, 'Booking without breakfast created successfully');
  const bookingA = resA.data.booking;
  assert(bookingA.totalAmount === 5000, `Total is unchanged at ₹5,000 (got ${bookingA.totalAmount})`);
  assert(bookingA.payNowAdvance === 1000, `Pay now advance (20%) is ₹1,000 (got ${bookingA.payNowAdvance})`);
  assert(bookingA.payAtHotelBalance === 4000, `Pay at hotel balance (80%) is ₹4,000 (got ${bookingA.payAtHotelBalance})`);
  assert(bookingA.breakfast === false, 'Booking record has breakfast=false');
  assert(!bookingA.breakdown.lines.some(l => l.toLowerCase().includes('breakfast')), 'No breakfast line in breakdown lines');

  // --------------------------------------------------------------------------
  // TEST 4: Booking Calculation - Scenario B: Room WITH Breakfast (2 guests × 2 days)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Scenario B - Room WITH Breakfast (2 guests × 2 days = ₹800) ---');
  const dateSeedB = dateSeed + 20 * 86400000;
  const checkInB = new Date(dateSeedB).toISOString().split('T')[0];
  const checkOutB = new Date(dateSeedB + 2 * 86400000).toISOString().split('T')[0]; // 2 nights

  const resB = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: checkInB,
    checkOut: checkOutB,
    adults: 2,
    children: 0,
    roomsCount: 1,
    breakfast: true,
    breakfastGuests: 2,
    guestName: 'Priya Sen',
    guestPhone: '+91 98111 22233',
    guestEmail: 'priya.sen@example.com'
  });

  assert(resB.status === 200 && resB.data.success, 'Booking with breakfast created successfully');
  const bookingB = resB.data.booking;
  // Room: 2500 × 2 nights = 5000
  // Breakfast: 200 × 2 guests × 2 days = 800
  // Total: 5800
  // 20% advance: 1160
  // 80% balance: 4640
  assert(bookingB.breakfastTotal === 800, `Breakfast total is ₹800 (got ${bookingB.breakfastTotal})`);
  assert(bookingB.totalAmount === 5800, `Total amount includes breakfast: ₹5,800 (got ${bookingB.totalAmount})`);
  assert(bookingB.payNowAdvance === 1160, `20% advance is ₹1,160 (got ${bookingB.payNowAdvance})`);
  assert(bookingB.payAtHotelBalance === 4640, `80% hotel balance is ₹4,640 (got ${bookingB.payAtHotelBalance})`);
  
  const bfLineB = bookingB.breakdown.lines.find(l => l.toLowerCase().includes('breakfast'));
  assert(bfLineB && bfLineB.includes('Breakfast × 2 guests × 2 days = ₹800'), `Breakdown shows "Breakfast × 2 guests × 2 days = ₹800" (got: "${bfLineB}")`);

  // Verify Invoice generation for booking B
  assert(bookingB.invoiceToken, 'Booking B has invoiceToken');
  const invoicePdfRes = await get(`/api/invoices/public/info/${bookingB.invoiceToken}`);
  assert(invoicePdfRes.status === 200, 'Public invoice info accessible');
  const invTotal = invoicePdfRes.data.totalAmount !== undefined ? invoicePdfRes.data.totalAmount : (invoicePdfRes.data.invoice && invoicePdfRes.data.invoice.totalAmount);
  assert(invTotal === 5800, `Invoice total matches calculated total ₹5,800 (got ${invTotal})`);

  // --------------------------------------------------------------------------
  // TEST 5: Server-side anti-tampering (Ignores/rejects browser-sent totals)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Server-side recalculation ignores browser-sent total ---');
  const dateSeedC = dateSeedB + 20 * 86400000;
  const checkInC = new Date(dateSeedC).toISOString().split('T')[0];
  const checkOutC = new Date(dateSeedC + 2 * 86400000).toISOString().split('T')[0];

  const resC = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: checkInC,
    checkOut: checkOutC,
    adults: 2,
    children: 0,
    roomsCount: 1,
    breakfast: true,
    breakfastGuests: 2,
    clientTotal: 3000, // Tampered browser-sent total!
    guestName: 'Tamper Test',
    guestPhone: '+91 99999 00000'
  });

  // Server should reject the tampered total
  assert(resC.status === 400 && resC.data.message.includes('Tampered total amount rejected'), 'Server successfully rejected browser-sent tampered total');

  // --------------------------------------------------------------------------
  // TEST 6: Admin switches unit to "per room per day"
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Admin switches unit to "per room per day" ---');
  await post('/api/admin/settings/breakfast', {
    name: 'Breakfast Add-On',
    price: 200,
    unit: 'per_room_per_day',
    servingTime: '7:00 AM to 10:30 AM',
    enabled: true
  }, authHeader);

  const dateSeedD = dateSeedC + 20 * 86400000;
  const checkInD = new Date(dateSeedD).toISOString().split('T')[0];
  const checkOutD = new Date(dateSeedD + 2 * 86400000).toISOString().split('T')[0];

  const resD = await post('/api/bookings', {
    roomId: 'ocean-whisper-room',
    checkIn: checkInD,
    checkOut: checkOutD,
    adults: 4, // 4 guests, but unit is per room!
    children: 0,
    roomsCount: 1,
    breakfast: true,
    guestName: 'Room Unit Test',
    guestPhone: '+91 98888 77777'
  });

  assert(resD.status === 200 && resD.data.success, 'Booking with per_room_per_day breakfast created');
  const bookingD = resD.data.booking;
  // 1 room × 200 × 2 days = 400
  // Total = 5000 + 400 = 5400
  assert(bookingD.breakfastTotal === 400, `Breakfast total is ₹400 for 1 room × 2 days (got ${bookingD.breakfastTotal})`);
  assert(bookingD.totalAmount === 5400, `Total is ₹5,400 (got ${bookingD.totalAmount})`);
  const bfLineD = bookingD.breakdown.lines.find(l => l.toLowerCase().includes('breakfast'));
  assert(bfLineD && bfLineD.includes('Breakfast × 1 room × 2 days = ₹400'), `Breakdown shows "Breakfast × 1 room × 2 days = ₹400" (got: "${bfLineD}")`);

  // Restore unit to per_person_per_day
  await post('/api/admin/settings/breakfast', {
    name: 'Breakfast Add-On',
    price: 200,
    unit: 'per_person_per_day',
    servingTime: '7:00 AM to 10:30 AM',
    enabled: true
  }, authHeader);

  // --------------------------------------------------------------------------
  // TEST 7: Audit Log records price/setting change
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Audit Log price change tracking ---');
  // Make a price change
  await post('/api/admin/settings/breakfast', {
    name: 'Breakfast Add-On',
    price: 250,
    unit: 'per_person_per_day',
    servingTime: '7:00 AM to 10:30 AM',
    enabled: true
  }, authHeader);

  const dbAudit = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const auditEntries = dbAudit.auditLog || [];
  const bfPriceAudit = auditEntries.find(a => a.action === 'Breakfast Settings Updated' && a.details.includes('Price: ₹200 -> ₹250'));
  assert(bfPriceAudit !== undefined, 'Audit Log recorded the breakfast price change from ₹200 -> ₹250');

  // Change back to 200
  await post('/api/admin/settings/breakfast', {
    name: 'Breakfast Add-On',
    price: 200,
    unit: 'per_person_per_day',
    servingTime: '7:00 AM to 10:30 AM',
    enabled: true
  }, authHeader);

  // --------------------------------------------------------------------------
  // TEST 8: Chatbot replies for "Is breakfast included?"
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: Chatbot Verification ---');
  const chatResEn = await post('/api/chat', {
    message: 'Is breakfast included?',
    lang: 'en'
  });
  assert(chatResEn.status === 200 && chatResEn.data.success, 'Chatbot responded to English breakfast query');
  const replyEn = chatResEn.data.reply;
  assert(replyEn.includes('Breakfast is not included in the room rate, but you can add it for ₹200 when booking. It\'s served 7:00 AM to 10:30 AM.'),
    `Chatbot English reply matches requirement exactly (got: "${replyEn}")`);

  const chatResBn = await post('/api/chat', {
    message: 'ব্রেকফাস্ট কি অন্তর্ভুক্ত?',
    lang: 'bn'
  });
  assert(chatResBn.status === 200 && chatResBn.data.reply.includes('ব্রেকফাস্ট অন্তর্ভুক্ত নয়') && (chatResBn.data.reply.includes('₹২০০') || chatResBn.data.reply.includes('₹200')),
    'Chatbot Bengali reply accurately states breakfast is not included and costs ₹200');

  const chatResHi = await post('/api/chat', {
    message: 'क्या नाश्ता शामिल है?',
    lang: 'hi'
  });
  assert(chatResHi.status === 200 && chatResHi.data.reply.includes('नाश्ता (Breakfast) शामिल नहीं है') && chatResHi.data.reply.includes('₹200'),
    'Chatbot Hindi reply accurately states breakfast is not included and costs ₹200');

  console.log('\n================================================================');
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests}`);
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\nTest run failed:', err);
  process.exit(1);
});

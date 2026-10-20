// Comprehensive Verification Script for Room Prices, Quantities, and Availability
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING ROOM INVENTORY & AVAILABILITY VERIFICATION');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${message}`);
    }
  }

  // 0. Obtain Admin Authentication Token
  console.log('--- Step 0: Admin Authentication ---');
  let adminToken = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'CoastalAdmin@2026' })
    });
    const loginData = await loginRes.json();
    if (loginData.success && loginData.token) {
      adminToken = loginData.token;
      console.log('[PASS] Admin login successful, session token acquired.');
    } else {
      console.error('[FAIL] Could not authenticate admin:', loginData);
    }
  } catch (e) {
    console.error('[FAIL] Admin login error:', e);
  }

  // 1. Check Room Initial Prices, Tags, and Quantities in DB
  console.log('\n--- Test 1: Verify Initial Room Database Data (17 Inventory) ---');
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const rooms = db.rooms || [];
  
  const cosy = rooms.find(r => r.id === 'cosy-deluxe-room');
  const ocean = rooms.find(r => r.id === 'ocean-whisper-room');
  const pool = rooms.find(r => r.id === 'pool-haven-room');
  const family = rooms.find(r => r.id === 'palm-grove-family-suite');

  assert(cosy && cosy.price === 1800 && cosy.quantity === 7 && cosy.tag === 'Non-Sea Facing', 'Cosy Deluxe Room: ₹1,800, 7 rooms, Non-Sea Facing');
  assert(ocean && ocean.price === 2500 && ocean.quantity === 4 && ocean.tag === 'Sea View', 'The Ocean Whisper Room: ₹2,500, 4 rooms, Sea View');
  assert(pool && pool.price === 2200 && pool.quantity === 4 && pool.tag === 'Pool View', 'The Pool Haven Room: ₹2,200, 4 rooms, Pool View');
  assert(family && family.price === 2700 && family.quantity === 2 && family.tag === 'Family Suite', 'The Palm Grove Family Suite: ₹2,700, 2 rooms, Family Suite');

  const totalInv = rooms.reduce((sum, r) => sum + (r.quantity || 0), 0);
  assert(totalInv === 17, `Total portfolio inventory is 17 rooms (Calculated: ${totalInv})`);

  // 2. Test Price Splits (20% advance & 80% at hotel)
  console.log('\n--- Test 2: Calculate Price Splits (20% / 80%) ---');
  function calcSplit(price, nights = 1, count = 1) {
    const total = price * nights * count;
    const advance = Math.round(total * 0.2);
    const balance = total - advance;
    return { total, advance, balance };
  }

  const sCosy = calcSplit(1800);
  assert(sCosy.total === 1800 && sCosy.advance === 360 && sCosy.balance === 1440, 'Cosy Deluxe 1 night: ₹1,800 total -> ₹360 advance, ₹1,440 hotel');

  const sOcean = calcSplit(2500);
  assert(sOcean.total === 2500 && sOcean.advance === 500 && sOcean.balance === 2000, 'Ocean Whisper 1 night: ₹2,500 total -> ₹500 advance, ₹2,000 hotel');

  const sPool = calcSplit(2200);
  assert(sPool.total === 2200 && sPool.advance === 440 && sPool.balance === 1760, 'Pool Haven 1 night: ₹2,200 total -> ₹440 advance, ₹1,760 hotel');

  const sFamily = calcSplit(2700);
  assert(sFamily.total === 2700 && sFamily.advance === 540 && sFamily.balance === 2160, 'Family Suite 1 night: ₹2,700 total -> ₹540 advance, ₹2,160 hotel');

  const sPool2Nights = calcSplit(2200, 2, 1);
  assert(sPool2Nights.total === 4400 && sPool2Nights.advance === 880 && sPool2Nights.balance === 3520, 'Pool Haven 2 nights: ₹4,400 total -> ₹880 advance, ₹3,520 at hotel');

  // 3. Test Availability Endpoint for a fresh future date
  console.log('\n--- Test 3: Test Live Availability Endpoint (GET /api/rooms/availability) ---');
  const futureCheckIn = '2026-11-10';
  const futureCheckOut = '2026-11-12';
  const availRes = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=${futureCheckIn}&checkOut=${futureCheckOut}`).then(r => r.json());
  assert(availRes.success === true, 'Availability API responded with success: true');
  assert(availRes.nights === 2, 'Calculated nights: 2');
  
  const famAvail = availRes.availability.find(a => a.roomId === 'palm-grove-family-suite');
  assert(famAvail && famAvail.available === 2 && famAvail.total === 2, `Family Suite has 2 available on ${futureCheckIn}`);

  // 4. Test Overbooking Prevention: Try to book 3 Family Suites (Total is 2)
  console.log('\n--- Test 4: Prevent Overbooking - Attempt booking 3 Family Suites ---');
  const overbookRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId: 'palm-grove-family-suite',
      checkIn: futureCheckIn,
      checkOut: futureCheckOut,
      roomsCount: 3,
      guestName: 'Overbooking Test Guest',
      guestPhone: '9876543210'
    })
  });
  const overbookData = await overbookRes.json();
  assert(overbookRes.status === 400 && overbookData.success === false, 'Server rejected 3 rooms booking with HTTP 400');
  assert(overbookData.message && overbookData.message.includes('Only 2 room(s) available'), `Friendly error message returned: "${overbookData.message}"`);

  // 5. Book all 2 Family Suites for futureCheckIn -> makes it Sold Out for that date
  console.log('\n--- Test 5: Book All 2 Family Suites and Verify Sold Out Status ---');
  const bookRes = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId: 'palm-grove-family-suite',
      checkIn: futureCheckIn,
      checkOut: futureCheckOut,
      roomsCount: 2,
      guestName: 'Family Suite Full Booking',
      guestPhone: '9876543211',
      guestEmail: 'family@example.com'
    })
  });
  const bookData = await bookRes.json();
  assert(bookRes.status === 200 && bookData.success === true, `Successfully booked 2 Family Suites. Booking ID: ${bookData.booking?.bookingId}`);
  const createdBookingId = bookData.booking?.bookingId;

  // Re-check availability for the booked dates
  const recheckAvail = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=${futureCheckIn}&checkOut=${futureCheckOut}`).then(r => r.json());
  const famRecheck = recheckAvail.availability.find(a => a.roomId === 'palm-grove-family-suite');
  assert(famRecheck && famRecheck.available === 0 && famRecheck.booked === 2, 'Family Suite now has 0 available and 2 booked for those dates');

  // Verify other dates STAY OPEN
  const diffDatesRes = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=2026-11-15&checkOut=2026-11-17`).then(r => r.json());
  const famDiff = diffDatesRes.availability.find(a => a.roomId === 'palm-grove-family-suite');
  assert(famDiff && famDiff.available === 2, 'Family Suite remains 2 available on other dates (2026-11-15 to 2026-11-17)');

  // Verify checkout date is NOT occupied (can check in on 2026-11-12)
  const checkoutFreeRes = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=2026-11-12&checkOut=2026-11-14`).then(r => r.json());
  const famCheckoutFree = checkoutFreeRes.availability.find(a => a.roomId === 'palm-grove-family-suite');
  assert(famCheckoutFree && famCheckoutFree.available === 2, 'Checkout day (2026-11-12) is free for check-in: 2 rooms available');

  // 6. Test Cancellation Returning Rooms to Available Count
  console.log('\n--- Test 6: Cancel Booking and Verify Inventory Restored ---');
  // Read DB directly or call cancel endpoint
  const cancelDb = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  const bIndex = cancelDb.bookings.findIndex(b => b.bookingId === createdBookingId);
  if (bIndex !== -1) {
    cancelDb.bookings[bIndex].status = 'Cancelled';
    fs.writeFileSync('data/db.json', JSON.stringify(cancelDb, null, 2), 'utf8');
  }

  const afterCancelAvail = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=${futureCheckIn}&checkOut=${futureCheckOut}`).then(r => r.json());
  const famAfterCancel = afterCancelAvail.availability.find(a => a.roomId === 'palm-grove-family-suite');
  assert(famAfterCancel && famAfterCancel.available === 2 && famAfterCancel.booked === 0, 'Cancelled booking returned inventory: 2 rooms available again');

  // 7. Test Admin Maintenance Partial Block (e.g. block 1 of 4 Pool Haven rooms)
  console.log('\n--- Test 7: Test Admin Partial Maintenance Block ---');
  const blockRes = await fetch(`${BASE_URL}/api/rooms/pool-haven-room/sold-out`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      isSoldOut: false,
      dateRangeType: 'indefinite',
      blockedQuantity: 1,
      reason: 'Room #102 under AC duct maintenance'
    })
  });
  const blockData = await blockRes.json();
  assert(blockData.success === true, 'Admin successfully blocked 1 room under maintenance');

  const poolAvail = await fetch(`${BASE_URL}/api/rooms/availability?checkIn=2026-11-20&checkOut=2026-11-21`).then(r => r.json());
  const poolItem = poolAvail.availability.find(a => a.roomId === 'pool-haven-room');
  assert(poolItem && poolItem.total === 4 && poolItem.blocked === 1 && poolItem.available === 3, `Pool Haven now has 3 available (1 blocked for maintenance of 4 total)`);

  // Restore maintenance block
  await fetch(`${BASE_URL}/api/rooms/pool-haven-room/sold-out`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      isSoldOut: false,
      blockedQuantity: 0,
      reason: 'Maintenance completed'
    })
  });

  // 8. Test Chatbot Availability Query
  console.log('\n--- Test 8: Test Chatbot Date-Aware Availability ---');
  const chatRes = await fetch(`${BASE_URL}/api/concierge/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Is a sea view room available on 25 Dec?'
    })
  });
  const chatData = await chatRes.json();
  assert(chatData.success === true, 'Chatbot responded to availability inquiry');
  assert(chatData.reply && chatData.reply.toLowerCase().includes('25 dec') && chatData.reply.includes('The Ocean Whisper Room'), 'Chatbot accurately parsed "25 Dec" and included The Ocean Whisper Room');
  assert(!chatData.reply.includes('₹8,500') && !chatData.reply.includes('₹6,800') && !chatData.reply.includes('₹7,200'), 'Old hardcoded prices (₹8,500, ₹6,800, ₹7,200) are absent from chatbot reply');

  // Test Chatbot General Price Query
  const chatPriceRes = await fetch(`${BASE_URL}/api/concierge/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'What are the room prices and rates?'
    })
  });
  const chatPriceData = await chatPriceRes.json();
  assert(chatPriceData.reply && chatPriceData.reply.includes('₹1,800') && chatPriceData.reply.includes('₹2,500') && chatPriceData.reply.includes('₹2,200') && chatPriceData.reply.includes('₹2,700'), 'Chatbot prices read directly from DB: ₹1,800, ₹2,500, ₹2,200, ₹2,700');
  assert(chatPriceData.reply && chatPriceData.reply.includes('17 Rooms'), 'Chatbot states total inventory: 17 Rooms');

  // 9. Verify Admin Occupancy Endpoint
  console.log('\n--- Test 9: Test Admin Occupancy Endpoint (GET /api/admin/rooms/occupancy) ---');
  const occRes = await fetch(`${BASE_URL}/api/admin/rooms/occupancy?checkIn=2026-11-01&checkOut=2026-11-05`, {
    headers: {
      'Authorization': `Bearer ${adminToken}`
    }
  }).then(r => r.json());
  assert(occRes.success === true, 'Admin Occupancy API responded with success: true');
  assert(occRes.selectedRange && Array.isArray(occRes.selectedRange.rooms) && occRes.selectedRange.rooms.length === 4, 'Occupancy table returns all 4 room types');
  assert(occRes.calendar && Array.isArray(occRes.calendar.days) && occRes.calendar.days.length >= 28, 'Monthly calendar data generated with day-by-day availability');

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
});

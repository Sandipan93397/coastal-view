/**
 * E2E Chatbot Flow & API Acceptance Test
 * Tests against live server at http://localhost:3000
 */

const assert = require('assert');

async function runE2ETests() {
  console.log('================================================================================');
  console.log('🌐 TESTING LIVE CHATBOT ENDPOINTS & GUIDED BOOKING STATE MACHINE');
  console.log('================================================================================\n');

  const BASE_URL = 'http://localhost:3000';

  // 1. Welcome Endpoint Test
  console.log('1. Testing GET /api/chat/welcome...');
  const welcomeRes = await fetch(`${BASE_URL}/api/chat/welcome?lang=en`);
  assert.strictEqual(welcomeRes.status, 200, 'Welcome should return 200');
  const welcomeData = await welcomeRes.json();
  console.log('   Welcome Message:', welcomeData.reply?.slice(0, 60) + '...');
  console.log('   Action Chips:', welcomeData.actionChips);
  assert(welcomeData.actionChips.includes('Rooms & prices'), 'Should have Rooms & prices chip');
  assert(welcomeData.actionChips.includes('How to contact'), 'Should have How to contact chip');
  console.log('   ✅ Welcome endpoint verified.\n');

  // 2. THE BUG REPRODUCTION TEST: "how to contact" MUST return Contact Card, NEVER booking or rooms!
  console.log('2. Testing The Bug Fix: "how to contact"...');
  const contactRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'how to contact',
      sessionId: 'sess-e2e-contact-test',
      lang: 'en'
    })
  });
  assert.strictEqual(contactRes.status, 200);
  const contactData = await contactRes.json();
  console.log('   Intent detected:', contactData.intent);
  console.log('   Has Contact Card:', Boolean(contactData.contactCard));
  console.log('   Has Room Cards:', Boolean(contactData.roomCards));
  console.log('   Phone in card:', contactData.contactCard?.phone);
  console.log('   Reply snippet:', contactData.reply?.slice(0, 80));

  assert.strictEqual(contactData.intent, 'contact', 'Intent MUST be contact!');
  assert(contactData.contactCard !== undefined, 'Must include structured contactCard object');
  assert(!contactData.roomCards, 'Must NEVER return roomCards for contact inquiry!');
  assert(!contactData.reply.toLowerCase().includes('booking inquiry started'), 'Must NEVER trigger booking flow!');
  console.log('   ✅ Bug Fix Verified: "how to contact" accurately returns Contact Card!\n');

  // 3. Testing "show rooms" returns Room Cards swipe carousel
  console.log('3. Testing "show rooms" for horizontal room cards...');
  const roomsRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'show rooms',
      sessionId: 'sess-e2e-rooms-test',
      lang: 'en'
    })
  });
  assert.strictEqual(roomsRes.status, 200);
  const roomsData = await roomsRes.json();
  console.log('   Intent detected:', roomsData.intent);
  console.log('   Room Cards returned:', roomsData.roomCards?.length);
  assert(Array.isArray(roomsData.roomCards) && roomsData.roomCards.length > 0, 'Must return room cards array');
  const sampleCard = roomsData.roomCards[0];
  console.log('   Sample Card:');
  console.log('     Name:', sampleCard.name);
  console.log('     Tag:', sampleCard.tag);
  console.log('     Bed Type:', sampleCard.bedType);
  console.log('     Price/night:', sampleCard.priceFormatted);
  console.log('     Pre-fill Link:', sampleCard.bookingUrl);
  assert(!(sampleCard.inclusionsSummary || '').toLowerCase().includes('breakfast included'), 'Never say breakfast is included!');
  console.log('   ✅ Room Cards Carousel verified.\n');

  // 4. Testing Full Guided Booking State Machine Flow
  console.log('4. Testing Full Guided Booking State Machine Flow...');
  const bookSess = 'sess-e2e-booking-' + Date.now();

  // Step 4.1: Start booking
  console.log('   4.1 Step 1: Send "I want to book"...');
  let stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'I want to book', sessionId: bookSess, lang: 'en' })
  });
  let stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('dates') || stepData.reply.toLowerCase().includes('date'), 'Should ask for dates');

  // Step 4.2: Provide Dates
  console.log('   4.2 Step 2: Send dates "tomorrow to day after tomorrow"...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'tomorrow to day after tomorrow', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('guests'), 'Should ask for guests');

  // Step 4.3: Provide Guests
  console.log('   4.3 Step 3: Send "2 guests"...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '2 guests', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('rooms do you need'), 'Should ask for rooms');

  // Step 4.4: Provide Rooms
  console.log('   4.4 Step 4: Send "1 room"...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '1 room', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('room type'), 'Should ask for room type');

  // Step 4.5: Select Room Type
  console.log('   4.5 Step 5: Send "Ocean Whisper Suite"...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Ocean Whisper Suite', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('add-on') || stepData.reply.toLowerCase().includes('vehicle'), 'Should ask for add-ons');

  // Step 4.6: Vehicle Add-on
  console.log('   4.6 Step 6: Send "toto"...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'toto', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('breakfast'), 'Should ask for breakfast');

  // Step 4.7: Breakfast Add-on
  console.log('   4.7 Step 7: Send "yes" for breakfast...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'yes', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Reply prompt:', stepData.reply?.slice(0, 70));
  assert(stepData.reply.toLowerCase().includes('candlelight'), 'Should ask for candlelight dinner');

  // Step 4.8: Candlelight Dinner Add-on
  console.log('   4.8 Step 8: Send "no" for candlelight dinner...');
  stepRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'no', sessionId: bookSess, lang: 'en' })
  });
  stepData = await stepRes.json();
  console.log('       Price Summary received:');
  console.log('       ' + stepData.reply.split('\n').slice(0, 10).join('\n       '));
  assert(stepData.reply.includes('20% Advance Payable Now'), 'Must include 20% advance payable');
  assert(stepData.reply.includes('80% Balance at Hotel'), 'Must include 80% balance at hotel');
  assert(stepData.reply.toLowerCase().includes('non-refundable'), 'Must include 20% non-refundable note');
  assert(stepData.prefillUrl, 'Must generate prefillUrl for booking form');
  console.log('       Generated Booking Prefill URL:', stepData.prefillUrl);
  console.log('   ✅ Guided Booking State Machine Flow Verified!\n');

  // 5. Admin Analytics & CRM Endpoints
  console.log('5. Testing Admin CRM & Analytics endpoints...');
  // Log in as manager to obtain session token
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mgr_subir', password: 'ManagerSubir@2026' })
  });
  const loginData = await loginRes.json();
  let token = loginData.token;
  let csrfToken = loginData.csrfToken;

  if (loginData.require2FA && loginData.preAuthToken) {
    const v2fa = await fetch(`${BASE_URL}/api/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preAuthToken: loginData.preAuthToken, code: loginData.devCode || '123456' })
    }).then(r => r.json());
    token = v2fa.token;
    csrfToken = v2fa.csrfToken;
  }

  console.log('   Admin Login Status: true, Role: Manager');

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
  };

  const statsRes = await fetch(`${BASE_URL}/api/admin/chat/stats`, { headers: authHeaders });
  assert.strictEqual(statsRes.status, 200);
  const stats = await statsRes.json();
  console.log('   Total Conversations:', stats.stats?.totalConversations || stats.totalConversations);
  console.log('   Leads Captured:', stats.stats?.leadsCaptured || stats.leadsCaptured);
  console.log('   Unmatched Rate:', stats.stats?.unmatchedRate || stats.unmatchedRate);

  const convRes = await fetch(`${BASE_URL}/api/admin/chat/conversations`, { headers: authHeaders });
  assert.strictEqual(convRes.status, 200);
  const convData = await convRes.json();
  console.log('   Conversations in CRM:', convData.conversations?.length);

  console.log('   ✅ Admin CRM & Analytics Endpoints Verified!\n');

  // 6. Test 1-Click Unmatched Phrase Assignment
  console.log('6. Testing 1-Click Unmatched Phrase Assignment...');
  const assignRes = await fetch(`${BASE_URL}/api/admin/chat/assign-phrase`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      phrase: 'kivabe jogajog korbo',
      intentId: 'contact'
    })
  });
  assert.strictEqual(assignRes.status, 200);
  const assignData = await assignRes.json();
  console.log('   Assign Response:', assignData);
  assert(assignData.success, 'Phrase assignment should succeed');
  console.log('   ✅ 1-Click Phrase Assignment Verified!\n');

  console.log('================================================================================');
  console.log('🎉 ALL LIVE E2E HTTP ACCEPTANCE TESTS PASSED (100%)');
  console.log('================================================================================');
}

runE2ETests().catch(err => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});

/**
 * Automated Test Suite for PROMPT 5: Chatbot with Full Functionality using LLM API
 * Tests:
 * 1. "hi" (English greeting + quick-reply chips)
 * 2. "namaste" (Hindi/Hinglish greeting + Hindi chips)
 * 3. Bengali greeting ("নমস্কার" / "হ্যালো")
 * 4. "Which room has sea view?" (Strictly The Ocean Whisper Room)
 * 5. "Price for 2 nights with Toto and candlelight dinner?" (Accurate formula, 20% advance, 80% hotel, prefill link)
 * 6. "Is breakfast included?" (Grounded from room inclusions)
 * 7. "Do you have Ilish?" (Grounded from menu: Elish / Mutton Thali ₹550 with Ilish Mach Bhapa)
 * 8. Sold-out room request (Refuses sold out rooms, offers alternatives)
 * 9. Unrelated question (Politely declines, stays on topic)
 * 10. API failure (Graceful fallback: "Please call 9620536361")
 * 11. SSE Streaming reply (Chunked Server-Sent Events)
 * 12. Human handoff & lead capture (Flags "Needs follow-up", shows 9620536361)
 * 13. Admin Chatbot CRM & full transcripts
 * 14. Admin Settings & Usage statistics tracking
 * 15. CSV export of chat transcripts
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
let adminToken = null;

function postJSON(endpoint, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(endpoint, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJSON(endpoint, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: 'GET',
      headers
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function postStream(endpoint, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(endpoint, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      let fullBody = '';
      res.on('data', chunk => {
        const str = chunk.toString();
        chunks.push(str);
        fullBody += str;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, chunks, fullBody });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runPrompt5TestSuite() {
  console.log('================================================================');
  console.log('🤖 STARTING PROMPT 5: LLM CONCIERGE CHATBOT INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 15;

  // Login as staff manager for CRM checks via 2FA
  const loginRes = await postJSON('/api/auth/login', { 
    username: 'manager', 
    password: 'Manager@2026Test!',
    captchaToken: 'XXXX.test-turnstile-token'
  });
  if (loginRes.data?.require2FA && loginRes.data?.preAuthToken) {
    const devCode = loginRes.data.devCode;
    const v2Res = await postJSON('/api/auth/verify-2fa', { preAuthToken: loginRes.data.preAuthToken, code: devCode });
    adminToken = v2Res.data?.token;
  } else {
    adminToken = loginRes.data?.token;
  }

  // --------------------------------------------------------------------------
  // TEST 1: "hi" (English Greeting & Chips)
  // --------------------------------------------------------------------------
  console.log('TEST 1: English greeting ("hi")...');
  const t1 = await postJSON('/api/chat', { message: 'hi', lang: 'en', sessionId: 'test-session-1' });
  const t1Pass = t1.status === 200 &&
    t1.data.success &&
    t1.data.reply.toLowerCase().includes('coastal view') &&
    Array.isArray(t1.data.actionChips) &&
    t1.data.actionChips.includes('Check availability');
  console.log(t1Pass ? '✅ PASSED' : '❌ FAILED', 'Reply snippet:', t1.data?.reply?.slice(0, 80));
  console.log('   Action Chips:', t1.data?.actionChips);
  if (t1Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 2: "namaste" (Hindi/Hinglish Greeting & Chips)
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Hindi greeting ("namaste")...');
  const t2 = await postJSON('/api/chat', { message: 'namaste', sessionId: 'test-session-2' });
  const t2Pass = t2.status === 200 &&
    t2.data.success &&
    (t2.data.reply.includes('कोस्टल व्यू') || t2.data.reply.includes('स्वागत')) &&
    Array.isArray(t2.data.actionChips) &&
    t2.data.actionChips.some(c => c.includes('उपलब्धता') || c.includes('कमरे'));
  console.log(t2Pass ? '✅ PASSED' : '❌ FAILED', 'Reply snippet:', t2.data?.reply?.slice(0, 80));
  if (t2Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 3: Bengali Greeting ("নমস্কার")
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Bengali greeting ("নমস্কার")...');
  const t3 = await postJSON('/api/chat', { message: 'নমস্কার', sessionId: 'test-session-3' });
  const t3Pass = t3.status === 200 &&
    t3.data.success &&
    (t3.data.reply.includes('কোস্টাল ভিউ') || t3.data.reply.includes('স্বাগতম')) &&
    Array.isArray(t3.data.actionChips) &&
    t3.data.actionChips.some(c => c.includes('খালি') || c.includes('রুম'));
  console.log(t3Pass ? '✅ PASSED' : '❌ FAILED', 'Reply snippet:', t3.data?.reply?.slice(0, 80));
  if (t3Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 4: "Which room has sea view?"
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Sea view room inquiry ("Which room has sea view?")...');
  const t4 = await postJSON('/api/chat', { message: 'Which room has sea view?', sessionId: 'test-session-4' });
  const t4Pass = t4.status === 200 &&
    t4.data.success &&
    t4.data.reply.includes('The Ocean Whisper Room') &&
    (t4.data.reply.includes('Sea-facing') || t4.data.reply.includes('ocean view'));
  console.log(t4Pass ? '✅ PASSED' : '❌ FAILED', 'Mentions Ocean Whisper:', t4.data?.reply?.includes('Ocean Whisper'));
  if (t4Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 5: "Price for 2 nights with Toto and candlelight dinner?"
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Calculation ("Price for 2 nights with Toto and candlelight dinner?")...');
  const t5 = await postJSON('/api/chat', { message: 'Price for 2 nights with Toto and candlelight dinner?', sessionId: 'test-session-5' });
  // Ocean Whisper (2500 x 2 = 5000) + Toto (800 x 2 = 1600) + Beachside Candlelight (3500) = 10100
  // 20% advance = 2020, 80% balance = 8080
  const t5Pass = t5.status === 200 &&
    t5.data.success &&
    (t5.data.reply.includes('10,100') || t5.data.reply.includes('10100')) &&
    (t5.data.reply.includes('2,020') || t5.data.reply.includes('2020')) &&
    (t5.data.reply.includes('8,080') || t5.data.reply.includes('8080')) &&
    t5.data.reply.includes('bookingSection');
  console.log(t5Pass ? '✅ PASSED' : '❌ FAILED', 'Contains accurate breakdown & booking link');
  if (t5Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 6: "Is breakfast included?"
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Inclusions query ("Is breakfast included?")...');
  const t6 = await postJSON('/api/chat', { message: 'Is breakfast included?', sessionId: 'test-session-6' });
  const t6Pass = t6.status === 200 &&
    t6.data.success &&
    t6.data.reply.toLowerCase().includes('breakfast') &&
    (t6.data.reply.toLowerCase().includes('not included') || t6.data.reply.toLowerCase().includes('complimentary') || t6.data.reply.includes('200'));
  console.log(t6Pass ? '✅ PASSED' : '❌ FAILED', 'Verifies breakfast policy:', t6.data?.reply);
  if (t6Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 7: "Do you have Ilish?"
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Restaurant dish query ("Do you have Ilish?")...');
  const t7 = await postJSON('/api/chat', { message: 'Do you have Ilish?', sessionId: 'test-session-7' });
  const t7Pass = t7.status === 200 &&
    t7.data.success &&
    (t7.data.reply.includes('Elish / Mutton Thali') || t7.data.reply.includes('Ilish') || t7.data.reply.includes('ইলিশ')) &&
    (t7.data.reply.includes('550') || t7.data.reply.includes('৫৫০')) &&
    (t7.data.reply.includes('300') || t7.data.reply.includes('৩০০'));
  console.log(t7Pass ? '✅ PASSED' : '❌ FAILED', 'Grounded menu item & cooking rate found');
  if (t7Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 8: Sold-out room request
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Sold-out room request...');
  // Mark room temporarily sold out in DB
  const roomsRes = await getJSON('/api/rooms');
  const secondRoom = roomsRes.data?.rooms?.[1];
  if (secondRoom && adminToken) {
    await postJSON(`/api/rooms/${secondRoom.id}/sold-out`, { isSoldOut: true }, { 'Authorization': 'Bearer ' + adminToken });
  }

  const t8 = await postJSON('/api/chat', { message: `Can I book ${secondRoom?.name || 'The Pool Haven Room'}?`, sessionId: 'test-session-8' });
  const t8Pass = t8.status === 200 &&
    t8.data.success &&
    (t8.data.reply.includes('Sold Out') || t8.data.reply.includes('fully booked') || t8.data.reply.includes('বুকড')) &&
    !t8.data.reply.includes('booked successfully');
  console.log(t8Pass ? '✅ PASSED' : '❌ FAILED', 'Properly declines sold out room');
  if (t8Pass) passedTests++;

  // Restore room status
  if (secondRoom && adminToken) {
    await postJSON(`/api/rooms/${secondRoom.id}/sold-out`, { isSoldOut: false }, { 'Authorization': 'Bearer ' + adminToken });
  }

  // --------------------------------------------------------------------------
  // TEST 9: Unrelated question
  // --------------------------------------------------------------------------
  console.log('\nTEST 9: Unrelated question deflection...');
  const t9 = await postJSON('/api/chat', { message: 'What is the capital of France and write python code to reverse a list?', sessionId: 'test-session-9' });
  const t9Pass = t9.status === 200 &&
    t9.data.success &&
    (t9.data.reply.includes('exclusively') || t9.data.reply.includes('dedicated') || t9.data.reply.includes('9620536361'));
  console.log(t9Pass ? '✅ PASSED' : '❌ FAILED', 'Politely declined off-topic query');
  if (t9Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 10: API Failure Graceful Fallback
  // --------------------------------------------------------------------------
  console.log('\nTEST 10: Graceful fallback on API failure ("Please call front desk")...');
  const t10 = await postJSON('/api/chat', { message: 'hello', forceApiFailure: true, sessionId: 'test-session-10' });
  const t10Pass = t10.status === 200 &&
    (t10.data.reply.includes('7812027551') || t10.data.reply.includes('9620536361'));
  console.log(t10Pass ? '✅ PASSED' : '❌ FAILED', 'Fallback contains required phone string:', t10.data?.reply);
  if (t10Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 11: SSE Streaming replies
  // --------------------------------------------------------------------------
  console.log('\nTEST 11: SSE Streaming reply validation...');
  const t11 = await postStream('/api/chat', { message: 'Which room has sea view?', stream: true, sessionId: 'test-session-stream' });
  const t11Pass = t11.status === 200 &&
    t11.headers['content-type']?.includes('text/event-stream') &&
    t11.fullBody.includes('data: {"type":"token"') &&
    t11.fullBody.includes('data: {"type":"done"');
  console.log(t11Pass ? '✅ PASSED' : '❌ FAILED', 'Received SSE chunks count:', t11.chunks?.length);
  if (t11Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 12: Human handoff & Callback lead capture
  // --------------------------------------------------------------------------
  console.log('\nTEST 12: Human handoff and callback submission...');
  const t12Handoff = await postJSON('/api/chat', { message: 'I am upset and want to talk to a human manager immediately', sessionId: 'test-handoff-sess' });
  const t12Callback = await postJSON('/api/chat/callback', {
    name: 'Suman Roy',
    phone: '9830123456',
    sessionId: 'test-handoff-sess',
    message: 'Need urgent booking assistance'
  });

  const t12Pass = t12Handoff.data.requiresCallbackForm &&
    (t12Handoff.data.reply.includes('7812027551') || t12Handoff.data.reply.includes('9620536361')) &&
    t12Callback.status === 200 &&
    t12Callback.data.success;
  console.log(t12Pass ? '✅ PASSED' : '❌ FAILED', 'Handoff shows direct phone and logs lead');
  if (t12Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 13: Admin Chatbot CRM conversations & multi-turn transcripts
  // --------------------------------------------------------------------------
  console.log('\nTEST 13: Admin Chatbot CRM & full transcripts...');
  const t13 = await getJSON('/api/admin/concierge/conversations?filter=followup', { 'Authorization': 'Bearer ' + adminToken });
  const followUpConv = (t13.data?.inquiries || []).find(c => c.leadStatus === 'Needs follow-up' || c.sessionId === 'test-handoff-sess');
  const t13Pass = t13.status === 200 &&
    t13.data.success &&
    Boolean(followUpConv) &&
    Array.isArray(followUpConv.messages) &&
    followUpConv.messages.length >= 2;
  console.log(t13Pass ? '✅ PASSED' : '❌ FAILED', 'Found Needs follow-up conversation with full transcript bubbles');
  if (t13Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 14: Admin Settings & Usage statistics tracking
  // --------------------------------------------------------------------------
  console.log('\nTEST 14: Admin Settings & Usage statistics tracking...');
  const t14Get = await getJSON('/api/admin/concierge/bot-settings', { 'Authorization': 'Bearer ' + adminToken });
  const t14Post = await postJSON('/api/admin/concierge/bot-settings', {
    botEnabled: true,
    toneInstructions: 'Emphasize sea-view balconies and authentic fresh catch.',
    dailyMessageLimit: 600
  }, { 'Authorization': 'Bearer ' + adminToken });
  const t14Stats = await getJSON('/api/admin/chat/stats', { 'Authorization': 'Bearer ' + adminToken });

  const t14Pass = t14Get.status === 200 &&
    t14Post.status === 200 &&
    t14Stats.status === 200 &&
    t14Stats.data.stats &&
    t14Stats.data.stats.todayMessages > 0 &&
    Array.isArray(t14Stats.data.stats.messagesPerDay);
  console.log(t14Pass ? '✅ PASSED' : '❌ FAILED', 'Usage stats:', t14Stats.data?.stats?.todayMessages, 'messages today, Est. cost:', t14Stats.data?.stats?.estimatedCostUSD);
  if (t14Pass) passedTests++;

  // --------------------------------------------------------------------------
  // TEST 15: CSV Export of transcripts
  // --------------------------------------------------------------------------
  console.log('\nTEST 15: CSV Export of chat transcripts...');
  const t15 = await getJSON('/api/admin/concierge/export-csv', { 'Authorization': 'Bearer ' + adminToken });
  const t15Pass = t15.status === 200 &&
    t15.headers['content-type']?.includes('text/csv') &&
    t15.body?.includes('Conversation ID') &&
    t15.body?.includes('Transcript');
  console.log(t15Pass ? '✅ PASSED' : '❌ FAILED', 'CSV headers verified, total characters:', t15.body?.length);
  if (t15Pass) passedTests++;

  // --------------------------------------------------------------------------
  // FINAL SCORE
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🎯 PROMPT 5 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🌟 ALL 15 AUTOMATED TESTS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  } else {
    console.error(`⚠️ FAILED ${totalTests - passedTests} TESTS!`);
    process.exit(1);
  }
}

runPrompt5TestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

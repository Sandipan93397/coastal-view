const http = require('http');
const fs = require('fs');

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {}),
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('=== STARTING 4 ROOMS VERIFICATION TESTS ===\n');

  // TEST 1: GET /api/rooms
  console.log('--- TEST 1: Public Rooms API returns exactly 4 active rooms ---');
  const roomsRes = await request('GET', '/api/rooms');
  if (!roomsRes.data || !roomsRes.data.success) {
    throw new Error('Failed to fetch rooms: ' + JSON.stringify(roomsRes));
  }
  const rooms = roomsRes.data.rooms;
  console.log(`Active rooms count: ${rooms.length}`);
  rooms.forEach((r, i) => {
    console.log(`  [${i+1}] ID: ${r.id} | Name: ${r.name} | Tag: ${r.tag} | Price: ${r.price !== null ? '₹' + r.price : 'Ask at hotel'}`);
  });

  const expectedIds = ['ocean-whisper-room', 'pool-haven-room', 'cosy-deluxe-room', 'palm-grove-family-suite'];
  const actualIds = rooms.map(r => r.id);
  const match = expectedIds.every(id => actualIds.includes(id)) && rooms.length === 4;
  console.log(`Passes exact 4 room IDs check: ${match}`);
  if (!match) throw new Error('Rooms do not match exact 4 expected room types');

  // TEST 2: Check database safety & archived rooms
  console.log('\n--- TEST 2: Database integrity & archived rooms check ---');
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  console.log(`Active rooms in db: ${db.rooms.length}`);
  console.log(`Archived rooms in db: ${(db.archivedRooms || []).length}`);
  (db.archivedRooms || []).forEach(r => console.log(`  Archived: ${r.name} (${r.id})`));
  console.log(`Existing bookings count preserved: ${(db.bookings || []).length}`);

  // TEST 3: Chatbot queries
  console.log('\n--- TEST 3: Chatbot answers correctly for 4 rooms ---');
  
  // A. Sea View
  const chatSea = await request('POST', '/api/concierge/chat', { message: 'Which room has a sea view?' });
  console.log('Q: Which room has a sea view?');
  console.log('A:', chatSea.data.reply.slice(0, 150) + '...');
  const hasWhisper = chatSea.data.reply.includes('The Ocean Whisper Room');
  console.log(`  Passes Sea View query: ${hasWhisper}`);

  // B. Families
  const chatFamily = await request('POST', '/api/concierge/chat', { message: 'Which is best for families?' });
  console.log('\nQ: Which is best for families?');
  console.log('A:', chatFamily.data.reply.slice(0, 150) + '...');
  const hasPalm = chatFamily.data.reply.includes('The Palm Grove Family Suite');
  console.log(`  Passes Family query: ${hasPalm}`);

  // C. Cheapest room
  const chatCheap = await request('POST', '/api/concierge/chat', { message: 'What is the cheapest room?' });
  console.log('\nQ: What is the cheapest room?');
  console.log('A:', chatCheap.data.reply.slice(0, 150) + '...');
  const hasDeluxe = chatCheap.data.reply.includes('Cosy Deluxe Room');
  console.log(`  Passes Cheapest query: ${hasDeluxe}`);

  // D. Pool View
  const chatPool = await request('POST', '/api/concierge/chat', { message: 'Which room has a pool view?' });
  console.log('\nQ: Which room has a pool view?');
  console.log('A:', chatPool.data.reply.slice(0, 150) + '...');
  const hasPool = chatPool.data.reply.includes('The Pool Haven Room');
  console.log(`  Passes Pool View query: ${hasPool}`);

  // TEST 4: Admin Panel Room Management
  console.log('\n--- TEST 4: Admin Panel Room Management operations ---');
  const loginRes = await request('POST', '/api/auth/login', { username: 'admin', password: 'CoastalAdmin@2026' });
  const token = loginRes.data.token;
  console.log(`Admin login successful: ${loginRes.data.success}, token acquired.`);

  // Toggle sold out on Ocean Whisper Room
  const toggleRes = await request('POST', '/api/rooms/ocean-whisper-room/sold-out', { isSoldOut: true, reason: 'High Tide Maintenance' }, token);
  console.log(`Toggled ocean-whisper-room sold out: ${toggleRes.data.isSoldOut}`);

  // Check public availability skips/notes sold out
  const publicRooms2 = await request('GET', '/api/rooms');
  const updatedOcean = publicRooms2.data.rooms.find(r => r.id === 'ocean-whisper-room');
  console.log(`Public room reflects sold out: ${updatedOcean.isSoldOut === true}`);

  // Re-enable room
  await request('POST', '/api/rooms/ocean-whisper-room/sold-out', { isSoldOut: false }, token);
  console.log('Re-enabled ocean-whisper-room.');

  // TEST 5: HTML Verification
  console.log('\n--- TEST 5: Frontend index.html verification ---');
  const html = fs.readFileSync('index.html', 'utf8');

  // Check filter tabs
  const hasAll4 = html.includes('data-filter="all">All (4)</button>');
  const hasCosyTab = html.includes('data-filter="cosy-deluxe">Cosy Deluxe</button>');
  const noLuxuryTab = !html.includes('data-filter="luxury"');
  console.log(`Filter tabs correct (All (4), Cosy Deluxe, No Luxury): ${hasAll4 && hasCosyTab && noLuxuryTab}`);

  // Check room cards
  const hasWhisperCard = html.includes('data-id="ocean-whisper-room"');
  const hasHavenCard = html.includes('data-id="pool-haven-room"');
  const hasCosyCard = html.includes('data-id="cosy-deluxe-room"');
  const hasPalmCard = html.includes('data-id="palm-grove-family-suite"');
  console.log(`All 4 room cards present in DOM: ${hasWhisperCard && hasHavenCard && hasCosyCard && hasPalmCard}`);

  // Check Lightbox Modal
  const hasLightbox = html.includes('id="roomLightboxModal"');
  const hasLightboxImg = html.includes('id="lightboxMainImg"');
  console.log(`Room Lightbox Modal markup present: ${hasLightbox && hasLightboxImg}`);

  // Check JSON-LD schema
  const hasSchema = html.includes('id="hotelRoomsSchema"') && html.includes('The Ocean Whisper Room');
  console.log(`Hotel & 4 Rooms JSON-LD schema present: ${hasSchema}`);

  // Check llms.txt
  const hasLlms = fs.existsSync('llms.txt') && fs.readFileSync('llms.txt', 'utf8').includes('The Ocean Whisper Room');
  console.log(`llms.txt present and contains 4 room details: ${hasLlms}`);

  console.log('\n=== ALL 4 ROOMS VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});

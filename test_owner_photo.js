const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('========================================');
  console.log('RUNNING OWNER PHOTO SYSTEM VERIFICATION');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Files exist
  const files = [
    'uploads/owner/anirban-das-owner.webp',
    'uploads/owner/anirban-das-owner-large.webp',
    'uploads/owner/anirban-das-owner-med.webp',
    'uploads/owner/anirban-das-owner-thumb.webp',
    'uploads/owner/archive/anirban-das-owner.jpg',
    'assets/images/archive/anirban-das-owner.jpg',
    'assets/images/anirban-das-owner.jpg'
  ];

  for (const f of files) {
    const full = path.resolve('c:/mandarmaniproject', f);
    assert(fs.existsSync(full) && fs.statSync(full).size > 0, `File exists & non-empty: ${f}`);
  }

  // 2. HTTP serving
  const httpUrls = [
    'http://localhost:3000/uploads/owner/anirban-das-owner.webp',
    'http://localhost:3000/uploads/owner/anirban-das-owner-med.webp',
    'http://localhost:3000/uploads/owner/anirban-das-owner-thumb.webp'
  ];

  for (const u of httpUrls) {
    try {
      const res = await fetch(u);
      assert(res.status === 200 && res.headers.get('content-type') === 'image/webp', `HTTP 200 image/webp for ${u}`);
    } catch (e) {
      assert(false, `HTTP request failed for ${u}: ${e.message}`);
    }
  }

  // 3. Database structure
  const db = JSON.parse(fs.readFileSync('c:/mandarmaniproject/data/db.json', 'utf8'));
  assert(db.mediaSlots && db.mediaSlots.owner, 'db.mediaSlots.owner exists');
  assert(db.mediaSlots.owner.url === '/uploads/owner/anirban-das-owner.webp', 'db.mediaSlots.owner.url is /uploads/owner/anirban-das-owner.webp');
  assert(db.mediaSlots.owner.prevUrl === 'assets/images/anirban-das-owner.jpg', 'db.mediaSlots.owner.prevUrl preserves original image path');
  assert(db.mediaSlots.owner.alt === "Anirban Das, owner of Coastal View and Ani's Tour and Travels, Mandarmani", 'db.mediaSlots.owner.alt matches required alt text');

  assert(db.websiteContent && db.websiteContent.owner && db.websiteContent.owner.photo === '/uploads/owner/anirban-das-owner.webp', 'db.websiteContent.owner.photo is updated');

  const ownerHistory = (db.mediaHistory || []).find(h => h.slotId === 'owner');
  assert(!!ownerHistory, 'db.mediaHistory has restore entry for owner slot');
  if (ownerHistory) {
    assert(ownerHistory.url === 'assets/images/anirban-das-owner.jpg', 'mediaHistory restore url matches original image');
  }

  // 4. HTML structure
  const html = fs.readFileSync('c:/mandarmaniproject/index.html', 'utf8');
  assert(html.includes('/uploads/owner/anirban-das-owner.webp'), 'index.html contains /uploads/owner/anirban-das-owner.webp');
  assert(html.includes('alt="Anirban Das, owner of Coastal View and Ani\'s Tour and Travels, Mandarmani"'), 'index.html has exact required alt text');
  assert(html.includes('class="owner-img"'), 'index.html retains owner-img class');
  assert(html.includes('class="owner-image-wrapper"'), 'index.html retains owner-image-wrapper');
  assert(html.includes('Anirban Das'), 'index.html text intact');
  assert(!html.includes('Founder & Managing Host'), 'index.html removed Founder & Managing Host badge text');
  assert(html.includes('class="owner-badge-floating"'), 'index.html retains owner-badge-floating');
  assert(html.includes('class="owner-badge-title">Anirban Das</div>'), 'index.html retains owner-badge-title with Anirban Das');

  // 5. CSS styles
  const css = fs.readFileSync('c:/mandarmaniproject/assets/css/style.css', 'utf8');
  assert(css.includes('object-fit: cover;'), 'style.css has object-fit: cover for owner image');
  assert(css.includes('object-position: center 12%;'), 'style.css centers face vertically & horizontally');
  assert(css.includes('ownerBorderShine'), 'style.css preserves animated gold border shine animation');
  assert(css.includes('transform: scale(1.03);'), 'style.css preserves hover scale animation');
  assert(css.includes('.owner-badge-floating'), 'style.css contains .owner-badge-floating');
  assert(css.includes('@media (max-width: 600px)') && css.includes('.owner-badge-floating'), 'style.css has mobile styling for .owner-badge-floating');

  // 6. Admin & Database Defaults
  assert(db.websiteContent && db.websiteContent.owner && db.websiteContent.owner.title === '', 'db.websiteContent.owner.title is blank by default');

  console.log(`\nVerification Complete: ${passed} Passed, ${failed} Failed.`);
}

runTests().catch(e => console.error(e));

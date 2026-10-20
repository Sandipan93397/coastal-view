const fs = require('fs');

async function verify() {
  console.log('--- Checking Live Server Output ---');
  const res = await fetch('http://localhost:3000/');
  const html = await res.text();

  const hasOldBadgeText = html.includes('Founder & Managing Host');
  const hasOwnerName = html.includes('Anirban Das');
  const hasBadgeTitle = html.includes('<div class="owner-badge-title">Anirban Das</div>');
  const hasBadgeWrapper = html.includes('class="owner-badge-floating"');
  const hasWelcomeHeading = html.includes('A Warm Welcome to Coastal View');

  console.log('Old badge text present (should be false):', hasOldBadgeText);
  console.log('Owner name present (should be true):', hasOwnerName);
  console.log('Badge title markup present (should be true):', hasBadgeTitle);
  console.log('Floating badge wrapper present (should be true):', hasBadgeWrapper);
  console.log('Welcome message present (should be true):', hasWelcomeHeading);

  console.log('\n--- Checking CSS Rules ---');
  const css = fs.readFileSync('assets/css/style.css', 'utf8');
  console.log('Badge floating flex alignment:', css.includes('.owner-badge-floating') && css.includes('align-items: center'));
  console.log('Empty badge sub hidden:', css.includes('.owner-badge-sub:empty'));
  console.log('Mobile media query for badge:', css.includes('@media (max-width: 600px)') && css.includes('.owner-badge-floating'));

  console.log('\n--- Checking Database & Admin Panel Defaults ---');
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  console.log('DB owner title is blank:', db.websiteContent?.owner?.title === '');

  const adminHtml = fs.readFileSync('admin/index.html', 'utf8');
  console.log('Admin ownerTitle field removed:', !adminHtml.includes('id="ownerTitle"'));

  if (!hasOldBadgeText && hasOwnerName && hasBadgeTitle && hasBadgeWrapper && hasWelcomeHeading && db.websiteContent?.owner?.title === '') {
    console.log('\n>>> ALL VERIFICATIONS SUCCESSFUL <<<');
  } else {
    console.error('\n>>> VERIFICATION FAILED <<<');
    process.exit(1);
  }
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});

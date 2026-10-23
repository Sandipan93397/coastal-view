const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING NAVIGATION & SCROLL FIXES ===\n');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'assets', 'js', 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'assets', 'css', 'style.css'), 'utf8');

let allPassed = true;

function testCheck(category, name, condition) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${category}: ${name}`);
  if (!condition) allPassed = false;
}

// 1. Navbar links & Section IDs
const navLinks = [
  { href: '#hero', targetId: 'hero' },
  { href: '#owner', targetId: 'owner' },
  { href: '#rooms', targetId: 'rooms' },
  { href: '#amenities', targetId: 'amenities' },
  { href: '#restaurant', targetId: 'restaurant' },
  { href: '#mocktails', targetId: 'mocktails' },
  { href: '#candlelight', targetId: 'candlelight' },
  { href: '#nearby', targetId: 'nearby' },
  { href: '#location', targetId: 'location' },
  { href: '#tours', targetId: 'tours' }
];

navLinks.forEach(({ href, targetId }) => {
  const hasNavLink = html.includes(`href="${href}"`);
  const hasTargetSection = html.includes(`id="${targetId}"`);
  testCheck('NAV & SECTIONS', `Navbar has ${href}`, hasNavLink);
  testCheck('NAV & SECTIONS', `Page has element with id="${targetId}"`, hasTargetSection);
});

// Aliases for backwards compatibility
testCheck('ALIASES', 'Cocktail section has #lounge alias', html.includes('id="lounge"'));
testCheck('ALIASES', 'Nearby section has #places alias', html.includes('id="places"'));
testCheck('ALIASES', 'Restaurant section has #menu alias', html.includes('id="menu"'));

// 2. JS: IntersectionObserver must NOT contain p.scrollIntoView
const observerBugFixed = !js.includes('p.scrollIntoView');
testCheck('JS OBSERVER', 'IntersectionObserver does NOT call p.scrollIntoView', observerBugFixed);

// 3. JS: Smooth Nav & Sticky Offset
testCheck('JS SMOOTH NAV', 'initSmoothNav function exists', js.includes('function initSmoothNav()'));
testCheck('JS SMOOTH NAV', 'Navbar click handler updates URL hash via pushState', js.includes('history.pushState'));
testCheck('JS SMOOTH NAV', 'Handles initial window.location.hash on page load', js.includes('window.location.hash'));
testCheck('JS SMOOTH NAV', 'initNavbarScrollSpy highlights active nav link', js.includes('function initNavbarScrollSpy()'));

// 4. CSS: Scroll margins & Active link styles
testCheck('CSS OFFSETS', 'scroll-margin-top configured for sections', css.includes('scroll-margin-top: 85px;'));
testCheck('CSS OFFSETS', 'Mobile scroll-margin-top configured (75px)', css.includes('scroll-margin-top: 75px;'));
testCheck('CSS AESTHETICS', '.nav-link.active styling present', css.includes('.nav-link.active'));
testCheck('CSS AESTHETICS', 'dish images have aspect-ratio: 1 / 1', css.includes('aspect-ratio: 1 / 1;'));

console.log('\n----------------------------------------');
console.log(allPassed ? 'ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!' : 'SOME CHECKS FAILED!');
console.log('----------------------------------------');

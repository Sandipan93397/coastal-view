const fs = require('fs');
const path = require('path');

console.log("=== VERIFYING LOGO INTEGRATION ACROSS WEBSITE & ADMIN PORTAL ===");

const files = [
  'assets/images/logo.png',
  'assets/images/logo.jpg',
  'assets/images/logo-emblem.png',
  'assets/images/favicon.png'
];

files.forEach(f => {
  const p = path.join(__dirname, f);
  const exists = fs.existsSync(p);
  const size = exists ? fs.statSync(p).size : 0;
  console.log(`[${exists && size > 0 ? 'PASS' : 'FAIL'}] File: ${f} (${size} bytes)`);
});

const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, 'assets/css/style.css'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, 'admin/index.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(__dirname, 'admin/admin.css'), 'utf8');

const htmlChecks = [
  { name: 'Favicon linked in index.html', test: indexHtml.includes('assets/images/favicon.png') },
  { name: 'Apple touch icon linked in index.html', test: indexHtml.includes('assets/images/logo-emblem.png') },
  { name: 'Site brand logo img in nav', test: indexHtml.includes('class="site-brand-logo"') && indexHtml.includes('assets/images/logo.png') },
  { name: 'Footer brand logo img in footer', test: indexHtml.includes('class="footer-brand-logo"') && indexHtml.includes('assets/images/logo.png') },
  { name: 'Concierge avatar image in chatbot', test: indexHtml.includes('class="concierge-avatar-img"') && indexHtml.includes('assets/images/logo-emblem.png') }
];

htmlChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] index.html: ${c.name}`);
});

const cssChecks = [
  { name: '.site-brand-logo styling in style.css', test: styleCss.includes('.site-brand-logo') },
  { name: '.footer-brand-logo styling in style.css', test: styleCss.includes('.footer-brand-logo') },
  { name: '.concierge-avatar-img styling in style.css', test: styleCss.includes('.concierge-avatar-img') },
  { name: 'Mobile responsiveness for site logo', test: (styleCss.includes('@media (max-width: 992px)') || styleCss.includes('@media (max-width: 600px)')) && styleCss.includes('.site-brand-logo') }
];

cssChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] style.css: ${c.name}`);
});

const adminChecks = [
  { name: 'Admin favicon in admin/index.html', test: adminHtml.includes('favicon.png') },
  { name: 'Admin login logo in admin/index.html', test: adminHtml.includes('admin-login-logo') && adminHtml.includes('logo.png') },
  { name: 'Admin sidebar emblem in admin/index.html', test: adminHtml.includes('sidebar-logo-img') && adminHtml.includes('logo-emblem.png') },
  { name: 'Admin login logo styling in admin.css', test: adminCss.includes('.admin-login-logo') },
  { name: 'Admin sidebar logo styling in admin.css', test: adminCss.includes('.sidebar-logo-img') }
];

adminChecks.forEach(c => {
  console.log(`[${c.test ? 'PASS' : 'FAIL'}] admin: ${c.name}`);
});

console.log("\n=== ALL LOGO CHECKS EVALUATED ===");


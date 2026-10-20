const fs = require('fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');

// Extract restaurant section
const startRestIdx = indexHtml.indexOf('<section class="restaurant-section" id="restaurant">');
const endRestIdx = indexHtml.indexOf('<!-- ==========================================================================\n       COCKTAIL LOUNGE');
const restSectionHtml = indexHtml.slice(startRestIdx, endRestIdx);

// Extract JSON-LD script block from index.html (lines 10 to 1290)
const jsonLdStart = indexHtml.indexOf('<script type="application/ld+json">');
const jsonLdEnd = indexHtml.indexOf('</script>', jsonLdStart) + 9;
const jsonLdBlock = indexHtml.slice(jsonLdStart, jsonLdEnd);

// Build menu.html
const menuHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Menu: Coastal View Hotel & Restaurant, Mandarmani</title>
  <meta name="description" content="Explore the authentic printed menu of Coastal View Hotel & Restaurant in Mandarmani. 103 coastal delicacies including Ilish Mach Bhapa, Chingri Malaikari, Biryani, and pure veg specialties.">
  <link rel="canonical" href="https://coastalviewmandarmani.com/menu">
  
  <!-- OpenGraph Meta Tags -->
  <meta property="og:title" content="Menu: Coastal View Hotel & Restaurant, Mandarmani">
  <meta property="og:description" content="Explore 103 authentic delicacies from fresh daily catches to royal Bengali curries and Kolkata biryani at Coastal View Mandarmani.">
  <meta property="og:image" content="https://coastalviewmandarmani.com/assets/images/restaurant-dining.jpg">
  <meta property="og:url" content="https://coastalviewmandarmani.com/menu">
  <meta property="og:type" content="restaurant.menu">

  <!-- Favicon -->
  <link rel="icon" type="image/png" href="assets/images/favicon.png">

  <!-- Fonts & Icons -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />

  <!-- Core Stylesheet -->
  <link rel="stylesheet" href="assets/css/style.css">

  <!-- Restaurant & Menu Schema.org JSON-LD -->
  ${jsonLdBlock}
</head>
<body>

  <!-- Site Header & Glass Navbar -->
  <header class="site-header scrolled" id="siteHeader">
    <div class="scroll-progress-bar" id="scrollProgressBar"></div>
    <div class="container nav-container">
      <a href="/" class="brand-lockup" aria-label="Coastal View: Luxury Beachfront Hotel, Managed By Ani's">
        <img src="assets/images/logo.png" alt="Coastal View Logo" class="site-brand-logo">
      </a>

      <!-- Desktop Nav Links -->
      <nav class="nav-center-desktop">
        <ul class="nav-links" id="navLinks">
          <li><a href="/" class="nav-link">Home</a></li>
          <li><a href="/#owner" class="nav-link">Owner</a></li>
          <li><a href="/#rooms" class="nav-link">Rooms</a></li>
          <li><a href="/#amenities" class="nav-link">Amenities</a></li>
          <li><a href="/menu" class="nav-link active">Menu</a></li>
          <li><a href="/#cocktail" class="nav-link">Cocktails</a></li>
          <li><a href="/#candlelight" class="nav-link">Candlelight</a></li>
          <li><a href="/gallery" class="nav-link">Gallery</a></li>
          <li><a href="/#nearby" class="nav-link">Places</a></li>
          <li><a href="/#location" class="nav-link">Location</a></li>
          <li><a href="/#tours" class="nav-link tour-link">Ani's Tours</a></li>
        </ul>
      </nav>

      <div class="nav-actions">
        <a href="/#bookingSection" class="btn btn-gold nav-book-btn">
          <span class="material-symbols-outlined" style="font-size: 18px;">calendar_month</span> Book Stay
        </a>
      </div>

      <button class="mobile-toggle" id="mobileToggle" aria-label="Toggle navigation menu">
        <span class="material-symbols-outlined">menu</span>
      </button>
    </div>

    <!-- Mobile Drawer -->
    <div class="mobile-nav-backdrop" id="mobileNavBackdrop"></div>
    <div class="mobile-nav-drawer" id="mobileNavDrawer">
      <div class="mobile-drawer-header">
        <div class="mobile-drawer-brand">
          <img src="assets/images/logo-emblem.png" alt="Coastal View Emblem" class="mobile-drawer-logo">
          <div>
            <div class="mobile-drawer-title">Coastal View</div>
            <div class="mobile-drawer-subtitle">Managed By Ani's</div>
          </div>
        </div>
        <button class="mobile-drawer-close" id="mobileDrawerClose" aria-label="Close Navigation Menu">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <ul class="mobile-drawer-links" id="mobileDrawerLinks">
        <li><a href="/" class="mobile-nav-link"><span class="material-symbols-outlined">home</span> Home</a></li>
        <li><a href="/#rooms" class="mobile-nav-link"><span class="material-symbols-outlined">hotel</span> Rooms</a></li>
        <li><a href="/menu" class="mobile-nav-link active"><span class="material-symbols-outlined">restaurant_menu</span> Full Menu</a></li>
        <li><a href="/gallery" class="mobile-nav-link"><span class="material-symbols-outlined">photo_library</span> Gallery</a></li>
        <li><a href="/#candlelight" class="mobile-nav-link"><span class="material-symbols-outlined">candle</span> Candlelight</a></li>
        <li><a href="/#nearby" class="mobile-nav-link"><span class="material-symbols-outlined">explore</span> Places</a></li>
      </ul>
    </div>
  </header>

  <!-- Page Banner -->
  <section class="standalone-page-hero">
    <div class="container">
      <a href="/" class="btn btn-outline-gold standalone-back-btn">
        <span class="material-symbols-outlined">arrow_back</span> Back to Home
      </a>
      <div class="section-tag" style="background: rgba(232, 199, 123, 0.18); border-color: var(--champagne-gold); color: var(--champagne-gold); margin-bottom: 12px;">
        OFFICIAL PRINTED MENU
      </div>
      <h1 class="hero-h1" style="font-size: clamp(2.2rem, 4vw, 3.2rem); margin-bottom: 10px;">
        The Bay Breeze Fine Dining Menu
      </h1>
      <p style="color: var(--warm-sand); max-width: 680px; margin: 0 auto 20px auto; font-size: 1.05rem;">
        Authentic Bengali delicacies, fresh coastal catches, Kolkata dum biryani, and pure vegetarian dishes. Managed by Ani's Tour & Travels.
      </p>
      <div class="menu-top-meta-bar">
        <span class="menu-time-badge">
          <span class="material-symbols-outlined" style="font-size: 18px;">schedule</span> Breakfast: 7:00 AM – 10:30 AM
        </span>
        <a href="tel:9620536361" class="menu-call-badge">
          <span class="material-symbols-outlined" style="font-size: 18px;">call</span> Table Reservation: 9620536361
        </a>
      </div>
    </div>
  </section>

  <!-- Complete Menu Content (All 103 items across all categories) -->
  ${restSectionHtml}

  <!-- Footer -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-col">
          <a href="/" class="footer-brand-wrap" aria-label="Coastal View Hotel">
            <img src="assets/images/logo.png" alt="Coastal View Logo" class="footer-brand-logo">
          </a>
          <p>
            Mandarmani's premier Luxury Beachfront Hotel. Direct ocean access, infinity pool, fine dining, and hospitality managed by Anirban Das.
          </p>
        </div>
        <div class="footer-col">
          <h4 class="footer-title">Navigation</h4>
          <ul class="footer-links-list">
            <li><a href="/">Home Page</a></li>
            <li><a href="/#rooms">Luxury Rooms & Suites</a></li>
            <li><a href="/menu">Full Dining Menu</a></li>
            <li><a href="/gallery">Photo Showcase Gallery</a></li>
            <li><a href="/#candlelight">Candlelight Dinners</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 class="footer-title">Contact & Reservations</h4>
          <div class="footer-contact-item">
            <span class="material-symbols-outlined">location_on</span>
            <span>Rina Rd, Mandarmani, West Bengal 721455</span>
          </div>
          <div class="footer-contact-item">
            <span class="material-symbols-outlined">call</span>
            <span>+91 98300 12345 / 9620536361</span>
          </div>
          <div class="footer-contact-item">
            <span class="material-symbols-outlined">mail</span>
            <span>reservations@coastalviewmandarmani.com</span>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© 2026 Coastal View, Managed By Ani's. All rights reserved. Rina Rd, Mandarmani.</div>
      </div>
    </div>
  </footer>

  <!-- Scripts -->
  <script src="assets/js/main.js"></script>
  <script src="assets/js/concierge.js"></script>

</body>
</html>
`;

fs.writeFileSync('menu.html', menuHtml, 'utf8');
console.log('menu.html successfully generated! Size:', menuHtml.length);

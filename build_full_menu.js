const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const phone = db.settings?.menuPhone || "+91 7812027551";
const cleanPhone = phone.replace(/\s+/g, '');
const menuNote = db.settings?.menuNote || "Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.";

const categories = db.menuCategories;
const dishes = db.restaurant;

// Category slug helper
function catSlug(name) {
  return 'cat-' + name.toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Generate JSON-LD Menu Schema
function generateMenuJsonLd() {
  const schemaObj = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "name": "Coastal View Hotel & Restaurant, Mandarmani",
    "image": "https://coastalviewmandarmani.com/assets/images/restaurant-dining.jpg",
    "telephone": cleanPhone,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Rina Rd",
      "addressLocality": "Mandarmani",
      "addressRegion": "West Bengal",
      "postalCode": "721455",
      "addressCountry": "IN"
    },
    "servesCuisine": [
      "Bengali",
      "Seafood",
      "North Indian",
      "Chinese",
      "Mocktails"
    ],
    "openingHours": "Mo-Su 07:00-23:00",
    "hasMenu": {
      "@type": "Menu",
      "name": "Coastal View Official Restaurant Printed Menu",
      "hasMenuSection": categories.map(cat => {
        const catDishes = dishes.filter(d => d.category === cat.name);
        return {
          "@type": "MenuSection",
          "name": cat.name,
          "hasMenuItem": catDishes.map(d => {
            const itemObj = {
              "@type": "MenuItem",
              "name": d.name,
              "description": d.description || `${d.name} prepared fresh with authentic coastal spices.`,
              "offers": {
                "@type": "Offer",
                "price": String(d.price || 0),
                "priceCurrency": "INR"
              },
              "suitableForDiet": d.isVeg ? "https://schema.org/VegetarianDiet" : undefined
            };
            if (!itemObj.suitableForDiet) delete itemObj.suitableForDiet;
            return itemObj;
          })
        };
      })
    }
  };

  return JSON.stringify(schemaObj, null, 2);
}

// Build Dish Card HTML
function renderDishCard(d) {
  const isVeg = d.isVeg !== false;
  const dietClass = isVeg ? 'veg' : 'nonveg';
  const dietTitle = isVeg ? 'Vegetarian' : 'Non-Vegetarian';
  const cat = categories.find(c => c.name === d.category);
  const catIcon = cat ? cat.icon : 'restaurant';

  const thumbHtml = d.image
    ? `<img src="${d.image}" alt="Coastal View Mandarmani - ${d.name}" class="dish-round-thumb" width="60" height="60" loading="lazy">`
    : `<div class="dish-round-placeholder" title="Coastal View Mandarmani - ${d.name}"><span class="material-symbols-outlined">${catIcon}</span></div>`;

  const portionHtml = d.portion
    ? `<span class="dish-portion-badge">${d.portion}</span>`
    : '';

  let priceHtml = '';
  if (d.variants && d.variants.length > 0) {
    const chips = d.variants.map(v => `<span class="variant-chip">${v.label} ₹${v.price}</span>`).join('');
    priceHtml = `<div class="dish-variants-row">${chips}</div>`;
  } else {
    priceHtml = `<span class="dish-price-tag">₹${d.price}</span>`;
  }

  const badgesHtml = (d.badges && d.badges.length)
    ? `<div class="dish-badges-list">` +
        d.badges.map(b => {
          const isSpicy = b.toLowerCase().includes('spicy');
          const icon = isSpicy ? 'local_fire_department' : 'award_star';
          const cls = isSpicy ? 'badge-tag-spicy' : 'badge-tag-chef';
          return `<span class="${cls}"><span class="material-symbols-outlined" style="font-size:11px;">${icon}</span> ${b}</span>`;
        }).join('') +
      `</div>`
    : '';

  return `
            <div class="dish-row-card" data-dish-id="${d.id}" data-dish-name="${d.name.toLowerCase()}" data-category="${d.category}" data-diet="${dietClass}" onclick="openDishDetailPopup('${d.id}')">
              <div class="dish-circle-wrap">
                ${thumbHtml}
              </div>
              <div class="dish-info-col">
                <div class="dish-name-line">
                  <span class="diet-indicator ${dietClass}" title="${dietTitle}">
                    <span class="dot"></span>
                  </span>
                  <h4 class="dish-item-name">${d.name} ${portionHtml}</h4>
                </div>
                <p class="dish-item-desc">${d.description || ''}</p>
                <div class="dish-meta-row">
                  ${priceHtml}
                  ${badgesHtml}
                </div>
              </div>
            </div>`;
}

// Generate complete menu.html
function generateMenuHtml() {
  const jsonLd = generateMenuJsonLd();

  const navPillsHtml = categories.map((cat, idx) => {
    const slug = catSlug(cat.name);
    const displayName = cat.name === 'Mocktail' ? 'Mocktails' : cat.name;
    return `<a href="#${slug}" class="cat-nav-pill ${idx === 0 ? 'active' : ''}" data-cat="${cat.name}"><span class="material-symbols-outlined" style="font-size:16px;">${cat.icon}</span> ${displayName}</a>`;
  }).join('\n          ');

  const categorySectionsHtml = categories.map(cat => {
    const slug = catSlug(cat.name);
    const catDishes = dishes.filter(d => d.category === cat.name);
    const cardsHtml = catDishes.map(renderDishCard).join('\n');
    const timingBadge = cat.timing
      ? `<span class="ribbon-timing-badge"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">schedule</span> ${cat.timing}</span>`
      : '';

    const displayName = cat.name === 'Mocktail' ? 'Mocktails' : cat.name;
    const mocktailBanner = cat.name === 'Mocktail' ? `
          <!-- Coastal Nightlife - The Coral Reef Lounge Showcase Banner -->
          <div class="mocktail-lounge-banner">
            <div class="mocktail-lounge-grid">
              <div class="mocktail-lounge-img-wrap">
                <img src="assets/images/cocktail-lounge.jpg" alt="The Coral Reef Lounge at Coastal View Mandarmani" loading="lazy">
              </div>
              <div class="mocktail-lounge-content">
                <span class="section-tag turquoise" style="display:inline-block; margin-bottom: 8px;">Coastal Nightlife</span>
                <h3 class="mocktail-lounge-title">The Coral Reef Lounge</h3>
                <p class="mocktail-lounge-desc">
                  Immerse yourself in moody ocean-view neon sophistication. Unwind to acoustic lounge beats while sipping handcrafted signature cocktails prepared by our master mixologists.
                </p>
                <div class="mocktail-lounge-badges">
                  <span class="lounge-feature-badge"><span class="material-symbols-outlined">nightlife</span> Neon Ambience</span>
                  <span class="lounge-feature-badge"><span class="material-symbols-outlined">music_note</span> Acoustic Beats</span>
                  <span class="lounge-feature-badge"><span class="material-symbols-outlined">local_bar</span> Master Mixologists</span>
                </div>
              </div>
            </div>
          </div>` : '';

    return `
        <!-- ${displayName} Section -->
        <div class="menu-category-section" id="${slug}" data-category-key="${cat.name}">
          <div class="category-navy-ribbon">
            <div class="ribbon-title-wrap">
              <div class="ribbon-round-icon">
                <span class="material-symbols-outlined">${cat.icon}</span>
              </div>
              <h3>${displayName}</h3>
              ${timingBadge}
            </div>
            <div class="ribbon-side-motto">Fresh Coastal Flavors ♡</div>
          </div>${mocktailBanner}
          <div class="category-dishes-grid">
${cardsHtml}
          </div>
        </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Menu: Coastal View Hotel & Restaurant, Mandarmani</title>
  <meta name="description" content="Explore the official priced menu of Coastal View Hotel & Restaurant in Mandarmani. 93 authentic coastal delicacies including Hilsa, Pomfret, Prawns, Biryani, Thalis, and Mocktails.">
  <link rel="canonical" href="https://coastalviewmandarmani.com/menu">
  
  <!-- OpenGraph Meta Tags -->
  <meta property="og:title" content="Menu: Coastal View Hotel & Restaurant, Mandarmani">
  <meta property="og:description" content="Explore official printed menu of Coastal View Mandarmani featuring 93 delicacies with real prices, dietary filters, and authentic coastal specials.">
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
  <script type="application/ld+json">
${jsonLd}
  </script>
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
          <li><a href="/#cocktails" class="nav-link">Cocktails</a></li>
          <li><a href="/#candlelight" class="nav-link">Candlelight</a></li>
          <li><a href="/gallery" class="nav-link">Gallery</a></li>
          <li><a href="/#nearby" class="nav-link">Places</a></li>
          <li><a href="/#location" class="nav-link">Location</a></li>
          <li><a href="/#tours" class="nav-link tour-link">Ani's Tours</a></li>
        </ul>
      </nav>

      <div class="nav-actions">
        <a href="tel:${cleanPhone}" class="btn btn-outline-gold" style="padding: 8px 14px; font-size: 0.84rem; display: inline-flex; align-items: center; gap: 6px;">
          <span class="material-symbols-outlined" style="font-size: 16px;">call</span> ${phone}
        </a>
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
        <li><a href="/#owner" class="mobile-nav-link"><span class="material-symbols-outlined">person</span> Owner</a></li>
        <li><a href="/#rooms" class="mobile-nav-link"><span class="material-symbols-outlined">hotel</span> Rooms</a></li>
        <li><a href="/#amenities" class="mobile-nav-link"><span class="material-symbols-outlined">pool</span> Amenities</a></li>
        <li><a href="/menu" class="mobile-nav-link active"><span class="material-symbols-outlined">restaurant_menu</span> Menu</a></li>
        <li><a href="/#cocktails" class="mobile-nav-link"><span class="material-symbols-outlined">local_bar</span> Cocktails</a></li>
        <li><a href="/#candlelight" class="mobile-nav-link"><span class="material-symbols-outlined">candle</span> Candlelight</a></li>
        <li><a href="/gallery" class="mobile-nav-link"><span class="material-symbols-outlined">photo_library</span> Gallery</a></li>
        <li><a href="/#nearby" class="mobile-nav-link"><span class="material-symbols-outlined">explore</span> Places</a></li>
        <li><a href="/#location" class="mobile-nav-link"><span class="material-symbols-outlined">location_on</span> Location</a></li>
        <li><a href="/#tours" class="mobile-nav-link tour-mobile-pill"><span class="material-symbols-outlined">directions_car</span> Ani's Tours</a></li>
      </ul>

      <div style="padding: 16px; border-top: 1px solid rgba(255,255,255,0.1); margin-top: auto;">
        <a href="tel:${cleanPhone}" class="btn btn-gold" style="width: 100%; justify-content: center;">
          <span class="material-symbols-outlined">call</span> Call ${phone}
        </a>
      </div>
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
        Authentic Bengali delicacies, fresh coastal catches, Kolkata dum biryani, pure vegetarian dishes, thalis, and refreshing mocktails. Managed by Ani's Tour & Travels.
      </p>
      <div class="menu-top-meta-bar">
        <span class="menu-time-badge">
          <span class="material-symbols-outlined" style="font-size: 18px;">schedule</span> Breakfast: 7:00 AM – 10:30 AM
        </span>
        <a href="tel:${cleanPhone}" class="menu-call-badge" title="Tap to call restaurant front desk">
          <span class="material-symbols-outlined" style="font-size: 18px;">call</span> Table Reservation: ${phone}
        </a>
      </div>
    </div>
  </section>

  <!-- Complete Menu Content Section -->
  <section class="restaurant-section" id="restaurant" style="padding-top: 40px;">
    <div class="container">
      <!-- Menu Header (matching printed menu cover) -->
      <div class="menu-brand-header">
        <div class="menu-script-tagline">Good Food, Good Mood ♡</div>
        <h2 class="menu-hotel-title">Coastal View</h2>
        <div class="menu-sub-establishment">Hotel & Restaurant, Mandarmani</div>
        <div class="menu-pillars-tagline">
          Fresh Food <span>|</span> Sea Breeze <span>|</span> Unforgettable Stay
        </div>

        <div class="menu-center-ribbon">
          <span class="ribbon-text">OFFICIAL MENU</span>
          <span class="material-symbols-outlined ribbon-icon">restaurant</span>
        </div>

        <div class="menu-managed-by">
          Managed by <strong>Ani's Tour and Travels</strong>
        </div>

        <div>
          <a href="tel:${cleanPhone}" class="menu-phone-pill" title="Tap to call restaurant front desk">
            <span class="material-symbols-outlined" style="font-size: 18px;">call</span>
            <span>${phone}</span>
          </a>
        </div>

        <div class="menu-bottom-motto">Good Food Brings People Together ♡</div>
      </div>

      <!-- Sticky / Tabbed Category Navigation -->
      <div class="menu-sticky-nav-container">
        <div class="menu-nav-scroll-wrap" id="menuNavPills">
          ${navPillsHtml}
        </div>
      </div>

      <!-- Search & Diet Filters Row -->
      <div class="menu-controls-row">
        <div class="menu-search-box">
          <span class="material-symbols-outlined search-icon">search</span>
          <input type="text" id="menuSearchInput" placeholder="Search dishes, e.g. Hilsa, Thali, Biryani, Coffee..." aria-label="Search dishes on menu" oninput="filterMenuItems()">
        </div>
        <div class="menu-diet-toggles">
          <button class="diet-toggle-btn active" data-diet="all" onclick="setMenuDietFilter('all')">All Dishes</button>
          <button class="diet-toggle-btn" data-diet="veg" onclick="setMenuDietFilter('veg')">
            <span class="diet-indicator veg" style="width:12px;height:12px;"><span class="dot" style="width:6px;height:6px;"></span></span> Pure Veg
          </button>
          <button class="diet-toggle-btn" data-diet="nonveg" onclick="setMenuDietFilter('nonveg')">
            <span class="diet-indicator nonveg" style="width:12px;height:12px;"><span class="dot" style="width:6px;height:6px;"></span></span> Non-Veg
          </button>
        </div>
      </div>

      <!-- Categories Container (All 8 Categories) -->
      <div id="menuCategoriesContainer">
${categorySectionsHtml}
      </div>

    </div>
  </section>

  <!-- Dish Photo Tap-to-Popup Modal -->
  <div class="dish-popup-modal" id="dishPopupModal" onclick="closeDishDetailPopup(event)">
    <div class="dish-popup-box" onclick="event.stopPropagation()">
      <button class="dish-popup-close-btn" onclick="closeDishDetailPopup()" aria-label="Close modal">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="dish-popup-img-wrap" id="popupDishImgWrap">
        <!-- Injected via JavaScript -->
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:6px;">
        <span class="diet-indicator veg" id="popupDietIndicator"><span class="dot"></span></span>
        <h3 id="popupDishTitle" style="font-family:'Playfair Display',serif;font-size:1.4rem;color:#073B4C;margin:0;"></h3>
      </div>
      <p id="popupDishCategory" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;color:#B88E3E;margin-bottom:8px;font-weight:700;"></p>
      <p id="popupDishDesc" style="font-size:0.88rem;color:#475569;line-height:1.5;margin-bottom:14px;"></p>
      <div style="display:flex;justify-content:center;gap:8px;margin-bottom:18px;" id="popupBadgesContainer"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(232,199,123,0.15);padding:12px 18px;border-radius:12px;border:1px solid #E8C77B;margin-bottom:18px;">
        <span style="font-size:0.85rem;color:#475569;font-weight:600;">Price at Hotel:</span>
        <span id="popupDishPrice" style="font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:800;color:#073B4C;"></span>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <a href="tel:${cleanPhone}" class="btn btn-gold" style="flex:1;text-align:center;padding:10px 14px;font-size:0.88rem;">
          <span class="material-symbols-outlined" style="font-size:16px;">call</span> Order at Restaurant
        </a>
        <button class="btn btn-glass" style="flex:1;padding:10px 14px;font-size:0.88rem;color:#073B4C;border:1px solid #073B4C;" onclick="closeDishDetailPopup()">
          Close
        </button>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-col">
          <a href="/" class="footer-brand-wrap" aria-label="Coastal View Hotel">
            <img src="assets/images/logo.png" alt="Coastal View Logo" class="footer-brand-logo">
          </a>
          <p>
            Mandarmani's premier Luxury Beachfront Hotel. Direct ocean access, infinity pool, fine dining, and authentic hospitality managed by Anirban Das.
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
            <a href="tel:${cleanPhone}" style="color:inherit;text-decoration:none;"><span>${phone}</span></a>
          </div>
          <div class="footer-contact-item">
            <span class="material-symbols-outlined">mail</span>
            <span>reservations@coastalviewmandarmani.com</span>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© 2026 Coastal View, Managed By Ani's. All rights reserved. Rina Rd, Mandarmani. Contact: <a href="tel:${cleanPhone}" style="color:var(--champagne-gold);">${phone}</a></div>
      </div>
    </div>
  </footer>

  <!-- Scripts -->
  <script src="assets/js/main.js"></script>
  <script src="assets/js/concierge.js"></script>

</body>
</html>
`;
}

// Generate featured dish cards HTML for index.html
function renderHomeFeaturedCards() {
  const featured = dishes.filter(d => d.featured || d.isFeatured);
  return featured.map(d => {
    const isVeg = d.isVeg !== false;
    const dietClass = isVeg ? 'veg' : 'non-veg';
    const dietTitle = isVeg ? 'Vegetarian' : 'Non-Vegetarian';
    const thumbSrc = d.image || (d.thumbImage || 'assets/images/restaurant-dining.jpg');
    const badge = (d.badges && d.badges.length) ? d.badges[0] : (isVeg ? 'Vegetarian' : 'Chef\'s Special');

    const portionHtml = d.portion
      ? `<span class="dish-portion-badge">${d.portion}</span>`
      : '';

    let priceHtml = '';
    if (d.variants && d.variants.length > 0) {
      const chips = d.variants.map(v => `<span class="variant-chip" style="font-size:0.72rem;padding:1px 6px;">${v.label} ₹${v.price}</span>`).join(' ');
      priceHtml = `<div class="dish-variants-row" style="margin-bottom:4px;">${chips}</div>`;
    } else {
      priceHtml = `<span class="featured-dish-price">₹${d.price}</span>`;
    }

    return `
        <!-- ${d.name} -->
        <div class="featured-dish-card reveal-on-scroll">
          <div class="featured-dish-thumb-wrap">
            <img src="${thumbSrc}" alt="${d.name}" loading="lazy">
          </div>
          <div class="featured-dish-content">
            <div class="featured-dish-header">
              <h4 class="featured-dish-title">${d.name} ${portionHtml}</h4>
              <span class="diet-dot ${dietClass}" title="${dietTitle}"></span>
            </div>
            <p class="featured-dish-desc">${d.description || 'Authentic coastal delicacy prepared fresh with traditional spices.'}</p>
            <div class="featured-dish-footer">
              ${priceHtml}
              <span class="featured-dish-badge">${badge}</span>
            </div>
          </div>
        </div>`;
  }).join('\n');
}

// Write menu.html
const menuHtmlContent = generateMenuHtml();
fs.writeFileSync(path.join(__dirname, 'menu.html'), menuHtmlContent, 'utf8');
console.log('Generated menu.html successfully! Size:', menuHtmlContent.length);

// Update index.html
let indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// 1. Update restaurant section phone numbers & call links
indexHtml = indexHtml.replace(/Front Desk:\s*9620536361/g, `Front Desk: ${phone}`);
indexHtml = indexHtml.replace(/href="tel:9620536361"/g, `href="tel:${cleanPhone}"`);

// 2. Update category chips in index.html to match the 8 categories
const categoryChipsHtml = `      <!-- Category Chips Linking to Full Menu -->
      <div class="menu-category-chips-row">
        <a href="/menu#cat-breakfast" class="menu-cat-chip"><span class="material-symbols-outlined">wb_sunny</span> Breakfast</a>
        <a href="/menu#cat-vegetable-dal" class="menu-cat-chip"><span class="material-symbols-outlined">eco</span> Vegetable / Dal</a>
        <a href="/menu#cat-rice-roti-chowmin" class="menu-cat-chip"><span class="material-symbols-outlined">rice_bowl</span> Rice & Chowmin</a>
        <a href="/menu#cat-non-veg" class="menu-cat-chip"><span class="material-symbols-outlined">set_meal</span> Non Veg</a>
        <a href="/menu#cat-snacks" class="menu-cat-chip"><span class="material-symbols-outlined">tapas</span> Snacks</a>
        <a href="/menu#cat-mocktail" class="menu-cat-chip"><span class="material-symbols-outlined">local_bar</span> Mocktails</a>
        <a href="/menu#cat-salad-raita-papad" class="menu-cat-chip"><span class="material-symbols-outlined">dinner_dining</span> Salad & Papad</a>
        <a href="/menu#cat-thali" class="menu-cat-chip"><span class="material-symbols-outlined">lunch_dining</span> Thali</a>
      </div>`;

const catChipsStart = indexHtml.indexOf('<!-- Category Chips Linking to Full Menu -->');
const catChipsEnd = indexHtml.indexOf('<!-- Featured Dishes Grid', catChipsStart);
if (catChipsStart !== -1 && catChipsEnd !== -1) {
  indexHtml = indexHtml.slice(0, catChipsStart) + categoryChipsHtml + '\n\n      ' + indexHtml.slice(catChipsEnd);
}

// 3. Update featured dishes grid in index.html
const homeFeaturedCardsHtml = renderHomeFeaturedCards();
const gridStart = indexHtml.indexOf('<div class="featured-dishes-grid" id="homeFeaturedDishesGrid">');
const gridEnd = indexHtml.indexOf('<!-- Big Gold CTA to Full Menu -->', gridStart);

if (gridStart !== -1 && gridEnd !== -1) {
  const newGridBlock = `<div class="featured-dishes-grid" id="homeFeaturedDishesGrid">
${homeFeaturedCardsHtml}
      </div>\n\n      `;

  indexHtml = indexHtml.slice(0, gridStart) + newGridBlock + indexHtml.slice(gridEnd);
}

// 4. Update JSON-LD Restaurant Schema in index.html
const restSchemaStart = indexHtml.indexOf('<script type="application/ld+json" id="restaurantMenuSchema">');
const restSchemaEnd = indexHtml.indexOf('</script>', restSchemaStart);
if (restSchemaStart !== -1 && restSchemaEnd !== -1) {
  const newSchemaBlock = `<script type="application/ld+json" id="restaurantMenuSchema">
${generateMenuJsonLd()}
  `;
  indexHtml = indexHtml.slice(0, restSchemaStart) + newSchemaBlock + indexHtml.slice(restSchemaEnd);
}

fs.writeFileSync(path.join(__dirname, 'index.html'), indexHtml, 'utf8');
console.log('Updated index.html successfully! Size:', indexHtml.length);

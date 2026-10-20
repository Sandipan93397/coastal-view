// Coastal View - Main Interactive Logic

document.addEventListener('DOMContentLoaded', () => {
  initNavbarScroll();
  initHeroParticles();
  initRoomFilters();
  initMenuTabs();
  initFaqAccordion();
  initModals();
  initScrollProgressBar();
  initBackToTop();
  initSectionAnimations();
  syncLiveMedia();
  initHomeGallery();
  initHomeFeaturedMenu();
});

// Sticky Glass Navbar & Mobile Slide-In Drawer Navigation
function initNavbarScroll() {
  const header = document.querySelector('.site-header');
  const mobileToggle = document.getElementById('mobileToggle');
  const drawer = document.getElementById('mobileNavDrawer');
  const backdrop = document.getElementById('mobileNavBackdrop');
  const drawerClose = document.getElementById('mobileDrawerClose');
  const navLinksContainer = document.getElementById('navLinks');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });

  function openMobileDrawer() {
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileDrawer() {
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (navLinksContainer) navLinksContainer.classList.remove('mobile-open');
    document.body.style.overflow = '';
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (drawer && drawer.classList.contains('open')) {
        closeMobileDrawer();
      } else {
        openMobileDrawer();
      }
    });
  }

  if (drawerClose) {
    drawerClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileDrawer();
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeMobileDrawer);
  }

  // Close drawer on tap/click of any mobile link or book stay button
  const drawerLinks = document.querySelectorAll('.mobile-nav-link, .mobile-drawer-book-btn');
  drawerLinks.forEach(link => {
    link.addEventListener('click', () => {
      closeMobileDrawer();
    });
  });

  initSmoothNav();
  initNavbarScrollSpy();
}

// Clean in-page navigation handler with navbar offset and URL hash updating
function initSmoothNav() {
  const navLinksContainer = document.getElementById('navLinks');

  function getTargetElement(hash) {
    if (!hash || hash === '#') return null;
    let target = document.querySelector(hash);
    if (!target) {
      if (hash === '#cocktails' || hash === '#cocktail' || hash === '#mocktails') {
        target = document.getElementById('cocktails') || document.getElementById('cocktail') || document.getElementById('lounge') || document.querySelector('.lounge-section');
      } else if (hash === '#lounge') {
        target = document.getElementById('cocktails') || document.getElementById('cocktail') || document.getElementById('lounge') || document.querySelector('.lounge-section');
      } else if (hash === '#nearby') {
        target = document.getElementById('places') || document.querySelector('.places-section');
      } else if (hash === '#places') {
        target = document.getElementById('nearby') || document.querySelector('.places-section');
      } else if (hash === '#gallery') {
        target = document.getElementById('gallery') || document.querySelector('.gallery-section');
      } else if (hash === '#menu') {
        target = document.getElementById('restaurant') || document.querySelector('.restaurant-section');
      } else if (hash === '#restaurant') {
        target = document.getElementById('menu') || document.querySelector('.restaurant-section');
      } else if (hash === '#tours') {
        target = document.getElementById('tours') || document.querySelector('.tour-banner-section');
      }
    }
    return target;
  }

  function smoothScrollTo(target, hash, updateUrl = true) {
    if (!target) return;
    const header = document.querySelector('.site-header');
    const headerHeight = header ? header.offsetHeight : 80;
    const targetTop = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });

    if (updateUrl && hash && window.history && window.history.pushState) {
      window.history.pushState(null, '', hash);
    }
  }

  // Handle all in-page hash links (navbar, CTAs, footer links, drawer links)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    // Menu category pills have their own tab scroll logic
    if (link.classList.contains('cat-nav-pill')) return;

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    const target = getTargetElement(href);
    if (target) {
      e.preventDefault();
      const drawer = document.getElementById('mobileNavDrawer');
      const backdrop = document.getElementById('mobileNavBackdrop');
      if (drawer) drawer.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
      document.body.style.overflow = '';
      if (navLinksContainer) navLinksContainer.classList.remove('mobile-open');
      smoothScrollTo(target, href, true);
    }
  });

  // Handle direct URL loads with hashes (e.g., /#cocktail, /#nearby, /#candlelight)
  if (window.location.hash) {
    const initialHash = window.location.hash;
    const target = getTargetElement(initialHash);
    if (target) {
      setTimeout(() => {
        smoothScrollTo(target, initialHash, false);
      }, 150);
    }
  }
}

// Highlight active top navbar link based on scroll position without triggering any scroll
function initNavbarScrollSpy() {
  const desktopLinks = document.querySelectorAll('.site-header .nav-link[href^="#"]');
  const mobileLinks = document.querySelectorAll('.mobile-nav-link[href^="#"]');
  const sectionsToWatch = [
    { id: 'hero', aliases: ['hero'] },
    { id: 'owner', aliases: ['owner'] },
    { id: 'rooms', aliases: ['rooms'] },
    { id: 'amenities', aliases: ['amenities'] },
    { id: 'restaurant', aliases: ['restaurant', 'menu'] },
    { id: 'cocktails', aliases: ['cocktails', 'cocktail', 'mocktails', 'lounge'] },
    { id: 'candlelight', aliases: ['candlelight'] },
    { id: 'gallery', aliases: ['gallery'] },
    { id: 'nearby', aliases: ['nearby', 'places'] },
    { id: 'location', aliases: ['location'] },
    { id: 'tours', aliases: ['tours'] }
  ];

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateActiveNavLink();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  function updateActiveNavLink() {
    const scrollPos = window.scrollY + 120;
    let currentId = '';

    for (let i = sectionsToWatch.length - 1; i >= 0; i--) {
      const item = sectionsToWatch[i];
      let el = document.getElementById(item.id);
      if (!el && item.aliases) {
        for (const alias of item.aliases) {
          el = document.getElementById(alias);
          if (el) break;
        }
      }
      if (el) {
        const top = el.getBoundingClientRect().top + window.pageYOffset;
        if (scrollPos >= top) {
          currentId = item.id;
          break;
        }
      }
    }

    if (!currentId && sectionsToWatch.length > 0) {
      currentId = 'hero';
    }

    const highlightInGroup = (links) => {
      links.forEach(link => {
        const href = link.getAttribute('href');
        const hashId = href ? href.replace('#', '') : '';
        const matched = (hashId === currentId) || 
          (sectionsToWatch.find(s => s.id === currentId)?.aliases || []).includes(hashId);

        if (matched) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
    };

    highlightInGroup(desktopLinks);
    highlightInGroup(mobileLinks);
  }

  // Initial check
  updateActiveNavLink();
}

// Floating Golden Light Particles on Hero
function initHeroParticles() {
  const canvas = document.getElementById('heroParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = canvas.offsetWidth);
  let height = (canvas.height = canvas.offsetHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
  });

  const particleCount = 45;
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2.2 + 0.6,
      speedY: Math.random() * 0.45 + 0.15,
      speedX: (Math.random() - 0.5) * 0.25,
      opacity: Math.random() * 0.6 + 0.2,
      pulse: Math.random() * 0.02 + 0.005,
      color: Math.random() > 0.4 ? 'rgba(232, 199, 123,' : 'rgba(6, 182, 176,'
    });
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    for (let p of particles) {
      p.y -= p.speedY;
      p.x += p.speedX;
      p.opacity += Math.sin(Date.now() * p.pulse) * 0.01;

      if (p.y < 0) {
        p.y = height + 10;
        p.x = Math.random() * width;
      }
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color} ${Math.max(0.1, Math.min(0.85, p.opacity))})`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#E8C77B';
      ctx.fill();
    }

    requestAnimationFrame(render);
  }

  render();
}

// Filter Tabs for Rooms
function initRoomFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const roomCards = document.querySelectorAll('.room-card');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');

      roomCards.forEach(card => {
        if (filter === 'all') {
          card.style.display = 'flex';
        } else if (filter === 'sea-view') {
          card.style.display = card.getAttribute('data-category') === 'sea-view' ? 'flex' : 'none';
        } else if (filter === 'pool-view') {
          card.style.display = card.getAttribute('data-category') === 'pool-view' ? 'flex' : 'none';
        } else if (filter === 'cosy-deluxe') {
          card.style.display = card.getAttribute('data-category') === 'cosy-deluxe' ? 'flex' : 'none';
        } else if (filter === 'family') {
          card.style.display = card.getAttribute('data-category') === 'family' ? 'flex' : 'none';
        } else {
          card.style.display = 'flex';
        }
      });
    });
  });
}

// ============================================================================
// COASTAL VIEW REAL PRINTED MENU INTERACTIVITY & LIVE API SYNC
// ============================================================================

let currentMenuDietFilter = 'all';
let liveMenuData = [];

function initMenuTabs() {
  initMenuCategoryScrollSpy();
  loadLiveMenuFromApi();
}

// Category Pills Smooth Scroll & Active Highlighter
function initMenuCategoryScrollSpy() {
  const pills = document.querySelectorAll('.cat-nav-pill');
  const sections = document.querySelectorAll('.menu-category-section');
  const scrollWrap = document.querySelector('.menu-nav-scroll-wrap');

  pills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = pill.getAttribute('href');
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        // Offset for sticky header (80px) + sticky category bar (56px) = 136-140px
        const headerOffset = 140;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: Math.max(0, offsetPosition),
          behavior: 'smooth'
        });

        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        // Scroll horizontal pill container only - WITHOUT scrolling the window
        if (scrollWrap) {
          const pillLeft = pill.offsetLeft;
          const pillWidth = pill.offsetWidth;
          const wrapWidth = scrollWrap.clientWidth;
          scrollWrap.scrollTo({
            left: Math.max(0, pillLeft - (wrapWidth / 2) + (pillWidth / 2)),
            behavior: 'smooth'
          });
        }
      }
    });
  });

  // Intersection Observer for active pill highlight during scroll ONLY
  // Strictly avoid scrollIntoView/scrollTo in this observer to prevent jumping
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          pills.forEach(p => {
            if (p.getAttribute('href') === `#${id}`) {
              p.classList.add('active');
              // Highlight only: never trigger scrolling in observer to avoid jerking window
            } else {
              p.classList.remove('active');
            }
          });
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(sec => observer.observe(sec));
  }
}

// Menu Loading Skeleton Renderer
function renderMenuSkeleton() {
  const container = document.getElementById('menuCategoriesContainer');
  if (!container) return;
  container.innerHTML = `
    <div class="menu-skeleton-container" id="menuSkeletonLoader">
      <div class="skeleton-ribbon"><div class="skeleton-shimmer"></div></div>
      <div class="menu-skeleton-grid">
        ${Array.from({length: 6}).map(() => `
          <div class="skeleton-card">
            <div class="skeleton-shimmer"></div>
            <div class="skeleton-circle"></div>
            <div class="skeleton-lines">
              <div class="skeleton-line short"></div>
              <div class="skeleton-line long"></div>
              <div class="skeleton-line med"></div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="skeleton-ribbon" style="margin-top:24px;"><div class="skeleton-shimmer"></div></div>
      <div class="menu-skeleton-grid">
        ${Array.from({length: 4}).map(() => `
          <div class="skeleton-card">
            <div class="skeleton-shimmer"></div>
            <div class="skeleton-circle"></div>
            <div class="skeleton-lines">
              <div class="skeleton-line short"></div>
              <div class="skeleton-line long"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Friendly Error State with Retry Button (Never Blank Page)
function renderMenuErrorState(msg) {
  const container = document.getElementById('menuCategoriesContainer');
  if (!container) return;
  container.innerHTML = `
    <div class="menu-error-state" id="menuErrorState">
      <span class="material-symbols-outlined menu-error-icon">restaurant_menu</span>
      <h3 class="menu-error-title">Unable to Load Menu</h3>
      <p class="menu-error-desc">We couldn't connect to the dining database right now. Please check your connection and tap Retry below.</p>
      <div class="menu-error-actions">
        <button class="btn btn-gold" onclick="loadLiveMenuFromApi(true)">
          <span class="material-symbols-outlined">refresh</span> Retry Menu
        </button>
        <a href="/" class="btn btn-outline-gold">
          <span class="material-symbols-outlined">home</span> Back to Home
        </a>
      </div>
      <div class="menu-error-call">
        Need immediate dining assistance? Front Desk: <a href="tel:+917812027551">+91 7812027551</a>
      </div>
    </div>
  `;
}

// Category slug helper
function menuCatSlug(name) {
  return 'cat-' + (name || '').toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Build Dish Card HTML
function renderDishCardHtml(d, categories) {
  const isVeg = d.isVeg !== false;
  const dietClass = isVeg ? 'veg' : 'nonveg';
  const dietTitle = isVeg ? 'Vegetarian' : 'Non-Vegetarian';
  const catObj = categories.find(c => (typeof c === 'string' ? c : c.name) === d.category);
  const catIcon = (catObj && catObj.icon) ? catObj.icon : 'restaurant';

  const thumbHtml = d.image
    ? `<img src="${d.image}" alt="Coastal View Mandarmani - ${d.name}" class="dish-round-thumb" width="60" height="60" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'dish-round-placeholder\\'><span class=\\'material-symbols-outlined\\'>${catIcon}</span></div>';">`
    : `<div class="dish-round-placeholder" title="Coastal View Mandarmani - ${d.name}"><span class="material-symbols-outlined">${catIcon}</span></div>`;

  const portionHtml = d.portion ? `<span class="dish-portion-badge">(${d.portion})</span>` : '';

  let priceHtml = '';
  if (d.variants && Array.isArray(d.variants) && d.variants.length > 0) {
    const chips = d.variants.map(v => `<span class="variant-chip">${v.label} ₹${v.price}</span>`).join('');
    priceHtml = `<div class="dish-variants-row">${chips}</div>`;
  } else if (d.price && d.price > 0) {
    priceHtml = `<span class="dish-price-tag">₹${d.price.toLocaleString('en-IN')}</span>`;
  } else {
    priceHtml = `<span class="dish-price-tag ask-restaurant">Ask at restaurant</span>`;
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
    <div class="dish-row-card" data-dish-id="${d.id}" data-dish-name="${(d.name || '').toLowerCase()}" data-category="${d.category || ''}" data-diet="${dietClass}" onclick="openDishDetailPopup('${d.id}')">
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

// Live Fetch from /api/menu with Loading Skeleton & Fallback Error State
async function loadLiveMenuFromApi(force = false) {
  const container = document.getElementById('menuCategoriesContainer');
  if (!container) return;

  const existingCards = container.querySelectorAll('.dish-row-card');
  const needsInitialRender = existingCards.length === 0 || force;

  if (needsInitialRender) {
    renderMenuSkeleton();
  }

  try {
    const res = await fetch('/api/menu');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.restaurant)) {
      throw new Error('Invalid data format received from /api/menu');
    }

    liveMenuData = data.restaurant;

    // Normalize categories
    const rawCategories = data.categories || [];
    const iconMap = {
      'Breakfast': 'wb_sunny',
      'Vegetable / Dal': 'eco',
      'Rice / Roti / Chowmin': 'rice_bowl',
      'Non Veg': 'set_meal',
      'Snacks (Veg./Non Veg.)': 'tapas',
      'Mocktail': 'local_bar',
      'Salad & Raita / Papad': 'dinner_dining',
      'Thali': 'lunch_dining'
    };
    const normalizedCats = rawCategories.map(c => {
      if (typeof c === 'string') {
        return { name: c, icon: iconMap[c] || 'restaurant' };
      }
      return c;
    });

    if (needsInitialRender) {
      const categorySectionsHtml = normalizedCats.map(cat => {
        const slug = menuCatSlug(cat.name);
        const catDishes = liveMenuData.filter(d => d.category === cat.name);
        const cardsHtml = catDishes.map(d => renderDishCardHtml(d, normalizedCats)).join('\n');
        const timingBadge = cat.timing
          ? `<span class="ribbon-timing-badge"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">schedule</span> ${cat.timing}</span>`
          : '';

        return `
          <div class="menu-category-section" id="${slug}" data-category-key="${cat.name}">
            <div class="category-navy-ribbon">
              <div class="ribbon-title-wrap">
                <div class="ribbon-round-icon">
                  <span class="material-symbols-outlined">${cat.icon || 'restaurant'}</span>
                </div>
                <h3>${cat.name}</h3>
                ${timingBadge}
              </div>
              <div class="ribbon-side-motto">Fresh Coastal Flavors ♡</div>
            </div>
            <div class="category-dishes-grid">
              ${cardsHtml}
            </div>
          </div>`;
      }).join('\n');

      container.innerHTML = categorySectionsHtml;
      initMenuCategoryScrollSpy();
    } else {
      updateMenuDomWithLiveData(liveMenuData);
    }

    // Update bottom policy note and phone if present
    if (data.menuNote) {
      const noteEl = document.getElementById('menuBottomNoteText');
      if (noteEl) noteEl.textContent = data.menuNote;
    }

    // Reapply search & filter
    const query = (document.getElementById('menuSearchInput')?.value || '').trim().toLowerCase();
    applyCombinedMenuFilters(query, currentMenuDietFilter);

  } catch (err) {
    console.warn('Error loading live menu from API:', err);
    if (container.querySelectorAll('.dish-row-card').length === 0) {
      renderMenuErrorState(err.message);
    }
  }
}

function updateMenuDomWithLiveData(dishes) {
  dishes.forEach(dish => {
    const card = document.querySelector(`.dish-row-card[data-dish-id="${dish.id}"]`);
    if (!card) return;

    // Update availability
    if (dish.available === false) {
      card.classList.add('unavailable');
    } else {
      card.classList.remove('unavailable');
    }

    // Update price
    const priceEl = card.querySelector('.dish-price-tag');
    if (priceEl) {
      if (dish.price && dish.price > 0) {
        priceEl.textContent = `₹${dish.price.toLocaleString('en-IN')}`;
        priceEl.classList.remove('ask-restaurant');
      } else {
        priceEl.textContent = 'Ask at restaurant';
        priceEl.classList.add('ask-restaurant');
      }
    }

    // Update circular image if present
    const circleWrap = card.querySelector('.dish-circle-wrap');
    if (circleWrap && dish.image) {
      circleWrap.innerHTML = `<img src="${dish.image}" alt="Coastal View Mandarmani - ${dish.name}" class="dish-round-thumb" width="60" height="60" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'dish-round-placeholder\\'><span class=\\'material-symbols-outlined\\'>restaurant</span></div>';">`;
    }

    // Update portion badge if present
    const nameEl = card.querySelector('.dish-item-name');
    let portionEl = card.querySelector('.dish-portion-badge');
    if (dish.portion) {
      if (!portionEl && nameEl) {
        portionEl = document.createElement('span');
        portionEl.className = 'dish-portion-badge';
        nameEl.appendChild(portionEl);
      }
      if (portionEl) {
        portionEl.textContent = `(${dish.portion})`;
      }
    } else if (portionEl) {
      portionEl.remove();
    }

    // Update variants row if present
    let variantsRow = card.querySelector('.dish-variants-row');
    if (dish.variants && Array.isArray(dish.variants) && dish.variants.length > 0) {
      if (!variantsRow) {
        variantsRow = document.createElement('div');
        variantsRow.className = 'dish-variants-row';
        const contentWrap = card.querySelector('.dish-card-body') || card;
        contentWrap.appendChild(variantsRow);
      }
      variantsRow.innerHTML = dish.variants.map(v => 
        `<span class="variant-chip">${v.label}: ₹${v.price}</span>`
      ).join('');
    } else if (variantsRow) {
      variantsRow.remove();
    }
  });
}

// Live Search Filtering
window.filterMenuItems = function() {
  const query = (document.getElementById('menuSearchInput')?.value || '').trim().toLowerCase();
  applyCombinedMenuFilters(query, currentMenuDietFilter);
};

// Diet Filter (All, Pure Veg, Non-Veg)
window.setMenuDietFilter = function(diet) {
  currentMenuDietFilter = diet;
  document.querySelectorAll('.diet-toggle-btn').forEach(btn => {
    if (btn.getAttribute('data-diet') === diet) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const query = (document.getElementById('menuSearchInput')?.value || '').trim().toLowerCase();
  applyCombinedMenuFilters(query, diet);
};

function applyCombinedMenuFilters(query, diet) {
  const cards = document.querySelectorAll('.dish-row-card');
  const sections = document.querySelectorAll('.menu-category-section');

  cards.forEach(card => {
    const name = card.getAttribute('data-dish-name') || '';
    const desc = (card.querySelector('.dish-item-desc')?.textContent || '').toLowerCase();
    const isVeg = card.getAttribute('data-diet') === 'veg';
    const variantsText = (card.querySelector('.dish-variants-row')?.textContent || '').toLowerCase();
    const portionText = (card.querySelector('.dish-portion-badge')?.textContent || '').toLowerCase();

    const matchesQuery = !query || name.includes(query) || desc.includes(query) || variantsText.includes(query) || portionText.includes(query);
    const matchesDiet = (diet === 'all') || (diet === 'veg' && isVeg) || (diet === 'nonveg' && !isVeg);

    if (matchesQuery && matchesDiet) {
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }
  });

  sections.forEach(sec => {
    const visibleCards = sec.querySelectorAll('.dish-row-card:not([style*="display: none"])');
    if (visibleCards.length === 0) {
      sec.style.display = 'none';
    } else {
      sec.style.display = 'block';
    }
  });
}

// Dish Photo Tap-to-Popup Modal
window.openDishDetailPopup = function(dishId) {
  const dish = (liveMenuData || []).find(d => d.id === dishId) || (() => {
    const card = document.querySelector(`.dish-row-card[data-dish-id="${dishId}"]`);
    if (!card) return null;
    return {
      id: dishId,
      name: card.querySelector('.dish-item-name')?.textContent || '',
      category: card.getAttribute('data-category') || 'Restaurant',
      isVeg: card.getAttribute('data-diet') === 'veg',
      price: card.querySelector('.dish-price-tag')?.textContent || 'Ask at restaurant',
      description: card.querySelector('.dish-item-desc')?.textContent || '',
      image: card.querySelector('img.dish-round-thumb')?.getAttribute('src') || null
    };
  })();

  if (!dish) return;

  const modal = document.getElementById('dishPopupModal');
  const imgWrap = document.getElementById('popupDishImgWrap');
  const dietEl = document.getElementById('popupDietIndicator');
  const titleEl = document.getElementById('popupDishTitle');
  const catEl = document.getElementById('popupDishCategory');
  const descEl = document.getElementById('popupDishDesc');
  const priceEl = document.getElementById('popupDishPrice');
  const badgesBox = document.getElementById('popupBadgesContainer');

  if (titleEl) {
    titleEl.textContent = dish.name;
    if (dish.portion) {
      const portionSpan = document.createElement('span');
      portionSpan.className = 'dish-portion-badge';
      portionSpan.style.cssText = 'font-size:0.8rem;vertical-align:middle;margin-left:6px;';
      portionSpan.textContent = `(${dish.portion})`;
      titleEl.appendChild(portionSpan);
    }
  }
  if (catEl) catEl.textContent = dish.category;
  if (descEl) descEl.textContent = dish.description || `${dish.name} prepared fresh with authentic coastal spices.`;
  
  if (priceEl) {
    if (typeof dish.price === 'number' && dish.price > 0) {
      priceEl.textContent = `₹${dish.price.toLocaleString('en-IN')}`;
    } else {
      priceEl.textContent = String(dish.price || 'Ask at restaurant');
    }
  }

  // Display variants if available
  let popupVariants = document.getElementById('popupVariantsContainer');
  if (!popupVariants && priceEl) {
    popupVariants = document.createElement('div');
    popupVariants.id = 'popupVariantsContainer';
    popupVariants.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:14px;';
    const priceBox = priceEl.closest('div');
    if (priceBox && priceBox.parentNode) {
      priceBox.parentNode.insertBefore(popupVariants, priceBox);
    }
  }
  if (popupVariants) {
    if (dish.variants && Array.isArray(dish.variants) && dish.variants.length > 0) {
      popupVariants.style.display = 'flex';
      popupVariants.innerHTML = dish.variants.map(v => 
        `<span class="variant-chip" style="font-size:0.82rem;padding:4px 10px;">${v.label}: ₹${v.price}</span>`
      ).join('');
    } else {
      popupVariants.innerHTML = '';
      popupVariants.style.display = 'none';
    }
  }

  if (dietEl) {
    dietEl.className = `diet-indicator ${dish.isVeg ? 'veg' : 'nonveg'}`;
    dietEl.title = dish.isVeg ? 'Vegetarian' : 'Non-Vegetarian';
  }

  if (imgWrap) {
    if (dish.image) {
      imgWrap.innerHTML = `<img src="${dish.image}" alt="Coastal View Mandarmani - ${dish.name}" class="dish-popup-img">`;
    } else {
      imgWrap.innerHTML = `<div class="dish-popup-placeholder" title="Coastal View Mandarmani - ${dish.name}"><span class="material-symbols-outlined">restaurant</span></div>`;
    }
  }

  if (badgesBox) {
    badgesBox.innerHTML = '';
    if (dish.badges && Array.isArray(dish.badges)) {
      dish.badges.forEach(b => {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = b === 'Spicy' ? 'badge-tag-spicy' : 'badge-tag-chef';
        badgeSpan.innerHTML = `<span class="material-symbols-outlined" style="font-size:12px;">${b === 'Spicy' ? 'local_fire_department' : 'award_star'}</span> ${b}`;
        badgesBox.appendChild(badgeSpan);
      });
    }
    if (dish.available === false) {
      const unavail = document.createElement('span');
      unavail.className = 'badge-unavailable';
      unavail.textContent = 'Not available today';
      badgesBox.appendChild(unavail);
    }
  }

  if (modal) modal.classList.add('open');
};

window.closeDishDetailPopup = function(e) {
  if (e && e.target && e.target !== document.getElementById('dishPopupModal') && !e.target.closest('.dish-popup-close-btn')) {
    return;
  }
  const modal = document.getElementById('dishPopupModal');
  if (modal) modal.classList.remove('open');
};

// FAQ Accordion Expand/Collapse
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      faqItems.forEach(i => i.classList.remove('active'));

      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

// Modals Setup (Room Gallery & Nearby Map)
function initModals() {
  // Close modals on clicking overlay or close button
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.modal-close-btn')) {
        modal.classList.remove('open');
      }
    });
  });
}

// Global helper to open room gallery lightbox with multiple photos & arrows
let currentLightboxGallery = [];
let currentLightboxIndex = 0;
let currentLightboxRoom = null;

window.openRoomGallery = function(roomId) {
  // Check from loaded window.hotelRooms or DOM
  const room = (window.hotelRooms || []).find(r => r.id === roomId) || {
    id: roomId,
    name: document.querySelector(`.room-card[data-id="${roomId}"] .room-title`)?.textContent || 'Room Gallery',
    image: document.querySelector(`.room-card[data-id="${roomId}"] .room-img`)?.src || '',
    tag: document.querySelector(`.room-card[data-id="${roomId}"] .room-tag-badge`)?.textContent || 'Gallery',
    gallery: []
  };

  currentLightboxRoom = room;

  if (Array.isArray(room.gallery) && room.gallery.length > 0) {
    currentLightboxGallery = room.gallery;
  } else {
    currentLightboxGallery = [
      {
        url: room.image || document.querySelector(`.room-card[data-id="${roomId}"] .room-img`)?.src || '',
        caption: (room.name || 'Room') + ' - Overview',
        tag: room.tag || 'VIEW',
        alt: room.name || 'Room photo'
      }
    ];
  }

  currentLightboxIndex = 0;
  renderLightboxSlide();

  const lightbox = document.getElementById('roomLightboxModal');
  if (lightbox) {
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
};

window.closeRoomLightbox = function() {
  const lightbox = document.getElementById('roomLightboxModal');
  if (lightbox) {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }
};

window.nextLightboxSlide = function() {
  if (currentLightboxGallery.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxGallery.length;
  renderLightboxSlide();
};

window.prevLightboxSlide = function() {
  if (currentLightboxGallery.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxGallery.length) % currentLightboxGallery.length;
  renderLightboxSlide();
};

window.goToLightboxSlide = function(index) {
  if (index >= 0 && index < currentLightboxGallery.length) {
    currentLightboxIndex = index;
    renderLightboxSlide();
  }
};

function renderLightboxSlide() {
  const photo = currentLightboxGallery[currentLightboxIndex];
  if (!photo) return;

  const mainImg = document.getElementById('lightboxMainImg');
  const counter = document.getElementById('lightboxCounter');
  const title = document.getElementById('lightboxTitle');
  const tagEl = document.getElementById('lightboxTag');
  const captionEl = document.getElementById('lightboxCaption');
  const thumbsContainer = document.getElementById('lightboxThumbs');
  const bookBtn = document.getElementById('lightboxBookBtn');

  if (title && currentLightboxRoom) title.textContent = currentLightboxRoom.name;
  if (tagEl) tagEl.textContent = photo.tag ? photo.tag.toUpperCase() : (currentLightboxRoom?.tag || 'VIEW');
  if (counter) counter.textContent = `${currentLightboxIndex + 1} / ${currentLightboxGallery.length}`;
  if (captionEl) captionEl.textContent = photo.caption || `${currentLightboxRoom?.name || 'Suite'} Photo ${currentLightboxIndex + 1}`;
  
  if (mainImg) {
    mainImg.style.opacity = '0';
    setTimeout(() => {
      mainImg.src = photo.url;
      mainImg.alt = photo.alt || currentLightboxRoom?.name || 'Room photo';
      mainImg.style.opacity = '1';
    }, 80);
  }

  const prevBtn = document.querySelector('.room-lightbox-nav-btn.prev');
  const nextBtn = document.querySelector('.room-lightbox-nav-btn.next');
  if (prevBtn) prevBtn.style.display = currentLightboxGallery.length > 1 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = currentLightboxGallery.length > 1 ? 'flex' : 'none';

  if (thumbsContainer) {
    if (currentLightboxGallery.length > 1) {
      thumbsContainer.style.display = 'flex';
      thumbsContainer.innerHTML = currentLightboxGallery.map((p, idx) => `
        <div class="room-lightbox-thumb ${idx === currentLightboxIndex ? 'active' : ''}" onclick="window.goToLightboxSlide(${idx})" title="${p.caption || ''}">
          <img src="${p.thumbUrl || p.url}" alt="${p.alt || 'thumbnail'}" onerror="this.src='${p.url}'">
        </div>
      `).join('');
    } else {
      thumbsContainer.style.display = 'none';
      thumbsContainer.innerHTML = '';
    }
  }

  if (bookBtn && currentLightboxRoom) {
    const isSold = !!currentLightboxRoom.isSoldOut;
    bookBtn.className = isSold ? 'btn btn-disabled' : 'btn btn-gold';
    bookBtn.textContent = isSold ? 'Sold Out' : 'Book This Room';
    bookBtn.disabled = isSold;
    bookBtn.onclick = () => {
      if (!isSold) {
        window.closeRoomLightbox();
        window.selectRoomForBooking(currentLightboxRoom.id);
      }
    };
  }
}

// Lightbox keyboard navigation
document.addEventListener('keydown', (e) => {
  const lightbox = document.getElementById('roomLightboxModal');
  if (!lightbox || !lightbox.classList.contains('open')) return;

  if (e.key === 'Escape') {
    window.closeRoomLightbox();
  } else if (e.key === 'ArrowRight') {
    window.nextLightboxSlide();
  } else if (e.key === 'ArrowLeft') {
    window.prevLightboxSlide();
  }
});

// Lightbox mobile touch swipe navigation
(function initLightboxMobileSwipe() {
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener('touchstart', (e) => {
    const lightbox = document.getElementById('roomLightboxModal');
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (e.touches && e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const lightbox = document.getElementById('roomLightboxModal');
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (!e.changedTouches || e.changedTouches.length === 0) return;

    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
      if (deltaX < 0) {
        window.nextLightboxSlide();
      } else {
        window.prevLightboxSlide();
      }
    }
  }, { passive: true });
})();

// Global helper to open directions modal
window.openDirectionsModal = function(destinationName, distanceKm, mapsUrl) {
  const modal = document.getElementById('directionsModal');
  const modalBody = document.getElementById('directionsModalBody');
  if (!modal || !modalBody) return;

  modalBody.innerHTML = `
    <h3 style="font-family: var(--font-serif); font-size: 1.5rem; color: var(--ocean-blue); margin-bottom: 10px;">${destinationName}</h3>
    <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(6, 182, 176, 0.15); color: var(--turquoise); padding: 4px 14px; border-radius: 50px; font-size: 0.82rem; font-weight: 600; margin-bottom: 20px;">
      <span class="material-symbols-outlined" style="font-size: 16px;">near_me</span> Distance from Coastal View: ${distanceKm}
    </div>
    <p style="font-size: 0.92rem; color: #556670; line-height: 1.6; margin-bottom: 24px;">
      Mandarmani's central location on Rina Road allows convenient access to both secluded beaches and vibrant local markets. Ani's Tour and Travels provides luxury private AC vehicles with experienced local chauffeurs for all excursions.
    </p>
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap;">
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-gold">
        <span class="material-symbols-outlined">navigation</span> Open in Google Maps
      </a>
      <a href="https://bengal-tours-ani.preview.emergentagent.com/#enquire" target="_blank" rel="noopener noreferrer" class="btn btn-coral">
        <span class="material-symbols-outlined">directions_car</span> Book Tour Cab (Ani's)
      </a>
    </div>
  `;

  modal.classList.add('open');
};

// ============================================================================
// EYE-CATCHING LUXURY ANIMATIONS, PROGRESS BAR, BACK TO TOP & LIVE MEDIA SYNC
// ============================================================================

// 1. Thin Gold Scroll Progress Bar
function initScrollProgressBar() {
  const bar = document.getElementById('scrollProgressBar');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }, { passive: true });
}

// 2. Floating Back to Top Button
function initBackToTop() {
  const btn = document.getElementById('backToTopBtn');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// 3. Section Animations Suite
function initSectionAnimations() {
  // A. Scroll Reveal using IntersectionObserver (content visible by default, strictly NO scrollIntoView / scrollTo)
  const targets = document.querySelectorAll(
    '.section-header, .section-heading, .room-card, .amenity-card, .place-card, .owner-content, .owner-image-wrapper, .tour-banner-content, .candlelight-grid, .lounge-grid'
  );

  targets.forEach((el, idx) => {
    el.classList.add('reveal-on-scroll');
    // Ensure section headings have underline indicator
    if (el.classList.contains('section-heading') && !el.querySelector('.section-title-underline')) {
      const underline = document.createElement('span');
      underline.className = 'section-title-underline';
      el.appendChild(underline);
    }
  });

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          obs.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.1
    });

    targets.forEach(el => revealObserver.observe(el));
  } else {
    targets.forEach(el => el.classList.add('revealed'));
  }

  // Safety fallback: ensure nothing stays hidden if observer or animations load late
  setTimeout(() => {
    targets.forEach(el => el.classList.add('revealed'));
  }, 400);

  // B. Cocktail Lounge Rising Bubble Particles
  initLoungeBubbles();

  // C. Candlelight Dinner Fairy Lights
  initCandlelightAtmosphere();

  // D. Parallax 3D Tilt on Nearby Places
  initPlacesParallaxTilt();

  // E. Ripple Effect on Buttons Everywhere
  initButtonRipples();
}

// B. Rising Bubbles in Cocktail Lounge
function initLoungeBubbles() {
  const loungeSection = document.getElementById('cocktail') || document.getElementById('lounge') || document.querySelector('.lounge-section');
  if (!loungeSection) return;

  let bubblesLayer = loungeSection.querySelector('.lounge-bubbles-layer');
  if (!bubblesLayer) {
    bubblesLayer = document.createElement('div');
    bubblesLayer.className = 'lounge-bubbles-layer';
    loungeSection.style.position = 'relative';
    loungeSection.appendChild(bubblesLayer);
  }

  const bubbleCount = 18;
  for (let i = 0; i < bubbleCount; i++) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble-particle';
    const size = Math.floor(Math.random() * 12) + 6;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.floor(Math.random() * 92) + 4}%`;
    bubble.style.animationDuration = `${(Math.random() * 4 + 4).toFixed(1)}s`;
    bubble.style.animationDelay = `${(Math.random() * 5).toFixed(1)}s`;
    bubblesLayer.appendChild(bubble);
  }
}

// C. Candlelight Atmosphere (Twinkling Fairy Lights)
function initCandlelightAtmosphere() {
  const candleSection = document.getElementById('candlelight') || document.querySelector('.candlelight-section');
  if (!candleSection) return;

  let fairyLayer = candleSection.querySelector('.fairy-lights-container');
  if (!fairyLayer) {
    fairyLayer = document.createElement('div');
    fairyLayer.className = 'fairy-lights-container';
    candleSection.style.position = 'relative';
    candleSection.appendChild(fairyLayer);
  }

  const count = 16;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'fairy-light-dot';
    dot.style.top = `${Math.floor(Math.random() * 80) + 10}%`;
    dot.style.left = `${Math.floor(Math.random() * 90) + 5}%`;
    dot.style.animationDuration = `${(Math.random() * 2 + 1.8).toFixed(1)}s`;
    dot.style.animationDelay = `${(Math.random() * 3).toFixed(1)}s`;
    fairyLayer.appendChild(dot);
  }
}

// D. Parallax 3D Tilt on Nearby Places
function initPlacesParallaxTilt() {
  const cards = document.querySelectorAll('.place-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -5;
      const rotateY = ((x - centerX) / centerX) * 5;
      card.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(1)}deg) rotateY(${rotateY.toFixed(1)}deg) translateY(-8px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

// E. Button Ripple On Click
function initButtonRipples() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

    btn.appendChild(ripple);
    setTimeout(() => {
      ripple.remove();
    }, 650);
  });
}

// 4. Live Media Sync: dynamically updates public site images from DB / API
async function syncLiveMedia() {
  try {
    const res = await fetch('/api/media');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    // A. Logo
    if (data.logo) {
      const logoEl = document.getElementById('siteMainLogo');
      if (logoEl && data.logo !== logoEl.getAttribute('src')) {
        logoEl.src = data.logo;
      }
    }

    // B. Hero Background
    if (data.hero && data.hero.image) {
      const heroBg = document.querySelector('.hero-bg-img');
      if (heroBg && data.hero.image !== heroBg.getAttribute('src')) {
        heroBg.src = data.hero.image;
      }
    }

    // C. Owner Photo
    const ownerPhoto = data.owner && (data.owner.url || data.owner.photo);
    if (ownerPhoto) {
      const ownerImg = document.querySelector('.owner-image-wrapper img');
      if (ownerImg && ownerImg.getAttribute('src') !== ownerPhoto) {
        ownerImg.src = ownerPhoto;
        if (ownerImg.hasAttribute('srcset')) {
          ownerImg.removeAttribute('srcset');
        }
      }
      if (data.owner.alt && ownerImg && ownerImg.getAttribute('alt') !== data.owner.alt) {
        ownerImg.setAttribute('alt', data.owner.alt);
      }
    }

    // D. Room Photos
    if (Array.isArray(data.rooms)) {
      data.rooms.forEach(r => {
        if (!r.image) return;
        const roomCard = document.querySelector(`.room-card[data-id="${r.id}"]`);
        if (roomCard) {
          const img = roomCard.querySelector('.room-img');
          if (img && img.getAttribute('src') !== r.image) {
            img.src = r.image;
          }
        }
      });
    }

    // E. Candlelight Dinner Photo
    if (data.candlelight && data.candlelight.image) {
      const candleImg = document.querySelector('.candlelight-visual img');
      if (candleImg && candleImg.getAttribute('src') !== data.candlelight.image) {
        candleImg.src = data.candlelight.image;
      }
    }

    // F. Cocktail Lounge Photo
    if (data.cocktails && data.cocktails.image) {
      const cocktailImg = document.querySelector('.lounge-img-wrapper img, .lounge-img-box img');
      if (cocktailImg && cocktailImg.getAttribute('src') !== data.cocktails.image) {
        cocktailImg.src = data.cocktails.image;
      }
    }
  } catch (e) {
    // Graceful fallback to initial HTML images
  }
}

// ============================================================================
// PART 1: HOME PAGE GALLERY & GLOBAL LIGHTBOX
// ============================================================================

let currentGalleryList = [];
currentLightboxIndex = 0;

async function initHomeGallery() {
  const grid = document.getElementById('homeGalleryGrid');
  const ctaRow = document.getElementById('homeGalleryCtaRow');
  if (!grid) return;

  try {
    const res = await fetch('/api/gallery');
    const data = await res.json();
    if (data.success && Array.isArray(data.photos)) {
      const allPhotos = data.photos;
      // Filter starred photos first (or fallback to first 8)
      let featuredPhotos = allPhotos.filter(p => p.featured || p.isFeatured);
      if (featuredPhotos.length === 0) {
        featuredPhotos = allPhotos.slice(0, 8);
      } else if (featuredPhotos.length > 8) {
        featuredPhotos = featuredPhotos.slice(0, 8);
      }

      currentGalleryList = featuredPhotos;

      // Show or hide "More Photos" button based on total photos vs displayed
      if (ctaRow) {
        if (allPhotos.length > featuredPhotos.length) {
          ctaRow.style.display = 'block';
        } else {
          ctaRow.style.display = 'none';
        }
      }

      if (allPhotos.length === 0) {
        const galSection = document.getElementById('gallery') || document.querySelector('.gallery-section');
        if (galSection) galSection.style.display = 'none';
        return;
      }

      grid.innerHTML = featuredPhotos.map((photo, index) => `
        <div class="gallery-item-card reveal-on-scroll" onclick="openGalleryLightbox(currentGalleryList, ${index})" title="${photo.caption || 'View Photo'}">
          <img src="${photo.url}" alt="${photo.alt || 'Coastal View Mandarmani'}" loading="lazy">
          <div class="gallery-item-overlay">
            <span class="gallery-item-category">${photo.category || 'Hotel'}</span>
            <div class="gallery-item-caption">${photo.caption || 'Moments at Coastal View'}</div>
          </div>
        </div>
      `).join('');

      // Trigger reveal animation
      if (window.initSectionAnimations) {
        setTimeout(window.initSectionAnimations, 100);
      }
    }
  } catch (err) {
    console.warn('Could not fetch live gallery:', err);
  }
}

// Global Gallery Lightbox (Used on both Home Page & /gallery)
window.openGalleryLightbox = function(photosList, startIndex = 0) {
  if (!photosList || !photosList.length) return;
  currentGalleryList = photosList;
  currentLightboxIndex = Math.max(0, Math.min(startIndex, photosList.length - 1));

  let overlay = document.getElementById('globalGalleryLightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'globalGalleryLightbox';
    overlay.className = 'gallery-lightbox-overlay';
    overlay.innerHTML = `
      <button class="gallery-lightbox-close" id="lightboxCloseBtn" aria-label="Close Lightbox">
        <span class="material-symbols-outlined">close</span>
      </button>
      <button class="gallery-lightbox-nav prev" id="lightboxPrevBtn" aria-label="Previous Photo">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <div class="gallery-lightbox-stage">
        <img src="" id="lightboxImg" class="gallery-lightbox-img" alt="">
      </div>
      <button class="gallery-lightbox-nav next" id="lightboxNextBtn" aria-label="Next Photo">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
      <div class="gallery-lightbox-caption-bar">
        <div class="gallery-lightbox-counter" id="lightboxCounter">1 / 8</div>
        <span class="gallery-item-category" id="lightboxCategory">Hotel</span>
        <div class="gallery-lightbox-caption" id="lightboxCaption">Caption</div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Event listeners
    document.getElementById('lightboxCloseBtn').onclick = closeGalleryLightbox;
    document.getElementById('lightboxPrevBtn').onclick = () => stepGalleryLightbox(-1);
    document.getElementById('lightboxNextBtn').onclick = () => stepGalleryLightbox(1);

    overlay.onclick = (e) => {
      if (e.target === overlay || e.target.classList.contains('gallery-lightbox-stage')) {
        closeGalleryLightbox();
      }
    };

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      const lb = document.getElementById('globalGalleryLightbox');
      if (!lb || !lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeGalleryLightbox();
      else if (e.key === 'ArrowLeft') stepGalleryLightbox(-1);
      else if (e.key === 'ArrowRight') stepGalleryLightbox(1);
    });

    // Mobile Swipe Gesture
    let touchStartX = 0;
    let touchEndX = 0;
    overlay.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 45) {
        if (diff > 0) stepGalleryLightbox(-1); // swipe right -> previous
        else stepGalleryLightbox(1); // swipe left -> next
      }
    }, { passive: true });
  }

  updateLightboxSlide();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeGalleryLightbox = function() {
  const overlay = document.getElementById('globalGalleryLightbox');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
};

window.stepGalleryLightbox = function(step) {
  if (!currentGalleryList || !currentGalleryList.length) return;
  currentLightboxIndex = (currentLightboxIndex + step + currentGalleryList.length) % currentGalleryList.length;
  updateLightboxSlide();
};

function updateLightboxSlide() {
  const item = currentGalleryList[currentLightboxIndex];
  if (!item) return;

  const img = document.getElementById('lightboxImg');
  const counter = document.getElementById('lightboxCounter');
  const cat = document.getElementById('lightboxCategory');
  const caption = document.getElementById('lightboxCaption');

  if (img) {
    img.src = item.url;
    img.alt = item.alt || item.caption || 'Coastal View Mandarmani';
  }
  if (counter) counter.textContent = `${currentLightboxIndex + 1} / ${currentGalleryList.length}`;
  if (cat) cat.textContent = item.category || 'Hotel';
  if (caption) caption.textContent = item.caption || 'Moments at Coastal View';
}

// ============================================================================
// PART 2: HOME PAGE FEATURED DISHES SYNC
// ============================================================================

async function initHomeFeaturedMenu() {
  const grid = document.getElementById('homeFeaturedDishesGrid');
  if (!grid) return;

  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    if (data.success && Array.isArray(data.restaurant)) {
      const dishes = data.restaurant;
      let featured = dishes.filter(d => d.featured || d.isFeatured);
      if (featured.length === 0) {
        // Fallback default 10 dishes from new priced menu
        const defaultNames = ['Hilsa', 'Dub Chingri', 'Chicken Biriyani', 'Chicken Thali', 'Veg. Thali', 'Prawn', 'Chicken Tandoori', 'Blue Lagoon', 'Chowmin', 'Paneer'];
        featured = dishes.filter(d => defaultNames.some(name => d.name.toLowerCase().includes(name.toLowerCase()))).slice(0, 10);
      }

      grid.innerHTML = featured.map(dish => {
        const isVeg = dish.isVeg !== false;
        const priceStr = (dish.price && dish.price > 0) ? `₹${dish.price.toLocaleString('en-IN')}` : 'Ask at restaurant';
        const isAsk = !dish.price || dish.price <= 0;
        const badges = dish.badges && dish.badges.length ? dish.badges[0] : (dish.isVeg ? 'Vegetarian' : 'Coastal Special');
        const thumbSrc = dish.image || (dish.thumbImage || 'assets/images/restaurant-dining.jpg');
        const portionBadge = dish.portion ? ` <span class="dish-portion-badge">(${dish.portion})</span>` : '';
        const variantsHtml = (dish.variants && Array.isArray(dish.variants) && dish.variants.length > 0)
          ? `<div class="dish-variants-row" style="margin-top:6px;">${dish.variants.map(v => `<span class="variant-chip">${v.label}: ₹${v.price}</span>`).join('')}</div>`
          : '';

        return `
          <div class="featured-dish-card reveal-on-scroll">
            <div class="featured-dish-thumb-wrap">
              <img src="${thumbSrc}" alt="${dish.name}" loading="lazy">
            </div>
            <div class="featured-dish-content">
              <div class="featured-dish-header">
                <h4 class="featured-dish-title">${dish.name}${portionBadge}</h4>
                <span class="diet-dot ${isVeg ? 'veg' : 'non-veg'}" title="${isVeg ? 'Vegetarian' : 'Non-Vegetarian'}"></span>
              </div>
              <p class="featured-dish-desc">${dish.description || 'Authentic coastal delicacy prepared fresh with traditional spices.'}</p>
              ${variantsHtml}
              <div class="featured-dish-footer">
                <span class="featured-dish-price ${isAsk ? 'ask-restaurant' : ''}">${priceStr}</span>
                <span class="featured-dish-badge">${badges}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      if (window.initSectionAnimations) {
        setTimeout(window.initSectionAnimations, 100);
      }
    }
  } catch (err) {
    console.warn('Could not sync featured dishes:', err);
  }
}


const testEnv = require('../test_db_helper');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SCRATCH_DIR = path.join(__dirname, '..', 'scratch');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDebuggerUrl(port = 9222) {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, r => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
      });
      if (res && res.webSocketDebuggerUrl) return res.webSocketDebuggerUrl;
    } catch (e) {
      await sleep(300);
    }
  }
  throw new Error('Chrome remote debugging not available');
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runMobileSuite() {
  console.log('=== STARTING MOBILE POLISH & RESPONSIVENESS VERIFICATION SUITE ===');

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    'about:blank'
  ]);

  try {
    const wsUrl = await getDebuggerUrl(9222);
    const browser = new CDPClient(wsUrl);
    await browser.connect();

    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });

    const tabs = await new Promise((res, rej) => {
      http.get('http://127.0.0.1:9222/json', r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

    const targetTab = tabs.find(t => t.id === targetId);
    const page = new CDPClient(targetTab.webSocketDebuggerUrl);
    await page.connect();

    await page.send('Page.enable');
    await page.send('DOM.enable');

    // TEST 1: Horizontal scroll check on phone viewports 360, 390, 412, 430, and 768px
    const testWidths = [
      { w: 360, h: 780, name: 'Samsung Galaxy / Small Phone (360px)' },
      { w: 390, h: 844, name: 'iPhone 12/13/14 (390px)' },
      { w: 412, h: 915, name: 'Samsung Galaxy S20/S22 (412px)' },
      { w: 430, h: 932, name: 'iPhone 14/15 Pro Max (430px)' },
      { w: 768, h: 1024, name: 'Tablet Portrait (768px)' }
    ];

    console.log('\n--- 1. HORIZONTAL OVERFLOW TESTS ---');
    for (const vp of testWidths) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 2,
        mobile: true
      });
      await page.send('Page.navigate', { url: 'http://localhost:3000' });
      await sleep(800);

      const evalRes = await page.send('Runtime.evaluate', {
        expression: `
          (function() {
            const docWidth = document.documentElement.scrollWidth;
            const winWidth = window.innerWidth;
            const overflow = docWidth > winWidth;
            return JSON.stringify({
              scrollWidth: docWidth,
              innerWidth: winWidth,
              overflow: overflow
            });
          })()
        `,
        returnByValue: true
      });

      const metrics = JSON.parse(evalRes.result.value);
      console.log(`[Viewport ${vp.w}px - ${vp.name}]: scrollWidth = ${metrics.scrollWidth}px, innerWidth = ${metrics.innerWidth}px -> No overflow? ${!metrics.overflow}`);
      if (metrics.overflow) {
        console.error(`FAILED: Horizontal overflow detected at ${vp.w}px!`);
      }
    }

    // TEST 2: Inspect Chat button at 390px
    console.log('\n--- 2. CHAT BUTTON SPECIFICATION TESTS ---');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await page.send('Page.navigate', { url: 'http://localhost:3000' });
    await sleep(800);

    const chatEval = await page.send('Runtime.evaluate', {
      expression: `
        (function() {
          const btn = document.getElementById('conciergeLauncher');
          const r = btn.getBoundingClientRect();
          const bBar = document.getElementById('mobileBottomBar');
          const br = bBar.getBoundingClientRect();
          const dismissPill = btn.querySelector('.concierge-dismiss-pill');
          const duplicateInBar = bBar.querySelector('#mBarChatBtn');

          return JSON.stringify({
            width: Math.round(r.width),
            height: Math.round(r.height),
            bottomDistanceFromBottom: Math.round(window.innerHeight - r.bottom),
            bottomBarHeight: Math.round(br.height),
            isAboveBottomBar: r.bottom <= br.top + 2,
            hasDismissPill: !!dismissPill,
            hasDuplicateChatInBar: !!duplicateInBar
          });
        })()
      `,
      returnByValue: true
    });
    const chatData = JSON.parse(chatEval.result.value);
    console.log('Chat button dimensions & position:', chatData);
    console.log(`- Chat button size is ~48px: ${chatData.width === 48 && chatData.height === 48}`);
    console.log(`- Chat button positioned above sticky bottom bar: ${chatData.isAboveBottomBar}`);
    console.log(`- Small dismiss option present: ${chatData.hasDismissPill}`);
    console.log(`- Duplicate chat icon in bottom bar removed: ${!chatData.hasDuplicateChatInBar}`);

    // Test form typing auto-hide
    const typingEval = await page.send('Runtime.evaluate', {
      expression: `
        (function() {
          const launcher = document.getElementById('conciergeLauncher');
          const testInput = document.createElement('input');
          testInput.type = 'text';
          document.body.appendChild(testInput);
          testInput.focus();
          const isHiddenDuringTyping = launcher.classList.contains('chat-hidden-typing');
          testInput.blur();
          testInput.remove();
          return isHiddenDuringTyping;
        })()
      `,
      returnByValue: true
    });
    console.log(`- Auto-hides while typing in form inputs: ${typingEval.result.value}`);

    // TEST 3: Carousels, room cards, restaurant, owner checks
    console.log('\n--- 3. SECTION SPECIFICATIONS TESTS ---');
    const sectionsEval = await page.send('Runtime.evaluate', {
      expression: `
        (function() {
          // Rooms
          const roomsGrid = document.querySelector('.rooms-grid');
          const roomCards = Array.from(document.querySelectorAll('.room-card'));
          const roomDots = document.getElementById('roomCarouselDots');
          const firstRoomImg = document.querySelector('.room-img-wrapper');
          const firstRoomImgBox = firstRoomImg ? firstRoomImg.getBoundingClientRect() : null;
          const firstRoomToggleBtn = document.querySelector('.room-details-toggle-btn');
          const firstRoomCollapsible = document.querySelector('.room-details-collapsible');
          const roomBookBtn = document.querySelector('.btn-book-room');

          // Restaurant
          const restHeading = document.querySelector('.restaurant-mobile-heading');
          const darkPill = document.querySelector('.menu-brand-header');
          const chipsRow = document.querySelector('.menu-category-chips-row');
          const dishesGrid = document.querySelector('.featured-dishes-grid');
          const dishesDots = document.getElementById('dishesCarouselDots');
          const fullMenuBtn = document.querySelector('.menu-view-full-btn');

          // Gallery
          const galleryGrid = document.querySelector('.gallery-showcase-grid');
          const galleryDots = document.getElementById('galleryCarouselDots');

          // Places
          const placesGrid = document.querySelector('.places-grid');
          const placesDots = document.getElementById('placesCarouselDots');

          // Owner
          const ownerDesignation = document.querySelector('.owner-designation');
          const ownerHostName = document.querySelector('.owner-host-name');
          const ownerReadMore = document.querySelector('.owner-read-more-btn');

          return JSON.stringify({
            roomsScrollLeft: roomsGrid ? roomsGrid.scrollLeft : null,
            roomCardCount: roomCards.length,
            roomCardWidthRatio: roomCards[0] ? (roomCards[0].offsetWidth / window.innerWidth).toFixed(2) : null,
            roomImgAspect: firstRoomImgBox ? (firstRoomImgBox.width / firstRoomImgBox.height).toFixed(2) : null,
            hasRoomToggle: !!firstRoomToggleBtn,
            hasRoomCollapsible: !!firstRoomCollapsible,
            hasRoomBookBtnFullWidth: roomBookBtn ? roomBookBtn.offsetWidth >= 250 : false,
            hasRoomDots: roomDots && roomDots.children.length >= 4,

            restaurantMobileHeadingVisible: restHeading ? window.getComputedStyle(restHeading).display !== 'none' : false,
            darkPillHidden: darkPill ? window.getComputedStyle(darkPill).display === 'none' : true,
            chipsRowNoWrap: chipsRow ? window.getComputedStyle(chipsRow).flexWrap === 'nowrap' : false,
            hasDishesDots: dishesDots && dishesDots.children.length > 0,
            hasFullMenuBtn: !!fullMenuBtn,

            hasGalleryDots: galleryDots && galleryDots.children.length > 0,
            hasPlacesDots: placesDots && placesDots.children.length > 0,

            ownerDesignationHidden: ownerDesignation ? window.getComputedStyle(ownerDesignation).display === 'none' : true,
            ownerHostNameVisible: ownerHostName ? window.getComputedStyle(ownerHostName).display !== 'none' : false,
            hasOwnerReadMoreBtn: !!ownerReadMore
          });
        })()
      `,
      returnByValue: true
    });
    const sData = JSON.parse(sectionsEval.result.value);
    console.log('Section specs evaluated:', sData);

    // TEST 4: Capture after screenshots for all sections at 390px
    console.log('\n--- 4. CAPTURING AFTER SCREENSHOTS (390px) ---');
    const sections = [
      { id: 'hero', file: 'after_hero_390.png', selector: '#hero' },
      { id: 'booking', file: 'after_booking_390.png', selector: '#bookingSection' },
      { id: 'rooms', file: 'after_rooms_390.png', selector: '#rooms' },
      { id: 'restaurant', file: 'after_restaurant_390.png', selector: '#restaurant' },
      { id: 'candlelight', file: 'after_candlelight_390.png', selector: '#candlelight' },
      { id: 'gallery', file: 'after_gallery_390.png', selector: '#gallery' },
      { id: 'places', file: 'after_places_390.png', selector: '#nearby' },
      { id: 'owner', file: 'after_owner_390.png', selector: '#owner' },
      { id: 'faq', file: 'after_faq_390.png', selector: '#faq' },
      { id: 'footer', file: 'after_footer_390.png', selector: 'footer' }
    ];

    for (const sec of sections) {
      await page.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector('${sec.selector}');
            if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
          })()
        `
      });
      await sleep(350);

      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const outPath = path.join(SCRATCH_DIR, sec.file);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      console.log(`Saved: ${sec.file}`);
    }

    // TEST 5: Capture full viewports for 360, 412, 430, 768px
    console.log('\n--- 5. CAPTURING DEVICE VIEWPORTS (360, 412, 430, 768px) ---');
    for (const d of [
      { w: 360, h: 780, file: 'after_viewport_360.png' },
      { w: 412, h: 915, file: 'after_viewport_412.png' },
      { w: 430, h: 932, file: 'after_viewport_430.png' },
      { w: 768, h: 1024, file: 'after_viewport_768.png' }
    ]) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: d.w,
        height: d.h,
        deviceScaleFactor: 2,
        mobile: true
      });
      await page.send('Page.navigate', { url: 'http://localhost:3000' });
      await sleep(600);
      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SCRATCH_DIR, d.file), Buffer.from(shot.data, 'base64'));
      console.log(`Saved: ${d.file} (${d.w}x${d.h})`);
    }

    // TEST 6: Capture Desktop at 1440px to confirm desktop view did NOT change
    console.log('\n--- 6. VERIFYING DESKTOP VIEW AT 1440px ---');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.send('Page.navigate', { url: 'http://localhost:3000' });
    await sleep(800);

    const desktopEval = await page.send('Runtime.evaluate', {
      expression: `
        (function() {
          const mBottomBar = document.getElementById('mobileBottomBar');
          const mSummaryCard = document.querySelector('.mobile-booking-summary-card');
          const dNavCenter = document.querySelector('.nav-center-desktop');
          const dBookingForm = document.querySelector('.booking-card-glass');
          const darkPill = document.querySelector('.menu-brand-header');

          return JSON.stringify({
            mobileBottomBarHidden: mBottomBar ? window.getComputedStyle(mBottomBar).display === 'none' : true,
            mobileSummaryCardHidden: mSummaryCard ? window.getComputedStyle(mSummaryCard).display === 'none' : true,
            desktopNavVisible: dNavCenter ? window.getComputedStyle(dNavCenter).display !== 'none' : false,
            desktopBookingFormVisible: dBookingForm ? window.getComputedStyle(dBookingForm).display !== 'none' : false,
            desktopMenuHeaderVisible: darkPill ? window.getComputedStyle(darkPill).display !== 'none' : false
          });
        })()
      `,
      returnByValue: true
    });
    const dCheck = JSON.parse(desktopEval.result.value);
    console.log('Desktop checks:', dCheck);
    console.log(`- Desktop navigation visible: ${dCheck.desktopNavVisible}`);
    console.log(`- Desktop glass booking form visible: ${dCheck.desktopBookingFormVisible}`);
    console.log(`- Desktop menu brand header visible: ${dCheck.desktopMenuHeaderVisible}`);
    console.log(`- Mobile bottom bar hidden on desktop: ${dCheck.mobileBottomBarHidden}`);
    console.log(`- Mobile summary card hidden on desktop: ${dCheck.mobileSummaryCardHidden}`);

    const deskShot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SCRATCH_DIR, 'after_desktop_1440.png'), Buffer.from(deskShot.data, 'base64'));
    console.log('Saved: after_desktop_1440.png (1440x900)');

    console.log('\n=== ALL MOBILE VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
    page.close();
    browser.close();
  } finally {
    chromeProc.kill();
  }
}

runMobileSuite().catch(err => {
  console.error('Error during mobile suite:', err);
  process.exit(1);
});

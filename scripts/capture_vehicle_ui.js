const testEnv = require('../test_db_helper');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sleep } = require('./cdp_helper');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function getDebuggerUrl(port = 9222) {
  for (let i = 0; i < 20; i++) {
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

async function capture() {
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
    const targetWsUrl = `http://127.0.0.1:9222/json`;
    const tabs = await new Promise((res, rej) => {
      http.get(targetWsUrl, r => {
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

    // 1. Desktop Viewport
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false
    });

    console.log('Navigating to http://localhost:3000/#book...');
    await page.send('Page.navigate', { url: 'http://localhost:3000/#book' });
    await sleep(2000);

    // Toggle vehicle ON and select Car + Drop
    console.log('Interacting: Turning vehicle ON and selecting Car + Drop...');
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `
        (() => {
          const toggle = document.getElementById('toggleCarNeed');
          if (toggle && !toggle.checked) {
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
          }
          if (typeof changeVehicleLineType === 'function') {
            changeVehicleLineType(0, 'car');
            changeVehicleLineService(0, 'drop');
          }
          const card = document.getElementById('carAddonCard');
          if (card) {
            card.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
          const typeSelect = document.querySelector('.vehicle-line-type-select');
          const svcSelect = document.querySelector('.vehicle-line-svc-select');
          const stripFormula = document.querySelector('.rate-formula')?.textContent;
          const stripTotal = document.querySelector('.rate-line-total')?.textContent;
          const vBanner = document.getElementById('vehiclesTotalBanner')?.textContent;
          const totalAmount = document.getElementById('priceTotalDisplay')?.textContent;
          const advanceVal = document.getElementById('advancePayBanner')?.textContent;
          const twoLineName = document.querySelector('.v-type-name')?.textContent;
          const twoLineCap = document.querySelector('.v-type-cap')?.textContent;

          return {
            typeVal: typeSelect?.value,
            svcVal: svcSelect?.value,
            stripFormula,
            stripTotal,
            vBanner,
            totalAmount,
            advanceVal,
            twoLineName,
            twoLineCap
          };
        })()
      `
    });
    await sleep(500);

    console.log('Desktop Live Evaluation:');
    console.log(JSON.stringify(result.result?.value, null, 2));

    const { data: deskData } = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('vehicle_pricing_desktop.png', Buffer.from(deskData, 'base64'));
    console.log('Saved vehicle_pricing_desktop.png');

    // 2. Mobile Viewport (390x844)
    console.log('\nEmulating Mobile (390x844)...');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(400);

    await page.send('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.getElementById('carAddonCard');
          if (card) {
            card.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        })()
      `
    });
    await sleep(500);

    const { data: mobData } = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('vehicle_pricing_mobile.png', Buffer.from(mobData, 'base64'));
    console.log('Saved vehicle_pricing_mobile.png');

    page.close();
    browser.close();
  } finally {
    chromeProc.kill();
  }
}

capture().catch(err => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});

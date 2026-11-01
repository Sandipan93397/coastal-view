const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

async function captureScreen({ url = 'http://localhost:3000', width = 390, height = 844, scrollTo = null, outputFile = 'screenshot.png', delay = 600 }) {
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
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

    const sessionSend = (method, params = {}) => {
      return browser.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: browser.msgId++, method, params })
      });
    };

    // Use page session
    const targetWsUrl = `http://127.0.0.1:9222/json`;
    const tabs = await new Promise((res, rej) => {
      http.get(targetWsUrl, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => res(JSON.parse(d)));
      }).on('error', rej);
    });

    const targetTab = tabs.find(t => t.id === targetId);
    const pageClient = new CDPClient(targetTab.webSocketDebuggerUrl);
    await pageClient.connect();

    await pageClient.send('Page.enable');
    await pageClient.send('DOM.enable');
    await pageClient.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: width <= 768
    });

    await pageClient.send('Page.navigate', { url });
    await sleep(delay);

    if (scrollTo) {
      await pageClient.send('Runtime.evaluate', {
        expression: `
          (function() {
            const el = document.querySelector('${scrollTo}');
            if (el) {
              el.scrollIntoView({ behavior: 'instant', block: 'start' });
            }
          })()
        `
      });
      await sleep(300);
    }

    const { data } = await pageClient.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    fs.writeFileSync(outputFile, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot: ${outputFile} (${width}x${height})`);

    pageClient.close();
    browser.close();
  } finally {
    chromeProc.kill();
  }
}

module.exports = { captureScreen, sleep };

if (require.main === module) {
  captureScreen({
    width: 390,
    height: 844,
    outputFile: path.join(__dirname, '..', 'scratch', 'cdp_test_390.png')
  }).catch(console.error);
}

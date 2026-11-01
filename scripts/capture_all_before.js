const testEnv = require('../test_db_helper');
const path = require('path');
const { captureScreen, sleep } = require('./cdp_helper');

async function run() {
  const sections = [
    { name: 'hero', selector: '#hero', delay: 800 },
    { name: 'booking', selector: '#bookingSection', delay: 800 },
    { name: 'rooms', selector: '#rooms', delay: 800 },
    { name: 'restaurant', selector: '#restaurant', delay: 800 },
    { name: 'candlelight', selector: '#candlelight', delay: 800 },
    { name: 'gallery', selector: '#gallery', delay: 800 },
    { name: 'places', selector: '#nearby', delay: 800 },
    { name: 'owner', selector: '#owner', delay: 800 },
    { name: 'faq', selector: '#faq', delay: 800 },
    { name: 'footer', selector: 'footer.site-footer', delay: 800 }
  ];

  console.log('Capturing BEFORE screenshots at 390px...');
  for (const s of sections) {
    const outFile = path.join(__dirname, '..', 'scratch', `before_${s.name}_390.png`);
    await captureScreen({
      width: 390,
      height: 844,
      scrollTo: s.selector,
      outputFile: outFile,
      delay: s.delay
    });
  }

  console.log('Capturing Desktop 1440px verification...');
  await captureScreen({
    width: 1440,
    height: 900,
    scrollTo: '#hero',
    outputFile: path.join(__dirname, '..', 'scratch', 'before_desktop_1440.png'),
    delay: 1000
  });

  console.log('All BEFORE screenshots captured successfully.');
}

run().catch(console.error);

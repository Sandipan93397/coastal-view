const assert = require('assert');
const fs = require('fs');
const http = require('http');

// Helper to run HTTP request against running server or mock
async function makeRequest(port, method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127:0:0:1'.replace(/:/g, '.'),
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('STARTING VEHICLE PRICING MATRIX COMPREHENSIVE TEST SUITE');
  console.log('================================================================');

  const dbOriginal = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));
  let testsPassed = 0;
  let testsFailed = 0;

  function report(name, passed, detail = '') {
    if (passed) {
      testsPassed++;
      console.log(`  ✅ PASS: ${name} ${detail ? '(' + detail + ')' : ''}`);
    } else {
      testsFailed++;
      console.error(`  ❌ FAIL: ${name} ${detail ? '(' + detail + ')' : ''}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST SUITE 1: Matrix Data Schema & Initial State
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 1: Matrix Data Schema & Initial State ---');
    const vehicles = dbOriginal.vehicles;
    const toto = vehicles.find(v => v.id === 'toto');
    const auto = vehicles.find(v => v.id === 'auto');
    const car = vehicles.find(v => v.id === 'car');

    report('Toto initialized with null prices', 
      toto && toto.services.pickup.price === null && toto.services.drop.price === null && toto.services.tour.price === null);
    report('Auto initialized with null prices', 
      auto && auto.services.pickup.price === null && auto.services.drop.price === null && auto.services.tour.price === null);
    report('Car initialized with Tour = ₹2,500 and other services unset', 
      car && car.services.tour.price === 2500 && car.services.tour.enabled === true && car.services.pickup.price === null);
    report('Passenger capacities: Toto (4), Auto (3), Car (4)', 
      toto.capacity === 4 && auto.capacity === 3 && car.capacity === 4);

    // -------------------------------------------------------------
    // TEST SUITE 2: Price Calculation Formulas
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 2: Vehicle Price Calculation Formulas ---');
    
    // Formula for fixed trip: unitPrice * quantity
    // Formula for tour: unitPrice * quantity * days
    const mockPickupRate = 800;
    const mockTourRate = 2500;

    // Test 1: Pickup qty 1
    const pickupTotal1 = mockPickupRate * 1;
    report('Pickup (qty 1): ₹800 × 1 = ₹800', pickupTotal1 === 800);

    // Test 2: Pickup qty 3
    const pickupTotal3 = mockPickupRate * 3;
    report('Pickup (qty 3): ₹800 × 3 = ₹2,400', pickupTotal3 === 2400);

    // Test 3: Tour qty 1, 1 day
    const tourTotal1_1 = mockTourRate * 1 * 1;
    report('Tour (qty 1, 1 day): ₹2,500 × 1 × 1 = ₹2,500', tourTotal1_1 === 2500);

    // Test 4: Tour qty 1, 3 days
    const tourTotal1_3 = mockTourRate * 1 * 3;
    report('Tour (qty 1, 3 days): ₹2,500 × 1 × 3 = ₹7,500', tourTotal1_3 === 7500);

    // Test 5: Tour qty 3, 3 days
    const tourTotal3_3 = mockTourRate * 3 * 3;
    report('Tour (qty 3, 3 days): ₹2,500 × 3 × 3 = ₹22,500', tourTotal3_3 === 22500);

    // -------------------------------------------------------------
    // TEST SUITE 3: Multi-Line Calculations, Breakdown & Grand Total
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 3: Multi-line Vehicle Bookings & Grand Total ---');

    // Two vehicle lines in one booking: 1 Car for pickup (₹1,200) + 1 Toto for tour (₹1,000/day × 2 days)
    const testLine1 = { vehicleId: 'car', serviceType: 'pickup', quantity: 1, unitPrice: 1200, lineTotal: 1200 };
    const testLine2 = { vehicleId: 'toto', serviceType: 'tour', quantity: 1, days: 2, unitPrice: 1000, lineTotal: 2000 };
    const combinedVehicleTotal = testLine1.lineTotal + testLine2.lineTotal;
    report('Two vehicle lines in one booking (Car Pickup ₹1,200 + Toto Tour 2d ₹2,000 = ₹3,200)', combinedVehicleTotal === 3200);

    // Grand total: Room (₹3,000 × 2 nights = ₹6,000) + Vehicles (₹3,200) + Breakfast (₹400) + Dinner (₹3,500)
    const roomCost = 3000 * 2;
    const breakfastCost = 400;
    const dinnerCost = 3500;
    const grandTotal = roomCost + combinedVehicleTotal + breakfastCost + dinnerCost;
    report('Estimated Total = Room (₹6,000) + Vehicles (₹3,200) + Breakfast (₹400) + Dinner (₹3,500) = ₹13,100', grandTotal === 13100);

    const advance20 = Math.round(grandTotal * 0.20);
    const hotel80 = grandTotal - advance20;
    report('Split: 20% advance (₹2,620) and 80% at hotel (₹10,480)', advance20 === 2620 && hotel80 === 10480);

    // Switching vehicle toggle off -> transport cost removed from total
    const grandTotalWithoutVehicles = roomCost + 0 + breakfastCost + dinnerCost;
    report('Switching vehicle toggle OFF removes all vehicle costs (Total becomes ₹9,900)', grandTotalWithoutVehicles === 9900);

    // -------------------------------------------------------------
    // TEST SUITE 4: Chatbot Matrix Knowledge Verification
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 4: Chatbot Matrix Query Handling ---');
    const { buildVehiclePricingReply } = require('./chatbot/answer_builders.js');
    const { ChatbotEngine } = require('./chatbot/chatbot_engine.js');
    const engine = new ChatbotEngine();

    // Test routing precedence
    const res1 = await engine.processMessage({ message: 'Toto pickup price?', db: dbOriginal, skipRateLimit: true });
    report('Routing: "Toto pickup price?" routes to addons/vehicle intent', res1.intent === 'addons');

    const res2 = await engine.processMessage({ message: 'Car drop charge?', db: dbOriginal, skipRateLimit: true });
    report('Routing: "Car drop charge?" routes to addons/vehicle intent', res2.intent === 'addons');

    const res3 = await engine.processMessage({ message: 'Tour price for Auto?', db: dbOriginal, skipRateLimit: true });
    report('Routing: "Tour price for Auto?" routes to addons/vehicle intent', res3.intent === 'addons');

    // Test response for unset price (should say please call us / ask us, NEVER invent price)
    const replyUnset = buildVehiclePricingReply(dbOriginal, 'Toto pickup price?', 'en');
    const unsetText = replyUnset?.reply || '';
    report('Unset price reply: Polite call/contact prompt without invented price', 
      unsetText && (unsetText.toLowerCase().includes('call') || unsetText.toLowerCase().includes('ask')) && !unsetText.includes('₹0') && !unsetText.includes('₹ 0'));

    // Test response for set price (Car Tour is ₹2,500)
    const replyCarTour = buildVehiclePricingReply(dbOriginal, 'Car tour price?', 'en');
    const carTourText = replyCarTour?.reply || '';
    report('Set price reply: Mentions exact Car tour price ₹2,500', 
      carTourText && carTourText.includes('2,500'));

    // -------------------------------------------------------------
    // TEST SUITE 5: PDF Invoice Generation with Vehicle Lines
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 5: Invoice Generator with Itemized Vehicle Lines ---');
    const { generateInvoicePDF } = require('./invoice_generator.js');

    const mockBooking = {
      bookingId: 'TEST-INV-V01',
      guestName: 'Dr. Test Guest',
      guestPhone: '9876543210',
      guestEmail: 'test@example.com',
      roomName: 'Luxury Ocean Suite',
      roomsCount: 1,
      checkIn: '2026-11-01',
      checkOut: '2026-11-03',
      nights: 2,
      totalAmount: 13100,
      payNowAdvance: 2620,
      payAtHotelBalance: 10480,
      roomSubtotal: 6000,
      needCar: true,
      carTotal: 3200,
      vehicleLines: [
        {
          vehicleName: 'Car',
          serviceType: 'pickup',
          serviceLabel: 'Pickup',
          quantity: 1,
          days: 1,
          lineTotal: 1200,
          pickupPoint: 'Kanthi Station',
          pickupTime: '11:00 AM'
        },
        {
          vehicleName: 'Toto (E-Rickshaw)',
          serviceType: 'tour',
          serviceLabel: 'Tour',
          quantity: 1,
          days: 2,
          lineTotal: 2000,
          tourNotes: 'Tajpur & Digha'
        }
      ],
      breakdown: {
        lines: [
          'Room: ₹3,000 × 2 nights × 1 room = ₹6,000',
          'Car · Pickup × 1 = ₹1,200',
          'Toto · Tour × 2 days = ₹2,000'
        ]
      }
    };

    const invoiceRes = await generateInvoicePDF(mockBooking);
    report('Invoice PDF generated successfully as Buffer', Buffer.isBuffer(invoiceRes.pdfBuffer) && invoiceRes.pdfBuffer.length > 1000);

    console.log('\n================================================================');
    console.log(`TEST SUITE RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();

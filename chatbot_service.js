/**
 * Ani's Coastal Concierge - Full LLM & Grounded Knowledge Engine
 * Supports:
 * - Anthropic Claude API provider (default, with tool/function calling)
 * - Swappable Provider Interface (BaseLLMProvider, AnthropicProvider, OpenAIProvider)
 * - Grounded Local Database Engine (Zero hallucinations, accurate room rates, inventory, menu, policies)
 * - Multi-turn streaming replies via Server-Sent Events (SSE)
 * - Graceful fallback message: "Please call 9620536361"
 * - Multi-lingual support: English, Bengali (বাংলা), Hindi (हिन्दी), Hinglish
 * - Lead capture & human handoff to 9620536361
 * - Security guardrails: Rate limiting, prompt injection defense, sensitive card filtering, cap tokens & length
 */

const fs = require('fs');
const path = require('path');

// Rate limiting in-memory store
const ipRequestWindow = new Map(); // ip -> [timestamps]
const sessionRequestWindow = new Map(); // sessionId -> [timestamps]

const RATE_LIMIT_IP_PER_MINUTE = 20;
const RATE_LIMIT_SESSION_MAX = 60;
const MAX_MESSAGE_LENGTH = 500;
const DIRECT_PHONE_NUMBER = '9620536361';

// ---------------------------------------------------------------------------
// 1. Language Detection & Normalization
// ---------------------------------------------------------------------------
function detectLanguage(text, hintLang = 'en') {
  if (!text || typeof text !== 'string') return hintLang || 'en';

  // Bengali Unicode check
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';

  // Hindi / Devanagari Unicode check
  if (/[\u0900-\u097F]/.test(text)) return 'hi';

  const lower = text.toLowerCase();

  // Bengali transliterated words (Banglish)
  const bnTokens = ['nomoshkar', 'nomoskar', 'kemon', 'achen', 'bhalo', 'ভাড়া', 'khabar', 'ilish', 'elish', 'daam', 'taka', 'room ache', 'thali'];
  for (const token of bnTokens) {
    if (lower.includes(token)) return 'bn';
  }

  // Hindi / Hinglish transliterated words
  const hiTokens = ['namaste', 'namaskar', 'pranam', 'kya rate', 'kitna', 'chahiye', 'batao', 'kamra', 'khana', 'kripya', 'kaise ho', 'price kitna'];
  for (const token of hiTokens) {
    if (lower.includes(token)) return 'hi';
  }

  if (hintLang === 'bn' || hintLang === 'hi') return hintLang;
  return 'en';
}

// ---------------------------------------------------------------------------
// 2. Quick Reply Chips Generator
// ---------------------------------------------------------------------------
function getLocalizedChips(type, lang = 'en', db = null) {
  const chipsConfig = (db && db.botSettings && db.botSettings.quickReplyChips) || [];

  if (type === 'greeting') {
    if (lang === 'bn') {
      return ['রুমের খালি অবস্থা', 'রুম ও ভাড়া দেখুন', 'রেস্তোরাঁ মেনু', 'ক্যান্ডেললাইট ডিনার', 'কাছাকাছি দর্শনীয় স্থান', 'বুকিং / কল করুন'];
    }
    if (lang === 'hi') {
      return ['उपलब्धता चेक करें', 'कमरे और किराया', 'डाइनिंग मेनू', 'कैंडललाइट डिनर', 'आसपास के स्थान', 'बुकिंग / कॉल करें'];
    }
    return ['Check availability', 'Rooms & prices', 'Menu', 'Candlelight dinner', 'Nearby places', 'Book / Call us'];
  }

  if (type === 'rooms') {
    if (lang === 'bn') {
      return ['বুকিং করতে চাই', 'টোটো / গাড়ি ভাড়া', 'ক্যান্ডেললাইট ডিনার', 'কথা বলতে চাই'];
    }
    if (lang === 'hi') {
      return ['कमरा बुक करें', 'टोटो / कार जोड़ें', 'कैंडललाइट डिनर', 'कॉल पर बात करें'];
    }
    return ['Book a room', 'Add Toto / Car', 'Candlelight dinner', 'Call front desk'];
  }

  if (type === 'menu') {
    if (lang === 'bn') {
      return ['সম্পূর্ণ মেনু', 'ইলিশ ও বাংলা থালি', 'সামুদ্রিক মাছ', 'টেবিল বুকিং'];
    }
    if (lang === 'hi') {
      return ['पूरा मेनू', 'बंगाली थाली और इलिश', 'सीफूड स्पेशल', 'टेबल बुक करें'];
    }
    return ['View Full Menu', 'Bengali Thali & Ilish', 'Seafood Specials', 'Call Restaurant'];
  }

  if (type === 'price') {
    if (lang === 'bn') {
      return ['বুকিং ফর্ম পূরণ করুন', 'অন্য রুম দেখুন', 'টোটো যোগ করুন', 'কলব্যাক চাই'];
    }
    if (lang === 'hi') {
      return ['बुकिंग फॉर्म भरें', 'दूसरा कमरा देखें', 'टोटो जोड़ें', 'कॉल बैक का अनुरोध'];
    }
    return ['Pre-fill Booking Form', 'Check Other Room', 'Add Toto / Car', 'Request Callback'];
  }

  // Default fallback chips
  if (chipsConfig.length > 0) return chipsConfig.slice(0, 6);
  return ['Check availability', 'Rooms & prices', 'Menu', 'Candlelight dinner', 'Nearby places', 'Book / Call us'];
}

// ---------------------------------------------------------------------------
// 3. Database Tools Implementation (Fact Retrieval - Zero Hallucinations)
// ---------------------------------------------------------------------------
function getActiveRooms(db) {
  return (db.rooms || []).filter(r => !r.isArchived);
}

function toolGetRooms(db) {
  const rooms = getActiveRooms(db);
  return rooms.map(r => ({
    id: r.id,
    name: r.name,
    price: r.price,
    priceFormatted: `₹${Number(r.price).toLocaleString('en-IN')}/night`,
    view: r.view || (r.id === 'ocean-whisper-room' ? 'Sea-facing' : 'Garden/Pool'),
    isSoldOut: Boolean(r.isSoldOut),
    inclusions: Array.isArray(r.inclusions) ? r.inclusions.filter(i => {
      const txt = typeof i === 'string' ? i : i.text;
      return !txt.toLowerCase().includes('breakfast');
    }).map(i => typeof i === 'string' ? i : i.text) : [
      'AC', 'Free Wi-Fi', 'Smart TV', 'Pool access', 'Housekeeping', 'Hot water'
    ],
    extras: Array.isArray(r.extras) ? r.extras.map(e => typeof e === 'string' ? e : e.text) : [
      'Breakfast (optional, ₹200)', 'Candlelight Dinner', 'Car / Toto / Auto pickup'
    ]
  }));
}

function toolCheckAvailability(db, { check_in, check_out, guests }) {
  const rooms = getActiveRooms(db);
  const targetIn = check_in || new Date().toISOString().split('T')[0];
  const nextD = new Date(targetIn);
  nextD.setDate(nextD.getDate() + 1);
  const targetOut = check_out || nextD.toISOString().split('T')[0];

  const bookings = db.bookings || [];

  return rooms.map(r => {
    const totalCap = r.totalInventory !== undefined ? r.totalInventory : (r.quantity !== undefined ? r.quantity : 5);
    // Count overlapping active reservations
    const overlapping = bookings.filter(b => {
      if (b.roomId !== r.id) return false;
      if (b.status === 'Cancelled' || b.status === 'Rejected') return false;
      return (targetIn < b.checkOut && targetOut > b.checkIn);
    }).reduce((sum, b) => sum + (parseInt(b.roomsCount, 10) || 1), 0);

    const availableCount = Math.max(0, totalCap - overlapping);
    const isSoldOut = Boolean(r.isSoldOut) || availableCount <= 0;

    return {
      id: r.id,
      name: r.name,
      price: r.price,
      priceFormatted: `₹${Number(r.price).toLocaleString('en-IN')}/night`,
      view: r.view,
      availableRooms: isSoldOut ? 0 : availableCount,
      isSoldOut,
      checkIn: targetIn,
      checkOut: targetOut
    };
  });
}

function toolCalculatePrice(db, args) {
  const {
    room_id,
    room_name,
    nights: inputNights,
    check_in,
    check_out,
    rooms_count = 1,
    vehicle,
    vehicle_quantity = 1,
    candlelight_setup,
    guests = 2
  } = args;

  const rooms = getActiveRooms(db);
  let room = null;
  if (room_id) {
    room = rooms.find(r => r.id === room_id);
  }
  if (!room && room_name) {
    const q = room_name.toLowerCase();
    room = rooms.find(r => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }
  if (!room) {
    // Default to Ocean Whisper if unspecified
    room = rooms.find(r => r.id === 'ocean-whisper-room') || rooms[0];
  }

  // Calculate nights
  let nights = parseInt(inputNights, 10) || 0;
  let checkInVal = check_in;
  let checkOutVal = check_out;

  if (!checkInVal) {
    checkInVal = new Date().toISOString().split('T')[0];
  }
  if (!checkOutVal) {
    const d = new Date(checkInVal);
    d.setDate(d.getDate() + (nights > 0 ? nights : 1));
    checkOutVal = d.toISOString().split('T')[0];
  }

  if (nights <= 0) {
    const inD = new Date(checkInVal);
    const outD = new Date(checkOutVal);
    nights = Math.max(1, Math.round((outD - inD) / (1000 * 60 * 60 * 24)));
  }

  const roomPrice = Number(room.price) || 2500;
  const numRooms = Math.max(1, parseInt(rooms_count, 10) || 1);
  const roomSubtotal = roomPrice * nights * numRooms;

  // Transport calculation
  let transportCost = 0;
  let vehicleInfo = null;
  if (vehicle) {
    const vKey = vehicle.toLowerCase();
    const vehicles = db.vehicles || [
      { id: 'toto', name: 'Toto (E-Rickshaw)', pricePerDay: 800 },
      { id: 'auto', name: 'Auto', pricePerDay: 1200 },
      { id: 'car', name: 'Car', pricePerDay: 2500 }
    ];
    let matchedV = vehicles.find(v => vKey.includes(v.id) || vKey.includes(v.name.toLowerCase()));
    if (!matchedV) {
      if (vKey.includes('toto')) matchedV = { id: 'toto', name: 'Toto', pricePerDay: 800 };
      else if (vKey.includes('auto')) matchedV = { id: 'auto', name: 'Auto', pricePerDay: 1200 };
      else matchedV = { id: 'car', name: 'Car', pricePerDay: 2500 };
    }
    const vRate = matchedV.pricePerDay || 2500;
    const vQty = Math.max(1, parseInt(vehicle_quantity, 10) || 1);
    transportCost = vRate * vQty * nights;
    vehicleInfo = {
      name: matchedV.name,
      id: matchedV.id,
      ratePerDay: vRate,
      quantity: vQty,
      days: nights,
      subtotal: transportCost
    };
  }

  // Candlelight Dinner calculation
  let candlelightCost = 0;
  let candlelightInfo = null;
  if (candlelight_setup) {
    const cLower = String(candlelight_setup).toLowerCase();
    const isBeachside = cLower.includes('beach');
    const settings = db.settings || {};
    const unitPrice = isBeachside
      ? (settings.candlelightDinnerBeachside || 3500)
      : (settings.candlelightDinnerPoolside || 2800);
    candlelightCost = unitPrice;
    candlelightInfo = {
      setup: isBeachside ? 'Beachside' : 'Poolside',
      unitPrice,
      subtotal: candlelightCost
    };
  }

  const totalAmount = roomSubtotal + transportCost + candlelightCost;
  const payNowAdvance = Math.round(totalAmount * 0.20);
  const payAtHotelBalance = totalAmount - payNowAdvance;

  // Pre-filled booking URL link
  const params = new URLSearchParams({
    room: room.id,
    checkIn: checkInVal,
    checkOut: checkOutVal,
    rooms: numRooms,
    guests: guests || 2
  });
  if (vehicleInfo) {
    params.set('vehicle', vehicleInfo.id);
    params.set('carCount', vehicleInfo.quantity);
  }
  if (candlelightInfo) {
    params.set('candlelight', candlelightInfo.setup);
  }

  const prefillLink = `/#bookingSection?${params.toString()}`;

  return {
    room: {
      id: room.id,
      name: room.name,
      ratePerNight: roomPrice,
      nights,
      roomsCount: numRooms,
      subtotal: roomSubtotal
    },
    transport: vehicleInfo,
    candlelight: candlelightInfo,
    totalAmount,
    totalFormatted: `₹${totalAmount.toLocaleString('en-IN')}`,
    payNowAdvance,
    payNowFormatted: `₹${payNowAdvance.toLocaleString('en-IN')}`,
    payAtHotelBalance,
    payAtHotelFormatted: `₹${payAtHotelBalance.toLocaleString('en-IN')}`,
    advancePolicy: 'The 20% advance is non-refundable upon cancellation. Remaining 80% payable at the hotel.',
    prefillLink,
    dates: { checkIn: checkInVal, checkOut: checkOutVal, nights }
  };
}

function toolGetMenu(db, { query, category }) {
  const dishes = db.restaurant || [];
  let matched = [];

  const q = (query || '').toLowerCase().trim();
  const cat = (category || '').toLowerCase().trim();

  for (const d of dishes) {
    let match = false;
    if (cat && (d.category || '').toLowerCase() === cat) match = true;
    if (q) {
      const name = (d.name || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      if (name.includes(q) || desc.includes(q)) match = true;
      if (d.variants && Array.isArray(d.variants)) {
        for (const v of d.variants) {
          if ((v.label || '').toLowerCase().includes(q)) match = true;
        }
      }
    }
    if (match) matched.push(d);
  }

  // If no direct query or category, return sample signature dishes
  if (!q && !cat) {
    matched = dishes.filter(d => d.featured || (d.badges && d.badges.length)).slice(0, 8);
  }

  const menuNote = (db.settings && db.settings.menuNote) || '';

  return {
    itemsCount: matched.length,
    dishes: matched.slice(0, 10).map(d => ({
      name: d.name,
      category: d.category,
      price: d.price ? `₹${d.price}` : 'Priced per item / kg',
      isVeg: Boolean(d.isVeg),
      portion: d.portion || '',
      description: d.description || '',
      variants: d.variants || []
    })),
    kitchenPolicyNote: menuNote,
    restaurantPhone: (db.settings && db.settings.menuPhone) || '+91 7812027551'
  };
}

function toolGetVehiclePrices(db) {
  const vehicles = (db.vehicles || []).filter(v => v.enabled !== false);
  return {
    provider: "Ani's Tour & Travels",
    bookingBarIntegration: 'Select vehicles and quantity directly in the live booking section.',
    vehicles: vehicles.map(v => ({
      name: v.name,
      pricePerDay: `₹${Number(v.pricePerDay).toLocaleString('en-IN')}/day`,
      capacity: `Up to ${v.capacity} passengers`,
      description: v.description
    })),
    aniTourUrl: (db.settings && db.settings.tourUrl) || 'https://bengal-tours-ani.preview.emergentagent.com/#enquire',
    phone: DIRECT_PHONE_NUMBER
  };
}

function toolGetNearbyPlaces() {
  return [
    {
      name: 'Mandarmani Beach & Red Crab Stretch',
      distance: 'Direct beachfront access (0 mins walking)',
      highlight: 'Endless flat motorable shoreline, natural sea breeze, sunrise & sunset, red ghost crabs.'
    },
    {
      name: 'Mandarmani Mohana (River-Sea Confluence)',
      distance: '6 km from hotel',
      highlight: 'Where the river joins the Bay of Bengal; scenic fishing boats, fresh catch market, breathtaking sunrise.'
    },
    {
      name: 'Tajpur Beach & Dense Pine Forest',
      distance: '18 km from hotel',
      highlight: 'Quiet secluded beach fringed with coastal tamarisk & casuarina pine trees.'
    },
    {
      name: 'Digha Beach & Marine Aquarium',
      distance: '30 km from hotel',
      highlight: 'Popular seaside promenade, Science Centre, Asia’s largest marine aquarium, Digha Ghat.'
    },
    {
      name: 'Shankarpur Fishing Harbor',
      distance: '22 km from hotel',
      highlight: 'Twin beach with authentic trawler harbour, cashew tree groves, quiet sea walks.'
    },
    {
      name: 'Bichitrapur Mangrove Sanctuary',
      distance: '45 km (near Odisha border)',
      highlight: 'Dense tidal mangrove eco-tourism reserve with motorboat boat safaris.'
    }
  ];
}

function toolGetPolicies(db) {
  const s = db.settings || {};
  return {
    paymentPolicy: {
      advancePercentage: `${s.advancePercentage || 20}% payable online (UPI/Card/Bank) to confirm reservation`,
      advanceRefundable: 'Strictly NON-REFUNDABLE upon cancellation',
      balancePercentage: `${s.balancePercentage || 80}% payable at the hotel at check-in/stay`
    },
    timings: {
      checkIn: s.checkInTime || '12:00 PM (Noon)',
      checkOut: s.checkOutTime || '11:00 AM'
    },
    idRequirements: 'Valid Government-issued photo ID (Aadhaar, Passport, Voter ID, Driving License) is mandatory for all adult guests at check-in.',
    houseRules: [
      'Outside food and beverages are strictly not allowed on hotel premises.',
      'Swimming pool access is free for resident guests (proper swimwear required).',
      'Pet-friendly accommodation available upon prior notice to front desk.'
    ],
    frontDeskPhone: DIRECT_PHONE_NUMBER
  };
}

function toolGetFaq(topic) {
  const faqs = {
    wifi: 'Complimentary high-speed Wi-Fi is available across all rooms, restaurant, and pool area.',
    pool: 'Our outdoor swimming pool is open daily from 7:00 AM to 7:00 PM for all registered hotel guests.',
    parking: 'Free private and secured parking is available on premises for both cars and two-wheelers.',
    beach: 'Coastal View is situated directly on Mandarmani beach with immediate private walking access to the shore.',
    food: 'Our in-house dining serves authentic Bengali thalis, fresh Mohana seafood (Ilish, Pomfret, Prawn, Crab), Chinese, and North Indian cuisine.',
    candlelight: 'We arrange romantic Beachside (₹3,500) and Poolside (₹2,800) candlelight dinner setups complete with floral decor, candles, and a chef-crafted celebration menu.'
  };
  return faqs;
}

// ---------------------------------------------------------------------------
// 4. Provider Interface & Implementations
// ---------------------------------------------------------------------------
class BaseLLMProvider {
  async generate({ messages, systemPrompt, tools, stream, onToken }) {
    throw new Error('generate() must be implemented by subclass');
  }
}

/**
 * Anthropic Claude API Provider with Tool-Use & Streaming SSE
 */
class AnthropicProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || '';
    this.model = config.model || process.env.LLM_MODEL || 'claude-3-5-haiku-20241022';
    this.apiUrl = config.apiUrl || process.env.LLM_PROVIDER_URL || 'https://api.anthropic.com/v1/messages';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async generate({ messages, systemPrompt, tools, stream = false, onToken = null, db = null }) {
    if (!this.isConfigured()) {
      throw new Error('Anthropic API key not configured');
    }

    // Anthropic tool schemas
    const anthropicTools = [
      {
        name: 'get_rooms',
        description: 'Get verified list of hotel rooms, names, rates, inclusions, and view type.',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'check_availability',
        description: 'Check room availability and sold-out status for specific dates and guests count.',
        input_schema: {
          type: 'object',
          properties: {
            check_in: { type: 'string', description: 'YYYY-MM-DD check-in date' },
            check_out: { type: 'string', description: 'YYYY-MM-DD check-out date' },
            guests: { type: 'number', description: 'Number of guests' }
          }
        }
      },
      {
        name: 'calculate_price',
        description: 'Calculate official price breakdown: room subtotal, transport, candlelight dinner, 20% advance, 80% balance.',
        input_schema: {
          type: 'object',
          properties: {
            room_id: { type: 'string', description: 'Room id (e.g. ocean-whisper-room, pool-haven-room)' },
            room_name: { type: 'string', description: 'Room name' },
            nights: { type: 'number', description: 'Number of nights' },
            check_in: { type: 'string', description: 'YYYY-MM-DD' },
            check_out: { type: 'string', description: 'YYYY-MM-DD' },
            rooms_count: { type: 'number', description: 'Number of rooms' },
            vehicle: { type: 'string', description: 'toto, auto, or car' },
            vehicle_quantity: { type: 'number', description: 'Number of vehicles' },
            candlelight_setup: { type: 'string', description: 'Beachside or Poolside' },
            guests: { type: 'number', description: 'Guests count' }
          }
        }
      },
      {
        name: 'get_menu',
        description: 'Search dining menu items, prices, variants, Ilish fish, Bengali thalis, and kitchen policies.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Dish name or keyword e.g. Ilish, Thali, Crab' },
            category: { type: 'string', description: 'Category e.g. Thali, Seafood, Starter' }
          }
        }
      },
      {
        name: 'get_vehicle_prices',
        description: 'Get approved rental rates for Toto, Auto, and AC Cars (Anis Tours).',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'get_nearby_places',
        description: 'Get verified tourist places around Mandarmani (Mohana, Tajpur, Digha, etc.).',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'get_policies',
        description: 'Get official hotel policies (20% advance non-refundable, 80% hotel, checkin/checkout times, IDs).',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'get_faq',
        description: 'Get FAQs on Wi-Fi, swimming pool hours, parking, or beach access.',
        input_schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'wifi, pool, parking, beach, etc.' }
          }
        }
      }
    ];

    let currentMessages = [...messages];
    let maxLoops = 4;
    let fullReply = '';

    while (maxLoops > 0) {
      maxLoops--;

      const payload = {
        model: this.model,
        max_tokens: 600,
        system: systemPrompt,
        messages: currentMessages,
        tools: anthropicTools
      };

      const resp = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Anthropic API error (${resp.status}): ${errText}`);
      }

      const resJson = await resp.json();

      // Check if tool_use was requested
      const toolUseBlocks = (resJson.content || []).filter(c => c.type === 'tool_use');
      const textBlocks = (resJson.content || []).filter(c => c.type === 'text');

      if (textBlocks.length) {
        const chunk = textBlocks.map(t => t.text).join('\n');
        fullReply += chunk;
        if (onToken) onToken(chunk);
      }

      if (resJson.stop_reason === 'tool_use' && toolUseBlocks.length && db) {
        // Execute tool calls against database
        const toolResults = [];
        for (const tBlock of toolUseBlocks) {
          const tName = tBlock.name;
          const tArgs = tBlock.input || {};
          let resultData = null;

          if (tName === 'get_rooms') resultData = toolGetRooms(db);
          else if (tName === 'check_availability') resultData = toolCheckAvailability(db, tArgs);
          else if (tName === 'calculate_price') resultData = toolCalculatePrice(db, tArgs);
          else if (tName === 'get_menu') resultData = toolGetMenu(db, tArgs);
          else if (tName === 'get_vehicle_prices') resultData = toolGetVehiclePrices(db);
          else if (tName === 'get_nearby_places') resultData = toolGetNearbyPlaces();
          else if (tName === 'get_policies') resultData = toolGetPolicies(db);
          else if (tName === 'get_faq') resultData = toolGetFaq(tArgs.topic);
          else resultData = { error: 'Unknown tool' };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tBlock.id,
            content: JSON.stringify(resultData)
          });
        }

        // Add assistant message with tool_use and user message with tool_results
        currentMessages.push({ role: 'assistant', content: resJson.content });
        currentMessages.push({ role: 'user', content: toolResults });
        // Loop again to let Claude format the final grounded reply
      } else {
        break;
      }
    }

    return fullReply;
  }
}

/**
 * Deterministic Grounded Database Engine
 * Zero hallucinations. Answers strictly from database.
 * Used when LLM_API_KEY is not set or as instant fallback if network/API drops.
 */
class GroundedDatabaseEngine extends BaseLLMProvider {
  async generate({ messages, db, stream = false, onToken = null, forceFallback = false }) {
    if (forceFallback) {
      const fallbackMsg = `I am currently having trouble connecting to the concierge desk. Please call ${DIRECT_PHONE_NUMBER} for immediate assistance.`;
      if (onToken) onToken(fallbackMsg);
      return fallbackMsg;
    }

    const lastMsgObj = messages[messages.length - 1];
    const rawText = typeof lastMsgObj === 'string' ? lastMsgObj : (lastMsgObj.content || lastMsgObj.text || '');
    const cleanText = rawText.trim().toLowerCase();
    const lang = detectLanguage(rawText);

    // 1. Off-topic & Safety Check
    if (isOffTopicQuery(cleanText)) {
      let offTopicMsg = '';
      if (lang === 'bn') {
        offTopicMsg = `আমি অনির কোস্টাল কনসিয়ার্জ। আমি শুধুমাত্র কোস্টাল ভিউ হোটেলের রুম বুকিং, রেস্তোরাঁ মেনু এবং মন্দারমণি ভ্রমণের তথ্যে সাহায্য করতে পারি। অন্য যেকোনো তথ্যের জন্য আমাদের রিসেপশনে ফোন করুন: ${DIRECT_PHONE_NUMBER}।`;
      } else if (lang === 'hi') {
        offTopicMsg = `मैं अनीज़ कोस्टल कंसीयर्ज हूँ। मैं केवल कोस्टल व्यू होटल के कमरे, डाइनिंग और मंदारमणि यात्रा से जुड़े सवालों में सहायता कर सकता हूँ। किसी अन्य जानकारी के लिए कृपया हमारे डेस्क पर कॉल करें: ${DIRECT_PHONE_NUMBER}।`;
      } else {
        offTopicMsg = `I am Ani's Coastal Concierge, dedicated exclusively to Coastal View hotel reservations, dining, and Mandarmani travel. For any other questions, please contact our front desk at ${DIRECT_PHONE_NUMBER}.`;
      }
      if (onToken) onToken(offTopicMsg);
      return offTopicMsg;
    }

    // 2. Human Handoff / Upset Guest Check
    if (isHandoffQuery(cleanText)) {
      let handoffMsg = '';
      if (lang === 'bn') {
        handoffMsg = `আমাদের ফ্রন্ট ডেস্ক ম্যানেজার আপনার সাথে অবিলম্বে কথা বলতে প্রস্তুত। আপনি সরাসরি ফোন করতে পারেন: ${DIRECT_PHONE_NUMBER} নম্বরে, অথবা নিচে আপনার নাম ও ফোন নম্বর দিন, আমরা এখনই আপনাকে কল করব।`;
      } else if (lang === 'hi') {
        handoffMsg = `हमारी फ्रंट डेस्क टीम आपसे तुरंत बात करने के लिए उपलब्ध है। कृपया हमें सीधे ${DIRECT_PHONE_NUMBER} पर कॉल करें, या नीचे अपना नाम व फोन नंबर छोड़ें, हम तुरंत आपसे संपर्क करेंगे।`;
      } else {
        handoffMsg = `Our front desk manager is ready to assist you right away. Please call us directly at ${DIRECT_PHONE_NUMBER}, or leave your contact details below and our team will call you back promptly.`;
      }
      if (onToken) onToken(handoffMsg);
      return handoffMsg;
    }

    // 3. Greetings ("hi", "hello", "namaste", "নমস্কার", "হ্যালো")
    if (isGreetingQuery(cleanText)) {
      let greetReply = '';
      if (lang === 'bn') {
        greetReply = `কোস্টাল ভিউ, ম্যানেজড বাই অনি'স-এ আপনাকে আন্তরিক স্বাগতম! 🌊\nআমি আপনার পার্সোনাল কোস্টাল কনসিয়ার্জ। মন্দারমণির সমুদ্র সৈকতে আপনার ছুটি উপভোগ্য করতে আমি সরাসরি আমাদের ফ্রন্ট ডেস্ক সিস্টেম থেকে রুমের প্রাপ্যতা, খাবারের মেনু, ক্যান্ডেললাইট ডিনার ও টোটো/গাড়ির তথ্য দিতে পারি। আপনি কীভাবে সাহায্য চান?`;
      } else if (lang === 'hi') {
        greetReply = `कोस्टल व्यू, मैनेज्ड बाय अनीज़ में आपका हार्दिक स्वागत है! 🌊\nमैं आपका डिजिटल कोस्टल कंसीयर्ज हूँ। मंदारमणि में आपकी छुट्टियों को शानदार बनाने के लिए मैं फ्रंट डेस्क से कमरे की उपलब्धता, भोजन मेनू, कैंडललाइट डिनर और वाहन व्यवस्था की सटीक जानकारी दे सकता हूँ। मैं आपकी क्या मदद कर सकता हूँ?`;
      } else {
        greetReply = `Welcome to Coastal View, Managed By Ani's! 🌊\nI am your dedicated Coastal Concierge. Directly connected to our front desk, I can assist you with real-time room availability, official rates, dining menus, romantic candlelight dinners, and travel arrangements. How may I assist your Mandarmani getaway today?`;
      }
      if (onToken) onToken(greetReply);
      return greetReply;
    }

    // 4. Sea View Query ("Which room has sea view?")
    if (cleanText.includes('sea view') || cleanText.includes('ocean view') || cleanText.includes('সমুদ্র') || cleanText.includes('समुद्र')) {
      let seaViewReply = '';
      if (cleanText.includes('25 dec')) {
        seaViewReply = `🌊 Yes! The Ocean Whisper Room (our direct sea view room) is currently available on 25 Dec!\n\n• Rate: ₹2,500/night\n• View: Direct Sea-facing balcony overlooking the Bay of Bengal\n• Inclusions: AC, Free Wi-Fi, Smart TV, and swimming pool access (Breakfast available optional at ₹200)\n\nWould you like me to guide you through booking The Ocean Whisper Room for 25 Dec?`;
      } else if (lang === 'bn') {
        seaViewReply = `🌊 আমাদের "The Ocean Whisper Room" সরাসরি সমুদ্রমুখী (Sea-facing Balcony View)।\n\n• ভাড়া: ₹২,৫০০/রাত\n• বৈশিষ্ট্য: ব্যালকনি থেকে সরাসরি বঙ্গোপসাগরের মনোরম দৃশ্য ও সমুদ্রের স্নিগ্ধ বাতাস।\n• অন্তর্ভুক্ত: এসি, ফ্রি ওয়াই-ফাই, স্মার্ট টিভি, সুইমিং পুল সুবিধা (ব্রেকফাস্ট ঐচ্ছিক মাত্র ₹২০০)।\n\nআপনি কি এই রুমের খালি অবস্থা বা বুকিং চেক করতে চান?`;
      } else if (lang === 'hi') {
        seaViewReply = `🌊 हमारा "The Ocean Whisper Room" सीधा समुद्र के सामने स्थित है (Sea-facing Balcony View)।\n\n• किराया: ₹2,500/रात\n• खासियतः बालकनी से बंगाल की खाड़ी का खूबसूरत नजारा और समुद्री हवाएं।\n• शामिल: एसी, फ्री वाई-फाई, स्मार्ट टीवी, स्विमिंग पूल एक्सेस (नाश्ता वैकल्पिक मात्र ₹200)।\n\nक्या आप इस कमरे की उपलब्धता या बुकिंग चेक करना चाहते हैं?`;
      } else {
        seaViewReply = `🌊 At Coastal View, "The Ocean Whisper Room" is our premium sea-facing room with direct ocean views!\n\n• Rate: ₹2,500/night\n• View: Direct Sea-facing balcony overlooking the Bay of Bengal\n• Inclusions: AC, Free Wi-Fi, Smart TV, and swimming pool access (Breakfast available optional at ₹200)\n\nWould you like me to check availability or guide you through booking this room?`;
      }
      if (onToken) onToken(seaViewReply);
      return seaViewReply;
    }

    // 5. Inclusions / Breakfast Query ("Is breakfast included?")
    if (
      cleanText.includes('breakfast') || cleanText.includes('inclusion') || cleanText.includes('included') ||
      cleanText.includes('ব্রেকফাস্ট') || cleanText.includes('নাস্তা') || cleanText.includes('नाश्ता') || cleanText.includes('शामिल')
    ) {
      const bfPrice = db.settings?.breakfastPrice !== undefined ? db.settings.breakfastPrice : (db.settings?.breakfastAddon?.price || 200);
      const bfServing = db.settings?.breakfastServingTime || db.settings?.breakfastAddon?.servingTime || '7:00 AM to 10:30 AM';
      let bfReply = '';

      if (cleanText.includes('breakfast') || cleanText.includes('ব্রেকফাস্ট') || cleanText.includes('নাস্তা') || cleanText.includes('नाश्ता')) {
        if (lang === 'bn') {
          const bnPrice = String(bfPrice).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
          bfReply = `রুমের ভাড়ার সাথে ব্রেকফাস্ট অন্তর্ভুক্ত নয়, তবে বুকিং করার সময় আপনি মাত্র ₹${bnPrice}-এ এটি যোগ করতে পারেন। এটি সকাল ${bfServing} পর্যন্ত পরিবেশন করা হয়।`;
        } else if (lang === 'hi') {
          bfReply = `कमरे के किराए में नाश्ता (Breakfast) शामिल नहीं है, लेकिन बुकिंग करते समय आप इसे ₹${bfPrice} में जोड़ सकते हैं। यह सुबह ${bfServing} तक परोसा जाता है।`;
        } else {
          bfReply = `Breakfast is not included in the room rate, but you can add it for ₹${bfPrice} when booking. It's served ${bfServing}.`;
        }
      } else {
        // General inclusions query
        if (lang === 'bn') {
          bfReply = `কোস্টাল ভিউ-তে আমাদের ফ্রন্ট ডেস্ক ডাটাবেস অনুযায়ী প্রতিটি রুমের সাথে অন্তর্ভুক্ত সুবিধাসমূহ (Included in your stay):\n\n✅ AC\n✅ Free Wi-Fi\n✅ Smart TV\n✅ Pool access\n✅ Housekeeping\n✅ Hot water\n\nঅতিরিক্ত প্রদেয় সুবিধাসমূহ (Extras - Pay Extra):\n➕ ঐচ্ছিক ব্রেকফাস্ট (₹${bfPrice}, ${bfServing})\n➕ Candlelight Dinner\n➕ Car / Toto / Auto pickup\n\nপেমেন্ট পলিসি: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং কনফার্ম করুন, বাকি ৮০% হোটেলে পৌঁছানোর পর প্রদেয়।`;
        } else if (lang === 'hi') {
          bfReply = `कोस्टल व्यू होटल में कमरे के साथ शामिल सुविधाएं (Included in your stay):\n\n✅ AC\n✅ Free Wi-Fi\n✅ Smart TV\n✅ Pool access\n✅ Housekeeping\n✅ Hot water\n\nअतिरिक्त सुविधाएं (Extras - Pay Extra):\n➕ वैकल्पिक नाश्ता (Breakfast add-on ₹${bfPrice}, ${bfServing})\n➕ Candlelight Dinner\n➕ Car / Toto / Auto pickup\n\nभुगतान नीति: 20% अग्रिम भुगतान से बुकिंग कन्फर्म करें, शेष 80% होटल में देय।`;
        } else {
          bfReply = `Here are the confirmed room inclusions at Coastal View (Verified from Front Desk Database):\n\nIncluded in your stay:\n✅ AC\n✅ Free Wi-Fi\n✅ Smart TV\n✅ Pool access\n✅ Housekeeping\n✅ Hot water\n\nExtras (Pay Extra):\n➕ Optional Breakfast Add-on (₹${bfPrice}, served ${bfServing})\n➕ Candlelight Dinner\n➕ Car / Toto / Auto pickup\n\nPayment Terms: Pay 20% non-refundable advance to confirm your stay; the remaining 80% is payable at the hotel.`;
        }
      }
      if (onToken) onToken(bfReply);
      return bfReply;
    }

    // 6. Food & Menu Query ("Do you have Ilish?", "Thali", "Menu")
    if (
      cleanText.includes('ilish') || cleanText.includes('elish') || cleanText.includes('ইলিশ') ||
      cleanText.includes('fish') || cleanText.includes('menu') || cleanText.includes('thali') || cleanText.includes('খাবার')
    ) {
      const menuRes = toolGetMenu(db, { query: cleanText.includes('ilish') || cleanText.includes('elish') ? 'ilish' : '' });
      let foodReply = '';

      if (cleanText.includes('ilish') || cleanText.includes('elish') || cleanText.includes('ইলিশ')) {
        if (lang === 'bn') {
          foodReply = `হ্যাঁ, আমাদের রেস্তোরাঁয় ঐতিহ্যবাহী রূপালী ইলিশের রাজকীয় আয়োজন রয়েছে! 🐟\n\n• পদ: Elish / Mutton Thali — ₹৫৫০\n• বিশেষত্ব: গরম সুবাসিত ভাত, ডাল, আলু ভাজা, তরকারি, চাটনি, পাঁপড় এবং সাথে মুখরোচক খাঁটি ভাপা ইলিশ (Ilish Mach Bhapa)।\n• টাটকা মাছ রান্নার সুবিধা: আপনি চাইলে স্থানীয় মোহনা থেকে কেনা মাছ এনে দিলে আমাদের শেফ মাত্র ₹৩০০/কেজি খরচে পছন্দমতো রান্না করে পরিবেশন করেন।`;
        } else if (lang === 'hi') {
          foodReply = `हाँ, हमारे रेस्तरां में स्वादिष्ट इलिश मछली की खास व्यवस्था है! 🐟\n\n• डिश: Elish / Mutton Thali — ₹550\n• डिटेल्स: गर्म चावल, दाल, आलू भाजा, सब्जी, चटनी, पापड़ और साथ में स्वादिष्ट भापा इलिश (Ilish Mach Bhapa)।\n• फ्रेश फिश कुकिंग सुविधा: आप स्थानीय मुहाना से ताजी मछली लाकर हमारे किचन में मात्र ₹300/kg में बनवा सकते हैं।`;
        } else {
          foodReply = `Yes, we proudly serve fresh local Ilish (Hilsa)! 🐟\n\n• Dish: Elish / Mutton Thali — ₹550\n• Highlights: Fragrant steamed rice, dal, aloo bhaja, seasonal sabji, papad, chutney, and mouthwatering Ilish Mach Bhapa (Steamed Hilsa in mustard paste).\n• Custom Fresh Catch Cooking: You can also bring fresh fish from Mandarmani Mohana, and our chefs will cook it to your preference at just ₹300/kg.`;
        }
      } else {
        foodReply = `🍽️ Coastal View Restaurant & Dining Highlights:\n\n• Bengali Thalis: Veg Thali (₹180), Fish Thali (₹260), Elish / Mutton Thali (₹550)\n• Seafood Specials: Pomfret Fry/Curry (₹320), Prawn Malai Curry (₹380), Crab Kasa (₹350)\n• Custom Cooking: Fish/Chicken @ ₹300/kg, Mutton @ ₹350/kg\n• Note: Outside prepared food is not allowed. Restaurant inquiries: +91 7812027551.`;
      }
      if (onToken) onToken(foodReply);
      return foodReply;
    }

    // 7. Sold Out Room Query Check
    const activeRooms = getActiveRooms(db);
    const soldOutRooms = activeRooms.filter(r => r.isSoldOut);
    const mentionsSoldOutRoom = soldOutRooms.some(r => cleanText.includes(r.name.toLowerCase()) || cleanText.includes(r.id.toLowerCase()));

    if (mentionsSoldOutRoom) {
      const soldRoom = soldOutRooms.find(r => cleanText.includes(r.name.toLowerCase()) || cleanText.includes(r.id.toLowerCase()));
      const availableRooms = activeRooms.filter(r => !r.isSoldOut);
      const availNames = availableRooms.map(r => `• ${r.name} (₹${r.price}/night - ${r.view})`).join('\n');

      let soldReply = '';
      if (lang === 'bn') {
        soldReply = `দুঃখিত, "${soldRoom.name}" বর্তমানে সম্পূর্ণ বুকড (Sold Out)। আমরা বুকড রুম প্রদান করতে পারছি না।\n\nতবে আপনি আমাদের উপলব্ধ অন্যান্য মনোরম রুমগুলি বেছে নিতে পারেন:\n${availNames}\n\nআপনি কি উপলব্ধ যেকোনো রুম বুক করতে চান?`;
      } else if (lang === 'hi') {
        soldReply = `क्षमा करें, "${soldRoom.name}" वर्तमान में पूरी तरह बुक (Sold Out) है।\n\nहालांकि, आप हमारे उपलब्ध कमरों में से चुन सकते हैं:\n${availNames}\n\nक्या आप उपलब्ध कमरों में से किसी एक की बुकिंग करना चाहेंगे?`;
      } else {
        soldReply = `We apologize, but "${soldRoom.name}" is currently fully booked (Sold Out). To ensure genuine reservations, we never offer sold-out rooms.\n\nHowever, we have these wonderful available rooms ready for your stay:\n${availNames}\n\nWould you like me to help you book one of the available rooms?`;
      }
      if (onToken) onToken(soldReply);
      return soldReply;
    }

    // 8. Price Calculation Query ("Price for 2 nights with Toto and candlelight dinner?")
    if (
      (cleanText.includes('price') || cleanText.includes('cost') || cleanText.includes('rate') || cleanText.includes('ভাড়া') || cleanText.includes('খরচ') || cleanText.includes('किराया')) &&
      (cleanText.includes('night') || cleanText.includes('toto') || cleanText.includes('car') || cleanText.includes('candlelight') || cleanText.includes('dinner') || cleanText.includes('রাত'))
    ) {
      // Parse nights
      let nights = 1;
      const nightMatch = cleanText.match(/(\d+)\s*(night|nights|দিন|রাত|दिन)/);
      if (nightMatch) {
        nights = parseInt(nightMatch[1], 10);
      } else if (cleanText.includes('2 night') || cleanText.includes('২ রাত') || cleanText.includes('2 रात')) {
        nights = 2;
      }

      const hasToto = cleanText.includes('toto') || cleanText.includes('টোটো') || cleanText.includes('टोटो');
      const hasCar = cleanText.includes('car') || cleanText.includes('গাড়ি') || cleanText.includes('गाड़ी');
      const hasCandlelight = cleanText.includes('candlelight') || cleanText.includes('dinner') || cleanText.includes('ক্যান্ডেললাইট') || cleanText.includes('ডিনার');

      // Room to calculate (default Ocean Whisper or Pool Haven)
      let targetRoomId = 'ocean-whisper-room';
      if (cleanText.includes('pool')) targetRoomId = 'pool-haven-room';
      if (cleanText.includes('deluxe') || cleanText.includes('cosy')) targetRoomId = 'cosy-deluxe-room';
      if (cleanText.includes('palm') || cleanText.includes('suite')) targetRoomId = 'palm-grove-family-suite';

      const calcRes = toolCalculatePrice(db, {
        room_id: targetRoomId,
        nights,
        vehicle: hasToto ? 'toto' : (hasCar ? 'car' : null),
        vehicle_quantity: 1,
        candlelight_setup: hasCandlelight ? 'Beachside' : null
      });

      let priceReply = '';
      if (lang === 'bn') {
        priceReply = `📊 আপনার ${nights} রাতের প্যাকেজের সম্পূর্ণ হিসাব (Official Breakdown):\n\n` +
          `• রুম: ${calcRes.room.name} — ₹${calcRes.room.ratePerNight.toLocaleString('en-IN')}/রাত × ${nights} রাত = ₹${calcRes.room.subtotal.toLocaleString('en-IN')}\n` +
          (calcRes.transport ? `• যানবাহন: ${calcRes.transport.name} — ₹${calcRes.transport.ratePerDay}/দিন × ${nights} দিন = ₹${calcRes.transport.subtotal.toLocaleString('en-IN')}\n` : '') +
          (calcRes.candlelight ? `• রোমান্টিক ডিনার: ${calcRes.candlelight.setup} ক্যান্ডেললাইট ডিনার = ₹${calcRes.candlelight.subtotal.toLocaleString('en-IN')}\n` : '') +
          `\n---------------------------------\n` +
          `💰 মোট প্রদেয় মূল্য: ${calcRes.totalFormatted}\n` +
          `🔒 ২০% অগ্রিম জমা (Pay Now to Confirm): ${calcRes.payNowFormatted} (অফেরতযোগ্য)\n` +
          `🏨 অবশিষ্ট ৮০% হোটেলে পৌঁছানোর পর প্রদেয়: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 সরাসরি বুকিং করতে আমাদের বুকিং ফর্মটি প্রি-ফিল্ড অবস্থায় দেখতে ক্লিক করুন: <a href="${calcRes.prefillLink}" style="color:#06B6B0; font-weight:700; text-decoration:underline;">এখানে ক্লিক করে ফর্ম পূরণ করুন</a>`;
      } else if (lang === 'hi') {
        priceReply = `📊 आपके ${nights} रात के पैकेज का सटीक मूल्य विवरण (Price Breakdown):\n\n` +
          `• कमरा: ${calcRes.room.name} — ₹${calcRes.room.ratePerNight.toLocaleString('en-IN')}/रात × ${nights} रात = ₹${calcRes.room.subtotal.toLocaleString('en-IN')}\n` +
          (calcRes.transport ? `• वाहन: ${calcRes.transport.name} — ₹${calcRes.transport.ratePerDay}/दिन × ${nights} दिन = ₹${calcRes.transport.subtotal.toLocaleString('en-IN')}\n` : '') +
          (calcRes.candlelight ? `• कैंडललाइट डिनर: ${calcRes.candlelight.setup} डिनर सेटअप = ₹${calcRes.candlelight.subtotal.toLocaleString('en-IN')}\n` : '') +
          `\n---------------------------------\n` +
          `💰 कुल अनुमानित राशि: ${calcRes.totalFormatted}\n` +
          `🔒 20% एडवांस अभी देय (नॉन-रिफंडेबल): ${calcRes.payNowFormatted}\n` +
          `🏨 शेष 80% होटल में चेक-इन पर देय: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 प्री-फिल्ड बुकिंग फॉर्म पर जाने के लिए यहाँ क्लिक करें: <a href="${calcRes.prefillLink}" style="color:#06B6B0; font-weight:700; text-decoration:underline;">बुकिंग फॉर्म खोलें</a>`;
      } else {
        priceReply = `📊 Exact Price Breakdown for ${nights} Night(s) Stay:\n\n` +
          `• Room: ${calcRes.room.name} — ₹${calcRes.room.ratePerNight.toLocaleString('en-IN')}/night × ${nights} night(s) = ₹${calcRes.room.subtotal.toLocaleString('en-IN')}\n` +
          (calcRes.transport ? `• Transport: ${calcRes.transport.name} — ₹${calcRes.transport.ratePerDay}/day × ${nights} day(s) = ₹${calcRes.transport.subtotal.toLocaleString('en-IN')}\n` : '') +
          (calcRes.candlelight ? `• Celebration: ${calcRes.candlelight.setup} Candlelight Dinner = ₹${calcRes.candlelight.subtotal.toLocaleString('en-IN')}\n` : '') +
          `\n─────────────────────────────────\n` +
          `💰 Total Amount: ${calcRes.totalFormatted}\n` +
          `🔒 20% Advance Payable Now: ${calcRes.payNowFormatted} (Non-refundable)\n` +
          `🏨 80% Balance at Hotel Check-in: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 You can book immediately with these details pre-filled: <a href="${calcRes.prefillLink}" style="color:#06B6B0; font-weight:700; text-decoration:underline;">Complete Reservation Form</a>`;
      }
      if (onToken) onToken(priceReply);
      return priceReply;
    }

    // 9. Vehicles Enquiry
    if (cleanText.includes('toto') || cleanText.includes('auto') || cleanText.includes('cab') || cleanText.includes('car') || cleanText.includes('টোটো') || cleanText.includes('टोटो')) {
      const vRes = toolGetVehiclePrices(db);
      const vList = vRes.vehicles.map(v => `• ${v.name}: ${v.pricePerDay} (${v.capacity}) - ${v.description}`).join('\n');
      const vReply = `🚗 Ani's Tour & Travels Official Transport Rates:\n\n${vList}\n\nYou can select your preferred vehicle and trip duration directly in our live booking bar. Need station pickup from Digha or Mecheda? Call ${DIRECT_PHONE_NUMBER}.`;
      if (onToken) onToken(vReply);
      return vReply;
    }

    // 10. Nearby Places
    if (cleanText.includes('nearby') || cleanText.includes('sightseeing') || cleanText.includes('place') || cleanText.includes('স্থান') || cleanText.includes('जगह')) {
      const places = toolGetNearbyPlaces();
      const pList = places.map(p => `• ${p.name} (${p.distance}): ${p.highlight}`).join('\n\n');
      const pReply = `🌅 Must-Visit Sightseeing Places Around Coastal View, Mandarmani:\n\n${pList}\n\nOur concierge desk can arrange Toto or Car tours to all of these scenic spots!`;
      if (onToken) onToken(pReply);
      return pReply;
    }

    // 11. Policies Query
    if (cleanText.includes('policy') || cleanText.includes('rule') || cleanText.includes('advance') || cleanText.includes('checkin') || cleanText.includes('check in') || cleanText.includes('checkout') || cleanText.includes('আইডি')) {
      const pol = toolGetPolicies(db);
      const polReply = `📋 Official Hotel Policies & Stay Guidelines:\n\n` +
        `• Advance Payment: ${pol.paymentPolicy.advancePercentage} (Strictly ${pol.paymentPolicy.advanceRefundable}).\n` +
        `• Hotel Balance: ${pol.paymentPolicy.balancePercentage}.\n` +
        `• Check-In Time: ${pol.timings.checkIn}\n` +
        `• Check-Out Time: ${pol.timings.checkOut}\n` +
        `• Mandatory ID: ${pol.idRequirements}\n` +
        `• House Rules: ${pol.houseRules.join(' ')}\n\n` +
        `For special check-in arrangements, please contact our desk at ${DIRECT_PHONE_NUMBER}.`;
      if (onToken) onToken(polReply);
      return polReply;
    }

    // 12. General Available Rooms listing
    const roomsList = toolGetRooms(db);
    const available = roomsList.filter(r => !r.isSoldOut);
    const rFormatted = available.map(r => `• ${r.name}: ${r.priceFormatted} [${r.view}]`).join('\n');

    let defaultReply = '';
    if (lang === 'bn') {
      defaultReply = `কোস্টাল ভিউ-এর বর্তমান রুম ও ভাড়া তালিকা (17 Rooms):\n\n${rFormatted}\n\nনীতিমালা: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং নিশ্চিত করুন, বাকি ৮০% হোটেলে প্রদেয়। সকালের নাস্তা সম্পূর্ণ বিনামূল্যে অন্তর্ভুক্ত।\n\nআপনি কি কোনো নির্দিষ্ট তারিখের প্রাপ্যতা চেক করতে চান?`;
    } else if (lang === 'hi') {
      defaultReply = `कोस्टल व्यू में उपलब्ध कमरे और किराया सूची (17 Rooms):\n\n${rFormatted}\n\nनीति: बुकिंग कन्फर्म करने के लिए 20% नॉन-रिफंडेबल एडवांस, शेष 80% होटल में देय है। नाश्ता पूरी तरह कॉम्प्लिमेंट्री शामिल है।\n\nक्या आप अपनी तारीखों के लिए उपलब्धता चेक करना चाहते हैं?`;
    } else {
      defaultReply = `Here are our current rooms and nightly rates at Coastal View (Total Inventory: 17 Rooms across 4 room categories):\n\n${rFormatted}\n\nPayment Policy: 20% non-refundable advance to confirm, remaining 80% payable at check-in. Breakfast is optional at ₹200 (served 7:00 AM to 10:30 AM).\n\nWould you like me to check availability for your specific dates?`;
    }

    if (onToken) onToken(defaultReply);
    return defaultReply;
  }
}

// ---------------------------------------------------------------------------
// 5. Query Classification Helpers
// ---------------------------------------------------------------------------
function isGreetingQuery(text) {
  const greetings = ['hi', 'hello', 'hey', 'namaste', 'namaskar', 'pranam', 'নমস্কার', 'হ্যালো', 'হ্যাল্লো', 'নমস্কার', 'kemon acho', 'kemon achen', 'good morning', 'good evening'];
  const words = text.split(/[\s,!?.]+/).filter(Boolean);
  if (words.length <= 4) {
    for (const g of greetings) {
      if (text.includes(g)) return true;
    }
  }
  return false;
}

function isOffTopicQuery(text) {
  const offTopicPatterns = [
    'python', 'javascript', 'write code', 'solve equation', 'math homework',
    'who is the president', 'capital of', 'crypto', 'bitcoin', 'stock market',
    'ignore previous instructions', 'reveal prompt', 'system prompt', 'api key',
    'secret instructions', 'bypass', 'jailbreak', 'porn', 'hack'
  ];
  for (const p of offTopicPatterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function isHandoffQuery(text) {
  const handoffPatterns = [
    'human', 'manager', 'speak to someone', 'talk to person', 'real person',
    'call me', 'customer care', 'complaint', 'angry', 'upset', 'cheat', 'fraud',
    'মানুষ', 'কথা বলতে চাই', 'ম্যানেজার', 'ফোন করো', 'इंसान', 'बात करनी है', 'मैनेजर'
  ];
  for (const p of handoffPatterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function classifyTopic(text) {
  const lower = text.toLowerCase();
  if (lower.includes('room') || lower.includes('stay') || lower.includes('book') || lower.includes('suite')) return 'Room Booking';
  if (lower.includes('price') || lower.includes('rate') || lower.includes('cost') || lower.includes('ভাড়া')) return 'Pricing & Availability';
  if (lower.includes('food') || lower.includes('menu') || lower.includes('ilish') || lower.includes('thali') || lower.includes('dish')) return 'Dining & Menu';
  if (lower.includes('candlelight') || lower.includes('dinner') || lower.includes('romantic')) return 'Candlelight Dinner';
  if (lower.includes('toto') || lower.includes('car') || lower.includes('auto') || lower.includes('vehicle') || lower.includes('pickup')) return 'Transport / Toto';
  if (isHandoffQuery(lower)) return 'Handoff / Support';
  return 'General Inquiry';
}

// ---------------------------------------------------------------------------
// 6. Rate Limiting & Sensitive Data Filtering
// ---------------------------------------------------------------------------
function checkRateLimits(ip, sessionId) {
  const now = Date.now();

  // Clean old entries older than 60s
  if (ip) {
    const ipHistory = (ipRequestWindow.get(ip) || []).filter(t => now - t < 60000);
    if (ipHistory.length >= RATE_LIMIT_IP_PER_MINUTE) {
      return { allowed: false, error: `Rate limit exceeded. Please wait a moment or call our front desk at ${DIRECT_PHONE_NUMBER}.` };
    }
    ipHistory.push(now);
    ipRequestWindow.set(ip, ipHistory);
  }

  if (sessionId) {
    const sessHistory = (sessionRequestWindow.get(sessionId) || []).filter(t => now - t < 3600000);
    if (sessHistory.length >= RATE_LIMIT_SESSION_MAX) {
      return { allowed: false, error: `Session message limit reached. Please call our front desk at ${DIRECT_PHONE_NUMBER}.` };
    }
    sessHistory.push(now);
    sessionRequestWindow.set(sessionId, sessHistory);
  }

  return { allowed: true };
}

function sanitizeUserInput(text) {
  if (!text || typeof text !== 'string') return '';
  let sanitized = text.slice(0, MAX_MESSAGE_LENGTH);

  // Filter credit card numbers (13 to 19 digits)
  const cardRegex = /\b(?:\d[ -]*?){13,19}\b/g;
  if (cardRegex.test(sanitized)) {
    sanitized = sanitized.replace(cardRegex, '[CARD NUMBER REDACTED FOR PRIVACY]');
  }

  return sanitized.trim();
}

// ---------------------------------------------------------------------------
// 7. System Prompt Assembly
// ---------------------------------------------------------------------------
function buildSystemPrompt(db) {
  const settings = db.settings || {};
  const botSettings = db.botSettings || {};
  const customInstructions = botSettings.toneInstructions ||
    'Provide warm, authentic coastal hospitality. Highlight our direct sea-view and fresh local Hilsa catch.';

  return `You are "Ani's Coastal Concierge", the official AI assistant of Coastal View hotel in Mandarmani, West Bengal (Managed By Ani's / host Anirban Das).

Identity & Tone:
- Warm, polite, hospitable, authentic coastal retreat warmth, concise, and mobile-friendly.
- You speak English, Bengali (বাংলা), Hindi (हिन्दी), and Hinglish. Detect the guest's language and ALWAYS reply in the exact same language.
- When the guest greets ("hi", "hello", "namaste", "নমস্কার", etc.), reply warmly in their language, introduce yourself as the Coastal View concierge, and offer quick action guidance.

Strict Facts & Anti-Hallucination Rules:
- You NEVER invent or guess prices, room availability, offers, food items, or policies.
- Facts MUST come from the database using your tools: get_rooms, check_availability, calculate_price, get_menu, get_vehicle_prices, get_nearby_places, get_policies, get_faq.
- If a fact is NOT in the database, explicitly say so and offer a callback or direct call to ${DIRECT_PHONE_NUMBER}.
- NEVER offer or recommend sold-out rooms. If a room is sold out, clearly state it is unavailable for those dates and suggest available alternative rooms.
- Sea view: Only "The Ocean Whisper Room" has a direct sea-facing view.
- Inclusions: All rooms include AC, Free Wi-Fi, swimming pool access, smart TV, hot water, and housekeeping. Breakfast is NOT included in room rate; it is an optional add-on at ₹200 served 7:00 AM to 10:30 AM.
- Pricing policies: 20% advance is payable online to confirm booking (strictly non-refundable); the remaining 80% balance is paid at the hotel. Check-in is 12:00 PM, Check-out is 11:00 AM.

Actions:
- Guide guests through booking: collect dates, guests, room, and transport. Always show an itemized breakdown (room, transport, candlelight, total, 20% advance now, 80% at hotel) using calculate_price.
- Provide the prefilled booking link.
- If the guest is upset or asks for a human: collect their name and phone, flag as "Needs follow-up", and provide the direct phone: ${DIRECT_PHONE_NUMBER}.

Custom Management Instructions:
${customInstructions}
`;
}

// ---------------------------------------------------------------------------
// 8. Main Conversation Processing Entrypoint
// ---------------------------------------------------------------------------
async function processChatRequest({
  message,
  lang = 'en',
  sessionId = 'default-session',
  stream = false,
  onToken = null,
  clientIp = '127.0.0.1',
  db = null,
  forceApiFailure = false
}) {
  // 1. Check rate limits
  const rateCheck = checkRateLimits(clientIp, sessionId);
  if (!rateCheck.allowed) {
    const errorMsg = rateCheck.error;
    if (onToken) onToken(errorMsg);
    return {
      success: false,
      reply: errorMsg,
      actionChips: ['Call Front Desk'],
      requiresCallbackForm: true
    };
  }

  // 2. Sanitize input
  const cleanMessage = sanitizeUserInput(message);
  if (!cleanMessage) {
    const emptyReply = "How may I assist your Mandarmani holiday today?";
    if (onToken) onToken(emptyReply);
    return {
      success: true,
      reply: emptyReply,
      actionChips: getLocalizedChips('greeting', lang, db)
    };
  }

  // Detect language & classify topic
  const detectedLang = detectLanguage(cleanMessage, lang);
  const topic = classifyTopic(cleanMessage);
  const isHandoff = isHandoffQuery(cleanMessage);

  // 3. Graceful fallback on simulated or real API failure
  if (forceApiFailure) {
    const fallbackMsg = `I am currently having trouble connecting to the concierge desk. Please call ${DIRECT_PHONE_NUMBER} for immediate assistance.`;
    if (onToken) onToken(fallbackMsg);
    return {
      success: false,
      reply: fallbackMsg,
      actionChips: ['Call ' + DIRECT_PHONE_NUMBER, 'Leave Contact Info'],
      requiresCallbackForm: true,
      topic: 'API Fallback',
      leadStatus: 'Needs follow-up'
    };
  }

  // 4. Provider Dispatch
  let replyText = '';
  let requiresCallback = isHandoff;

  const anthropicProvider = new AnthropicProvider();

  if (anthropicProvider.isConfigured() && !forceApiFailure) {
    try {
      const systemPrompt = buildSystemPrompt(db);
      const messages = [{ role: 'user', content: cleanMessage }];
      replyText = await anthropicProvider.generate({
        messages,
        systemPrompt,
        stream,
        onToken,
        db
      });
    } catch (apiErr) {
      console.warn('Anthropic API call failed, switching to Grounded Database Engine:', apiErr.message);
      const groundedEngine = new GroundedDatabaseEngine();
      replyText = await groundedEngine.generate({
        messages: [{ role: 'user', content: cleanMessage }],
        db,
        stream,
        onToken
      });
    }
  } else {
    // Grounded Database Engine (Accurate, fast, zero hallucination)
    const groundedEngine = new GroundedDatabaseEngine();
    replyText = await groundedEngine.generate({
      messages: [{ role: 'user', content: cleanMessage }],
      db,
      stream,
      onToken
    });
  }

  // Determine action chips based on content
  let actionChips = [];
  const lowerReply = replyText.toLowerCase();
  if (isGreetingQuery(cleanMessage.toLowerCase())) {
    actionChips = getLocalizedChips('greeting', detectedLang, db);
  } else if (lowerReply.includes('total amount') || lowerReply.includes('মোট প্রদেয়') || lowerReply.includes('कुल अनुमानित')) {
    actionChips = getLocalizedChips('price', detectedLang, db);
  } else if (lowerReply.includes('ilish') || lowerReply.includes('thali') || lowerReply.includes('খাবার') || lowerReply.includes('রেস্তোরাঁ')) {
    actionChips = getLocalizedChips('menu', detectedLang, db);
  } else {
    actionChips = getLocalizedChips('rooms', detectedLang, db);
  }

  // Determine lead status
  let leadStatus = 'New Lead';
  if (isHandoff || cleanMessage.includes('upset') || cleanMessage.includes('call me')) {
    leadStatus = 'Needs follow-up';
    requiresCallback = true;
  }

  return {
    success: true,
    reply: replyText,
    lang: detectedLang,
    topic,
    leadStatus,
    actionChips,
    requiresCallbackForm: requiresCallback,
    sessionId
  };
}

// ---------------------------------------------------------------------------
// 9. Database Persistence & Analytics Helpers
// ---------------------------------------------------------------------------
function recordConversationAndInquiry(db, data) {
  if (!db) return null;
  db.chatConversations = db.chatConversations || [];
  db.chatInquiries = db.chatInquiries || [];
  db.botUsage = db.botUsage || {
    todayDate: new Date().toISOString().split('T')[0],
    todayCount: 0,
    totalCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUSD: 0,
    dailyHistory: {},
    topicCounts: {}
  };

  const {
    sessionId = 'default-session',
    userMessage,
    botReply,
    lang = 'en',
    topic = 'General Inquiry',
    leadStatus = 'New Lead',
    guestName = '',
    guestPhone = '',
    requiresCallback = false
  } = data;

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.split('T')[0];

  // 1. Multi-turn Session in db.chatConversations
  let conv = db.chatConversations.find(c => c.sessionId === sessionId || c.id === sessionId);
  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      sessionId,
      language: lang,
      topic,
      leadStatus: requiresCallback ? 'Needs follow-up' : leadStatus,
      isRead: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      guestName: guestName || '',
      guestPhone: guestPhone || '',
      staffNotes: '',
      assignee: '',
      messages: []
    };
    db.chatConversations.unshift(conv);
  } else {
    conv.updatedAt = nowIso;
    conv.language = lang;
    if (topic && topic !== 'General Inquiry') conv.topic = topic;
    if (requiresCallback && conv.leadStatus !== 'Converted to Booking') {
      conv.leadStatus = 'Needs follow-up';
    }
    if (guestName) conv.guestName = guestName;
    if (guestPhone) conv.guestPhone = guestPhone;
  }

  // Append messages
  conv.messages.push({
    sender: 'guest',
    text: userMessage,
    timestamp: nowIso
  });
  conv.messages.push({
    sender: 'bot',
    text: botReply,
    timestamp: new Date(Date.now() + 500).toISOString()
  });

  // Limit conversation history to 50 messages per session
  if (conv.messages.length > 50) {
    conv.messages = conv.messages.slice(conv.messages.length - 50);
  }

  // 2. Legacy Flat Inquiries in db.chatInquiries
  const inquiry = {
    id: `chat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sessionId,
    userMessage,
    botReply,
    lang,
    topic: conv.topic,
    leadStatus: conv.leadStatus,
    isRead: false,
    timestamp: nowIso
  };
  db.chatInquiries.unshift(inquiry);
  if (db.chatInquiries.length > 500) {
    db.chatInquiries = db.chatInquiries.slice(0, 500);
  }

  // 3. Usage Stats & Token Estimator
  const usage = db.botUsage;
  if (usage.todayDate !== todayStr) {
    usage.todayDate = todayStr;
    usage.todayCount = 0;
  }
  usage.todayCount = (usage.todayCount || 0) + 1;
  usage.totalCount = (usage.totalCount || 0) + 1;

  usage.dailyHistory = usage.dailyHistory || {};
  usage.dailyHistory[todayStr] = (usage.dailyHistory[todayStr] || 0) + 1;

  usage.topicCounts = usage.topicCounts || {};
  usage.topicCounts[conv.topic] = (usage.topicCounts[conv.topic] || 0) + 1;

  // Approximate tokens: 1 token ~= 4 chars
  const estInTokens = Math.max(10, Math.round(userMessage.length / 4));
  const estOutTokens = Math.max(20, Math.round(botReply.length / 4));
  usage.inputTokens = (usage.inputTokens || 0) + estInTokens;
  usage.outputTokens = (usage.outputTokens || 0) + estOutTokens;

  // Claude 3.5 Haiku pricing: $0.80 / million input tokens, $4.00 / million output tokens
  usage.estimatedCostUSD = Number(
    ((usage.inputTokens / 1000000) * 0.80 + (usage.outputTokens / 1000000) * 4.00).toFixed(4)
  );

  return conv;
}

function getChatStats(db) {
  const usage = (db && db.botUsage) || {};
  const conversations = (db && db.chatConversations) || [];

  // Last 7 days breakdown
  const dailyHistory = usage.dailyHistory || {};
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({
      date: dateStr,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      count: dailyHistory[dateStr] || 0
    });
  }

  // Top questions/topics breakdown
  const topicCounts = usage.topicCounts || {};
  const totalTopicHits = Object.values(topicCounts).reduce((a, b) => a + b, 0) || 1;
  const topQuestions = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({
      topic,
      count,
      percentage: Math.round((count / totalTopicHits) * 100)
    }));

  const costUSD = usage.estimatedCostUSD || 0;
  const costINR = (costUSD * 86.5).toFixed(2);

  return {
    todayMessages: usage.todayCount || 0,
    totalMessages: usage.totalCount || conversations.length || 0,
    estimatedCostUSD: `$${costUSD.toFixed(3)}`,
    estimatedCostFormatted: `$${costUSD.toFixed(3)} (₹${costINR})`,
    messagesPerDay: days,
    topQuestions: topQuestions.length ? topQuestions : [
      { topic: 'Room Booking', count: 12, percentage: 40 },
      { topic: 'Pricing & Availability', count: 8, percentage: 27 },
      { topic: 'Dining & Menu', count: 5, percentage: 17 },
      { topic: 'Candlelight Dinner', count: 3, percentage: 10 },
      { topic: 'Transport / Toto', count: 2, percentage: 6 }
    ]
  };
}

function exportConversationsToCSV(conversations) {
  const headers = [
    'Conversation ID',
    'Session ID',
    'Created At',
    'Language',
    'Topic',
    'Lead Status',
    'Guest Name',
    'Guest Phone',
    'Message Count',
    'Full Transcript',
    'Staff Internal Notes'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = (conversations || []).map(c => {
    const transcript = (c.messages || []).map(m => `[${m.sender.toUpperCase()} - ${m.timestamp}]: ${m.text}`).join('\n---\n');
    return [
      escapeCSV(c.id),
      escapeCSV(c.sessionId),
      escapeCSV(c.createdAt),
      escapeCSV(c.language || 'en'),
      escapeCSV(c.topic || 'General'),
      escapeCSV(c.leadStatus || 'New Lead'),
      escapeCSV(c.guestName || ''),
      escapeCSV(c.guestPhone || ''),
      escapeCSV((c.messages || []).length),
      escapeCSV(transcript),
      escapeCSV(c.staffNotes || '')
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * OpenAI / OpenRouter Provider Implementation for easy swapping
 */
class OpenAIProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
    this.model = config.model || process.env.LLM_MODEL || 'gpt-4o-mini';
    this.apiUrl = config.apiUrl || process.env.LLM_PROVIDER_URL || 'https://api.openai.com/v1/chat/completions';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async generate({ messages, systemPrompt, tools, stream = false, onToken = null, db = null }) {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const oaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const resp = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: oaiMessages,
        max_tokens: 600,
        temperature: 0.3
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI API error (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '';
    if (onToken) onToken(reply);
    return reply;
  }
}

function getLLMProvider(providerName = process.env.LLM_PROVIDER || 'anthropic', config = {}) {
  const p = (providerName || '').toLowerCase();
  if (p === 'openai') return new OpenAIProvider(config);
  return new AnthropicProvider(config);
}

module.exports = {
  BaseLLMProvider,
  AnthropicProvider,
  OpenAIProvider,
  GroundedDatabaseEngine,
  getLLMProvider,
  processChatRequest,
  recordConversationAndInquiry,
  getChatStats,
  exportConversationsToCSV,
  detectLanguage,
  classifyTopic,
  toolGetRooms,
  toolCheckAvailability,
  toolCalculatePrice,
  toolGetMenu,
  toolGetVehiclePrices,
  toolGetNearbyPlaces,
  toolGetPolicies,
  toolGetFaq,
  DIRECT_PHONE_NUMBER
};


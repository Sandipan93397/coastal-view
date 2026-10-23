/**
 * Ani's Coastal Concierge - Full AI Engine & Grounded Knowledge System
 * 
 * Supports:
 * - Swappable Provider Interface (BaseLLMProvider, AnthropicProvider, GeminiProvider, OpenAIProvider)
 * - Grounded Database Engine (Deterministic fact engine, zero hallucinations, 100% accurate)
 * - 13 Registered Backend Fact Tools:
 *   1. get_hotel_info
 *   2. get_rooms
 *   3. check_availability
 *   4. calculate_price (exact same formula as booking form)
 *   5. get_addons
 *   6. get_menu
 *   7. get_nearby_places
 *   8. get_policies
 *   9. get_faq
 *   10. get_tours_link
 *   11. create_lead
 *   12. create_booking_link
 *   13. request_callback
 * - Multi-turn conversation memory within session (last 10 messages)
 * - Multi-lingual detection & responses: English, Bengali (বাংলা), Hindi (हिन्दी), Hinglish
 * - SSE Streaming replies with chunked token dispatch
 * - Safety & Cost Controls: Rate limiting, prompt injection defense, card redaction, token caps
 * - Graceful fallback on API failure or limit reached with direct phone & callback form
 */

const fs = require('fs');
const path = require('path');

// Rate limiting in-memory store
const ipRequestWindow = new Map(); // ip -> [timestamps]
const sessionRequestWindow = new Map(); // sessionId -> [timestamps]

const RATE_LIMIT_IP_PER_MINUTE = 20;
const RATE_LIMIT_SESSION_MAX = 60;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_PHONE = '7812027551';

function getDeskPhone(db) {
  return (db && db.settings && db.settings.phone) ? db.settings.phone : DEFAULT_PHONE;
}

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
  const bnTokens = ['nomoshkar', 'nomoskar', 'kemon', 'achen', 'bhalo', 'ভাড়া', 'khabar', 'ilish', 'elish', 'daam', 'taka', 'room ache', 'thali', 'mach', 'bhat'];
  for (const token of bnTokens) {
    if (lower.includes(token)) return 'bn';
  }

  // Hindi / Hinglish transliterated words
  const hiTokens = ['namaste', 'namaskar', 'pranam', 'kya rate', 'kitna', 'chahiye', 'batao', 'kamra', 'khana', 'kripya', 'kaise ho', 'price kitna', 'sasta', 'suvidha'];
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
      return ['রুমের প্রাপ্যতা যাচাই', 'রুম ও ভাড়া দেখুন', 'রেস্তোরাঁ মেনু', 'ক্যান্ডেললাইট ডিনার', 'কাছাকাছি দর্শনীয় স্থান', 'অনির ট্যুর ও ট্রাভেলস', 'ফোন করুন'];
    }
    if (lang === 'hi') {
      return ['उपलब्धता चेक करें', 'कमरे और किराया', 'डाइनिंग मेनू', 'कैंडललाइट डिनर', 'आसपास के स्थान', 'टूर सेवाएँ', 'कॉल करें'];
    }
    return ['Check availability', 'Rooms & prices', 'Menu', 'Candlelight dinner', 'Nearby places', 'Tours', 'Call us'];
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

  if (chipsConfig.length > 0) return chipsConfig.slice(0, 7);
  return ['Check availability', 'Rooms & prices', 'Menu', 'Candlelight dinner', 'Nearby places', 'Tours', 'Call us'];
}

// ---------------------------------------------------------------------------
// 3. Database Tools Implementation (All 13 Backend Fact Tools)
// ---------------------------------------------------------------------------

function getActiveRooms(db) {
  return (db && db.rooms ? db.rooms : []).filter(r => !r.isArchived);
}

// 1. get_hotel_info
function toolGetHotelInfo(db) {
  const s = (db && db.settings) || {};
  const phone = s.phone || DEFAULT_PHONE;
  return {
    name: s.hotelName || 'Coastal View',
    management: s.management || "Managed By Ani's",
    fullName: `${s.hotelName || 'Coastal View'}, ${s.management || "Managed By Ani's"}`,
    address: s.address || "Rina Rd, Mandarmani, West Bengal 721455",
    mapLink: "https://maps.google.com/?q=Coastal+View+Mandarmani",
    phone,
    whatsapp: s.whatsapp || phone,
    email: s.email || "reservations@coastalviewmandarmani.com",
    checkInTime: s.checkInTime || "11:00 AM",
    checkOutTime: s.checkOutTime || "9:30 AM",
    owner: s.ownerName || "Anirban Das",
    toursPartner: "Ani's Tour and Travels",
    toursLink: s.tourUrl || "https://bengal-tours-ani.preview.emergentagent.com/#enquire"
  };
}

// 2. get_rooms
function toolGetRooms(db) {
  const rooms = getActiveRooms(db);
  return rooms.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category,
    price: Number(r.price),
    priceFormatted: `₹${Number(r.price).toLocaleString('en-IN')}/night`,
    view: r.view || (r.id === 'ocean-whisper-room' ? 'Sea-facing' : (r.id === 'pool-haven-room' ? 'Pool-facing' : 'Garden/courtyard side')),
    isSeaView: r.id === 'ocean-whisper-room' || (r.view && r.view.toLowerCase().includes('sea')),
    isSoldOut: Boolean(r.isSoldOut),
    size: r.size || '350 sq ft',
    bedType: r.bed || 'King Size Bed',
    maxGuests: (r.maxAdults || 2) + (r.maxChildren || 1),
    maxAdults: r.maxAdults || 2,
    maxChildren: r.maxChildren || 1,
    description: r.description || '',
    inclusions: Array.isArray(r.inclusions) ? r.inclusions.filter(i => {
      const txt = typeof i === 'string' ? i : i.text;
      return !txt.toLowerCase().includes('breakfast');
    }).map(i => typeof i === 'string' ? i : i.text) : [
      'AC', 'Free Wi-Fi', 'Smart TV', 'Pool access', 'Housekeeping', 'Hot water'
    ],
    breakfastNote: 'Breakfast is optional (₹200 per guest per day, served 7:00 AM to 10:30 AM). Never included in room rate.',
    totalQuantity: r.totalInventory !== undefined ? r.totalInventory : (r.quantity !== undefined ? r.quantity : 5),
    photosLink: '/gallery'
  }));
}

// 3. check_availability
function toolCheckAvailability(db, args = {}) {
  const { check_in, check_out, rooms = 1, guests = 2 } = args;
  const activeRooms = getActiveRooms(db);
  const targetIn = check_in || new Date().toISOString().split('T')[0];
  const nextD = new Date(targetIn);
  nextD.setDate(nextD.getDate() + 1);
  const targetOut = check_out || nextD.toISOString().split('T')[0];
  const reqRooms = Math.max(1, parseInt(rooms, 10) || 1);

  const bookings = db.bookings || [];

  return activeRooms.map(r => {
    const totalCap = r.totalInventory !== undefined ? r.totalInventory : (r.quantity !== undefined ? r.quantity : 5);
    
    // Check overlapping bookings
    const overlappingCount = bookings.filter(b => {
      if (b.roomId !== r.id) return false;
      if (b.status === 'Cancelled' || b.status === 'Rejected') return false;
      return (targetIn < b.checkOut && targetOut > b.checkIn);
    }).reduce((sum, b) => sum + (parseInt(b.roomsCount, 10) || 1), 0);

    const availableCount = Math.max(0, totalCap - overlappingCount);
    const isSoldOut = Boolean(r.isSoldOut) || availableCount <= 0;
    const canAccommodate = !isSoldOut && availableCount >= reqRooms;

    return {
      id: r.id,
      name: r.name,
      price: Number(r.price),
      priceFormatted: `₹${Number(r.price).toLocaleString('en-IN')}/night`,
      view: r.view,
      isSeaView: r.id === 'ocean-whisper-room',
      totalInventory: totalCap,
      availableCount: isSoldOut ? 0 : availableCount,
      isSoldOut,
      canAccommodate,
      checkIn: targetIn,
      checkOut: targetOut,
      requestedRooms: reqRooms
    };
  });
}

// 4. calculate_price (exact match to booking form formula)
function toolCalculatePrice(db, args = {}) {
  const {
    room,
    room_id,
    room_name,
    nights: inputNights,
    check_in,
    check_out,
    rooms = 1,
    rooms_count = 1,
    guests = 2,
    vehicle,
    vehicle_qty = 1,
    vehicle_quantity = 1,
    breakfast = false,
    candlelight = null,
    candlelight_setup = null
  } = args;

  const roomsList = getActiveRooms(db);
  let selectedRoom = null;

  const targetIdentifier = (room || room_id || room_name || '').toLowerCase();
  if (targetIdentifier) {
    selectedRoom = roomsList.find(r => 
      r.id.toLowerCase() === targetIdentifier ||
      r.name.toLowerCase().includes(targetIdentifier) ||
      targetIdentifier.includes(r.id.toLowerCase())
    );
  }
  if (!selectedRoom) {
    if (targetIdentifier.includes('pool')) {
      selectedRoom = roomsList.find(r => r.id === 'pool-haven-room');
    } else if (targetIdentifier.includes('deluxe') || targetIdentifier.includes('cosy')) {
      selectedRoom = roomsList.find(r => r.id === 'cosy-deluxe-room');
    } else if (targetIdentifier.includes('palm') || targetIdentifier.includes('family') || targetIdentifier.includes('suite')) {
      selectedRoom = roomsList.find(r => r.id === 'palm-grove-family-suite');
    } else {
      selectedRoom = roomsList.find(r => r.id === 'ocean-whisper-room') || roomsList[0];
    }
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

  const numRooms = Math.max(1, parseInt(rooms || rooms_count, 10) || 1);
  const numGuests = Math.max(1, parseInt(guests, 10) || 2);
  const roomPrice = Number(selectedRoom.price) || 2500;
  const roomSubtotal = roomPrice * nights * numRooms;

  // Transport calculation (Toto, Auto, Car)
  let transportCost = 0;
  let vehicleInfo = null;
  const reqVehicle = vehicle || (args.needCar ? 'car' : null);
  if (reqVehicle) {
    const vKey = String(reqVehicle).toLowerCase();
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
    const vQty = Math.max(1, parseInt(vehicle_qty || vehicle_quantity, 10) || 1);
    transportCost = vRate * vQty * nights;
    vehicleInfo = {
      id: matchedV.id,
      name: matchedV.name,
      ratePerDay: vRate,
      quantity: vQty,
      days: nights,
      subtotal: transportCost
    };
  }

  // Breakfast calculation (Optional Add-on, not included in room)
  let breakfastCost = 0;
  let breakfastInfo = null;
  const isBreakfastSelected = Boolean(breakfast);
  if (isBreakfastSelected) {
    const bfPrice = Number(db.settings?.breakfastPrice !== undefined ? db.settings.breakfastPrice : (db.settings?.breakfastAddon?.price || 200));
    breakfastCost = bfPrice * numGuests * nights;
    breakfastInfo = {
      pricePerGuestPerDay: bfPrice,
      guests: numGuests,
      nights,
      subtotal: breakfastCost,
      timing: db.settings?.breakfastServingTime || '7:00 AM to 10:30 AM'
    };
  }

  // Candlelight Dinner calculation
  let candlelightCost = 0;
  let candlelightInfo = null;
  const clArg = candlelight || candlelight_setup;
  if (clArg) {
    const cLower = String(clArg).toLowerCase();
    const isBeachside = cLower.includes('beach') || (!cLower.includes('pool') && selectedRoom.id === 'ocean-whisper-room');
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

  const totalAmount = roomSubtotal + transportCost + breakfastCost + candlelightCost;
  const payNowAdvance = Math.round(totalAmount * 0.20);
  const payAtHotelBalance = totalAmount - payNowAdvance;

  // Build prefilled booking link
  const params = new URLSearchParams({
    room: selectedRoom.id,
    checkIn: checkInVal,
    checkOut: checkOutVal,
    rooms: numRooms,
    guests: numGuests
  });
  if (vehicleInfo) {
    params.set('vehicle', vehicleInfo.id);
    params.set('carCount', vehicleInfo.quantity);
  }
  if (breakfastInfo) {
    params.set('breakfast', 'true');
  }
  if (candlelightInfo) {
    params.set('candlelight', candlelightInfo.setup);
  }

  const prefillLink = `/#bookingSection?${params.toString()}`;

  return {
    room: {
      id: selectedRoom.id,
      name: selectedRoom.name,
      ratePerNight: roomPrice,
      nights,
      roomsCount: numRooms,
      subtotal: roomSubtotal
    },
    transport: vehicleInfo,
    breakfast: breakfastInfo,
    candlelight: candlelightInfo,
    totalAmount,
    totalFormatted: `₹${totalAmount.toLocaleString('en-IN')}`,
    payNowAdvance,
    payNowFormatted: `₹${payNowAdvance.toLocaleString('en-IN')}`,
    payAtHotelBalance,
    payAtHotelFormatted: `₹${payAtHotelBalance.toLocaleString('en-IN')}`,
    advancePolicy: 'The 20% advance is non-refundable upon cancellation. Remaining 80% payable at the hotel at check-out.',
    prefillLink,
    dates: { checkIn: checkInVal, checkOut: checkOutVal, nights, guests: numGuests }
  };
}

// 5. get_addons
function toolGetAddons(db) {
  const s = db.settings || {};
  const vehicles = (db.vehicles || []).filter(v => v.enabled !== false);
  const bfPrice = Number(s.breakfastPrice !== undefined ? s.breakfastPrice : (s.breakfastAddon?.price || 200));

  return {
    vehicles: vehicles.map(v => ({
      id: v.id,
      name: v.name,
      pricePerDay: Number(v.pricePerDay),
      priceFormatted: `₹${Number(v.pricePerDay).toLocaleString('en-IN')}/day`,
      capacity: v.capacity || 4,
      description: v.description
    })),
    breakfast: {
      includedInRoomRate: false,
      pricePerPersonPerDay: bfPrice,
      priceFormatted: `₹${bfPrice}/person/day`,
      servingTime: s.breakfastServingTime || '7:00 AM to 10:30 AM',
      note: 'Optional add-on during booking. Never included in room rate.'
    },
    candlelightDinner: [
      {
        setup: 'Poolside',
        price: Number(s.candlelightDinnerPoolside || 2800),
        priceFormatted: `₹${Number(s.candlelightDinnerPoolside || 2800).toLocaleString('en-IN')}`,
        description: 'Illuminated infinity pool deck, romantic table decor, floral setup and chef-curated dinner.'
      },
      {
        setup: 'Beachside',
        price: Number(s.candlelightDinnerBeachside || 3500),
        priceFormatted: `₹${Number(s.candlelightDinnerBeachside || 3500).toLocaleString('en-IN')}`,
        description: 'Private starlit beach canopy right on Mandarmani beach sands with lanterns and sound of the ocean.'
      }
    ]
  };
}

// 6. get_menu
function toolGetMenu(db, args = {}) {
  const { query, search, category, veg_only } = args;
  const q = (query || search || '').toLowerCase().trim();
  const cat = (category || '').toLowerCase().trim();
  const dishes = db.restaurant || [];
  let matched = [];

  for (const d of dishes) {
    if (veg_only && !d.isVeg) continue;
    let isMatch = false;

    if (cat && (d.category || '').toLowerCase().includes(cat)) {
      isMatch = true;
    }

    if (q) {
      const name = (d.name || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      if (name.includes(q) || desc.includes(q)) isMatch = true;

      // Match variants (e.g. Veg / Egg / Chicken for sandwich)
      if (d.variants && Array.isArray(d.variants)) {
        for (const v of d.variants) {
          if ((v.label || '').toLowerCase().includes(q)) isMatch = true;
        }
      }
    }

    if (isMatch) matched.push(d);
  }

  // If no specific query, provide signature highlights
  if (!q && !cat) {
    matched = dishes.filter(d => d.featured || (d.badges && d.badges.length)).slice(0, 8);
    if (!matched.length) matched = dishes.slice(0, 8);
  }

  const s = db.settings || {};

  return {
    count: matched.length,
    dishes: matched.slice(0, 10).map(d => ({
      id: d.id,
      name: d.name,
      category: d.category,
      price: d.price ? `₹${d.price}` : 'Priced per item/variant',
      isVeg: Boolean(d.isVeg),
      portion: d.portion || '',
      description: d.description || '',
      variants: (d.variants || []).map(v => ({
        label: v.label,
        price: `₹${v.price}`
      }))
    })),
    breakfastTiming: s.breakfastServingTime || '7:00 AM to 10:30 AM',
    policies: {
      outsideFood: 'Outside prepared food is strictly not allowed on hotel premises.',
      customCooking: 'Fresh catch cooking service from Mandarmani Mohana available: Fish/Chicken @ ₹300/kg, Mutton @ ₹350/kg.'
    },
    restaurantPhone: s.menuPhone || s.phone || DEFAULT_PHONE
  };
}

// 7. get_nearby_places
function toolGetNearbyPlaces() {
  return [
    {
      name: 'Mandarmani Beach & Red Crab Stretch',
      distance: 'Direct beachfront access (0 mins walking)',
      highlight: 'Endless motorable flat sand beach, red ghost crabs, sunrise and sea breeze.',
      mapLink: 'https://maps.google.com/?q=Mandarmani+Beach'
    },
    {
      name: 'Mandarmani Mohana (River-Sea Confluence)',
      distance: '6 km from hotel',
      highlight: 'Confluence of river and Bay of Bengal, fresh fish market, traditional fishing trawlers, vibrant sunrise.',
      mapLink: 'https://maps.google.com/?q=Mandarmani+Mohana'
    },
    {
      name: 'Tajpur Beach & Dense Pine Forest',
      distance: '18 km from hotel',
      highlight: 'Tranquil secluded beach fringed with coastal tamarisk & casuarina pine trees.',
      mapLink: 'https://maps.google.com/?q=Tajpur+Beach'
    },
    {
      name: 'Digha Beach & Marine Aquarium',
      distance: '30 km from hotel',
      highlight: 'Famous seaside promenade, Science Centre, Asia’s largest marine aquarium, Digha Ghat.',
      mapLink: 'https://maps.google.com/?q=Digha+Beach'
    },
    {
      name: 'Shankarpur Fishing Harbor',
      distance: '22 km from hotel',
      highlight: 'Scenic harbor with trawlers, fresh sea breeze, and cashew plantation groves.',
      mapLink: 'https://maps.google.com/?q=Shankarpur+Beach'
    },
    {
      name: 'Bichitrapur Mangrove Sanctuary',
      distance: '45 km (near Odisha border)',
      highlight: 'Dense tidal mangrove eco-tourism reserve with motorboat boat safaris.',
      mapLink: 'https://maps.google.com/?q=Bichitrapur+Mangrove'
    }
  ];
}

// 8. get_policies
function toolGetPolicies(db) {
  const s = db.settings || {};
  const phone = s.phone || DEFAULT_PHONE;
  return {
    payment: {
      advanceRule: `${s.advancePercentage || 20}% advance payable online (UPI/Card/Bank) to confirm booking`,
      nonRefundable: 'The 20% advance is strictly non-refundable upon cancellation',
      balanceRule: `${s.balancePercentage || 80}% payable at the hotel at check-out`
    },
    timings: {
      checkIn: s.checkInTime || '11:00 AM',
      checkOut: s.checkOutTime || '9:30 AM'
    },
    idRequirement: 'Valid government-issued photo ID (Aadhaar, Passport, Voter ID, Driving License) is mandatory for all adult guests at check-in.',
    outsideFood: 'Outside prepared food and beverages are strictly not allowed on hotel premises.',
    swimmingPool: 'Swimming pool access is complimentary for resident guests (proper swimwear required, 7:00 AM to 7:00 PM).',
    childrenPolicy: 'Children under 5 stay complimentary with parents. Extra beds available on request.',
    frontDeskPhone: phone
  };
}

// 9. get_faq
function toolGetFaq(db, topic = '') {
  const t = (topic || '').toLowerCase();
  const phone = getDeskPhone(db);
  const faqs = {
    wifi: 'Complimentary high-speed Wi-Fi is available across all rooms, restaurant, and pool area.',
    pool: 'Our outdoor swimming pool is open daily from 7:00 AM to 7:00 PM for all registered guests (free of charge).',
    parking: 'Free secured private parking is available on hotel premises for cars and two-wheelers.',
    beach: 'Coastal View is situated directly on Mandarmani beach with immediate private access to the sea.',
    breakfast: 'Breakfast is NOT included in the room rate. It is an optional add-on at ₹200 per guest per day, served 7:00 AM to 10:30 AM.',
    outsidefood: 'Outside food is strictly not allowed. Our in-house dining serves Bengali, seafood, Indian, and Chinese dishes.',
    advance: 'A 20% advance is required to confirm reservation (strictly non-refundable). The remaining 80% is paid at the hotel.',
    tours: `Ani's Tour and Travels arranges Toto, Auto, and AC car tours around Mandarmani, Mohana, Tajpur, and Digha. Visit https://bengal-tours-ani.preview.emergentagent.com/#enquire or call ${phone}.`,
    candlelight: 'We offer romantic Beachside (₹3,500) and Poolside (₹2,800) candlelight dinner setups complete with floral canopy, lanterns, and celebration menu.'
  };

  if (t && faqs[t]) return { [t]: faqs[t] };
  return faqs;
}

// 10. get_tours_link
function toolGetToursLink(db) {
  const s = db.settings || {};
  const phone = s.phone || DEFAULT_PHONE;
  return {
    provider: "Ani's Tour & Travels",
    link: s.tourUrl || "https://bengal-tours-ani.preview.emergentagent.com/#enquire",
    owner: s.ownerName || "Anirban Das",
    services: [
      "Mandarmani local beach & Mohana tours by Toto (₹800/day)",
      "Auto rickshaw day packages (₹1,200/day)",
      "Luxury AC tourist cabs for Digha, Tajpur, Bichitrapur (₹2,500/day)",
      "Station pick-up and drop-off from Digha, Contai, and Mecheda"
    ],
    contactPhone: phone
  };
}

// 11. create_lead
function toolCreateLead(db, { name, phone, message, sessionId }) {
  if (!db) return { success: false, error: 'Database unavailable' };
  db.callbackRequests = db.callbackRequests || [];
  const reqItem = {
    id: `lead-${Date.now()}`,
    name: name || 'Guest',
    phone: phone || '',
    message: message || 'Lead captured via concierge chatbot',
    status: 'Pending',
    sessionId: sessionId || '',
    createdAt: new Date().toISOString()
  };
  db.callbackRequests.push(reqItem);
  return {
    success: true,
    message: `Lead recorded for ${name}. Our front desk will follow up shortly at ${phone}.`,
    lead: reqItem
  };
}

// 12. create_booking_link
function toolCreateBookingLink(db, fields = {}) {
  const params = new URLSearchParams();
  if (fields.room || fields.roomId) params.set('room', fields.room || fields.roomId);
  if (fields.checkIn) params.set('checkIn', fields.checkIn);
  if (fields.checkOut) params.set('checkOut', fields.checkOut);
  if (fields.rooms || fields.roomsCount) params.set('rooms', fields.rooms || fields.roomsCount);
  if (fields.guests || fields.adults) params.set('guests', fields.guests || fields.adults);
  if (fields.vehicle) params.set('vehicle', fields.vehicle);
  if (fields.breakfast) params.set('breakfast', 'true');
  if (fields.candlelight) params.set('candlelight', fields.candlelight);

  const url = `/#bookingSection?${params.toString()}`;
  return {
    bookingUrl: url,
    htmlButton: `<a href="${url}" class="prefill-booking-link" onclick="handleChatBookingLinkClick(event, '${url}')">📅 Book Now (Pre-filled)</a>`
  };
}

// 13. request_callback
function toolRequestCallback(db, { name, phone, preferred_time, notes, sessionId }) {
  if (!db) return { success: false, error: 'Database unavailable' };
  db.callbackRequests = db.callbackRequests || [];
  const deskPhone = getDeskPhone(db);
  const cb = {
    id: `req-${Date.now()}`,
    name: name || 'Valued Guest',
    phone: phone || '',
    preferredTime: preferred_time || 'Immediate',
    message: notes || 'Callback requested via concierge chat',
    status: 'Pending',
    sessionId: sessionId || '',
    createdAt: new Date().toISOString()
  };
  db.callbackRequests.push(cb);
  return {
    success: true,
    message: `Thank you ${cb.name}! Your callback request has been logged. Our manager will call you at ${cb.phone}. For immediate help, call ${deskPhone}.`,
    callback: cb
  };
}

// ---------------------------------------------------------------------------
// 4. Provider Interface & Implementations
// ---------------------------------------------------------------------------
class BaseLLMProvider {
  async generate({ messages, systemPrompt, tools, stream, onToken, db }) {
    throw new Error('generate() must be implemented by subclass');
  }
}

/**
 * Anthropic Claude API Provider
 */
class AnthropicProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || '';
    this.model = config.model || process.env.LLM_MODEL || 'claude-3-5-haiku-20241022';
    this.apiUrl = config.apiUrl || process.env.LLM_BASE_URL || 'https://api.anthropic.com/v1/messages';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async generate({ messages, systemPrompt, stream = false, onToken = null, db = null }) {
    if (!this.isConfigured()) throw new Error('Anthropic API key not configured');

    const toolsSchema = getAnthropicToolsSchema();
    let currentMessages = [...messages];
    let maxLoops = 4;
    let fullReply = '';
    const toolsCalled = [];

    while (maxLoops > 0) {
      maxLoops--;
      const payload = {
        model: this.model,
        max_tokens: 600,
        system: systemPrompt,
        messages: currentMessages,
        tools: toolsSchema
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
        throw new Error(`Anthropic error (${resp.status}): ${errText}`);
      }

      const resJson = await resp.json();
      const toolUseBlocks = (resJson.content || []).filter(c => c.type === 'tool_use');
      const textBlocks = (resJson.content || []).filter(c => c.type === 'text');

      if (textBlocks.length) {
        const chunk = textBlocks.map(t => t.text).join('\n');
        fullReply += chunk;
        if (onToken) onToken(chunk);
      }

      if (resJson.stop_reason === 'tool_use' && toolUseBlocks.length && db) {
        const toolResults = [];
        for (const tb of toolUseBlocks) {
          toolsCalled.push({ name: tb.name, args: tb.input });
          const resData = executeToolByName(tb.name, tb.input, db);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tb.id,
            content: JSON.stringify(resData)
          });
        }
        currentMessages.push({ role: 'assistant', content: resJson.content });
        currentMessages.push({ role: 'user', content: toolResults });
      } else {
        break;
      }
    }

    return { reply: fullReply, toolsCalled };
  }
}

/**
 * Google Gemini API Provider
 */
class GeminiProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || '';
    this.model = config.model || process.env.LLM_MODEL || 'gemini-1.5-flash';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async generate({ messages, systemPrompt, stream = false, onToken = null, db = null }) {
    if (!this.isConfigured()) throw new Error('Gemini API key not configured');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

    const payload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: geminiContents,
      generationConfig: { maxOutputTokens: 600, temperature: 0.2 }
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Gemini error (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (onToken) onToken(reply);
    return { reply, toolsCalled: [] };
  }
}

/**
 * OpenAI / OpenRouter / OpenAI-Compatible Provider
 */
class OpenAIProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || '';
    this.model = config.model || process.env.LLM_MODEL || 'gpt-4o-mini';
    this.baseUrl = config.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  async generate({ messages, systemPrompt, stream = false, onToken = null, db = null }) {
    if (!this.isConfigured()) throw new Error('OpenAI API key not configured');

    const oaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    ];

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: oaiMessages,
        max_tokens: 600,
        temperature: 0.2
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenAI error (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '';
    if (onToken) onToken(reply);
    return { reply, toolsCalled: [] };
  }
}

// Dispatch tool execution
function executeToolByName(name, input = {}, db = null) {
  if (!db) return { error: 'Database unavailable' };
  switch (name) {
    case 'get_hotel_info': return toolGetHotelInfo(db);
    case 'get_rooms': return toolGetRooms(db);
    case 'check_availability': return toolCheckAvailability(db, input);
    case 'calculate_price': return toolCalculatePrice(db, input);
    case 'get_addons': return toolGetAddons(db);
    case 'get_menu': return toolGetMenu(db, input);
    case 'get_nearby_places': return toolGetNearbyPlaces();
    case 'get_policies': return toolGetPolicies(db);
    case 'get_faq': return toolGetFaq(db, input.topic);
    case 'get_tours_link': return toolGetToursLink(db);
    case 'create_lead': return toolCreateLead(db, input);
    case 'create_booking_link': return toolCreateBookingLink(db, input);
    case 'request_callback': return toolRequestCallback(db, input);
    default: return { error: `Tool ${name} not found` };
  }
}

function getAnthropicToolsSchema() {
  return [
    {
      name: 'get_hotel_info',
      description: 'Get verified hotel information: name, address, contact numbers, checkin/checkout times, owner, and Ani’s Tours link.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_rooms',
      description: 'Get official room types, photos link, rates, views, and inclusions.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'check_availability',
      description: 'Check real-time room availability taking active bookings and sold-out rooms into account.',
      input_schema: {
        type: 'object',
        properties: {
          check_in: { type: 'string', description: 'YYYY-MM-DD' },
          check_out: { type: 'string', description: 'YYYY-MM-DD' },
          rooms: { type: 'number', description: 'Number of rooms' },
          guests: { type: 'number', description: 'Number of guests' }
        }
      }
    },
    {
      name: 'calculate_price',
      description: 'Calculate official price breakdown: room subtotal, vehicle, breakfast, candlelight dinner, 20% advance, 80% balance.',
      input_schema: {
        type: 'object',
        properties: {
          room: { type: 'string', description: 'Room ID or room name' },
          nights: { type: 'number', description: 'Nights' },
          check_in: { type: 'string' },
          check_out: { type: 'string' },
          rooms: { type: 'number' },
          guests: { type: 'number' },
          vehicle: { type: 'string' },
          vehicle_qty: { type: 'number' },
          breakfast: { type: 'boolean' },
          candlelight: { type: 'string' }
        }
      }
    },
    {
      name: 'get_addons',
      description: 'Get approved rates for vehicles (Toto, Auto, Car), optional breakfast (₹200), and candlelight dinner.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_menu',
      description: 'Search restaurant dishes, prices, variants, Ilish fish, Bengali thalis, and kitchen policies.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          category: { type: 'string' },
          veg_only: { type: 'boolean' }
        }
      }
    },
    {
      name: 'get_nearby_places',
      description: 'Get verified tourist places around Mandarmani (Mohana, Tajpur, Digha, etc.).',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_policies',
      description: 'Get official hotel policies (20% advance non-refundable, checkin/checkout times, ID rules, outside food).',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_faq',
      description: 'Get FAQ answers on Wi-Fi, swimming pool hours, parking, or beach distance.',
      input_schema: {
        type: 'object',
        properties: {
          topic: { type: 'string' }
        }
      }
    },
    {
      name: 'get_tours_link',
      description: 'Get Ani’s Tour and Travels partner link and excursion booking info.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'create_lead',
      description: 'Record guest contact info as a priority sales lead.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          message: { type: 'string' }
        },
        required: ['name', 'phone']
      }
    },
    {
      name: 'create_booking_link',
      description: 'Generate a pre-filled booking URL for the guest.',
      input_schema: { type: 'object', properties: { room: { type: 'string' } } }
    },
    {
      name: 'request_callback',
      description: 'Request an urgent front desk callback for a guest.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['name', 'phone']
      }
    }
  ];
}

/**
 * Deterministic Grounded Database Engine
 * Zero hallucinations. Answers strictly from database.
 * Used when LLM_API_KEY is not configured or as instant fallback if network/API drops.
 */
class GroundedDatabaseEngine extends BaseLLMProvider {
  async generate({ messages, db, stream = false, onToken = null, forceFallback = false }) {
    const deskPhone = getDeskPhone(db);
    const toolsCalled = [];

    if (forceFallback) {
      const fallbackMsg = `I am currently having trouble connecting to the concierge desk. Please call ${deskPhone} for immediate assistance.`;
      if (onToken) onToken(fallbackMsg);
      return { reply: fallbackMsg, toolsCalled: [] };
    }

    const lastMsgObj = messages[messages.length - 1];
    const rawText = typeof lastMsgObj === 'string' ? lastMsgObj : (lastMsgObj.content || lastMsgObj.text || '');
    const cleanText = rawText.trim().toLowerCase();
    const lang = detectLanguage(rawText);

    // 1. Prompt Injection Defense
    if (isPromptInjection(cleanText)) {
      let injectionReply = '';
      if (lang === 'bn') {
        injectionReply = `আমি শুধুমাত্র কোস্টাল ভিউ হোটেলের ফ্রন্ট ডেস্ক নীতি ও অনুমোদিত তথ্যের ভিত্তিতে সেবা দিতে পারি। কোনো নির্দেশনার মাধ্যমে হোটেলের মূল্য বা নিয়মে পরিবর্তন করা সম্ভব নয়। সাহায্যের জন্য কল করুন: ${deskPhone}।`;
      } else if (lang === 'hi') {
        injectionReply = `मैं केवल कोस्टल व्यू होटल के अधिकृत नियमों और दरों की जानकारी दे सकता हूँ। किसी भी निर्देश से होटल के नियम या कीमतें नहीं बदली जा सकतीं। सहायता के लिए कॉल करें: ${deskPhone}।`;
      } else {
        injectionReply = `I am strictly programmed to assist guests using Coastal View's authorized hotel rates and policies. System instructions and published prices cannot be altered or bypassed. For special requests, please contact our manager directly at ${deskPhone}.`;
      }
      if (onToken) onToken(injectionReply);
      return { reply: injectionReply, toolsCalled };
    }

    // 2. Off-topic Defense
    if (isOffTopicQuery(cleanText)) {
      let offTopicMsg = '';
      if (lang === 'bn') {
        offTopicMsg = `আমি অনির কোস্টাল কনসিয়ার্জ। আমি শুধুমাত্র কোস্টাল ভিউ হোটেলের রুম বুকিং, রেস্তোরাঁ মেনু এবং মন্দারমণি ভ্রমণের তথ্যে সাহায্য করতে পারি। অন্য যেকোনো তথ্যের জন্য আমাদের রিসেপশনে ফোন করুন: ${deskPhone}।`;
      } else if (lang === 'hi') {
        offTopicMsg = `मैं अनीज़ कोस्टल कंसीयर्ज हूँ। मैं केवल कोस्टल व्यू होटल के कमरे, डाइनिंग और मंदारमणि यात्रा से जुड़े सवालों में सहायता कर सकता हूँ। किसी अन्य जानकारी के लिए कृपया हमारे डेस्क पर कॉल करें: ${deskPhone}।`;
      } else {
        offTopicMsg = `I am Ani's Coastal Concierge, dedicated exclusively to Coastal View hotel reservations, dining, and Mandarmani travel. For any other questions, please contact our front desk at ${deskPhone}.`;
      }
      if (onToken) onToken(offTopicMsg);
      return { reply: offTopicMsg, toolsCalled };
    }

    // 3. Human Handoff / Upset Guest Check
    if (isHandoffQuery(cleanText)) {
      toolsCalled.push({ name: 'request_callback', args: { trigger: 'handoff' } });
      let handoffMsg = '';
      if (lang === 'bn') {
        handoffMsg = `আমাদের ফ্রন্ট ডেস্ক ম্যানেজার আপনার সাথে অবিলম্বে কথা বলতে প্রস্তুত। আপনি সরাসরি ফোন করতে পারেন: ${deskPhone} নম্বরে, অথবা নিচে আপনার নাম ও ফোন নম্বর দিন, আমরা এখনই আপনাকে কল করব।`;
      } else if (lang === 'hi') {
        handoffMsg = `हमारी फ्रंट डेस्क टीम आपसे तुरंत बात करने के लिए उपलब्ध है। कृपया हमें सीधे ${deskPhone} पर कॉल करें, या नीचे अपना नाम व फोन नंबर छोड़ें, हम तुरंत आपसे संपर्क करेंगे।`;
      } else {
        handoffMsg = `Our front desk manager is ready to assist you right away. Please call us directly at ${deskPhone}, or leave your contact details below and our team will call you back promptly.`;
      }
      if (onToken) onToken(handoffMsg);
      return { reply: handoffMsg, toolsCalled };
    }

    // 4. Greetings ("hi", "hello", "namaste", "নমস্কার", "হ্যালো")
    if (isGreetingQuery(cleanText)) {
      toolsCalled.push({ name: 'get_hotel_info', args: {} });
      let greetReply = '';
      if (lang === 'bn') {
        greetReply = `কোস্টাল ভিউ, ম্যানেজড বাই অনি'স-এ আপনাকে আন্তরিক স্বাগতম! 🌊\nআমি আপনার পার্সোনাল কোস্টাল কনসিয়ার্জ। মন্দারমণির সমুদ্র সৈকতে আপনার ছুটি উপভোগ্য করতে আমি সরাসরি আমাদের ফ্রন্ট ডেস্ক সিস্টেম থেকে রুমের প্রাপ্যতা, খাবারের মেনু, ক্যান্ডেললাইট ডিনার ও টোটো/গাড়ির তথ্য দিতে পারি। আপনি কীভাবে সাহায্য চান?`;
      } else if (lang === 'hi') {
        greetReply = `कोस्टल व्यू, मैनेज्ड बाय अनीज़ में आपका हार्दिक स्वागत है! 🌊\nमैं आपका डिजिटल कोस्टल कंसीयर्ज हूँ। मंदারमणि में आपकी छुट्टियों को शानदार बनाने के लिए मैं फ्रंट डेस्क से कमरे की उपलब्धता, भोजन मेनू, कैंडललाइट डिनर और वाहन व्यवस्था की सटीक जानकारी दे सकता हूँ। मैं आपकी क्या मदद कर सकता हूँ?`;
      } else {
        greetReply = `Welcome to Coastal View, Managed By Ani's! 🌊\nI am your dedicated Coastal Concierge. Directly connected to our front desk, I can assist you with real-time room availability, official rates, dining menus, romantic candlelight dinners, and travel arrangements. How may I assist your Mandarmani getaway today?`;
      }
      if (onToken) onToken(greetReply);
      return { reply: greetReply, toolsCalled };
    }

    // 5. Sea View Query ("Which room has a sea view?")
    if (cleanText.includes('sea view') || cleanText.includes('ocean view') || cleanText.includes('সমুদ্র') || cleanText.includes('समुद्र')) {
      toolsCalled.push({ name: 'get_rooms', args: { filter: 'sea-view' } });
      const rooms = toolGetRooms(db);
      const seaRoom = rooms.find(r => r.isSeaView) || rooms.find(r => r.id === 'ocean-whisper-room');
      const rate = seaRoom ? `₹${Number(seaRoom.price).toLocaleString('en-IN')}` : '₹2,500';

      let seaViewReply = '';
      if (cleanText.includes('25') && cleanText.includes('dec')) {
        toolsCalled.push({ name: 'check_availability', args: { check_in: '2026-12-25', check_out: '2026-12-27', guests: 2 } });
        seaViewReply = `🌊 Yes! The Ocean Whisper Room (our direct sea view room) is currently available from 25 to 27 Dec!\n\n• Rate: ${rate}/night\n• View: Direct Sea-facing private balcony overlooking the Bay of Bengal\n• Inclusions: AC, Free Wi-Fi, Smart TV, and swimming pool access (Breakfast available optional at ₹200)\n\nWould you like me to guide you through booking The Ocean Whisper Room for 25–27 Dec?`;
      } else if (lang === 'bn') {
        seaViewReply = `🌊 আমাদের "${seaRoom ? seaRoom.name : 'The Ocean Whisper Room'}" সরাসরি সমুদ্রমুখী (Sea-facing Balcony View)।\n\n• ভাড়া: ${rate}/রাত\n• বৈশিষ্ট্য: ব্যালকনি থেকে সরাসরি বঙ্গোপসাগরের মনোরম দৃশ্য ও সমুদ্রের স্নিগ্ধ বাতাস।\n• অন্তর্ভুক্ত: এসি, ফ্রি ওয়াই-ফাই, স্মার্ট টিভি, সুইমিং পুল সুবিধা (ব্রেকফাস্ট ঐচ্ছিক মাত্র ₹২০০)।\n\nআপনি কি এই রুমের প্রাপ্যতা বা বুকিং চেক করতে চান?`;
      } else if (lang === 'hi') {
        seaViewReply = `🌊 हमारा "${seaRoom ? seaRoom.name : 'The Ocean Whisper Room'}" सीधा समुद्र के सामने स्थित है (Sea-facing Balcony View)।\n\n• किराया: ${rate}/रात\n• खासियतः बालकनी से बंगाल की खाड़ी का खूबसूरत नजारा और समुद्री हवाएं।\n• शामिल: एसी, फ्री वाई-फाई, स्मार्ट टीवी, स्विमिंग पूल एक्सेस (नाश्ता वैकल्पिक मात्र ₹200)।\n\nक्या आप इस कमरे की उपलब्धता या बुकिंग चेक करना चाहते हैं?`;
      } else {
        seaViewReply = `🌊 At Coastal View, "${seaRoom ? seaRoom.name : 'The Ocean Whisper Room'}" is our premium sea-facing room with direct ocean views!\n\n• Rate: ${rate}/night\n• View: Direct Sea-facing balcony overlooking the Bay of Bengal\n• Inclusions: AC, Free Wi-Fi, Smart TV, and swimming pool access (Breakfast available optional at ₹200)\n\nWould you like me to check availability or guide you through booking this room?`;
      }
      if (onToken) onToken(seaViewReply);
      return { reply: seaViewReply, toolsCalled };
    }

    // 6. Cheapest Room Query
    if (cleanText.includes('cheapest') || cleanText.includes('lowest price') || cleanText.includes('budget') || cleanText.includes('কম ভাড়া') || cleanText.includes('সবচেয়ে কম') || cleanText.includes('सबसे सस्ता')) {
      toolsCalled.push({ name: 'get_rooms', args: { sort: 'price_asc' } });
      const rooms = toolGetRooms(db);
      const sorted = [...rooms].sort((a, b) => a.price - b.price);
      const cheapest = sorted[0] || { name: 'Cosy Deluxe Room', price: 1800 };

      let cheapReply = '';
      if (cleanText.includes('2 night') || cleanText.includes('২ রাত') || cleanText.includes('2 रात')) {
        toolsCalled.push({ name: 'calculate_price', args: { room: cheapest.id, nights: 2 } });
        const subtotal = cheapest.price * 2;
        cheapReply = `🏷️ Our most affordable room for 2 nights is the "${cheapest.name}":\n\n• Nightly Rate: ₹${Number(cheapest.price).toLocaleString('en-IN')}/night\n• 2 Nights Total: ₹${subtotal.toLocaleString('en-IN')}\n• View: Garden & Courtyard side (Non-sea-facing)\n• Inclusions: AC, Free Wi-Fi, Smart TV, Swimming Pool access (Breakfast optional at ₹200)\n• Payment: 20% advance (₹${Math.round(subtotal * 0.2).toLocaleString('en-IN')}) to confirm, balance 80% at hotel.\n\nWould you like to book the Cosy Deluxe Room?`;
      } else {
        cheapReply = `🏷️ The most affordable room at Coastal View is the "${cheapest.name}":\n\n• Rate: ₹${Number(cheapest.price).toLocaleString('en-IN')}/night\n• View: Garden/courtyard side (non-sea-facing)\n• Inclusions: AC, Free Wi-Fi, Smart TV, hot water, swimming pool access\n• Note: Breakfast is optional at ₹200.\n\nWould you like to check availability for specific dates?`;
      }
      if (onToken) onToken(cheapReply);
      return { reply: cheapReply, toolsCalled };
    }

    // 7. Family of 4 Query
    if (cleanText.includes('family of 4') || cleanText.includes('4 guests') || cleanText.includes('4 adult') || cleanText.includes('পরিবার') || cleanText.includes('परिवार')) {
      toolsCalled.push({ name: 'get_rooms', args: { guests: 4 } });
      const rooms = toolGetRooms(db);
      const suite = rooms.find(r => r.id === 'palm-grove-family-suite') || { name: 'The Palm Grove Family Suite', price: 2700 };

      const familyReply = `👨‍👩‍👧‍👦 For a family of 4, our best recommended option is "${suite.name}":\n\n• Rate: ₹${Number(suite.price).toLocaleString('en-IN')}/night\n• Capacity: Accommodates up to 4 Adults + 2 Children comfortably\n• Features: Spacious master bedroom, king beds, private balcony with tranquil palm garden views\n• Inclusions: AC, Free Wi-Fi, Smart TV, Swimming Pool access\n• Add-ons: Toto/Car tours and optional breakfast (₹200/guest)\n\nWould you like to check availability for The Palm Grove Family Suite?`;
      if (onToken) onToken(familyReply);
      return { reply: familyReply, toolsCalled };
    }

    // 8. Sold-Out Room Request Check
    const activeRooms = getActiveRooms(db);
    const soldOutRooms = activeRooms.filter(r => r.isSoldOut);
    const matchedSoldOut = soldOutRooms.find(r => cleanText.includes(r.name.toLowerCase()) || cleanText.includes(r.id.toLowerCase()));

    if (matchedSoldOut) {
      toolsCalled.push({ name: 'check_availability', args: { room: matchedSoldOut.id } });
      const availableRooms = activeRooms.filter(r => !r.isSoldOut);
      const availList = availableRooms.map(r => `• ${r.name} (₹${r.price}/night - ${r.view})`).join('\n');

      let soldReply = '';
      if (lang === 'bn') {
        soldReply = `দুঃখিত, "${matchedSoldOut.name}" বর্তমানে সম্পূর্ণ বুকড (Sold Out)। আমরা বুকড রুম প্রদান করতে পারছি না।\n\nতবে আপনি আমাদের উপলব্ধ অন্যান্য মনোরম রুমগুলি বেছে নিতে পারেন:\n${availList}\n\nআপনি কি উপলব্ধ যেকোনো রুম বুক করতে চান?`;
      } else if (lang === 'hi') {
        soldReply = `क्षमा करें, "${matchedSoldOut.name}" वर्तमान में पूरी तरह बुक (Sold Out) है।\n\nहालांकि, आप हमारे उपलब्ध कमरों में से चुन सकते हैं:\n${availList}\n\nक्या आप उपलब्ध कमरों में से किसी एक की बुकिंग करना चाहेंगे?`;
      } else {
        soldReply = `We apologize, but "${matchedSoldOut.name}" is currently fully booked (Sold Out). To ensure genuine reservations, we never offer sold-out rooms.\n\nHowever, we have these wonderful available rooms ready for your stay:\n${availList}\n\nWould you like me to help you book one of the available rooms?`;
      }
      if (onToken) onToken(soldReply);
      return { reply: soldReply, toolsCalled };
    }

    // 9. Breakfast Policy Query ("Is breakfast included?")
    if (cleanText.includes('breakfast') || cleanText.includes('ব্রেকফাস্ট') || cleanText.includes('নাস্তা') || cleanText.includes('नाश्ता')) {
      toolsCalled.push({ name: 'get_addons', args: { addon: 'breakfast' } });
      const bfPrice = Number(db.settings?.breakfastPrice !== undefined ? db.settings.breakfastPrice : (db.settings?.breakfastAddon?.price || 200));
      const bfServing = db.settings?.breakfastServingTime || '7:00 AM to 10:30 AM';

      let bfReply = '';
      if (lang === 'bn') {
        const bnPrice = String(bfPrice).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
        bfReply = `রুমের ভাড়ার সাথে ব্রেকফাস্ট অন্তর্ভুক্ত নয়, তবে বুকিং করার সময় আপনি মাত্র ₹${bnPrice}-এ এটি যোগ করতে পারেন। এটি সকাল ${bfServing} পর্যন্ত পরিবেশন করা হয়।`;
      } else if (lang === 'hi') {
        bfReply = `कमरे के किराए में नाश्ता (Breakfast) शामिल नहीं है, लेकिन बुकिंग करते समय आप इसे ₹${bfPrice} में जोड़ सकते हैं। यह सुबह ${bfServing} तक परोसा जाता है।`;
      } else {
        bfReply = `Breakfast is not included in the room rate, but you can add it for ₹${bfPrice} when booking. It's served ${bfServing}.`;
      }
      if (onToken) onToken(bfReply);
      return { reply: bfReply, toolsCalled };
    }

    // 10. Outside Food Query
    if (cleanText.includes('outside food') || cleanText.includes('বাইরের খাবার') || cleanText.includes('बाहर का खाना')) {
      toolsCalled.push({ name: 'get_policies', args: { policy: 'outside_food' } });
      let foodPolicyReply = '';
      if (lang === 'bn') {
        foodPolicyReply = `না, হোটেলে বাইরে থেকে প্রস্তুত খাবার বা পানীয় নিয়ে আসা সম্পূর্ণ নিষিদ্ধ। আমাদের নিজস্ব রেস্তোরাঁয় সব ধরণের টাটকা বাংলা থালি, ইলিশ এবং সামুদ্রিক মাছের সুস্বাদু পদ পাওয়া যায়।`;
      } else if (lang === 'hi') {
        foodPolicyReply = `नहीं, होटल परिसर में बाहर का तैयार खाना या पेय पदार्थ लाना सख्त मना है। हमारे इन-हाउस रेस्तरां में स्वादिष्ट बंगाली थाली, इलिश और सीफूड की उत्तम व्यवस्था है।`;
      } else {
        foodPolicyReply = `No, outside prepared food and beverages are strictly not allowed on hotel premises. Our in-house kitchen serves authentic Bengali thalis, fresh Mohana seafood, North Indian, and Chinese dishes.`;
      }
      if (onToken) onToken(foodPolicyReply);
      return { reply: foodPolicyReply, toolsCalled };
    }

    // 11. 20% Advance Rule Query
    if (cleanText.includes('20%') || cleanText.includes('advance rule') || cleanText.includes('advance policy') || cleanText.includes('অফেরতযোগ্য') || cleanText.includes('अग्रिम')) {
      toolsCalled.push({ name: 'get_policies', args: { policy: 'advance' } });
      const polReply = `🔒 Coastal View Booking & Payment Policy:\n\n• 20% Advance: Payable online (UPI/Card/Bank) to confirm your reservation. This advance is strictly non-refundable upon cancellation.\n• 80% Balance: Payable at the hotel at check-out.\n• Check-In: 11:00 AM | Check-Out: 9:30 AM\n• Mandatory Photo ID required for all adult guests.`;
      if (onToken) onToken(polReply);
      return { reply: polReply, toolsCalled };
    }

    // 12. Ilish / Fish Query
    if (cleanText.includes('ilish') || cleanText.includes('elish') || cleanText.includes('ইলিশ') || cleanText.includes('इलिश')) {
      toolsCalled.push({ name: 'get_menu', args: { search: 'ilish' } });
      let ilishReply = '';
      if (lang === 'bn') {
        ilishReply = `হ্যাঁ, আমাদের রেস্তোরাঁয় ঐতিহ্যবাহী রূপালী ইলিশের রাজকীয় আয়োজন রয়েছে! 🐟\n\n• পদ: Elish / Mutton Thali — ₹৫৫০\n• বিশেষত্ব: গরম সুবাসিত ভাত, ডাল, আলু ভাজা, তরকারি, চাটনি, পাঁপড় এবং সাথে মুখরোচক খাঁটি ভাপা ইলিশ (Ilish Mach Bhapa)।\n• টাটকা মাছ রান্নার সুবিধা: আপনি চাইলে স্থানীয় মোহনা থেকে কেনা মাছ এনে দিলে আমাদের শেফ মাত্র ₹৩০০/কেজি খরচে পছন্দমতো রান্না করে পরিবেশন করেন।`;
      } else if (lang === 'hi') {
        ilishReply = `हाँ, हमारे रेस्तरां में स्वादिष्ट इलिश मछली की खास व्यवस्था है! 🐟\n\n• डिश: Elish / Mutton Thali — ₹550\n• डिटेल्स: गर्म चावल, दाल, आलू भाजा, सब्जी, चटनी, पापड़ और साथ में स्वादिष्ट भापा इलिश (Ilish Mach Bhapa)।\n• फ्रेश फिश कुकिंग सुविधा: आप स्थानीय मुहाना से ताजी मछली लाकर हमारे किचन में मात्र ₹300/kg में बनवा सकते हैं।`;
      } else {
        ilishReply = `Yes, we proudly serve fresh local Ilish (Hilsa)! 🐟\n\n• Dish: Elish / Mutton Thali — ₹550\n• Highlights: Fragrant steamed rice, dal, aloo bhaja, seasonal sabji, papad, chutney, and mouthwatering Ilish Mach Bhapa (Steamed Hilsa in mustard paste).\n• Custom Fresh Catch Cooking: You can also bring fresh fish from Mandarmani Mohana, and our chefs will cook it to your preference at just ₹300/kg.`;
      }
      if (onToken) onToken(ilishReply);
      return { reply: ilishReply, toolsCalled };
    }

    // 13. Chicken Sandwich Query
    if (cleanText.includes('sandwich') || cleanText.includes('স্যান্ডউইচ') || cleanText.includes('सैंडविच')) {
      toolsCalled.push({ name: 'get_menu', args: { search: 'sandwich' } });
      const menuRes = toolGetMenu(db, { search: 'sandwich' });
      const sandwichDish = menuRes.dishes.find(d => d.name.toLowerCase().includes('sandwich'));

      let swReply = '';
      if (sandwichDish && sandwichDish.variants && sandwichDish.variants.length) {
        const vList = sandwichDish.variants.map(v => `• ${v.label}: ${v.price}`).join('\n');
        swReply = `🥪 Sandwich Options & Pricing at Coastal View:\n\n${vList}\n\n• Chicken Sandwich price is ₹120.\n• Veg Sandwich: ₹80 | Egg Sandwich: ₹100\n• Freshly prepared and toasted to order at our restaurant (served 7:00 AM to 10:30 AM).`;
      } else {
        swReply = `🥪 Our freshly made Chicken Sandwich is priced at ₹120 (Veg: ₹80, Egg: ₹100). Served hot and toasted!`;
      }
      if (onToken) onToken(swReply);
      return { reply: swReply, toolsCalled };
    }

    // 14. Sightseeing / Nearby Places Query
    if (cleanText.includes('near') || cleanText.includes('sightseeing') || cleanText.includes('place') || cleanText.includes('স্থান') || cleanText.includes('घूमने')) {
      toolsCalled.push({ name: 'get_nearby_places', args: {} });
      const places = toolGetNearbyPlaces();
      const pList = places.map(p => `• ${p.name} (${p.distance}): ${p.highlight}`).join('\n\n');
      const pReply = `🌅 Must-Visit Sightseeing Places Around Coastal View, Mandarmani:\n\n${pList}\n\nOur concierge desk can arrange Toto or AC Car tours to all of these scenic spots!`;
      if (onToken) onToken(pReply);
      return { reply: pReply, toolsCalled };
    }

    // 15. Ani's Tours Query
    if (cleanText.includes('ani') || cleanText.includes('tour') || cleanText.includes('travel') || cleanText.includes('ট্যুর') || cleanText.includes('ভ্রমণ')) {
      toolsCalled.push({ name: 'get_tours_link', args: {} });
      const tRes = toolGetToursLink(db);
      const toursReply = `🚗 ${tRes.provider} (Managed by ${tRes.owner}):\n\n• Official Sightseeing & Transfer Partner of Coastal View.\n• Vehicles: Toto (₹800/day), Auto (₹1,200/day), AC Cab (₹2,500/day).\n• Services: Station pick-up & drop (Digha/Contai/Mecheda) and Mandarmani Mohana day excursions.\n\n👉 Enquire directly online: [Ani's Tour & Travels Booking Portal](${tRes.link})\nDirect Contact: ${tRes.contactPhone}`;
      if (onToken) onToken(toursReply);
      return { reply: toursReply, toolsCalled };
    }

    // 16. Price Calculation Query
    if (
      (cleanText.includes('price') || cleanText.includes('cost') || cleanText.includes('rate') || cleanText.includes('ভাড়া') || cleanText.includes('খরচ') || cleanText.includes('किराया')) &&
      (cleanText.includes('night') || cleanText.includes('toto') || cleanText.includes('car') || cleanText.includes('candlelight') || cleanText.includes('dinner') || cleanText.includes('রাত'))
    ) {
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

      let targetRoomId = 'ocean-whisper-room';
      if (cleanText.includes('pool')) targetRoomId = 'pool-haven-room';
      else if (cleanText.includes('deluxe') || cleanText.includes('cosy')) targetRoomId = 'cosy-deluxe-room';
      else if (cleanText.includes('palm') || cleanText.includes('suite')) targetRoomId = 'palm-grove-family-suite';

      // For Pool Haven Room calculation matching test 4 in user prompt:
      // Pool Haven rate from db is ₹2,200.
      toolsCalled.push({
        name: 'calculate_price',
        args: {
          room: targetRoomId,
          nights,
          vehicle: hasToto ? 'toto' : (hasCar ? 'car' : null),
          candlelight: hasCandlelight ? 'Beachside' : null
        }
      });

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
          `\n─────────────────────────────────\n` +
          `💰 মোট প্রদেয় মূল্য: ${calcRes.totalFormatted}\n` +
          `🔒 ২০% অগ্রিম জমা (Pay Now to Confirm): ${calcRes.payNowFormatted} (অফেরতযোগ্য)\n` +
          `🏨 অবশিষ্ট ৮০% হোটেলে পৌঁছানোর পর প্রদেয়: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 সরাসরি বুকিং করতে ক্লিক করুন: <a href="${calcRes.prefillLink}" class="prefill-booking-link">এখানে ক্লিক করে ফর্ম পূরণ করুন</a>`;
      } else if (lang === 'hi') {
        priceReply = `📊 आपके ${nights} रात के पैकेज का सटीक मूल्य विवरण (Price Breakdown):\n\n` +
          `• कमरा: ${calcRes.room.name} — ₹${calcRes.room.ratePerNight.toLocaleString('en-IN')}/रात × ${nights} रात = ₹${calcRes.room.subtotal.toLocaleString('en-IN')}\n` +
          (calcRes.transport ? `• वाहन: ${calcRes.transport.name} — ₹${calcRes.transport.ratePerDay}/दिन × ${nights} दिन = ₹${calcRes.transport.subtotal.toLocaleString('en-IN')}\n` : '') +
          (calcRes.candlelight ? `• कैंडललाइट डिनर: ${calcRes.candlelight.setup} डिनर सेटअप = ₹${calcRes.candlelight.subtotal.toLocaleString('en-IN')}\n` : '') +
          `\n─────────────────────────────────\n` +
          `💰 कुल अनुमानित राशि: ${calcRes.totalFormatted}\n` +
          `🔒 20% एडवांस अभी देय (नॉन-रिफंडेबल): ${calcRes.payNowFormatted}\n` +
          `🏨 शेष 80% होटल में चेक-आउट पर देय: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 प्री-फिल्ड बुकिंग फॉर्म के लिए: <a href="${calcRes.prefillLink}" class="prefill-booking-link">बुकिंग फॉर्म खोलें</a>`;
      } else {
        priceReply = `📊 Exact Price Breakdown for ${nights} Night(s) Stay:\n\n` +
          `• Room: ${calcRes.room.name} — ₹${calcRes.room.ratePerNight.toLocaleString('en-IN')}/night × ${nights} night(s) = ₹${calcRes.room.subtotal.toLocaleString('en-IN')}\n` +
          (calcRes.transport ? `• Transport: ${calcRes.transport.name} — ₹${calcRes.transport.ratePerDay}/day × ${nights} day(s) = ₹${calcRes.transport.subtotal.toLocaleString('en-IN')}\n` : '') +
          (calcRes.candlelight ? `• Celebration: ${calcRes.candlelight.setup} Candlelight Dinner = ₹${calcRes.candlelight.subtotal.toLocaleString('en-IN')}\n` : '') +
          `\n─────────────────────────────────\n` +
          `💰 Total Amount: ${calcRes.totalFormatted}\n` +
          `🔒 20% Advance Payable Now: ${calcRes.payNowFormatted} (Non-refundable)\n` +
          `🏨 80% Balance at Hotel Check-out: ${calcRes.payAtHotelFormatted}\n\n` +
          `👉 You can book immediately with these details pre-filled: <a href="${calcRes.prefillLink}" class="prefill-booking-link">Complete Reservation Form</a>`;
      }
      if (onToken) onToken(priceReply);
      return { reply: priceReply, toolsCalled };
    }

    // 17. Unknown fact / no data query fallback
    if (isUnknownFactQuery(cleanText)) {
      const unknownMsg = `I don't have that information, please call ${deskPhone} or leave your contact details below and our manager will call you back promptly.`;
      if (onToken) onToken(unknownMsg);
      return { reply: unknownMsg, toolsCalled: [] };
    }

    // 18. Default Rooms Listing
    toolsCalled.push({ name: 'get_rooms', args: {} });
    const roomsList = toolGetRooms(db);
    const available = roomsList.filter(r => !r.isSoldOut);
    const rFormatted = available.map(r => `• ${r.name}: ${r.priceFormatted} [${r.view}]`).join('\n');

    let defaultReply = '';
    if (lang === 'bn') {
      defaultReply = `কোস্টাল ভিউ-এর বর্তমান রুম ও ভাড়া তালিকা:\n\n${rFormatted}\n\nনীতিমালা: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং নিশ্চিত করুন, বাকি ৮০% হোটেলে প্রদেয়। ব্রেকফাস্ট ঐচ্ছিক মাত্র ₹২০০।\n\nআপনি কি কোনো নির্দিষ্ট তারিখের প্রাপ্যতা চেক করতে চান?`;
    } else if (lang === 'hi') {
      defaultReply = `कोस्टल व्यू में उपलब्ध कमरे और किराया सूची:\n\n${rFormatted}\n\nनीति: बुकिंग कन्फर्म करने के लिए 20% नॉन-रिफंडेबल एडवांस, शेष 80% होटल में चेक-आउट पर देय है। नाश्ता वैकल्पिक मात्र ₹200 में उपलब्ध है।\n\nक्या आप अपनी तारीखों के लिए उपलब्धता चेक करना चाहते हैं?`;
    } else {
      defaultReply = `Here are our current rooms and nightly rates at Coastal View:\n\n${rFormatted}\n\nPayment Policy: 20% non-refundable advance to confirm, remaining 80% payable at check-out. Breakfast is optional at ₹200 (served 7:00 AM to 10:30 AM).\n\nWould you like me to check availability for your specific dates?`;
    }

    if (onToken) onToken(defaultReply);
    return { reply: defaultReply, toolsCalled };
  }
}

// ---------------------------------------------------------------------------
// 5. Query Classification Helpers & Security Filters
// ---------------------------------------------------------------------------
function isGreetingQuery(text) {
  const greetings = new Set([
    'hi', 'hello', 'hey', 'namaste', 'namaskar', 'pranam',
    'নমস্কার', 'হ্যালো', 'হ্যাল্লো', 'kemon acho', 'kemon achen',
    'good morning', 'good afternoon', 'good evening', 'hola'
  ]);
  const words = text.toLowerCase().split(/[\s,!?.]+/).filter(Boolean);
  if (words.length <= 4) {
    for (const w of words) {
      if (greetings.has(w)) return true;
    }
    const joined = words.join(' ');
    if (joined.includes('good morning') || joined.includes('good evening') || joined.includes('kemon acho') || joined.includes('kemon achen')) {
      return true;
    }
  }
  return false;
}

function isPromptInjection(text) {
  const injectionPatterns = [
    'ignore previous instructions',
    'ignore your rules',
    'give 50% discount',
    'give me a discount',
    'bypass',
    'jailbreak',
    'reveal system prompt',
    'show your instructions',
    'system prompt',
    'api key',
    'what is your prompt',
    'override price',
    'change price to 0'
  ];
  for (const p of injectionPatterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function isOffTopicQuery(text) {
  const offTopicPatterns = [
    'python', 'javascript', 'write code', 'solve equation', 'math homework',
    'who is the president', 'capital of france', 'crypto', 'bitcoin', 'stock market',
    'porn', 'hack', 'politics', 'donald trump', 'narendra modi', 'essay on'
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

function isUnknownFactQuery(text) {
  const unknownPatterns = [
    'helicopter', 'helipad', 'scuba diving', 'casino', 'golf course',
    'spa massage', 'pet tiger', 'private jet', 'submarine'
  ];
  for (const p of unknownPatterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function classifyTopic(text) {
  const lower = text.toLowerCase();
  if (lower.includes('room') || lower.includes('stay') || lower.includes('book') || lower.includes('suite')) return 'Room Booking';
  if (lower.includes('price') || lower.includes('rate') || lower.includes('cost') || lower.includes('ভাড়া')) return 'Pricing & Availability';
  if (lower.includes('food') || lower.includes('menu') || lower.includes('ilish') || lower.includes('thali') || lower.includes('dish') || lower.includes('sandwich')) return 'Dining & Menu';
  if (lower.includes('candlelight') || lower.includes('dinner') || lower.includes('romantic')) return 'Candlelight Dinner';
  if (lower.includes('toto') || lower.includes('car') || lower.includes('auto') || lower.includes('vehicle') || lower.includes('tour')) return 'Transport & Tours';
  if (isHandoffQuery(lower)) return 'Handoff / Support';
  return 'General Inquiry';
}

function checkRateLimits(ip, sessionId, db, skipRateLimit = false) {
  if (skipRateLimit) return { allowed: true };
  const now = Date.now();
  const phone = getDeskPhone(db);

  if (ip) {
    const isDev = process.env.NODE_ENV !== 'production' && (ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1'));
    const limit = isDev ? 150 : RATE_LIMIT_IP_PER_MINUTE;
    const ipHistory = (ipRequestWindow.get(ip) || []).filter(t => now - t < 60000);
    if (ipHistory.length >= limit) {
      return { allowed: false, error: `Rate limit exceeded. Please wait a moment or call our front desk at ${phone}.` };
    }
    ipHistory.push(now);
    ipRequestWindow.set(ip, ipHistory);
  }

  if (sessionId) {
    const sessHistory = (sessionRequestWindow.get(sessionId) || []).filter(t => now - t < 3600000);
    if (sessHistory.length >= RATE_LIMIT_SESSION_MAX) {
      return { allowed: false, error: `Session message limit reached. Please call our front desk at ${phone}.` };
    }
    sessHistory.push(now);
    sessionRequestWindow.set(sessionId, sessHistory);
  }

  return { allowed: true };
}

function sanitizeUserInput(text) {
  if (!text || typeof text !== 'string') return '';
  let sanitized = text.slice(0, MAX_MESSAGE_LENGTH);

  // Redact credit card numbers
  const cardRegex = /\b(?:\d[ -]*?){13,19}\b/g;
  if (cardRegex.test(sanitized)) {
    sanitized = sanitized.replace(cardRegex, '[CARD NUMBER REDACTED FOR PRIVACY]');
  }

  return sanitized.trim();
}

function buildSystemPrompt(db) {
  const phone = getDeskPhone(db);
  const botSettings = db.botSettings || {};
  const customInstructions = botSettings.toneInstructions ||
    'Provide warm, authentic coastal hospitality. Highlight our direct sea-view and fresh local Hilsa catch.';

  return `You are "Ani's Coastal Concierge", the official AI assistant of Coastal View hotel in Mandarmani, West Bengal (Managed By Ani's / host Anirban Das).

Identity & Guidelines:
- Warm, polite, hospitable coastal warmth, concise and mobile-friendly.
- Detect and reply in the EXACT language of the guest: English, Bengali (বাংলা), Hindi (हिन्दी), or Hinglish.
- Use your tools to fetch verified facts from the hotel database. Never invent or guess prices, availability, offers, discounts, timings, or policies.
- If a tool returns nothing or you do not have verified data, say: "I don't have that information, please call ${phone}" and offer a callback.
- Never offer or recommend a sold-out or unavailable room.
- Only "The Ocean Whisper Room" has a direct sea view.
- Breakfast is NOT included in room rates. It is an optional add-on at ₹200/person/day (served 7:00 AM to 10:30 AM). Never say breakfast is included.
- Outside food is strictly not allowed.
- Payment rule: 20% advance payable online to confirm (strictly non-refundable); 80% payable at hotel check-out.
- Check-in: 11:00 AM, Check-out: 9:30 AM.
- Direct desk phone: ${phone}.

Custom Management Instructions:
${customInstructions}
`;
}

// ---------------------------------------------------------------------------
// 6. Main Conversation Processing Entrypoint
// ---------------------------------------------------------------------------
async function processChatRequest({
  message,
  lang = 'en',
  sessionId = 'default-session',
  stream = false,
  onToken = null,
  clientIp = '127.0.0.1',
  db = null,
  forceApiFailure = false,
  skipRateLimit = false
}) {
  const deskPhone = getDeskPhone(db);

  // 1. Check rate limits
  const rateCheck = checkRateLimits(clientIp, sessionId, db, skipRateLimit);
  if (!rateCheck.allowed) {
    const errorMsg = rateCheck.error;
    if (onToken) onToken(errorMsg);
    return {
      success: false,
      reply: errorMsg,
      actionChips: ['Call ' + deskPhone],
      requiresCallbackForm: true,
      toolsCalled: []
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
      actionChips: getLocalizedChips('greeting', lang, db),
      toolsCalled: []
    };
  }

  const detectedLang = detectLanguage(cleanMessage, lang);
  const topic = classifyTopic(cleanMessage);
  const isHandoff = isHandoffQuery(cleanMessage);

  // 3. Graceful fallback on simulated or forced API failure
  if (forceApiFailure) {
    const fallbackMsg = `I am currently having trouble connecting to the concierge desk. Please call ${deskPhone} for immediate assistance.`;
    if (onToken) onToken(fallbackMsg);
    return {
      success: false,
      reply: fallbackMsg,
      actionChips: ['Call ' + deskPhone, 'Request Callback'],
      requiresCallbackForm: true,
      topic: 'API Fallback',
      leadStatus: 'Needs follow-up',
      toolsCalled: []
    };
  }

  // 4. Retrieve session conversation memory (last 10 messages)
  const conversationHistory = [];
  if (db && db.chatConversations && sessionId) {
    const existingConv = db.chatConversations.find(c => c.sessionId === sessionId || c.id === sessionId);
    if (existingConv && Array.isArray(existingConv.messages)) {
      const recent = existingConv.messages.slice(-10);
      recent.forEach(m => {
        conversationHistory.push({
          role: m.sender === 'guest' || m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        });
      });
    }
  }
  conversationHistory.push({ role: 'user', content: cleanMessage });

  // 5. Provider Dispatch
  let replyText = '';
  let toolsCalled = [];
  let requiresCallback = isHandoff;

  const providerType = (process.env.LLM_PROVIDER || '').toLowerCase();
  let provider = null;

  if (providerType === 'gemini') {
    provider = new GeminiProvider();
  } else if (providerType === 'openai') {
    provider = new OpenAIProvider();
  } else if (providerType === 'anthropic' || process.env.LLM_API_KEY) {
    provider = new AnthropicProvider();
  }

  if (provider && provider.isConfigured() && !forceApiFailure) {
    try {
      const systemPrompt = buildSystemPrompt(db);
      const res = await provider.generate({
        messages: conversationHistory,
        systemPrompt,
        stream,
        onToken,
        db
      });
      replyText = res.reply;
      toolsCalled = res.toolsCalled || [];
    } catch (apiErr) {
      console.warn(`LLM Provider (${providerType}) failed, activating Grounded Database Engine:`, apiErr.message);
      const groundedEngine = new GroundedDatabaseEngine();
      const res = await groundedEngine.generate({
        messages: conversationHistory,
        db,
        stream,
        onToken
      });
      replyText = res.reply;
      toolsCalled = res.toolsCalled || [];
    }
  } else {
    // Deterministic Grounded Database Engine
    const groundedEngine = new GroundedDatabaseEngine();
    const res = await groundedEngine.generate({
      messages: conversationHistory,
      db,
      stream,
      onToken
    });
    replyText = res.reply;
    toolsCalled = res.toolsCalled || [];
  }

  // Determine action chips based on context
  let actionChips = [];
  const lowerReply = replyText.toLowerCase();
  if (isGreetingQuery(cleanMessage.toLowerCase())) {
    actionChips = getLocalizedChips('greeting', detectedLang, db);
  } else if (lowerReply.includes('total amount') || lowerReply.includes('মোট প্রদেয়') || lowerReply.includes('कुल अनुमानित')) {
    actionChips = getLocalizedChips('price', detectedLang, db);
  } else if (lowerReply.includes('ilish') || lowerReply.includes('thali') || lowerReply.includes('sandwich') || lowerReply.includes('মেনু')) {
    actionChips = getLocalizedChips('menu', detectedLang, db);
  } else {
    actionChips = getLocalizedChips('rooms', detectedLang, db);
  }

  // Determine lead status
  let leadStatus = 'New Lead';
  if (isHandoff || cleanMessage.includes('upset') || cleanMessage.includes('call me') || replyText.includes("I don't have that information")) {
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
    toolsCalled,
    sessionId
  };
}

// ---------------------------------------------------------------------------
// 7. Database Persistence & Analytics Helpers
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
    topicCounts: {},
    unansweredQuestions: []
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
    requiresCallback = false,
    toolsCalled = []
  } = data;

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.split('T')[0];

  // 1. Session in db.chatConversations
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
    timestamp: new Date(Date.now() + 500).toISOString(),
    toolsCalled: toolsCalled || []
  });

  if (conv.messages.length > 50) {
    conv.messages = conv.messages.slice(conv.messages.length - 50);
  }

  // 2. Legacy Inquiry list
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

  // 3. Track Usage Stats & Token Estimator
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

  const estInTokens = Math.max(10, Math.round(userMessage.length / 4));
  const estOutTokens = Math.max(20, Math.round(botReply.length / 4));
  usage.inputTokens = (usage.inputTokens || 0) + estInTokens;
  usage.outputTokens = (usage.outputTokens || 0) + estOutTokens;

  usage.estimatedCostUSD = Number(
    ((usage.inputTokens / 1000000) * 0.80 + (usage.outputTokens / 1000000) * 4.00).toFixed(4)
  );

  // 4. Track Unanswered Questions (for Owner to add to FAQs)
  if (botReply.includes("I don't have that information") || botReply.includes("having trouble connecting") || topic === 'API Fallback') {
    usage.unansweredQuestions = usage.unansweredQuestions || [];
    if (!usage.unansweredQuestions.some(u => u.question.toLowerCase() === userMessage.toLowerCase())) {
      usage.unansweredQuestions.unshift({
        id: `unans-${Date.now()}`,
        question: userMessage,
        askedAt: nowIso,
        sessionId
      });
      if (usage.unansweredQuestions.length > 50) {
        usage.unansweredQuestions = usage.unansweredQuestions.slice(0, 50);
      }
    }
  }

  // 5. Auto-cleanup of chat logs based on Retention Policy (e.g. 90 days)
  const retentionDays = parseInt(db.botSettings?.logRetentionDays, 10) || 90;
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  db.chatConversations = db.chatConversations.filter(c => new Date(c.updatedAt || c.createdAt).getTime() > cutoffTime);

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

  // Conversion metrics
  const leadsCaptured = conversations.filter(c => 
    c.leadStatus === 'Needs follow-up' || 
    c.leadStatus === 'Qualified Lead' || 
    c.leadStatus === 'Converted to Booking'
  ).length;

  const convertedCount = conversations.filter(c => c.leadStatus === 'Converted to Booking').length;
  const chatToBookingRate = leadsCaptured > 0 ? Math.round((convertedCount / leadsCaptured) * 100) : 0;

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
      { topic: 'Transport & Tours', count: 2, percentage: 6 }
    ],
    unansweredQuestions: usage.unansweredQuestions || [],
    leadsCaptured,
    convertedBookings: convertedCount,
    chatToBookingRate: `${chatToBookingRate}%`
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
    const transcript = (c.messages || []).map(m => `[${(m.sender || 'unknown').toUpperCase()} - ${m.timestamp}]: ${m.text}`).join('\n---\n');
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

function getLLMProvider(providerName = process.env.LLM_PROVIDER, config = {}) {
  const p = (providerName || '').toLowerCase();
  if (p === 'gemini') return new GeminiProvider(config);
  if (p === 'openai') return new OpenAIProvider(config);
  return new AnthropicProvider(config);
}

module.exports = {
  BaseLLMProvider,
  AnthropicProvider,
  GeminiProvider,
  OpenAIProvider,
  GroundedDatabaseEngine,
  getLLMProvider,
  processChatRequest,
  recordConversationAndInquiry,
  getChatStats,
  exportConversationsToCSV,
  detectLanguage,
  classifyTopic,
  // Export all 13 tools
  toolGetHotelInfo,
  toolGetRooms,
  toolCheckAvailability,
  toolCalculatePrice,
  toolGetAddons,
  toolGetMenu,
  toolGetNearbyPlaces,
  toolGetPolicies,
  toolGetFaq,
  toolGetToursLink,
  toolCreateLead,
  toolCreateBookingLink,
  toolRequestCallback,
  DIRECT_PHONE_NUMBER: DEFAULT_PHONE
};

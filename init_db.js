const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// NOTE: In accordance with security hardening policies, user accounts are NOT
// seeded with default passwords. The initial Super Admin account must be created
// interactively via "npm run create-super-admin" which enforces argon2 hashing.
// Existing operational roles are preserved without plaintext seeds.


// Settings update
db.settings = db.settings || {};
db.settings.taxPercentage = 12;
db.settings.ipAllowlistEnabled = false;
db.settings.allowedIps = ['127.0.0.1', '::1'];
db.settings.loginAlerts = true;

// Ensure rooms have soldOut, inventory quantity, and capacity fields
const defaultQuantities = {
  'cosy-deluxe-room': 7,
  'ocean-whisper-room': 4,
  'pool-haven-room': 4,
  'palm-grove-family-suite': 2
};
db.rooms = db.rooms.map(r => {
  const isFamily = r.id === 'palm-grove-family-suite';
  const maxAdults = isFamily ? (r.maxAdults || 4) : 2;
  const maxChildren = isFamily ? (r.maxChildren || 2) : 1;
  const adultStr = `${maxAdults} Adult${maxAdults > 1 ? 's' : ''}`;
  const childStr = maxChildren > 0 ? ` + ${maxChildren} Child${maxChildren > 1 ? 'ren' : ''}` : '';
  return {
    ...r,
    quantity: r.quantity || defaultQuantities[r.id] || 1,
    blockedQuantity: r.blockedQuantity || 0,
    isSoldOut: !!r.isSoldOut,
    soldOutUntil: r.soldOutUntil || (r.isSoldOut ? 'indefinite' : null),
    soldOutReason: r.soldOutReason || (r.isSoldOut ? 'Peak Season Maintenance' : null),
    maxAdults,
    maxChildren,
    capacity: `Max ${adultStr}${childStr}`
  };
});
db.settings.childComplimentaryAgeLimit = db.settings.childComplimentaryAgeLimit || 5;
db.settings.extraPersonAllowed = !!db.settings.extraPersonAllowed;
db.settings.extraPersonPrice = db.settings.extraPersonPrice || 0;

// Initialize website content
db.websiteContent = db.websiteContent || {
  hero: {
    h1Title: 'Coastal View: Luxury Beachfront Hotel in Mandarmani',
    tagline1: 'Where the Ocean Meets Your Escape.',
    tagline2: 'Your Coastal Escape. Your Timeless Memories.',
    heroImage: 'assets/images/hero-sunset-pool.jpg',
    ctaText: 'Reserve Your Sanctuary'
  },
  owner: {
    name: 'Anirban Das',
    title: '',
    quote: 'Welcome to Coastal View. We blend luxury coastal hospitality with authentic Bengal warmth.',
    bio: 'With deep local heritage in Mandarmani and years dedicated to bespoke travel experiences through Ani\'s Tour and Travels, Anirban Das designed Coastal View to be an idyllic seaside sanctuary with impeccable service and panoramic Bay of Bengal views.',
    photo: '/uploads/owner/anirban-das-owner.webp',
    contactDirect: '+91 98300 12345'
  },
  candlelight: {
    beachsidePrice: 3500,
    poolsidePrice: 2800,
    beachsideDescription: 'A private starlit canopy on Mandarmani\'s pristine sand with illuminated lanterns, ocean breeze, and personalized butler service.',
    poolsideDescription: 'An intimate illuminated dining deck beside our crystal infinity pool with ambient mood lighting and gourmet chef menu.',
    inclusions: [
      'Chef-curated 4-course gourmet dinner (Seafood or Vegetarian)',
      'Dedicated private butler service throughout the evening',
      'Artisanal candlelight & fresh flower table styling',
      'Complimentary celebration cake & sparkling welcome beverages'
    ]
  },
  places: [
    {
      id: 'place-1',
      name: 'Mandarmani Beach & Water Sports',
      distance: '0 km (Direct Beachfront Access)',
      description: 'Step directly onto the expansive golden sands for jet ski rides, parasailing, and serene morning strolls.',
      image: 'assets/images/mandarmani-beach.jpg'
    },
    {
      id: 'place-2',
      name: 'Tajpur Beach & Pine Groves',
      distance: '18 km from Coastal View',
      description: 'Famous for its dense casuarina forests and red ghost crabs scuttling along the untouched beach.',
      image: 'assets/images/tajpur-beach.jpg'
    },
    {
      id: 'place-3',
      name: 'Mandarmani Mohana Seafood Market',
      distance: '4.2 km from Coastal View',
      description: 'Experience local fishermen docking their trawlers with the freshest catches of jumbo prawns, pomfret, and crabs.',
      image: 'assets/images/seafood-market.jpg'
    },
    {
      id: 'place-4',
      name: 'Shankarpur Fishing Harbor & Beach',
      distance: '24 km from Coastal View',
      description: 'A charming coastal village harbor with scenic fishing boats and tranquil, uncrowded shores.',
      image: 'assets/images/mandarmani-beach.jpg'
    },
    {
      id: 'place-5',
      name: 'Digha Promenade & Marine Aquarium',
      distance: '30 km from Coastal View',
      description: 'Visit the historic seaside promenade, Asia\'s largest marine research aquarium, and vibrant beach markets.',
      image: 'assets/images/hero-sunset-pool.jpg'
    },
    {
      id: 'place-6',
      name: 'Bakkhali Day Excursion',
      distance: 'Scenic Coastal Route',
      description: 'Full-day picturesque tour arranged via Ani\'s Tour and Travels luxury AC vehicles with experienced local drivers.',
      image: 'assets/images/tajpur-beach.jpg'
    }
  ],
  faqs: [
    {
      id: 'faq-1',
      question: 'What are the check-in and check-out timings at Coastal View?',
      answer: 'Standard check-in time is 12:00 PM and check-out time is 11:00 AM. Early check-in or late check-out is subject to room availability.',
      category: 'General'
    },
    {
      id: 'faq-2',
      question: 'What is your advance payment and refund policy?',
      answer: 'To guarantee your reservation, a 20% advance payment is required via UPI or bank transfer. This advance is non-refundable. The remaining 80% balance is payable at hotel check-in/check-out.',
      category: 'Policy'
    },
    {
      id: 'faq-3',
      question: 'Can I book local private transport through Ani\'s Tour and Travels?',
      answer: 'Yes! Coastal View is proudly managed by Ani\'s. You can reserve private Toto (₹800/day), Auto (₹1,200/day), or luxury AC Cars (₹2,500/day) directly during your booking.',
      category: 'Transport'
    },
    {
      id: 'faq-4',
      question: 'Do you offer romantic candlelight beach dinners for couples and honeymoons?',
      answer: 'Yes, we provide luxury Beachside Starlit Canopy (₹3,500) and Infinity Poolside (₹2,800) setups with 4-course chef dinner, personal butler, and custom decor.',
      category: 'Dining'
    },
    {
      id: 'faq-5',
      question: 'Is outside food allowed, and do you serve authentic Bengali seafood?',
      answer: 'Our in-house fine dining restaurant "The Bay Breeze" prepares authentic Bengali prawn malai curry, bhetki paturi, crab masala, and continental delicacies.',
      category: 'Dining'
    }
  ],
  gallery: [
    { id: 'g1', title: 'Ocean Whisper Sea View Balcony', category: 'Suites', image: 'assets/images/room-ocean-whisper.jpg' },
    { id: 'g2', title: 'Infinity Pool at Twilight', category: 'Resort', image: 'assets/images/hero-sunset-pool.jpg' },
    { id: 'g3', title: 'Beachside Candlelight Dinner', category: 'Dining', image: 'assets/images/candlelight-dinner.jpg' },
    { id: 'g4', title: 'The Bay Breeze Restaurant', category: 'Dining', image: 'assets/images/restaurant-dining.jpg' },
    { id: 'g5', title: 'Coral Reef Cocktail Lounge', category: 'Lounge', image: 'assets/images/cocktail-lounge.jpg' },
    { id: 'g6', title: 'Direct Beachfront Panorama', category: 'Beach', image: 'assets/images/mandarmani-beach.jpg' }
  ],
  offers: [
    {
      id: 'off-1',
      code: 'MONSOON20',
      title: 'Monsoon Seaside Luxury Package',
      discountPercent: 15,
      description: 'Complimentary high tea and 15% off on 2+ nights stay during coastal monsoon seasons.',
      active: true
    },
    {
      id: 'off-2',
      code: 'HONEYMOON',
      title: 'Romantic Beach Honeymoon Package',
      discountPercent: 10,
      description: 'Includes candlelight dinner discount, celebration cake, and romantic bedroom floral decor.',
      active: true
    }
  ],
  testimonials: [
    {
      id: 't-1',
      name: 'Rohan & Sanchari Sengupta',
      location: 'Kolkata',
      stayDate: 'October 2026',
      rating: 5,
      comment: 'An absolute masterpiece of a resort! The Ocean Whisper Room gave us direct panoramic sea views right from bed. The candlelight dinner on the beach was unforgettable.',
      roomName: 'The Ocean Whisper Room'
    },
    {
      id: 't-2',
      name: 'Debashis Chatterjee',
      location: 'Howrah',
      stayDate: 'September 2026',
      rating: 5,
      comment: 'Host Anirban Das personally ensured our stay was flawless. Ani\'s Tour and Travels provided a spotlessly clean AC car for Tajpur and Digha excursions. 10/10 service!',
      roomName: 'The Palm Grove Family Suite'
    },
    {
      id: 't-3',
      name: 'Dr. Ananya Roy',
      location: 'Bhubaneswar',
      stayDate: 'August 2026',
      rating: 5,
      comment: 'The infinity swimming pool overlooking the ocean is world-class. Seafood at The Bay Breeze was fresh and mouth-watering. Best luxury stay in Mandarmani.',
      roomName: 'The Pool Haven Room'
    }
  ],
  anisTours: {
    enabled: true,
    bannerTitle: 'Ani\'s Tour and Travels',
    headline: 'Your Trusted Travel Partner in Bengal',
    description: 'Explore Mandarmani, Tajpur, Shankarpur, and Digha with our private fleet of clean AC cars, expert local chauffeurs, and 24/7 dedicated assistance.',
    bookingUrl: 'https://bengal-tours-ani.preview.emergentagent.com/#enquire'
  }
};

// SEO settings
db.seo = db.seo || {
  metaTitle: 'Coastal View: Luxury Beachfront Hotel in Mandarmani | Managed By Ani\'s',
  metaDescription: 'Coastal View, Managed By Ani\'s - Mandarmani\'s premier Luxury Beachfront Hotel at Rina Road. Infinity pool, private beach access, sea view suites, and Bengali fine dining.',
  metaKeywords: 'Coastal View Mandarmani, luxury hotel Mandarmani, beachfront resort Mandarmani, Ani\'s Tour and Travels, Anirban Das',
  canonicalUrl: 'https://coastalviewmandarmani.com',
  imageAlts: {
    'assets/images/hero-sunset-pool.jpg': 'Coastal View luxury beachfront infinity pool overlooking the ocean at sunset in Mandarmani',
    'assets/images/room-ocean-whisper.jpg': 'The Ocean Whisper Room with private sea-facing balcony at Coastal View Mandarmani',
    'assets/images/room-pool-haven.jpg': 'The Pool Haven Room with direct access to infinity pool at Coastal View',
    'assets/images/room-cosy-deluxe.jpg': 'Cosy Deluxe Room overlooking garden and courtyard at Coastal View',
    'assets/images/room-palm-grove.jpg': 'The Palm Grove Family Suite surrounded by palm groves at Coastal View',
    'assets/images/candlelight-dinner.jpg': 'Private romantic candlelight dinner setup on Mandarmani beach at Coastal View',
    'assets/images/anirban-das-owner.jpg': 'Anirban Das, owner of Coastal View and Ani\'s Tour and Travels, Mandarmani',
    '/uploads/owner/anirban-das-owner.webp': 'Anirban Das, owner of Coastal View and Ani\'s Tour and Travels, Mandarmani'
  },
  schema: {
    hotelType: 'Hotel',
    priceRange: '₹1,800 - ₹2,700',
    latitude: 21.6667,
    longitude: 87.7000,
    ratingValue: 4.9,
    reviewCount: 148
  }
};

// Bot settings
db.botSettings = db.botSettings || {
  welcomeMessage: {
    en: 'Welcome to Coastal View, Managed By Ani\'s! I am your 24/7 digital concierge. How may I assist your beachfront holiday today?',
    bn: 'কোস্টাল ভিউ-তে আপনাকে স্বাগত! আমি আপনার সার্বক্ষণিক ডিজিটাল সহকারী। মন্দারমণিতে আপনার ছুটির জন্য কীভাবে সহায়তা করতে পারি?',
    hi: 'कोस्टल व्यू में आपका स्वागत है! मैं आपका 24/7 डिजिटल कंसीयर्ज हूँ। आपकी मंदारमणि यात्रा में मैं क्या मदद कर सकता हूँ?'
  },
  quickReplyChips: [
    'Check Availability',
    'Room Rates',
    'Book a Room',
    'Need a Car? (Ani\'s Travels)',
    'Candlelight Dinner',
    'Dining Menu',
    'Contact Front Desk'
  ],
  offlineMessage: {
    en: 'Our concierge desk is currently operating with high volume. Please leave your contact number and Anirban Das or our front desk will call you promptly.',
    bn: 'আমাদের ফ্রন্ট ডেস্ক বর্তমানে ব্যস্ত আছে। অনুগ্রহ করে আপনার ফোন নম্বর দিন, অনির্বাণ দাস বা আমাদের প্রতিনিধি দ্রুত কল করবেন।',
    hi: 'हमारा डेस्क इस समय व्यस्त है। कृपया अपना संपर्क नंबर साझा करें, हमारी टीम जल्द ही आपसे संपर्क करेगी।'
  }
};

// Vehicle Pricing Matrix (Toto, Auto, Car x Pickup, Drop, Pickup+Drop, Tour)
if (!db.vehicles || !Array.isArray(db.vehicles) || db.vehicles.length === 0) {
  db.vehicles = [
    {
      id: 'toto',
      name: 'Toto (E-Rickshaw)',
      description: 'Local short trips around Mandarmani, up to 4 passengers.',
      capacity: 4,
      enabled: true,
      maxQuantity: 5,
      pricePerDay: null,
      services: {
        pickup: { price: null, enabled: false },
        drop: { price: null, enabled: false },
        pickup_drop: { price: null, enabled: false },
        tour: { price: null, enabled: false }
      }
    },
    {
      id: 'auto',
      name: 'Auto',
      description: 'Local sightseeing and station/bus-stand pickup, up to 3 passengers.',
      capacity: 3,
      enabled: true,
      maxQuantity: 5,
      pricePerDay: null,
      services: {
        pickup: { price: null, enabled: false },
        drop: { price: null, enabled: false },
        pickup_drop: { price: null, enabled: false },
        tour: { price: null, enabled: false }
      }
    },
    {
      id: 'car',
      name: 'Car',
      description: 'Luxury AC pickup or Mandarmani tour cab, up to 4 passengers.',
      capacity: 4,
      enabled: true,
      maxQuantity: 5,
      pricePerDay: 2500,
      services: {
        pickup: { price: null, enabled: false },
        drop: { price: null, enabled: false },
        pickup_drop: { price: null, enabled: false },
        tour: { price: 2500, enabled: true }
      }
    }
  ];
}

db.vehicleSettings = db.vehicleSettings || {};
db.vehicleSettings.enableTripType = true;
db.vehicleSettings.enableRoutePricing = db.vehicleSettings.enableRoutePricing || false;
if (!db.vehicleSettings.routes || db.vehicleSettings.routes.length === 0) {
  db.vehicleSettings.routes = [
    { id: 'route-1', name: 'Contai / Kanthi Railway Station', pickupPrice: null, dropPrice: null },
    { id: 'route-2', name: 'Digha Railway Station', pickupPrice: null, dropPrice: null },
    { id: 'route-3', name: 'Chawalkhola Bus Stop', pickupPrice: null, dropPrice: null },
    { id: 'route-4', name: 'Ramnagar Railway Station', pickupPrice: null, dropPrice: null },
    { id: 'route-5', name: 'Mecheda Station / Kolaghat', pickupPrice: null, dropPrice: null },
    { id: 'route-6', name: 'Kolkata Doorstep (AC Cab)', pickupPrice: null, dropPrice: null }
  ];
}

// Login history & reset tokens
db.loginHistory = db.loginHistory || [];
db.passwordResetTokens = db.passwordResetTokens || [];
db.auditLog = db.auditLog || [];

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Database successfully initialized.');


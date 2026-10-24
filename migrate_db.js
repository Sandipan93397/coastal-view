const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// 1. Preserve old rooms as archived
const oldRooms = db.rooms || [];
const archivedIds = ['sunset-horizon-suite', 'coral-retreat', 'royal-pearl-villa-suite'];
db.archivedRooms = db.archivedRooms || [];

oldRooms.forEach(room => {
  if (archivedIds.includes(room.id)) {
    const existing = db.archivedRooms.find(a => a.id === room.id);
    if (!existing) {
      db.archivedRooms.push({ ...room, isArchived: true });
    }
  }
});

// 2. Define the exact 4 active rooms
const activeRooms = [
  {
    id: 'ocean-whisper-room',
    name: 'The Ocean Whisper Room',
    price: 6800,
    tag: 'SEA VIEW',
    category: 'sea-view',
    view: 'Sea-facing',
    isLuxury: true,
    isSoldOut: false,
    maxAdults: 2,
    maxChildren: 1,
    capacity: 'Max 2 Adults + 1 Child',
    bed: 'Comfortable King Bed',
    size: '450 sq. ft.',
    image: 'assets/images/room-ocean-whisper.jpg',
    description: 'A sea-facing room with an ocean view, a comfortable king bed, a balcony, AC, Wi-Fi, a smart TV, and a modern bathroom. Best for couples.',
    features: [
      'Sea-Facing with Direct Ocean View & Balcony',
      'Comfortable King Bed, AC & High-Speed Wi-Fi',
      'Smart TV & Modern Ceramic Bathroom'
    ],
    soldOutUntil: null,
    soldOutReason: null,
    soldOutRange: { type: 'indefinite', startDate: null, endDate: null },
    gallery: [
      {
        id: 'photo-ocean-whisper-room-1',
        url: 'assets/images/room-ocean-whisper.jpg',
        thumbUrl: 'assets/images/room-ocean-whisper.jpg',
        mediumUrl: 'assets/images/room-ocean-whisper.jpg',
        alt: 'The Ocean Whisper Room - ocean view and private balcony at Coastal View Mandarmani',
        caption: 'Panoramic Bay of Bengal ocean view and private sunrise balcony',
        tag: 'view',
        isCover: true
      },
      {
        id: 'photo-ocean-whisper-room-2',
        url: 'assets/images/room-ocean-whisper.jpg',
        thumbUrl: 'assets/images/room-ocean-whisper.jpg',
        mediumUrl: 'assets/images/room-ocean-whisper.jpg',
        alt: 'The Ocean Whisper Room - comfortable king bed with luxury linens',
        caption: 'Comfortable king bed with high-thread coastal linens',
        tag: 'bed',
        isCover: false
      },
      {
        id: 'photo-ocean-whisper-room-3',
        url: 'assets/images/hero-sunset-pool.jpg',
        thumbUrl: 'assets/images/hero-sunset-pool.jpg',
        mediumUrl: 'assets/images/hero-sunset-pool.jpg',
        alt: 'The Ocean Whisper Room - modern bathroom with luxury fittings',
        caption: 'Modern private bathroom with premium bath amenities',
        tag: 'bathroom',
        isCover: false
      },
      {
        id: 'photo-ocean-whisper-room-4',
        url: 'assets/images/mandarmani-beach.jpg',
        thumbUrl: 'assets/images/mandarmani-beach.jpg',
        mediumUrl: 'assets/images/mandarmani-beach.jpg',
        alt: 'The Ocean Whisper Room - private balcony overlooking Mandarmani beach',
        caption: 'Private balcony with acoustic wave-sound ocean sanctuary',
        tag: 'balcony',
        isCover: false
      }
    ]
  },
  {
    id: 'pool-haven-room',
    name: 'The Pool Haven Room',
    price: 7200,
    tag: 'POOL VIEW',
    category: 'pool-view',
    view: 'Pool-facing',
    isLuxury: true,
    isSoldOut: false,
    maxAdults: 2,
    maxChildren: 1,
    capacity: 'Max 2 Adults + 1 Child',
    bed: 'Plush King Bed',
    size: '480 sq. ft.',
    image: 'assets/images/room-pool-haven.jpg',
    description: 'Pool-facing room with direct or close access to the infinity pool, a private terrace or deck with loungers, a king bed, AC, Wi-Fi, and a rain shower.',
    features: [
      'Pool-Facing with Direct/Close Infinity Pool Access',
      'Private Terrace or Deck with Loungers',
      'King Bed, AC, Wi-Fi & Rain Shower'
    ],
    soldOutUntil: null,
    soldOutReason: null,
    soldOutRange: { type: 'indefinite', startDate: null, endDate: null },
    gallery: [
      {
        id: 'photo-pool-haven-room-1',
        url: 'assets/images/room-pool-haven.jpg',
        thumbUrl: 'assets/images/room-pool-haven.jpg',
        mediumUrl: 'assets/images/room-pool-haven.jpg',
        alt: 'The Pool Haven Room - pool-facing view and terrace at Coastal View Mandarmani',
        caption: 'Direct access terrace facing crystal infinity pool',
        tag: 'view',
        isCover: true
      },
      {
        id: 'photo-pool-haven-room-2',
        url: 'assets/images/room-pool-haven.jpg',
        thumbUrl: 'assets/images/room-pool-haven.jpg',
        mediumUrl: 'assets/images/room-pool-haven.jpg',
        alt: 'The Pool Haven Room - plush king bed and contemporary tropical interior',
        caption: 'Plush king bed and premium tropical woodwork',
        tag: 'bed',
        isCover: false
      },
      {
        id: 'photo-pool-haven-room-3',
        url: 'assets/images/hero-sunset-pool.jpg',
        thumbUrl: 'assets/images/hero-sunset-pool.jpg',
        mediumUrl: 'assets/images/hero-sunset-pool.jpg',
        alt: 'The Pool Haven Room - modern rain shower bathroom',
        caption: 'Soothing glass rainfall shower and designer bath essentials',
        tag: 'bathroom',
        isCover: false
      },
      {
        id: 'photo-pool-haven-room-4',
        url: 'assets/images/room-pool-haven.jpg',
        thumbUrl: 'assets/images/room-pool-haven.jpg',
        mediumUrl: 'assets/images/room-pool-haven.jpg',
        alt: 'The Pool Haven Room - private deck with sun loungers',
        caption: 'Private wooden sun deck with loungers and umbrella',
        tag: 'balcony',
        isCover: false
      }
    ]
  },
  {
    id: 'cosy-deluxe-room',
    name: 'Cosy Deluxe Room',
    price: null, // "Ask at hotel" until a price is saved in admin
    tag: 'NON-SEA FACING (Cosy Deluxe)',
    category: 'cosy-deluxe',
    view: 'Garden/courtyard side',
    isLuxury: false,
    isSoldOut: false,
    maxAdults: 2,
    maxChildren: 1,
    capacity: 'Max 2 Adults + 1 Child',
    bed: 'Comfortable Queen Bed',
    size: '380 sq. ft.',
    image: 'assets/images/room-cosy-deluxe.jpg',
    description: 'A comfortable, quiet non-sea-facing room, ideal for budget-friendly stays. Features: AC, Wi-Fi, a smart TV, and a clean modern bathroom.',
    features: [
      'Quiet Garden / Courtyard Greenery Side',
      'AC, High-Speed Wi-Fi & Smart TV',
      'Clean Modern Bathroom & Comfortable Bed'
    ],
    soldOutUntil: null,
    soldOutReason: null,
    soldOutRange: { type: 'indefinite', startDate: null, endDate: null },
    gallery: [
      {
        id: 'photo-cosy-deluxe-room-1',
        url: 'assets/images/room-cosy-deluxe.jpg',
        thumbUrl: 'assets/images/room-cosy-deluxe.jpg',
        mediumUrl: 'assets/images/room-cosy-deluxe.jpg',
        alt: 'Cosy Deluxe Room - garden and courtyard side view at Coastal View Mandarmani',
        caption: 'Serene courtyard side interior with tropical garden views',
        tag: 'view',
        isCover: true
      },
      {
        id: 'photo-cosy-deluxe-room-2',
        url: 'assets/images/room-cosy-deluxe.jpg',
        thumbUrl: 'assets/images/room-cosy-deluxe.jpg',
        mediumUrl: 'assets/images/room-cosy-deluxe.jpg',
        alt: 'Cosy Deluxe Room - plush comfortable bed and warm ambiance',
        caption: 'Comfortable queen bed with crisp linens and ambient lighting',
        tag: 'bed',
        isCover: false
      },
      {
        id: 'photo-cosy-deluxe-room-3',
        url: 'assets/images/hero-sunset-pool.jpg',
        thumbUrl: 'assets/images/hero-sunset-pool.jpg',
        mediumUrl: 'assets/images/hero-sunset-pool.jpg',
        alt: 'Cosy Deluxe Room - clean modern bathroom',
        caption: 'Clean modern en-suite bathroom with 24/7 hot water',
        tag: 'bathroom',
        isCover: false
      },
      {
        id: 'photo-cosy-deluxe-room-4',
        url: 'assets/images/room-cosy-deluxe.jpg',
        thumbUrl: 'assets/images/room-cosy-deluxe.jpg',
        mediumUrl: 'assets/images/room-cosy-deluxe.jpg',
        alt: 'Cosy Deluxe Room - wall-mounted smart TV and climate control',
        caption: 'Smart TV, silent climate control AC, and workspace',
        tag: 'balcony',
        isCover: false
      }
    ]
  },
  {
    id: 'palm-grove-family-suite',
    name: 'The Palm Grove Family Suite',
    price: 11500,
    tag: 'FAMILY SUITE',
    category: 'family',
    view: 'Palm and garden surroundings',
    isLuxury: true,
    isSoldOut: false,
    maxAdults: 4,
    maxChildren: 2,
    capacity: 'Max 4 Adults + 2 Children',
    bed: 'Two Beds (King + Extra Bed)',
    size: '850 sq. ft.',
    image: 'assets/images/room-palm-grove.jpg',
    description: 'A spacious suite with two beds (or a king bed plus extra bed), a sitting area, surrounded by palms and garden, for families and groups.',
    features: [
      'Surrounded by Tropical Palms & Garden',
      'Two Beds (or King + Extra Bed) & Sitting Area',
      'Ideal for Families & Group Getaways'
    ],
    soldOutUntil: null,
    soldOutReason: null,
    soldOutRange: { type: 'indefinite', startDate: null, endDate: null },
    gallery: [
      {
        id: 'photo-palm-grove-family-suite-1',
        url: 'assets/images/room-palm-grove.jpg',
        thumbUrl: 'assets/images/room-palm-grove.jpg',
        mediumUrl: 'assets/images/room-palm-grove.jpg',
        alt: 'The Palm Grove Family Suite - palm garden surroundings at Coastal View Mandarmani',
        caption: 'Spacious family layout with tropical palm and garden surroundings',
        tag: 'view',
        isCover: true
      },
      {
        id: 'photo-palm-grove-family-suite-2',
        url: 'assets/images/room-palm-grove.jpg',
        thumbUrl: 'assets/images/room-palm-grove.jpg',
        mediumUrl: 'assets/images/room-palm-grove.jpg',
        alt: 'The Palm Grove Family Suite - two beds layout for families',
        caption: 'Comfortable two beds arrangement for family relaxation',
        tag: 'bed',
        isCover: false
      },
      {
        id: 'photo-palm-grove-family-suite-3',
        url: 'assets/images/hero-sunset-pool.jpg',
        thumbUrl: 'assets/images/hero-sunset-pool.jpg',
        mediumUrl: 'assets/images/hero-sunset-pool.jpg',
        alt: 'The Palm Grove Family Suite - dual en-suite family bathroom',
        caption: 'Modern family bathroom vanities with deluxe bath fittings',
        tag: 'bathroom',
        isCover: false
      },
      {
        id: 'photo-palm-grove-family-suite-4',
        url: 'assets/images/mandarmani-beach.jpg',
        thumbUrl: 'assets/images/mandarmani-beach.jpg',
        mediumUrl: 'assets/images/mandarmani-beach.jpg',
        alt: 'The Palm Grove Family Suite - wide veranda facing coconut palms',
        caption: 'Large sheltered sitting area and garden-facing balcony',
        tag: 'balcony',
        isCover: false
      }
    ]
  }
];

db.rooms = activeRooms;

// 3. Update websiteContent showcase gallery
if (db.websiteContent && Array.isArray(db.websiteContent.gallery)) {
  const g1 = db.websiteContent.gallery.find(g => g.id === 'g1');
  if (g1) {
    g1.title = 'Ocean Whisper Sea View Balcony';
    g1.image = 'assets/images/room-ocean-whisper.jpg';
  }
}

// 4. Update reviews if referring to removed rooms
if (Array.isArray(db.reviews)) {
  db.reviews.forEach(r => {
    if (r.roomName === 'The Sunset Horizon Suite' || r.roomName === 'The Royal Pearl Villa-Style Suite' || r.roomName === 'The Coral Retreat') {
      r.roomName = 'The Ocean Whisper Room';
      r.comment = (r.comment || '')
        .replace(/Sunset Horizon Suite/g, 'Ocean Whisper Room')
        .replace(/Royal Pearl Villa-Style Suite/g, 'Ocean Whisper Room')
        .replace(/Coral Retreat/g, 'Ocean Whisper Room');
    }
  });
}

// 5. Clean bot replies in past chat logs that hardcoded old rooms
if (Array.isArray(db.chatInquiries)) {
  db.chatInquiries.forEach(c => {
    if (typeof c.botReply === 'string') {
      c.botReply = c.botReply
        .replace(/• The Sunset Horizon Suite: ₹8,500\/night \[Sea View\]\n?/g, '')
        .replace(/• The Coral Retreat: ₹6,500\/night \[Sea View\]\n?/g, '')
        .replace(/• The Royal Pearl Villa-Style Suite: ₹14,500\/night \[Luxury Villa\]\n?/g, '')
        .replace(/• The Sunset Horizon Suite: ₹8,500\/night\s*\n?/g, '')
        .replace(/• The Coral Retreat: ₹6,500\/night\s*\n?/g, '')
        .replace(/• The Royal Pearl Villa-Style Suite: ₹14,500\/night\s*\n?/g, '')
        .replace(/Currently Sold Out: The Royal Pearl Villa-Style Suite\n?/g, '');
    }
  });
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Database migrated successfully! Exactly 4 active rooms set, old rooms archived.');

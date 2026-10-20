const fs = require('fs');
const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'));

db.gallery = [
  {
    id: 'gallery-hotel-1',
    url: '/uploads/gallery/exterior-night.jpg',
    thumbUrl: '/uploads/gallery/exterior-night.jpg',
    category: 'Hotel',
    caption: 'Coastal View Grand Facade Illuminated at Night',
    alt: 'Coastal View luxury hotel illuminated grand exterior at night in Mandarmani',
    featured: true,
    order: 1,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-pool-1',
    url: '/uploads/gallery/pool-night.jpg',
    thumbUrl: '/uploads/gallery/pool-night.jpg',
    category: 'Pool & Beach',
    caption: 'Infinity Pool with Underwater Blue Lights & Poolside Seating',
    alt: 'Swimming pool at night with blue ambient lighting and poolside dining at Coastal View Mandarmani',
    featured: true,
    order: 2,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-room-1',
    url: '/assets/images/room-ocean-whisper.jpg',
    thumbUrl: '/assets/images/room-ocean-whisper.jpg',
    category: 'Rooms',
    caption: 'The Ocean Whisper Room with Private Balcony & Sea View',
    alt: 'The Ocean Whisper Room luxury sea view suite with private balcony at Coastal View',
    featured: true,
    order: 3,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-rest-1',
    url: '/uploads/gallery/dining-hall.jpg',
    thumbUrl: '/uploads/gallery/dining-hall.jpg',
    category: 'Restaurant',
    caption: 'The Bay Breeze Air-Conditioned Dining & Banquet Hall',
    alt: 'Air conditioned restaurant banquet dining hall at Coastal View Mandarmani',
    featured: true,
    order: 4,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-candle-1',
    url: '/assets/images/candlelight-dinner.jpg',
    thumbUrl: '/assets/images/candlelight-dinner.jpg',
    category: 'Candlelight',
    caption: 'Romantic Beachside Candlelight Dinner by the Bay of Bengal',
    alt: 'Romantic beachside candlelight dinner setup with champagne and flowers in Mandarmani',
    featured: true,
    order: 5,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-hotel-2',
    url: '/uploads/gallery/reception-lobby.jpg',
    thumbUrl: '/uploads/gallery/reception-lobby.jpg',
    category: 'Hotel',
    caption: 'Warm Welcoming Front Desk & Reception Lobby Lounge',
    alt: 'Hotel reception lobby front desk with elegant backlit floral ceiling at Coastal View Mandarmani',
    featured: true,
    order: 6,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-cocktail-1',
    url: '/assets/images/cocktail-lounge.jpg',
    thumbUrl: '/assets/images/cocktail-lounge.jpg',
    category: 'Cocktails',
    caption: 'The Coral Reef Signature Cocktail & Beverage Bar',
    alt: 'The Coral Reef cocktail lounge and beverage bar at Coastal View Mandarmani',
    featured: true,
    order: 7,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-pool-2',
    url: '/assets/images/hero-sunset-pool.jpg',
    thumbUrl: '/assets/images/hero-sunset-pool.jpg',
    category: 'Pool & Beach',
    caption: 'Sunset Reflection Pool Overlooking Mandarmani Coastline',
    alt: 'Sunset reflection pool overlooking the sea at Coastal View Mandarmani',
    featured: true,
    order: 8,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-hotel-3',
    url: '/uploads/gallery/hotel-corridor.jpg',
    thumbUrl: '/uploads/gallery/hotel-corridor.jpg',
    category: 'Hotel',
    caption: 'Elegantly Appointed Suite Corridors with Ambient Lighting',
    alt: 'Clean hotel suite corridor with warm cove lighting and runner carpet at Coastal View',
    featured: false,
    order: 9,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-room-2',
    url: '/assets/images/room-pool-haven.jpg',
    thumbUrl: '/assets/images/room-pool-haven.jpg',
    category: 'Rooms',
    caption: 'The Pool Haven Room Direct Poolside Terrace',
    alt: 'The Pool Haven Room with direct pool access and sun loungers',
    featured: false,
    order: 10,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-room-3',
    url: '/assets/images/room-palm-grove.jpg',
    thumbUrl: '/assets/images/room-palm-grove.jpg',
    category: 'Rooms',
    caption: 'The Palm Grove Family Suite with Sitting Lounge',
    alt: 'The Palm Grove Family Suite spacious luxury stay for families',
    featured: false,
    order: 11,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-room-4',
    url: '/assets/images/room-cosy-deluxe.jpg',
    thumbUrl: '/assets/images/room-cosy-deluxe.jpg',
    category: 'Rooms',
    caption: 'Cosy Deluxe Room with Courtyard Garden Views',
    alt: 'Cosy Deluxe Room comfortable quiet stay in Mandarmani',
    featured: false,
    order: 12,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-places-1',
    url: '/assets/images/mandarmani-beach.jpg',
    thumbUrl: '/assets/images/mandarmani-beach.jpg',
    category: 'Places',
    caption: 'Mandarmani Endless Drivable Beach & Red Crab Colonies',
    alt: 'Mandarmani longest drivable beach in India with red crabs',
    featured: false,
    order: 13,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-places-2',
    url: '/assets/images/tajpur-beach.jpg',
    thumbUrl: '/assets/images/tajpur-beach.jpg',
    category: 'Places',
    caption: 'Pristine Tajpur Beach & Dense Casuarina Forest Trails',
    alt: 'Tajpur beach tranquil shores with casuarina pine trees',
    featured: false,
    order: 14,
    uploadedAt: new Date().toISOString()
  },
  {
    id: 'gallery-places-3',
    url: '/assets/images/seafood-market.jpg',
    thumbUrl: '/assets/images/seafood-market.jpg',
    category: 'Places',
    caption: 'Mandarmani Mohona Fishermen Market & Fresh Daily Catches',
    alt: 'Fresh fish market at Mandarmani estuary mohona',
    featured: false,
    order: 15,
    uploadedAt: new Date().toISOString()
  }
];

// Mark featured dishes
const featuredTargetIds = {
  'dish-sf-9': { price: 420, image: '/uploads/menu/dish_ilish_bhapa_1792138246600.jpg', badges: ["Chef's Special"] },
  'dish-sf-8': { price: 380, image: '/uploads/menu/dish_chingri_malaikari_1792138359063.jpg', badges: ["Chef's Special"] },
  'dish-rb-10': { price: 290, image: '/uploads/menu/dish_biryani_1792300439453.jpg', badges: ["Kolkata Dum"] },
  'dish-rb-11': { price: 360, image: '/uploads/menu/dish_biryani_1792300439453.jpg', badges: ["Royal Special"] },
  'dish-sf-1': { price: 220, image: '/uploads/menu/dish_fish_fry_1792300461754.jpg', badges: ["Crispy Bhetki"] },
  'dish-sf-10': { price: 580, image: '/uploads/menu/dish_fish_fry_1792300461754.jpg', badges: ["Grand Platter"] },
  'dish-st-9': { price: 260, badges: ["Indo-Chinese"] },
  'dish-vc-1': { price: 240, badges: ["North Indian Special"] },
  'dish-ds-3': { price: 180, badges: ["Slow Cooked"] },
  'dish-dsrt-3': { price: 70, badges: ["Hot Dessert"] }
};

db.restaurant.forEach(dish => {
  if (featuredTargetIds[dish.id]) {
    dish.featured = true;
    dish.isFeatured = true;
    const upd = featuredTargetIds[dish.id];
    if (upd.price && !dish.price) dish.price = upd.price;
    if (upd.image && !dish.image) dish.image = upd.image;
    if (upd.badges && (!dish.badges || !dish.badges.length)) dish.badges = upd.badges;
  } else {
    dish.featured = false;
    dish.isFeatured = false;
  }
});

fs.writeFileSync('data/db.json', JSON.stringify(db, null, 2), 'utf8');
console.log('Database updated successfully with gallery items and featured dishes!');

const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// 8 Official Categories matching prompt
const menuCategories = [
  {
    id: 'Breakfast',
    name: 'Breakfast',
    timing: '7:00 AM to 10:30 AM',
    icon: 'wb_sunny',
    order: 1
  },
  {
    id: 'Vegetable / Dal',
    name: 'Vegetable / Dal',
    timing: '',
    icon: 'eco',
    order: 2
  },
  {
    id: 'Rice / Roti / Chowmin',
    name: 'Rice / Roti / Chowmin',
    timing: '',
    icon: 'rice_bowl',
    order: 3
  },
  {
    id: 'Non Veg',
    name: 'Non Veg',
    timing: '',
    icon: 'set_meal',
    order: 4
  },
  {
    id: 'Snacks (Veg./Non Veg.)',
    name: 'Snacks (Veg./Non Veg.)',
    timing: '',
    icon: 'tapas',
    order: 5
  },
  {
    id: 'Mocktail',
    name: 'Mocktail',
    timing: '',
    icon: 'local_bar',
    order: 6
  },
  {
    id: 'Salad & Raita / Papad',
    name: 'Salad & Raita / Papad',
    timing: '',
    icon: 'dinner_dining',
    order: 7
  },
  {
    id: 'Thali',
    name: 'Thali',
    timing: '',
    icon: 'lunch_dining',
    order: 8
  }
];

const newRestaurantItems = [
  // ==========================================
  // 1. Breakfast (7:00 AM to 10:30 AM)
  // ==========================================
  {
    id: 'dish-bf-1',
    name: 'Tea',
    category: 'Breakfast',
    portion: '',
    price: 30,
    isVeg: true,
    description: 'Freshly brewed hot milk tea infused with cardamom and aromatic ginger.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-2',
    name: 'Black Tea',
    category: 'Breakfast',
    portion: '',
    price: 25,
    isVeg: true,
    description: 'Invigorating pure black Assam tea brewed hot with lemon slice.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-3',
    name: 'Coffee',
    category: 'Breakfast',
    portion: '',
    price: 70,
    isVeg: true,
    description: 'Aromatic steamed milk coffee whipped with rich frothy crema.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-4',
    name: 'Black Coffee',
    category: 'Breakfast',
    portion: '',
    price: 50,
    isVeg: true,
    description: 'Bold and fragrant roasted black coffee served piping hot.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-5',
    name: 'Green Tea',
    category: 'Breakfast',
    portion: '',
    price: 60,
    isVeg: true,
    description: 'Soothing organic green tea rich in antioxidants and refreshing aroma.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-6',
    name: 'Puri Sabji (4 pcs.)',
    category: 'Breakfast',
    portion: '4 pcs.',
    price: 70,
    isVeg: true,
    description: 'Golden puffed wheat puris served with spiced potato and chickpea sabji.',
    badges: ["Chef's Special"],
    available: true,
    featured: false,
    image: '/uploads/menu/dish-dish-bf-1-1792126783356.png',
    thumbImage: '/uploads/menu/dish-dish-bf-1-1792126783356.png'
  },
  {
    id: 'dish-bf-7',
    name: 'Extra Puri',
    category: 'Breakfast',
    portion: '1 pc.',
    price: 20,
    isVeg: true,
    description: 'Extra golden puffed puri fried fresh to order.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-8',
    name: 'Jam/Butter Toast (4 pc.)',
    category: 'Breakfast',
    portion: '4 pc.',
    price: 60,
    isVeg: true,
    description: 'Crispy toasted bread slices served with Amul butter and mixed fruit jam.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-9',
    name: 'Aloo Paratha (2 pc.) with dahi & aachar',
    category: 'Breakfast',
    portion: '2 pc.',
    price: 150,
    isVeg: true,
    description: 'Griddle-cooked whole wheat flatbreads stuffed with spiced mashed potatoes, served with fresh curd and spicy mango pickle.',
    badges: ["Popular"],
    available: true,
    featured: false,
    image: '/uploads/menu/dish-dish-bf-1-1792126783356.png',
    thumbImage: '/uploads/menu/dish-dish-bf-1-1792126783356.png'
  },
  {
    id: 'dish-bf-10',
    name: 'Sandwich (Veg./Chicken/Egg)',
    category: 'Breakfast',
    portion: '',
    price: 80,
    isVeg: true,
    variants: [
      { label: 'Veg', price: 80 },
      { label: 'Chicken', price: 100 },
      { label: 'Egg', price: 120 }
    ],
    description: 'Fresh toasted triangle sandwiches with seasoned vegetable, chicken, or egg filling.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-11',
    name: 'Egg Boiled (2 pc.)',
    category: 'Breakfast',
    portion: '2 pc.',
    price: 50,
    isVeg: false,
    description: 'Two farm-fresh eggs boiled to perfection served with black pepper and salt.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-12',
    name: 'Omelet (2 pc.)',
    category: 'Breakfast',
    portion: '2 pc.',
    price: 60,
    isVeg: false,
    description: 'Fluffy two-egg omelet whipped with onions, green chillies, and fresh coriander.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-13',
    name: 'Egg Poach (2 pc.)',
    category: 'Breakfast',
    portion: '2 pc.',
    price: 50,
    isVeg: false,
    description: 'Two delicate pan-poached eggs with soft sunny yolks seasoned with crushed pepper.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-14',
    name: 'Egg Bhujia (2 pc.)',
    category: 'Breakfast',
    portion: '2 pc.',
    price: 80,
    isVeg: false,
    description: 'Bengali style spicy egg scramble sautéed with chopped onions, tomatoes, and green chillies.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-bf-15',
    name: 'Maggie (Veg./Egg/Chicken)',
    category: 'Breakfast',
    portion: '',
    price: 70,
    isVeg: true,
    variants: [
      { label: 'Veg', price: 70 },
      { label: 'Egg', price: 90 },
      { label: 'Chicken', price: 110 }
    ],
    description: 'Beloved classic hot masala noodles tossed with vegetable, egg, or chicken morsels.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 2. Vegetable / Dal
  // ==========================================
  {
    id: 'dish-vd-1',
    name: 'Aloo Bhaja',
    category: 'Vegetable / Dal',
    portion: '',
    price: 60,
    isVeg: true,
    description: 'Crispy julienned potatoes fried golden in pure mustard oil, authentic Bengal style.',
    badges: ["Authentic"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-2',
    name: 'Plain Dal',
    category: 'Vegetable / Dal',
    portion: '',
    price: 60,
    isVeg: true,
    description: 'Comforting home-style yellow lentil dal tempered with cumin, bay leaves, and ghee.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-3',
    name: 'Dal Fry',
    category: 'Vegetable / Dal',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Creamy yellow lentils tempered with caramelized onions, tomatoes, garlic, and cumin tadka.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-4',
    name: 'Begun Fry (2 pc.)',
    category: 'Vegetable / Dal',
    portion: '2 pc.',
    price: 40,
    isVeg: true,
    description: 'Thick aubergine slices marinated in turmeric and sea salt, pan-fried crisp.',
    badges: ["Bengal Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-5',
    name: 'Aloo Posto',
    category: 'Vegetable / Dal',
    portion: '',
    price: 160,
    isVeg: true,
    description: 'Quintessential Bengali delicacy: tender potato cubes cooked in rich fragrant white poppy seed paste with green chillies and mustard oil.',
    badges: ["Chef's Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-6',
    name: 'Aloo Dom',
    category: 'Vegetable / Dal',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Baby potatoes slow-cooked in a spiced tomato-ginger gravy with Bengali garam masala.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-7',
    name: 'Aloo Matar Paneer',
    category: 'Vegetable / Dal',
    portion: '',
    price: 180,
    isVeg: true,
    description: 'Fresh cottage cheese cubes, sweet green peas, and potatoes simmered in a mildly spiced onion-tomato gravy.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-8',
    name: 'Mix Veg.',
    category: 'Vegetable / Dal',
    portion: '',
    price: 190,
    isVeg: true,
    description: 'Garden fresh seasonal vegetables sautéed with aromatic cumin, coriander, and mild herbs.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-9',
    name: 'Aloo Choka',
    category: 'Vegetable / Dal',
    portion: '',
    price: 40,
    isVeg: true,
    description: 'Rustic homestyle mashed potatoes whipped with roasted red chillies, chopped onions, and mustard oil.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-10',
    name: 'Aloo Gobi',
    category: 'Vegetable / Dal',
    portion: '',
    price: 150,
    isVeg: true,
    description: 'Cauliflower florets and potatoes braised with cumin, ginger, and fresh green coriander.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-11',
    name: 'Vindi Masala',
    category: 'Vegetable / Dal',
    portion: '',
    price: 150,
    isVeg: true,
    description: 'Fresh tender okra pan-roasted with sliced onions, dry mango powder, and roasted cumin.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-12',
    name: 'Paneer (Butter Masala/Dopiyaja/Chilli)',
    category: 'Vegetable / Dal',
    portion: '',
    price: 250,
    isVeg: true,
    variants: [
      { label: 'Butter Masala', price: 250 },
      { label: 'Dopiyaja', price: 250 },
      { label: 'Chilli', price: 250 }
    ],
    description: 'Soft cottage cheese prepared your way: creamy buttery makhani gravy, savory onion dopiyaja, or zesty Indo-Chinese chilli.',
    badges: ["Chef's Special"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-vd-13',
    name: 'Chana Masala',
    category: 'Vegetable / Dal',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Whole chickpeas simmered in a spiced tangy tomato-onion gravy with kasuri methi.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 3. Rice / Roti / Chowmin
  // ==========================================
  {
    id: 'dish-rrc-1',
    name: 'Rice (Plain)',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 70,
    isVeg: true,
    description: 'Steamed long-grain aromatic rice.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-2',
    name: 'Jeera Rice',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 100,
    isVeg: true,
    description: 'Fluffy basmati rice tempered with ghee-roasted cumin seeds and whole fragrant spices.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-3',
    name: 'Veg. Fried Rice',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Wok-tossed basmati rice with finely diced carrots, beans, bell peppers, and white pepper.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-4',
    name: 'Egg Fried Rice',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 140,
    isVeg: false,
    description: 'Fragrant wok-fried rice tossed with golden scrambled eggs, spring onions, and soya.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-5',
    name: 'Chicken Fried Rice',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 150,
    isVeg: false,
    description: 'Wok-tossed basmati rice with tender shredded chicken, egg ribbons, and crisp veggies.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-6',
    name: 'Mix Fried Rice',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 200,
    isVeg: false,
    description: 'Special wok-fried rice generously loaded with chicken, coastal prawns, egg, and vegetables.',
    badges: ["Chef's Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-7',
    name: 'Roti (Tawa)',
    category: 'Rice / Roti / Chowmin',
    portion: '1 pc.',
    price: 10,
    isVeg: true,
    description: 'Fresh whole wheat Indian flatbread puffed hot on the tawa.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-8',
    name: 'Butter Roti',
    category: 'Rice / Roti / Chowmin',
    portion: '1 pc.',
    price: 20,
    isVeg: true,
    description: 'Tawa-puffed whole wheat flatbread brushed with pure golden butter.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-9',
    name: 'Chowmin (Veg./Egg/Chicken)',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 100,
    isVeg: true,
    variants: [
      { label: 'Veg', price: 100 },
      { label: 'Egg', price: 120 },
      { label: 'Chicken', price: 150 }
    ],
    description: 'Kolkata-style stir-fried chowmin noodles tossed with crisp shredded vegetables and dark soy.',
    badges: ["Indo-Chinese"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-10',
    name: 'Mix Chowmin',
    category: 'Rice / Roti / Chowmin',
    portion: '',
    price: 200,
    isVeg: false,
    description: 'Deluxe wok-tossed chowmin loaded with chicken shreds, coastal prawns, egg, and crunchy vegetables.',
    badges: ["Popular"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-rrc-11',
    name: 'Chicken Biriyani (2 pc. Chicken, Aloo, Egg, Raita)',
    category: 'Rice / Roti / Chowmin',
    portion: '2 pc. Chicken, Aloo, Egg, Raita',
    price: 250,
    isVeg: false,
    description: 'Kolkata royal dum biryani with 2 juicy chicken pieces, spiced melt-in-mouth potato, farm egg, and cool raita.',
    badges: ["Best Seller", "Kolkata Dum"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: '/uploads/menu/dish_biryani_1792300439453.jpg',
    thumbImage: '/uploads/menu/dish_biryani_1792300439453.jpg'
  },

  // ==========================================
  // 4. Non Veg
  // ==========================================
  {
    id: 'dish-nv-1',
    name: 'Pomfret (Sorsa/Curry/Masala), 1 pc.',
    category: 'Non Veg',
    portion: '1 pc.',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Sorsa', price: 250 },
      { label: 'Curry', price: 250 },
      { label: 'Masala', price: 250 }
    ],
    description: 'Fresh coastal silver pomfret cooked to your preference in Bengali mustard gravy, home curry, or spicy masala.',
    badges: ["Coastal Fresh"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-2',
    name: 'Parshe (Sorsa/Curry/Masala), 1 pc.',
    category: 'Non Veg',
    portion: '1 pc.',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Sorsa', price: 250 },
      { label: 'Curry', price: 250 },
      { label: 'Masala', price: 250 }
    ],
    description: 'Sweet coastal Parshe fish simmered in traditional pungent mustard gravy or aromatic Bengali fish broth.',
    badges: ["Daily Catch"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-3',
    name: 'Hilsa (Sorsa/Vapa), 1 pc.',
    category: 'Non Veg',
    portion: '1 pc.',
    price: 320,
    isVeg: false,
    variants: [
      { label: 'Sorsa', price: 320 },
      { label: 'Vapa', price: 320 }
    ],
    description: 'The pride of Bengal: prime Hilsa steamed with freshly ground mustard and green chillies (Bhapa) or cooked in traditional Shorshe jhol.',
    badges: ["Chef's Special", "Royal Delicacy"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: '/uploads/menu/dish_ilish_bhapa_1792138246600.jpg',
    thumbImage: '/uploads/menu/dish_ilish_bhapa_1792138246600.jpg'
  },
  {
    id: 'dish-nv-4',
    name: 'Prawn (Curry/Masala/Sorsa Vapa), 2 pc.',
    category: 'Non Veg',
    portion: '2 pc.',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Curry', price: 250 },
      { label: 'Masala', price: 250 },
      { label: 'Sorsa Vapa', price: 250 }
    ],
    description: 'Two jumbo Bay of Bengal coastal prawns simmered in rich coconut malai curry, thick onion masala, or steamed in mustard paste.',
    badges: ["Chef's Special"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: '/uploads/menu/dish_chingri_malaikari_1792138359063.jpg',
    thumbImage: '/uploads/menu/dish_chingri_malaikari_1792138359063.jpg'
  },
  {
    id: 'dish-nv-5',
    name: 'Crab Masala (2 pc.)',
    category: 'Non Veg',
    portion: '2 pc.',
    price: 400,
    isVeg: false,
    description: 'Two fresh whole hard-shell Mandarmani crabs cooked in a fiery rich gravy of caramelized onions, ginger, garlic, and coastal spices.',
    badges: ["Local Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-6',
    name: 'Katla Curry (2 pc.)',
    category: 'Non Veg',
    portion: '2 pc.',
    price: 250,
    isVeg: false,
    description: 'Two large tender Katla fish cutlets simmered in light Bengali cumin, ginger, and green chilli gravy.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-7',
    name: 'Dahi Katla (2 pc.)',
    category: 'Non Veg',
    portion: '2 pc.',
    price: 300,
    isVeg: false,
    description: 'Two Katla fish steaks braised in a luxurious sweet and sour yogurt gravy scented with whole spices and raisins.',
    badges: ["Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-8',
    name: 'Dub Chingri',
    category: 'Non Veg',
    portion: '',
    price: 420,
    isVeg: false,
    description: 'Iconic Bengali coastal feast: jumbo prawns baked inside a tender green coconut shell with creamy coconut pulp and mustard spices.',
    badges: ["Chef's Special", "Signature Dish"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-9',
    name: 'Bhetki (Curry/Sorsa)',
    category: 'Non Veg',
    portion: '',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Curry', price: 250 },
      { label: 'Sorsa', price: 250 }
    ],
    description: 'Boneless tender fresh coastal Bhetki fish fillet prepared in fragrant mustard gravy or homestyle Bengali curry.',
    badges: ["Tender Fillet"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-10',
    name: 'Chicken (Curry/Masala/Kadai Dopiyaji), 4 pc.',
    category: 'Non Veg',
    portion: '4 pc.',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Curry', price: 250 },
      { label: 'Masala', price: 280 },
      { label: 'Kadai Dopiyaji', price: 300 }
    ],
    description: 'Four chicken cuts slow-simmered in your choice of light Bengali homestyle gravy, spicy masala, or thick kadai dopiyaji.',
    badges: ["Popular"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-11',
    name: 'Mutton (Curry Kasa), 4 pc.',
    category: 'Non Veg',
    portion: '4 pc.',
    price: 420,
    isVeg: false,
    variants: [
      { label: 'Curry', price: 420 },
      { label: 'Kasa', price: 420 }
    ],
    description: 'Four pieces of tender baby goat mutton slow-cooked in rich dark caramelized gravy with cloves, cardamom, and ghee.',
    badges: ["Chef's Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-12',
    name: 'Chicken Chilly/Manchurian/Garlic',
    category: 'Non Veg',
    portion: '',
    price: 200,
    isVeg: false,
    variants: [
      { label: 'Chilly', price: 200 },
      { label: 'Manchurian', price: 200 },
      { label: 'Garlic', price: 200 }
    ],
    description: 'Boneless tender chicken cubes stir-fried with bell peppers in zesty Indo-Chinese sauces.',
    badges: ["Spicy"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-nv-13',
    name: 'Chicken Bharta',
    category: 'Non Veg',
    portion: '',
    price: 220,
    isVeg: false,
    description: 'Kolkata dhaba style shredded chicken cooked in a rich, creamy egg-drop gravy with roasted kasuri methi.',
    badges: ["Kolkata Dhaba Style"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 5. Snacks (Veg./Non Veg.)
  // ==========================================
  {
    id: 'dish-sn-1',
    name: 'Veg. Pakora (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 150,
    isVeg: true,
    description: 'Crispy assorted vegetable fritters fried in spiced gram flour batter.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-2',
    name: 'Onion Pakora (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 160,
    isVeg: true,
    description: 'Crunchy sliced onion fritters seasoned with ajwain seeds, green chillies, and rock salt.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-3',
    name: 'French Fry',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 150,
    isVeg: true,
    description: 'Golden crisp potato fries dusted with sea salt and subtle peri-peri seasoning.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-4',
    name: 'Paneer Pakora (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 200,
    isVeg: true,
    description: 'Eight melt-in-mouth cottage cheese batons stuffed with mint chutney and deep fried crisp.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-5',
    name: 'Chilly Manchurian (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 250,
    isVeg: true,
    description: 'Crisp vegetable dumplings wok-tossed in tangy garlic-soya Manchurian glaze.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-6',
    name: 'Peanut Salad',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Roasted crunchy peanuts tossed with diced onions, tomatoes, green chillies, and chatpata lemon dressing.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-7',
    name: 'Egg Pakora (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 140,
    isVeg: false,
    description: 'Eight boiled egg halves coated in spicy gram flour batter and fried golden crisp.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-8',
    name: 'Chicken Pakora (6 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '6 pc.',
    price: 210,
    isVeg: false,
    description: 'Six juicy boneless chicken morsels marinated in coastal spices and deep fried crunchy.',
    badges: ["Popular"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-9',
    name: 'Dry Chilly Chicken (6 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '6 pc.',
    price: 230,
    isVeg: false,
    description: 'Six crispy chicken chunks wok-tossed dry with green chillies, spring onions, and garlic soy.',
    badges: ["Spicy"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-10',
    name: 'Crispy Chicken',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 280,
    isVeg: false,
    description: 'Shredded chicken fried extra crisp and glazed in sweet and spicy sauce with toasted sesame.',
    badges: ["Chef's Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-11',
    name: 'Amudi Fish Fry',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 180,
    isVeg: false,
    description: 'Crispy whole small coastal Amudi fish seasoned with salt, turmeric, and fried crunchy.',
    badges: ["Coastal Snack"],
    available: true,
    featured: false,
    image: '/uploads/menu/dish_fish_fry_1792300461754.jpg',
    thumbImage: '/uploads/menu/dish_fish_fry_1792300461754.jpg'
  },
  {
    id: 'dish-sn-12',
    name: 'Vola Fish Fry (2 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '2 pc.',
    price: 250,
    isVeg: false,
    variants: [
      { label: 'Regular', price: 250 },
      { label: 'Special', price: 300 }
    ],
    description: 'Fresh Bay of Bengal Vola fish cutlets coated in seasoned crumbs and pan-fried golden crisp.',
    badges: ["Fresh Catch"],
    available: true,
    featured: false,
    image: '/uploads/menu/dish_fish_fry_1792300461754.jpg',
    thumbImage: '/uploads/menu/dish_fish_fry_1792300461754.jpg'
  },
  {
    id: 'dish-sn-13',
    name: 'Pomfret Masala (2 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '2 pc.',
    price: 550,
    isVeg: false,
    description: 'Two whole pomfret fishes coated in fiery coastal masala and shallow-fried crisp.',
    badges: ["Grand Platter"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-14',
    name: 'Salted Kaju',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 250,
    isVeg: true,
    description: 'Premium whole cashews roasted in pure ghee and lightly dusted with rock salt.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-15',
    name: 'Chicken Tandoori (Full)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: 'Full',
    price: 800,
    isVeg: false,
    description: 'Full whole chicken marinated in yogurt, Kashmiri red chilli, and aromatic tandoori masala chargrilled in the clay oven.',
    badges: ["Tandoori Special", "Chef's Special"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-16',
    name: 'Chicken Tikka (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 300,
    isVeg: false,
    description: 'Eight boneless tender chicken morsels skewered and chargrilled with bell peppers and onions.',
    badges: ["Tandoori"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-17',
    name: 'Chicken Oil Fry (16 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '16 pc.',
    price: 300,
    isVeg: false,
    description: 'Sixteen small crunchy bite-sized bone-in chicken pieces deep-fried with garlic and aromatic coastal spices.',
    badges: ["Crispy"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-sn-18',
    name: 'Fish Finger (8 pc.)',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '8 pc.',
    price: 300,
    isVeg: false,
    description: 'Eight tender Bhetki fish fingers coated in seasoned breadcrumbs, served crisp with pungent Kasundi mustard dip.',
    badges: ["Popular"],
    available: true,
    featured: false,
    image: '/uploads/menu/dish_fish_fry_1792300461754.jpg',
    thumbImage: '/uploads/menu/dish_fish_fry_1792300461754.jpg'
  },
  {
    id: 'dish-sn-19',
    name: 'Baby Corn / Mushroom Chilly',
    category: 'Snacks (Veg./Non Veg.)',
    portion: '',
    price: 220,
    isVeg: true,
    variants: [
      { label: 'Baby Corn Chilly', price: 220 },
      { label: 'Mushroom Chilly', price: 280 }
    ],
    description: 'Crisp baby corn or fresh button mushrooms wok-tossed with capsicum and spring onions in spicy Indo-Chinese sauce.',
    badges: ["Indo-Chinese"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 6. Mocktail
  // ==========================================
  {
    id: 'dish-mk-1',
    name: 'Fresh Lime Soda',
    category: 'Mocktail',
    portion: '',
    price: 60,
    isVeg: true,
    description: 'Freshly squeezed coastal key limes topped with chilled club soda (Sweet / Salted / Mixed).',
    badges: ["Refreshing"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-2',
    name: 'Masala Cold Drinks',
    category: 'Mocktail',
    portion: '',
    price: 80,
    isVeg: true,
    description: 'Chilled soda spiked with roasted cumin, rock salt, chaat masala, and mint.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-3',
    name: 'Blue Lagoon',
    category: 'Mocktail',
    portion: '',
    price: 150,
    isVeg: true,
    description: 'Vibrant azure mocktail blending citrus blue curacao flavor, sparkling lemonade, and crushed ice.',
    badges: ["Signature Drink"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-4',
    name: 'Green Apple Freshness',
    category: 'Mocktail',
    portion: '',
    price: 150,
    isVeg: true,
    description: 'Tart and crisp green apple puree muddled with fresh garden mint and sparkling soda.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-5',
    name: 'Orange Pool',
    category: 'Mocktail',
    portion: '',
    price: 130,
    isVeg: true,
    description: 'Zesty orange citrus splashed with sweet grenadine and effervescent bubbles.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-6',
    name: 'Mango Masti',
    category: 'Mocktail',
    portion: '',
    price: 120,
    isVeg: true,
    description: 'Luscious tropical mango nectar blended with lemon juice and crushed ice.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-mk-7',
    name: 'Pineapple Swag',
    category: 'Mocktail',
    portion: '',
    price: 130,
    isVeg: true,
    description: 'Juicy tropical pineapple juice with a pinch of black salt and fresh mint sprig.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 7. Salad & Raita / Papad
  // ==========================================
  {
    id: 'dish-srp-1',
    name: 'Green Salad',
    category: 'Salad & Raita / Papad',
    portion: '',
    price: 80,
    isVeg: true,
    description: 'Crisp cucumber slices, ripe tomatoes, carrots, onions, and fresh lemon wedges.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-2',
    name: 'Mixed Salad',
    category: 'Salad & Raita / Papad',
    portion: '',
    price: 90,
    isVeg: true,
    description: 'Finely diced farm garden vegetables tossed with chaat masala, green chillies, and coriander.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-3',
    name: 'Plain Raita',
    category: 'Salad & Raita / Papad',
    portion: '',
    price: 80,
    isVeg: true,
    description: 'Chilled creamy yogurt seasoned with roasted cumin and pink rock salt.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-4',
    name: 'Papad Fry (2 pc.)',
    category: 'Salad & Raita / Papad',
    portion: '2 pc.',
    price: 25,
    isVeg: true,
    description: 'Two crispy deep-fried lentil papads.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-5',
    name: 'Roasted Papad (2 pc.)',
    category: 'Salad & Raita / Papad',
    portion: '2 pc.',
    price: 40,
    isVeg: true,
    description: 'Two fire-roasted crispy papads served with spice sprinkle.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-6',
    name: 'Masala Papad',
    category: 'Salad & Raita / Papad',
    portion: '',
    price: 40,
    isVeg: true,
    description: 'Crisp roasted papad topped with diced onions, tomatoes, green chillies, and tangy chaat masala.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-7',
    name: 'Chutney',
    category: 'Salad & Raita / Papad',
    portion: '',
    price: 60,
    isVeg: true,
    description: 'Authentic Bengali sweet and tangy tomato-date or plastic papaya chutney.',
    badges: ["Authentic"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-srp-8',
    name: 'Sweet (2 pc.)',
    category: 'Salad & Raita / Papad',
    portion: '2 pc.',
    price: 50,
    isVeg: true,
    description: 'Two authentic traditional Bengali sweets (spongy chenna rasgulla or warm gulab jamun).',
    badges: ["Dessert"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },

  // ==========================================
  // 8. Thali
  // ==========================================
  {
    id: 'dish-th-1',
    name: 'Veg. Thali',
    category: 'Thali',
    portion: '',
    price: 180,
    isVeg: true,
    description: 'Rice / Dal / Aloo Bhaja / 2 types of Sabji / Papad / Salad / Chutney',
    badges: ["Full Meal", "Popular"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-2',
    name: 'Ruhi Thali',
    category: 'Thali',
    portion: '1 pc. Ruhi fish',
    price: 220,
    isVeg: false,
    description: 'Rice / Dal / Aloo Bhaja / Sabji, chutney, papad, 1 pc. Ruhi fish',
    badges: ["Traditional"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-3',
    name: 'Katla Thali',
    category: 'Thali',
    portion: '',
    price: 250,
    isVeg: false,
    description: 'Steamed rice, dal, crispy aloo bhaja, seasonal sabji, papad, chutney, salad, and 1 pc. Katla fish curry.',
    badges: [],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-4',
    name: 'Chicken Thali (3 pc.)',
    category: 'Thali',
    portion: '3 pc.',
    price: 350,
    isVeg: false,
    description: 'Steamed rice, yellow dal, aloo bhaja, seasonal sabji, salad, papad, chutney, and 3 pcs. Tender chicken curry.',
    badges: ["Best Seller"],
    available: true,
    featured: true, // Featured dish on Home Page
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-5',
    name: 'Prawn / Pomfret / Vola Thali',
    category: 'Thali',
    portion: '',
    price: 400,
    isVeg: false,
    variants: [
      { label: 'Prawn Thali', price: 400 },
      { label: 'Pomfret Thali', price: 400 },
      { label: 'Vola Thali', price: 400 }
    ],
    description: 'Grand coastal feast with steamed rice, dal, aloo bhaja, seasonal sabji, papad, chutney, salad, and your choice of fresh Prawn, Pomfret, or Vola fish.',
    badges: ["Coastal Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-6',
    name: 'Parshey / Vetki Thali',
    category: 'Thali',
    portion: '',
    price: 450,
    isVeg: false,
    variants: [
      { label: 'Parshey Thali', price: 450 },
      { label: 'Vetki Thali', price: 450 }
    ],
    description: 'Deluxe Bengali seafood platter with fragrant rice, dal, aloo bhaja, sabji, chutney, papad, and fresh Parshey or Vetki fish.',
    badges: ["Royal Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  },
  {
    id: 'dish-th-7',
    name: 'Elish / Mutton Thali',
    category: 'Thali',
    portion: '',
    price: 550,
    isVeg: false,
    variants: [
      { label: 'Elish Thali', price: 550 },
      { label: 'Mutton Thali', price: 550 }
    ],
    description: 'The ultimate royal Bengal meal: fragrant steamed rice, dal, aloo bhaja, sabji, papad, chutney, salad, and choice of premium Ilish Mach Bhapa or tender Mutton Kasa.',
    badges: ["Royal Feast", "Chef's Special"],
    available: true,
    featured: false,
    image: null,
    thumbImage: null
  }
];

// Add order numbers
newRestaurantItems.forEach((item, index) => {
  item.order = index + 1;
  item.isFeatured = !!item.featured;
});

// Update database
db.restaurant = newRestaurantItems;
db.menuCategories = menuCategories;

// Update settings with the note and phone
db.settings = db.settings || {};
db.settings.menuNote = "Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.";
db.settings.menuPhone = "+91 7812027551";

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

console.log('Seeded successfully!');
console.log('Total categories:', menuCategories.length);
console.log('Total items in restaurant:', newRestaurantItems.length);
console.log('Featured items:', newRestaurantItems.filter(i => i.featured).map(i => `${i.name} (₹${i.price})`));

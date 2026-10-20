const fs = require('fs');

function updateChatbot() {
  const file = 'c:/mandarmaniproject/server.js';
  let code = fs.readFileSync(file, 'utf8');

  const startMarker = "app.post('/api/concierge/chat', (req, res) => {";
  const endMarker = "app.post('/api/concierge/callback', (req, res) => {";

  const startIdx = code.indexOf(startMarker);
  const endIdx = code.indexOf(endMarker, startIdx);

  if (startIdx === -1 || endIdx === -1) {
    console.error('Markers not found');
    process.exit(1);
  }

  const newHandler = `app.post('/api/concierge/chat', (req, res) => {
  const { message, lang = 'en' } = req.body;
  const db = readDB();
  const text = (message || '').trim().toLowerCase();

  let reply = '';
  let requiresCallbackForm = false;
  let actionChips = [];

  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);

  const isBengali = lang === 'bn' || /[\\u0980-\\u09FF]/.test(message);
  const isHindi = lang === 'hi' || /[\\u0900-\\u097F]/.test(message);

  // Helper to format room price text
  const formatRoomPrice = (r) => (r.price && !isNaN(r.price)) ? \`₹\${Number(r.price).toLocaleString('en-IN')}/night\` : 'Ask at hotel';

  // Helper to format room inclusions strictly from admin data
  const formatRoomInclusionsList = (r) => {
    if (r && Array.isArray(r.inclusions) && r.inclusions.length) {
      return r.inclusions.map(i => typeof i === 'string' ? i : i.text).join(', ');
    }
    return 'AC, Free Wi-Fi, Smart TV, Pool access, Housekeeping, Hot water';
  };

  const formatRoomExtrasList = (r) => {
    if (r && Array.isArray(r.extras) && r.extras.length) {
      return r.extras.map(e => typeof e === 'string' ? e : e.text).join(', ');
    }
    return 'Candlelight Dinner, Car / Toto / Auto pickup';
  };

  // Date parsing from message
  const parsedDate = parseDateFromMessage(text);
  const targetCheckIn = parsedDate ? parsedDate.checkIn : new Date().toISOString().split('T')[0];
  const tmrwDate = new Date(targetCheckIn);
  tmrwDate.setDate(tmrwDate.getDate() + 1);
  const targetCheckOut = parsedDate ? parsedDate.checkOut : tmrwDate.toISOString().split('T')[0];
  const dateLabel = parsedDate ? parsedDate.dateText : 'your stay dates';

  // Real-time quantity availability on target dates
  const roomsAvailMap = new Map();
  activeRooms.forEach(r => {
    roomsAvailMap.set(r.id, getRoomAvailability(db, r.id, targetCheckIn, targetCheckOut));
  });

  const availableRooms = activeRooms.filter(r => {
    const av = roomsAvailMap.get(r.id);
    return av && av.available > 0;
  });
  const soldOutRooms = activeRooms.filter(r => {
    const av = roomsAvailMap.get(r.id);
    return !av || av.available <= 0;
  });

  // Dish Matcher for restaurant items
  const dishes = db.restaurant || [];
  const findDishes = (query) => {
    const scored = [];
    for (const d of dishes) {
      const dName = d.name.toLowerCase();
      const cleanName = dName.replace(/\\(.*?\\)/g, '').replace(/,\\s*\\d+\\s*pcs?\\.?/g, '').trim();
      let score = 0;
      if (query.includes(dName)) score += 100;
      if (query.includes(cleanName)) score += 80;

      // Check variant labels
      if (d.variants && d.variants.length) {
        for (const v of d.variants) {
          if (query.includes(v.label.toLowerCase())) {
            score += 15;
            const mainWord = cleanName.split(/[\\s\\/]+/)[0];
            if (query.includes(mainWord)) score += 50;
          }
        }
      }

      const words = cleanName.split(/[\\s\\/,\\.]+/).filter(w => w.length > 2);
      let matchedWords = 0;
      for (const w of words) {
        if (query.includes(w)) matchedWords++;
      }
      if (matchedWords > 0) {
        score += matchedWords * 20;
        if (matchedWords === words.length) score += 30;
      }

      if (score > 0) {
        scored.push({ dish: d, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score >= 35).map(s => s.dish);
  };

  const matchedDishes = findDishes(text);

  // 1. Outside Food, Per-Kg Cooking Charges, Hookah & Drinks
  if (
    text.includes('outside food') || 
    (text.includes('outside') && (text.includes('food') || text.includes('allowed') || text.includes('bring') || text.includes('khabar'))) || 
    text.includes('per kg') || text.includes('per-kg') || text.includes('perkg') ||
    text.includes('cooking rate') || text.includes('cooking charge') ||
    text.includes('chicken per kg') || text.includes('mutton per kg') || text.includes('fish per kg') ||
    (text.includes('rate') && (text.includes('chicken') || text.includes('mutton') || text.includes('fish') || text.includes('kg'))) ||
    text.includes('hookah') || text.includes('বাইরের খাবার') || text.includes('হুক্কা')
  ) {
    reply = \`Official Policy & Custom Cooking Services at Coastal View Hotel & Restaurant, Mandarmani:\\n\\n• Fish & Chicken (per kg): ₹300/kg\\n• Mutton: ₹350/kg\\n• Outside food is strictly not allowed on hotel premises.\\n• Drinks & hookah are available at our restaurant.\\n\\nFor kitchen cooking requests or table reservations, please call +91 7812027551.\`;
    actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

  // 2. Thali Options & Rates
  } else if (text.includes('thali') || text.includes('থালা') || text.includes('थाली')) {
    const thalis = dishes.filter(d => d.category === 'Thali');
    const thaliList = thalis.map(d => {
      let p = \`₹\${d.price}\`;
      if (d.variants && d.variants.length) {
        p = d.variants.map(v => \`\${v.label} ₹\${v.price}\`).join(' | ');
      }
      return \`• \${d.name}\${d.portion ? \` (\${d.portion})\` : ''}: \${p}\`;
    }).join('\\n');
    reply = \`Authentic Bengali Thalis served at Coastal View Hotel & Restaurant:\\n\\n\${thaliList}\\n\\nAll thalis include steamed rice, yellow dal, aloo bhaja, seasonal sabji, papad, salad, and chutney.\\nFor table reservations or room delivery, call +91 7812027551.\`;
    actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

  // 3. Breakfast Timings & Specialties
  } else if (text.includes('breakfast') && (text.includes('time') || text.includes('timing') || text.includes('when') || text.includes('hour') || text.includes('schedule') || text.includes('সময়') || text.includes('টাইম') || text.includes('कब'))) {
    if (isBengali) {
      reply = \`কোস্টাল ভিউ হোটেল ও রেস্তোরাঁয় ব্রেকফাস্টের সময়সূচি প্রতিদিন সকাল ৭:০০ টা থেকে সকাল ১০:৩০ টা (7:00 AM to 10:30 AM)।\\n\\nমেনু ও মূল্য:\\n• পুরী সবজি (৪ পিস) ₹৭০ | অতিরিক্ত পুরী ₹২০\\n• আলু পরোটা (২ পিস) দই ও আচার সহ ₹১৫০\\n• স্যান্ডউইচ (ভেজ ₹৮০ | চিকেন ₹১০০ | ডিম ₹১২০)\\n• ম্যাগি (ভেজ ₹৭০ | ডিম ₹৯০ | চিকেন ₹১১০)\\n• জ্যাম/বাটার টোস্ট (৪ পিস) ₹৬০\\n• সেদ্ধ ডিম (২ পিস) ₹৫০ | ওমলেট (২ পিস) ₹৬০ | ডিম পোচ (২ পিস) ₹৫০ | ডিম ভুজিয়া (২ পিস) ₹৮০\\n• চা ₹৩০ | ব্ল্যাক টি ₹২৫ | কফি ₹৭০ | ব্ল্যাক কফি ₹৫০ | গ্রিন টি ₹৬০\\n\\nযোগাযোগ ও রুম সার্ভিস: +91 7812027551।\`;
    } else if (isHindi) {
      reply = \`कोस्टल व्यू होटल एंड रेस्टोरेंट में नाश्ते (Breakfast) का समय प्रतिदिन सुबह 7:00 AM से 10:30 AM तक है।\\n\\nनाश्ता मेनू और दरें:\\n• पूरी सब्जी (4 pcs.) ₹70 | एक्स्ट्रा पूरी ₹20\\n• आलू पराठा (2 pc.) दही और अचार के साथ ₹150\\n• सैंडविच (वेज ₹80 | चिकन ₹100 | अंडा ₹120)\\n• मैगी (वेज ₹70 | अंडा ₹90 | चिकन ₹110)\\n• जैम/बटर टोस्ट (4 pc.) ₹60\\n• उबला अंडा (2 pc.) ₹50 | ऑमलेट (2 pc.) ₹60 | एग पोच (2 pc.) ₹50 | एग भुजिया (2 pc.) ₹80\\n• चाय ₹30 | ब्लैक टी ₹25 | कॉफी ₹70 | ब्लैक कॉफी ₹50 | ग्रीन टी ₹60\\n\\nटेबल बुकिंग या रूम सर्विस के लिए कॉल करें: +91 7812027551।\`;
    } else {
      reply = \`Breakfast Timings at Coastal View Hotel & Restaurant, Mandarmani:\\n\\n⏰ Timing: 7:00 AM to 10:30 AM (Daily)\\n\\nMorning Specialties from our printed menu:\\n• Puri Sabji (4 pcs.) ₹70 | Extra Puri ₹20\\n• Aloo Paratha (2 pc.) with dahi & aachar ₹150\\n• Sandwich (Veg ₹80 | Chicken ₹100 | Egg ₹120)\\n• Maggie (Veg ₹70 | Egg ₹90 | Chicken ₹110)\\n• Jam/Butter Toast (4 pc.) ₹60\\n• Egg Boiled (2 pc.) ₹50 | Omelet (2 pc.) ₹60 | Egg Poach (2 pc.) ₹50 | Egg Bhujia (2 pc.) ₹80\\n• Hot Beverages: Tea ₹30 | Black Tea ₹25 | Coffee ₹70 | Black Coffee ₹50 | Green Tea ₹60\\n\\nManaged by Ani's Tour and Travels. For room service or table reservation, call +91 7812027551.\`;
    }
    actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

  // 4. Specific Dishes or Food / Menu Query
  } else if (
    matchedDishes.length > 0 || 
    text.includes('menu') || text.includes('dish') || text.includes('food') || 
    text.includes('restaurant') || text.includes('dining') || text.includes('mocktail') ||
    text.includes('khabar') || text.includes('খাবার') || text.includes('মেনু') ||
    text.includes('seafood') || text.includes('fish') || text.includes('মছলি')
  ) {
    if (matchedDishes.length > 0) {
      const lines = matchedDishes.slice(0, 5).map(d => {
        let specificVariant = null;
        if (d.variants && d.variants.length) {
          specificVariant = d.variants.find(v => {
            const lbl = v.label.toLowerCase();
            return text.includes(lbl) || (lbl === 'veg' && text.includes('veg.')) || (lbl === 'egg' && text.includes('anda'));
          });
        }

        let priceStr = '';
        if (specificVariant) {
          priceStr = \`\${specificVariant.label}: ₹\${specificVariant.price}\`;
          const allVarStr = d.variants.map(v => \`\${v.label} ₹\${v.price}\`).join(' | ');
          priceStr += \` (All options: \${allVarStr})\`;
        } else if (d.variants && d.variants.length) {
          priceStr = d.variants.map(v => \`\${v.label} ₹\${v.price}\`).join(' | ');
        } else {
          priceStr = \`₹\${d.price}\`;
        }

        const dietStr = d.isVeg ? '🌱 Pure Veg' : '🍗 Non-Veg';
        const portionStr = d.portion ? \` [\${d.portion}]\` : '';
        return \`• \${d.name}\${portionStr}: \${priceStr} | \${dietStr}\`;
      });

      reply = \`Yes! Coastal View Hotel & Restaurant serves:\\n\\n\${lines.join('\\n')}\\n\\nGuidelines: Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.\\nManaged by Ani's Tour and Travels. For room service or table reservation, call +91 7812027551.\`;
      actionChips = ['View Full Menu', 'Breakfast Timings', 'Reserve Table'];

    } else if (text.includes('seafood') || text.includes('fish') || text.includes('মাছ') || text.includes('मछली')) {
      const seafoodItems = dishes.filter(d => d.category === 'Non Veg' && (d.name.includes('Fish') || d.name.includes('Hilsa') || d.name.includes('Pomfret') || d.name.includes('Parshe') || d.name.includes('Prawn') || d.name.includes('Crab') || d.name.includes('Katla') || d.name.includes('Chingri') || d.name.includes('Bhetki'))).map(d => \`\${d.name} (₹\${d.price})\`).join(', ');
      reply = \`Fresh Coastal Catches at Coastal View:\\n\\n\${seafoodItems}\\n\\nPrepared in royal Bengali (Bhapa / Shorshe / Kalia) and coastal masala styles. Call +91 7812027551 for table reservations.\`;
      actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

    } else if (text.includes('veg') || text.includes('vegetarian') || text.includes('নিরামিষ') || text.includes('शाकाहारी')) {
      reply = \`Pure Vegetarian Delicacies at Coastal View:\\n\\n• Vegetable & Dal: Aloo Posto (₹160), Paneer (Butter Masala/Dopiyaja/Chilli ₹250), Dal Fry (₹120), Mix Veg (₹190), Aloo Dom (₹120), Begun Fry (₹40), Aloo Matar Paneer (₹180), Chana Masala (₹120)\\n• Thali: Veg. Thali (₹180)\\n• Snacks: Paneer Pakora (8 pc. ₹200), Veg Pakora (₹150), Chilly Manchurian (₹250), French Fry (₹150)\\n• Breakfast: Aloo Paratha (₹150), Puri Sabji (₹70), Veg Sandwich (₹80), Veg Maggie (₹70)\\n\\nPrepared with separate vegetarian cookware. Call +91 7812027551.\`;
      actionChips = ['View Full Menu', 'Breakfast Menu', 'Book Room'];

    } else {
      reply = \`Welcome to Coastal View Hotel & Restaurant, Mandarmani!\\n\\nOur official printed menu features all items across 8 categories:\\n1. Breakfast (7:00 AM to 10:30 AM)\\n2. Vegetable / Dal\\n3. Rice / Roti / Chowmin\\n4. Non Veg\\n5. Snacks (Veg./Non Veg.)\\n6. Mocktail\\n7. Salad & Raita / Papad\\n8. Thali\\n\\nSpecial Cooking: Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.\\n\\nManaged by Ani's Tour and Travels (Tel: +91 7812027551). What dish or category would you like to check?\`;
      actionChips = ['Breakfast Timings', 'Thali Menu', 'Call +91 7812027551'];
    }

  // 5. Room Inclusions & Facilities
  } else if (
    text.includes('inclusion') || 
    text.includes('inclusions') || 
    text.includes('what is included') || 
    text.includes("what's included") || 
    text.includes('included in') || 
    text.includes('included with') || 
    (text.includes('include') && (text.includes('room') || text.includes('stay') || text.includes('package') || text.includes('hotel'))) ||
    text.includes('complimentary') || 
    text.includes('free wifi') ||
    text.includes('facilities included') ||
    text.includes('amenities included') ||
    text.includes('অন্তর্ভুক্ত') || 
    text.includes('কী অন্তর্ভুক্ত') ||
    text.includes('কী কী অন্তর্ভুক্ত') ||
    text.includes('शामिल') || 
    text.includes('क्या शामिल है') ||
    text.includes('क्या क्या शामिल')
  ) {
    const sampleRoom = activeRooms[0] || {};
    const incItems = (Array.isArray(sampleRoom.inclusions) && sampleRoom.inclusions.length)
      ? sampleRoom.inclusions.map(i => \`✅ \${typeof i === 'string' ? i : i.text}\`).join('\\n')
      : '✅ AC\\n✅ Free Wi-Fi\\n✅ Smart TV\\n✅ Pool access\\n✅ Housekeeping\\n✅ Hot water';
    
    const extItems = (Array.isArray(sampleRoom.extras) && sampleRoom.extras.length)
      ? sampleRoom.extras.map(e => \`➕ \${typeof e === 'string' ? e : e.text}\`).join('\\n')
      : '➕ Candlelight Dinner\\n➕ Car / Toto / Auto pickup';

    if (isBengali) {
      reply = \`কোস্টাল ভিউ-তে আমাদের ফ্রন্ট ডেস্ক ডাটাবেস অনুযায়ী প্রতিটি রুমের সাথে অন্তর্ভুক্ত সুবিধাসমূহ (Included in your stay):\\n\\n\${incItems}\\n\\nঅতিরিক্ত প্রদেয় সুবিধাসমূহ (Extras - Pay Extra):\\n\${extItems}\\n\\nপেমেন্ট পলিসি: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং কনফার্ম করুন, বাকি ৮০% হোটেলে পৌঁছানোর পর প্রদেয়।\`;
    } else if (isHindi) {
      reply = \`कोस्टल व्यू में हमारे आधिकारिक सिस्टम के अनुसार प्रत्येक कमरे के साथ शामिल सुविधाएं (Included in your stay):\\n\\n\${incItems}\\n\\nअतिरिक्त सुविधाएं (Extras - Pay Extra):\\n\${extItems}\\n\\nपेमेंट नियम: 20% नॉन-रिफंडेबल एडवांस से कमरा बुक करें, शेष 80% होटल में देय है।\`;
    } else {
      reply = \`Here are the official room inclusions at Coastal View, Mandarmani (Verified from Front Desk Database):\\n\\nIncluded in your stay:\\n\${incItems}\\n\\nExtras (Pay Extra):\\n\${extItems}\\n\\nPayment Terms: Pay 20% non-refundable advance to confirm your stay; the remaining 80% is payable at the hotel.\`;
    }
    actionChips = ['Book a Room', 'Show Rooms & Prices', 'Candlelight Dinner'];

  // 6. Sea View Room
  } else if (text.includes('sea view') || text.includes('ocean view') || text.includes('sea-facing') || text.includes('ocean-facing') || (text.includes('sea') && text.includes('view')) || text.includes('সমুদ্র') || text.includes('समुद्र')) {
    const oceanRoom = activeRooms.find(r => r.id === 'ocean-whisper-room') || activeRooms[0];
    const oceanAvail = roomsAvailMap.get(oceanRoom.id);
    const isSold = !oceanAvail || oceanAvail.available <= 0;
    const roomIncs = formatRoomInclusionsList(oceanRoom);
    const roomExts = formatRoomExtrasList(oceanRoom);
    const priceText = formatRoomPrice(oceanRoom);
    const advanceAmount = oceanRoom.price ? Math.round(oceanRoom.price * 0.2) : 500;
    const balanceAmount = oceanRoom.price ? (oceanRoom.price - advanceAmount) : 2000;

    if (isSold) {
      const altRooms = availableRooms.filter(r => r.id !== oceanRoom.id);
      const altText = altRooms.length > 0
        ? \`\\n\\nHowever, we have other rooms open on \${dateLabel}:\\n\` + altRooms.map(r => \`• \${r.name} (\${r.tag}): \${formatRoomPrice(r)} [\${roomsAvailMap.get(r.id).available} left]\`).join('\\n')
        : '\\n\\nAll rooms are currently sold out for these dates.';

      if (isBengali) {
        reply = \`আমাদের "The Ocean Whisper Room" (Sea View) \${dateLabel}-এর জন্য বর্তমানে সোল্ড আউট (০টি রুম খালি)।\${altText}\\n\\nআপনি কি অন্য কোনো রুম দেখতে চান?\`;
      } else if (isHindi) {
        reply = \`हमारा "The Ocean Whisper Room" (Sea View) \${dateLabel} के लिए वर्तमान में सोल्ड आउट है (0 कमरे उपलब्ध)।\${altText}\\n\\nक्या आप कोई अन्य कमरा बुक करना चाहते हैं?\`;
      } else {
        reply = \`The Ocean Whisper Room (Sea View) is currently SOLD OUT (0 rooms left) on \${dateLabel}.\${altText}\\n\\nWould you like to reserve one of the available suites?\`;
      }
      actionChips = altRooms.length > 0 ? ['Check Availability', 'Other Rooms', 'Contact Front Desk'] : ['Contact Front Desk', 'Request Callback'];
    } else {
      if (isBengali) {
        reply = \`হ্যাঁ! আমাদের "The Ocean Whisper Room" সরাসরি সমুদ্রমুখী (Sea View) এবং \${dateLabel}-এ খালি রয়েছে! মাত্র \${oceanAvail.available}টি রুম বাকি আছে।\\n\\nমূল্য: \${priceText}\\nঅগ্রিম: ২০% (₹\${advanceAmount.toLocaleString('en-IN')}) দিয়ে বুকিং কনফার্ম করুন, অবশিষ্ট ৮০% (₹\${balanceAmount.toLocaleString('en-IN')}) হোটেলে প্রদেয়।\\n\\nঅন্তর্ভুক্ত সুবিধাসমূহ (Inclusions): \${roomIncs}\\nঅতিরিক্ত সুবিধা (Extras): \${roomExts}\`;
      } else if (isHindi) {
        reply = \`हाँ! हमारा "The Ocean Whisper Room" (Sea View) \${dateLabel} को उपलब्ध है! केवल \${oceanAvail.available} कमरे शेष हैं।\\n\\nकिराया: \${priceText}\\nएडवांस: 20% (₹\${advanceAmount.toLocaleString('en-IN')}) देकर बुकिंग कन्फर्म करें, शेष 80% (₹\${balanceAmount.toLocaleString('en-IN')}) होटल में देय है।\\n\\nशामिल सुविधाएं: \${roomIncs}\\nअतिरिक्त: \${roomExts}\`;
      } else {
        reply = \`Yes! The Ocean Whisper Room (Sea View) is available on \${dateLabel}! There are \${oceanAvail.available} of \${oceanAvail.total} room(s) available.\\n\\nRate: \${priceText}\\nPayment: Pay 20% advance (₹\${advanceAmount.toLocaleString('en-IN')}) to confirm; remaining 80% (₹\${balanceAmount.toLocaleString('en-IN')}) at hotel.\\n\\nIncluded in your stay: \${roomIncs}\\nExtras: \${roomExts}\`;
      }
      actionChips = ['Book This Room', 'Check Availability', 'Candlelight Dinner'];
    }

  // 7. Family Room
  } else if (text.includes('family') || text.includes('families') || text.includes('group') || text.includes('children') || text.includes('kid') || text.includes('পরিবার') || text.includes('परिवार')) {
    const familyRoom = activeRooms.find(r => r.id === 'palm-grove-family-suite') || activeRooms.find(r => r.category === 'family');
    const famAvail = roomsAvailMap.get(familyRoom.id);
    const isSold = !famAvail || famAvail.available <= 0;
    const roomIncs = formatRoomInclusionsList(familyRoom);
    const roomExts = formatRoomExtrasList(familyRoom);
    const advanceAmount = familyRoom.price ? Math.round(familyRoom.price * 0.2) : 540;

    if (isSold) {
      const altRooms = availableRooms.filter(r => r.id !== familyRoom.id);
      const altText = altRooms.length > 0
        ? \`\\n\\nAvailable alternatives on \${dateLabel}:\\n\` + altRooms.map(r => \`• \${r.name} (\${r.tag}): \${formatRoomPrice(r)} [\${roomsAvailMap.get(r.id).available} left]\`).join('\\n')
        : '';
      reply = \`The Palm Grove Family Suite is currently SOLD OUT (0 rooms left) on \${dateLabel}.\${altText}\`;
      actionChips = altRooms.length > 0 ? ['Check Availability', 'Other Rooms'] : ['Contact Front Desk'];
    } else {
      if (isBengali) {
        reply = \`পরিবার এবং গ্রুপের জন্য সেরা রুম হল "The Palm Grove Family Suite"! এতে রয়েছে দুটি বেড (কিং বেড + এক্সট্রা বেড), বসার এলাকা, এসি এবং ওয়াই-ফাই। \${dateLabel}-এ \${famAvail.available}টি স্যুট খালি আছে।\\n\\nমূল্য: \${formatRoomPrice(familyRoom)} (২০% অগ্রিম: ₹\${advanceAmount.toLocaleString('en-IN')}, বাকি ৮০% হোটেলে)\\n\\nঅন্তর্ভুক্ত সুবিধাসমূহ: \${roomIncs}\\nঅতিরিক্ত সুবিধা: \${roomExts}\`;
      } else if (isHindi) {
        reply = \`परिवार और बड़े ग्रुप्स के लिए सबसे बेस्ट "The Palm Grove Family Suite" है! इसमें दो बेड (किंग बेड + एक्स्ट्रा बेड), सिटिंग एरिया, एसी और वाई-फाई है। \${dateLabel} को \${famAvail.available} सुइट्स उपलब्ध हैं।\\n\\nकिराया: \${formatRoomPrice(familyRoom)} (20% एडवांस: ₹\${advanceAmount.toLocaleString('en-IN')}, बाकी 80% होटल में)\\n\\nशामिल सुविधाएं: \${roomIncs}\\nअतिरिक्त: \${roomExts}\`;
      } else {
        reply = \`The Palm Grove Family Suite is our most spacious suite, ideal for families and groups! There are \${famAvail.available} of \${famAvail.total} suite(s) available on \${dateLabel} at \${formatRoomPrice(familyRoom)} (Pay 20% to confirm: ₹\${advanceAmount.toLocaleString('en-IN')}, remaining 80% at hotel).\\n\\nIncluded in your stay: \${roomIncs}\\nExtras: \${roomExts}\`;
      }
      actionChips = ['Book Family Suite', 'Check Availability', 'Ani\\'s Car Rental'];
    }

  // 8. Cheapest / Budget Room
  } else if (text.includes('cheap') || text.includes('cheapest') || text.includes('budget') || text.includes('lowest') || text.includes('affordable') || text.includes('কম দাম') || text.includes('সস্তা') || text.includes('सस्ता') || text.includes('किफायती')) {
    const cosyRoom = activeRooms.find(r => r.id === 'cosy-deluxe-room');
    const cosyAvail = cosyRoom ? roomsAvailMap.get(cosyRoom.id) : null;
    const roomIncs = formatRoomInclusionsList(cosyRoom);
    const roomExts = formatRoomExtrasList(cosyRoom);
    const priceText = formatRoomPrice(cosyRoom);
    const advanceAmount = cosyRoom && cosyRoom.price ? Math.round(cosyRoom.price * 0.2) : 360;

    if (cosyRoom && (!cosyAvail || cosyAvail.available > 0)) {
      reply = \`Our most budget-friendly stay is the "Cosy Deluxe Room"! It is a comfortable, quiet non-sea-facing room overlooking garden and courtyard greenery, ideal for economical holidays. Features: AC, Wi-Fi, smart TV, and clean modern bathroom.\\n\\nInventory: \${cosyAvail ? cosyAvail.available : 7} of 7 rooms available on \${dateLabel}.\\nRate: \${priceText} (Pay 20% advance: ₹\${advanceAmount.toLocaleString('en-IN')}, remaining 80% at hotel).\\n\\nIncluded in your stay: \${roomIncs}\\nExtras: \${roomExts}\`;
    } else {
      const priced = availableRooms.filter(r => r.price && !isNaN(r.price));
      const cheapest = priced.length > 0 ? priced.reduce((min, r) => (r.price < min.price ? r : min)) : null;
      if (cheapest) {
        reply = \`Our most economical available option on \${dateLabel} is "\${cheapest.name}" at \${formatRoomPrice(cheapest)} [\${cheapest.tag}] with \${roomsAvailMap.get(cheapest.id).available} room(s) left.\`;
      } else {
        reply = \`Our standard budget accommodation is the Cosy Deluxe Room (₹1,800/night).\`;
      }
    }
    actionChips = ['Book Room', 'Check Availability', 'Contact Front Desk'];

  // 9. Pool View Room
  } else if (text.includes('pool view') || text.includes('pool-facing') || text.includes('swimming pool room') || text.includes('pool room') || (text.includes('pool') && text.includes('view'))) {
    const poolRoom = activeRooms.find(r => r.id === 'pool-haven-room');
    const poolAvail = poolRoom ? roomsAvailMap.get(poolRoom.id) : null;
    const isSold = !poolAvail || poolAvail.available <= 0;
    const roomIncs = formatRoomInclusionsList(poolRoom);
    const roomExts = formatRoomExtrasList(poolRoom);
    const advanceAmount = poolRoom && poolRoom.price ? Math.round(poolRoom.price * 0.2) : 440;

    if (isSold) {
      const altRooms = availableRooms.filter(r => r.id !== poolRoom.id);
      reply = \`The Pool Haven Room is currently SOLD OUT (0 rooms left) on \${dateLabel}.\${altRooms.length ? '\\n\\nAvailable alternatives:\\n' + altRooms.map(r => \`• \${r.name} (\${r.tag}): \${formatRoomPrice(r)}\`).join('\\n') : ''}\`;
      actionChips = ['Check Availability', 'Other Rooms'];
    } else {
      reply = \`The Pool Haven Room is pool-facing with a private balcony overlooking the swimming pool and garden! There are \${poolAvail.available} of \${poolAvail.total} room(s) available on \${dateLabel}.\\n\\nRate: \${formatRoomPrice(poolRoom)} (Pay 20% to confirm: ₹\${advanceAmount.toLocaleString('en-IN')}, remaining 80% at hotel).\\n\\nIncluded in your stay: \${roomIncs}\\nExtras: \${roomExts}\`;
      actionChips = ['Book Pool Haven', 'Check Availability'];
    }

  // 10. Room Availability
  } else if (text.includes('availability') || text.includes('available') || text.includes('বুকিং') || text.includes('খালি') || text.includes('कमरा')) {
    const availList = availableRooms.map(r => {
      const av = roomsAvailMap.get(r.id);
      return \`• \${r.name} (\${r.tag}) — \${formatRoomPrice(r)} [\${av ? av.available : r.quantity} left]\`;
    }).join('\\n');

    const soldList = soldOutRooms.map(r => \`• \${r.name} (\${r.tag}) [SOLD OUT - 0 left]\`).join('\\n');

    if (isBengali) {
      reply = \`\${dateLabel}-এর জন্য কোস্টাল ভিউ রুমের প্রাপ্যতা:\\n\\n\` +
        (availList ? \`উপলব্ধ রুমসমূহ:\\n\${availList}\\n\\n\` : 'সব রুম বুকড!\\n\\n') +
        (soldList ? \`সোল্ড আউট (বুকড):\\n\${soldList}\\n\\n\` : '') +
        \`পেমেন্ট পলিসি: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং নিশ্চিত করুন; অবশিষ্ট ৮০% হোটেলে পৌঁছানোর পর প্রদেয়।\`;
    } else if (isHindi) {
      reply = \`\${dateLabel} के लिए कोस्टल व्यू में कमरे की उपलब्धता:\\n\\n\` +
        (availList ? \`उपलब्ध कमरे:\\n\${availList}\\n\\n\` : 'सभी कमरे बुक हैं!\\n\\n') +
        (soldList ? \`सोल्ड आउट (0 उपलब्ध):\\n\${soldList}\\n\\n\` : '') +
        \`नीति: 20% नॉन-रिफंडेबल एडवांस से कमरा बुक करें, शेष 80% होटल में देय है।\`;
    } else {
      reply = \`Room Availability at Coastal View for \${dateLabel}:\\n\\n\` +
        (availList ? \`Available Suites:\\n\${availList}\\n\\n\` : 'All suites are currently sold out for these dates!\\n\\n') +
        (soldList ? \`Sold Out Suites:\\n\${soldList}\\n\\n\` : '') +
        \`Payment Policy: Pay 20% non-refundable advance to confirm your stay; the remaining 80% is payable at the hotel.\`;
    }
    actionChips = availableRooms.length > 0 ? ['Book a Room', 'Candlelight Dinner', 'Contact Front Desk'] : ['Contact Front Desk', 'Request Callback'];

  // 11. Transport / Vehicles
  } else if (text.includes('toto') || text.includes('auto') || text.includes('car') || text.includes('transport') || text.includes('টোটো') || text.includes('गाड़ी')) {
    const activeVehicles = (db.vehicles || []).filter(v => v.enabled);
    if (isBengali) {
      const vList = activeVehicles.map(v => \`• \${v.name}: \${v.description} — ₹\${v.pricePerDay.toLocaleString('en-IN')}/দিন\`).join('\\n');
      reply = \`অনির ট্যুর অ্যান্ড ট্রাভেলসের অনুমোদিত যানবাহনের আসল মূল্য তালিকা:\\n\\n\` + vList + \`\\n\\nআপনি বুকিং ফর্মে সরাসরি এই বাহন যোগ করতে পারেন।\`;
    } else {
      const vList = activeVehicles.map(v => \`• \${v.name}: \${v.description} — ₹\${v.pricePerDay.toLocaleString('en-IN')}/day\`).join('\\n');
      reply = \`Official Vehicle Rates (Managed by Ani's Tour & Travels):\\n\\n\` + vList + \`\\n\\nYou can select your desired vehicle directly on our live booking bar.\`;
    }
    actionChips = ['Book a Room', 'Check Availability', 'Contact Front Desk'];

  // 12. General Room Price / Hotel Tariffs
  } else if (text.includes('price') || text.includes('rate') || text.includes('cost') || text.includes('room') || text.includes('stay') || text.includes('tariff') || text.includes('দাম') || text.includes('किराया')) {
    reply = \`Official Rates at Coastal View (Total Inventory: 17 Rooms):\\n\\n\` +
      activeRooms.map(r => \`• \${r.name} (\${r.tag}): \${formatRoomPrice(r)} [Inventory: \${r.quantity || 1} rooms]\`).join('\\n') +
      \`\\n\\nPayment Terms: Pay 20% non-refundable advance now to confirm; remaining 80% is payable at the hotel.\\n\\nAdd-ons:\\n• Beachside Candlelight Dinner: ₹\${db.settings?.candlelightDinnerBeachside || 3500}\\n• Poolside Candlelight Dinner: ₹\${db.settings?.candlelightDinnerPoolside || 2800}\\n• AC Car Rental (Ani's Travels): ₹\${db.settings?.carRentalPricePerDay || 2500}/day\`;
    actionChips = ['Check Availability', 'Book Room'];

  // 13. Photo Gallery
  } else if (text.includes('photo') || text.includes('photos') || text.includes('gallery') || text.includes('picture') || text.includes('pictures') || text.includes('image') || text.includes('images') || text.includes('ছবি') || text.includes('तस्वीर') || text.includes('फोटो')) {
    if (isBengali) {
      reply = \`আমাদের কোস্টাল ভিউ হোটেলের সুন্দর ছবি, লাক্সারি রুম, সুইমিং পুল ও সৈকতের মনোরম দৃশ্য দেখতে আমাদের গ্যালারি পেজ দেখুন:\\n\\n👉 /gallery লিঙ্কটি দেখুন অথবা সরাসরি গ্যালারি ব্রাউজ করুন।\`;
    } else if (isHindi) {
      reply = \`हमारे कोस्टल व्यू होटल की तस्वीरें, लक्ज़री रूम, स्विमिंग पूल और मंदारमणि बीच के खूबसूरत नज़ारे देखने के लिए हमारी गैलरी पेज देखें:\\n\\n👉 /gallery देखें।\`;
    } else {
      reply = \`To explore high-resolution verified photographs of Coastal View Hotel, luxury rooms, swimming pool, and Mandarmani beach, please visit our Photo Gallery:\\n\\n👉 Visit /gallery to browse our verified resort photos.\`;
    }
    actionChips = ['View Photo Gallery', 'Check Availability', 'Book a Room'];

  // 14. Candlelight Dinner
  } else if (text.includes('candle') || text.includes('dinner') || text.includes('romantic') || text.includes('হনিমুন') || text.includes('ক্যান্ডেললাইট') || text.includes('कैंडल')) {
    reply = \`Luxury Candlelight Dinners at Coastal View:\\n\\n• Beachside Romantic Canopy Dinner: ₹\${db.settings?.candlelightDinnerBeachside || 3500}\\n• Infinity Poolside Romantic Dinner: ₹\${db.settings?.candlelightDinnerPoolside || 2800}\\n\\nIncludes 4-course gourmet dinner, dedicated butler, glowing lanterns, fresh floral decor, celebration cake, and welcome mocktails. You can add this directly to your room booking.\`;
    actionChips = ['Book Candlelight Dinner', 'View Rooms', 'Contact Front Desk'];

  // 15. Nearby Places & Sightseeing
  } else if (text.includes('nearby') || text.includes('place') || text.includes('sight') || text.includes('tajpur') || text.includes('digha') || text.includes('কাছাকাছি') || text.includes('आसपास')) {
    reply = \`Popular Places to Visit Near Mandarmani:\\n\\n1. Mandarmani Beach (0 km - Direct beachfront access)\\n2. Tajpur Beach (18 km - Famous for red ghost crabs & pine forest)\\n3. Shankarpur Fishing Harbor & Beach (24 km)\\n4. Digha Promenade & Marine Center (30 km)\\n5. Mandarmani Mohana Local Seafood Market (4 km)\\n6. Bakkhali Scenic Tour\\n\\nAni's Tour and Travels provides luxury AC cars for all sightseeing & Kolkata transfers.\`;
    actionChips = ['Explore Ani Tours', 'Check Rooms', 'Call Front Desk'];

  // 16. Booking & Payment Policy
  } else if (text.includes('policy') || text.includes('advance') || text.includes('refund') || text.includes('cancel') || text.includes('পেমেন্ট') || text.includes('নিয়ম')) {
    reply = \`Booking & Payment Policy at Coastal View:\\n\\n• Confirmation Advance: 20% non-refundable deposit payable online via UPI / Cards / Net Banking to lock in live dates.\\n• Balance Payment: Remaining 80% balance is payable directly at hotel check-in / check-out.\\n• Check-in: \${db.settings?.checkInTime || '11:00 AM'} | Check-out: \${db.settings?.checkOutTime || '10:00 AM'}\\n• Couple & Family Friendly: All couples and families are welcome with valid government photo IDs.\\n• Outside Food: Outside food is strictly not allowed on hotel premises.\`;
    actionChips = ['Show Rooms', 'Book Now', 'Contact Front Desk'];

  // 17. Contact & Front Desk
  } else if (text.includes('contact') || text.includes('phone') || text.includes('number') || text.includes('call') || text.includes('help') || text.includes('যোগাযোগ') || text.includes('ফোন') || text.includes('नंबर') || text.includes('संपर्क')) {
    reply = \`Hotel & Restaurant Contact Information:\\n\\n• Hotel: Coastal View, Managed By Ani's\\n• Founder & Host: Anirban Das (Ani's Tour and Travels)\\n• Front Desk & Restaurant Orders: +91 7812027551\\n• WhatsApp / Host Direct: \${db.settings?.phone || '+91 9620536361'}\\n• Email: \${db.settings?.email || 'contact@anis-tour-travels.com'}\\n• Address: \${db.settings?.address || 'Rina Rd, Mandarmani, West Bengal 721455'}\\n\\nWould you like our front desk to call you back right away? Leave your phone number below!\`;
    requiresCallbackForm = true;
    actionChips = ['Request Callback', 'Book a Room', 'Call: +91 7812027551'];

  // 18. Fallback
  } else {
    reply = \`I am Ani's Coastal Concierge. I can assist you with live room availability, official tariffs, our printed dining menu & prices across 8 categories, per-kg kitchen cooking charges, car rentals, and Mandarmani sightseeing.\\n\\nFor special queries, please leave your name and phone number below, or call our direct desk at +91 7812027551.\`;
    requiresCallbackForm = true;
    actionChips = ['Show Rooms & Prices', 'View Full Menu', 'Request Callback'];
  }

  // Save chat inquiry to DB
  db.chatInquiries = db.chatInquiries || [];
  db.chatInquiries.push({
    id: \`chat-\${Date.now()}\`,
    userMessage: message,
    botReply: reply,
    lang,
    timestamp: new Date().toISOString()
  });
  if (db.chatInquiries.length > 200) {
    db.chatInquiries = db.chatInquiries.slice(-200);
  }
  writeDB(db);

  res.json({
    success: true,
    reply,
    requiresCallbackForm,
    actionChips
  });
});

`;

  const updatedCode = code.slice(0, startIdx) + newHandler + code.slice(endIdx);
  fs.writeFileSync(file, updatedCode, 'utf8');
  console.log('Successfully updated server.js concierge handler!');
}

updateChatbot();

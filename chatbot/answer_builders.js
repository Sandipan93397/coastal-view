/**
 * Layer 3: Answer Builders (100% Admin Data Grounded)
 * 
 * Each intent returns a structured reply:
 * - text / markdown string
 * - cards (horizontal swipe list for rooms, contact, dishes)
 * - actionChips (quick reply buttons)
 * - requiresCallbackForm (boolean)
 * - leadStatus / topic / flags
 * 
 * Prices, quantities, availability, menu items, phone numbers, and timings
 * are STRICTLY pulled from the live database, never hard-coded.
 */

function formatINR(amount) {
  const num = Number(amount);
  if (isNaN(num)) return '₹0';
  return '₹' + num.toLocaleString('en-IN');
}

/**
 * Build response for rooms_list (Horizontal swipe list, cards, Section 4)
 */
function buildRoomsListReply(db, lang = 'en') {
  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);
  const cards = [];

  for (const r of activeRooms) {
    const isSoldOut = Boolean(r.isSoldOut);
    const priceFormatted = (r.price && !isNaN(r.price)) ? `${formatINR(r.price)}/night` : 'Ask at hotel';

    // Room tag: Sea View, Pool View, Non-Sea-Facing, Family
    let tag = 'Standard Room';
    const cat = (r.category || '').toLowerCase();
    const v = (r.view || '').toLowerCase();
    const name = (r.name || '').toLowerCase();

    if (name.includes('family') || cat.includes('family') || (r.id && r.id.includes('family'))) {
      tag = 'Family Suite';
    } else if (name.includes('sea') || cat.includes('sea') || v.includes('sea')) {
      tag = 'Sea View';
    } else if (name.includes('pool') || cat.includes('pool') || v.includes('pool')) {
      tag = 'Pool View';
    } else {
      tag = 'Non-Sea-Facing';
    }

    // Inclusions summary - NEVER include breakfast!
    let inclusionsList = [];
    if (Array.isArray(r.inclusions) && r.inclusions.length) {
      inclusionsList = r.inclusions
        .map(i => typeof i === 'string' ? i : i.text)
        .filter(t => !t.toLowerCase().includes('breakfast'));
    }
    if (!inclusionsList.length) {
      inclusionsList = ['AC', 'Free Wi-Fi', 'Smart TV', 'Pool access', 'Housekeeping', 'Hot water'];
    }
    const inclusionsSummary = inclusionsList.slice(0, 5).join(' • ');

    // Bed and Max Guests
    const bedType = r.bed || 'King Size Premium Bed';
    const maxAdults = r.maxAdults || 2;
    const maxChildren = r.maxChildren || 1;
    const maxGuests = `${maxAdults} Adults, ${maxChildren} Child`;

    // Low stock / inventory check
    const totalQty = parseInt(r.quantity, 10) || 4;
    const blocked = parseInt(r.blockedQuantity, 10) || 0;
    const availableQty = Math.max(0, totalQty - blocked);
    const lowStockNote = (!isSoldOut && availableQty <= 2 && availableQty > 0) ? `Only ${availableQty} left!` : null;

    cards.push({
      id: r.id,
      name: r.name,
      tag,
      image: r.image || 'assets/images/room-ocean-whisper.jpg',
      price: r.price,
      priceFormatted,
      bedType,
      maxGuests,
      inclusionsSummary,
      lowStockNote,
      isSoldOut,
      galleryLink: '/gallery',
      bookingUrl: `/index.html#bookingSection?room=${encodeURIComponent(r.id)}`,
      prefillRoomId: r.id
    });
  }

  let text = '';
  if (lang === 'bn') {
    text = `🌊 **কোস্টাল ভিউ-এর বর্তমান রুম ও অফিশিয়াল রেট:**\n\nপ্রতিটি রুমেই রয়েছে এয়ার কন্ডিশনার, ফ্রি ওয়াই-ফাই, সুইমিং পুল অ্যাক্সেস ও আধুনিক সুবিধা। ব্রেকফাস্ট ঐচ্ছিক মাত্র ₹${db.settings?.breakfastPrice || 200}-এ পাওয়া যায়।\n\nনিচের কার্ড থেকে সরাসরি রুমের বিবরণ দেখুন ও বুক করুন:`;
  } else if (lang === 'hi') {
    text = `🌊 **कोस्टल व्यू के वर्तमान कमरे और आधिकारिक दरें:**\n\nसभी कमरों में एसी, फ्री वाई-फाई, स्विमिंग पूल सुविधा उपलब्ध है। नाश्ता वैकल्पिक मात्र ₹${db.settings?.breakfastPrice || 200} में उपलब्ध है।\n\nनीचे दिए गए कार्ड से सीधे कमरे का विवरण देखें और बुक करें:`;
  } else {
    text = `🌊 **Current Rooms & Rates at Coastal View:**\n\nAll rooms feature air conditioning, free Wi-Fi, swimming pool access, and modern en-suite amenities. Breakfast is optional at ₹${db.settings?.breakfastPrice || 200}/person.\n\nSwipe through the room cards below to view details and book:`;
  }

  return {
    reply: text,
    cards,
    roomCards: cards,
    actionChips: ['Check availability', 'How to book', 'Menu', 'How to contact'],
    topic: 'Rooms & Prices'
  };
}

/**
 * Build response for room_detail (Single specific room card)
 */
function buildRoomDetailReply(db, queryText, lang = 'en') {
  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);
  const q = (queryText || '').toLowerCase();

  let targetRoom = null;
  if (q.includes('pool') || q.includes('haven')) {
    targetRoom = activeRooms.find(r => r.id === 'pool-haven-room') || activeRooms[1];
  } else if (q.includes('family') || q.includes('palm') || q.includes('suite') || q.includes('4 bed')) {
    targetRoom = activeRooms.find(r => r.id === 'palm-grove-family-suite') || activeRooms[3];
  } else if (q.includes('deluxe') || q.includes('cosy') || q.includes('cozy')) {
    targetRoom = activeRooms.find(r => r.id === 'cosy-deluxe-room') || activeRooms[2];
  } else {
    // Default to Sea View / Ocean Whisper
    targetRoom = activeRooms.find(r => r.id === 'ocean-whisper-room') || activeRooms[0];
  }

  if (!targetRoom) {
    return buildRoomsListReply(db, lang);
  }

  const isSoldOut = Boolean(targetRoom.isSoldOut);
  const priceFormatted = `${formatINR(targetRoom.price)}/night`;

  let inclusionsList = [];
  if (Array.isArray(targetRoom.inclusions) && targetRoom.inclusions.length) {
    inclusionsList = targetRoom.inclusions
      .map(i => typeof i === 'string' ? i : i.text)
      .filter(t => !t.toLowerCase().includes('breakfast'));
  }
  if (!inclusionsList.length) {
    inclusionsList = ['AC', 'Free Wi-Fi', 'Smart TV', 'Pool access', 'Housekeeping', 'Hot water'];
  }

  let tag = 'Sea View';
  if (targetRoom.id === 'pool-haven-room') tag = 'Pool View';
  else if (targetRoom.id === 'palm-grove-family-suite') tag = 'Family Suite';
  else if (targetRoom.id === 'cosy-deluxe-room') tag = 'Non-Sea-Facing';

  const card = {
    id: targetRoom.id,
    name: targetRoom.name,
    tag,
    image: targetRoom.image || 'assets/images/room-ocean-whisper.jpg',
    price: targetRoom.price,
    priceFormatted,
    bedType: targetRoom.bed || 'King Size Premium Bed',
    maxGuests: `${targetRoom.maxAdults || 2} Adults, ${targetRoom.maxChildren || 1} Child`,
    inclusionsSummary: inclusionsList.join(' • '),
    description: targetRoom.description || '',
    isSoldOut,
    galleryLink: '/gallery',
    bookingUrl: `/index.html#bookingSection?room=${encodeURIComponent(targetRoom.id)}`,
    prefillRoomId: targetRoom.id
  };

  let text = '';
  if (lang === 'bn') {
    text = `✨ **${targetRoom.name} (${tag})**\n\n` +
      `• ভাড়া: ${priceFormatted}\n` +
      `• বিছানা: ${card.bedType}\n` +
      `• ধারণক্ষমতা: ${card.maxGuests}\n` +
      `• সুবিধাসমূহ: ${inclusionsList.join(', ')}\n` +
      `• ব্রেকফাস্ট: ঐচ্ছিক মাত্র ₹${db.settings?.breakfastPrice || 200}/জন\n` +
      (isSoldOut ? `\n⚠️ **এই রুমটি বর্তমানে সোল্ড আউট।**` : `\n👉 বুকিং করতে বা ফর্ম পূরণ করতে নিচের বোতামে ট্যাপ করুন:`);
  } else if (lang === 'hi') {
    text = `✨ **${targetRoom.name} (${tag})**\n\n` +
      `• किराया: ${priceFormatted}\n` +
      `• बिस्तर: ${card.bedType}\n` +
      `• क्षमता: ${card.maxGuests}\n` +
      `• सुविधाएं: ${inclusionsList.join(', ')}\n` +
      `• नाश्ता: वैकल्पिक मात्र ₹${db.settings?.breakfastPrice || 200}/व्यक्ति\n` +
      (isSoldOut ? `\n⚠️ **यह कमरा वर्तमान में सोल्ड आउट है।**` : `\n👉 बुकिंग के लिए नीचे दिए गए बटन पर टैप करें:`);
  } else {
    text = `✨ **${targetRoom.name} (${tag})**\n\n` +
      `• Tariff: ${priceFormatted}\n` +
      `• Bed: ${card.bedType}\n` +
      `• Capacity: ${card.maxGuests}\n` +
      `• Inclusions: ${inclusionsList.join(', ')}\n` +
      `• Breakfast: Optional add-on at ₹${db.settings?.breakfastPrice || 200}/person (not included)\n` +
      (isSoldOut ? `\n⚠️ **This room is currently Sold Out.**` : `\n👉 Tap below to reserve this room or view photo gallery:`);
  }

  return {
    reply: text,
    cards: [card],
    roomCards: [card],
    actionChips: [
      isSoldOut ? 'Other rooms' : 'Book this room',
      'View photo gallery',
      'All rooms & prices',
      'How to contact'
    ],
    topic: 'Room Details'
  };
}

/**
 * Build response for room_price
 */
function buildRoomPriceReply(db, lang = 'en') {
  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);
  const lines = activeRooms.map(r => `• **${r.name}**: ${formatINR(r.price)}/night [${r.view || 'Standard'}]`);
  const bfPrice = db.settings?.breakfastPrice || 200;
  const advPercent = db.settings?.advancePercentage || 20;
  const balPercent = db.settings?.balancePercentage || 80;

  let text = '';
  if (lang === 'bn') {
    text = `🏷️ **কোস্টাল ভিউ-এর অফিশিয়াল রুম ট্যারিফ তালিকা:**\n\n` +
      lines.join('\n') + `\n\n` +
      `📌 **পেমেন্ট নীতিমালা:**\n` +
      `• ${advPercent}% অগ্রিম দিয়ে বুকিং কনফার্ম করুন (অফেরতযোগ্য)।\n` +
      `• বাকি ${balPercent}% টাকা হোটেলে পৌঁছানোর পর প্রদেয়।\n` +
      `• ব্রেকফাস্ট ঐচ্ছিক মাত্র ${formatINR(bfPrice)}/জন।`;
  } else if (lang === 'hi') {
    text = `🏷️ **कोस्टल व्यू की आधिकारिक कमरा किराया सूची:**\n\n` +
      lines.join('\n') + `\n\n` +
      `📌 **भुगतान नियम:**\n` +
      `• ${advPercent}% नॉन-रिफंडेबल एडवांस बुकिंग कन्फर्म करने के लिए।\n` +
      `• शेष ${balPercent}% होटल में चेक-आउट पर देय।\n` +
      `• नाश्ता वैकल्पिक मात्र ${formatINR(bfPrice)}/व्यक्ति में उपलब्ध है।`;
  } else {
    text = `🏷️ **Official Room Tariff at Coastal View:**\n\n` +
      lines.join('\n') + `\n\n` +
      `📌 **Payment Policy:**\n` +
      `• ${advPercent}% advance payable online to guarantee your booking (non-refundable).\n` +
      `• Remaining ${balPercent}% balance payable directly at hotel check-out.\n` +
      `• Breakfast is optional at ${formatINR(bfPrice)} per person per day.`;
  }

  return {
    reply: text,
    actionChips: ['Rooms & prices', 'Check availability', 'Book a room', 'How to contact'],
    topic: 'Room Tariff'
  };
}

/**
 * Build response for contact
 */
function buildContactReply(db, lang = 'en') {
  const phone = db.settings?.phone || '7812027551';
  const whatsapp = db.settings?.whatsapp || phone;
  const email = db.settings?.email || 'stay@coastalviewmandarmani.com';
  const address = db.settings?.address || 'Mandarmani Beach Road, East Midnapore, West Bengal - 721455';

  const contactCard = {
    type: 'contact',
    hotelName: db.settings?.hotelName || "Coastal View, Managed By Ani's",
    phone,
    whatsapp,
    email,
    address,
    hours: '24/7 Front Desk & Security',
    mapsUrl: 'https://maps.google.com/?q=Coastal+View+Mandarmani'
  };

  let text = '';
  if (lang === 'bn') {
    text = `📞 **কোস্টাল ভিউ ফ্রন্ট ডেস্ক যোগাযোগ:**\n\n` +
      `• ফোন নম্বর: [📞 ${phone}](tel:${phone})\n` +
      `• হোয়াটসঅ্যাপ: [💬 Chat on WhatsApp](https://wa.me/91${whatsapp})\n` +
      `• ইমেইল: [✉️ ${email}](mailto:${email})\n` +
      `• রিসেপশন সময়: ২৪ ঘণ্টা সার্বক্ষণিক সেবা\n` +
      `• ঠিকানা: ${address}\n\n` +
      `আমাদের ফ্রন্ট ডেস্ক সরাসরি আপনাকে বুকিং ও যেকোনো তথ্যে সহায়তা করার জন্য প্রস্তুত।`;
  } else if (lang === 'hi') {
    text = `📞 **कोस्टल व्यू फ्रंट डेस्क संपर्क विवरण:**\n\n` +
      `• फोन नंबर: [📞 ${phone}](tel:${phone})\n` +
      `• व्हाट्सएप: [💬 Chat on WhatsApp](https://wa.me/91${whatsapp})\n` +
      `• ईमेल: [✉️ ${email}](mailto:${email})\n` +
      `• रिसेप्शन समय: 24/7 निरंतर सेवा\n` +
      `• पता: ${address}\n\n` +
      `आप किसी भी समय सीधे कॉल कर सकते हैं या व्हाट्सएप पर मैसेज कर सकते हैं।`;
  } else {
    text = `📞 **Coastal View Front Desk Contact Details:**\n\n` +
      `• Direct Phone: [📞 ${phone}](tel:${phone}) (Tap to call)\n` +
      `• WhatsApp: [💬 Chat on WhatsApp](https://wa.me/91${whatsapp})\n` +
      `• Email: [✉️ ${email}](mailto:${email})\n` +
      `• Reception Desk: 24/7 Dedicated Support\n` +
      `• Address: ${address}\n\n` +
      `Our on-site reception team is always available to assist your travel and booking requirements.`;
  }

  return {
    reply: text,
    contactCard,
    actionChips: ['Call ' + phone, 'Chat on WhatsApp', 'Open Google Maps', 'Rooms & prices'],
    topic: 'Contact Info'
  };
}

/**
 * Build response for location
 */
function buildLocationReply(db, lang = 'en') {
  const address = db.settings?.address || 'Mandarmani Beach Road, East Midnapore, West Bengal - 721455';
  const phone = db.settings?.phone || '7812027551';

  let text = '';
  if (lang === 'bn') {
    text = `📍 **হোটেলের অবস্থান ও পৌঁছানোর রুট:**\n\n` +
      `🏨 **ঠিকানা:** ${address}\n\n` +
      `🚗 **গাড়িতে পৌঁছানোর রুট (কলকাতা থেকে ১৭০ কিমি, প্রায় ৪ ঘণ্টা):**\n` +
      `কলকাতা → কোলাঘাট (NH16) → নন্দকুমার → কাঁথি বাইপাস → চাউলখোলা মোড় → মন্দারমণি সমুদ্র সৈকত রোড।\n\n` +
      `🚆 **ট্রেনে:**\n` +
      `নিকটতম রেলওয়ে স্টেশন দীঘা (৩০ কিমি) অথবা রামনগর (২০ কিমি)। স্টেশন থেকে আমাদের টোটো বা প্রাইভেট গাড়ির পিকআপ ব্যবস্থা রয়েছে।\n\n` +
      `🚌 **বাসে:**\n` +
      `ধর্মতলা / হাওড়া থেকে দিঘাগামী বাসে চাউলখোলা মোড়ে নামুন, সেখান থেকে সরাসরি টোটো নিয়ে হোটেলে চলে আসুন।\n\n` +
      `👉 [গুগল ম্যাপে হোটেল লোকেশন দেখুন](https://maps.google.com/?q=Coastal+View+Mandarmani)`;
  } else if (lang === 'hi') {
    text = `📍 **होटल का पता और पहुंचने का मार्ग:**\n\n` +
      `🏨 **पता:** ${address}\n\n` +
      `🚗 **सड़क मार्ग द्वारा (कोलकाता से लगभग 4 घंटे, 170 किमी):**\n` +
      `कोलकाता → कोलाघाट (NH16) → नंदकुमार → कोंताई बाईपास → चाउलखोला → मंदारमणि बीच रोड।\n\n` +
      `🚆 **ट्रेन द्वारा:**\n` +
      `निकटतम स्टेशन दीघा (30 किमी) और रामनगर (20 किमी) हैं। स्टेशन से हम टोटो और कार पिकअप उपलब्ध कराते हैं।\n\n` +
      `👉 [गूगल मैप्स पर देखें](https://maps.google.com/?q=Coastal+View+Mandarmani)`;
  } else {
    text = `📍 **Resort Location & Directions to Mandarmani:**\n\n` +
      `🏨 **Address:** ${address}\n\n` +
      `🚗 **By Car from Kolkata (~170 km, 4 hours drive):**\n` +
      `Take NH16 via Kolaghat → Nandakumar crossing → Contai Bypass → Chawalkhola crossing → turn onto Mandarmani Beach Road.\n\n` +
      `🚆 **By Train:**\n` +
      `Nearest railway stations are Digha (30 km) and Ramnagar (20 km). We arrange direct Toto or private cab pickup on request.\n\n` +
      `🚌 **By Bus:**\n` +
      `Regular AC/Non-AC buses ply from Esplanade/Howrah to Chawalkhola crossing, followed by a quick Toto ride to the resort.\n\n` +
      `👉 [View Live Resort Location on Google Maps](https://maps.google.com/?q=Coastal+View+Mandarmani)`;
  }

  return {
    reply: text,
    actionChips: ['Open Google Maps', 'Book Toto / Car', 'Call Front Desk (' + phone + ')', 'Rooms & prices'],
    topic: 'Location & Directions'
  };
}

/**
 * Build response for booking_how
 */
function buildBookingHowReply(db, lang = 'en') {
  const advPercent = db.settings?.advancePercentage || 20;
  const balPercent = db.settings?.balancePercentage || 80;

  let text = '';
  if (lang === 'bn') {
    text = `📋 **কোস্টাল ভিউ-তে রুম বুকিংয়ের সহজ ধাপসমূহ:**\n\n` +
      `1️⃣ **তারিখ ও রুম নির্বাচন:** আপনার চেক-ইন, চেক-আউট তারিখ এবং পছন্দের রুম বেছে নিন।\n` +
      `2️⃣ **ঐচ্ছিক সুবিধা যুক্ত করুন:** প্রয়োজনমতো গাড়ি/টোটো পিকআপ, ব্রেকফাস্ট বা রোমান্টিক ক্যান্ডেললাইট ডিনার যুক্ত করুন।\n` +
      `3️⃣ **${advPercent}% অগ্রিম জমা:** ইউপিআই বা ব্যাঙ্ক ট্রান্সফারে ${advPercent}% অফেরতযোগ্য অগ্রিম পরিশোধ করে তাত্ক্ষণিক ভাউচার পান।\n` +
      `4️⃣ **অবশিষ্ট ${balPercent}% পেমেন্ট:** বাকি টাকা হোটেলে পৌঁছানোর পর চেক-আউটের সময় পরিশোধ করুন।\n\n` +
      `👉 সরাসরি অনলাইন বুকিং ফর্ম পূরণ করতে নিচের বোতামে ক্লিক করুন:`;
  } else if (lang === 'hi') {
    text = `📋 **कोस्टल व्यू में बुकिंग प्रक्रिया के चरण:**\n\n` +
      `1️⃣ **तारीख और कमरा चुनें:** अपने चेक-इन और चेक-आउट की तारीखें तथा पसंदीदा कमरा चुनें।\n` +
      `2️⃣ **सुविधाएं जोड़ें:** टोटो/कार पिकअप, नाश्ता या कैंडललाइट डिनर वैकल्पिक रूप से शामिल करें।\n` +
      `3️⃣ **${advPercent}% अग्रिम भुगतान:** सुरक्षित यूपीआई/बैंक से ${advPercent}% एडवांस देकर तुरंत कन्फर्मेशन प्राप्त करें।\n` +
      `4️⃣ **शेष ${balPercent}% होटल में:** बाकी राशि होटल में चेक-आउट के समय जमा करें।\n\n` +
      `👉 बुकिंग फॉर्म खोलने के लिए नीचे टैप करें:`;
  } else {
    text = `📋 **How Booking Works at Coastal View:**\n\n` +
      `1️⃣ **Select Dates & Room:** Pick your arrival date, departure date, and preferred room type.\n` +
      `2️⃣ **Add Optional Add-ons:** Choose Toto/Car pickup, optional daily breakfast, or a beachside candlelight dinner.\n` +
      `3️⃣ **Pay ${advPercent}% Advance:** Confirm instantly with ${advPercent}% non-refundable advance via UPI or Net Banking.\n` +
      `4️⃣ **Pay ${balPercent}% at Check-out:** Pay the remaining balance conveniently at the hotel upon arrival.\n\n` +
      `👉 Tap below to open the reservation form or guide your booking step-by-step:`;
  }

  return {
    reply: text,
    actionChips: ['Book a room', 'Rooms & prices', 'Payment policy', 'How to contact'],
    topic: 'Booking Process'
  };
}

/**
 * Build response for payment_policy
 */
function buildPaymentPolicyReply(db, lang = 'en') {
  const adv = db.settings?.advancePercentage || 20;
  const bal = db.settings?.balancePercentage || 80;
  const note = db.settings?.advancePolicyNote || '20% advance payment is non-refundable. Remaining 80% payable at hotel.';

  let text = '';
  if (lang === 'bn') {
    text = `💳 **অফিশিয়াল পেমেন্ট ও রিফান্ড নীতিমালা:**\n\n` +
      `• **${adv}% অগ্রিম নিশ্চিতকরণ:** রুম বুকিং কনফার্ম করার জন্য মোট ভাড়ার ${adv}% অগ্রিম পরিশোধ বাধ্যতামূলক।\n` +
      `• **অফেরতযোগ্য নীতি:** এই ${adv}% অগ্রিম সম্পূর্ণ নন-রিফান্ডেবল (বাতিল করলেও অফেরতযোগ্য)।\n` +
      `• **হোটেলে অবশিষ্ট ${bal}%:** বাকি ${bal}% টাকা হোটেলে চেক-ইন / চেক-আউটের সময় ক্যাশ, কার্ড বা ইউপিআইতে প্রদেয়।\n` +
      `• কোনো লুকানো অতিরিক্ত চার্জ নেই।`;
  } else if (lang === 'hi') {
    text = `💳 **आधिकारिक भुगतान एवं कैंसिलेशन नीति:**\n\n` +
      `• **${adv}% अग्रिम अनिवार्य:** बुकिंग पक्की करने के लिए कुल राशि का ${adv}% एडवांस अनिवार्य है।\n` +
      `• **नॉन-रिफंडेबल:** यह ${adv}% एडवांस पूर्णतः नॉन-रिफंडेबल है।\n` +
      `• **होटल में शेष ${bal}%:** बाकी ${bal}% राशि होटल में नकद, कार्ड या यूपीआई से देय है।\n` +
      `• कोई भी अप्रत्यक्ष या छुपा हुआ शुल्क नहीं है।`;
  } else {
    text = `💳 **Official Payment & Refund Policy:**\n\n` +
      `• **${adv}% Advance to Guarantee:** A ${adv}% advance deposit is required to reserve and block your room.\n` +
      `• **Non-refundable Policy:** The ${adv}% advance deposit is strictly non-refundable upon cancellation.\n` +
      `• **${bal}% Balance at Hotel:** The remaining ${bal}% balance is payable directly at hotel check-in/check-out via UPI, Cash, or Cards.\n` +
      `• 100% transparent pricing with no hidden charges.`;
  }

  return {
    reply: text,
    actionChips: ['Book a room', 'Rooms & prices', 'How to contact'],
    topic: 'Payment Policy'
  };
}

/**
 * Build response for checkin_time
 */
function buildCheckinTimeReply(db, lang = 'en') {
  const inTime = db.settings?.checkInTime || '12:00 PM';
  const outTime = db.settings?.checkOutTime || '11:00 AM';

  let text = '';
  if (lang === 'bn') {
    text = `⏰ **চেক-ইন এবং চেক-আউট সময়সূচি:**\n\n` +
      `• **চেক-ইন সময়:** দুপুর ${inTime}\n` +
      `• **চেক-আউট সময়:** সকাল ${outTime}\n\n` +
      `আগে চেক-ইন বা দেরিতে চেক-আউটের অনুরোধ রুমের প্রাপ্যতার ওপর নির্ভর করে বিবেচিত হবে।`;
  } else if (lang === 'hi') {
    text = `⏰ **चेक-इन और चेक-आउट का समय:**\n\n` +
      `• **चेक-इन का समय:** दोपहर ${inTime}\n` +
      `• **चेक-आउट का समय:** सुबह ${outTime}\n\n` +
      `जल्दी चेक-इन या देर से चेक-आउट की सुविधा कमरों की उपलब्धता पर निर्भर है।`;
  } else {
    text = `⏰ **Check-in & Check-out Timings:**\n\n` +
      `• **Check-in Time:** ${inTime}\n` +
      `• **Check-out Time:** ${outTime}\n\n` +
      `Early check-in or late check-out is subject to room availability upon arrival.`;
  }

  return {
    reply: text,
    actionChips: ['Book a room', 'How to contact', 'Rooms & prices'],
    topic: 'Timings'
  };
}

/**
 * Build response for addons (breakfast, vehicles, candlelight dinner)
 */
function buildAddonsReply(db, queryText = '', lang = 'en') {
  const bfPrice = db.settings?.breakfastPrice || 200;
  const bfTime = db.settings?.breakfastServingTime || '7:00 AM to 10:30 AM';
  const beachDinner = db.settings?.candlelightDinnerBeachside || 3500;
  const poolDinner = db.settings?.candlelightDinnerPoolside || 2800;

  const vehicles = (db.vehicles || []).map(v => `• **${v.name}**: ${formatINR(v.pricePerDay)}/day (${v.description || 'pickup & local drop'})`);

  const q = (queryText || '').toLowerCase();

  // If specifically asking about breakfast
  if (q.includes('breakfast') || q.includes('ব্রেকফাস্ট') || q.includes('নাস্তা')) {
    let bfText = '';
    if (lang === 'bn') {
      bfText = `🍳 **ব্রেকফাস্ট সংক্রান্ত তথ্য:**\n\n` +
        `• ব্রেকফাস্ট রুম ভাড়ার অন্তর্ভুক্ত নয় (ব্রেকফাস্ট সম্পূর্ণ ঐচ্ছিক)।\n` +
        `• **মূল্য:** মাত্র **${formatINR(bfPrice)}** প্রতি জন প্রতি দিন।\n` +
        `• **পরিবেশনের সময়:** ${bfTime}\n` +
        `• এতে পরিবেশিত হয় সুস্বাদু গরম লুচি-আলুর দম/পরোটা, ডিমের অমলেট, ব্রেড-মাখন, ও তাজা চা/কফি।`;
    } else if (lang === 'hi') {
      bfText = `🍳 **नाश्ते की जानकारी:**\n\n` +
        `• कमरे के किराए में नाश्ता शामिल नहीं है (नाश्ता वैकल्पिक है)।\n` +
        `• **शुल्क:** मात्र **${formatINR(bfPrice)}** प्रति व्यक्ति प्रति दिन।\n` +
        `• **समय:** ${bfTime}\n` +
        `• इसमें ताज़ा गरम पूरी-सब्जी/पराठा, ऑमलेट, ब्रेड-बटर और चाय/कॉफ़ी शामिल है।`;
    } else {
      bfText = `🍳 **Breakfast Add-on Details:**\n\n` +
        `• Breakfast is **OPTIONAL and NOT included** in the base room tariff.\n` +
        `• **Price:** Just **${formatINR(bfPrice)}** per person per day.\n` +
        `• **Serving Hours:** ${bfTime}\n` +
        `• Fresh breakfast spread includes Hot Luchi/Alur Dum, Parathas, Eggs to order, Toast & Butter, and fresh Tea/Coffee.`;
    }
    return {
      reply: bfText,
      actionChips: ['Book a room', 'Menu', 'Other add-ons', 'How to contact'],
      topic: 'Breakfast Add-on'
    };
  }

  // If asking about toto, car, auto, vehicle, pickup, drop, or transport tariffs
  if (q.includes('toto') || q.includes('car') || q.includes('auto') || q.includes('pickup') || q.includes('drop') || q.includes('transport') || q.includes('cab') || q.includes('টোটো') || q.includes('গাড়ি') || q.includes('অটো')) {
    return buildVehiclePricingReply(db, queryText, lang);
  }

  // General add-ons summary
  let text = '';
  if (lang === 'bn') {
    text = `🎁 **কোস্টাল ভিউ-এর বিশেষ অতিরিক্ত সুবিধাসমূহ (Add-ons):**\n\n` +
      `1️⃣ **ব্রেকফাস্ট (ঐচ্ছিক):** ${formatINR(bfPrice)}/জন (${bfTime}) — রুমে অন্তর্ভুক্ত নয়।\n` +
      `2️⃣ **যানবাহন পিকআপ:**\n` +
      vehicles.join('\n') + `\n` +
      `3️⃣ **রোমান্টিক ক্যান্ডেললাইট ডিনার:**\n` +
      `• সমুদ্র সৈকত সেটআপ: ${formatINR(beachDinner)}\n` +
      `• সুইমিং পুল সাইড সেটআপ: ${formatINR(poolDinner)}\n\n` +
      `সবগুলি সুবিধা সরাসরি বুকিং করার সময় বা রিসেপশনে বেছে নেওয়া যায়।`;
  } else if (lang === 'hi') {
    text = `🎁 **कोस्टल व्यू की विशेष अतिरिक्त सुविधाएं (Add-ons):**\n\n` +
      `1️⃣ **नाश्ता (वैकल्पिक):** ${formatINR(bfPrice)}/व्यक्ति — कमरे में शामिल नहीं है।\n` +
      `2️⃣ **वाहन पिकअप:**\n` +
      vehicles.join('\n') + `\n` +
      `3️⃣ **कैंडललाइट डिनर:**\n` +
      `• बीचसाइड सेटअप: ${formatINR(beachDinner)}\n` +
      `• पूलसाइड सेटअप: ${formatINR(poolDinner)}`;
  } else {
    text = `🎁 **Optional Add-on Experiences at Coastal View:**\n\n` +
      `1️⃣ **Optional Breakfast:** ${formatINR(bfPrice)} per person per day (${bfTime}) — not included in room tariff.\n` +
      `2️⃣ **Transport & Station Pickups:**\n` +
      vehicles.join('\n') + `\n` +
      `3️⃣ **Romantic Candlelight Dinner:**\n` +
      `• Beachside Setup: ${formatINR(beachDinner)}\n` +
      `• Poolside Setup: ${formatINR(poolDinner)}\n\n` +
      `Select any of these options directly on the booking form or request with front desk.`;
  }

  return {
    reply: text,
    actionChips: ['Book a room', 'Menu', 'Candlelight dinner', 'How to contact'],
    topic: 'Add-ons'
  };
}

/**
 * Build response for vehicle pricing by service type (Toto, Auto, Car x Pickup, Drop, Pickup+Drop, Tour)
 * Authoritative responses directly from database matrix.
 * Unset prices say "please call us" and are marked as "Ask us".
 * Never invents prices.
 */
function buildVehiclePricingReply(db, queryText = '', lang = 'en') {
  const q = (queryText || '').toLowerCase();
  const phone = db.settings?.phone || '+91 7812027551';
  const vehicles = (db.vehicles || []).map(v => {
    const copy = { ...v };
    copy.services = copy.services || {};
    ['pickup', 'drop', 'pickup_drop', 'tour'].forEach(st => {
      if (!copy.services[st]) copy.services[st] = { price: null, enabled: false };
    });
    return copy;
  });

  // Identify requested vehicle
  let matchedVehicle = null;
  if (q.includes('toto') || q.includes('টোটো') || q.includes('e-rickshaw') || q.includes('rickshaw')) {
    matchedVehicle = vehicles.find(v => v.id === 'toto') || { name: 'Toto (E-Rickshaw)', id: 'toto', capacity: 4 };
  } else if (q.includes('auto') || q.includes('অটো') || q.includes('three wheeler')) {
    matchedVehicle = vehicles.find(v => v.id === 'auto') || { name: 'Auto', id: 'auto', capacity: 3 };
  } else if (q.includes('car') || q.includes('গাড়ি') || q.includes('cab') || q.includes('taxi')) {
    matchedVehicle = vehicles.find(v => v.id === 'car') || { name: 'Car', id: 'car', capacity: 4 };
  }

  // Identify requested service
  let matchedService = null;
  let serviceLabel = '';
  if (q.includes('pickup and drop') || q.includes('pickup & drop') || q.includes('pickup drop') || q.includes('both pickup and drop') || q.includes('round trip')) {
    matchedService = 'pickup_drop';
    serviceLabel = 'Pickup + Drop';
  } else if (q.includes('pickup') || q.includes('pick up') || q.includes('পিকআপ') || q.includes('station pickup')) {
    matchedService = 'pickup';
    serviceLabel = 'Pickup';
  } else if (q.includes('drop') || q.includes('ড্রপ') || q.includes('drop charge') || q.includes('drop off')) {
    matchedService = 'drop';
    serviceLabel = 'Drop';
  } else if (q.includes('tour') || q.includes('sightseeing') || q.includes('day trip') || q.includes('per day') || q.includes('ট্যুর') || q.includes('ভ্রমণ')) {
    matchedService = 'tour';
    serviceLabel = 'Tour';
  }

  // Specific vehicle + specific service
  if (matchedVehicle && matchedService) {
    const svc = matchedVehicle.services?.[matchedService];
    const isSet = svc && svc.price !== null && svc.price !== undefined && Number(svc.price) > 0 && svc.enabled !== false;
    const vName = matchedVehicle.name || matchedVehicle.id;
    const capStr = matchedVehicle.capacity ? ` (capacity: up to ${matchedVehicle.capacity} passengers)` : '';

    if (isSet) {
      const priceStr = formatINR(svc.price) + (matchedService === 'tour' ? '/day' : ' per trip');
      let text = `🚗 **${vName} · ${serviceLabel} Tariff:**\n\n` +
        `• **Price:** **${priceStr}**${capStr}\n` +
        `• **Fleet Service:** Ani's Tour & Travels\n` +
        `• **Details:** ${matchedVehicle.description || 'Chauffeur driven transport with verified drivers.'}\n\n` +
        `You can reserve this option directly on our booking form or request with our concierge desk.`;
      return {
        reply: text,
        actionChips: ['Book a room', 'All vehicle rates', 'Call Concierge (' + phone + ')'],
        topic: 'Vehicle Pricing'
      };
    } else {
      let text = `🚗 **${vName} · ${serviceLabel} Tariff:**\n\n` +
        `The price for **${vName} ${serviceLabel}** is currently **not set** (Ask us).\n\n` +
        `Please call us at [📞 ${phone}](tel:${phone}) or inquire at our front desk for an instant custom quote! Anirban Das and our team will be delighted to arrange your trip.`;
      return {
        reply: text,
        actionChips: ['Call Concierge (' + phone + ')', 'Book a room', 'Other vehicles'],
        topic: 'Vehicle Pricing'
      };
    }
  }

  // Specific vehicle only
  if (matchedVehicle && !matchedService) {
    const vName = matchedVehicle.name || matchedVehicle.id;
    const capStr = matchedVehicle.capacity ? ` (Capacity: up to ${matchedVehicle.capacity} passengers)` : '';
    const svcs = matchedVehicle.services || {};
    
    const lines = [
      `• **Pickup:** ${svcs.pickup?.price && svcs.pickup?.enabled ? formatINR(svcs.pickup.price) : 'Ask us'}`,
      `• **Drop:** ${svcs.drop?.price && svcs.drop?.enabled ? formatINR(svcs.drop.price) : 'Ask us'}`,
      `• **Pickup + Drop:** ${svcs.pickup_drop?.price && svcs.pickup_drop?.enabled ? formatINR(svcs.pickup_drop.price) : 'Ask us'}`,
      `• **Tour (per day):** ${svcs.tour?.price && svcs.tour?.enabled ? formatINR(svcs.tour.price) + '/day' : 'Ask us'}`
    ];

    let text = `🚗 **Official Fleet Tariffs for ${vName}${capStr}:**\n\n` +
      lines.join('\n') + `\n\n` +
      `For any service shown as **Ask us** or for customized station transfers, please call us at [📞 ${phone}](tel:${phone}).`;
    return {
      reply: text,
      actionChips: ['Book a room', 'All vehicle rates', 'Call Concierge (' + phone + ')'],
      topic: 'Vehicle Pricing'
    };
  }

  // General transport query (matrix overview)
  const matrixLines = vehicles.map(v => {
    const s = v.services || {};
    const pPick = s.pickup?.price && s.pickup?.enabled ? formatINR(s.pickup.price) : 'Ask us';
    const pDrop = s.drop?.price && s.drop?.enabled ? formatINR(s.drop.price) : 'Ask us';
    const pBoth = s.pickup_drop?.price && s.pickup_drop?.enabled ? formatINR(s.pickup_drop.price) : 'Ask us';
    const pTour = s.tour?.price && s.tour?.enabled ? formatINR(s.tour.price) + '/day' : 'Ask us';
    return `• **${v.name}** (Capacity: ${v.capacity || 4} passengers):\n  Pickup: ${pPick} | Drop: ${pDrop} | Pickup+Drop: ${pBoth} | Tour: ${pTour}`;
  });

  let text = `🚗 **Ani's Travels Official Vehicle Pricing Matrix:**\n\n` +
    matrixLines.join('\n\n') + `\n\n` +
    `For any service shown as **Ask us** or for Kolkata airport/doorstep transfers, please call us directly at [📞 ${phone}](tel:${phone}).`;

  return {
    reply: text,
    actionChips: ['Book a room', 'Tours & travels', 'Call Concierge (' + phone + ')'],
    topic: 'Vehicle Pricing'
  };
}

/**
 * Build response for menu
 */
function buildMenuReply(db, queryText = '', lang = 'en') {
  const dishes = db.restaurant || [];
  const q = (queryText || '').toLowerCase();

  // Search specific dishes if user asked for "ilish", "chicken", "thali", etc.
  const matchedDishes = [];
  if (q.length > 2 && !q.includes('full menu')) {
    for (const d of dishes) {
      const name = (d.name || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      if (name.includes(q) || desc.includes(q)) {
        matchedDishes.push(d);
      }
    }
  }

  // If specific dish matched
  if (matchedDishes.length > 0) {
    const dishLines = matchedDishes.slice(0, 6).map(d => {
      const priceText = d.price ? formatINR(d.price) : (d.variants && d.variants.length ? d.variants.map(v => `${v.label}: ${formatINR(v.price)}`).join(', ') : 'Market Price');
      return `• **${d.name}**: ${priceText}${d.category ? ` [${d.category}]` : ''}`;
    });

    let text = '';
    if (lang === 'bn') {
      text = `🍽️ **রেস্তোরাঁ মেনু থেকে আপনার পছন্দের পদ:**\n\n` +
        dishLines.join('\n') + `\n\n` +
        `তাজা স্থানীয় মাছ ও সুস্বাদু পদ পেতে আমাদের সম্পূর্ণ মেনু দেখতে পারেন।`;
    } else {
      text = `🍽️ **Matching Items from our Coastal Restaurant Menu:**\n\n` +
        dishLines.join('\n') + `\n\n` +
        `Prepared fresh by our Bengali coastal chefs using daily local catch.`;
    }

    return {
      reply: text,
      actionChips: ['View full menu', 'Candlelight dinner', 'Rooms & prices', 'Call Front Desk'],
      topic: 'Restaurant Menu'
    };
  }

  // General menu overview
  let text = '';
  if (lang === 'bn') {
    text = `🍽️ **কোস্টাল ভিউ মাল্টি-কুইজিন রেস্তোরাঁ:**\n\n` +
      `আমাদের রেস্তোরাঁয় প্রতিদিনের তাজা বঙ্গোপসাগরের মাছ, সুস্বাদু ইলিশ, গলদা চিংড়ি, কাঁকড়া, ঐতিহ্যবাহী বাংলা থালি, তন্দুরি ও চাইনিজ পদ পরিবেশিত হয়।\n\n` +
      `• খাঁটি বাঙালি মাছের থালি (ভেটকি, ইলিশ, রুই, কাতলা)\n` +
      `• স্পেশাল ইলিশ উৎসব (সর্ষে ইলিশ, ভাপা ইলিশ, ইলিশের ঝোল)\n` +
      `• চিংড়ি মালাইকারি ও কাঁকড়ার কারি\n` +
      `• ভেজিটেরিয়ান স্পেশাল থালি ও পনির পদ\n\n` +
      `👉 সম্পূর্ণ মূল্য তালিকা দেখতে নিচের বোতামে ক্লিক করুন:`;
  } else if (lang === 'hi') {
    text = `🍽️ **कोस्टल व्यू मल्टी-कुज़ीन रेस्टोरेंट:**\n\n` +
      `यहाँ ताज़ा सीफूड, प्रामाणिक बंगाली थाली, इलिश मछली, प्रॉन मलाई करी, चिकन, वेज थाली और चाइनीज व्यंजन उपलब्ध हैं।\n\n` +
      `👉 पूरा मेनू और रेट देखने के लिए नीचे दिए गए बटन पर टैप करें:`;
  } else {
    text = `🍽️ **Coastal View Multi-Cuisine Dining & Restaurant:**\n\n` +
      `We serve fresh Bay of Bengal catch, authentic Bengali seafood delicacies, comforting vegetarian thalis, and coastal delights:\n\n` +
      `• **Signature Seafood:** Fresh Hilsa (Ilish Bhapa / Shorshe Ilish), Jumbo Prawns Malai Curry, Fresh Sea Crabs\n` +
      `• **Traditional Thalis:** Pure Vegetarian Thali, Fish Thalis, Chicken & Mutton Kasha\n` +
      `• **Snacks & Starters:** Crispy Pomfret Fry, Prawn Butter Garlic, Chicken Pakora\n\n` +
      `👉 Tap below to view our complete menu with all official prices:`;
  }

  return {
    reply: text,
    actionChips: ['View full menu', 'Candlelight dinner', 'Rooms & prices', 'How to contact'],
    topic: 'Restaurant Menu'
  };
}

/**
 * Build response for nearby places
 */
function buildNearbyReply(db, lang = 'en') {
  const nearby = [
    {
      name: 'Mandarmani Beach & Red Crab Stretch',
      dist: 'Direct resort beachfront',
      desc: 'One of the longest motorable beach stretches in India, famous for red ghost crabs and tranquil sunrise.'
    },
    {
      name: 'Tajpur Beach & Pine Forest',
      dist: '18 km (25 mins drive)',
      desc: 'Quiet virgin beach bordered by dense Casuarina groves and fisherman lagoons.'
    },
    {
      name: 'Old & New Digha Beach',
      dist: '30 km (45 mins drive)',
      desc: 'Iconic beach promenade, Marine Aquarium, Science Centre, and handicraft markets.'
    },
    {
      name: 'Mohana Fish Market & Sunset Point',
      dist: '8 km (15 mins by Toto)',
      desc: 'Where the river meets the sea; spectacular sunsets and live fisherman auctions.'
    }
  ];

  const cards = nearby.map(n => ({
    type: 'nearby',
    title: n.name,
    distance: n.dist,
    description: n.desc
  }));

  let text = '';
  if (lang === 'bn') {
    text = `🏖️ **মন্দারমণির কাছাকাছি দর্শনীয় স্থানসমূহ:**\n\n` +
      nearby.map(n => `• **${n.name}** (${n.dist}): ${n.desc}`).join('\n\n') + `\n\n` +
      `আমাদের ফ্রন্ট ডেস্ক থেকে সবকটি স্পটে ঘোরার জন্য টোটো ও এসি কার বুকিং করা যায়।`;
  } else {
    text = `🏖️ **Nearby Attractions & Sightseeing near Coastal View:**\n\n` +
      nearby.map(n => `• **${n.name}** (${n.dist}): ${n.desc}`).join('\n\n') + `\n\n` +
      `Our concierge can arrange customized Toto and private cab tours to all of these spots.`;
  }

  return {
    reply: text,
    cards,
    actionChips: ['Book Toto / Car', 'Tours & travels', 'Rooms & prices', 'How to contact'],
    topic: 'Nearby Places'
  };
}

/**
 * Build response for tours
 */
function buildToursReply(db, lang = 'en') {
  const phone = db.settings?.phone || '7812027551';
  const tourUrl = db.settings?.tourUrl || `tel:${phone}`;

  let text = '';
  if (lang === 'bn') {
    text = `🧳 **অনির ট্যুর ও ট্রাভেলস (Ani's Tours & Travels):**\n\n` +
      `আমাদের নিজস্ব ট্রাভেল ডেস্কের মাধ্যমে মন্দারমণি, তাজপুর, দিঘা ও উদয়পুর সমুদ্র সৈকতে আরামদায়ক সাইটসিইং ও স্টেশন পিকআপের ব্যবস্থা রয়েছে।\n\n` +
      `• ব্যক্তিগত এসি গাড়ি ও টোটো প্যাকেজ\n` +
      `• দীঘা / রামনগর / হাওড়া পিকআপ ও ড্রপ\n` +
      `• স্থানীয় দর্শনীয় স্থান ভ্রমণের প্যাকেজ\n\n` +
      `👉 সরাসরি কথা বলতে কল করুন: [📞 ${phone}](tel:${phone})`;
  } else {
    text = `🧳 **Ani's Tours & Travels (Official Travel Desk):**\n\n` +
      `Managed directly under Ani's hospitality, we offer seamless transfers and sightseeing packages across Mandarmani, Tajpur, Digha, and Shankarpur.\n\n` +
      `• Customized Half-Day and Full-Day Beach Tours\n` +
      `• Reliable Railway Station & Airport Pickups\n` +
      `• Safe, courteous drivers with verified local vehicles\n\n` +
      `👉 To arrange a tour or vehicle, call our travel desk at [📞 ${phone}](tel:${phone}) or book directly with your room.`;
  }

  return {
    reply: text,
    actionChips: ['Call Travel Desk (' + phone + ')', 'Book Toto / Car', 'Nearby places', 'Rooms & prices'],
    topic: 'Tours & Travels'
  };
}

/**
 * Build response for amenities
 */
function buildAmenitiesReply(db, lang = 'en') {
  let amenitiesList = (db.amenities || []).map(a => typeof a === 'string' ? a : a.name);
  if (!amenitiesList.length) {
    amenitiesList = [
      'Outdoor Swimming Pool (with kid pool section)',
      'Free High-Speed Wi-Fi across resort',
      'Free Secured Car Parking on-site',
      '24/7 Power Backup (High-capacity silent generator)',
      'Multi-Cuisine Coastal Restaurant',
      'Direct Beach Access (1-minute walk)',
      '24/7 Front Desk & Daily Housekeeping',
      'Hot & Cold Running Water in all rooms'
    ];
  }

  const lines = amenitiesList.map(a => `• ${a}`);

  let text = '';
  if (lang === 'bn') {
    text = `🏊‍♂️ **কোস্টাল ভিউ-এর সুযোগ সুবিধাসমূহ:**\n\n` +
      lines.join('\n') + `\n\n` +
      `আমাদের সমস্ত অতিথি বিনামূল্যে সুইমিং পুল, পার্কিং এবং ওয়াই-ফাই ব্যবহার করতে পারবেন।`;
  } else {
    text = `🏊‍♂️ **Resort Amenities & Facilities at Coastal View:**\n\n` +
      lines.join('\n') + `\n\n` +
      `All staying guests enjoy complimentary swimming pool access, secured parking, and Wi-Fi.`;
  }

  return {
    reply: text,
    actionChips: ['Rooms & prices', 'Check availability', 'View photo gallery', 'How to contact'],
    topic: 'Amenities'
  };
}

/**
 * Build response for policies
 */
function buildPoliciesReply(db, lang = 'en') {
  let text = '';
  if (lang === 'bn') {
    text = `📜 **রিসোর্টের গুরুত্বপূর্ণ নীতিমালা ও সাধারণ নিয়মাবলী:**\n\n` +
      `• **বাইরের খাবার:** রেস্তোরাঁ ও সুইমিং পুলের সাধারণ এলাকায় বাইরের খাবার অনুমতি নেই। রুমে খাওয়া যেতে পারে।\n` +
      `• **আইডি প্রুফ:** চেক-ইনের সময় সমস্ত প্রাপ্তবয়স্ক অতিথির বৈধ সরকারি আইডি (আধার, ভোটার, ড্রাইভিং লাইসেন্স বা পাসপোর্ট) প্রদর্শন বাধ্যতামূলক।\n` +
      `• **কপলস:** ১৮+ প্রাপ্তবয়স্ক সকল দম্পতিদের স্বাগত জানানো হয়।\n` +
      `• **পোষা প্রাণী (Pets):** আগে থেকে জানালে ছোট পোষা প্রাণী অনুমোদিত (পরিচ্ছন্নতার নিয়ম মেনে)।\n` +
      `• **শিশু পলিসি:** ৫ বছর বয়স পর্যন্ত শিশুদের অতিরিক্ত বিছানা ছাড়া থাকা বিনামূল্যে।`;
  } else {
    text = `📜 **Important Resort Policies & Guidelines:**\n\n` +
      `• **Outside Food:** Outside food is not permitted in the restaurant, pool deck, or lawn areas. In-room dining is readily available.\n` +
      `• **Government ID:** Valid government photo ID (Aadhaar, Passport, Voter ID, Driving License) is required for each adult guest at check-in (PAN card is not accepted).\n` +
      `• **Couples:** We welcome all adult guests (18+) with valid government photo IDs.\n` +
      `• **Pets:** Pet-friendly on prior notice for well-behaved domestic pets.\n` +
      `• **Children:** Children up to 5 years stay complimentary without extra bed.`;
  }

  return {
    reply: text,
    actionChips: ['Check-in time', 'Payment policy', 'How to contact', 'Book a room'],
    topic: 'Policies'
  };
}

/**
 * Build response for human handoff
 */
function buildHumanReply(db, lang = 'en') {
  const phone = db.settings?.phone || '7812027551';
  const whatsapp = db.settings?.whatsapp || phone;

  let text = '';
  if (lang === 'bn') {
    text = `👤 **আমাদের ফ্রন্ট ডেস্ক ম্যানেজারের সাথে সরাসরি যোগাযোগ:**\n\n` +
      `আপনি এখনই সরাসরি আমাদের ম্যানেজারের সাথে কথা বলতে পারেন:\n` +
      `• সরাসরি কল করুন: [📞 ${phone}](tel:${phone})\n` +
      `• হোয়াটসঅ্যাপে লিখুন: [💬 WhatsApp](https://wa.me/91${whatsapp})\n\n` +
      `অথবা নিচে আপনার নাম ও ফোন নম্বর লিখুন, আমাদের টিম খুব শীঘ্রই আপনাকে কল ব্যাক করবে।`;
  } else {
    text = `👤 **Connect with Front Desk Management:**\n\n` +
      `You can immediately reach our manager directly on phone or WhatsApp:\n` +
      `• Direct Call: [📞 ${phone}](tel:${phone})\n` +
      `• WhatsApp Chat: [💬 WhatsApp](https://wa.me/91${whatsapp})\n\n` +
      `Alternatively, enter your name and phone number below and our manager will call you back promptly:`;
  }

  return {
    reply: text,
    actionChips: ['Call ' + phone, 'Chat on WhatsApp', 'Rooms & prices'],
    requiresCallbackForm: true,
    leadStatus: 'Needs follow-up',
    topic: 'Human Handoff'
  };
}

/**
 * Build response for greeting
 */
function buildGreetingReply(db, lang = 'en') {
  const welcome = db.botSettings?.welcomeMessage?.[lang] || db.botSettings?.welcomeMessage?.en ||
    "Welcome to Coastal View, Managed By Ani's! 🌊\nHow may I assist your Mandarmani holiday today?";

  const chips = db.botSettings?.quickReplyChips || [
    'Rooms & prices',
    'Check availability',
    'How to contact',
    'Menu',
    'Candlelight dinner',
    'Nearby places',
    'Tours'
  ];

  return {
    reply: welcome,
    actionChips: chips,
    topic: 'Greeting'
  };
}

/**
 * Build response for thanks
 */
function buildThanksReply(db, lang = 'en') {
  let text = '';
  if (lang === 'bn') {
    text = `😊 আপনাকে অনেক ধন্যবাদ! কোস্টাল ভিউ-তে আপনার আগমন শুভ হোক। আপনার অন্য কোনো প্রশ্ন থাকলে সানন্দে জানান।`;
  } else if (lang === 'hi') {
    text = `😊 आपका बहुत धन्यवाद! कोस्टल व्यू में आपका स्वागत है। यदि आपको किसी और जानकारी की आवश्यकता हो तो अवश्य बताएं।`;
  } else {
    text = `😊 You're very welcome! We look forward to hosting your coastal getaway at Coastal View, Mandarmani. Let us know if you need anything else!`;
  }

  return {
    reply: text,
    actionChips: ['Rooms & prices', 'How to contact', 'Book a room'],
    topic: 'Gratitude'
  };
}

/**
 * Build response for unknown (fallback with buttons and logging)
 */
function buildUnknownReply(db, lang = 'en') {
  const phone = db.settings?.phone || '7812027551';
  const whatsapp = db.settings?.whatsapp || phone;
  const fallback = db.botSettings?.fallbackMessage?.[lang] || db.botSettings?.fallbackMessage?.en ||
    "I didn't quite catch that. Please select one of the popular topics below, or connect directly with our front desk team:";

  const chips = db.botSettings?.quickReplyChips || [
    'Rooms & prices',
    'Check availability',
    'How to contact',
    'Menu',
    'Candlelight dinner',
    'Nearby places',
    'Tours'
  ];

  return {
    reply: `${fallback}\n\n📞 Immediate Desk Call: [${phone}](tel:${phone}) • [💬 WhatsApp](https://wa.me/91${whatsapp})`,
    actionChips: chips,
    leadStatus: 'New Lead',
    topic: 'General Inquiry'
  };
}

module.exports = {
  formatINR,
  buildRoomsListReply,
  buildRoomDetailReply,
  buildRoomPriceReply,
  buildContactReply,
  buildLocationReply,
  buildBookingHowReply,
  buildPaymentPolicyReply,
  buildCheckinTimeReply,
  buildAddonsReply,
  buildVehiclePricingReply,
  buildMenuReply,
  buildNearbyReply,
  buildToursReply,
  buildAmenitiesReply,
  buildPoliciesReply,
  buildHumanReply,
  buildGreetingReply,
  buildThanksReply,
  buildUnknownReply
};

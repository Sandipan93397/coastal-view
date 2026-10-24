/**
 * Section 5: Guided Booking Flow State Machine
 * 
 * Steps:
 * 1. dates (check-in, check-out) - validated: not in past, check-out > check-in
 * 2. guests (adults / children)
 * 3. rooms (number of rooms)
 * 4. room type (cards or buttons)
 * 5. optional add-ons:
 *    - vehicle: car / toto / auto / none
 *    - breakfast: yes / no (optional, not included)
 *    - candlelight dinner: beachside / poolside / none
 * 6. price summary (EXACT same formula as booking form):
 *    room + vehicle + breakfast + dinner + tax, 20% now (non-refundable), 80% at hotel
 *    "Continue to booking" button with fields pre-filled.
 * 
 * Navigation:
 * - "back": moves to previous step
 * - "restart": resets to step 1
 * - "cancel": cancels flow
 * - Never takes card details or payments in chat.
 */

const { formatINR } = require('./answer_builders');

// In-memory session state store (persisted in db as well)
const bookingSessions = new Map();

function parseStayDates(text) {
  const t = text.toLowerCase().trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Tomorrow check
  if (t === 'tomorrow' || t.includes('tomorrow 1 night') || t.includes('tomorrow')) {
    const cin = new Date(today);
    cin.setDate(cin.getDate() + 1);
    const cout = new Date(cin);
    cout.setDate(cout.getDate() + 1);
    return {
      checkIn: cin.toISOString().split('T')[0],
      checkOut: cout.toISOString().split('T')[0],
      nights: 1
    };
  }

  // Today check
  if (t === 'today' || t.includes('tonight')) {
    const cin = new Date(today);
    const cout = new Date(cin);
    cout.setDate(cout.getDate() + 1);
    return {
      checkIn: cin.toISOString().split('T')[0],
      checkOut: cout.toISOString().split('T')[0],
      nights: 1
    };
  }

  // YYYY-MM-DD pattern
  const isoDates = t.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (isoDates && isoDates.length >= 2) {
    const cin = new Date(isoDates[0]);
    const cout = new Date(isoDates[1]);
    if (!isNaN(cin) && !isNaN(cout) && cout > cin) {
      const diff = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));
      return {
        checkIn: isoDates[0],
        checkOut: isoDates[1],
        nights: diff
      };
    }
  }

  // Common date formats: "25 to 27 Dec", "25 Dec to 27 Dec", "25 Dec 2026 to 27 Dec 2026"
  const monthMap = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  const rangeMatch = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(?:([a-z]+))?\s*(?:to|-)\s*(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)(?:\s*(\d{4}))?/i);
  if (rangeMatch) {
    const d1 = parseInt(rangeMatch[1], 10);
    const m1Str = rangeMatch[2] ? rangeMatch[2].toLowerCase() : rangeMatch[4].toLowerCase();
    const d2 = parseInt(rangeMatch[3], 10);
    const m2Str = rangeMatch[4].toLowerCase();
    const year = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : today.getFullYear();

    const m1 = monthMap[m1Str] !== undefined ? monthMap[m1Str] : today.getMonth();
    const m2 = monthMap[m2Str] !== undefined ? monthMap[m2Str] : m1;

    const cin = new Date(year, m1, d1);
    const cout = new Date(year, m2, d2);

    if (cin < today) {
      cin.setFullYear(cin.getFullYear() + 1);
      cout.setFullYear(cout.getFullYear() + 1);
    }

    if (!isNaN(cin) && !isNaN(cout) && cout > cin) {
      const diff = Math.max(1, Math.round((cout - cin) / (1000 * 60 * 60 * 24)));
      return {
        checkIn: cin.toISOString().split('T')[0],
        checkOut: cout.toISOString().split('T')[0],
        nights: diff
      };
    }
  }

  // Single date e.g. "on 25 Dec" or "25 Dec" -> assumes 1 night stay
  const singleMatch = t.match(/(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (singleMatch) {
    const d = parseInt(singleMatch[1], 10);
    const mStr = singleMatch[2].toLowerCase();
    if (monthMap[mStr] !== undefined) {
      const year = singleMatch[3] ? parseInt(singleMatch[3], 10) : today.getFullYear();
      const cin = new Date(year, monthMap[mStr], d);
      if (cin < today) cin.setFullYear(cin.getFullYear() + 1);
      const cout = new Date(cin);
      cout.setDate(cout.getDate() + 1);
      return {
        checkIn: cin.toISOString().split('T')[0],
        checkOut: cout.toISOString().split('T')[0],
        nights: 1
      };
    }
  }

  return null;
}

class BookingStateMachine {
  constructor() {}

  getSession(sessionId) {
    if (!sessionId) return null;
    return bookingSessions.get(sessionId) || null;
  }

  initSession(sessionId) {
    const state = {
      step: 'awaiting_dates',
      checkIn: null,
      checkOut: null,
      nights: 1,
      guests: 2,
      roomsCount: 1,
      roomId: null,
      roomName: null,
      roomPrice: 0,
      vehicle: 'none',
      vehicleName: null,
      vehiclePrice: 0,
      breakfast: false,
      breakfastPrice: 0,
      candlelight: 'none',
      candlelightPrice: 0,
      stepHistory: []
    };
    bookingSessions.set(sessionId, state);
    return state;
  }

  clearSession(sessionId) {
    bookingSessions.delete(sessionId);
  }

  /**
   * Process message within booking state machine.
   * Returns: { handled: boolean, reply: string, actionChips: string[], cards?: any[], prefillUrl?: string }
   */
  process(sessionId, userMessage, db, lang = 'en') {
    let state = this.getSession(sessionId);
    const text = (userMessage || '').trim().toLowerCase();

    // Check cancellation
    if (text === 'cancel' || text === 'exit' || text === 'quit' || text === 'বাতিল') {
      this.clearSession(sessionId);
      return {
        handled: true,
        reply: lang === 'bn'
          ? '❌ বুকিং প্রক্রিয়া বাতিল করা হয়েছে। আপনার কি অন্য কোনো বিষয়ে তথ্য প্রয়োজন?'
          : '❌ Guided booking process cancelled. Feel free to explore our rooms, menu, or contact our front desk if you need assistance.',
        actionChips: ['Rooms & prices', 'Check availability', 'How to contact', 'Menu'],
        topic: 'Booking Cancelled'
      };
    }

    // Check restart
    if (text === 'restart' || text === 'start over' || text === 'পুনরায় শুরু') {
      state = this.initSession(sessionId);
      return this.renderStep(state, db, lang);
    }

    // Check back
    if (text === 'back' || text === 'পেছনে' || text === 'previous') {
      if (state && state.stepHistory.length > 0) {
        state.step = state.stepHistory.pop();
        return this.renderStep(state, db, lang);
      }
    }

    // If no active session, start one
    if (!state) {
      state = this.initSession(sessionId);
      return this.renderStep(state, db, lang);
    }

    // Handle state step progression
    switch (state.step) {
      case 'awaiting_dates': {
        const parsed = parseStayDates(text);
        if (!parsed) {
          return {
            handled: true,
            reply: (lang === 'bn'
              ? '⚠️ অনুগ্রহ করে আপনার চেক-ইন এবং চেক-আউট তারিখ লিখুন (যেমন: "25 Dec to 27 Dec" বা "Tomorrow"):'
              : '⚠️ Please enter your check-in and check-out dates (e.g., "25 Dec to 27 Dec" or tap "Tomorrow"):'),
            actionChips: ['Tomorrow (1 night)', 'This Weekend', '25 Dec to 27 Dec', 'Cancel']
          };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cin = new Date(parsed.checkIn);
        const cout = new Date(parsed.checkOut);

        if (cin < today) {
          return {
            handled: true,
            reply: '⚠️ Check-in date cannot be in the past. Please enter an upcoming arrival date:',
            actionChips: ['Tomorrow (1 night)', 'This Weekend', 'Cancel']
          };
        }
        if (cout <= cin) {
          return {
            handled: true,
            reply: '⚠️ Check-out date must be after check-in date. Please re-enter your dates:',
            actionChips: ['Tomorrow (1 night)', 'Cancel']
          };
        }

        state.checkIn = parsed.checkIn;
        state.checkOut = parsed.checkOut;
        state.nights = parsed.nights;

        state.stepHistory.push('awaiting_dates');
        state.step = 'awaiting_guests';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_guests': {
        let adults = 2;
        let children = 0;

        if (text.includes('child') || text.includes('kid') || text.includes('baccha')) {
          const cMatch = text.match(/(\d+)\s*(?:child|kid|baccha)/);
          if (cMatch) children = parseInt(cMatch[1], 10);
          else children = 1;
        }

        const aMatch = text.match(/(\d+)\s*(?:adult|grown|person|guest|manush|jon)/);
        if (aMatch) {
          adults = parseInt(aMatch[1], 10);
        } else {
          const numMatch = text.match(/\d+/);
          if (numMatch) {
            adults = parseInt(numMatch[0], 10);
          } else if (text.includes('family')) {
            adults = 4;
            children = 2;
          }
        }

        state.adults = Math.max(1, adults);
        state.children = Math.max(0, children);
        state.guests = state.adults + state.children;

        state.stepHistory.push('awaiting_guests');
        state.step = 'awaiting_rooms_count';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_rooms_count': {
        let count = 1;
        const numMatch = text.match(/\d+/);
        if (numMatch) {
          count = parseInt(numMatch[0], 10);
        }
        state.roomsCount = Math.max(1, Math.min(10, count));

        // Enforce 2 Adults + 1 Child per room scaling rule
        const reqAdults = state.adults || (state.guests || 2);
        const reqChildren = state.children || 0;
        const maxAdultsForRooms = 2 * state.roomsCount;
        const maxChildrenForRooms = 1 * state.roomsCount;

        if (reqAdults > maxAdultsForRooms || reqChildren > maxChildrenForRooms) {
          const neededRooms = Math.max(Math.ceil(reqAdults / 2), Math.ceil(reqChildren / 1));
          return {
            handled: true,
            reply: lang === 'bn'
              ? `⚠️ প্রতিটি রুমে সর্বোচ্চ ২ জন প্রাপ্তবয়স্ক এবং ১ জন শিশু থাকতে পারেন। অনুগ্রহ করে আরেকটি রুম যোগ করুন (Each room accommodates up to 2 adults and 1 child. Please add another room - ${neededRooms} টি রুম প্রয়োজন)।`
              : `⚠️ Each room accommodates up to 2 adults and 1 child. Please add another room (${neededRooms} rooms needed for ${reqAdults} adults${reqChildren ? ` + ${reqChildren} child` : ''}).`,
            actionChips: [`${neededRooms} Rooms`, '2 Adults + 1 Child', 'Cancel']
          };
        }

        state.stepHistory.push('awaiting_rooms_count');
        state.step = 'awaiting_room_selection';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_room_selection': {
        const rooms = (db.rooms || []).filter(r => !r.isArchived);
        let selected = null;

        if (text.includes('ocean') || text.includes('sea')) {
          selected = rooms.find(r => r.id === 'ocean-whisper-room') || rooms[0];
        } else if (text.includes('pool')) {
          selected = rooms.find(r => r.id === 'pool-haven-room') || rooms[1];
        } else if (text.includes('deluxe') || text.includes('cosy')) {
          selected = rooms.find(r => r.id === 'cosy-deluxe-room') || rooms[2];
        } else if (text.includes('family') || text.includes('palm')) {
          selected = rooms.find(r => r.id === 'palm-grove-family-suite') || rooms[3];
        } else {
          const num = parseInt(text, 10);
          if (!isNaN(num) && num >= 1 && num <= rooms.length) {
            selected = rooms[num - 1];
          }
        }

        if (!selected) {
          selected = rooms[0];
        }

        state.roomId = selected.id;
        state.roomName = selected.name;
        state.roomPrice = Number(selected.price) || 2500;

        state.stepHistory.push('awaiting_room_selection');
        state.step = 'awaiting_addons_vehicle';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_addons_vehicle': {
        if (text.includes('toto') || text.includes('টোটো')) {
          state.vehicle = 'toto';
          state.vehicleName = 'Toto (E-Rickshaw)';
          state.vehiclePrice = 200;
        } else if (text.includes('auto') || text.includes('অটো')) {
          state.vehicle = 'auto';
          state.vehicleName = 'Auto';
          state.vehiclePrice = 1200;
        } else if (text.includes('car') || text.includes('গাড়ি')) {
          state.vehicle = 'car';
          state.vehicleName = 'AC Car';
          state.vehiclePrice = 2500;
        } else {
          state.vehicle = 'none';
          state.vehicleName = null;
          state.vehiclePrice = 0;
        }

        state.stepHistory.push('awaiting_addons_vehicle');
        state.step = 'awaiting_addons_breakfast';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_addons_breakfast': {
        const bfPrice = Number(db.settings?.breakfastPrice) || 200;
        if (text.includes('yes') || text.includes('add') || text.includes('হ্যাঁ') || text.includes('breakfast')) {
          state.breakfast = true;
          state.breakfastPrice = bfPrice;
        } else {
          state.breakfast = false;
          state.breakfastPrice = 0;
        }

        state.stepHistory.push('awaiting_addons_breakfast');
        state.step = 'awaiting_addons_candlelight';
        return this.renderStep(state, db, lang);
      }

      case 'awaiting_addons_candlelight': {
        const beachPrice = Number(db.settings?.candlelightDinnerBeachside) || 3500;
        const poolPrice = Number(db.settings?.candlelightDinnerPoolside) || 2800;

        if (text.includes('beach')) {
          state.candlelight = 'beachside';
          state.candlelightPrice = beachPrice;
        } else if (text.includes('pool')) {
          state.candlelight = 'poolside';
          state.candlelightPrice = poolPrice;
        } else {
          state.candlelight = 'none';
          state.candlelightPrice = 0;
        }

        state.stepHistory.push('awaiting_addons_candlelight');
        state.step = 'summary';
        return this.renderSummary(state, db, lang);
      }

      case 'summary': {
        // If guest continues typing or clicks button, keep summary active or exit
        return this.renderSummary(state, db, lang);
      }

      default:
        state = this.initSession(sessionId);
        return this.renderStep(state, db, lang);
    }
  }

  renderStep(state, db, lang = 'en') {
    switch (state.step) {
      case 'awaiting_dates': {
        const reply = lang === 'bn'
          ? `📅 **ধাপ ১: আপনার থাকার তারিখ বেছে নিন:**\n\nআপনি কবে চেক-ইন ও চেক-আউট করতে চান? লিখুন যেমন: "25 Dec to 27 Dec" বা নিচের দ্রুত বোতামে ট্যাপ করুন:`
          : `📅 **Step 1 of 5: Choose your Stay Dates:**\n\nWhen would you like to arrive and depart? Type e.g., "25 Dec to 27 Dec" or tap a quick option below:`;
        return {
          handled: true,
          reply,
          actionChips: ['Tomorrow (1 night)', 'This Weekend', '25 Dec to 27 Dec', 'Cancel']
        };
      }

      case 'awaiting_guests': {
        const reply = lang === 'bn'
          ? `👥 **ধাপ ২: অতিথির সংখ্যা:**\n\nকজন অতিথি থাকবেন? নিচের থেকে নির্বাচন করুন:\n*(প্রতি রুমে সর্বোচ্চ ২ জন প্রাপ্তবয়স্ক + ১ জন শিশু)*`
          : `👥 **Step 2 of 5: Number of Guests:**\n\nHow many adults and children will be staying?\n*(Each room accommodates up to 2 adults and 1 child)*`;
        return {
          handled: true,
          reply,
          actionChips: ['2 Adults', '2 Adults + 1 Child', '1 Adult', '4 Adults (2 Rooms)', 'Back', 'Cancel']
        };
      }

      case 'awaiting_rooms_count': {
        const reply = lang === 'bn'
          ? `🏨 **ধাপ ৩: কতগুলি রুম প্রয়োজন?**`
          : `🏨 **Step 3 of 5: Number of Rooms:**\n\nHow many rooms do you need?`;
        return {
          handled: true,
          reply,
          actionChips: ['1 Room', '2 Rooms', '3 Rooms', 'Back', 'Cancel']
        };
      }

      case 'awaiting_room_selection': {
        const rooms = (db.rooms || []).filter(r => !r.isArchived);
        const chips = rooms.map(r => `${r.name} (${formatINR(r.price)})`);
        chips.push('Back', 'Cancel');

        const reply = lang === 'bn'
          ? `🛏️ **ধাপ ৪: রুম নির্বাচন করুন:**\n\nআপনার ${state.nights} রাতের থাকার জন্য কোন রুমটি পছন্দ?`
          : `🛏️ **Step 4 of 5: Select Room Type:**\n\nChoose your preferred room for ${state.nights} night(s) stay:`;
        return {
          handled: true,
          reply,
          actionChips: chips
        };
      }

      case 'awaiting_addons_vehicle': {
        const reply = lang === 'bn'
          ? `🚗 **ধাপ ৫ (ক): আপনার কি স্টেশন বা লোকাল পিকআপ প্রয়োজন?**`
          : `🚗 **Step 5 (Optional Add-ons) — Vehicle Pickup:**\n\nDo you need Toto or Car pickup for your arrival?`;
        return {
          handled: true,
          reply,
          actionChips: ['No vehicle needed', 'Toto (₹200/day)', 'Auto (₹1,200/day)', 'Car (₹2,500/day)', 'Back', 'Cancel']
        };
      }

      case 'awaiting_addons_breakfast': {
        const bfPrice = db.settings?.breakfastPrice || 200;
        const reply = lang === 'bn'
          ? `🍳 **ধাপ ৫ (খ): প্রতিদিনের ব্রেকফাস্ট যোগ করতে চান?**\n\n(ব্রেকফাস্ট ঐচ্ছিক ও রুম ভাড়ায় অন্তর্ভুক্ত নয় — মাত্র ${formatINR(bfPrice)}/জন/দিন)`
          : `🍳 **Step 5 (Optional Add-ons) — Breakfast:**\n\nWould you like to include fresh daily breakfast?\n*(Breakfast is optional and not included in room tariff — ${formatINR(bfPrice)} per person per day)*`;
        return {
          handled: true,
          reply,
          actionChips: [`Add Breakfast (${formatINR(bfPrice)})`, 'No breakfast', 'Back', 'Cancel']
        };
      }

      case 'awaiting_addons_candlelight': {
        const reply = lang === 'bn'
          ? `🕯️ **ধাপ ৫ (গ): বিশেষ রোমান্টিক ক্যান্ডেললাইট ডিনার যোগ করতে চান?**`
          : `🕯️ **Step 5 (Optional Add-ons) — Candlelight Celebration:**\n\nWould you like to surprise your partner with a private beachside or poolside candlelight setup?`;
        return {
          handled: true,
          reply,
          actionChips: ['No dinner setup', 'Beachside Candlelight (₹3,500)', 'Poolside Candlelight (₹2,800)', 'Back', 'Cancel']
        };
      }
    }
  }

  renderSummary(state, db, lang = 'en') {
    const nights = state.nights || 1;
    const roomsCount = state.roomsCount || 1;
    const guests = state.guests || 2;

    // Room Subtotal = roomPrice * roomsCount * nights
    const roomSubtotal = state.roomPrice * roomsCount * nights;

    // Vehicle Subtotal = vehiclePrice * nights
    const vehicleTotal = state.vehiclePrice > 0 ? (state.vehiclePrice * nights) : 0;

    // Breakfast Subtotal = breakfastPrice * guests * nights
    const breakfastTotal = state.breakfast ? (state.breakfastPrice * guests * nights) : 0;

    // Dinner Subtotal
    const dinnerTotal = state.candlelightPrice || 0;

    // Estimated Grand Total
    const subtotal = roomSubtotal + vehicleTotal + breakfastTotal + dinnerTotal;

    // Advance 20% & Hotel 80%
    const advPercent = db.settings?.advancePercentage || 20;
    const balPercent = db.settings?.balancePercentage || 80;
    const payNow = Math.round((subtotal * advPercent) / 100);
    const payAtHotel = subtotal - payNow;

    // Pre-fill booking link
    const params = new URLSearchParams({
      room: state.roomId,
      checkIn: state.checkIn,
      checkOut: state.checkOut,
      rooms: String(roomsCount),
      guests: String(guests)
    });
    if (state.vehicle !== 'none') {
      params.set('vehicle', state.vehicle);
      params.set('carCount', '1');
    }
    if (state.candlelight !== 'none') {
      params.set('candlelight', state.candlelight);
    }
    const prefillUrl = `/index.html#bookingSection?${params.toString()}`;

    let summaryText = '';
    if (lang === 'bn') {
      summaryText = `🎉 **আপনার প্যাকেজের সম্পূর্ণ হিসাব ও মূল্য বিবরণ:**\n\n` +
        `🏨 **রুম:** ${state.roomName}\n` +
        `📅 **তারিখ:** ${state.checkIn} থেকে ${state.checkOut} (${nights} রাত, ${roomsCount} টি রুম, ${guests} জন অতিথি)\n` +
        `• রুমের ভাড়া: ${formatINR(state.roomPrice)} × ${roomsCount} রুম × ${nights} রাত = **${formatINR(roomSubtotal)}**\n` +
        (vehicleTotal > 0 ? `• যানবাহন (${state.vehicleName}): ${formatINR(state.vehiclePrice)} × ${nights} দিন = **${formatINR(vehicleTotal)}**\n` : '') +
        (breakfastTotal > 0 ? `• ব্রেকফাস্ট: ${formatINR(state.breakfastPrice)} × ${guests} জন × ${nights} দিন = **${formatINR(breakfastTotal)}**\n` : '') +
        (dinnerTotal > 0 ? `• ক্যান্ডেললাইট ডিনার: **${formatINR(dinnerTotal)}**\n` : '') +
        `\n─────────────────────────────\n` +
        `💰 **মোট প্রদেয় মূল্য:** **${formatINR(subtotal)}**\n` +
        `🔒 **${advPercent}% অগ্রিম অনলাইন পেমেন্ট:** **${formatINR(payNow)}** *(অফেরতযোগ্য)*\n` +
        `🏨 **অবশিষ্ট ${balPercent}% টাকা হোটেলে পৌঁছানোর পর:** **${formatINR(payAtHotel)}**\n\n` +
        `👉 **বুকিং নিশ্চিত করতে নিচের বোতামে ক্লিক করে ফর্মটি জমা দিন:**`;
    } else {
      summaryText = `🎉 **Exact Price Breakdown & Stay Summary:**\n\n` +
        `🏨 **Room:** ${state.roomName}\n` +
        `📅 **Dates:** ${state.checkIn} to ${state.checkOut} (${nights} night(s), ${roomsCount} room(s), ${guests} guest(s))\n\n` +
        `• Room Tariff: ${formatINR(state.roomPrice)} × ${roomsCount} room(s) × ${nights} night(s) = **${formatINR(roomSubtotal)}**\n` +
        (vehicleTotal > 0 ? `• Transport (${state.vehicleName}): ${formatINR(state.vehiclePrice)} × ${nights} day(s) = **${formatINR(vehicleTotal)}**\n` : '') +
        (breakfastTotal > 0 ? `• Optional Breakfast: ${formatINR(state.breakfastPrice)} × ${guests} guest(s) × ${nights} day(s) = **${formatINR(breakfastTotal)}**\n` : '') +
        (dinnerTotal > 0 ? `• Candlelight Celebration: **${formatINR(dinnerTotal)}**\n` : '') +
        `\n─────────────────────────────\n` +
        `💰 **Estimated Total:** **${formatINR(subtotal)}**\n` +
        `🔒 **${advPercent}% Advance Payable Now:** **${formatINR(payNow)}** *(Non-refundable)*\n` +
        `🏨 **${balPercent}% Balance at Hotel:** **${formatINR(payAtHotel)}**\n\n` +
        `👉 **Tap "Continue to booking" below to complete your reservation with all fields pre-filled:**`;
    }

    return {
      handled: true,
      reply: summaryText,
      prefillUrl,
      actionChips: ['Continue to booking', 'Restart booking', 'Cancel'],
      isSummary: true,
      bookingState: state,
      topic: 'Guided Booking'
    };
  }
}

module.exports = {
  BookingStateMachine,
  parseStayDates
};

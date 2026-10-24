/**
 * Chatbot Engine - 4-Layer Architecture Coordinator
 * 
 * Layer 1: Normalizer (normalizeText, detectLanguage, typo corrections)
 * Layer 2: Intent Router (rules, whole-phrase matching, generic word protection)
 * Layer 3: Answer Builders (100% admin grounded replies, horizontal room cards)
 * Layer 4: AI Fallback (optional, off by default, limited tools, daily limits)
 * 
 * Guided Booking State Machine:
 * - Steps: dates -> guests -> rooms -> room selection -> addons -> exact price breakdown
 */

const fs = require('fs');
const path = require('path');
const { normalizeText, detectLanguage } = require('./normalizer');
const { IntentRouter } = require('./intent_router');
const defaultIntentsConfig = require('./intents.json');
const {
  formatINR,
  buildRoomsListReply,
  buildRoomDetailReply,
  buildRoomPriceReply,
  buildRoomCapacityReply,
  buildContactReply,
  buildLocationReply,
  buildBookingHowReply,
  buildPaymentPolicyReply,
  buildCheckinTimeReply,
  buildAddonsReply,
  buildMenuReply,
  buildNearbyReply,
  buildToursReply,
  buildAmenitiesReply,
  buildPoliciesReply,
  buildHumanReply,
  buildGreetingReply,
  buildThanksReply,
  buildUnknownReply
} = require('./answer_builders');
const { BookingStateMachine, parseStayDates } = require('./booking_state_machine');
const { AIFallbackProvider } = require('./ai_fallback');

// Rate limiting in-memory store
const ipRequests = new Map(); // ip -> [timestamps]
const sessionRequests = new Map(); // sessionId -> [timestamps]

const MAX_MESSAGE_LENGTH = 500;
const RATE_LIMIT_IP_PER_MIN = 60;
const RATE_LIMIT_SESSION_MAX = 120;

class ChatbotEngine {
  constructor() {
    this.intentRouter = new IntentRouter(defaultIntentsConfig);
    this.bookingStateMachine = new BookingStateMachine();
    this.aiFallbackProvider = new AIFallbackProvider();
  }

  /**
   * Sync intent definitions from database if configured, or use defaults.
   */
  syncIntents(db) {
    if (db && Array.isArray(db.chatbotIntents) && db.chatbotIntents.length > 0) {
      this.intentRouter.setIntents(db.chatbotIntents);
    } else {
      this.intentRouter.setIntents(defaultIntentsConfig);
    }
  }

  /**
   * Check rate limit for IP and session
   */
  isRateLimited(ip, sessionId) {
    const now = Date.now();
    const oneMinAgo = now - 60000;

    // IP rate limit
    if (ip) {
      let ipTimestamps = ipRequests.get(ip) || [];
      ipTimestamps = ipTimestamps.filter(t => t > oneMinAgo);
      if (ipTimestamps.length >= RATE_LIMIT_IP_PER_MIN) {
        return true;
      }
      ipTimestamps.push(now);
      ipRequests.set(ip, ipTimestamps);
    }

    // Session rate limit
    if (sessionId) {
      let sessTimestamps = sessionRequests.get(sessionId) || [];
      sessTimestamps = sessTimestamps.filter(t => t > oneMinAgo);
      if (sessTimestamps.length >= RATE_LIMIT_SESSION_MAX) {
        return true;
      }
      sessTimestamps.push(now);
      sessionRequests.set(sessionId, sessTimestamps);
    }

    return false;
  }

  /**
   * Process an incoming guest chat message through the 4 layers.
   */
  async processMessage({
    message,
    lang = 'en',
    sessionId = 'default-sess',
    clientIp = '127.0.0.1',
    db,
    skipRateLimit = false
  }) {
    this.syncIntents(db);

    const deskPhone = db?.settings?.phone || '7812027551';
    const whatsapp = db?.settings?.whatsapp || deskPhone;

    // 1. Check rate limits
    if (!skipRateLimit && this.isRateLimited(clientIp, sessionId)) {
      return {
        reply: `⚠️ You are sending requests too quickly. For immediate assistance, please call our front desk directly at [📞 ${deskPhone}](tel:${deskPhone}).`,
        actionChips: ['Call ' + deskPhone, 'Chat on WhatsApp'],
        topic: 'Rate Limited',
        intent: 'rate_limited'
      };
    }

    // 2. Cap message length
    let rawText = (message || '').trim();
    if (rawText.length > MAX_MESSAGE_LENGTH) {
      rawText = rawText.slice(0, MAX_MESSAGE_LENGTH);
    }

    // 3. Handle empty input gracefully
    if (!rawText) {
      return {
        reply: `How may I assist you today with your Mandarmani vacation? Choose an option below or ask any question:`,
        actionChips: ['Rooms & prices', 'Check availability', 'How to contact', 'Menu', 'Book a room'],
        topic: 'Greeting',
        intent: 'greeting'
      };
    }

    // Layer 1: Normalize & detect language
    const normalized = normalizeText(rawText);
    const detectedLang = detectLanguage(rawText, normalized) || lang || 'en';

    // Layer 2: Intent Router
    const routeResult = this.intentRouter.route(rawText, detectedLang);
    let { intentId, confidence, matchedPhrase, needsClarification } = routeResult;

    // Handle Safety: Injection defense
    if (intentId === 'safety_injection') {
      return {
        reply: `🔒 For security and compliance, our front desk system operates strictly under official resort policies and published rates. No unauthorized overrides or discount scripts are permitted. For special group inquiries, please contact our manager directly at [📞 ${deskPhone}](tel:${deskPhone}).`,
        actionChips: ['Rooms & prices', 'How to contact', 'Official Policies'],
        topic: 'Security Deflection',
        intent: 'safety_injection'
      };
    }

    // Handle Safety: Off-topic deflection
    if (intentId === 'off_topic') {
      return {
        reply: `I am specialized specifically as the Coastal View resort concierge in Mandarmani, West Bengal. I can help you with room reservations, dining menus, travel arrangements, and local sightseeing. How may I assist your stay?`,
        actionChips: ['Rooms & prices', 'Check availability', 'Menu', 'How to contact'],
        topic: 'Off-Topic Deflection',
        intent: 'off_topic'
      };
    }

    // Handle Safety: Sensitive Card / ID warning
    if (intentId === 'card_id_warning') {
      return {
        reply: `⚠️ **Security Alert:** For your personal security, please never share credit/debit card numbers, CVVs, or government ID numbers in chat. Our website never collects card details in dialogue. You may book safely via our encrypted booking form or call our front desk at [📞 ${deskPhone}](tel:${deskPhone}).`,
        actionChips: ['Book a room', 'How to contact', 'Payment policy'],
        topic: 'Card ID Protection',
        intent: 'card_id_warning'
      };
    }

    // Handle Clarifying Question when intent confidence is low
    if (needsClarification) {
      return {
        reply: detectedLang === 'bn'
          ? `আমি ঠিক বুঝতে পারিনি। আপনি কি রুমের তথ্য, প্রাপ্যতা যাচাই, নাকি ফ্রন্ট ডেস্কে যোগাযোগ করতে চান?`
          : `I want to make sure I assist you accurately. Are you looking to view room rates, check availability, or contact our front desk?`,
        actionChips: routeResult.clarificationOptions || ['Rooms & prices', 'Check availability', 'How to contact', 'Menu', 'Book a room'],
        topic: 'Clarification',
        intent: 'clarification'
      };
    }

    // Check Guided Booking State Machine:
    // If user has an active booking session OR clicked "Book a room" / intent === 'booking_start'
    const activeBookingSession = this.bookingStateMachine.getSession(sessionId);
    if (activeBookingSession || intentId === 'booking_start') {
      // If intent is clearly another topic (like "how to contact" or "menu"), exit booking session unless user is answering steps
      const isBookingControl = ['back', 'restart', 'cancel', 'exit', 'tomorrow', 'this weekend'].includes(normalized) ||
        /\b\d+\b/.test(normalized) ||
        parseStayDates(normalized) !== null ||
        ['none', 'toto', 'auto', 'car', 'yes', 'no', 'beach', 'pool'].some(k => normalized.includes(k));

      if (activeBookingSession && !isBookingControl && (intentId === 'contact' || intentId === 'location' || intentId === 'menu' || intentId === 'human')) {
        this.bookingStateMachine.clearSession(sessionId);
      } else {
        const bookingResult = this.bookingStateMachine.process(sessionId, rawText, db, detectedLang);
        if (bookingResult.handled) {
          return {
            ...bookingResult,
            intent: (intentId === 'booking_start' ? 'booking_start' : 'booking_flow'),
            isBookingFlow: true,
            language: detectedLang
          };
        }
      }
    }

    // Layer 3: Answer Builders
    let builderResult = null;

    switch (intentId) {
      case 'greeting':
        builderResult = buildGreetingReply(db, detectedLang);
        break;

      case 'contact':
        builderResult = buildContactReply(db, detectedLang);
        break;

      case 'location':
        builderResult = buildLocationReply(db, detectedLang);
        break;

      case 'rooms_list':
        builderResult = buildRoomsListReply(db, detectedLang);
        break;

      case 'room_detail':
        builderResult = buildRoomDetailReply(db, rawText, detectedLang);
        break;

      case 'room_price':
        builderResult = buildRoomPriceReply(db, detectedLang);
        break;

      case 'room_capacity':
        builderResult = buildRoomCapacityReply(db, detectedLang);
        break;

      case 'availability': {
        const parsed = parseStayDates(rawText);
        if (parsed) {
          // Check inventory for dates
          builderResult = buildRoomsListReply(db, detectedLang);
          builderResult.reply = (detectedLang === 'bn'
            ? `📅 **${parsed.checkIn} থেকে ${parsed.checkOut} (${parsed.nights} রাত)-এর প্রাপ্যতা:**\n\n`
            : `📅 **Availability for ${parsed.checkIn} to ${parsed.checkOut} (${parsed.nights} night(s)):**\n\n`) + builderResult.reply;
        } else {
          builderResult = {
            reply: detectedLang === 'bn'
              ? `📅 আপনি কোন তারিখে রুম খুঁজছেন? নিচে থেকে নির্বাচন করুন বা তারিখ লিখুন (যেমন "25 Dec"):`
              : `📅 Which dates are you planning to visit? Tap below or type your arrival date (e.g. "25 Dec"):`,
            actionChips: ['Today', 'Tomorrow', 'This Weekend', 'Rooms & prices', 'How to contact'],
            topic: 'Availability Check'
          };
        }
        break;
      }

      case 'booking_how':
        builderResult = buildBookingHowReply(db, detectedLang);
        break;

      case 'payment_policy':
        builderResult = buildPaymentPolicyReply(db, detectedLang);
        break;

      case 'checkin_time':
        builderResult = buildCheckinTimeReply(db, detectedLang);
        break;

      case 'addons':
        builderResult = buildAddonsReply(db, rawText, detectedLang);
        break;

      case 'menu':
        builderResult = buildMenuReply(db, rawText, detectedLang);
        break;

      case 'nearby':
        builderResult = buildNearbyReply(db, detectedLang);
        break;

      case 'tours':
        builderResult = buildToursReply(db, detectedLang);
        break;

      case 'amenities':
        builderResult = buildAmenitiesReply(db, detectedLang);
        break;

      case 'policies':
        builderResult = buildPoliciesReply(db, detectedLang);
        break;

      case 'human':
        builderResult = buildHumanReply(db, detectedLang);
        break;

      case 'thanks':
        builderResult = buildThanksReply(db, detectedLang);
        break;

      case 'unknown':
      default: {
        // Layer 4: AI Fallback check
        const aiFallbackResult = await this.aiFallbackProvider.executeFallback({
          message: rawText,
          lang: detectedLang,
          db
        });

        if (aiFallbackResult && aiFallbackResult.reply) {
          builderResult = {
            reply: aiFallbackResult.reply,
            actionChips: ['Rooms & prices', 'Check availability', 'How to contact', 'Menu'],
            topic: 'AI Fallback Assistance',
            toolsCalled: aiFallbackResult.toolsCalled || []
          };
        } else {
          // Standard Unknown Fallback + Log phrase to db.unmatchedPhrases
          builderResult = buildUnknownReply(db, detectedLang);
          this.logUnmatchedPhrase(db, rawText, normalized, detectedLang);
        }
        break;
      }
    }

    return {
      ...builderResult,
      intent: intentId,
      language: detectedLang,
      matchedPhrase
    };
  }

  /**
   * Log unmatched phrase to database for continuous admin learning
   */
  logUnmatchedPhrase(db, rawPhrase, normalized, lang) {
    if (!db) return;
    db.unmatchedPhrases = db.unmatchedPhrases || [];

    const existing = db.unmatchedPhrases.find(u => u.normalizedPhrase === normalized);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeenAt = new Date().toISOString();
    } else {
      db.unmatchedPhrases.push({
        id: `unmatched-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        phrase: rawPhrase,
        normalizedPhrase: normalized,
        language: lang || 'en',
        count: 1,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        assignedIntent: null
      });
    }
  }
}

module.exports = {
  ChatbotEngine
};

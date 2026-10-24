/**
 * Layer 2: Intent Router (Deterministic Rules, No AI)
 * 
 * Scores messages against intent phrases in priority order:
 * - Matches WHOLE PHRASES, never single loose words.
 * - Single generic words ('how', 'book', 'room', 'price') never decide intent alone.
 * - If two intents match, the more specific one wins (e.g., 'contact' beats 'booking' for 'how to contact').
 * - If confidence is low or ambiguous, returns a clarifying question with buttons.
 */

const { normalizeText, detectLanguage } = require('./normalizer');

// Generic non-informative single words that must NEVER decide intent alone
const GENERIC_ISOLATED_WORDS = new Set([
  'how', 'the', 'is', 'a', 'an', 'what', 'to', 'for', 'in', 'on', 'at', 'with',
  'ki', 'kya', 'hai', 'er', 'karo', 'ek', 'ekta', 'tell', 'me', 'our',
  'please', 'plz', 'help'
]);

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class IntentRouter {
  constructor(intentsConfig = []) {
    this.intents = intentsConfig;
  }

  /**
   * Set or update intent definitions dynamically (e.g. from admin panel or database).
   */
  setIntents(intentsConfig) {
    if (Array.isArray(intentsConfig) && intentsConfig.length > 0) {
      this.intents = intentsConfig;
    }
  }

  /**
   * Match a normalized message to an intent.
   * Returns: { intentId, confidence, language, matchedPhrase, needsClarification, clarificationOptions }
   */
  route(rawMessage, langHint = 'en') {
    const raw = (rawMessage || '').trim();
    if (!raw) {
      return {
        intentId: 'unknown',
        confidence: 0,
        language: langHint || 'en',
        matchedPhrase: null,
        needsClarification: false
      };
    }

    const normalized = normalizeText(raw);
    const lang = detectLanguage(raw, normalized) || langHint || 'en';

    // 1. Safety & prompt injection check first
    if (this.isPromptInjection(normalized)) {
      return {
        intentId: 'safety_injection',
        confidence: 100,
        language: lang,
        matchedPhrase: 'prompt_injection_detected',
        needsClarification: false
      };
    }

    // 2. Off-topic check
    if (this.isOffTopic(normalized)) {
      return {
        intentId: 'off_topic',
        confidence: 100,
        language: lang,
        matchedPhrase: 'off_topic_query',
        needsClarification: false
      };
    }

    // 3. Card/ID privacy violation check
    if (this.hasCardOrIdPattern(raw)) {
      return {
        intentId: 'card_id_warning',
        confidence: 100,
        language: lang,
        matchedPhrase: 'sensitive_payment_card_pattern',
        needsClarification: false
      };
    }

    // 4. Reject single generic isolated words alone
    const words = normalized.split(' ').filter(Boolean);
    if (words.length === 1 && GENERIC_ISOLATED_WORDS.has(words[0])) {
      return {
        intentId: 'clarification',
        confidence: 30,
        language: lang,
        matchedPhrase: words[0],
        needsClarification: true,
        clarificationOptions: ['Rooms & prices', 'Check availability', 'How to contact', 'Menu', 'Book a room']
      };
    }

    // 5. Score every intent
    const scoredIntents = [];

    for (const intent of this.intents) {
      if (intent.id === 'unknown') continue;

      let bestScore = 0;
      let bestPhrase = null;

      for (const rawPhrase of (intent.phrases || [])) {
        const p = normalizeText(rawPhrase);
        if (!p) continue;

        const score = this.calculatePhraseScore(normalized, p, words);
        if (score > bestScore) {
          bestScore = score;
          bestPhrase = rawPhrase;
        }
      }

      if (bestScore > 0) {
        // Total score accounts for phrase match quality plus intent specificity priority
        const totalScore = bestScore + (intent.priority * 0.4);
        scoredIntents.push({
          intentId: intent.id,
          priority: intent.priority,
          matchScore: bestScore,
          totalScore,
          bestPhrase
        });
      }
    }

    // 6. Sort by totalScore descending
    scoredIntents.sort((a, b) => b.totalScore - a.totalScore);

    // 7. Specificity resolution rules:
    // If top match is ambiguous or needs precedence resolution:
    if (scoredIntents.length > 0) {
      const top = scoredIntents[0];

      // Explicit specificity rule: Contact queries ("how to contact", "phone", "whatsapp", "call")
      // MUST ALWAYS beat booking_start or booking_how
      const hasContactIntent = scoredIntents.find(s => s.intentId === 'contact');
      if (hasContactIntent && hasContactIntent.matchScore >= 80) {
        if (top.intentId === 'booking_start' || top.intentId === 'booking_how' || top.intentId === 'rooms_list') {
          return {
            intentId: 'contact',
            confidence: hasContactIntent.totalScore,
            language: lang,
            matchedPhrase: hasContactIntent.bestPhrase,
            needsClarification: false
          };
        }
      }

      // Explicit specificity rule: Room Detail beats generic Rooms List
      const hasRoomDetail = scoredIntents.find(s => s.intentId === 'room_detail');
      if (hasRoomDetail && hasRoomDetail.matchScore >= 80) {
        if (top.intentId === 'rooms_list' || top.intentId === 'booking_start') {
          return {
            intentId: 'room_detail',
            confidence: hasRoomDetail.totalScore,
            language: lang,
            matchedPhrase: hasRoomDetail.bestPhrase,
            needsClarification: false
          };
        }
      }

      // Explicit specificity rule: Room Price beats generic Rooms List
      const hasRoomPrice = scoredIntents.find(s => s.intentId === 'room_price');
      if (hasRoomPrice && hasRoomPrice.matchScore >= 80) {
        if (top.intentId === 'rooms_list' || top.intentId === 'booking_start') {
          return {
            intentId: 'room_price',
            confidence: hasRoomPrice.totalScore,
            language: lang,
            matchedPhrase: hasRoomPrice.bestPhrase,
            needsClarification: false
          };
        }
      }

      // Explicit specificity rule: Breakfast query in Addons beats Menu
      const hasAddons = scoredIntents.find(s => s.intentId === 'addons');
      if (hasAddons && hasAddons.matchScore >= 80) {
        if (top.intentId === 'menu' && (normalized.includes('breakfast') || normalized.includes('নাস্তা') || normalized.includes('ব্রেকফাস্ট'))) {
          return {
            intentId: 'addons',
            confidence: hasAddons.totalScore,
            language: lang,
            matchedPhrase: hasAddons.bestPhrase,
            needsClarification: false
          };
        }
      }

      // Explicit specificity rule: Location query ("address", "kothay") beats booking_how
      const hasLocation = scoredIntents.find(s => s.intentId === 'location');
      if (hasLocation && hasLocation.matchScore >= 80) {
        if (top.intentId === 'booking_how') {
          return {
            intentId: 'location',
            confidence: hasLocation.totalScore,
            language: lang,
            matchedPhrase: hasLocation.bestPhrase,
            needsClarification: false
          };
        }
      }

      // If confidence is sufficiently high (> 50), return top intent
      if (top.matchScore >= 50) {
        return {
          intentId: top.intentId,
          confidence: top.totalScore,
          language: lang,
          matchedPhrase: top.bestPhrase,
          needsClarification: false
        };
      }

      // If confidence is between 30 and 50 and two intents are tied
      if (scoredIntents.length >= 2 && Math.abs(scoredIntents[0].totalScore - scoredIntents[1].totalScore) < 5) {
        return {
          intentId: 'clarification',
          confidence: top.totalScore,
          language: lang,
          matchedPhrase: top.bestPhrase,
          needsClarification: true,
          clarificationOptions: ['Rooms & prices', 'Check availability', 'How to contact', 'Menu', 'Book a room']
        };
      }
    }

    // 8. Default to unknown
    return {
      intentId: 'unknown',
      confidence: 0,
      language: lang,
      matchedPhrase: null,
      needsClarification: false
    };
  }

  /**
   * Calculate phrase match score between normalized message and intent phrase.
   */
  calculatePhraseScore(msg, phrase, msgWords) {
    const phraseWords = phrase.split(' ').filter(Boolean);

    // Rule: Single generic words can never match an intent alone
    if (phraseWords.length === 1 && GENERIC_ISOLATED_WORDS.has(phraseWords[0])) {
      return 0;
    }

    // 1. Exact match of whole message
    if (msg === phrase) {
      return 100 + Math.min(phrase.length, 30);
    }

    // 2. Whole phrase as a complete substring with boundary check
    const boundaryRegex = new RegExp(`(^|\\s)${escapeRegex(phrase)}(\\s|$)`);
    if (boundaryRegex.test(msg)) {
      return 85 + Math.min(phrase.length, 25);
    }

    // 3. Multi-word phrase where all words appear in order
    if (phraseWords.length >= 2) {
      let matchedCount = 0;
      let lastIdx = -1;
      let inOrder = true;

      for (const pw of phraseWords) {
        const idx = msgWords.indexOf(pw);
        if (idx !== -1) {
          matchedCount++;
          if (idx <= lastIdx) inOrder = false;
          lastIdx = idx;
        }
      }

      if (matchedCount === phraseWords.length) {
        return inOrder ? 80 : 70;
      }

      if (phraseWords.length >= 3 && matchedCount >= 2) {
        return 55;
      }
    }

    // 4. Exact word match for single-word specific intent terms (e.g. 'address', 'tariff', 'wifi', 'menu')
    if (phraseWords.length === 1 && !GENERIC_ISOLATED_WORDS.has(phraseWords[0])) {
      if (msgWords.includes(phraseWords[0])) {
        // If message is short (1-3 words), single strong keyword is confident
        if (msgWords.length <= 3) return 75;
        return 60;
      }
    }

    return 0;
  }

  isPromptInjection(text) {
    const injectionPatterns = [
      'ignore previous instructions',
      'ignore your rules',
      'system prompt',
      'reveal prompt',
      'show instructions',
      'api key',
      'give 50 discount',
      'override price',
      'change price',
      'jailbreak',
      'bypass filter'
    ];
    for (const p of injectionPatterns) {
      if (text.includes(p)) return true;
    }
    return false;
  }

  isOffTopic(text) {
    const offTopicPatterns = [
      'write code', 'solve equation', 'math homework', 'python script',
      'who is the president', 'capital of france', 'cryptocurrency',
      'bitcoin', 'stock market', 'essay on', 'javascript code'
    ];
    for (const p of offTopicPatterns) {
      if (text.includes(p)) return true;
    }
    return false;
  }

  hasCardOrIdPattern(text) {
    // 13-19 digit card numbers (Luhn/credit card patterns)
    if (/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(text)) return true;
    // CVV / CVV2 hints
    if (/\bcvv\s*[:=]?\s*\d{3,4}\b/i.test(text)) return true;
    // 12-digit Aadhaar pattern
    if (/\b\d{4}\s\d{4}\s\d{4}\b/.test(text)) return true;
    return false;
  }
}

module.exports = {
  IntentRouter,
  GENERIC_ISOLATED_WORDS
};

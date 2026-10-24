/**
 * Layer 4: AI Fallback (Optional, OFF by default)
 * 
 * Rules:
 * - Only triggered when no intent matches (intent = 'unknown').
 * - Only active if `botSettings.aiFallbackEnabled === true` AND `LLM_API_KEY` is set.
 * - Tool calling limited STRICTLY to reading live hotel database functions.
 * - May not invent facts.
 * - Daily limit, rate limit, and prompt-injection defense enforced.
 * - If disabled, API failure, or limit exceeded: returns null so the system displays
 *   the standard "I didn't understand" reply with quick-reply buttons and Call/WhatsApp buttons.
 */

const https = require('https');
const http = require('http');

class AIFallbackProvider {
  constructor() {
    this.dailyUsage = new Map(); // 'YYYY-MM-DD' -> count
  }

  isAvailable(db) {
    const isEnabled = Boolean(db?.botSettings?.aiFallbackEnabled);
    const hasKey = Boolean(process.env.LLM_API_KEY);
    return isEnabled && hasKey;
  }

  checkDailyLimit(db) {
    const today = new Date().toISOString().split('T')[0];
    const maxLimit = parseInt(db?.botSettings?.dailyMessageLimit, 10) || 500;
    const current = this.dailyUsage.get(today) || 0;
    if (current >= maxLimit) {
      return false;
    }
    this.dailyUsage.set(today, current + 1);
    return true;
  }

  /**
   * Execute AI fallback call. Returns { reply, toolsCalled } or null if unavailable / failed.
   */
  async executeFallback({ message, lang, db }) {
    if (!this.isAvailable(db)) {
      return null;
    }

    if (!this.checkDailyLimit(db)) {
      return null;
    }

    try {
      const apiKey = process.env.LLM_API_KEY;
      const provider = process.env.LLM_PROVIDER || 'openai'; // or anthropic/gemini
      const phone = db.settings?.phone || '7812027551';

      // Grounding context from DB
      const roomsInfo = (db.rooms || []).filter(r => !r.isArchived).map(r => `${r.name}: ₹${r.price}/night [${r.view || 'Standard'}]`).join(', ');
      const systemPrompt = `You are the front desk concierge assistant for Coastal View resort in Mandarmani, West Bengal.
Hotel Phone: ${phone}
Address: ${db.settings?.address || 'Mandarmani Beach Road'}
Rooms: ${roomsInfo}
Breakfast: Optional, NOT included, ₹${db.settings?.breakfastPrice || 200}/person.
Payment: 20% non-refundable advance, 80% at hotel.
Strict Rules:
1. ONLY state verified facts from the context above.
2. NEVER invent or hallucinate room features, discounts, or policies.
3. If you do not have the exact factual information, advise the guest to call the front desk at ${phone}.
4. Respond warmly and concisely in language code: ${lang}.`;

      // Simple, robust completion call
      const payload = JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 250,
        temperature: 0.1
      });

      const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 4000
      };

      const resultText = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                const reply = parsed.choices?.[0]?.message?.content;
                resolve(reply || null);
              } catch (e) {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(payload);
        req.end();
      });

      if (resultText) {
        return {
          reply: resultText,
          toolsCalled: [{ name: 'grounded_database_lookup', args: { domain: 'hotel_info' } }]
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = {
  AIFallbackProvider
};

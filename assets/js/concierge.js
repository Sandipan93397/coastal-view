// Coastal View - "Ani's Coastal Concierge" Multi-Lingual AI Assistant
// Powered by LLM API & Grounded Knowledge Engine with Streaming SSE

let currentLang = 'en';
let conciergeSessionId = null;

const DIRECT_PHONE_NUMBER = '7812027551';

const defaultWelcomeMessages = {
  en: "Welcome to Coastal View, Managed By Ani's! 🌊\nI am your dedicated Coastal Concierge. Directly connected to our front desk, I can assist you with real-time room availability, official rates, dining menus, romantic candlelight dinners, and travel arrangements. How may I assist your Mandarmani getaway today?",
  bn: "কোস্টাল ভিউ, ম্যানেজড বাই অনি'স-এ আপনাকে আন্তরিক স্বাগতম! 🌊\nআমি আপনার পার্সোনাল কোস্টাল কনসিয়ার্জ। মন্দারমণির সমুদ্র সৈকতে আপনার ছুটি উপভোগ্য করতে আমি সরাসরি আমাদের ফ্রন্ট ডেস্ক সিস্টেম থেকে রুমের প্রাপ্যতা, খাবারের মেনু, ক্যান্ডেললাইট ডিনার ও টোটো/গাড়ির তথ্য দিতে পারি। আপনি কীভাবে সাহায্য চান?",
  hi: "कोस्टल व्यू, मैनेज्ड बाय अनीज़ में आपका हार्दिक स्वागत है! 🌊\nमैं आपका डिजिटल कोस्टल कंसीयर्ज हूँ। मंदারमणि में आपकी छुट्टियों को शानदार बनाने के लिए मैं फ्रंट डेस्क से कमरे की उपलब्धता, भोजन मेनू, कैंडललाइट डिनर और वाहन व्यवस्था की सटीक जानकारी दे सकता हूँ। मैं आपकी क्या मदद कर सकता हूँ?"
};

document.addEventListener('DOMContentLoaded', () => {
  initConcierge();
});

function getOrCreateSessionId() {
  if (conciergeSessionId) return conciergeSessionId;
  try {
    let saved = localStorage.getItem('concierge_session_id');
    if (!saved) {
      saved = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('concierge_session_id', saved);
    }
    conciergeSessionId = saved;
    return saved;
  } catch (e) {
    conciergeSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return conciergeSessionId;
  }
}

function initConcierge() {
  const launcher = document.getElementById('conciergeLauncher');
  const chatModal = document.getElementById('conciergeChatModal');
  const closeBtn = document.getElementById('conciergeCloseBtn');
  const langBtns = document.querySelectorAll('.concierge-lang-selector .lang-btn');
  const sendBtn = document.getElementById('conciergeSendBtn');
  const textInput = document.getElementById('conciergeTextInput');

  if (!launcher || !chatModal) return;

  // Append privacy note to chat modal footer if not already present
  if (!chatModal.querySelector('.concierge-footer-privacy')) {
    const privacyEl = document.createElement('div');
    privacyEl.className = 'concierge-footer-privacy';
    privacyEl.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 13px; vertical-align: middle;">lock</span>
      Privacy: No card details stored. Immediate help: <strong>${DIRECT_PHONE_NUMBER}</strong>
    `;
    chatModal.appendChild(privacyEl);
  }

  // Toggle Chat Window
  launcher.addEventListener('click', () => {
    chatModal.classList.toggle('open');
    if (chatModal.classList.contains('open') && document.querySelectorAll('#conciergeMessagesArea .chat-bubble').length === 0) {
      appendBotMessage(defaultWelcomeMessages[currentLang]);
      renderDefaultChips();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatModal.classList.remove('open');
    });
  }

  // Language Switcher
  langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      langBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLang = btn.getAttribute('data-lang');
      appendBotMessage(defaultWelcomeMessages[currentLang]);
      renderDefaultChips();
    });
  });

  // Sending Messages
  if (sendBtn && textInput) {
    const handleSend = () => {
      const msg = textInput.value.trim();
      if (!msg) return;
      textInput.value = '';
      sendUserMessage(msg);
    };

    sendBtn.addEventListener('click', handleSend);
    textInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  renderDefaultChips();
}

function renderDefaultChips() {
  const chipsBar = document.getElementById('conciergeChipsBar');
  if (!chipsBar) return;

  let chips = [];
  if (currentLang === 'bn') {
    chips = ['রুমের খালি অবস্থা', 'রুম ও ভাড়া দেখুন', 'রেস্তোরাঁ মেনু', 'ক্যান্ডেললাইট ডিনার', 'কাছাকাছি দর্শনীয় স্থান', 'বুকিং / কল করুন'];
  } else if (currentLang === 'hi') {
    chips = ['उपलब्धता चेक करें', 'कमरे और किराया', 'डाइनिंग मेनू', 'कैंडललाइट डिनर', 'आसपास के स्थान', 'बुकिंग / कॉल करें'];
  } else {
    chips = ['Check availability', 'Rooms & prices', 'Menu', 'Candlelight dinner', 'Nearby places', 'Book / Call us'];
  }

  renderChips(chips);
}

function renderChips(chipsList) {
  const chipsBar = document.getElementById('conciergeChipsBar');
  if (!chipsBar || !chipsList || !chipsList.length) return;

  chipsBar.innerHTML = '';
  chipsList.forEach(chipText => {
    const btn = document.createElement('button');
    btn.className = 'chip-btn';
    btn.textContent = chipText;
    btn.onclick = () => {
      const lower = chipText.toLowerCase();
      if (lower.includes('photo') || lower.includes('gallery')) {
        window.location.href = '/gallery';
      } else if (lower.includes('full menu')) {
        window.location.href = '/menu';
      } else if (lower.includes('call') || lower.includes('talk')) {
        window.location.href = `tel:${DIRECT_PHONE_NUMBER}`;
      } else {
        sendUserMessage(chipText);
      }
    };
    chipsBar.appendChild(btn);
  });
}

function appendUserMessage(text) {
  const area = document.getElementById('conciergeMessagesArea');
  if (!area) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble user';
  bubble.textContent = text;
  area.appendChild(bubble);
  area.scrollTop = area.scrollHeight;
}

function showTypingIndicator() {
  const area = document.getElementById('conciergeMessagesArea');
  if (!area) return null;

  const typingEl = document.createElement('div');
  typingEl.className = 'concierge-typing-bubble';
  typingEl.id = 'conciergeTypingBubble';
  typingEl.innerHTML = `
    <span class="concierge-typing-dot"></span>
    <span class="concierge-typing-dot"></span>
    <span class="concierge-typing-dot"></span>
    <span style="font-size: 0.76rem; color: #64748B; margin-left: 6px;">Ani's Concierge is replying...</span>
  `;
  area.appendChild(typingEl);
  area.scrollTop = area.scrollHeight;
  return typingEl;
}

function removeTypingIndicator() {
  const el = document.getElementById('conciergeTypingBubble');
  if (el) el.remove();
}

function formatBotTextToHtml(text) {
  if (!text) return '';

  // 1. Convert Markdown links: [Title](url) -> formatted interactive links
  let formatted = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    if (url.includes('#bookingSection') || url.includes('bookingSection')) {
      return `<a href="${url}" class="prefill-booking-link" onclick="handleChatBookingLinkClick(event, '${url}')">📅 ${label}</a>`;
    }
    return `<a href="${url}" target="_blank" style="color:var(--champagne-gold,#D4A84D); text-decoration:underline;">${label}</a>`;
  });

  // 2. Convert standard prefilled booking links in raw HTML
  formatted = formatted.replace(/<a\s+href="([^"]*bookingSection[^"]*)"([^>]*)>(.*?)<\/a>/gi, (match, href, rest, label) => {
    return `<a href="${href}" class="prefill-booking-link" onclick="handleChatBookingLinkClick(event, '${href}')">📅 ${label}</a>`;
  });

  // 3. Newlines to <br>
  formatted = formatted.replace(/\n/g, '<br>');

  // 4. Highlight Phone Number as Clickable Call
  formatted = formatted.replace(/\b7812027551\b/g, `<a href="tel:${DIRECT_PHONE_NUMBER}" style="color:#06B6B0; font-weight:700; text-decoration:underline;">📞 7812027551</a>`);

  // 5. Internal routes
  formatted = formatted.replace(/\/gallery\b/g, '<a href="/gallery" style="color:var(--champagne-gold,#D4A84D); font-weight:700; text-decoration:underline;">/gallery (Explore Photos)</a>');
  formatted = formatted.replace(/\/menu\b/g, '<a href="/menu" style="color:var(--champagne-gold,#D4A84D); font-weight:700; text-decoration:underline;">/menu (View Full Menu)</a>');

  return formatted;
}

// Global click handler for prefill booking link in chat
window.handleChatBookingLinkClick = function(e, url) {
  e.preventDefault();
  const modal = document.getElementById('conciergeChatModal');
  if (modal) modal.classList.remove('open');

  if (window.prefillBookingForm) {
    window.prefillBookingForm(url);
  } else {
    window.location.href = url;
  }
};

function appendBotMessage(text, requiresCallback = false, actionChips = []) {
  removeTypingIndicator();
  const area = document.getElementById('conciergeMessagesArea');
  if (!area) return;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble bot';
  bubble.innerHTML = formatBotTextToHtml(text);

  if (requiresCallback) {
    appendCallbackForm(bubble);
  }

  area.appendChild(bubble);
  if (actionChips && actionChips.length > 0) {
    renderChips(actionChips);
  }
  area.scrollTop = area.scrollHeight;
  return bubble;
}

function appendCallbackForm(container) {
  const formBox = document.createElement('div');
  formBox.className = 'callback-form-box';
  formBox.innerHTML = `
    <h5><span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">phone_in_talk</span> Request Front Desk Callback</h5>
    <input type="text" id="cbGuestName" class="callback-input" placeholder="Your Full Name" required>
    <input type="tel" id="cbGuestPhone" class="callback-input" placeholder="Your WhatsApp / Phone Number" required>
    <button class="btn btn-gold" style="width: 100%; padding: 8px 12px; font-size: 0.8rem;" onclick="submitCallbackFromChat(this)">
      Submit Contact Request
    </button>
  `;
  container.appendChild(formBox);
}

// Send user message with full streaming SSE support & graceful fallback
async function sendUserMessage(text) {
  appendUserMessage(text);
  const typingIndicator = showTypingIndicator();
  const area = document.getElementById('conciergeMessagesArea');

  const sessionId = getOrCreateSessionId();

  try {
    // Primary endpoint: /api/chat (with streaming enabled)
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json'
      },
      body: JSON.stringify({
        message: text,
        lang: currentLang,
        sessionId,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream') && response.body && response.body.getReader) {
      // SSE STREAMING MODE: Smooth typing effect
      removeTypingIndicator();

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble bot';
      area.appendChild(bubble);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      let streamBuffer = '';
      let doneMetadata = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n\n');
        streamBuffer = lines.pop(); // keep last incomplete chunk

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          try {
            const data = JSON.parse(trimmed.replace(/^data:\s*/, ''));
            if (data.type === 'token') {
              accumulatedText += data.token;
              bubble.innerHTML = formatBotTextToHtml(accumulatedText);
              area.scrollTop = area.scrollHeight;
            } else if (data.type === 'done') {
              doneMetadata = data;
              if (data.reply) {
                accumulatedText = data.reply;
                bubble.innerHTML = formatBotTextToHtml(accumulatedText);
              }
              if (data.actionChips && data.actionChips.length) {
                renderChips(data.actionChips);
              }
              if (data.requiresCallbackForm) {
                appendCallbackForm(bubble);
              }
            }
          } catch (e) {
            console.warn('Error parsing SSE data line:', e);
          }
        }
      }

      if (doneMetadata && doneMetadata.requiresCallbackForm && !bubble.querySelector('.callback-form-box')) {
        appendCallbackForm(bubble);
      }
      area.scrollTop = area.scrollHeight;

    } else {
      // STANDARD JSON FALLBACK MODE
      removeTypingIndicator();
      const data = await response.json();
      if (data.success) {
        appendBotMessage(data.reply, data.requiresCallbackForm, data.actionChips);
      } else {
        appendBotMessage(`I am currently having trouble connecting to the concierge desk. Please call ${DIRECT_PHONE_NUMBER} for immediate assistance.`, true);
      }
    }

  } catch (err) {
    removeTypingIndicator();
    console.error('Concierge API error:', err);
    // Graceful Fallback Message Requirement
    appendBotMessage(`I am currently having trouble connecting to the concierge desk. Please call ${DIRECT_PHONE_NUMBER} for immediate assistance.`, true, ['Call ' + DIRECT_PHONE_NUMBER, 'Check Rooms']);
  }
}

// Global handler for callback lead submission within chat
window.submitCallbackFromChat = async function(btn) {
  const container = btn.closest('.callback-form-box');
  const name = container.querySelector('#cbGuestName')?.value.trim();
  const phone = container.querySelector('#cbGuestPhone')?.value.trim();

  if (!name || !phone) {
    alert('Please enter your name and contact phone number.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/chat/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        sessionId: getOrCreateSessionId(),
        message: `Guest requested callback from Concierge chatbot (Language: ${currentLang})`
      })
    });
    const data = await res.json();

    if (data.success) {
      container.innerHTML = `
        <div style="color: #2E7D32; font-size: 0.82rem; font-weight: 600; padding: 4px 0;">
          <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">check_circle</span>
          Thank you, ${name}! Your callback request is confirmed. Our front desk will call you promptly at ${phone}. For instant support, you can also reach us directly at ${DIRECT_PHONE_NUMBER}.
        </div>
      `;
    } else {
      btn.disabled = false;
      btn.textContent = 'Submit Contact Request';
      alert('Unable to submit callback request. Please call ' + DIRECT_PHONE_NUMBER + ' directly.');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Submit Contact Request';
    console.error('Callback error:', err);
    alert('Unable to submit callback request. Please call ' + DIRECT_PHONE_NUMBER + ' directly.');
  }
};

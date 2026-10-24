/**
 * Coastal View - "Ani's Coastal Concierge" (Rebuilt from Scratch)
 * 
 * Connected to clean 4-Layer Grounded Chatbot Engine:
 * - Layer 1: Normalizer & Multi-lingual Detection
 * - Layer 2: Intent Router (Scored whole phrases, no loose word bugs)
 * - Layer 3: Answer Builders (100% admin database grounded)
 * - Layer 4: AI Fallback (optional, off by default)
 * 
 * Features:
 * - Floating bottom-right widget & full-height mobile sheet (respecting keyboard)
 * - Header: Logo emblem, online status, Call and WhatsApp buttons
 * - Horizontal swipe list cards for room recommendations (photo, tag, bed, guests, price, inclusions, book button)
 * - Guided booking flow state machine runner
 * - Quick reply buttons / Action chips
 * - Session persistence across pages & Clear chat option
 * - Strict safety: no card storage, input sanitization, zero raw JSON or "undefined"
 */

(function() {
  let currentLang = 'en';
  let sessionId = null;
  let currentPhone = '7812027551';
  let currentWhatsApp = '7812027551';

  const STORAGE_KEY_HISTORY = 'coastal_chat_history_v2';
  const STORAGE_KEY_LANG = 'coastal_chat_lang_v2';
  const STORAGE_KEY_OPEN = 'coastal_chat_open_v2';
  const STORAGE_KEY_SESSION = 'coastal_chat_session_id_v2';

  const welcomeMessages = {
    en: "Welcome to Coastal View, Managed By Ani's! 🌊\nI am your dedicated Coastal Concierge. How may I assist your Mandarmani holiday today?",
    bn: "কোস্টাল ভিউ, ম্যানেজড বাই অনি'স-এ আপনাকে স্বাগতম! 🌊\nআমি আপনার পার্সোনাল কোস্টাল কনসিয়ার্জ। মন্দারমণিতে আপনার ছুটির জন্য আমি কীভাবে সাহায্য করতে পারি?",
    hi: "कोस्टल व्यू, मैनेज्ड बाय अनीज़ में आपका स्वागत है! 🌊\nमैं आपका डिजिटल कोस्टल कंसीयर्ज हूँ। मंदारमणि में आपकी छुट्टियों के लिए मैं क्या मदद कर सकता हूँ?"
  };

  const initialActionChips = [
    'Rooms & prices',
    'Check availability',
    'How to contact',
    'Menu',
    'Candlelight dinner',
    'Nearby places',
    'Tours'
  ];

  // Helper: Get or generate unique session ID
  function getSessionId() {
    if (sessionId) return sessionId;
    try {
      let saved = localStorage.getItem(STORAGE_KEY_SESSION);
      if (!saved) {
        saved = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem(STORAGE_KEY_SESSION, saved);
      }
      sessionId = saved;
      return saved;
    } catch (e) {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return sessionId;
    }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history.slice(-40)));
    } catch (e) {}
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Format bot markdown text safely to HTML
  function formatBotText(raw) {
    if (!raw) return '';

    // 1. Bold: **text** -> <strong>text</strong>
    let text = raw.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 2. Markdown Links: [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      if (url.includes('bookingSection') || url.includes('#bookingSection')) {
        return `<a href="${url}" class="chat-inline-link prefill-link" onclick="handleChatBookingClick(event, '${url}')">📅 ${label}</a>`;
      }
      if (url.startsWith('tel:')) {
        return `<a href="${url}" class="chat-inline-link call-link">📞 ${label}</a>`;
      }
      if (url.startsWith('https://wa.me')) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-inline-link whatsapp-link">💬 ${label}</a>`;
      }
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-inline-link">${label}</a>`;
    });

    // 3. Newlines to <br>
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  // Pre-fill booking click handler
  window.handleChatBookingClick = function(e, url) {
    if (e && e.preventDefault) e.preventDefault();
    const modal = document.getElementById('conciergeChatModal');
    if (modal) modal.classList.remove('open');
    sessionStorage.setItem(STORAGE_KEY_OPEN, 'false');

    if (window.prefillBookingForm) {
      window.prefillBookingForm(url);
    } else {
      window.location.href = url;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Fetch live phone number from settings
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.success && d.settings) {
        if (d.settings.phone) currentPhone = d.settings.phone;
        if (d.settings.whatsapp) currentWhatsApp = d.settings.whatsapp;
        updateHeaderLinks();
      }
    }).catch(() => {});

    initWidget();
  });

  function updateHeaderLinks() {
    const callLink = document.querySelector('.concierge-header-action[title*="Call"]');
    if (callLink) {
      callLink.setAttribute('href', `tel:${currentPhone}`);
      callLink.setAttribute('title', `Call Front Desk (+91 ${currentPhone})`);
    }
    const waLink = document.querySelector('.concierge-header-action.whatsapp-btn');
    if (waLink) {
      waLink.setAttribute('href', `https://wa.me/91${currentWhatsApp}`);
    }
  }

  function initWidget() {
    const launcher = document.getElementById('conciergeLauncher');
    const modal = document.getElementById('conciergeChatModal');
    const closeBtn = document.getElementById('conciergeCloseBtn');
    const minimizeBtn = document.getElementById('conciergeMinimizeBtn');
    const clearBtn = document.getElementById('conciergeClearBtn');
    const sendBtn = document.getElementById('conciergeSendBtn');
    const input = document.getElementById('conciergeTextInput');
    const langBtns = document.querySelectorAll('.concierge-lang-selector .lang-btn');

    if (!launcher || !modal) return;

    // Restore saved language
    const savedLang = localStorage.getItem(STORAGE_KEY_LANG);
    if (savedLang && ['en', 'bn', 'hi'].includes(savedLang)) {
      currentLang = savedLang;
      langBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-lang') === currentLang);
      });
    }

    // Toggle Chat Modal
    const toggleModal = () => {
      const isOpen = modal.classList.toggle('open');
      sessionStorage.setItem(STORAGE_KEY_OPEN, isOpen ? 'true' : 'false');
      if (isOpen) {
        const area = document.getElementById('conciergeMessagesArea');
        if (area && area.children.length === 0) {
          showBotReply({
            reply: welcomeMessages[currentLang] || welcomeMessages.en,
            actionChips: initialActionChips
          }, false);
        }
        setTimeout(() => { if (input) input.focus(); }, 150);
      }
    };

    launcher.addEventListener('click', toggleModal);
    launcher.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleModal();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        sessionStorage.setItem(STORAGE_KEY_OPEN, 'false');
      });
    }

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        sessionStorage.setItem(STORAGE_KEY_OPEN, 'false');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear chat history and restart conversation?')) {
          clearChat();
        }
      });
    }

    // Language switcher
    langBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        langBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLang = btn.getAttribute('data-lang') || 'en';
        localStorage.setItem(STORAGE_KEY_LANG, currentLang);
        showBotReply({
          reply: welcomeMessages[currentLang] || welcomeMessages.en,
          actionChips: initialActionChips
        }, false);
      });
    });

    // Send input handlers
    if (sendBtn && input) {
      const doSend = () => {
        const txt = input.value.trim();
        if (!txt) return;
        input.value = '';
        sendUserMessage(txt);
      };

      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSend();
      });
    }

    // Restore previous chat history
    const history = loadHistory();
    if (history.length > 0) {
      history.forEach(item => {
        if (item.sender === 'user') {
          renderUserBubble(item.text, false);
        } else {
          renderBotBubble(item, false);
        }
      });
    }

    // Restore open state across pages
    if (sessionStorage.getItem(STORAGE_KEY_OPEN) === 'true') {
      modal.classList.add('open');
    }
  }

  function clearChat() {
    const area = document.getElementById('conciergeMessagesArea');
    if (area) area.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY_HISTORY);
    showBotReply({
      reply: welcomeMessages[currentLang] || welcomeMessages.en,
      actionChips: initialActionChips
    }, false);
  }

  function renderChips(chipsList) {
    const bar = document.getElementById('conciergeChipsBar');
    if (!bar) return;
    bar.innerHTML = '';

    if (!chipsList || !chipsList.length) return;

    chipsList.forEach(chip => {
      const btn = document.createElement('button');
      btn.className = 'chip-btn';
      btn.textContent = chip;
      btn.setAttribute('aria-label', chip);
      btn.onclick = () => {
        const lower = chip.toLowerCase();
        if (lower.includes('photo gallery') || lower === 'view photo gallery') {
          window.location.href = '/gallery';
        } else if (lower.includes('view full menu') || lower === 'view full menu') {
          window.location.href = '/menu';
        } else if (lower.startsWith('call ') || lower === 'call us') {
          window.location.href = `tel:${currentPhone}`;
        } else if (lower.includes('open google maps')) {
          window.open('https://maps.google.com/?q=Coastal+View+Mandarmani', '_blank');
        } else if (lower === 'continue to booking') {
          handleChatBookingClick(null, '/index.html#bookingSection');
        } else {
          sendUserMessage(chip);
        }
      };
      bar.appendChild(btn);
    });
  }

  function showTyping() {
    const area = document.getElementById('conciergeMessagesArea');
    if (!area) return null;

    let el = document.getElementById('conciergeTypingBubble');
    if (el) el.remove();

    el = document.createElement('div');
    el.className = 'concierge-typing-bubble';
    el.id = 'conciergeTypingBubble';
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <span class="concierge-typing-dot"></span>
      <span class="concierge-typing-dot"></span>
      <span class="concierge-typing-dot"></span>
      <span style="font-size: 0.74rem; color: #64748B; margin-left: 6px;">Concierge is replying...</span>
    `;
    area.appendChild(el);
    area.scrollTop = area.scrollHeight;
    return el;
  }

  function hideTyping() {
    const el = document.getElementById('conciergeTypingBubble');
    if (el) el.remove();
  }

  function renderUserBubble(text, persist = true) {
    const area = document.getElementById('conciergeMessagesArea');
    if (!area || !text) return;

    const b = document.createElement('div');
    b.className = 'chat-bubble user';
    b.textContent = text;
    area.appendChild(b);
    area.scrollTop = area.scrollHeight;

    if (persist) {
      const history = loadHistory();
      history.push({ sender: 'user', text, timestamp: new Date().toISOString() });
      saveHistory(history);
    }
  }

  function renderBotBubble(item, persist = true) {
    hideTyping();
    const area = document.getElementById('conciergeMessagesArea');
    if (!area) return;

    const container = document.createElement('div');
    container.className = 'chat-bot-message-wrapper';

    // Main text bubble
    if (item.reply || item.text) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble bot';
      bubble.innerHTML = formatBotText(item.reply || item.text);
      container.appendChild(bubble);
    }

    // Horizontal Swipe List Cards (Section 4 Room Cards)
    if (item.cards && item.cards.length > 0) {
      const carousel = document.createElement('div');
      carousel.className = 'room-cards-carousel';

      item.cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'chat-room-card';

        cardEl.innerHTML = `
          <div class="chat-room-card-img-wrap">
            <img src="${card.image || 'assets/images/room-ocean-whisper.jpg'}" alt="${escapeHtml(card.name)}" class="chat-room-card-img">
            <span class="chat-room-card-tag">${escapeHtml(card.tag || 'Room')}</span>
            ${card.isSoldOut ? `<span class="badge-sold-out">Sold out</span>` : ''}
          </div>
          <div class="chat-room-card-body">
            <div class="chat-room-card-title">${escapeHtml(card.name)}</div>
            <div class="chat-room-card-meta">
              <span>🛏️ ${escapeHtml(card.bedType || 'King Bed')}</span> • <span>👥 ${escapeHtml(card.maxGuests || '2 Guests')}</span>
            </div>
            <div class="chat-room-card-price">${escapeHtml(card.priceFormatted || 'Ask at hotel')}</div>
            <div class="chat-room-card-inclusions">${escapeHtml(card.inclusionsSummary || 'AC, Wi-Fi, Pool access')}</div>
            ${card.lowStockNote ? `<div class="chat-room-card-low-stock">🔥 ${escapeHtml(card.lowStockNote)}</div>` : ''}
            <div class="chat-room-card-actions">
              <a href="${card.galleryLink || '/gallery'}" class="btn-card-gallery" onclick="event.stopPropagation();">Photos</a>
              ${!card.isSoldOut ? `
                <button class="btn-card-book" onclick="handleChatBookingClick(event, '${card.bookingUrl}')">
                  Book this room
                </button>
              ` : `
                <button class="btn-card-book disabled" disabled>Sold out</button>
              `}
            </div>
          </div>
        `;
        carousel.appendChild(cardEl);
      });
      container.appendChild(carousel);
    }

    // Contact Card (Section 3 Contact Intent)
    if (item.contactCard) {
      const c = item.contactCard;
      const cCard = document.createElement('div');
      cCard.className = 'chat-contact-card';
      cCard.innerHTML = `
        <div class="chat-contact-header">
          <strong>${escapeHtml(c.hotelName)}</strong>
          <span style="font-size: 0.72rem; color: #10B981;">● Online Desk</span>
        </div>
        <div class="chat-contact-row">
          <span>📞 Phone:</span>
          <a href="tel:${c.phone}" class="chat-contact-link"><strong>${c.phone}</strong> (Tap to call)</a>
        </div>
        <div class="chat-contact-row">
          <span>💬 WhatsApp:</span>
          <a href="https://wa.me/91${c.whatsapp}" target="_blank" class="chat-contact-link"><strong>Chat on WhatsApp</strong></a>
        </div>
        <div class="chat-contact-row">
          <span>✉️ Email:</span>
          <a href="mailto:${c.email}" class="chat-contact-link">${c.email}</a>
        </div>
        <div class="chat-contact-row">
          <span>📍 Address:</span>
          <span>${escapeHtml(c.address)}</span>
        </div>
        <div style="margin-top: 10px;">
          <a href="${c.mapsUrl}" target="_blank" class="btn-chat-maps">📍 Open in Google Maps</a>
        </div>
      `;
      container.appendChild(cCard);
    }

    // Callback Request Lead Form inside bubble
    if (item.requiresCallbackForm) {
      const formBox = document.createElement('div');
      formBox.className = 'callback-form-box';
      formBox.innerHTML = `
        <h5><span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">phone_in_talk</span> Request Front Desk Callback</h5>
        <input type="text" class="callback-input cbGuestName" placeholder="Your Full Name" aria-label="Your Full Name" required>
        <input type="tel" class="callback-input cbGuestPhone" placeholder="Your Phone / WhatsApp Number" aria-label="Your Phone Number" required>
        <button class="btn btn-gold" style="width: 100%; padding: 8px 12px; font-size: 0.82rem;" onclick="submitCallbackLead(this)">
          Submit Contact Request
        </button>
      `;
      container.appendChild(formBox);
    }

    area.appendChild(container);
    area.scrollTop = area.scrollHeight;

    if (item.actionChips && item.actionChips.length) {
      renderChips(item.actionChips);
    }

    if (persist) {
      const history = loadHistory();
      history.push({
        sender: 'bot',
        reply: item.reply || item.text,
        cards: item.cards || [],
        contactCard: item.contactCard || null,
        actionChips: item.actionChips || [],
        requiresCallbackForm: Boolean(item.requiresCallbackForm),
        timestamp: new Date().toISOString()
      });
      saveHistory(history);
    }
  }

  function showBotReply(data, persist = true) {
    renderBotBubble(data, persist);
  }

  // Global submit callback handler
  window.submitCallbackLead = async function(btn) {
    const box = btn.closest('.callback-form-box');
    const name = box.querySelector('.cbGuestName')?.value.trim();
    const phone = box.querySelector('.cbGuestPhone')?.value.trim();

    if (!name || !phone) {
      alert('Please enter both your name and phone number.');
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
          sessionId: getSessionId(),
          message: `Guest callback request submitted from chatbot (Lang: ${currentLang})`
        })
      });
      const data = await res.json();

      if (data.success) {
        box.innerHTML = `
          <div style="color: #2E7D32; font-size: 0.84rem; font-weight: 600; padding: 6px 0;">
            ✓ Thank you, ${escapeHtml(name)}! Your callback request is confirmed. Our front desk manager will call you promptly at ${escapeHtml(phone)}. For instant support: <a href="tel:${currentPhone}" style="color:inherit; font-weight:700;">${currentPhone}</a>.
          </div>
        `;
      } else {
        btn.disabled = false;
        btn.textContent = 'Submit Contact Request';
        alert('Unable to submit callback request. Please call ' + currentPhone + ' directly.');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Submit Contact Request';
      alert('Unable to submit callback request. Please call ' + currentPhone + ' directly.');
    }
  };

  // Send message to backend API
  async function sendUserMessage(text) {
    renderUserBubble(text, true);
    showTyping();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: text,
          lang: currentLang,
          sessionId: getSessionId()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      hideTyping();

      if (data && data.success) {
        showBotReply({
          reply: data.reply,
          cards: data.cards || [],
          contactCard: data.contactCard || null,
          actionChips: data.actionChips || initialActionChips,
          requiresCallbackForm: Boolean(data.requiresCallbackForm)
        }, true);
      } else {
        showBotReply({
          reply: `I am currently having trouble reaching the front desk system. Please call directly at [${currentPhone}](tel:${currentPhone}).`,
          actionChips: ['Call ' + currentPhone, 'Rooms & prices'],
          requiresCallbackForm: true
        }, true);
      }
    } catch (err) {
      hideTyping();
      showBotReply({
        reply: `I am currently having trouble reaching the front desk system. Please call directly at [${currentPhone}](tel:${currentPhone}).`,
        actionChips: ['Call ' + currentPhone, 'Rooms & prices'],
        requiresCallbackForm: true
      }, true);
    }
  }

})();

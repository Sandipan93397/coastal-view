/**
 * Chatbot Service - Interface & Database Persistence Adapter
 * 
 * Replaces the old chatbot service completely with the clean 4-layer engine:
 * - Layer 1: Normalizer & Language Detection
 * - Layer 2: Intent Router (rules, whole phrase matching, generic word protection)
 * - Layer 3: Answer Builders (100% grounded in database and websiteContent)
 * - Layer 4: AI Fallback (optional, off by default)
 * 
 * Manages fresh tables:
 * - db.conversations
 * - db.messages
 * - db.leads
 * - db.unmatchedPhrases
 */

const { ChatbotEngine } = require('./chatbot/chatbot_engine');

const engine = new ChatbotEngine();
const DIRECT_PHONE_NUMBER = '7812027551';

/**
 * Main public entrypoint for processing incoming chat requests
 */
async function processChatRequest({
  message,
  lang = 'en',
  sessionId = 'sess-default',
  stream = false,
  onToken = null,
  clientIp = '127.0.0.1',
  db,
  forceApiFailure = false
}) {
  if (forceApiFailure) {
    const phone = (db && db.settings && db.settings.phone) ? db.settings.phone : DIRECT_PHONE_NUMBER;
    const fallbackText = `I am currently experiencing connectivity issues with the front desk database. Please call our desk at ${phone} or leave your contact details below.`;
    if (onToken) onToken(fallbackText);
    return {
      success: true,
      reply: fallbackText,
      actionChips: ['Call ' + phone, 'Rooms & prices'],
      requiresCallbackForm: true,
      leadStatus: 'Needs follow-up',
      topic: 'Front Desk Assistance'
    };
  }

  const result = await engine.processMessage({
    message,
    lang,
    sessionId,
    clientIp,
    db
  });

  // If streaming token callback provided, send tokens
  if (stream && onToken && result.reply) {
    const tokens = result.reply.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      onToken(tokens[i] + (i < tokens.length - 1 ? ' ' : ''));
    }
  }

  return {
    success: true,
    reply: result.reply,
    cards: result.cards || [],
    roomCards: (result.cards && result.cards.length) ? result.cards : null,
    contactCard: result.contactCard || null,
    actionChips: result.actionChips || [],
    prefillUrl: result.prefillUrl || null,
    topic: result.topic || 'General Inquiry',
    intent: result.intent || 'unknown',
    leadStatus: result.leadStatus || 'New Lead',
    requiresCallbackForm: Boolean(result.requiresCallbackForm),
    sessionId
  };
}

/**
 * Record conversation and messages into fresh database tables:
 * - db.conversations
 * - db.messages
 * - db.leads (if applicable)
 */
function recordConversationAndInquiry(db, {
  sessionId,
  userMessage,
  botReply,
  lang = 'en',
  topic = 'General Inquiry',
  intent = 'unknown',
  leadStatus = 'New Lead',
  requiresCallback = false,
  guestName = '',
  guestPhone = ''
}) {
  if (!db) return;

  db.conversations = db.conversations || [];
  db.messages = db.messages || [];
  db.leads = db.leads || [];

  const timestamp = new Date().toISOString();

  // 1. Find or create conversation
  let conv = db.conversations.find(c => c.sessionId === sessionId || c.id === sessionId);
  if (!conv) {
    conv = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sessionId,
      language: lang,
      topic,
      detectedIntents: intent !== 'unknown' ? [intent] : [],
      leadStatus: requiresCallback ? 'Needs follow-up' : leadStatus,
      isRead: false,
      guestName: guestName || '',
      guestPhone: guestPhone || '',
      staffNotes: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: []
    };
    db.conversations.unshift(conv);
  } else {
    conv.updatedAt = timestamp;
    if (topic && conv.topic === 'General Inquiry') conv.topic = topic;
    if (intent && !conv.detectedIntents.includes(intent)) {
      conv.detectedIntents.push(intent);
    }
    if (requiresCallback && conv.leadStatus === 'New Lead') {
      conv.leadStatus = 'Needs follow-up';
    }
    if (guestName && !conv.guestName) conv.guestName = guestName;
    if (guestPhone && !conv.guestPhone) conv.guestPhone = guestPhone;
  }

  // 2. Record individual messages
  if (userMessage) {
    const userMsgObj = {
      id: `msg-${Date.now()}-1`,
      conversationId: conv.id,
      sessionId,
      sender: 'guest',
      text: userMessage,
      intent,
      timestamp
    };
    db.messages.push(userMsgObj);
    conv.messages.push(userMsgObj);
  }

  if (botReply) {
    const botMsgObj = {
      id: `msg-${Date.now()}-2`,
      conversationId: conv.id,
      sessionId,
      sender: 'bot',
      text: botReply,
      intent,
      timestamp
    };
    db.messages.push(botMsgObj);
    conv.messages.push(botMsgObj);
  }

  // 3. Record lead if marked or needs follow-up
  if (conv.leadStatus === 'Needs follow-up' || conv.leadStatus === 'Qualified Lead' || conv.guestPhone) {
    const existingLead = db.leads.find(l => l.conversationId === conv.id);
    if (!existingLead) {
      db.leads.push({
        id: `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        conversationId: conv.id,
        sessionId,
        guestName: conv.guestName || 'Website Guest',
        guestPhone: conv.guestPhone || '',
        status: conv.leadStatus,
        source: 'chatbot',
        notes: `Topic: ${topic}. Detected intents: ${conv.detectedIntents.join(', ')}`,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    } else {
      existingLead.status = conv.leadStatus;
      if (conv.guestName) existingLead.guestName = conv.guestName;
      if (conv.guestPhone) existingLead.guestPhone = conv.guestPhone;
      existingLead.updatedAt = timestamp;
    }
  }
}

/**
 * Calculate chatbot analytics and usage statistics:
 * - top intents
 * - top questions
 * - leads captured
 * - unmatched rate
 */
function getChatStats(db) {
  if (!db) {
    return {
      totalConversations: 0,
      unreadConversations: 0,
      leadsCaptured: 0,
      unmatchedRate: '0%',
      topIntents: [],
      topQuestions: []
    };
  }

  const conversations = db.conversations || [];
  const messages = db.messages || [];
  const unmatched = db.unmatchedPhrases || [];
  const leads = db.leads || [];

  // 1. Calculate intent frequencies
  const intentCounts = {};
  for (const c of conversations) {
    for (const intent of (c.detectedIntents || [])) {
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    }
  }

  const topIntents = Object.entries(intentCounts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 2. Calculate top guest questions
  const questionCounts = {};
  for (const m of messages) {
    if (m.sender === 'guest' && m.text && m.text.length > 3) {
      const q = m.text.trim();
      questionCounts[q] = (questionCounts[q] || 0) + 1;
    }
  }

  const topQuestions = Object.entries(questionCounts)
    .map(([question, count]) => ({ question, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 3. Unmatched rate calculation
  const totalGuestMessages = messages.filter(m => m.sender === 'guest').length;
  const totalUnmatchedCount = unmatched.reduce((acc, u) => acc + (u.count || 1), 0);
  const unmatchedRate = totalGuestMessages > 0
    ? `${Math.round((totalUnmatchedCount / totalGuestMessages) * 100)}%`
    : '0%';

  const unreadCount = conversations.filter(c => !c.isRead).length;

  return {
    totalConversations: conversations.length,
    unreadConversations: unreadCount,
    leadsCaptured: leads.length,
    unmatchedRate,
    unmatchedCount: unmatched.length,
    todayMessages: messages.filter(m => m.timestamp && m.timestamp.startsWith(new Date().toISOString().split('T')[0])).length,
    topIntents,
    topQuestions,
    unansweredQuestions: unmatched.map(u => ({
      question: u.phrase,
      count: u.count,
      language: u.language,
      askedAt: u.lastSeenAt
    }))
  };
}

/**
 * Export full chat conversations to CSV format (Super Admin and Manager only)
 */
function exportConversationsToCSV(conversations) {
  const headers = ['Conversation ID', 'Date', 'Language', 'Detected Intents', 'Lead Status', 'Guest Name', 'Guest Phone', 'Staff Notes', 'Full Transcript'];
  const rows = [headers];

  for (const c of (conversations || [])) {
    const transcript = (c.messages || []).map(m => {
      const sender = m.sender === 'guest' ? 'Guest' : (m.sender === 'staff' ? 'Staff' : 'Bot');
      return `[${sender}]: ${m.text}`;
    }).join(' | ');

    rows.push([
      `"${c.id}"`,
      `"${c.createdAt || ''}"`,
      `"${(c.language || 'en').toUpperCase()}"`,
      `"${(c.detectedIntents || []).join(', ')}"`,
      `"${c.leadStatus || 'New Lead'}"`,
      `"${(c.guestName || '').replace(/"/g, '""')}"`,
      `"${(c.guestPhone || '').replace(/"/g, '""')}"`,
      `"${(c.staffNotes || '').replace(/"/g, '""')}"`,
      `"${transcript.replace(/"/g, '""')}"`
    ]);
  }

  return rows.map(r => r.join(',')).join('\n');
}

module.exports = {
  processChatRequest,
  recordConversationAndInquiry,
  getChatStats,
  exportConversationsToCSV,
  DIRECT_PHONE_NUMBER
};

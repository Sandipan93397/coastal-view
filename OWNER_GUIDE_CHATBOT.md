# Owner Guide: Ani's Coastal Concierge (Admin Handbook)

Welcome to your AI Concierge management portal, designed specifically for **Coastal View, Managed By Ani's**.
This guide explains how to read guest conversations, convert chats to direct bookings, turn unanswered questions into instant FAQs, and adjust chatbot behavior.

---

## 1. Accessing the Chatbot CRM

1. Log into your Admin Portal at `https://coastalviewmandarmani.com/admin/` using your Staff or Manager credentials.
2. In the charcoal sidebar on the left, click on the green **Chatbot** icon (`support_agent`).
3. You will see your real-time analytics dashboard:
   - **Total Inquiries:** All conversations initiated by guests.
   - **Unread / Follow-up:** Guests requesting callbacks or needing staff assistance.
   - **Leads Captured:** Guests who submitted phone numbers or requested room quotes.
   - **Converted Bookings:** Leads successfully turned into hotel reservations.
   - **Today's Queries & API Cost:** Real-time query count and estimated LLM cost (typically under $0.05 / ₹4.00 per day).

---

## 2. Managing Guest Inquiries & Live Takeover

- **Search & Filter:** Use the search bar at the top of the inbox to search by guest name, phone number, or keywords (e.g. *"sea view"*, *"ilish"*, *"december"*). Filter tabs let you view *All*, *Unread*, *Follow-up*, *Leads*, or *Converted*.
- **Read Full Transcripts:** Click on any conversation in the list to view the full dialogue in chat bubbles (Guest in gray/blue, Concierge AI in dark navy, and Staff replies in turquoise).
- **Live Takeover Reply:** Need to step in personally? Type your message in the bottom input bar (`Send Reply`) to directly send an official staff message into the guest's conversation.
- **Convert to Booking:** Click the turquoise **"Convert to Booking"** button in the header. The system immediately opens the Manual Reservation modal with the guest's name and phone number pre-filled.
- **Mark as Priority Lead:** Click **"Mark Lead"** to add private staff notes for front desk handover.

---

## 3. Turning Unanswered Questions into Website FAQs

Whenever a guest asks something that is not yet in the hotel database (such as a unique nearby temple or specific pet guidelines):
1. The chatbot politely informs the guest: *"I don't have that information, please call 7812027551"* and offers a callback.
2. The question is automatically logged under **"Unanswered Questions & FAQ Suggestions"** at the bottom of the Chatbot tab.
3. Click the turquoise **"+ Add to FAQ"** button next to the question.
4. Type your official hotel answer in the prompt and hit **OK**.
5. That question and answer are **instantly published to your public website FAQ** and added to the chatbot's database! The next guest asking will receive your exact answer immediately with zero code changes.

---

## 4. Testing the Bot in the Admin Panel ("Live Test Panel")

Above the inbox, you have a private **"Try the Chatbot (Live Grounding & Tool Inspector)"** sandbox:
- Click any sample chip (e.g. *Sea View Room?*, *Pool Haven + Toto + Dinner*, *Is breakfast included?*, or *Prompt Injection Test*).
- Type custom test questions and press **Test Query**.
- The panel shows the exact response the guest will see, alongside **⚡ Backend Tools Called** (e.g. `calculate_price`, `get_rooms`, `get_menu`) and response latency in milliseconds.

---

## 5. Changing Bot Settings & Custom Prompt Rules

Click the turquoise **"Bot Content Editor"** button in the top right of the Chatbot tab:
- **Master On/Off Switch:** Temporarily toggle the bot on or off across the entire website with one click.
- **Welcome Messages:** Customize your greeting in English, Bengali (বাংলা), and Hindi (हिन्दी).
- **Quick-Reply Chips:** Edit the 1-tap buttons shown to guests (e.g. `Check availability, Rooms & prices, Menu, Candlelight dinner, Nearby places, Book / Call us`).
- **Tone & Custom Instructions:** Tell the bot what to highlight (e.g. *"Always recommend the beachside candlelight dinner for couples celebrating anniversaries"*).
- **Daily Message Cap:** Protect your budget by setting a daily limit (default: 500 messages).
- **Chat Log Retention:** Automatically deletes guest conversation logs older than your chosen period (default: 90 days) for guest privacy.

---

## 6. Staff Contact & Direct Inquiries
- **Direct Desk Line:** `+91 7812027551`
- **WhatsApp Concierge:** `+91 7812027551`
- **Ani's Tour & Travels Official Link:** `https://bengal-tours-ani.preview.emergentagent.com/#enquire`

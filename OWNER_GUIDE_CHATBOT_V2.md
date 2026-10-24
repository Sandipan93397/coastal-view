# 🌊 Coastal View Chatbot V2 — Owner & Administrator Guide

Welcome to the newly rebuilt **Coastal View Concierge Chatbot (V2)**. This system is 100% data-grounded, rules-based, privacy-safe, and dynamically integrated with your resort's admin database.

---

## 1. How It Works (The 4-Layer Architecture)

1. **Layer 1: Normalizer & Language Detection**
   - Automatically handles lowercase, trim, punctuation removal, and fuzzy typo corrections (e.g. `"contct"` → `"contact"`, `"rooom"` → `"room"`).
   - Detects English, Bengali script, Hindi script, and Roman-script transliterations (e.g., *"kothay"*, *"kitna"*, *"booking korbo"*).
2. **Layer 2: Intent Router (Deterministic Rules, No Hallucinations)**
   - Matches whole phrases against 20 prioritized intents. Single generic words (*"how"*, *"price"*, *"room"*) never decide the intent alone.
   - Specific intents always beat generic ones (e.g., `"how to contact"` triggers the **Contact Card**, never room bookings).
3. **Layer 3: Answer Builders (100% Admin Data-Grounded)**
   - All room rates, room cards, phone numbers, timings, menu items, add-on prices (Toto, Auto, Car, Breakfast, Candlelight Dinner) come directly from your admin database (`data/db.json`), never hard-coded text.
   - Breakfast is always communicated as **optional (₹200/person/day)** and **never included** in the base room tariff.
4. **Layer 4: AI Fallback (Optional, Disabled by Default)**
   - If enabled and `LLM_API_KEY` is provided, safely handles unmapped queries with strict function calling.

---

## 2. Reading Chat Transcripts & Managing Leads

1. Open the Admin Dashboard: `http://localhost:3000/admin`
2. In the sidebar, navigate to **Chatbot CRM & Leads**.
3. **Conversations Inbox**:
   - View conversations sorted by date and time with detected language, detected intents, and lead status (`New Lead`, `Qualified`, `Needs follow-up`, `Converted to Booking`, `Closed`).
   - Click on any conversation to view the full dialogue transcript.
   - Add internal staff notes and update lead status directly.
4. **CSV Export**:
   - Super Admins and Managers can export all conversations and leads to CSV using the **"Export CSV"** button (all exports are logged in the audit trail).

---

## 3. Teaching the Bot New Phrases (1-Click Training)

When a guest sends a message the bot doesn't recognize:
1. Go to the **Unmatched Phrases & Intent Trainer** card in the Admin Panel.
2. You will see the unrecognized phrase along with its frequency and timestamp.
3. Select the correct intent from the dropdown (e.g. `contact`, `location`, `menu`, `rooms_list`).
4. Click **"Train Phrase"**.
5. The phrase is instantly appended to the intent's phrase list in the database and applied to the running chatbot immediately without needing a server restart!

---

## 4. Editing Intent Phrases Directly

1. In the Admin Dashboard, click **"Configure Chatbot"** (or open the Bot Editor Modal).
2. Scroll to the **"Editable Intent Phrases (20 Intents)"** accordion.
3. Expand any intent (e.g., `contact`, `location`, `rooms_list`, `addons`, `menu`).
4. Add or remove phrases (English, Bengali, Hindi, Hinglish/Banglish) separated by commas.
5. Click **"Save Settings"**. Changes take effect instantly.

---

## 5. Changing Welcome Messages & Quick Reply Action Chips

In the **Chatbot Settings Modal**:
1. **Welcome Message (English / Bengali / Hindi)**:
   - Edit the greeting message displayed when a guest first opens the chat.
2. **Quick Reply Action Chips**:
   - Modify the comma-separated list of buttons displayed below greetings (e.g., `Rooms & prices, Check availability, How to contact, Menu, Candlelight dinner, Nearby places, Tours`).
3. **Fallback Message**:
   - Customize the polite message displayed when no intent matches and AI fallback is disabled.
4. **Daily Rate Limit & Master Toggle**:
   - Switch the chatbot on or off resort-wide with one click.
   - Adjust the daily rate limit or toggle AI fallback on/off.

---

## 6. Guided Booking State Machine

Guests can complete a 5-step guided booking directly within the chat widget:
1. **Dates**: Validates check-in and check-out (supports natural language like *"tomorrow to day after tomorrow"* or calendar dates).
2. **Guests**: Inquires number of adult and child guests.
3. **Rooms**: Collects number of rooms required.
4. **Room Type**: Guests pick their preferred room (Ocean Whisper, Pool Haven, Palm Grove, Cosy Deluxe).
5. **Optional Add-ons**: Step-by-step options for Vehicle Pickup (Toto/Auto/Car), Optional Breakfast, and Candlelight Dinner.
6. **Exact Rupee Price Breakdown**:
   - Mirrors the website booking form to the exact rupee.
   - Transparently displays **20% advance payable now (non-refundable)** and **80% balance payable at hotel check-in**.
   - Generates a **"Continue to booking"** button that opens the main booking form with all fields pre-filled!

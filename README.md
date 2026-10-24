# Coastal View Mandarmani - Luxury Resort Management System
## Admin Authentication, Authenticator 2FA, Dynamic Booking & Free SMTP

A high-security, resilient beachfront hotel website and administrative portal for **Coastal View Resort, Mandarmani**. Built with Node.js, Express, Vanilla JavaScript/CSS, and structured JSON storage, designed for local development, Render, and **Hostinger Business Web Hosting**.

---

## ⚡ Quickstart & Deployment Guide

### 1. Setup Steps
```bash
# 1. Clone repository
git clone https://github.com/Sandipan93397/coastal-view.git
cd coastal-view

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and set your ADMIN_EMAIL, SESSION_SECRET, and SMTP credentials
```

### 2. Environment Variables List
| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `PORT` | Optional | Web server listening port (defaults to 3000) | `3000` |
| `NODE_ENV` | Yes | Environment mode (`development` or `production`) | `production` |
| `ADMIN_EMAIL` | Yes | Super Admin primary email address | `owner@coastalviewmandarmani.com` |
| `SESSION_SECRET` | Yes | 64-character random hex string for session encryption | `b8d7a12401f9...` |
| `COOKIE_SECURE` | Yes | Secure cookie flag (`true` in production with HTTPS) | `true` |
| `MFA_ENCRYPTION_KEY` | Optional | 256-bit encryption key for TOTP secrets at rest | `64-hex-characters` |
| `TOTP_ISSUER` | Optional | Authenticator app issuer name | `CoastalViewMandarmani` |
| `SMTP_HOST` | Optional | Free SMTP relay host (Brevo, Mailjet, Gmail) | `smtp-relay.brevo.com` |
| `SMTP_PORT` | Optional | SMTP connection port (587 for STARTTLS, 465 for SSL) | `587` |
| `SMTP_USER` | Optional | SMTP authentication username / account email | `apikey` |
| `SMTP_PASS` | Optional | SMTP API key or app password | `xsmtpsib-...` |
| `MAIL_FROM` | Optional | Verified sender email address | `reservations@coastalviewmandarmani.com` |
| `MAIL_FROM_NAME` | Optional | Sender display name | `"Coastal View Mandarmani"` |
| `SMTP_DAILY_LIMIT` | Optional | Daily free-tier send cap for dashboard meter | `300` |
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile public site key | `0x4AAAAAA...` |
| `TURNSTILE_SECRET_KEY`| Optional | Cloudflare Turnstile private secret key | `0x4AAAAAA...` |
| `CAPTCHA_POLICY` | Optional | Turnstile trigger mode (`smart` or `always`) | `smart` |
| `LLM_PROVIDER` | Optional | Chatbot engine (`gemini`, `anthropic`, `openai`) | `gemini` |
| `LLM_API_KEY` | Optional | Provider API key for AI Concierge | `AIzaSy...` |
| `LLM_MODEL` | Optional | Chatbot model identifier | `gemini-1.5-flash` |

### 3. Database Migration & Build Command
```bash
# Run database schema migration and integrity checks
node migrate_db.js

# Compiles dynamic menu categories, updates index.html, and verifies db integrity
npm run build
```

### 4. Create Super Admin Command
```bash
# Initializes the master administrator with hidden terminal password input (Argon2id hashing)
npm run create-super-admin
```

### 5. Hostinger Deployment Steps
1. **Node.js Setup in hPanel**:
   - Log in to Hostinger hPanel > **Websites** > **Node.js**.
   - Create or select a Node.js application running **Node.js 18.x or 20.x**.
   - Set **Application Root** to the project folder (`public_html` or domain root).
   - Set **Application Startup File** to `server.js`.
2. **Upload / Clone Code**:
   - Push code to your private GitHub repository and pull on Hostinger via Git or upload project files (excluding `.env`, `node_modules`, and `uploads`).
   - Run `npm install --omit=dev`.
3. **Configure Environment Variables**:
   - In Hostinger hPanel > Node.js > **Environment Variables**, add the production keys from the table above (`NODE_ENV=production`, `COOKIE_SECURE=true`, `SESSION_SECRET`, `ADMIN_EMAIL`, etc.).
4. **Initialize Super Admin**:
   - Connect via Hostinger SSH terminal and run:
     ```bash
     npm run create-super-admin
     ```
   - Follow prompts to set the secure 12+ character master password.
5. **Start Application**:
   - Click **Restart Application** in hPanel.
   - Navigate to `https://yourdomain.com/admin` to set up your Authenticator app (TOTP 2FA) and verify the live dashboard.

---

## 1. Security Architecture Overview

* **Zero Hardcoded Secrets**: All keys, passwords, and tokens are read exclusively from environment variables (`.env`). No passwords exist in source code, comments, seed data, or Git history.
* **One-Time Super Admin Setup**: `npm run create-super-admin` reads `ADMIN_EMAIL`, prompts for a hidden terminal password, verifies 12+ character complexity, hashes with **Argon2id**, and locks permanently once the first Super Admin exists.
* **Dual-Factor Authentication (2FA)**:
  * **Primary (TOTP)**: RFC 6238 time-based one-time password paired with Google Authenticator, Microsoft Authenticator, or 1Password via QR code or manual key. Enforces 30-second steps, ±1 step drift tolerance, and strict **anti-replay / no code reuse**.
  * **Backup (Email Code)**: 6-digit cryptographically generated code dispatched via free SMTP, stored as a SHA-256 hash, valid for 10 minutes, single-use, maximum 5 attempts, with a 60-second resend cooldown and 3 sends per 10-minute throttle.
  * **Emergency (Recovery Codes)**: 8 single-use hex codes shown once at setup. Stored hashed. Regenerating requires password re-authentication and revokes previous codes.
* **Bot Protection**: Cloudflare Turnstile CAPTCHA triggered after 2 failed attempts or IP rate-limiting. Local dev uses Turnstile always-pass test keys (`1x00000000000000000000AA`).
* **Session Hardening**: Secure, HttpOnly, SameSite=Strict cookies with 15-minute idle timeout, password re-authentication for sensitive actions (price changes, room deletion, user management, database exports), and "Log Out All Devices" functionality.
* **Role-Based Access Control**:
  * **Super Admin**: Full access to all modules, staff user management, SMTP mail logs, database backups, and emergency tools.
  * **Manager**: Bookings, room management, inventory, photos, menu, reports, CSV exports, content.
  * **Front Desk**: Dashboard check-ins, guest reservations, calendar availability, Concierge Chat CRM, invoice generation. Blocked from Manager and Admin routes with HTTP 403 Forbidden.

---

## 2. Free SMTP Email Provider Setup

Email delivery uses **Nodemailer** configured strictly through 6 environment variables:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_FROM_NAME`.

The system supports automatic STARTTLS (port 587, `secure: false`) and SSL/TLS (port 465, `secure: true`), incorporates a 10-second connect timeout, 1 automatic retry, and graceful degradation so bookings and sign-ins never crash if email servers are down.

### Option A: Brevo (Formerly Sendinblue) - Recommended Default
* **Free Tier Allowance**: **300 emails per day** (9,000/month), free forever.
* **Setup Steps**:
  1. Create a free account at [https://www.brevo.com/](https://www.brevo.com/).
  2. Navigate to **Senders & IP** > **Senders** and click **Add a sender**. Enter your hotel email (e.g. `reservations@yourdomain.com` or `yourhotel@gmail.com`) and verify via the confirmation link sent to your inbox.
  3. Go to **SMTP & API** > **SMTP** tab.
  4. Click **Generate a new SMTP key**, name it `Coastal View Production`, and copy the generated key.
  5. Add these environment variables to your `.env` (or Hostinger Environment settings):
     ```env
     SMTP_HOST=smtp-relay.brevo.com
     SMTP_PORT=587
     SMTP_USER=your_brevo_account_email@domain.com
     SMTP_PASS=xsmtpsib-your-generated-smtp-key
     MAIL_FROM=verified_sender@yourdomain.com
     MAIL_FROM_NAME="Coastal View Mandarmani"
     SMTP_DAILY_LIMIT=300
     ```

### Option B: Mailjet (Alternative)
* **Free Tier Allowance**: **200 emails per day** (6,000/month).
* **Setup**:
  1. Sign up at [https://www.mailjet.com/](https://www.mailjet.com/).
  2. Under **Account Settings** > **Sender Domains & Addresses**, verify your sender address.
  3. Under **Account Settings** > **API Key Management**, copy your API Key and Secret Key.
  4. Configure in `.env`:
     ```env
     SMTP_HOST=in-v3.mailjet.com
     SMTP_PORT=587
     SMTP_USER=your_mailjet_api_key
     SMTP_PASS=your_mailjet_secret_key
     MAIL_FROM=verified_sender@yourdomain.com
     MAIL_FROM_NAME="Coastal View Mandarmani"
     SMTP_DAILY_LIMIT=200
     ```

### Option C: Resend (Alternative)
* **Free Tier Allowance**: **100 emails per day** (3,000/month).
* **Setup**:
  1. Sign up at [https://resend.com/](https://resend.com/).
  2. Under **Domains**, add and verify your custom domain via DNS records.
  3. Under **API Keys**, create a key with "Sending access".
  4. Configure in `.env`:
     ```env
     SMTP_HOST=smtp.resend.com
     SMTP_PORT=465
     SMTP_USER=resend
     SMTP_PASS=re_your_api_key_here
     MAIL_FROM=reservations@yourdomain.com
     MAIL_FROM_NAME="Coastal View Mandarmani"
     SMTP_DAILY_LIMIT=100
     ```

> **Note on Free Plans**: Free tiers have daily caps (e.g. 300 for Brevo). The Admin Dashboard features a live progress bar tracking daily usage and displays an amber alert banner when 80% of quota is consumed. Free tiers may also append a subtle "Sent via Brevo" footer to transactional emails.

---

## 3. Hostinger Custom Domain Authentication (DNS Records)

To ensure email deliverability into guest Inboxes (preventing Spam folder placement) and authorize Brevo/Mailjet to send from your domain (`coastalviewmandarmani.com`), add the following DNS records in **Hostinger hPanel** > **Domains** > **DNS / Nameservers**:

| Type | Name / Host | Value / Target | TTL | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **TXT** | `@` (or leave blank) | `v=spf1 include:spf.brevo.com ~all` | 3600 | **SPF**: Authorizes Brevo mail servers |
| **TXT** | `mail._domainkey` | `k=rsa; p=YOUR_BREVO_DKIM_PUBLIC_KEY` | 3600 | **DKIM**: Cryptographic anti-tampering signature |
| **TXT** | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com` | 3600 | **DMARC**: Phishing & spoofing protection policy |

*If you already have an existing SPF record in Hostinger, merge it by adding `include:spf.brevo.com` before `~all`, for example: `v=spf1 include:_spf.hostinger.com include:spf.brevo.com ~all`.*

---

## 4. Initial Setup & Super Admin Provisioning

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```
Ensure `ADMIN_EMAIL` contains your email address:
```env
ADMIN_EMAIL=owner@coastalviewmandarmani.com
```

### Step 3: Run the One-Time Super Admin Creation Script
```bash
npm run create-super-admin
```
1. The script reads `ADMIN_EMAIL` from `.env`.
2. It prompts you to enter a new password in the terminal with hidden input (no characters displayed on screen).
3. It enforces strong password complexity: 12+ characters, lowercase, uppercase, numeric digit, symbol, and not in common-password dictionaries.
4. It hashes the password using **Argon2id** (`$argon2id$...`) and saves only the hash to `data/db.json`.
5. Once complete, the script locks permanently. Re-running the command exits with:
   `⛔ ACCESS DENIED: The one-time Super Admin creation script is permanently LOCKED.`

### Step 4: First Login & Mandatory 2FA Setup
1. Open `http://localhost:3000/admin` (or your production URL).
2. Enter your `ADMIN_EMAIL` and password.
3. Because 2FA is mandatory for the Super Admin, a pairing modal appears displaying:
   * A scannable **QR Code** for your Authenticator app.
   * A **Manual Secret Key** (with a single-click Copy button).
   * **8 Emergency One-Time Recovery Codes** (with a "Copy All" button to store in a safe place).
4. Scan the QR code using Google Authenticator, Microsoft Authenticator, or 1Password.
5. Enter the 6-digit code shown in your app to activate 2FA and proceed directly to the Admin Dashboard.

---

## 5. Emergency Account Recovery (Locked Out Procedure)

If both your phone (Authenticator app) and your email are lost or unavailable, you can use one of your 8 emergency recovery codes on the login screen by clicking **"Use Recovery Code"**.

### Server-Side Emergency Recovery Command (Hosting Owner Last Resort)
If you are locked out and have no recovery codes, the server owner with SSH or terminal access to Hostinger can execute:
```bash
npm run recover-account
```
This interactive emergency utility allows you to:
1. **Reset 2FA & Generate 8 Fresh Recovery Codes**: Clears the lost Authenticator secret and outputs 8 new recovery codes directly to the terminal.
2. **Unlock Locked Account**: Clears progressive brute-force lockouts and resets failed attempt counters.
3. **Change Password**: Interactively updates the Argon2id password hash for any staff account.
4. **Inspect Account Security State**: Checks 2FA status, remaining recovery codes, and active sessions.

---

## 6. Admin Email Diagnostic Tools

* **Settings > Email & Free SMTP Card**:
  * Real-time connection badge: `Connected (Verified)`, `Failing (Check SMTP)`, or `Not Configured (Local Dev)`.
  * Verified sender address and daily quota usage bar (`X / 300 emails today`).
  * **"Send Test Email to Super Admin"** button: Triggers a live dispatch to `ADMIN_EMAIL` and displays the server response with Message ID or real error code.
  * **"View SMTP Dispatch Audit Log"** button: Displays an append-only audit trail showing timestamp, email type (Booking Confirmation, 2FA Code, Security Alert), masked recipient address (`s***@gmail.com`), and delivery status. Message bodies and security codes are strictly never logged.
* **Terminal CLI Diagnostic**:
  ```bash
  npm run test-email
  ```
  Tests socket connection, performs STARTTLS/SSL handshake, verifies sender credentials, and dispatches a test message to `ADMIN_EMAIL`.
* **Dashboard Warning Banner**: Automatically alerts administrators on `#tabDashboard` if outbound SMTP delivery is failing or if today's send quota has reached 80%.

---

## 7. Verification & Automated Test Suite

A complete verification suite is included covering all security requirements:
```bash
node test_admin_auth_email_suite.js
```
The suite automatically verifies:
* One-time Super Admin lock refusal & zero hardcoded passwords.
* Generic "Wrong email or password" error messages.
* Cloudflare Turnstile CAPTCHA rate-limiting after 2 failed attempts.
* Authenticator TOTP verification & anti-replay (code reuse rejection).
* Single-use 8-character recovery code consumption.
* Backup email code dispatch with 60-second cooldown and 3/10m throttle.
* Development fallback guard (impossible in `NODE_ENV=production`).
* Role authorization boundaries (Front Desk blocked from Manager & Super Admin routes).
* SMTP failure resilience (booking flow and admin access never crash).
* Append-only mail log masking and privacy compliance.
* Session revocation and "Log out all devices".

---

## 8. Deployment on Hostinger Business

1. In Hostinger hPanel, create a **Node.js Application** running Node.js 18 or 20.
2. Set the startup file to `server.js`.
3. In **Environment Variables**, configure:
   * `NODE_ENV=production`
   * `COOKIE_SECURE=true`
   * `ADMIN_EMAIL=your_email@domain.com`
   * `SESSION_SECRET=your_generated_64_character_hex_secret`
   * `SMTP_HOST=smtp-relay.brevo.com`
   * `SMTP_PORT=587`
   * `SMTP_USER=your_brevo_user`
   * `SMTP_PASS=your_brevo_key`
   * `MAIL_FROM=verified_sender@yourdomain.com`
   * `MAIL_FROM_NAME="Coastal View Mandarmani"`
   * `TURNSTILE_SITE_KEY=your_production_turnstile_site_key`
   * `TURNSTILE_SECRET_KEY=your_production_turnstile_secret_key`
4. Deploy the project files and run `npm install`.
5. Run `npm run create-super-admin` via Hostinger SSH terminal to set your master password.
6. Access `/admin` in your browser to complete your initial Authenticator 2FA setup.

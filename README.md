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
| `SETTINGS_ENCRYPTION_KEY` | Yes | Master 32-byte key for AES-256-GCM secret encryption at rest (`openssl rand -base64 32`) | `uqV71hZBROC7RQiQhbFWC6o9sIanrDPgdVixw0zvhgI=` |
| `COOKIE_SECURE` | Yes | Secure cookie flag (`true` in production with HTTPS) | `true` |
| `MFA_ENCRYPTION_KEY` | Optional | 256-bit encryption key for TOTP secrets at rest | `64-hex-characters` |
| `TOTP_ISSUER` | Optional | Authenticator app issuer name | `CoastalViewMandarmani` |
| `APP_URL` | Yes | Public application root URL for reset & notification links | `http://localhost:3000` |
| `SMTP_HOST` | Fallback | SMTP server hostname (Gmail default: `smtp.gmail.com`) | `smtp.gmail.com` |
| `SMTP_PORT` | Fallback | SMTP port (465 for SSL/TLS, 587 for STARTTLS) | `465` |
| `SMTP_SECURE` | Fallback | Use SSL/TLS (`true` for port 465, `false` for port 587) | `true` |
| `SMTP_USER` | Fallback | Fallback SMTP Gmail address (configured in admin panel) | `coastalviewbyanis@gmail.com` |
| `SMTP_PASS` | Fallback | Fallback Google App Password | `abcd efgh ijkl mnop` |
| `MAIL_FROM` | Optional | From email address | `coastalviewbyanis@gmail.com` |
| `MAIL_FROM_NAME` | Optional | Sender display name | `"Coastal View"` |
| `SMTP_DAILY_LIMIT` | Optional | Daily send limit for dashboard meter (default: 300) | `300` |
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile public site key | `0x4AAAAAA...` |
| `TURNSTILE_SECRET_KEY`| Optional | Cloudflare Turnstile private secret key | `0x4AAAAAA...` |
| `CAPTCHA_POLICY` | Optional | Turnstile trigger mode (`smart` or `always`) | `smart` |
| `LLM_PROVIDER` | Optional | Chatbot engine (`gemini`, `anthropic`, `openai`) | `gemini` |
| `LLM_API_KEY` | Optional | Provider API key for AI Concierge | `AIzaSy...` |
| `LLM_MODEL` | Optional | Chatbot model identifier | `gemini-1.5-flash` |

### 3. Database Migration & Build Command
```bash
# Generate the master settings encryption key (32 random bytes):
openssl rand -base64 32

# Run database schema migration and integrity checks:
node migrate_db.js

# Compiles dynamic menu categories, updates index.html, and verifies db integrity:
npm run build
```

### 4. Admin Management Commands
```bash
# Initializes the master administrator with hidden terminal password input (Argon2id hashing)
npm run create-super-admin

# Last-resort Super Admin password reset via server terminal
npm run reset-admin-password

# Rotates master settings encryption key, re-encrypts secrets at rest, increments keyVersion:
npm run rotate-encryption-key
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
* **Session Hardening**: Secure, HttpOnly, SameSite=Strict cookies with 15-minute idle timeout, password re-authentication for sensitive actions (price changes, room deletion, user management, database exports), and "Log Out All Devices" functionality.
* **Role-Based Access Control (RBAC)**:
  Unified single source of truth across UI and server endpoints (`roles_permissions.js`):
  
  | Feature / Capability | Super Admin | Manager | Front Desk |
  | :--- | :---: | :---: | :---: |
  | **Settings > Email (App Password & SMTP Relay)** | ✅ Full | ❌ Blocked (403) | ❌ Blocked (403) |
  | **Staff Governance (Invite, Edit, Disable, Delete)** | ✅ Full | ❌ Blocked | ❌ Blocked |
  | **Hotel & Payment Policies (Settings)** | ✅ Full | ❌ Blocked | ❌ Blocked |
  | **Database Backups & JSON Exports** | ✅ Full | ❌ Blocked | ❌ Blocked |
  | **Security Audit Logs & Alert Feeds** | ✅ Full | ❌ Blocked | ❌ Blocked |
  | **Rooms, Inventory & Price Changes** | ✅ Full | ✅ Allowed | ❌ Read Only |
  | **Sold-Out Toggles & Calendar Controls** | ✅ Full | ✅ Allowed | ❌ Read Only |
  | **Bookings Management & Guest Check-in/out** | ✅ Full | ✅ Allowed | ✅ Today Only |
  | **Guest Phone Number Visibility** | ✅ Unmasked | ✅ Unmasked | ⚠️ Partially Masked |
  | **Restaurant Menu & Vehicle Management** | ✅ Full | ✅ Allowed | ❌ Blocked |
  | **Photos, Media & Website Content** | ✅ Full | ✅ Allowed | ❌ Blocked |
  | **Invoices & Billing PDF Generation** | ✅ Full | ✅ Allowed | ✅ Allowed |
  | **Concierge Chat CRM & Guest Inquiries** | ✅ Full | ✅ Allowed | ✅ Allowed |
  | **Revenue Analytics & Financial Reports** | ✅ Full | ✅ Allowed | ❌ Blocked |

### Secure Email Settings & Hardware-Grade Secret Storage (Settings > Email)
The administrative portal includes a dedicated, highly secure **Settings > Email** screen available exclusively to the **Super Admin**:
1. **At-Rest AES-256-GCM Encryption**:
   - The Google App Password is encrypted at rest using **AES-256-GCM** with a random 96-bit Initialization Vector (IV) and a 128-bit authentication tag per value.
   - Master key is derived exclusively from the server environment variable `SETTINGS_ENCRYPTION_KEY` (32 random bytes, generated with `openssl rand -base64 32`).
   - If the key is missing, saving is strictly refused (status 500) and will never fall back to plaintext.
   - The password is decrypted strictly in server memory at send time and never written to disk, HTML, API responses, server logs, or database exports.
2. **Never Exposed to Browser**:
   - Once saved, the browser displays only `"● ● ● ● saved"` along with the date/time of saving. To update it, the administrator enters a new password.
3. **Save & Remove Protection**:
   - Requires re-authentication: Current Super Admin password AND current Authenticator 2FA code (or emergency recovery code) even if already signed in.
   - Pre-Save Verification: Automatically verifies the SMTP login before saving. If Gmail rejects the login, saving is aborted with a safe message (`"Gmail rejected the login. Check the App Password."`) with a clear `"Save anyway"` option kept for the Super Admin.
   - Rate limiting: Strictly enforced at 5 operations per 10 minutes.
   - Header injection protection: Blocks newline (`\r\n`) characters in sender display names.
4. **Change Alerts & Audit Trail**:
   - Any modification sends instantaneous change alert emails to the previous sender/admin addresses and the Super Admin's email (`"Email settings were changed on [time] from [device, IP]. If this wasn't you, act now."`).
   - Audit log records who made the change and which fields were altered (never the secret values).
5. **Session Safety**:
   - Requires a recent login (within 10 minutes) to access the page, and automatically signs out of the page after 5 minutes of inactivity.
6. **Precedence & First-Time Setup**:
   - Database settings take first priority, falling back to environment variables (`SMTP_*`). The active source is prominently displayed in the admin UI.
   - If email is not yet configured, the Super Admin can still log in using their Authenticator app or recovery codes, and an alert banner appears on the dashboard: `"Email isn't set up yet"`.
7. **Key Rotation Command**:
   - Master encryption keys can be rotated without downtime using the CLI tool:
     ```bash
     npm run rotate-encryption-key
     ```
   - Re-encrypts the secret with the new key, increments `keyVersion`, updates the database, and appends an audit log entry.

### How Staff Invitations Work (Zero-Knowledge Credentials)
The owner never asks, views, or types a staff member's password. The entire onboarding process is invite-based:
1. **Super Admin Creates Staff**:
   - Super Admin enters staff full name, private email, phone (optional), role (`Manager`, `Front Desk`, or `Super Admin` with explicit confirmation), and whether to require authenticator 2FA (on by default).
2. **Cryptographic Token & Email Dispatch**:
   - The system registers the account in status `Invited` with no password set.
   - Generates a 32-byte cryptographically secure random token, stores **only its SHA-256 hash** in the database, valid for 24 hours, single-use only.
   - Dispatches a luxury branded HTML invitation email with inline styling, resort logo, and gold action button via the configured Gmail/SMTP sender.
   - **Resilience**: If SMTP is unreachable, the account is still safely created as `Invited`. The Super Admin is notified and given an emergency copyable invitation link (shown once) or can click "Resend Invite" at any time (which automatically invalidates older links).
3. **Staff Sets Credentials**:
   - Staff member clicks the link and arrives at `/admin/accept-invite?token=...`.
   - The token is immediately stripped from the browser URL (`history.replaceState`) and protected with `Referrer-Policy: no-referrer` to prevent URL history leaks.
   - Staff chooses their own private password (enforcing 12+ characters, uppercase, lowercase, number, symbol, dictionary check, and live strength meter).
4. **Authenticator Setup (TOTP 2FA)**:
   - Staff scans the QR code or types the manual Base32 key into Google Authenticator or Microsoft Authenticator.
   - Enters the live 6-digit TOTP code to verify clock synchronization.
   - Receives 8 emergency recovery codes with a one-click copy tool.
5. **Account Activated**:
   - Account status transitions to `Active`.
   - Super Admin receives an automated notification: `[Name] accepted the invitation.`

### Command-Line Recovery: Reset Admin Password
In emergency situations where Super Admin credentials or 2FA devices are lost:
```bash
npm run reset-admin-password
```
- **Execution Guard**: Runs only from the server hosting terminal (SSH or local console).
- **Interactive Security**: Hidden terminal password input (passwords never echo to terminal or history).
- **Policy Enforcement**: Verifies 12+ character complexity and checks against the last 5 passwords.
- **Argon2id Hashing**: Re-hashes with standard memory and time cost parameters.
- **Account Cleanse**: Automatically terminates active sessions and unlocks any failed-login lockout counters.

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

### Server-Side Last-Resort Password Reset (`npm run reset-admin-password`)
Run only by authorized server administrators with SSH/terminal access:
```bash
npm run reset-admin-password
```
* **Hidden Terminal Input**: Prompts for new password and password confirmation with hidden input (masked with `*`, no plaintext echoing).
* **Strict Complexity Verification**: Enforces minimum 12 characters, uppercase, lowercase, numeric digit, and symbol. Blocks common weak passwords.
* **Password History Check**: Verifies that the new password does not match the current password or any of the last 5 passwords used (Argon2id comparison).
* **State-of-the-Art Cryptography**: Hashes the new password with **Argon2id** (`m=64MB, t=3, p=4`).
* **Immediate Lockout Clearance**: Resets failed login attempts to 0 and lifts brute-force lockouts.
* **Global Session Revocation**: Invalidate all active user sessions across all devices.
* **Audit Trail**: Writes an emergency audit entry to `data/db.json` with timestamp and CLI origin.

### Interactive Account Recovery Utility (`npm run recover-account`)
```bash
npm run recover-account
```
This interactive emergency utility allows you to:
1. **Reset 2FA & Generate 8 Fresh Recovery Codes**: Clears the lost Authenticator secret and outputs 8 new recovery codes directly to the terminal.
2. **Unlock Locked Account**: Clears progressive brute-force lockouts and resets failed attempt counters.
3. **Change Password**: Interactively updates the Argon2id password hash for any staff account.
4. **Inspect Account Security State**: Checks 2FA status, remaining recovery codes, and active sessions.

---

## 6. Forgot Password & 2FA Reset Flow

1. **Forgot Password Screen (`/admin/forgot-password`)**:
   * Same luxury glass card design as the login portal.
   * Email/username input field, Turnstile / Math CAPTCHA security check, and "Send Reset Link" button.
   * **Anti-Enumeration Protection**: Always displays the identical generic response: *"If this email belongs to an account, we've sent a reset link."* Includes latency balancing to prevent timing enumeration attacks.
   * **Rate Limiting**: Strictly limited to 3 requests per hour per account and 10 requests per hour per IP.
2. **Cryptographic Reset Tokens**:
   * Generated using 32 cryptographically secure random bytes (`crypto.randomBytes(32)`).
   * Stored in database strictly as a **SHA-256 hash** (plaintext tokens never stored at rest).
   * Valid for **30 minutes**, strictly **single-use**, and automatically invalidates any previous pending tokens.
3. **Reset Password Screen (`/admin/reset-password?token=...`)**:
   * Token is validated on initial page load; if invalid, expired, or already consumed, displays a clear *"Link Expired or Already Used"* card with a *"Request a New Link"* action.
   * URL token is immediately purged from browser history using `history.replaceState`.
   * Served with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, and zero tracking scripts.
   * Live password strength meter with 4 visual requirement badges (12+ characters, uppercase, lowercase, number, symbol).
   * Show/hide password visibility eye toggle.
   * **Mandatory Second Factor on Reset**: Requires Authenticator TOTP code, single-use recovery code, or 6-digit email code (with 60-second cooldown) before any password change is committed. Stolen mailbox access alone cannot compromise the account.
   * **Session Revocation**: Automatically signs out all existing sessions across all browsers and devices upon password change.
   * **Confirmation Alert**: Dispatches a branded *"Your password was changed"* confirmation email to the account address.

---

## 7. Gmail SMTP Sending Service & Email Templates

### Configuration Guide
To send emails using **Gmail SMTP**:
1. Log in to your Google Account > **Security** > Ensure **2-Step Verification** is turned ON.
2. Under "How you sign in to Google", click **2-Step Verification** > **App passwords**.
3. Create an app named `Coastal View Admin` and copy the 16-character generated password.
4. Add the following to your `.env` file:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=your_account@gmail.com
   SMTP_PASS=your_16_char_app_password
   MAIL_FROM=your_account@gmail.com
   MAIL_FROM_NAME="Coastal View · Managed By Ani's"
   ADMIN_EMAIL=your_account@gmail.com
   APP_URL=https://yourdomain.com
   ```
   *(Alternatively, port 587 with `SMTP_SECURE=false` using STARTTLS is fully supported).*

### Features & Resilience
* **`sendMail()` Service**: One unified email dispatch service with timeout (10-15s), one automatic retry, HTML and plain-text multipart bodies, and safe error handling. A mail server failure **never crashes login** or booking flows.
* **Branded Mobile-Friendly Templates**: Max width 560px, brand color palette (Ocean Blue `#073B4C`, Champagne Gold `#D4AF37`, Sand `#F8FAFC`), logo header, and Mandarmani footer address.
* **Security**: Verification codes and reset links are **never included in subject lines or preheader preview texts**.
* **Templates Included**:
  * **A. Login Verification Code**: 6-digit monospace box, 10-minute expiry warning, IST timestamp, device & IP details, and security advice.
  * **B. Password Reset Link**: Gold action button, 30-minute validity, IST timestamp, device & IP metadata, and ignorance advisory.
  * **C. Password Changed**: Immediate alert with change timestamp, IP, device, and immediate reset link if unauthorized.
  * **D. New Device Login Alert**: Dispatches when a new browser or device logs into an admin account.

### Email Diagnostics & Testing
* **Admin Portal**: Settings > Email & Free SMTP > **"Send Test Email to Super Admin"** button (Super Admin only).
* **CLI Test Tool**:
  ```bash
  npm run test-email
  ```
  Performs TLS handshake, verifies credentials, and delivers test message with clear status output.

---

## 8. Verification & Automated Test Suites

```bash
# Run comprehensive 28-point authentication, password reset & email verification suite
npm run test:auth-email

# Or run the legacy admin security suite
node test_admin_auth_email_suite.js
```
The test suite validates:
* Real vs unknown email forgot password anti-enumeration.
* Single-use token enforcement and expired link rejection.
* Password complexity & rejection of last 5 passwords via Argon2id.
* Mandatory second factor (TOTP / Recovery / Email code) on reset.
* Session termination & confirmation email dispatch.
* 6-digit login verification code hashing, 5-attempt lockout & 60s cooldown.
* Safe error handling on invalid App Password (zero server crashes).
* Terminal CLI `npm run reset-admin-password` command execution.
* Zero hardcoded secrets in code, logs, or Git repository.

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

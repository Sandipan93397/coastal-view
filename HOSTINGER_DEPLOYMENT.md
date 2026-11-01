# Coastal View Mandarmani — Production Deployment Guide (Hostinger Node.js)

---

## 1. Authoritative Production Engine (Single Deployment Path)

- **Production Application Engine:** **Node.js (`server.js`, Express 5 + built-in `node:sqlite`)** is the **sole** production backend and static/API server for Coastal View Mandarmani.
- **Node.js Version Required:** **Node.js 22.x LTS** (recommended) or **Node.js 20.x LTS** (`>= 20.5.0` minimum; `22.x` includes built-in `node:sqlite` (`DatabaseSync`) out of the box).
- **Legacy PHP Engine Removed:**
  - The legacy PHP prototype (`api/*.php`) and the old "Method 1 (Static HTML + PHP)" dual-path instructions have been **permanently removed** from the repository (`git rm -rf api`) and from `.htaccess`.
  - **Confirmation that PHP is not needed:** A full codebase audit across `index.html`, `gallery.html`, `menu.html`, `admin/*.html`, `assets/js/*.js`, and all backend modules confirmed **zero** `.php` endpoints are called anywhere. Every public and admin feature—room availability, reservations, dynamic pricing, restaurant menu, gallery media optimization (`sharp`), PDF invoice generation (`pdfkit`), AI concierge (`chatbot_service.js`), and Argon2id + 2FA/TOTP admin authentication—runs exclusively through `server.js` on `/api/*`.

---

## 2. Clean Production Package (`npm run build:prod`)

To prevent accidental upload of local development databases, SQLite WAL files, backups, `.env` secrets, user uploads, or test scripts, build the clean production release archive using:

```bash
npm run build:prod
```

This runs `scripts/build_production_package.js`, which packages the allowlisted production files into `dist/coastal-view-production.zip` (and writes `dist/production-manifest.json`) while enforcing automated guards that **exclude**:
- `data/` (local JSON databases, invoices, sessions, backups)
- `*.sqlite*` (`admin_staff.sqlite`, `-wal`, `-shm`)
- `db-backup-*.json`, `*.bak*`, `*.backup*`
- `.env` and `.env.*` (only `.env.example` with blank/placeholder keys is included)
- `uploads/` (local room, gallery, and menu media uploads)
- `test_*` and `verify_*` (all test harnesses and verification suites)
- `scratch/` (temporary scratch scripts and diagnostics)
- `.git/` (Git commit history and repository metadata)
- `api/` (legacy PHP files)
- `node_modules/` (installed cleanly on the server via `npm ci --omit=dev`)

### Final Production Package File List (`dist/coastal-view-production.zip` — 92 Files)

```text
.env.example
.htaccess
admin/accept-invite.html
admin/admin.css
admin/admin.js
admin/forgot-password.html
admin/index.html
admin/reset-password.html
admin/vendor/chart.umd.js
admin/vendor/cropper.min.css
admin/vendor/cropper.min.js
assets/css/style.css
assets/fonts/PlayfairDisplay-Bold.ttf
assets/fonts/PlayfairDisplay-Regular.ttf
assets/fonts/Poppins-Bold.ttf
assets/fonts/Poppins-Medium.ttf
assets/fonts/Poppins-Regular.ttf
assets/fonts/Poppins-SemiBold.ttf
assets/images/anirban-das-owner-large.webp
assets/images/anirban-das-owner-med.webp
assets/images/anirban-das-owner-thumb.webp
assets/images/anirban-das-owner.jpg
assets/images/anirban-das-owner.webp
assets/images/archive/anirban-das-owner.jpg
assets/images/candlelight-dinner.jpg
assets/images/cocktail-lounge.jpg
assets/images/dining-hall.jpg
assets/images/dish_biryani_1792300439453.jpg
assets/images/dish_chingri_malaikari_1792138359063.jpg
assets/images/dish_fish_fry_1792300461754.jpg
assets/images/dish_ilish_bhapa_1792138246600.jpg
assets/images/exterior-night.jpg
assets/images/favicon.png
assets/images/hero-sunset-pool-mobile.webp
assets/images/hero-sunset-pool.jpg
assets/images/hotel-corridor.jpg
assets/images/logo-clean.jpg
assets/images/logo-emblem.png
assets/images/logo-icon.png
assets/images/logo-invoice.png
assets/images/logo-light.png
assets/images/logo.jpg
assets/images/logo.png
assets/images/mandarmani-beach.jpg
assets/images/pool-night.jpg
assets/images/reception-lobby.jpg
assets/images/restaurant-dining.jpg
assets/images/room-coral-retreat.jpg
assets/images/room-cosy-deluxe.jpg
assets/images/room-ocean-whisper.jpg
assets/images/room-palm-grove.jpg
assets/images/room-pool-haven.jpg
assets/images/room-royal-pearl.jpg
assets/images/room-sunset-horizon.jpg
assets/images/seafood-market.jpg
assets/images/tajpur-beach.jpg
assets/js/booking.js
assets/js/concierge.js
assets/js/main.js
auth_security.js
chatbot_service.js
chatbot/ai_fallback.js
chatbot/answer_builders.js
chatbot/booking_state_machine.js
chatbot/chatbot_engine.js
chatbot/intent_router.js
chatbot/intents.json
chatbot/normalizer.js
db_store.js
email_service.js
gallery.html
HOSTINGER_DEPLOYMENT_GUIDE.md
HOSTINGER_DEPLOYMENT.md
index.html
invoice_generator.js
llms.txt
media_security.js
menu.html
package-lock.json
package.json
robots.txt
roles_permissions.js
scripts/build_production_package.js
scripts/create_super_admin.js
scripts/recover_account.js
scripts/reset_admin_mfa.js
scripts/reset_admin_password.js
scripts/rotate_encryption_key.js
scripts/unlock_admin.js
server.js
settings_crypto.js
sitemap.xml
```

---

## 3. Environment Variables Reference & Production Startup Guard

### 3.1 Production Startup Guard Behavior (`server.js`)
When `NODE_ENV=production`, `validateProductionEnvironment()` in `server.js` runs before the HTTP server binds to a port and **refuses to start (`process.exit(1)`)** if:
1. Any required production environment variable listed in **Table 3.2** is missing or empty.
2. `APP_URL` does not start with `https://` or contains `localhost`, `127.0.0.1`, `0.0.0.0`, or `[::1]`.
3. `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY` is set to Cloudflare's development test key (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`).

### 3.2 Mandatory Production Environment Variables (Enforced at Startup)

| Variable Name | Purpose & Production Requirement |
| :--- | :--- |
| `NODE_ENV` | Must be set to `production`. Enables strict startup guards, disables localhost dev 2FA/reset banners, and blocks test CAPTCHA keys. |
| `APP_URL` | Canonical public HTTPS origin (e.g., `https://<YOUR_DOMAIN>`). Must begin with `https://` and **must never contain `localhost`**. Used in password-reset links, security alerts, and signed PDF invoice URLs. |
| `ADMIN_EMAIL` | Authoritative email address for the Super Admin account and security alert notifications. |
| `SESSION_SECRET` | 256-bit (64-hex-character) secret key used for signing session tokens, CSRF tokens, and invoice verification HMACs. |
| `SETTINGS_ENCRYPTION_KEY` | 256-bit key (`base64` or `hex`) used by `settings_crypto.js` (`AES-256-GCM`) to encrypt SMTP credentials stored via the Admin Settings panel. |
| `MFA_ENCRYPTION_KEY` | 256-bit (64-hex-character) key used by `auth_security.js` (`AES-256-GCM`) to encrypt TOTP authenticator secrets at rest. |
| `TURNSTILE_SITE_KEY` | Production Cloudflare Turnstile widget site key for `<YOUR_DOMAIN>`. |
| `TURNSTILE_SECRET_KEY` | Production Cloudflare Turnstile server-side secret key. |
| `DATA_DIR` | Absolute path to the persistent data folder **outside** `public_html` (e.g., `/home/<HOSTINGER_SSH_USER>/coastalview_data`). |
| `UPLOADS_DIR` | Absolute path to the persistent media uploads folder **outside** `public_html` (e.g., `/home/<HOSTINGER_SSH_USER>/coastalview_uploads`). |

### 3.3 Optional / Configurable Environment Variables (Names Only)

| Variable Name | Purpose |
| :--- | :--- |
| `PORT` | HTTP listener port (managed automatically by Hostinger Passenger/LiteSpeed; defaults to `3000` if unset). |
| `DB_PATH` | Optional explicit path override for `db.json` (defaults to `${DATA_DIR}/db.json`). |
| `COOKIE_SECURE` | Set to `true` in HTTPS production so admin session cookies include the `Secure` attribute. |
| `CAPTCHA_POLICY` | `smart` (default: triggers after 2 failed attempts or rate-limit threshold) or `always` (every login). |
| `TOTP_ISSUER` | Display label in Google Authenticator / Authy (defaults to `CoastalViewMandarmani`). |
| `SMTP_HOST` | Outbound SMTP hostname (e.g., `smtp.gmail.com` or `smtp.hostinger.com`). |
| `SMTP_PORT` | Outbound SMTP port (`465` for SSL/TLS or `587` for STARTTLS). |
| `SMTP_SECURE` | `true` for port `465`; `false` for port `587`. |
| `SMTP_USER` | Outbound SMTP username / email address. |
| `SMTP_PASS` | Outbound SMTP password or 16-character Google App Password. |
| `MAIL_FROM` | Sender email address for booking confirmations, invoices, and 2FA emails. |
| `MAIL_FROM_NAME` | Sender display name (e.g., `"Coastal View · Managed By Ani's"`). |
| `SMTP_DAILY_LIMIT` | Daily safety cap for outbound emails (defaults to `300`). |
| `LLM_PROVIDER` | Optional AI Concierge provider (`gemini`, `anthropic`, `openai`, or `openrouter`). Falls back to deterministic local database engine if unset. |
| `LLM_API_KEY` | Optional API key for the chosen `LLM_PROVIDER`. |
| `LLM_MODEL` | Optional model identifier (e.g., `gemini-1.5-flash`). |
| `LLM_BASE_URL` | Optional custom OpenAI-compatible base URL. |

### 3.4 Commands to Generate Cryptographic Secrets

Run these commands locally or over SSH to generate fresh, cryptographically random values for your production environment (never reuse development values):

```bash
# 1. Generate SESSION_SECRET (64 hex characters = 256 bits)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Generate MFA_ENCRYPTION_KEY (64 hex characters = 256 bits)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Generate SETTINGS_ENCRYPTION_KEY (32 random bytes, Base64-encoded)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# (Alternative using OpenSSL):
openssl rand -base64 32
```

---

## 4. Exact SSH Setup, Deployment & Admin CLI Commands

Replace these placeholders in all commands below:
- `<HOSTINGER_SSH_USER>` — Your Hostinger Linux account username (e.g., `u123456789`)
- `<YOUR_DOMAIN>` — Your production domain name (e.g., `coastalviewmandarmani.com`)
- `<SSH_PORT>` — Hostinger SSH port (typically `65002`)
- `<SERVER_IP>` — Your Hostinger server IP address

### 4.1 Connect via SSH & Create Persistent Folders Outside `public_html`

Storing data and media outside `public_html` guarantees that redeploying code or replacing `public_html` **never erases bookings, rooms, admin/staff accounts, invoices, or uploaded photos**.

```bash
ssh -p <SSH_PORT> <HOSTINGER_SSH_USER>@<SERVER_IP>

# Create persistent database, backup, and invoice directories outside public_html
mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_data/backups
mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_data/invoices

# Create persistent media upload directories outside public_html
mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_uploads/rooms
mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_uploads/gallery
mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_uploads/menu

# Restrict permissions on the persistent data directory so only your Linux user can read/write it
chmod 700 /home/<HOSTINGER_SSH_USER>/coastalview_data
chmod 755 /home/<HOSTINGER_SSH_USER>/coastalview_uploads
```

### 4.2 Extract the Clean Production Package & Install Dependencies

Upload `dist/coastal-view-production.zip` to `/home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html/` (via SCP/SFTP or hPanel File Manager), then run:

```bash
cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html

# Extract the clean production bundle
unzip -o coastal-view-production.zip
rm -f coastal-view-production.zip

# Install production dependencies only
npm ci --omit=dev
```

### 4.3 Create Initial Super Admin Account (Interactive Hidden Input)

Once your environment variables (`DATA_DIR`, `ADMIN_EMAIL`, etc.) are configured in hPanel or `/home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html/.env` (`chmod 600 .env`):

```bash
cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run create-super-admin
```
- Prompts interactively for the Super Admin username and password (characters are hidden during typing).
- Hashes the password with **Argon2id** (`64 MB` memory cost, `3` iterations) and writes the account to both `/home/<HOSTINGER_SSH_USER>/coastalview_data/admin_staff.sqlite` (WAL mode) and `/home/<HOSTINGER_SSH_USER>/coastalview_data/admin_staff_persistent.json`.

### 4.4 Admin Emergency Reset & Maintenance CLI Commands

Run any of the following from `/home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html`:

1. **Reset Admin Password (interactive hidden prompt, revokes active sessions & clears lockout):**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
   DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run reset-admin-password
   ```
2. **Unlock Admin Account (clears failed login counters & 15-minute lockout timers without changing password):**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
   DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run unlock-admin
   ```
3. **Reset Admin MFA / 2FA (disables TOTP authenticator requirement & clears pending 2FA challenges):**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
   DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run reset-admin-mfa
   ```
4. **Full Emergency Account Recovery Wizard (unlock + disable MFA + set new password):**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
   DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run recover-account
   ```
5. **Rotate `SETTINGS_ENCRYPTION_KEY` (re-encrypts stored SMTP credentials with a new key):**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html
   OLD_SETTINGS_ENCRYPTION_KEY=<OLD_KEY> NEW_SETTINGS_ENCRYPTION_KEY=<NEW_KEY> DATA_DIR=/home/<HOSTINGER_SSH_USER>/coastalview_data npm run rotate-encryption-key
   ```

### 4.5 Daily Automated Backup Cron Job

Configure in **hPanel → Advanced → Cron Jobs** (or `crontab -e`) to run daily at `02:30 AM`:

```bash
30 2 * * * mkdir -p /home/<HOSTINGER_SSH_USER>/coastalview_backups && tar -czf /home/<HOSTINGER_SSH_USER>/coastalview_backups/coastalview_data_$(date +\%F).tar.gz -C /home/<HOSTINGER_SSH_USER>/coastalview_data . && find /home/<HOSTINGER_SSH_USER>/coastalview_backups -name "coastalview_data_*.tar.gz" -mtime +30 -delete
```

---

## 5. Double-Booking Prevention & Concurrency Proof

### 5.1 How Simultaneous Bookings Are Serialized
In `server.js`, all reservation creation (`POST /api/bookings`), modification (`PUT /api/bookings/:id`), and room-block mutations execute inside an in-process asynchronous mutex (`bookingMutex = new AsyncLock()`):
1. When two guests submit a booking at the exact same millisecond for the last remaining room, both requests enter `await bookingMutex.acquire(async () => { ... })`.
2. **Request 1** acquires the lock first, reads the latest state from `readDB()`, runs `checkDoubleBooking(db, room.id, checkIn, checkOut, null, parsedRoomsCount)` (which computes overlapping confirmed reservations and room blocks per night), appends `newBooking` to `db.bookings`, and atomically persists `writeDB(db)` to disk (`db.json.tmp.<pid>.<timestamp>` $\rightarrow$ `fs.renameSync`) **before** releasing the lock.
3. **Request 2** resumes only after Request 1's lock is released, reads the updated `db.json` containing Request 1's reservation, sees `available: 0`, and immediately returns `HTTP 400 Bad Request` (`"Sorry! Only 0 room(s) available for ..."`).

### 5.2 Verified Concurrency Proof (Last Remaining Room Race Test)
Tested against `POST /api/bookings` for `palm-grove-family-suite` (`totalQuantity: 2`):
- **Pre-race state (`2027-02-10` to `2027-02-12`):** 1 room already booked (`booked: 1`, `available: 1` — **only 1 room remaining**).
- **Simultaneous execution:** Fired two concurrent `POST /api/bookings` requests (`Request A` and `Request B`, each requesting `roomsCount: 1` for `2027-02-10` to `2027-02-12`) via `Promise.all([fetch(...), fetch(...)])`.
- **Observed Result:**
  - `Request A`: **`HTTP 200 OK`** — `{"success": true, "bookingId": "CV-...", ...}`
  - `Request B`: **`HTTP 400 Bad Request`** — `{"error": "Sorry! Only 0 room(s) available for Palm Grove Family Suite between 2027-02-10 and 2027-02-12.", "available": 0}`
  - **Post-race DB state:** `totalQuantity: 2`, `booked: 2`, `available: 0` (zero overbooking).

> **Important Single-Instance Requirement:** Because `bookingMutex` coordinates concurrency in Node.js process memory and `db.json` / `admin_staff.sqlite` live on the local filesystem, always run the Node.js application as a **single worker instance** (standard on Hostinger Business Node.js hosting). If you ever scale horizontally to multiple Node.js processes or servers, migrate bookings and inventory locks to **MySQL 8 (`InnoDB`)** with `SELECT ... FOR UPDATE` row-level locking.

---

## 6. What Works If SSH Is NOT Available on Your Plan

If your hosting plan has SSH disabled or restricted, you can still deploy and operate the application using **Hostinger hPanel**:

1. **Creating Persistent Folders (`coastalview_data` and `coastalview_uploads`):**
   - Open **hPanel → Files → File Manager**.
   - Click the top root directory (`/home/<HOSTINGER_SSH_USER>`, one level **above** `domains/<YOUR_DOMAIN>/public_html`).
   - Click **New Folder** and create `coastalview_data` (with subfolders `backups` and `invoices`) and `coastalview_uploads` (with subfolders `rooms`, `gallery`, and `menu`).
2. **Uploading the Clean Package & Installing Dependencies:**
   - In File Manager, navigate to `domains/<YOUR_DOMAIN>/public_html`, upload `dist/coastal-view-production.zip`, right-click it, and click **Extract**.
   - Open **hPanel → Websites → Manage → Node.js**:
     - Set **Node.js Version** to `22.x` (or `20.x`).
     - Set **Application Root** to `domains/<YOUR_DOMAIN>/public_html`.
     - Set **Application Startup File** to `server.js`.
     - Add all required environment variables from **Section 3.2** in the **Environment Variables** section.
     - Click **NPM Install** and then **Restart** the application.
3. **Bootstrapping the Super Admin Account Without Interactive SSH:**
   - Because `npm run create-super-admin` prompts interactively in a TTY terminal, if you do not have SSH access you can initialize your Super Admin locally before uploading:
     1. On your local machine, run:
        ```bash
        DATA_DIR=./prod_bootstrap_data ADMIN_EMAIL=<YOUR_ADMIN_EMAIL> npm run create-super-admin
        ```
     2. Enter your desired production Super Admin username and strong password at the hidden prompt.
     3. Upload the generated `prod_bootstrap_data/admin_staff.sqlite` and `prod_bootstrap_data/admin_staff_persistent.json` via hPanel File Manager directly into `/home/<HOSTINGER_SSH_USER>/coastalview_data/`, then delete the local `prod_bootstrap_data/` directory immediately.
4. **Password Reset & Account Recovery Without SSH:**
   - **Self-Service Password Reset via Email:** Use `https://<YOUR_DOMAIN>/admin/forgot-password.html`. When SMTP is configured, the system emails a single-use, time-limited reset link (`https://<YOUR_DOMAIN>/admin/reset-password.html?token=...`).
   - **Automatic Lockout Expiry:** Brute-force lockouts automatically expire after **15 minutes** without requiring CLI intervention.
   - **Emergency Offline Reset Without SSH:** If both password and MFA are lost and SSH is unavailable, generate a fresh `admin_staff.sqlite` + `admin_staff_persistent.json` locally using `DATA_DIR=./prod_bootstrap_data npm run create-super-admin` and upload those two files to `/home/<HOSTINGER_SSH_USER>/coastalview_data/` via hPanel File Manager, then click **Restart** in hPanel Node.js Manager.

---

## 7. Post-Deploy Smoke-Test Checklist & Rollback Plan

### 7.1 Post-Deploy Smoke-Test Checklist

Run through these checks immediately after every production deployment:

- [ ] **1. Startup & HTTPS Verification:**
  - Visit `https://<YOUR_DOMAIN>` and verify the homepage loads over HTTPS with no mixed-content warnings and `http://<YOUR_DOMAIN>` redirects `301` to `https://`.
- [ ] **2. Sensitive File Access Protection (`.htaccess` & Express Guards):**
  - Confirm that requesting `https://<YOUR_DOMAIN>/.env`, `https://<YOUR_DOMAIN>/data/db.json`, and `https://<YOUR_DOMAIN>/package.json` returns `HTTP 403` or `HTTP 404` (never file contents).
- [ ] **3. Live API Health & Public Catalog:**
  - Verify `GET https://<YOUR_DOMAIN>/api/rooms`, `GET https://<YOUR_DOMAIN>/api/menu`, and `GET https://<YOUR_DOMAIN>/api/gallery` return `HTTP 200` with JSON payloads.
- [ ] **4. Production CAPTCHA & Dev-Code Suppression:**
  - Open `https://<YOUR_DOMAIN>/admin/login.html` and call `GET https://<YOUR_DOMAIN>/api/admin/captcha-config`. Confirm `isLocalhost` is `false` and the `siteKey` is your real Cloudflare Turnstile key (not `1x00000000000000000000AA`).
- [ ] **5. Admin Authentication & 2FA Flow:**
  - Log in at `https://<YOUR_DOMAIN>/admin/login.html`. Confirm that the 2FA verification response does **not** include `devCode`, and that the 6-digit code arrives via email (or TOTP authenticator app) and completes login to `/admin/dashboard.html`.
- [ ] **6. Media Upload Persistence Check:**
  - Upload a test image in Admin Dashboard → Gallery, restart the Node.js app in hPanel, and confirm the image still loads at `https://<YOUR_DOMAIN>/uploads/gallery/...` (stored in `UPLOADS_DIR`).
- [ ] **7. End-to-End Reservation & Invoice Check:**
  - Create a test booking on a future date, verify the PDF invoice downloads cleanly, confirm the confirmation email arrives, and then cancel/delete the test booking from the Admin Dashboard.

### 7.2 Zero-Data-Loss Rollback Plan

Because application code (`public_html`) is completely separated from persistent state (`DATA_DIR` and `UPLOADS_DIR`), rolling back a code deployment takes less than 2 minutes and **never rolls back or loses customer bookings, invoices, or admin accounts**:

1. **Before Every Deploy (Pre-Deploy Snapshot):**
   ```bash
   # Archive current working code release (excluding node_modules)
   tar --exclude='node_modules' -czf /home/<HOSTINGER_SSH_USER>/coastalview_backups/code_predeploy_$(date +%F_%H%M).tar.gz -C /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html .

   # Snapshot persistent data directory
   tar -czf /home/<HOSTINGER_SSH_USER>/coastalview_backups/data_predeploy_$(date +%F_%H%M).tar.gz -C /home/<HOSTINGER_SSH_USER>/coastalview_data .
   ```
2. **To Roll Back Application Code Immediately:**
   ```bash
   cd /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html

   # Restore previous working code archive
   tar -xzf /home/<HOSTINGER_SSH_USER>/coastalview_backups/code_predeploy_<TIMESTAMP>.tar.gz

   # Reinstall exact locked dependencies and restart Passenger / Node.js
   npm ci --omit=dev
   mkdir -p tmp && touch tmp/restart.txt
   ```
   *(If using hPanel without SSH: delete the new code files in `public_html`, extract the previous `coastal-view-production.zip`, click **NPM Install**, and click **Restart** in hPanel Node.js Manager.)*
3. **To Restore Persistent Database State (Only If Data Corruption Occurred):**
   ```bash
   # Restore data directory from snapshot
   tar -xzf /home/<HOSTINGER_SSH_USER>/coastalview_backups/data_predeploy_<TIMESTAMP>.tar.gz -C /home/<HOSTINGER_SSH_USER>/coastalview_data

   # Restart Node.js process
   mkdir -p /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html/tmp
   touch /home/<HOSTINGER_SSH_USER>/domains/<YOUR_DOMAIN>/public_html/tmp/restart.txt
   ```

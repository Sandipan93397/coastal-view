# Coastal View, Managed By Ani's
## Hostinger Business Web Hosting Deployment Guide

This project is built to be **100% production-ready for Hostinger Business Web Hosting**. It offers a dual-engine architecture:
1. **PHP 8.x + SQLite Engine (Zero-Configuration, Recommended for Hostinger)**: Upload and run immediately without setting up external MySQL databases or installing packages!
2. **Node.js Express Engine**: Run via Hostinger's hPanel Node.js selector or on any Node-enabled cloud/VPS environment.

---

### Brand & Hotel Summary
* **Property:** Coastal View
* **Management:** Managed By Ani's
* **Host / Founder:** Anirban Das
* **Address:** Rina Rd, Mandarmani, West Bengal 721455
* **Admin Account:** Created securely via `npm run create-super-admin` (reads `ADMIN_EMAIL` and prompts for custom password with Argon2id hashing)

---

## Method 1: Instant Deployment via Hostinger File Manager / FTP (Recommended)

Hostinger Business Web Hosting includes PHP 8.1 / 8.2 / 8.3 with PDO SQLite enabled by default.

### Step 1: Prepare the Files
1. In your local project directory (`c:\mandarmaniproject`), select all files and folders:
   * `index.html`
   * `.htaccess`
   * `assets/` (css, js, images, logos, favicons)
   * `admin/` (index.html, admin.css, admin.js)
   * `api/` (all .php files)
   * `data/` (`db.json`)
   * `uploads/` (`uploads/menu/`)
2. Compress them into a single `coastal-view.zip` archive.

### Step 2: Upload to Hostinger hPanel
1. Log in to your [Hostinger hPanel](https://hpanel.hostinger.com).
2. Go to **Websites** -> Select your domain -> Click **Dashboard**.
3. Under **Files**, click **File Manager** (or connect via FileZilla FTP).
4. Navigate into the `public_html/` directory.
5. Upload `coastal-view.zip` into `public_html/`.
6. Right-click `coastal-view.zip` and select **Extract**.

### Step 3: Verify File Permissions
1. In File Manager, right-click on the `data/` directory and ensure its permissions are set to `755` (Read, Write, Execute for Owner).
2. Ensure `data/db.json` has write permissions (`644` or `666`) so your bookings, settings, and concierge chats persist seamlessly.
3. Ensure `uploads/` and `uploads/menu/` have write permissions (`755` or `777`) so custom circular dish photos uploaded via the admin portal can be saved.

### Step 4: Test in Browser
* **Public Website:** `https://yourdomain.com/`
* **Admin Dashboard:** `https://yourdomain.com/admin/`

---

## Method 2: Hostinger Business Node.js Application Deployment (Recommended)

1. **Node.js Version:**
   * Select **Node.js `22.x` (`>= 22.5.0`)** in Hostinger hPanel -> **Advanced** -> **Node.js** so built-in `node:sqlite` (`admin_staff.sqlite` in WAL mode) is active. (Node `20.x` / `18.x` is also supported via automatic atomic JSON fallback).
2. **Keep `DATA_DIR` and `UPLOADS_DIR` Outside `public_html` (Redeploy-Safe):**
   * On Hostinger, Git pulls or ZIP redeployments inside `public_html/` can overwrite files inside the app root.
   * Create persistent directories **outside** `public_html/` via SSH or File Manager:
     ```bash
     mkdir -p /home/u123456789/coastalview_data/backups
     mkdir -p /home/u123456789/coastalview_data/invoices
     mkdir -p /home/u123456789/coastalview_uploads
     chmod 700 /home/u123456789/coastalview_data
     ```
   * Set in `.env` (or hPanel Node.js Environment Variables):
     ```env
     NODE_ENV=production
     DATA_DIR=/home/u123456789/coastalview_data
     UPLOADS_DIR=/home/u123456789/coastalview_uploads
     ```
3. **Exclude Test Files from Production:**
   * Do **not** upload `test_*.js`, `verify_*.js`, `test_db_helper.js`, `scripts/test_*.js`, or `scratch/` (see `.deployignore` and `package.json` `"files"`).
4. **Daily Automated Backups:**
   * The Node server runs `performDailyBackup()` on startup and every 24 hours, writing `db-backup-YYYY-MM-DD.json` into `$DATA_DIR/backups/` (14-day rolling retention).
   * In Hostinger **hPanel -> Advanced -> Cron Jobs**, add a daily off-dir backup cron (`0 2 * * *`):
     ```bash
     mkdir -p /home/u123456789/offsite_backups && tar -czf /home/u123456789/offsite_backups/coastalview-data-$(date +\%F).tar.gz /home/u123456789/coastalview_data && find /home/u123456789/offsite_backups -name "coastalview-data-*.tar.gz" -mtime +30 -delete
     ```

---

## Security & `.htaccess` Rules Included

The included `.htaccess` file automatically:
* Blocks public web access to the `data/` directory (protecting `db.json` and database files from direct download).
* Routes clean API endpoints (e.g. `/api/rooms`, `/api/bookings`) smoothly to their respective backend handlers.
* Enables GZIP compression for ultra-fast loading on mobile and desktop devices.
* Sets modern HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`).

---

## Admin Panel Features & Management

1. **Dashboard Overview:** Live summary of Today's Check-ins, Check-outs, Total Bookings, Confirmed Stays, Pending Advance, Total Revenue, 20% Advance Collected, and 80% Hotel Balance Due.
2. **Rooms & Live Inventory:** Toggle any room as **Sold Out** with one click (instantly places a Sunset Coral ribbon on the public site, disables booking, and informs the chatbot). Edit nightly price per room on the fly.
3. **Reservations Table:** View every guest reservation, dates, nights, vehicle transport add-on, candlelight dinner selection, and print official vouchers.
4. **Menu Manager (103 Dishes across 9 Categories):** Official printed menu integration with live search, dietary filters (Pure Veg / Non-Veg), category filters, and built-in drag-and-zoom circular photo cropper (saving optimized round WebP assets).
5. **Ani's Travels Fleet & Pricing:** Configure daily rates for Toto (E-Rickshaw), Auto, and luxury AC Cars. Toggle individual vehicle availability and control the booking bar trip-type selector.
6. **Dining & Coral Reef Lounge:** Add or update seafood, Bengali dishes, signature cocktails, mocktails, prices, and badges (`Chef's Special`, `Spicy`).
7. **Concierge Chat CRM & Leads:** Review multi-lingual visitor conversations (English, Bengali, Hindi), inspect transcripts, take over live chats, or follow up on callback leads.
8. **Security Audit Trail (Read-Only):** Tamper-proof ledger logging every price change, room edit, vehicle update, and staff action with timestamp, username, role, and IP address.
9. **Hotel Settings / Editable Fields:** Change hotel phone numbers, WhatsApp, reservation email, UPI payment ID, bank account transfer instructions, tax/advance percentages, CAPTCHA policy, and admin credentials.

---

## Cloudflare Turnstile Bot Protection (Admin Login Security)

The admin portal incorporates Cloudflare Turnstile for privacy-friendly bot detection.

### Step 1: Create Free Keys in Cloudflare Dashboard
1. Register or log in at [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Click **Turnstile** in the sidebar and choose **Add site**.
3. **Site name:** `Coastal View Admin`
4. **Domain:**
   - Add your live domain: e.g. `coastalviewmandarmani.com`
   - Also add `localhost` for local laptop development and testing!
5. **Widget Mode:** Managed (interactive challenge only when risk detected).
6. Click **Create** to receive your **Site Key** and **Secret Key**.

### Step 2: Configure Environment Variables
* **Local Development (`.env`):**
  ```env
  TURNSTILE_SITE_KEY=your_site_key_here
  TURNSTILE_SECRET_KEY=your_secret_key_here
  CAPTCHA_POLICY=smart
  ```
  *(Note: If left blank during local development, the server automatically defaults to Cloudflare's official test keys on `localhost` so development and tests never break!)*
* **Hostinger Deployment:**
  - Add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Hostinger's environment variables / `.env` file.
  - In production mode, if keys are missing, the server logs a security alert and displays a helpful prompt rather than skipping bot defense.


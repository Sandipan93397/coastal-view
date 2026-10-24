# Coastal View — Free Permanent 24/7 Cloud Hosting Guide (Render.com + UptimeRobot)

This guide walks you through deploying **Coastal View, Mandarmani** to **Render.com** 100% free forever, and setting up **UptimeRobot** so your server stays awake 24/7/365 with zero downtime and zero cost.

---

## What We Have Already Prepared for You
1. **Git Repository Initialized**: All project files committed on branch `main` (with sensitive logs and test files ignored).
2. **`render.yaml` Blueprint Created**: Automated configuration for Render's cloud platform.
3. **Health Check Endpoint Added (`/health`)**: Ultra-lightweight endpoint that responds in milliseconds for 24/7 keep-alive monitoring.
4. **Cloud Load-Balancer Proxy Support**: Added `app.set('trust proxy', 1)` in [server.js](file:///c:/mandarmaniproject/server.js) so HTTPS cookies, sessions, and guest IP detection work seamlessly behind cloud reverse proxies.
5. **Node.js Engine Declared**: Specified Node `>=18.0.0` in [package.json](file:///c:/mandarmaniproject/package.json).

---

## Step 1: Push Your Code to GitHub (2 Minutes)

1. Go to [github.com/new](https://github.com/new) and log in (or create a free account).
2. Set **Repository name**: e.g., `coastal-view-mandarmani`.
3. Choose **Public** or **Private** (either works). Leave README, .gitignore, and license unchecked.
4. Click **Create repository**.
5. Copy your repository URL (e.g. `https://github.com/YOUR_USERNAME/coastal-view-mandarmani.git`).
6. In your project directory, open your terminal and run:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/coastal-view-mandarmani.git
   git push -u origin main
   ```

---

## Step 2: Deploy on Render.com (100% Free)

1. Go to [render.com](https://render.com) and click **Sign Up** -> choose **Sign in with GitHub**.
2. From the dashboard, click **New +** in the top right and select **Web Service**.
3. Select your GitHub repository (`coastal-view-mandarmani`) and click **Connect**.
4. Configure the service settings (Render will auto-fill most from `render.yaml`):
   * **Name:** `coastal-view-mandarmani` (or your chosen name)
   * **Region:** `Singapore` (fastest for India / West Bengal)
   * **Branch:** `main`
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
   * **Instance Type:** `Free` ($0/month)
5. Under **Environment Variables**, verify:
   * `NODE_ENV`: `production`
   * `COOKIE_SECURE`: `true`
   * `SESSION_SECRET`: Click "Generate" or set a long random string
   * `ADMIN_EMAIL`: `your_admin_email@example.com`
   * `CAPTCHA_POLICY`: `smart`
   * `TURNSTILE_SITE_KEY`: `your_cloudflare_turnstile_site_key`
   * `TURNSTILE_SECRET_KEY`: `your_cloudflare_turnstile_secret_key`
6. Click **Create Web Service**.
7. Render will build and deploy your app in 1–2 minutes. When done, your live URL will appear at the top:
   `https://coastal-view-mandarmani.onrender.com`

---

## Step 3: Keep the Server Awake 24/7 (Free UptimeRobot Setup)

On Render's free tier, servers go to sleep after 15 minutes if there is no traffic (causing a ~30 second wait on the next visit). To keep it permanently awake 24/7/365:

1. Sign up for a free account at [uptimerobot.com](https://uptimerobot.com).
2. Click **Add New Monitor**.
3. Fill in:
   * **Monitor Type:** `HTTP(s)`
   * **Friendly Name:** `Coastal View 24/7 Keep-Alive`
   * **URL (or IP):** `https://coastal-view-mandarmani.onrender.com/health`
   * **Monitoring Interval:** `5 minutes` (or `10 minutes`)
4. Click **Create Monitor**.

That's it! UptimeRobot will ping `/health` every 5 minutes. Render will recognize the traffic, and your server will **NEVER sleep**, staying fast and active 24 hours a day, 7 days a week, 100% free!

---

## Step 4: Connecting a Free Custom Domain (Optional)

If you own a custom domain (e.g. `coastalviewmandarmani.com`):
1. In Render Dashboard -> Your Service -> **Settings** -> **Custom Domains**.
2. Click **Add Custom Domain** and enter your domain name.
3. Render will give you a CNAME record. Add it in your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.).
4. Render automatically issues a **Free Let's Encrypt SSL Certificate** with auto-renewal!

---

## Admin Panel Access on Live Site
* **Live Website:** `https://your-app.onrender.com/`
* **Live Admin Portal:** `https://your-app.onrender.com/admin/`
* **Super Admin Setup:** In Render Shell or terminal, run `npm run create-super-admin` (reads `ADMIN_EMAIL` from environment variables, sets strong password with Argon2id, and locks itself).

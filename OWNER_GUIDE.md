# Coastal View Mandarmani - Hotel Owner & Administrator Guide
**A Plain-Language Manual for Managing Hotel Staff, 2FA Security & Email Delivery**

---

### 1. How to Log In to the Admin Portal
1. Open your browser and go to your website address followed by `/admin` (e.g. `https://coastalviewmandarmani.com/admin`).
2. Type your registered email address or username and your password.
   * You can click the **Eye icon** next to the password box to reveal what you typed.
3. If prompted, complete the quick security check (Cloudflare checkmark or math question).
4. Click **"Verify Credentials & Continue"**.
5. You will now see the **Verification Code screen**:
   * Open your Authenticator app on your phone (Google Authenticator, Microsoft Authenticator, or 1Password).
   * Type the current 6-digit code shown for "Coastal View Mandarmani".
   * The boxes auto-advance as you type, and log you in automatically as soon as the 6th digit is entered.
   * *Tip*: Check **"Remember this device for 7 days"** on your personal laptop so you do not need to enter a 2FA code every single time.

---

### 2. How to Set Up Your Authenticator App (First Time)
1. On your very first login, a setup screen will appear before you reach the dashboard.
2. Open your smartphone camera or your Authenticator app and scan the **QR code** displayed on your screen.
   * *If you cannot scan*: Tap **Copy** next to the manual secret key and paste it directly into your Authenticator app.
3. **Save your 8 Recovery Codes**:
   * Under the QR code, you will see 8 emergency recovery codes.
   * Click **"Copy All"** and save them in a secure place (like your password manager, a notes app, or printed on paper).
4. Enter the 6-digit code from your app into the confirmation box and click **"Activate & Continue to Dashboard"**.
5. That’s it! Your account is now fully protected against unauthorized access.

---

### 3. How to Use Emergency Recovery Codes
If you lose your phone, your battery dies, or you get a new device without transferring your Authenticator:
1. Go to the login screen and enter your email and password as usual.
2. On the Verification Code screen, click **"Use Recovery Code"** at the bottom left.
3. Type any one of your 8 emergency codes (e.g. `A1B2C3D4`) and click **"Verify & Access Portal"**.
4. You will be logged in immediately.
   * *Remember*: Each recovery code works **only once**.
5. Once inside, go to **Settings > Security & Active Sessions** and click **"Generate 8 Codes"** to create fresh recovery codes.

---

### 4. What to Do If Email Stops Sending
If guest booking confirmations, invoices, or login backup emails are not arriving:
1. **Check the Dashboard Banner**:
   * Look at the top of the Admin Dashboard. If there is an issue, a clear warning banner will state whether email is failing or if today's limit is reached.
2. **Check Email Health in Settings**:
   * Go to **Settings > Email System & Free SMTP Integration**.
   * Look at the status badge:
     * **Green "Connected (Verified)"**: Email is working normally.
     * **Red "Failing (Check SMTP)"**: Brevo or your mail provider cannot deliver messages.
   * Check your send count: On the free Brevo tier, you receive **300 free emails every day**. The bar will show how many have been used today.
3. **Test with One Click**:
   * Click **"Send Test Email to Super Admin"**.
   * If it succeeds, the mail system is healthy.
   * If it fails, the popup will explain why (e.g. "Wrong password" or "Domain not verified").
4. **Inspect the Mail Audit Log**:
   * Click **"View SMTP Dispatch Audit Log"** to see a list of recent emails, masked recipient addresses (`s***@gmail.com`), and delivery confirmations.
5. **If Your Free Daily Limit is Reached**:
   * The daily counter resets automatically every midnight at 12:00 AM IST.
   * Hotel bookings made by guests will **still succeed and save in your database**, even if an email is delayed.
   * You can resend any guest confirmation manually from the **Bookings** tab once the daily limit resets.

---

### 5. Managing Active Sessions & Device Security
* To see what laptops or phones are currently signed in to your account, visit **Settings > Security & Active Sessions**.
* You can click **"Revoke"** next to any unrecognized device to log it out immediately.
* If you suspect someone has compromised your password, click **"Log Out All Devices"** to instantly invalidate all active logins across the world.

---

### 6. Emergency Last Resort (If Completely Locked Out)
If you have lost your phone, cannot access your email, and have exhausted all 8 recovery codes:
1. Contact the server or hosting administrator (the person who manages your Hostinger account).
2. They can log in to the Hostinger terminal and run:
   ```bash
   npm run recover-account
   ```
3. This utility safely resets your 2FA, unlocks your account, and generates 8 new recovery codes directly on the server so you are never permanently locked out.

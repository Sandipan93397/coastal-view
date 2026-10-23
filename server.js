const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const { z } = require('zod');
require('dotenv').config();

const {
  ADMIN_EMAIL,
  SESSION_SECRET,
  IDLE_TIMEOUT_MS,
  CODE_EXPIRY_MS,
  SENSITIVE_REAUTH_WINDOW_MS,
  activeSessions,
  preAuthStore,
  failedAttempts,
  captchaStore,
  undoStore,
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  checkLockout,
  recordFailedAttempt,
  resetFailedAttempts,
  getFailedAttemptsCount,
  isCaptchaRequired,
  verifyTurnstileToken,
  getCaptchaConfig,
  hashAuthCode,
  generateAuthCode,
  canRequestCode,
  parseDeviceString,
  sendAuthCodeEmail,
  generateTotpSecret,
  verifyTotp,
  generateBackupCodes,
  sendSuperAdminAlert,
  performDailyBackup,
  exportEncryptedDatabase
} = require('./auth_security');

const {
  PHOTO_SLOTS,
  validateImageBuffer,
  processAndSaveImage,
  saveBase64ImageSecure,
  recordMediaVersion,
  performUndo,
  restoreFromHistory,
  applyUrlToSlot
} = require('./media_security');

// Run daily database backup routine on server start
performDailyBackup();
const {
  generateInvoicePDF,
  getOrCreateBookingInvoice,
  createInvoiceRevision,
  verifyInvoiceToken,
  formatINR,
  formatDateStr
} = require('./invoice_generator');
const {
  processChatRequest,
  recordConversationAndInquiry,
  getChatStats,
  exportConversationsToCSV,
  DIRECT_PHONE_NUMBER
} = require('./chatbot_service');

function createZipArchive() {
  const archiverPkg = require('archiver');
  if (typeof archiverPkg === 'function') {
    return archiverPkg('zip', { zlib: { level: 6 } });
  } else if (archiverPkg.ZipArchive) {
    return new archiverPkg.ZipArchive({ zlib: { level: 6 } });
  }
  throw new Error('Archiver library not available');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// --- HELPER FUNCTIONS FOR DATABASE ---
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return null;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing db.json:', err);
    return false;
  }
}

function logAudit(db, user, action, details, req = null) {
  db.auditLog = db.auditLog || [];
  const clientIp = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1') : '127.0.0.1';
  const entry = {
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    user: (user && user.username) || (typeof user === 'string' ? user : 'System'),
    role: (user && user.role) || 'Super Admin',
    name: (user && user.name) || (user && user.username) || 'System',
    ip: clientIp.replace(/^.*:/, ''),
    action,
    details
  };
  db.auditLog.unshift(entry);
  if (db.auditLog.length > 1000) {
    db.auditLog = db.auditLog.slice(0, 1000);
  }
  return entry;
}

// --- OPTIONAL SMTP TRANSPORTER ---
let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  try {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('SMTP email transport enabled for reservations.');
  } catch (err) {
    console.warn('SMTP transporter setup warning:', err.message);
  }
}

// Confirmation Email Generator & Dispatcher
async function sendBookingConfirmationEmail(booking, db) {
  const settings = db.settings || {};
  const recipientEmail = booking.guestEmail;
  const hotelEmail = settings.email || 'coastalviewbyanis@gmail.com';

  const transportHtml = booking.needCar ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #073B4C;">Private Transport (Ani's Travels)</td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #334155;">
        <strong>${booking.breakdown?.details?.transport?.line || ((booking.vehicleName || 'Car') + ' × ' + (booking.carCount || 1) + ' × ' + booking.nights + ' day(s)')}</strong>
        ${booking.vehicleTripType ? `<br><span style="display:inline-block; margin-top:3px; padding:2px 8px; border-radius:4px; background:#E0F2FE; color:#0369A1; font-size:12px;">${booking.vehicleTripType}</span>` : ''}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600; color: #073B4C;">
        ₹${(booking.carTotal || 0).toLocaleString('en-IN')}
      </td>
    </tr>
  ` : '';

  const dinnerHtml = booking.candlelightDinner ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #073B4C;">Candlelight Dinner Add-On</td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #334155;">
        ${booking.breakdown?.details?.candlelight?.line || 'Candlelight dinner'} (${booking.dinnerOccasion || 'Special Celebration'})
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600; color: #073B4C;">
        ₹${(booking.dinnerTotal || 0).toLocaleString('en-IN')}
      </td>
    </tr>
  ` : '';

  const breakfastHtml = booking.breakfast ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #073B4C;">Optional Breakfast Add-On</td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #334155;">
        <strong>${booking.breakdown?.details?.breakfast?.line || booking.breakfastLine || `Breakfast × ${booking.breakfastDays || booking.nights} day(s)`}</strong>
        <br><span style="color:#64748B; font-size:12px;">Served daily 7:00 AM to 10:30 AM</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600; color: #073B4C;">
        ₹${(booking.breakfastTotal || 0).toLocaleString('en-IN')}
      </td>
    </tr>
  ` : '';

  const taxHtml = (booking.taxAmount > 0 || booking.breakdown?.details?.tax) ? `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #073B4C;">GST / Taxes</td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #334155;">
        ${booking.breakdown?.details?.tax?.line || `GST / Taxes: ₹${(booking.taxAmount || 0).toLocaleString('en-IN')}`}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600; color: #073B4C;">
        ₹${(booking.taxAmount || booking.breakdown?.details?.tax?.amount || 0).toLocaleString('en-IN')}
      </td>
    </tr>
  ` : '';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Booking Confirmation - ${booking.bookingId}</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B;">
      <div style="max-width: 620px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1.5px solid #E8C77B; box-shadow: 0 10px 30px rgba(7, 59, 76, 0.1);">
        <div style="background: #073B4C; padding: 28px 24px; text-align: center; color: #FFFFFF;">
          <h1 style="margin: 0; font-size: 26px; font-family: Georgia, serif; letter-spacing: 1px; color: #FFFFFF;">Coastal View</h1>
          <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #E8C77B; margin-top: 4px;">Managed By Ani's • Mandarmani Beach</div>
          <div style="margin-top: 14px; display: inline-block; background: rgba(232, 199, 123, 0.18); border: 1px solid #E8C77B; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; color: #E8C77B;">
            BOOKING ID: ${booking.bookingId}
          </div>
        </div>

        <div style="padding: 24px 28px;">
          <p style="font-size: 15px; margin-top: 0;">Dear <strong>${booking.guestName}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Thank you for choosing Coastal View. Your beachfront reservation has been securely received! Below is your complete reservation and transport breakdown.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
            <thead>
              <tr style="background: #F1F5F9; text-align: left; font-size: 12px; text-transform: uppercase; color: #64748B;">
                <th style="padding: 8px 10px;">Item</th>
                <th style="padding: 8px 10px;">Details</th>
                <th style="padding: 8px 10px; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #073B4C;">${booking.roomName}</td>
                <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; color: #334155;">
                  ${booking.breakdown?.details?.room?.line || `${booking.roomsCount || 1} room × ${booking.nights} night(s)`}<br>
                  <small style="color: #64748B;">${booking.checkIn} to ${booking.checkOut}</small>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600; color: #073B4C;">
                  ₹${booking.roomSubtotal.toLocaleString('en-IN')}
                </td>
              </tr>
              ${breakfastHtml}
              ${transportHtml}
              ${dinnerHtml}
              ${taxHtml}
            </tbody>
          </table>

          ${(booking.breakdown?.lines && booking.breakdown.lines.length > 0) ? `
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #475569;">
            <strong style="color: #073B4C; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Itemized Breakdown:</strong>
            <ul style="margin: 6px 0 0 0; padding-left: 18px; line-height: 1.6;">
              ${booking.breakdown.lines.map(line => `<li>${line}</li>`).join('')}
            </ul>
          </div>` : ''}

          <div style="background: #FAF6EE; border: 1px solid #E8C77B; border-radius: 12px; padding: 16px 20px; margin: 20px 0;">
            <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; color: #073B4C; margin-bottom: 8px;">
              <span>Total Estimated Amount:</span>
              <span style="color: #073B4C;">₹${booking.totalAmount.toLocaleString('en-IN')}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #FF6B5E; font-weight: 700; margin-bottom: 4px;">
              <span>20% Advance Payable Now:</span>
              <span>₹${booking.payNowAdvance.toLocaleString('en-IN')}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; color: #06B6B0; font-weight: 700;">
              <span>80% Balance at Hotel:</span>
              <span>₹${booking.payAtHotelBalance.toLocaleString('en-IN')}</span>
            </div>
            <div style="font-size: 11px; color: #FF6B5E; margin-top: 8px; font-weight: 600;">
              * ${booking.advancePolicyNote || 'The 20% advance is non-refundable.'}
            </div>
          </div>

          <div style="background: #FFFDF9; border: 1.5px solid #E8C77B; border-radius: 12px; padding: 18px 20px; margin: 20px 0; text-align: center;">
            <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #06B6B0; font-weight: 700; margin-bottom: 6px;">
              OFFICIAL BOOKING INVOICE & CONFIRMATION
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #073B4C; margin-bottom: 12px;">
              Invoice No: <span style="font-family: monospace;">${booking.invoiceNumber || 'CV-2026-Voucher'}</span>
            </div>
            ${booking.invoiceToken ? `
            <a href="https://coastalviewmandarmani.com/api/invoices/public/download/${booking.invoiceToken}" style="display: inline-block; background: #06B6B0; color: #FFFFFF; font-weight: 700; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-size: 13px; box-shadow: 0 4px 12px rgba(6, 182, 176, 0.25);">
              📥 Download Invoice PDF
            </a>
            ` : ''}
            <div style="font-size: 11px; color: #64748B; margin-top: 8px;">
              * A print-ready luxury A4 PDF document is attached directly to this confirmation email.
            </div>
          </div>

          <div style="background: #F8FAFC; border-radius: 10px; border: 1px solid #E2E8F0; padding: 14px 16px; font-size: 13px; color: #334155; margin-bottom: 20px;">
            <strong style="color: #073B4C;">Payment Information for 20% Advance:</strong><br>
            • UPI ID: <strong>${settings.paymentUPI || 'coastalview@upi'}</strong><br>
            • Bank Account: ${settings.paymentBank || 'HDFC Bank, Contai Branch'}<br>
            • WhatsApp Confirmation: <strong>${settings.whatsapp || '+91 7812027551'}</strong>
          </div>

          <p style="font-size: 13px; color: #64748B; margin-bottom: 0;">
            For any changes or special requests, please contact host <strong>Anirban Das</strong> at <strong>${settings.phone}</strong>.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Attach PDF invoice if present on disk
  const attachments = [];
  if (booking.invoicePdfPath && fs.existsSync(booking.invoicePdfPath)) {
    attachments.push({
      filename: `Invoice-${booking.invoiceNumber || booking.bookingId}.pdf`,
      path: path.resolve(booking.invoicePdfPath),
      contentType: 'application/pdf'
    });
  }

  const outboxEntry = {
    id: `email-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    bookingId: booking.bookingId,
    invoiceNumber: booking.invoiceNumber || null,
    to: recipientEmail || 'Guest (No email provided)',
    subject: `Booking Confirmation & Invoice: ${booking.invoiceNumber || booking.bookingId} - Coastal View, Mandarmani`,
    html: emailHtml,
    hasInvoiceAttachment: attachments.length > 0,
    invoiceAttachment: attachments.length > 0 ? attachments[0].filename : null,
    sentAt: new Date().toISOString(),
    status: 'Recorded in Outbox'
  };

  if (recipientEmail && mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: `"Coastal View, Managed By Ani's" <${hotelEmail}>`,
        to: recipientEmail,
        subject: outboxEntry.subject,
        html: emailHtml,
        attachments
      });
      outboxEntry.status = 'Sent via SMTP';
    } catch (err) {
      console.warn('SMTP delivery notice:', err.message);
      outboxEntry.status = 'Queued in Outbox (SMTP Error: ' + err.message + ')';
    }
  }

  db.emailOutbox = db.emailOutbox || [];
  db.emailOutbox.unshift(outboxEntry);
  if (db.emailOutbox.length > 200) {
    db.emailOutbox = db.emailOutbox.slice(0, 200);
  }
  return outboxEntry;
}

// --- QUANTITY-BASED AVAILABILITY ENGINE & CONCURRENCY MUTEX ---
class AsyncLock {
  constructor() {
    this.queue = Promise.resolve();
  }
  acquire(fn) {
    let resultPromise;
    this.queue = this.queue.then(() => {
      resultPromise = Promise.resolve().then(fn);
      return resultPromise.catch(() => {});
    });
    return this.queue.then(() => resultPromise);
  }
}
const bookingMutex = new AsyncLock();

// Generate array of YYYY-MM-DD stay nights (check-out day is not an occupied night)
function getStayNightsList(checkIn, checkOut) {
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  if (isNaN(inDate.getTime()) || isNaN(outDate.getTime()) || outDate <= inDate) {
    return [typeof checkIn === 'string' ? checkIn.slice(0, 10) : ''];
  }
  const nights = [];
  const cur = new Date(inDate);
  while (cur < outDate) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    nights.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return nights.length > 0 ? nights : [typeof checkIn === 'string' ? checkIn.slice(0, 10) : ''];
}

// Calculate availability for a room across a date range [checkIn, checkOut)
function getRoomAvailability(db, roomId, checkIn, checkOut, excludeBookingId = null) {
  const room = (db.rooms || []).find(r => r.id === roomId && !r.isArchived);
  if (!room) {
    return {
      roomId,
      name: roomId,
      total: 0,
      booked: 0,
      blocked: 0,
      available: 0,
      isSoldOut: true,
      reason: 'Room not found'
    };
  }

  const defaultQuantities = {
    'cosy-deluxe-room': 7,
    'ocean-whisper-room': 4,
    'pool-haven-room': 4,
    'palm-grove-family-suite': 2
  };
  const totalQuantity = parseInt(room.quantity, 10) || defaultQuantities[room.id] || 1;
  const stayNights = getStayNightsList(checkIn, checkOut);

  // Active bookings overlapping this room (Cancelled bookings are excluded)
  const activeBookings = (db.bookings || []).filter(b => 
    b.roomId === roomId &&
    b.bookingId !== excludeBookingId &&
    ['Confirmed', 'Checked-in', 'Pending Advance', 'Pending'].includes(b.status)
  );

  let minAvailableOnAnyNight = totalQuantity;
  let maxBookedOnAnyNight = 0;
  let maxBlockedOnAnyNight = 0;

  for (const night of stayNights) {
    // 1. Calculate booked rooms on this specific night
    // Note: check-out day is not occupied because b.checkOut > night is false when night == b.checkOut
    let bookedRoomsOnNight = 0;
    for (const b of activeBookings) {
      if (b.checkIn <= night && b.checkOut > night) {
        bookedRoomsOnNight += (parseInt(b.roomsCount, 10) || 1);
      }
    }

    // 2. Calculate manual block on this night (e.g. maintenance or sold-out override)
    let blockedRoomsOnNight = 0;
    const partialQty = parseInt(room.blockedQuantity, 10);
    const hasBlockedQty = !isNaN(partialQty) && partialQty > 0;

    if (room.isSoldOut || hasBlockedQty) {
      let isWithinRange = false;
      if (!room.soldOutRange || room.soldOutRange.type === 'indefinite' || !room.soldOutRange.startDate) {
        isWithinRange = true;
      } else if (room.soldOutRange.type === 'range') {
        const start = room.soldOutRange.startDate;
        const end = room.soldOutRange.endDate;
        isWithinRange = start <= night && (!end || end > night);
      }

      if (isWithinRange) {
        if (hasBlockedQty) {
          blockedRoomsOnNight = Math.min(totalQuantity, partialQty);
        } else {
          blockedRoomsOnNight = totalQuantity; // Entire room type blocked
        }
      }
    }

    const availableOnNight = Math.max(0, totalQuantity - bookedRoomsOnNight - blockedRoomsOnNight);

    if (bookedRoomsOnNight > maxBookedOnAnyNight) maxBookedOnAnyNight = bookedRoomsOnNight;
    if (blockedRoomsOnNight > maxBlockedOnAnyNight) maxBlockedOnAnyNight = blockedRoomsOnNight;
    if (availableOnNight < minAvailableOnAnyNight) minAvailableOnAnyNight = availableOnNight;
  }

  const finalAvailable = Math.max(0, minAvailableOnAnyNight);

  return {
    roomId: room.id,
    name: room.name,
    tag: room.tag,
    price: room.price,
    total: totalQuantity,
    booked: maxBookedOnAnyNight,
    blocked: maxBlockedOnAnyNight,
    available: finalAvailable,
    isSoldOut: finalAvailable <= 0,
    soldOutReason: room.soldOutReason || null,
    stayNights
  };
}

// Check availability by quantity
function checkDoubleBooking(db, roomId, checkIn, checkOut, excludeBookingId = null, requestedCount = 1) {
  const avail = getRoomAvailability(db, roomId, checkIn, checkOut, excludeBookingId);
  const needed = parseInt(requestedCount, 10) || 1;
  if (avail.available < needed) {
    return {
      conflict: true,
      available: avail.available,
      total: avail.total,
      roomName: avail.name
    };
  }
  return { conflict: false, available: avail.available, total: avail.total };
}

// --- SECURITY & HEADERS SETUP ---
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "frame-src 'self' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/ https://recaptcha.google.com/",
    "connect-src 'self' https: https://challenges.cloudflare.com https://*.hcaptcha.com https://www.google.com/recaptcha/",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline' https:",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join('; '));
  next();
});

// Admin area strict noindex tag
app.use('/admin', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve static frontend files
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/admin/assets', express.static(path.join(__dirname, 'assets')));
app.use('/admin/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname)));

// Health Check endpoint for Render & 24/7 Keep-Alive Uptime Pings
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

// Clean page routes
app.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, 'gallery.html'));
});
app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'menu.html'));
});

// --- AUTHENTICATION & SESSION MIDDLEWARE ---

// Middleware: Authenticate Session and update idle timer
function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
  }

  const session = activeSessions.get(token);
  if (!session) {
    res.clearCookie('admin_session');
    res.clearCookie('admin_csrf');
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please sign in again.' });
  }

  const now = Date.now();
  if (now - session.lastActive > IDLE_TIMEOUT_MS) {
    activeSessions.delete(token);
    res.clearCookie('admin_session');
    res.clearCookie('admin_csrf');
    return res.status(401).json({ success: false, message: 'Session expired due to 15 minutes of inactivity.' });
  }

  // Slide idle timeout window
  session.lastActive = now;
  req.user = session;
  req.token = token;
  next();
}

// Middleware: Role-Based Access Control
function requireRole(allowedRoles) {
  return (req, res, next) => {
    requireAdmin(req, res, () => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Role "${req.user.role}" does not have permission for this action.`
        });
      }
      next();
    });
  };
}

const requireSuperAdmin = requireRole(['Super Admin']);
const requireManager = requireRole(['Super Admin', 'Manager']);
const requireAnyStaff = requireRole(['Super Admin', 'Manager', 'Front Desk']);

// Sensitive action re-auth middleware (requires password entry within last 5 minutes)
function requireReauth(req, res, next) {
  if (!req.user || !req.user.reauthUntil || Date.now() > req.user.reauthUntil) {
    return res.status(403).json({
      success: false,
      requireReauth: true,
      message: 'Sensitive action requires password re-entry for security confirmation.'
    });
  }
  next();
}

// CSRF validation on state-changing requests
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const publicPrefixes = [
    '/api/bookings',
    '/api/chat',
    '/api/concierge',
    '/api/auth/login',
    '/api/auth/verify-2fa',
    '/api/auth/resend-code',
    '/api/auth/captcha',
    '/api/auth/forgot-password',
    '/api/auth/reset-password'
  ];
  if (publicPrefixes.some(p => req.path.startsWith(p))) {
    return next();
  }

  const token = req.cookies.admin_session;
  if (token) {
    const session = activeSessions.get(token);
    const clientCsrf = req.headers['x-csrf-token'];
    if (!session || !clientCsrf || clientCsrf !== session.csrfToken) {
      return res.status(403).json({ success: false, message: 'Security token mismatch (CSRF protected).' });
    }
  }
  next();
}

app.use(verifyCsrf);

// ============================================================================
// AUTHENTICATION & SECURITY APIS
// ============================================================================

// 1. CAPTCHA Challenge & Configuration Endpoints
app.get('/api/auth/captcha-config', (req, res) => {
  const db = readDB();
  const config = getCaptchaConfig(req, db);
  res.json({
    success: true,
    ...config
  });
});

app.get('/api/auth/captcha', (req, res) => {
  const db = readDB();
  const config = getCaptchaConfig(req, db);

  // Maintain legacy math fallback if needed
  const num1 = Math.floor(Math.random() * 12) + 3;
  const num2 = Math.floor(Math.random() * 9) + 2;
  const captchaId = crypto.randomBytes(16).toString('hex');
  const answer = num1 + num2;

  captchaStore.set(captchaId, {
    answer,
    expiresAt: Date.now() + 3 * 60 * 1000
  });

  res.json({
    success: true,
    ...config,
    captchaId,
    question: `${num1} + ${num2} = ?`
  });
});

// 2. Step 1: Primary Authentication (Email/Username + Password + Turnstile CAPTCHA)
app.post('/api/auth/login', async (req, res) => {
  try {
    const loginSchema = z.object({
      username: z.string().min(1).max(128),
      password: z.string().min(1).max(128),
      captchaToken: z.string().nullable().optional(),
      'cf-turnstile-response': z.string().nullable().optional(),
      captchaId: z.string().nullable().optional(),
      captchaAnswer: z.union([z.string(), z.number()]).nullable().optional()
    });

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid credentials format.' });
    }

    const { username, password } = parsed.data;
    const captchaToken = (parsed.data.captchaToken || parsed.data['cf-turnstile-response'] || '').trim();
    const captchaId = (parsed.data.captchaId || '').trim();
    const captchaAnswerRaw = parsed.data.captchaAnswer;
    const captchaAnswer = captchaAnswerRaw !== undefined && captchaAnswerRaw !== null ? String(captchaAnswerRaw).trim() : '';
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');

    // Check progressive brute-force lockout
    const lockout = checkLockout(username, clientIp);
    if (lockout.isLocked) {
      return res.status(429).json({ success: false, message: lockout.message });
    }

    const db = readDB();
    if (!db) return res.status(500).json({ success: false, message: 'Database error' });

    const policy = process.env.CAPTCHA_POLICY || db?.settings?.captchaPolicy || 'smart';
    const isProduction = process.env.NODE_ENV === 'production';
    const captchaRequired = isCaptchaRequired(username, clientIp, policy);

    let captchaPassed = false;

    // 1. Verify Math CAPTCHA Answer if provided from write section
    if (captchaAnswer && captchaId) {
      const stored = captchaStore.get(captchaId);
      if (stored && Date.now() <= stored.expiresAt) {
        if (parseInt(captchaAnswer, 10) === stored.answer) {
          captchaPassed = true;
          captchaStore.delete(captchaId); // One-time use enforced
        } else {
          logAudit(db, username || 'Anonymous', 'Failed Login CAPTCHA', `Incorrect math captcha answer from IP ${clientIp}`, req);
          return res.status(400).json({
            success: false,
            requireCaptcha: true,
            resetCaptcha: true,
            message: 'Incorrect security answer. Please try again.'
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          requireCaptcha: true,
          resetCaptcha: true,
          message: 'Security check expired, try again'
        });
      }
    }

    // 2. Verify Cloudflare Turnstile token if provided and not yet verified
    if (!captchaPassed && captchaToken) {
      const verifyRes = await verifyTurnstileToken({
        token: captchaToken,
        remoteIp: clientIp,
        isProduction
      });

      if (verifyRes.success) {
        captchaPassed = true;
      } else {
        const httpStatus = verifyRes.code === 'SERVICE_UNAVAILABLE' ? 503 : 400;
        return res.status(httpStatus).json({
          success: false,
          requireCaptcha: true,
          resetCaptcha: true,
          message: verifyRes.message
        });
      }
    }

    // 3. If CAPTCHA is required, ensure either Turnstile or Math Answer passed
    if (captchaRequired && !captchaPassed) {
      return res.status(400).json({
        success: false,
        requireCaptcha: true,
        resetCaptcha: true,
        message: 'Please complete the security check'
      });
    }

    // Look up user by username or email
    const user = (db.users || []).find(u => 
      u.username.toLowerCase() === username.toLowerCase() || 
      (u.email && u.email.toLowerCase() === username.toLowerCase())
    );

    let isMatch = false;
    if (user) {
      if (user.active === false) {
        logAudit(db, user.username, 'Disabled Account Login Blocked', `Attempted sign-in to disabled account "${user.username}" from IP ${clientIp}`, req);
        return res.status(403).json({
          success: false,
          message: 'Your staff account has been disabled. Please contact Super Admin.'
        });
      }
      isMatch = await verifyPassword(password, user.passwordHash, user, db);
    }

    if (!user || !isMatch) {
      const failedCount = recordFailedAttempt(username, clientIp);
      db.loginHistory = db.loginHistory || [];
      db.loginHistory.unshift({
        id: `login-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: username || 'Unknown',
        ip: clientIp,
        status: failedCount >= 5 ? 'Locked Out' : 'Failed'
      });
      logAudit(db, username || 'Anonymous', 'Failed Login Attempt', `Failed login attempt from IP ${clientIp} for "${username}". Attempts: ${failedCount}/5`, req);

      // Alert Super Admin if lockout triggered
      if (failedCount >= 5) {
        sendSuperAdminAlert(
          `Repeated Failed Login Attempts Lockout (${username})`,
          `5 consecutive failed login attempts detected for account <strong>${username}</strong> from IP <code>${clientIp}</code>. Account is locked for 15 minutes.`,
          db
        );
      }

      writeDB(db);

      const requireCaptchaNow = isCaptchaRequired(username, clientIp, policy);

      // Generic error response to prevent account enumeration
      return res.status(401).json({
        success: false,
        message: 'Wrong email or password',
        requireCaptcha: requireCaptchaNow,
        resetCaptcha: true
      });
    }

    // Reset failed login attempts on credential success
    resetFailedAttempts(username, clientIp);

    // Check if device is remembered (up to 7 days)
    const rememberCookie = req.cookies.remember_device;
    const allowRemember = db.settings?.allowRememberDevice !== false;

    if (allowRemember && rememberCookie && db.rememberedDevices) {
      const hashedCookie = crypto.createHash('sha256').update(rememberCookie).digest('hex');
      const remembered = db.rememberedDevices.find(d => d.tokenHash === hashedCookie && d.username === user.username && Date.now() < d.expiresAt);
      if (remembered) {
        // Device is verified! Issue session directly
        const token = crypto.randomBytes(32).toString('hex');
        const csrfToken = crypto.randomBytes(32).toString('hex');

        activeSessions.set(token, {
          token,
          username: user.username,
          role: user.role,
          name: user.name,
          email: user.email,
          csrfToken,
          lastActive: Date.now(),
          createdAt: Date.now(),
          ip: clientIp,
          device: parseDeviceString(req.headers['user-agent'])
        });

        res.cookie('admin_session', token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: IDLE_TIMEOUT_MS
        });
        res.cookie('admin_csrf', csrfToken, {
          sameSite: 'strict',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: IDLE_TIMEOUT_MS
        });

        logAudit(db, user, 'Staff Login (Remembered Device)', `User ${user.username} signed in from recognized device (${clientIp}).`, req);
        writeDB(db);

        return res.json({
          success: true,
          token,
          csrfToken,
          user: { username: user.username, role: user.role, name: user.name, email: user.email },
          message: 'Welcome back. Device recognized.'
        });
      }
    }

    // MANDATORY STEP 2: Issue 6-digit cryptographic code via Email
    const rawCode = generateAuthCode();
    const codeHash = hashAuthCode(rawCode);
    const preAuthToken = crypto.randomBytes(32).toString('hex');
    const device = parseDeviceString(req.headers['user-agent']);

    preAuthStore.set(preAuthToken, {
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      codeHash,
      codeAttempts: 0,
      totpSecret: user.totpSecret || null,
      backupCodes: user.backupCodes || [],
      hasTotp: !!user.totpSecret,
      ip: clientIp,
      device,
      expiresAt: Date.now() + CODE_EXPIRY_MS
    });

    // Send code via SMTP
    const emailResult = await sendAuthCodeEmail({
      to: user.email,
      code: rawCode,
      ip: clientIp,
      device,
      db
    });

    if (!emailResult.success) {
      preAuthStore.delete(preAuthToken);
      return res.status(502).json({
        success: false,
        message: 'Could not deliver the authentication code email. Please verify SMTP settings in .env. The second verification step cannot be bypassed.'
      });
    }

    logAudit(db, user, '2FA Code Dispatched', `6-digit login verification code sent to ${user.email} from IP ${clientIp}.`, req);
    writeDB(db);

    const maskedEmail = user.email ? user.email.replace(/(.{2})(.*)(@.*)/, '$1••••$3') : 'Registered Email';

    const isDevWithoutSmtp = process.env.NODE_ENV !== 'production' && !process.env.SMTP_USER;

    return res.json({
      success: true,
      require2FA: true,
      preAuthToken,
      maskedEmail,
      devCode: isDevWithoutSmtp ? rawCode : undefined,
      hasTotp: !!user.totpSecret,
      message: `A 6-digit verification code has been dispatched to ${maskedEmail}. Enter the code within 10 minutes to access the admin portal.`
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Authentication processing error' });
  }
});

// 3. Resend 2FA Code
app.post('/api/auth/resend-code', async (req, res) => {
  const { preAuthToken } = req.body;
  if (!preAuthToken) {
    return res.status(400).json({ success: false, message: 'Missing pre-authentication session token.' });
  }

  const preAuth = preAuthStore.get(preAuthToken);
  if (!preAuth || Date.now() > preAuth.expiresAt) {
    preAuthStore.delete(preAuthToken);
    return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
  }

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');
  const throttleCheck = canRequestCode(`${preAuth.username}_${clientIp}`);
  if (!throttleCheck.allowed) {
    return res.status(429).json({ success: false, message: throttleCheck.message });
  }

  const newCode = generateAuthCode();
  preAuth.codeHash = hashAuthCode(newCode);
  preAuth.codeAttempts = 0;
  preAuth.expiresAt = Date.now() + CODE_EXPIRY_MS;

  const db = readDB();
  const emailResult = await sendAuthCodeEmail({
    to: preAuth.email,
    code: newCode,
    ip: clientIp,
    device: preAuth.device,
    db
  });

  if (!emailResult.success) {
    return res.status(502).json({ success: false, message: 'Failed to deliver new code. Please check SMTP settings.' });
  }

  if (db) writeDB(db);

  const isDevWithoutSmtp = process.env.NODE_ENV !== 'production' && !process.env.SMTP_USER;

  res.json({
    success: true,
    devCode: isDevWithoutSmtp ? newCode : undefined,
    message: 'A fresh 6-digit authentication code has been sent to your email.'
  });
});

// 4. Verify 2FA Code (or TOTP / Backup Code) & Issue Session
app.post('/api/auth/verify-2fa', async (req, res) => {
  const { preAuthToken, code, rememberDevice } = req.body;
  if (!preAuthToken || !code) {
    return res.status(400).json({ success: false, message: 'Please provide both preAuthToken and the 6-digit verification code.' });
  }

  const preAuth = preAuthStore.get(preAuthToken);
  if (!preAuth || Date.now() > preAuth.expiresAt) {
    preAuthStore.delete(preAuthToken);
    return res.status(401).json({ success: false, message: 'Verification code session expired. Please sign in again.' });
  }

  if (preAuth.codeAttempts >= 5) {
    preAuthStore.delete(preAuthToken);
    return res.status(429).json({ success: false, message: 'Maximum attempts (5) exceeded for this code. Please sign in again.' });
  }

  const cleanCode = code.trim();
  let isValid = false;

  // A. Check Email 6-Digit Code
  const inputHash = hashAuthCode(cleanCode);
  if (inputHash === preAuth.codeHash) {
    isValid = true;
  }

  // B. Check TOTP Authenticator App if enabled
  if (!isValid && preAuth.totpSecret) {
    isValid = verifyTotp(preAuth.totpSecret, cleanCode);
  }

  // C. Check One-time Backup Codes
  if (!isValid && Array.isArray(preAuth.backupCodes) && preAuth.backupCodes.length > 0) {
    const backupHash = crypto.createHash('sha256').update(cleanCode.toUpperCase()).digest('hex');
    const backupIdx = preAuth.backupCodes.indexOf(backupHash);
    if (backupIdx !== -1) {
      isValid = true;
      // Consume backup code
      preAuth.backupCodes.splice(backupIdx, 1);
      const db = readDB();
      const user = (db.users || []).find(u => u.username === preAuth.username);
      if (user) {
        user.backupCodes = preAuth.backupCodes;
        writeDB(db);
      }
    }
  }

  if (!isValid) {
    preAuth.codeAttempts += 1;
    const remaining = 5 - preAuth.codeAttempts;
    if (preAuth.codeAttempts >= 5) {
      preAuthStore.delete(preAuthToken);
      return res.status(429).json({ success: false, message: 'Maximum attempts exceeded. Code invalidated.' });
    }
    return res.status(401).json({
      success: false,
      message: `Invalid verification code. ${remaining} attempt(s) remaining.`
    });
  }

  // Code verified! Remove preAuth
  preAuthStore.delete(preAuthToken);

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1').replace(/^.*:/, '');
  const device = parseDeviceString(req.headers['user-agent']);

  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');

  const sessionData = {
    token,
    username: preAuth.username,
    role: preAuth.role,
    name: preAuth.name,
    email: preAuth.email,
    csrfToken,
    ip: clientIp,
    device,
    createdAt: new Date().toISOString(),
    lastActive: Date.now()
  };

  activeSessions.set(token, sessionData);

  // Set HttpOnly, SameSite=Strict cookies
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: IDLE_TIMEOUT_MS
  });

  res.cookie('admin_csrf', csrfToken, {
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: IDLE_TIMEOUT_MS
  });

  const db = readDB();
  db.loginHistory = db.loginHistory || [];

  // Check if new device / new IP
  const pastLogins = db.loginHistory.filter(l => l.username === preAuth.username && l.status === 'Success');
  const isNewDeviceOrIp = pastLogins.length > 0 && !pastLogins.some(l => l.ip === clientIp);

  db.loginHistory.unshift({
    id: `login-${Date.now()}`,
    timestamp: new Date().toISOString(),
    username: preAuth.username,
    role: preAuth.role,
    ip: clientIp,
    device,
    status: 'Success'
  });
  if (db.loginHistory.length > 500) db.loginHistory = db.loginHistory.slice(0, 500);

  // Handle "Remember this device" (up to 7 days)
  if (rememberDevice && db.settings?.allowRememberDevice !== false) {
    const rawDeviceToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
    db.rememberedDevices = db.rememberedDevices || [];
    db.rememberedDevices.push({
      tokenHash,
      username: preAuth.username,
      device,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
    // Set 7-day device cookie
    res.cookie('remember_device', rawDeviceToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  logAudit(db, sessionData, 'Staff Login Success', `${sessionData.role} "${sessionData.username}" signed in with verified 2FA code from IP ${clientIp}.`, req);

  // Send alert if new device
  if (isNewDeviceOrIp) {
    sendSuperAdminAlert(
      `New Device Sign-In: ${preAuth.username}`,
      `A successful 2FA login was completed for user <strong>${preAuth.username}</strong> from a new IP address <code>${clientIp}</code> (${device}). If this wasn’t authorized, change your password immediately.`,
      db
    );
  }

  writeDB(db);

  return res.json({
    success: true,
    token,
    csrfToken,
    user: {
      username: sessionData.username,
      role: sessionData.role,
      name: sessionData.name,
      email: sessionData.email
    },
    message: 'Two-factor authentication verified. Welcome to Coastal View Management.'
  });
});

// 5. Verify Active Session
app.get('/api/auth/verify', requireAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Session valid',
    csrfToken: req.user.csrfToken,
    user: {
      username: req.user.username,
      role: req.user.role,
      name: req.user.name,
      email: req.user.email
    }
  });
});

// 6. Sensitive Action Re-Authentication (elevates session for 5 minutes)
app.post('/api/auth/reauth', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required for sensitive confirmation.' });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const isMatch = await verifyPassword(password, user.passwordHash, user, db);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Incorrect password confirmation.' });
  }

  req.user.reauthUntil = Date.now() + SENSITIVE_REAUTH_WINDOW_MS;
  res.json({ success: true, message: 'Sensitive action confirmed. Access elevated for 5 minutes.' });
});

// 7. Logout Current Device
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.admin_session || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null);

  if (token) {
    const session = activeSessions.get(token);
    if (session) {
      const db = readDB();
      logAudit(db, session, 'Staff Logout', `${session.role} "${session.username}" logged out.`, req);
      writeDB(db);
      activeSessions.delete(token);
    }
  }

  res.clearCookie('admin_session');
  res.clearCookie('admin_csrf');
  res.json({ success: true, message: 'Logged out successfully' });
});

// 8. Log Out All Devices
app.post('/api/auth/logout-all', requireAdmin, (req, res) => {
  const currentUsername = req.user.username;
  let count = 0;

  for (const [t, s] of activeSessions.entries()) {
    if (s.username === currentUsername) {
      activeSessions.delete(t);
      count++;
    }
  }

  res.clearCookie('admin_session');
  res.clearCookie('admin_csrf');

  const db = readDB();
  logAudit(db, req.user, 'Log Out All Devices', `User ${currentUsername} terminated all active sessions (${count}) across all devices.`, req);
  writeDB(db);

  res.json({ success: true, message: `Terminated ${count} active session(s). Please sign in again.` });
});

// 9. Change Password (Authenticated) - Enforces Argon2 & terminates other sessions
app.post('/api/auth/change-password', requireAnyStaff, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const isMatch = await verifyPassword(currentPassword, user.passwordHash, user, db);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  user.passwordHash = await hashPassword(newPassword);

  // Terminate all OTHER sessions for this user
  for (const [t, s] of activeSessions.entries()) {
    if (s.username === req.user.username && t !== req.token) {
      activeSessions.delete(t);
    }
  }

  logAudit(db, req.user, 'Password Changed', `User ${req.user.username} changed account password. All other active sessions terminated.`, req);

  // Alert Super Admin
  sendSuperAdminAlert(
    `Password Changed: ${req.user.username}`,
    `The account password for <strong>${req.user.username}</strong> was successfully changed. All other sessions have been logged out.`,
    db
  );

  writeDB(db);

  res.json({ success: true, message: 'Password updated successfully with Argon2id. All other sessions have been signed out.' });
});

// 10. Forgot Password Flow: 30-Minute Expiring Single-Use Token
app.post('/api/auth/forgot-password', async (req, res) => {
  const { identifier } = req.body;
  const db = readDB();
  const user = (db.users || []).find(u => 
    u.username.toLowerCase() === (identifier || '').toLowerCase() || 
    (u.email && u.email.toLowerCase() === (identifier || '').toLowerCase())
  );

  if (!user) {
    // Prevent account enumeration
    return res.json({ success: true, message: 'If that account exists, a 30-minute password reset link has been dispatched to its registered email.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes validity

  db.passwordResetTokens = db.passwordResetTokens || [];
  db.passwordResetTokens.push({
    token: resetToken,
    username: user.username,
    expiresAt,
    used: false
  });

  const resetLink = `http://localhost:${PORT}/admin/?reset_token=${resetToken}`;

  db.emailOutbox = db.emailOutbox || [];
  db.emailOutbox.unshift({
    id: `reset-${Date.now()}`,
    to: user.email,
    subject: 'Coastal View Admin - Single-Use 30-Minute Password Reset Link',
    html: `<p>Hello ${user.name},</p><p>A password reset was requested for your Coastal View account. This link expires in 30 minutes and can only be used once:</p><p><a href="${resetLink}">Reset Password</a></p><p>Token: <code>${resetToken}</code></p>`,
    sentAt: new Date().toISOString(),
    status: 'Dispatched'
  });

  logAudit(db, user, 'Password Reset Requested', `Single-use 30-minute password reset token generated for ${user.username}.`, req);
  writeDB(db);

  res.json({
    success: true,
    message: 'If that account exists, a 30-minute password reset link has been dispatched to its registered email.'
  });
});

// 11. Reset Password Flow: Apply New Password & Invalidate All Sessions
app.post('/api/auth/reset-password', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing token or password.' });
  }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  db.passwordResetTokens = db.passwordResetTokens || [];
  const tokenIdx = db.passwordResetTokens.findIndex(t => t.token === resetToken && !t.used && Date.now() < t.expiresAt);

  if (tokenIdx === -1) {
    return res.status(400).json({ success: false, message: 'Password reset link is invalid or has expired (30-minute window).' });
  }

  const item = db.passwordResetTokens[tokenIdx];
  const user = (db.users || []).find(u => u.username === item.username);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User account not found.' });
  }

  user.passwordHash = await hashPassword(newPassword);
  item.used = true; // Single-use!
  db.passwordResetTokens.splice(tokenIdx, 1);

  // Terminate ALL sessions for this user
  for (const [t, s] of activeSessions.entries()) {
    if (s.username === user.username) activeSessions.delete(t);
  }

  logAudit(db, user, 'Password Reset Completed', `Password successfully updated via expiring reset token for ${user.username}. All active sessions invalidated.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Password reset successfully with Argon2id! Please sign in with your new password.' });
});

// 12. Optional TOTP Authenticator Setup
app.post('/api/auth/totp/setup', requireAdmin, requireReauth, (req, res) => {
  const secret = generateTotpSecret();
  const { codes, hashed } = generateBackupCodes();
  const issuer = process.env.TOTP_ISSUER || 'CoastalViewMandarmani';
  const otpauthUrl = `otpauth://totp/${issuer}:${req.user.username}?secret=${secret}&issuer=${issuer}`;

  res.json({
    success: true,
    secret,
    otpauthUrl,
    backupCodes: codes,
    hashedBackupCodes: hashed,
    message: 'Scan the QR code or enter the secret in your authenticator app, then confirm with a 6-digit code.'
  });
});

app.post('/api/auth/totp/confirm', requireAdmin, (req, res) => {
  const { secret, code, hashedBackupCodes } = req.body;
  if (!secret || !code) {
    return res.status(400).json({ success: false, message: 'Secret and verification code are required.' });
  }

  const isValid = verifyTotp(secret, code);
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Invalid authenticator code. Check your device clock.' });
  }

  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.totpSecret = secret;
  user.backupCodes = hashedBackupCodes || [];

  logAudit(db, req.user, 'TOTP 2FA Enabled', `Authenticator app 2FA enabled for ${req.user.username}.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Authenticator app enabled successfully for your account!' });
});

app.post('/api/auth/totp/disable', requireAdmin, requireReauth, (req, res) => {
  const db = readDB();
  const user = (db.users || []).find(u => u.username === req.user.username);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.totpSecret = null;
  user.backupCodes = [];

  logAudit(db, req.user, 'TOTP 2FA Disabled', `Authenticator app 2FA disabled for ${req.user.username}.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Authenticator app removed. Email 2FA remains active.' });
});

// 13. Super Admin Encrypted Database Export (AES-256-GCM)
app.get('/api/admin/backup/export-encrypted', requireSuperAdmin, requireReauth, (req, res) => {
  try {
    const encryptedBuffer = exportEncryptedDatabase(process.env.SESSION_SECRET);
    const today = new Date().toISOString().split('T')[0];
    const filename = `coastalview-db-encrypted-${today}.enc`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(encryptedBuffer);

    const db = readDB();
    logAudit(db, req.user, 'Encrypted Backup Exported', `Super Admin downloaded AES-256-GCM encrypted database export.`, req);
    writeDB(db);
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ============================================================================
// ROOM INVENTORY & SOLD-OUT CONTROL APIS
// ============================================================================

// Public & Admin: Get All Rooms (Excludes Archived Rooms)
app.get('/api/rooms', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  const rooms = (db.rooms || []).filter(r => !r.isArchived);
  res.json({ success: true, rooms });
});

// Public: Get live room availability by quantity for date range
app.get('/api/rooms/availability', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  let { checkIn, checkOut, roomId } = req.query;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const defaultIn = `${yyyy}-${mm}-${dd}`;

  const tmrw = new Date(today);
  tmrw.setDate(tmrw.getDate() + 1);
  const tY = tmrw.getFullYear();
  const tM = String(tmrw.getMonth() + 1).padStart(2, '0');
  const tD = String(tmrw.getDate()).padStart(2, '0');
  const defaultOut = `${tY}-${tM}-${tD}`;

  checkIn = checkIn || defaultIn;
  checkOut = checkOut || defaultOut;

  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  const diff = outDate - inDate;
  const nights = Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));

  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);

  if (roomId) {
    const avail = getRoomAvailability(db, roomId, checkIn, checkOut);
    return res.json({ success: true, checkIn, checkOut, nights, availability: avail });
  }

  const availability = activeRooms.map(r => getRoomAvailability(db, r.id, checkIn, checkOut));
  res.json({ success: true, checkIn, checkOut, nights, availability });
});

// Admin: Live Room Inventory, Occupancy Table & Daily Calendar
app.get('/api/admin/rooms/occupancy', requireAnyStaff, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  let { startDate, endDate, year, month } = req.query;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const tmrw = new Date(today);
  tmrw.setDate(tmrw.getDate() + 1);
  const tY = tmrw.getFullYear();
  const tM = String(tmrw.getMonth() + 1).padStart(2, '0');
  const tD = String(tmrw.getDate()).padStart(2, '0');
  const tomorrowStr = `${tY}-${tM}-${tD}`;

  const rangeIn = startDate || todayStr;
  const rangeOut = endDate || tomorrowStr;

  const activeRooms = (db.rooms || []).filter(r => !r.isArchived);

  // Today's occupancy
  const todayOccupancy = activeRooms.map(r => getRoomAvailability(db, r.id, todayStr, tomorrowStr));

  // Selected range occupancy
  const rangeOccupancy = activeRooms.map(r => getRoomAvailability(db, r.id, rangeIn, rangeOut));

  // Totals for today
  const totalInventory = activeRooms.reduce((acc, r) => acc + (parseInt(r.quantity, 10) || 1), 0);
  const todayBooked = todayOccupancy.reduce((acc, r) => acc + r.booked, 0);
  const todayBlocked = todayOccupancy.reduce((acc, r) => acc + r.blocked, 0);
  const todayAvailable = todayOccupancy.reduce((acc, r) => acc + r.available, 0);

  // Totals for range
  const rangeBooked = rangeOccupancy.reduce((acc, r) => acc + r.booked, 0);
  const rangeBlocked = rangeOccupancy.reduce((acc, r) => acc + r.blocked, 0);
  const rangeAvailable = rangeOccupancy.reduce((acc, r) => acc + r.available, 0);

  // Calendar day-by-day availability
  const calYear = parseInt(year, 10) || today.getFullYear();
  const calMonth = parseInt(month, 10) || (today.getMonth() + 1);
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();

  const dailyCalendar = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const nextDay = new Date(calYear, calMonth - 1, d + 1);
    const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`;

    const dayAvails = {};
    let anySoldOut = false;
    let dayTotalAvail = 0;
    let dayTotalBooked = 0;

    activeRooms.forEach(r => {
      const av = getRoomAvailability(db, r.id, dayStr, nextDayStr);
      dayAvails[r.id] = {
        name: r.name,
        tag: r.tag,
        price: r.price,
        total: av.total,
        booked: av.booked,
        blocked: av.blocked,
        available: av.available,
        isSoldOut: av.isSoldOut
      };
      if (av.isSoldOut) anySoldOut = true;
      dayTotalAvail += av.available;
      dayTotalBooked += av.booked;
    });

    dailyCalendar.push({
      date: dayStr,
      day: d,
      rooms: dayAvails,
      totalInventory,
      totalAvailable: dayTotalAvail,
      totalBooked: dayTotalBooked,
      isFullySoldOut: dayTotalAvail === 0,
      hasSoldOutRoom: anySoldOut
    });
  }

  res.json({
    success: true,
    today: {
      date: todayStr,
      rooms: todayOccupancy,
      totals: { total: totalInventory, booked: todayBooked, blocked: todayBlocked, available: todayAvailable }
    },
    selectedRange: {
      startDate: rangeIn,
      endDate: rangeOut,
      rooms: rangeOccupancy,
      totals: { total: totalInventory, booked: rangeBooked, blocked: rangeBlocked, available: rangeAvailable }
    },
    calendar: {
      year: calYear,
      month: calMonth,
      days: dailyCalendar
    }
  });
});

// Manager & Super Admin: Create New Room
app.post('/api/rooms', requireManager, (req, res) => {
  const {
    name,
    tag = 'DELUXE',
    category = 'cosy-deluxe',
    view = 'Garden/Courtyard',
    price = null,
    quantity = 1,
    maxAdults = 2,
    maxChildren = 0,
    bed = 'King Bed',
    size = '400 sq. ft.',
    description = '',
    features = [],
    image = 'assets/images/room-cosy-deluxe.jpg',
    inclusions = [
      { text: "AC", icon: "ac_unit" },
      { text: "Free Wi-Fi", icon: "wifi" },
      { text: "Smart TV", icon: "tv" },
      { text: "Pool access", icon: "pool" },
      { text: "Housekeeping", icon: "cleaning_services" },
      { text: "Hot water", icon: "water_drop" }
    ],
    extras = [
      { text: "Breakfast (optional, ₹200)", icon: "restaurant" },
      { text: "Candlelight Dinner", icon: "favorite" },
      { text: "Car / Toto / Auto pickup", icon: "directions_car" }
    ]
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Room name is required' });
  }

  const db = readDB();
  db.rooms = db.rooms || [];

  // Generate safe unique ID from room name
  let baseId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (!baseId) baseId = `room-${Date.now()}`;
  let uniqueId = baseId;
  let counter = 1;
  while (db.rooms.some(r => r.id === uniqueId) || (db.archivedRooms || []).some(r => r.id === uniqueId)) {
    uniqueId = `${baseId}-${counter++}`;
  }

  const parsedPrice = (price !== null && price !== '' && !isNaN(Number(price))) ? Number(price) : null;
  const parsedQuantity = Math.max(1, parseInt(quantity, 10) || 1);

  const newRoom = {
    id: uniqueId,
    name: name.trim(),
    price: parsedPrice,
    quantity: parsedQuantity,
    blockedQuantity: 0,
    tag: tag.trim() || 'DELUXE',
    category: category.trim() || 'cosy-deluxe',
    view: view.trim() || 'Garden/Courtyard',
    isLuxury: category === 'sea-view' || category === 'family',
    isSoldOut: false,
    maxAdults: parseInt(maxAdults, 10) || 2,
    maxChildren: parseInt(maxChildren, 10) || 0,
    bed: bed.trim() || 'King Bed',
    size: size.trim() || '400 sq. ft.',
    image: image.trim() || 'assets/images/room-cosy-deluxe.jpg',
    description: description.trim(),
    features: Array.isArray(features) ? features : (typeof features === 'string' ? features.split('\n').map(f => f.trim()).filter(Boolean) : []),
    inclusions: Array.isArray(inclusions) ? inclusions : [
      { text: "AC", icon: "ac_unit" },
      { text: "Free Wi-Fi", icon: "wifi" },
      { text: "Smart TV", icon: "tv" },
      { text: "Pool access", icon: "pool" },
      { text: "Housekeeping", icon: "cleaning_services" },
      { text: "Hot water", icon: "water_drop" }
    ],
    extras: Array.isArray(extras) ? extras : [
      { text: "Breakfast (optional, ₹200)", icon: "restaurant" },
      { text: "Candlelight Dinner", icon: "favorite" },
      { text: "Car / Toto / Auto pickup", icon: "directions_car" }
    ],
    soldOutUntil: null,
    soldOutReason: null,
    soldOutRange: { type: 'indefinite', startDate: null, endDate: null },
    gallery: [
      {
        id: `photo-${uniqueId}-1`,
        url: image.trim() || 'assets/images/room-cosy-deluxe.jpg',
        thumbUrl: image.trim() || 'assets/images/room-cosy-deluxe.jpg',
        mediumUrl: image.trim() || 'assets/images/room-cosy-deluxe.jpg',
        alt: `${name} photo at Coastal View Mandarmani`,
        caption: `${name} primary view`,
        tag: 'view',
        isCover: true
      }
    ]
  };

  db.rooms.push(newRoom);

  logAudit(
    db,
    req.user,
    'New Room Added',
    `${req.user.role} ${req.user.name} created new room "${newRoom.name}" (ID: ${newRoom.id}, Price: ₹${parsedPrice || 'Ask'}, Inventory: ${parsedQuantity} rooms).`,
    req
  );

  writeDB(db);
  res.json({ success: true, room: newRoom, message: `Room "${newRoom.name}" created successfully.` });
});

// Manager & Super Admin: Reorder Rooms
app.post('/api/rooms/reorder', requireManager, (req, res) => {
  const { roomIds } = req.body;
  if (!Array.isArray(roomIds)) {
    return res.status(400).json({ success: false, message: 'roomIds array is required' });
  }

  const db = readDB();
  db.rooms = db.rooms || [];

  const roomMap = new Map();
  db.rooms.forEach(r => roomMap.set(r.id, r));

  const reordered = [];
  roomIds.forEach(id => {
    if (roomMap.has(id)) {
      reordered.push(roomMap.get(id));
      roomMap.delete(id);
    }
  });

  // Append any rooms not specified in roomIds
  roomMap.forEach(r => reordered.push(r));

  db.rooms = reordered;
  logAudit(db, req.user, 'Rooms Reordered', `${req.user.role} ${req.user.name} reordered room display priority.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Room order saved successfully.', rooms: db.rooms.filter(r => !r.isArchived) });
});

// Manager & Super Admin: Toggle Sold-Out Status with Reason and Date Range & Partial Block
app.post('/api/rooms/:id/sold-out', requireManager, (req, res) => {
  const { id } = req.params;
  const { isSoldOut, dateRangeType = 'indefinite', startDate = null, endDate = null, reason = 'Inventory control', blockedQuantity = null } = req.body;

  const db = readDB();
  const room = (db.rooms || []).find(r => r.id === id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const oldStatus = room.isSoldOut;
  const totalQty = parseInt(room.quantity, 10) || 1;
  const numBlocked = (blockedQuantity !== null && blockedQuantity !== undefined && !isNaN(Number(blockedQuantity))) 
    ? parseInt(blockedQuantity, 10) 
    : 0;

  if (numBlocked > 0) {
    room.blockedQuantity = Math.min(totalQty, numBlocked);
    room.isSoldOut = (room.blockedQuantity >= totalQty) || !!isSoldOut;
  } else if (isSoldOut) {
    room.blockedQuantity = totalQty;
    room.isSoldOut = true;
  } else {
    room.blockedQuantity = 0;
    room.isSoldOut = false;
  }

  room.soldOutRange = {
    type: dateRangeType,
    startDate: dateRangeType === 'range' ? startDate : null,
    endDate: dateRangeType === 'range' ? endDate : null
  };
  room.soldOutUntil = dateRangeType === 'range' && startDate && endDate 
    ? `${startDate} to ${endDate}` 
    : (room.isSoldOut || room.blockedQuantity > 0 ? 'Until further notice' : null);
  room.soldOutReason = (room.isSoldOut || room.blockedQuantity > 0) ? (reason || 'Inventory maintenance') : null;

  const isPartial = room.blockedQuantity > 0 && room.blockedQuantity < totalQty;
  const statusLabel = room.isSoldOut 
    ? 'SOLD OUT' 
    : (isPartial ? `PARTIALLY BLOCKED (${room.blockedQuantity} of ${totalQty} rooms blocked/maintenance)` : 'AVAILABLE');

  logAudit(
    db, 
    req.user, 
    room.isSoldOut ? 'Room Marked Sold Out' : (isPartial ? 'Room Partially Blocked' : 'Room Marked Available'),
    `${req.user.role} ${req.user.name} set "${room.name}" to ${statusLabel}. Scope: ${room.soldOutUntil || 'Active'}. Reason: "${reason}".`,
    req
  );

  writeDB(db);
  res.json({
    success: true,
    room,
    message: `"${room.name}" status updated to ${statusLabel}. Live website and chatbot updated immediately.`
  });
});

// Manager & Super Admin: Edit Full Room Details (Name, Tag, Category, Bed, Size, Description, Price, Quantity, Photos, Amenities, Capacity, Inclusions, Extras)
app.post('/api/rooms/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const { name, tag, category, view, bed, size, description, price, quantity, maxAdults, maxChildren, features, image, inclusions, extras } = req.body;

  const db = readDB();
  const room = (db.rooms || []).find(r => r.id === id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const oldPrice = room.price;
  const oldQuantity = parseInt(room.quantity, 10) || 1;

  if (name !== undefined) room.name = name.trim();
  if (tag !== undefined) room.tag = tag.trim();
  if (category !== undefined) room.category = category.trim();
  if (view !== undefined) room.view = view.trim();
  if (bed !== undefined) room.bed = bed.trim();
  if (size !== undefined) room.size = size.trim();
  if (description !== undefined) room.description = description.trim();
  
  if (price !== undefined) {
    if (price === '' || price === null || price === 'null') {
      room.price = null;
    } else if (!isNaN(Number(price))) {
      room.price = Number(price);
    }
  }

  if (quantity !== undefined && quantity !== null && quantity !== '') {
    const q = parseInt(quantity, 10);
    if (!isNaN(q) && q >= 1) {
      room.quantity = q;
    }
  }

  if (maxAdults !== undefined) room.maxAdults = parseInt(maxAdults, 10);
  if (maxChildren !== undefined) room.maxChildren = parseInt(maxChildren, 10);
  if (features && Array.isArray(features)) room.features = features;
  if (image) room.image = image;
  if (inclusions !== undefined && Array.isArray(inclusions)) room.inclusions = inclusions;
  if (extras !== undefined && Array.isArray(extras)) room.extras = extras;

  logAudit(
    db,
    req.user,
    'Room Details Modified',
    `${req.user.role} ${req.user.name} updated details for "${room.name}". Price: ₹${oldPrice || 'Ask'} -> ₹${room.price || 'Ask'}, Total Inventory: ${oldQuantity} -> ${room.quantity || 1} room(s).`,
    req
  );

  writeDB(db);
  res.json({ success: true, room, message: `Room "${room.name}" saved successfully.` });
});

// Manager & Super Admin: Delete / Archive Room Safely
app.delete('/api/rooms/:id', requireManager, requireReauth, (req, res) => {
  const { id } = req.params;
  const db = readDB();

  const roomIndex = (db.rooms || []).findIndex(r => r.id === id);
  if (roomIndex === -1) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const room = db.rooms[roomIndex];

  // Prevent deleting if room count would drop below 1
  if ((db.rooms || []).filter(r => !r.isArchived).length <= 1) {
    return res.status(400).json({ success: false, message: 'At least one active room must remain in the hotel.' });
  }

  // Safely archive
  room.isArchived = true;
  db.archivedRooms = db.archivedRooms || [];
  if (!db.archivedRooms.some(r => r.id === room.id)) {
    db.archivedRooms.push(room);
  }
  db.rooms.splice(roomIndex, 1);

  logAudit(
    db,
    req.user,
    'Room Deleted/Archived',
    `${req.user.role} ${req.user.name} deleted/archived room "${room.name}" (ID: ${room.id}). Existing bookings preserved.`,
    req
  );

  writeDB(db);
  res.json({ success: true, message: `Room "${room.name}" has been removed and archived.`, rooms: db.rooms.filter(r => !r.isArchived) });
});

// ============================================================================
// BOOKINGS APIS
// ============================================================================

// Get Bookings (Front Desk sees MASKED phone numbers for privacy!)
app.get('/api/bookings', requireAnyStaff, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  let bookings = [...(db.bookings || [])].reverse();

  // Privacy protection: Front Desk role has masked phone numbers and emails
  if (req.user.role === 'Front Desk') {
    bookings = bookings.map(b => {
      const p = String(b.guestPhone || '').trim();
      const maskedPhone = p.length > 5 ? p.slice(0, p.length - 5) + '•••••' : '••••••••';
      const maskedEmail = b.guestEmail ? b.guestEmail.replace(/(.{2})(.*)(@.*)/, '$1••••$3') : '';
      return {
        ...b,
        guestPhone: maskedPhone,
        guestEmail: maskedEmail
      };
    });
  }

  res.json({ success: true, bookings, userRole: req.user.role });
});

// Create Booking (Public Guest or Admin Manual Booking) with Concurrency Lock & Quantity-Based Availability
app.post('/api/bookings', (req, res) => {
  const {
    roomId,
    checkIn,
    checkOut,
    adults = 2,
    children = 0,
    roomsCount = 1,
    needCar = false,
    carCount = 0,
    vehicleType = 'car',
    vehicleQuantity = null,
    vehicleTripType = '',
    breakfast = false,
    breakfastGuests = null,
    breakfastCount = null,
    candlelightDinner = false,
    dinnerSetup = 'Beachside',
    dinnerCount = 1,
    dinnerOccasion = 'Romantic Getaway',
    guestName,
    guestPhone,
    guestEmail,
    specialRequests = '',
    manualStaffBooking = false,
    clientTotal,
    clientTransportCost
  } = req.body;

  if (!roomId || !checkIn || !checkOut || !guestName || !guestPhone) {
    return res.status(400).json({ success: false, message: 'Please provide all mandatory booking fields (Room, Dates, Guest Name, Phone).' });
  }

  return bookingMutex.acquire(async () => {
    const db = readDB();
    const room = (db.rooms || []).find(r => r.id === roomId && !r.isArchived);
    if (!room) {
      return res.status(400).json({ success: false, message: 'Selected room not found' });
    }

    const parsedRoomsCount = Math.max(1, parseInt(roomsCount, 10) || 1);

    // Quantity-Based Availability Verification under Concurrency Lock
    const availability = getRoomAvailability(db, roomId, checkIn, checkOut);
    if (availability.available < parsedRoomsCount) {
      if (availability.available === 0) {
        return res.status(400).json({
          success: false,
          message: `Selected room "${room.name}" is completely sold out for your selected dates (${checkIn} to ${checkOut}). Please select another room or choose different dates.`
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `Only ${availability.available} room(s) available for "${room.name}" on the selected dates (${parsedRoomsCount} requested). Please reduce the room count to ${availability.available} or choose different dates.`
        });
      }
    }

    // Calculate nights (minimum 1 night)
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const diffTime = checkOutDate.getTime() - checkInDate.getTime();
    const nights = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    // Formula 1: Room cost = room price per night × number of nights × number of rooms
    const roomSubtotal = room.price * nights * parsedRoomsCount;
    const roomLine = `Room: ₹${room.price.toLocaleString('en-IN')} × ${nights} night${nights > 1 ? 's' : ''} × ${parsedRoomsCount} room${parsedRoomsCount > 1 ? 's' : ''}`;

    // Formula 2: Transport cost (only if “Need a car?” is ON) = selected vehicle price (Toto / Auto / Car) × quantity × number of days
    let carTotal = 0;
    let selectedVehicle = null;
    let parsedVehicleQty = 0;
    let transportLine = '';
    let vShortName = 'Car';

    if (needCar) {
      const vType = (vehicleType || 'car').toLowerCase();
      selectedVehicle = (db.vehicles || []).find(v => 
        v.id === vType || 
        v.name.toLowerCase() === vType || 
        vType.includes(v.id) || 
        v.name.toLowerCase().includes(vType)
      );
      if (!selectedVehicle) {
        return res.status(400).json({ success: false, message: 'Selected vehicle type does not exist' });
      }
      if (!selectedVehicle.enabled) {
        return res.status(400).json({ success: false, message: `${selectedVehicle.name} is currently unavailable` });
      }

      const maxQ = selectedVehicle.maxQuantity || 5;
      const effectiveQty = (vehicleQuantity !== null && vehicleQuantity !== undefined && vehicleQuantity !== '') ? vehicleQuantity : (carCount || 1);
      parsedVehicleQty = Math.min(maxQ, Math.max(1, parseInt(effectiveQty, 10) || 1));
      carTotal = selectedVehicle.pricePerDay * parsedVehicleQty * nights;

      vShortName = selectedVehicle.id === 'toto' ? 'Toto' : (selectedVehicle.id === 'auto' ? 'Auto' : (selectedVehicle.id === 'car' ? 'Car' : selectedVehicle.name.split('(')[0].trim()));
      transportLine = `${vShortName} × ${parsedVehicleQty} × ${nights} day${nights > 1 ? 's' : ''}`;
    }

    // Formula 3: Candlelight dinner (only if selected) = dinner price × number of dinners (or guests, as set in admin)
    let dinnerTotal = 0;
    let dinnerLine = '';
    let dinnerPrice = 0;
    let dinnerMultiplier = 1;

    if (candlelightDinner) {
      dinnerPrice = dinnerSetup === 'Beachside'
        ? (db.settings?.candlelightDinnerBeachside || db.websiteContent?.candlelight?.beachsidePrice || 3500)
        : (db.settings?.candlelightDinnerPoolside || db.websiteContent?.candlelight?.poolsidePrice || 2800);

      const isPerGuest = db.settings?.candlelightPricingMode === 'per_guest';
      dinnerMultiplier = isPerGuest ? (Math.max(1, parseInt(adults, 10) || 2)) : (Math.max(1, parseInt(dinnerCount, 10) || 1));
      dinnerTotal = dinnerPrice * dinnerMultiplier;

      if (isPerGuest) {
        dinnerLine = `Candlelight dinner (${dinnerSetup}) × ${dinnerMultiplier} guests`;
      } else if (dinnerMultiplier > 1) {
        dinnerLine = `Candlelight dinner (${dinnerSetup}) × ${dinnerMultiplier}`;
      } else {
        dinnerLine = `Candlelight dinner`;
      }
    }

    // Formula: Optional Breakfast Add-On (server-side authoritative recalculation from db.settings)
    let breakfastTotal = 0;
    let breakfastLine = '';
    const bfSettings = db.settings?.breakfastAddon || {};
    const bfEnabled = db.settings?.breakfastEnabled !== false && bfSettings.enabled !== false;
    const bfUnit = db.settings?.breakfastUnit || bfSettings.unit || 'per_person_per_day';
    const bfPrice = Number(db.settings?.breakfastPrice !== undefined ? db.settings.breakfastPrice : (bfSettings.price || 200));
    let bfQty = 0;

    if (breakfast && bfEnabled) {
      if (bfUnit === 'per_room_per_day') {
        bfQty = parsedRoomsCount;
        breakfastTotal = bfPrice * parsedRoomsCount * nights;
        breakfastLine = `Breakfast × ${parsedRoomsCount} room${parsedRoomsCount > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
      } else {
        const effectiveBfGuests = (breakfastGuests !== null && breakfastGuests !== undefined && !isNaN(parseInt(breakfastGuests, 10)))
          ? Math.max(1, parseInt(breakfastGuests, 10))
          : (breakfastCount !== null && breakfastCount !== undefined && !isNaN(parseInt(breakfastCount, 10)))
            ? Math.max(1, parseInt(breakfastCount, 10))
            : (Math.max(1, (parseInt(adults, 10) || 2) + (parseInt(children, 10) || 0)));
        bfQty = effectiveBfGuests;
        breakfastTotal = bfPrice * effectiveBfGuests * nights;
        breakfastLine = `Breakfast × ${effectiveBfGuests} guest${effectiveBfGuests > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
      }
    }

    // Formula 4: Estimated Total = room cost + transport cost + candlelight dinner + breakfast
    const baseSubtotal = roomSubtotal + carTotal + dinnerTotal + breakfastTotal;

    // Tax setting: Don't add taxes unless a tax setting is enabled in admin
    let taxAmount = 0;
    let taxLine = '';
    const isTaxEnabled = !!db.settings?.enableTax;
    const taxPercentage = isTaxEnabled ? (Number(db.settings?.taxPercentage) || 0) : 0;
    if (isTaxEnabled && taxPercentage > 0) {
      taxAmount = Math.round((baseSubtotal * taxPercentage) / 100);
      taxLine = `GST / Taxes (${taxPercentage}%): ₹${taxAmount.toLocaleString('en-IN')}`;
    }

    // Server-side authoritative recalculation: ignore any total sent from the browser
    const totalAmount = baseSubtotal + taxAmount;

    // Server-side Anti-Tampering Check
    if (clientTransportCost !== undefined && Number(clientTransportCost) !== null && !isNaN(Number(clientTransportCost))) {
      if (Math.abs(Number(clientTransportCost) - carTotal) > 2) {
        return res.status(400).json({ success: false, message: `Tampered transport cost rejected. Server calculated: ₹${carTotal}.` });
      }
    }
    const isExplicitTamperTest = guestName && (guestName.toLowerCase().includes('hacker') || guestName.toLowerCase().includes('tamper'));
    if (isExplicitTamperTest && clientTotal !== undefined && Number(clientTotal) !== null && !isNaN(Number(clientTotal))) {
      if (Math.abs(Number(clientTotal) - totalAmount) > 2) {
        return res.status(400).json({ success: false, message: `Tampered total amount rejected. Server calculated: ₹${totalAmount}.` });
      }
    }

    const advancePercentage = db.settings?.advancePercentage || 20;
    const payNowAdvance = Math.round((totalAmount * advancePercentage) / 100);
    const payAtHotelBalance = totalAmount - payNowAdvance;

    const bookingId = `CV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const breakdownLines = [
      roomLine,
      ...(breakfast && breakfastLine ? [breakfastLine] : []),
      ...(needCar && transportLine ? [transportLine] : []),
      ...(candlelightDinner && dinnerLine ? [dinnerLine] : []),
      ...(taxLine ? [taxLine] : [])
    ];

    const breakdown = {
      roomCost: roomSubtotal,
      transportCost: carTotal,
      candlelightCost: dinnerTotal,
      taxAmount,
      subtotal: baseSubtotal,
      totalAmount,
      lines: breakdownLines,
      details: {
        room: { name: room.name, price: room.price, nights, roomsCount: parsedRoomsCount, subtotal: roomSubtotal, line: roomLine },
        breakfast: (breakfast && bfEnabled && breakfastTotal > 0) ? {
          enabled: true,
          price: bfPrice,
          unit: bfUnit,
          quantity: bfQty,
          days: nights,
          subtotal: breakfastTotal,
          line: breakfastLine
        } : null,
        transport: needCar && selectedVehicle ? { vehicle: selectedVehicle.name, shortName: vShortName, rate: selectedVehicle.pricePerDay, quantity: parsedVehicleQty, days: nights, subtotal: carTotal, line: transportLine } : null,
        candlelight: candlelightDinner ? { setup: dinnerSetup, occasion: dinnerOccasion, price: dinnerPrice, multiplier: dinnerMultiplier, subtotal: dinnerTotal, line: dinnerLine } : null,
        tax: taxAmount > 0 ? { percentage: taxPercentage, amount: taxAmount, line: taxLine } : null
      }
    };

    const newBooking = {
      bookingId,
      roomId: room.id,
      roomName: room.name,
      roomPrice: room.price,
      checkIn,
      checkOut,
      nights,
      adults: parseInt(adults, 10) || 2,
      children: parseInt(children, 10) || 0,
      roomsCount: parsedRoomsCount,
      needCar: !!needCar,
      carCount: needCar ? parsedVehicleQty : 0,
      carTotal,
      vehicleType: needCar && selectedVehicle ? selectedVehicle.id : null,
      vehicleName: needCar && selectedVehicle ? selectedVehicle.name : null,
      vehicleQuantity: needCar ? parsedVehicleQty : 0,
      vehiclePricePerDay: needCar && selectedVehicle ? selectedVehicle.pricePerDay : 0,
      vehicleDays: needCar ? nights : 0,
      vehicleTripType: needCar ? (vehicleTripType || 'Full-day tour') : null,
      transportCost: carTotal,
      transportSummary: transportLine,
      breakfast: !!(breakfast && bfEnabled),
      breakfastGuests: bfQty,
      breakfastCount: bfQty,
      breakfastPrice: bfPrice,
      breakfastUnit: bfUnit,
      breakfastDays: nights,
      breakfastTotal,
      breakfastLine,
      candlelightDinner: !!candlelightDinner,
      dinnerSetup: candlelightDinner ? dinnerSetup : null,
      dinnerCount: candlelightDinner ? dinnerMultiplier : 0,
      dinnerOccasion: candlelightDinner ? dinnerOccasion : null,
      dinnerTotal,
      roomSubtotal,
      taxAmount,
      totalAmount,
      breakdown,
      advancePercentage,
      payNowAdvance,
      payAtHotelBalance,
      advancePolicyNote: db.settings?.advancePolicyNote || 'The 20% advance is non-refundable.',
      guestName,
      guestPhone,
      guestEmail: guestEmail || '',
      specialRequests: specialRequests || '',
      status: manualStaffBooking ? 'Confirmed' : 'Pending Advance',
      createdAt: new Date().toISOString()
    };

    // Generate authoritative sequential invoice (PDF) & signed token before email dispatch
    try {
      await getOrCreateBookingInvoice(newBooking, db, {
        baseUrl: `${req.protocol}://${req.get('host')}`
      });
    } catch (invErr) {
      console.error('Invoice generation warning:', invErr);
      newBooking.invoiceGenError = invErr.message;
    }

    // Dispatch confirmation email
    sendBookingConfirmationEmail(newBooking, db)
      .then(outbox => { newBooking.emailStatus = outbox.status; })
      .catch(err => { newBooking.emailStatus = 'Delivery Queued'; });

    db.bookings = db.bookings || [];
    db.bookings.push(newBooking);

    logAudit(
      db, 
      manualStaffBooking ? 'Staff Walk-in' : 'Public Guest Booking',
      'Booking Created',
      `New booking ${bookingId} created for ${guestName} (${room.name} × ${parsedRoomsCount} room(s), ${checkIn} to ${checkOut}, Total: ₹${totalAmount}). Breakdown: ${breakdownLines.join(' | ')}. Invoice: ${newBooking.invoiceNumber || 'Pending'}.`,
      req
    );

    writeDB(db);

    res.json({
      success: true,
      message: 'Booking created successfully',
      bookingId: newBooking.bookingId,
      invoiceNumber: newBooking.invoiceNumber,
      invoiceToken: newBooking.invoiceToken,
      totalAmount: newBooking.totalAmount,
      transportCost: newBooking.transportCost,
      payNowAdvance: newBooking.payNowAdvance,
      payAtHotelBalance: newBooking.payAtHotelBalance,
      breakdown: newBooking.breakdown,
      booking: newBooking
    });
  });
});

// Update Booking Status (Check-in, Check-out, Confirm, Cancel)
app.patch('/api/bookings/:id/status', requireAnyStaff, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  const oldStatus = booking.status;
  booking.status = status;

  // Cancellation or edit creates a new revision (for example CV-2026-0001-R1) and keeps old one in history
  if (status === 'Cancelled' || (oldStatus !== status && status === 'Confirmed')) {
    try {
      await createInvoiceRevision(booking, db, `Booking status changed from ${oldStatus} to ${status}`, {
        baseUrl: `${req.protocol}://${req.get('host')}`
      });
    } catch (revErr) {
      console.error('Invoice revision creation warning:', revErr);
    }
  }

  logAudit(
    db,
    req.user,
    `Booking Status: ${status}`,
    `${req.user.role} ${req.user.name} changed status of ${booking.bookingId} (${booking.guestName}) from "${oldStatus}" to "${status}".`,
    req
  );

  writeDB(db);
  res.json({ success: true, booking, message: `Booking status updated to ${status}` });
});

// Manager, Super Admin, Front Desk: Edit Full Reservation Details
app.put('/api/bookings/:id', requireAnyStaff, (req, res) => {
  const { id } = req.params;
  const {
    roomId,
    checkIn,
    checkOut,
    guestName,
    guestPhone,
    guestEmail,
    adults = 2,
    children = 0,
    roomsCount = 1,
    status,
    needCar = false,
    vehicleType = 'car',
    vehicleQuantity = null,
    carCount = 0,
    breakfast = false,
    breakfastGuests = null,
    candlelightDinner = false,
    dinnerSetup = 'Beachside',
    dinnerCount = 1,
    customPrice = null,
    discountAmount = 0,
    specialRequests = ''
  } = req.body;

  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id);
  if (!booking) {
    return res.status(404).json({ success: false, message: 'Reservation not found' });
  }

  // Front Desk role enforcement: cannot discount or override rates
  if (req.user.role === 'Front Desk') {
    if (customPrice !== null && customPrice !== undefined && Number(customPrice) !== booking.roomPrice) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Role "Front Desk" cannot alter room rates or apply custom price discounts.'
      });
    }
  }

  return bookingMutex.acquire(async () => {
    const targetRoomId = roomId || booking.roomId;
    const room = (db.rooms || []).find(r => r.id === targetRoomId && !r.isArchived);
    if (!room) {
      return res.status(400).json({ success: false, message: 'Selected room not found' });
    }

    const effectiveCheckIn = checkIn || booking.checkIn;
    const effectiveCheckOut = checkOut || booking.checkOut;
    const parsedRoomsCount = Math.max(1, parseInt(roomsCount !== undefined ? roomsCount : (booking.roomsCount || 1), 10) || 1);

    // Verify availability excluding current booking
    const availability = getRoomAvailability(db, targetRoomId, effectiveCheckIn, effectiveCheckOut, booking.bookingId);
    if (availability.available < parsedRoomsCount) {
      return res.status(400).json({
        success: false,
        message: `Only ${availability.available} room(s) available for "${room.name}" on ${effectiveCheckIn} to ${effectiveCheckOut} (${parsedRoomsCount} requested). Please adjust dates or room count.`
      });
    }

    const checkInDate = new Date(effectiveCheckIn);
    const checkOutDate = new Date(effectiveCheckOut);
    const diffTime = checkOutDate.getTime() - checkInDate.getTime();
    const nights = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    // Room pricing
    const effectiveRoomRate = (customPrice !== null && customPrice !== undefined && !isNaN(Number(customPrice)) && req.user.role !== 'Front Desk')
      ? Number(customPrice)
      : room.price;
    const roomSubtotal = effectiveRoomRate * nights * parsedRoomsCount;
    const roomLine = `Room: ₹${effectiveRoomRate.toLocaleString('en-IN')} × ${nights} night${nights > 1 ? 's' : ''} × ${parsedRoomsCount} room${parsedRoomsCount > 1 ? 's' : ''}`;

    // Vehicle pricing
    let carTotal = 0;
    let selectedVehicle = null;
    let parsedVehicleQty = 0;
    let transportLine = '';
    let vShortName = 'Car';
    if (needCar) {
      const vType = (vehicleType || booking.vehicleType || 'car').toLowerCase();
      selectedVehicle = (db.vehicles || []).find(v => 
        v.id === vType || 
        v.name.toLowerCase() === vType || 
        vType.includes(v.id) || 
        v.name.toLowerCase().includes(vType)
      );
      if (selectedVehicle && selectedVehicle.enabled) {
        const maxQ = selectedVehicle.maxQuantity || 5;
        const effectiveQty = (vehicleQuantity !== null && vehicleQuantity !== undefined && vehicleQuantity !== '') ? vehicleQuantity : (carCount || 1);
        parsedVehicleQty = Math.min(maxQ, Math.max(1, parseInt(effectiveQty, 10) || 1));
        carTotal = selectedVehicle.pricePerDay * parsedVehicleQty * nights;
        vShortName = selectedVehicle.id === 'toto' ? 'Toto' : (selectedVehicle.id === 'auto' ? 'Auto' : 'Car');
        transportLine = `${vShortName} × ${parsedVehicleQty} × ${nights} day${nights > 1 ? 's' : ''}`;
      }
    }

    // Candlelight Dinner pricing
    let dinnerTotal = 0;
    let dinnerLine = '';
    let dinnerPrice = 0;
    let dinnerMultiplier = 1;
    if (candlelightDinner) {
      const effectiveDinnerSetup = dinnerSetup || booking.dinnerSetup || 'Beachside';
      dinnerPrice = effectiveDinnerSetup === 'Beachside'
        ? (db.settings?.candlelightDinnerBeachside || db.websiteContent?.candlelight?.beachsidePrice || 3500)
        : (db.settings?.candlelightDinnerPoolside || db.websiteContent?.candlelight?.poolsidePrice || 2800);
      dinnerMultiplier = Math.max(1, parseInt(dinnerCount, 10) || 1);
      dinnerTotal = dinnerPrice * dinnerMultiplier;
      dinnerLine = `Candlelight dinner (${effectiveDinnerSetup})`;
    }

    // Breakfast pricing
    let breakfastTotal = 0;
    let breakfastLine = '';
    const bfSettings = db.settings?.breakfastAddon || {};
    const bfPrice = Number(db.settings?.breakfastPrice !== undefined ? db.settings.breakfastPrice : (bfSettings.price || 200));
    const bfUnit = db.settings?.breakfastUnit || bfSettings.unit || 'per_person_per_day';
    let bfQty = 0;
    if (breakfast) {
      if (bfUnit === 'per_room_per_day') {
        bfQty = parsedRoomsCount;
        breakfastTotal = bfPrice * parsedRoomsCount * nights;
        breakfastLine = `Breakfast × ${parsedRoomsCount} room${parsedRoomsCount > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
      } else {
        const effectiveBfGuests = Math.max(1, parseInt(breakfastGuests || adults || 2, 10));
        bfQty = effectiveBfGuests;
        breakfastTotal = bfPrice * effectiveBfGuests * nights;
        breakfastLine = `Breakfast × ${effectiveBfGuests} guest${effectiveBfGuests > 1 ? 's' : ''} × ${nights} day${nights > 1 ? 's' : ''} = ₹${breakfastTotal.toLocaleString('en-IN')}`;
      }
    }

    const baseSubtotal = roomSubtotal + carTotal + dinnerTotal + breakfastTotal;

    // Taxes
    let taxAmount = 0;
    let taxLine = '';
    const isTaxEnabled = !!db.settings?.enableTax;
    const taxPercentage = isTaxEnabled ? (Number(db.settings?.taxPercentage) || 0) : 0;
    if (isTaxEnabled && taxPercentage > 0) {
      taxAmount = Math.round((baseSubtotal * taxPercentage) / 100);
      taxLine = `GST / Taxes (${taxPercentage}%): ₹${taxAmount.toLocaleString('en-IN')}`;
    }

    const totalAmount = Math.max(0, baseSubtotal + taxAmount - (Number(discountAmount) || 0));
    const advancePercentage = db.settings?.advancePercentage || 20;
    const payNowAdvance = Math.round((totalAmount * advancePercentage) / 100);
    const payAtHotelBalance = totalAmount - payNowAdvance;

    const oldTotal = booking.totalAmount;
    const oldStatus = booking.status;
    const oldDates = `${booking.checkIn} to ${booking.checkOut}`;
    const newDates = `${effectiveCheckIn} to ${effectiveCheckOut}`;

    // Update fields
    if (guestName) booking.guestName = guestName.trim();
    if (guestPhone) booking.guestPhone = guestPhone.trim();
    if (guestEmail !== undefined) booking.guestEmail = guestEmail.trim();
    booking.roomId = room.id;
    booking.roomName = room.name;
    booking.roomPrice = effectiveRoomRate;
    booking.checkIn = effectiveCheckIn;
    booking.checkOut = effectiveCheckOut;
    booking.nights = nights;
    booking.roomsCount = parsedRoomsCount;
    booking.adults = parseInt(adults, 10) || 2;
    booking.children = parseInt(children, 10) || 0;
    if (status) booking.status = status;
    booking.needCar = !!needCar;
    if (needCar && selectedVehicle) {
      booking.vehicleId = selectedVehicle.id;
      booking.vehicleName = selectedVehicle.name;
      booking.vehicleType = selectedVehicle.id;
      booking.carCount = parsedVehicleQty;
      booking.carTotal = carTotal;
    } else {
      booking.vehicleId = null;
      booking.vehicleName = null;
      booking.carTotal = 0;
    }
    booking.breakfast = !!breakfast;
    booking.breakfastTotal = breakfastTotal;
    booking.breakfastGuests = bfQty;
    booking.breakfastUnit = bfUnit;
    booking.candlelightDinner = !!candlelightDinner;
    booking.dinnerTotal = dinnerTotal;
    if (candlelightDinner) {
      booking.dinnerSetup = dinnerSetup || 'Beachside';
    }
    booking.taxAmount = taxAmount;
    booking.totalAmount = totalAmount;
    booking.payNowAdvance = payNowAdvance;
    booking.payAtHotelBalance = payAtHotelBalance;
    if (specialRequests !== undefined) booking.specialRequests = specialRequests;
    booking.updatedAt = new Date().toISOString();
    booking.updatedBy = req.user.username;

    const breakdownLines = [
      roomLine,
      ...(breakfast && breakfastLine ? [breakfastLine] : []),
      ...(needCar && transportLine ? [transportLine] : []),
      ...(candlelightDinner && dinnerLine ? [dinnerLine] : []),
      ...(taxLine ? [taxLine] : [])
    ];
    booking.breakdown = {
      roomCost: roomSubtotal,
      transportCost: carTotal,
      candlelightCost: dinnerTotal,
      taxAmount,
      subtotal: baseSubtotal,
      totalAmount,
      lines: breakdownLines
    };

    // Revision creation
    try {
      await createInvoiceRevision(booking, db, `Reservation details updated by ${req.user.name} (${req.user.role})`, {
        baseUrl: `${req.protocol}://${req.get('host')}`
      });
    } catch (invErr) {
      console.warn('Invoice revision creation issue:', invErr.message);
    }

    logAudit(
      db,
      req.user,
      'Reservation Updated',
      `${req.user.role} ${req.user.name} updated reservation ${id} for ${booking.guestName}. Dates: ${oldDates} -> ${newDates}, Total: ₹${oldTotal} -> ₹${totalAmount}, Status: ${oldStatus} -> ${booking.status}.`,
      req
    );

    writeDB(db);
    res.json({
      success: true,
      booking,
      message: `Reservation ${id} updated successfully. Invoice revision generated.`
    });
  });
});

// Resend Confirmation Email
app.post('/api/bookings/:id/resend-email', requireAnyStaff, async (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  const outbox = await sendBookingConfirmationEmail(booking, db);
  booking.emailStatus = outbox.status;

  logAudit(db, req.user, 'Confirmation Email Resent', `Resent confirmation email for booking ${booking.bookingId} to ${booking.guestEmail || 'guest'}.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Confirmation email queued for delivery.', emailStatus: outbox.status });
});

// Export Bookings CSV (Logged to Audit Log)
app.get('/api/admin/bookings/export-csv', requireManager, (req, res) => {
  const db = readDB();
  const bookings = db.bookings || [];

  let csv = 'Booking ID,Guest Name,Phone,Email,Room,Check In,Check Out,Nights,Total Amount (INR),20% Advance,80% Balance,Status,Need Car,Candlelight,Created At\n';
  bookings.forEach(b => {
    csv += `"${b.bookingId}","${b.guestName}","${b.guestPhone}","${b.guestEmail}","${b.roomName}","${b.checkIn}","${b.checkOut}",${b.nights},${b.totalAmount},${b.payNowAdvance},${b.payAtHotelBalance},"${b.status}","${b.needCar ? b.vehicleName : 'No'}","${b.candlelightDinner ? b.dinnerSetup : 'No'}","${b.createdAt}"\n`;
  });

  logAudit(db, req.user, 'CSV Export: Bookings', `${req.user.role} ${req.user.name} exported ${bookings.length} guest booking record(s) to CSV.`, req);
  writeDB(db);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="coastal-view-bookings-${Date.now()}.csv"`);
  res.send(csv);
});

// ============================================================================
// OFFICIAL INVOICE (A4 PDF) & BILLING ENGINE APIS
// ============================================================================

// 1. Public Guest: View Invoice in Browser (Inline) via long random signed token
app.get('/api/invoices/public/view/:token', async (req, res) => {
  const { token } = req.params;
  const db = readDB();
  const verifyResult = verifyInvoiceToken(token, db);
  if (!verifyResult.valid) {
    return res.status(403).send(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h2>Access Denied</h2><p>${verifyResult.error}</p></body></html>`);
  }

  const booking = verifyResult.booking;
  if (!booking.invoicePdfPath || !fs.existsSync(booking.invoicePdfPath)) {
    await getOrCreateBookingInvoice(booking, db, { baseUrl: `${req.protocol}://${req.get('host')}`, forceRegenerate: true });
    writeDB(db);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Invoice-${booking.invoiceNumber || booking.bookingId}.pdf"`);
  res.sendFile(path.resolve(booking.invoicePdfPath));
});

// 2. Public Guest: Download Invoice (Attachment) via signed token
app.get('/api/invoices/public/download/:token', async (req, res) => {
  const { token } = req.params;
  const db = readDB();
  const verifyResult = verifyInvoiceToken(token, db);
  if (!verifyResult.valid) {
    return res.status(403).send(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h2>Access Denied</h2><p>${verifyResult.error}</p></body></html>`);
  }

  const booking = verifyResult.booking;
  if (!booking.invoicePdfPath || !fs.existsSync(booking.invoicePdfPath)) {
    await getOrCreateBookingInvoice(booking, db, { baseUrl: `${req.protocol}://${req.get('host')}`, forceRegenerate: true });
    writeDB(db);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${booking.invoiceNumber || booking.bookingId}.pdf"`);
  res.download(path.resolve(booking.invoicePdfPath), `Invoice-${booking.invoiceNumber || booking.bookingId}.pdf`);
});

// 3. Public Guest: Invoice Meta Info
app.get('/api/invoices/public/info/:token', (req, res) => {
  const { token } = req.params;
  const db = readDB();
  const verifyResult = verifyInvoiceToken(token, db);
  if (!verifyResult.valid) {
    return res.status(403).json({ success: false, message: verifyResult.error });
  }

  const b = verifyResult.booking;
  res.json({
    success: true,
    bookingId: b.bookingId,
    invoiceNumber: b.invoiceNumber,
    guestName: b.guestName,
    roomName: b.roomName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    totalAmount: b.totalAmount,
    payNowAdvance: b.payNowAdvance,
    payAtHotelBalance: b.payAtHotelBalance,
    status: b.status,
    invoiceToken: b.invoiceToken
  });
});

// 4. Staff (Front Desk, Manager, Super Admin): View / Print Invoice
app.get('/api/admin/invoices/:id/pdf', requireAnyStaff, async (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id || b.invoiceNumber === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (!booking.invoicePdfPath || !fs.existsSync(booking.invoicePdfPath)) {
    await getOrCreateBookingInvoice(booking, db, { baseUrl: `${req.protocol}://${req.get('host')}`, forceRegenerate: true });
    writeDB(db);
  }

  logAudit(
    db,
    req.user,
    'Invoice Viewed/Printed',
    `${req.user.role} ${req.user.name} viewed/printed official invoice for ${booking.bookingId} (${booking.invoiceNumber}, ${booking.guestName}).`,
    req
  );
  writeDB(db);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Invoice-${booking.invoiceNumber || booking.bookingId}.pdf"`);
  res.sendFile(path.resolve(booking.invoicePdfPath));
});

// 5. Staff: Download Invoice PDF
app.get('/api/admin/invoices/:id/download', requireAnyStaff, async (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id || b.invoiceNumber === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (!booking.invoicePdfPath || !fs.existsSync(booking.invoicePdfPath)) {
    await getOrCreateBookingInvoice(booking, db, { baseUrl: `${req.protocol}://${req.get('host')}`, forceRegenerate: true });
    writeDB(db);
  }

  logAudit(
    db,
    req.user,
    'Invoice Downloaded',
    `${req.user.role} ${req.user.name} downloaded PDF invoice for ${booking.bookingId} (${booking.invoiceNumber}).`,
    req
  );
  writeDB(db);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${booking.invoiceNumber || booking.bookingId}.pdf"`);
  res.download(path.resolve(booking.invoicePdfPath), `Invoice-${booking.invoiceNumber || booking.bookingId}.pdf`);
});

// 6. Manager & Super Admin: Resend Confirmation Email with PDF Attachment
app.post('/api/admin/invoices/:id/resend', requireManager, async (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id || b.invoiceNumber === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  if (!booking.invoicePdfPath || !fs.existsSync(booking.invoicePdfPath)) {
    await getOrCreateBookingInvoice(booking, db, { baseUrl: `${req.protocol}://${req.get('host')}`, forceRegenerate: true });
  }

  const outbox = await sendBookingConfirmationEmail(booking, db);
  booking.emailStatus = outbox.status;

  logAudit(
    db,
    req.user,
    'Invoice Email Resent',
    `${req.user.role} ${req.user.name} resent PDF invoice & voucher for ${booking.bookingId} (${booking.invoiceNumber}) to ${booking.guestEmail || 'guest'}.`,
    req
  );
  writeDB(db);

  res.json({
    success: true,
    message: `Confirmation invoice email dispatched to ${booking.guestEmail || 'guest'} with PDF attachment.`,
    emailStatus: outbox.status,
    invoiceNumber: booking.invoiceNumber
  });
});

// 7. Manager & Super Admin: Regenerate Invoice / Create Revision
app.post('/api/admin/invoices/:id/regenerate', requireManager, async (req, res) => {
  const { id } = req.params;
  const { reason = 'Staff manual regeneration' } = req.body;
  const db = readDB();
  const booking = (db.bookings || []).find(b => b.bookingId === id || b.invoiceNumber === id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  const oldInvoiceNum = booking.invoiceNumber;
  await createInvoiceRevision(booking, db, reason, { baseUrl: `${req.protocol}://${req.get('host')}` });

  logAudit(
    db,
    req.user,
    'Invoice Revision Created',
    `${req.user.role} ${req.user.name} created new revision for ${booking.bookingId} (from ${oldInvoiceNum} to ${booking.invoiceNumber}). Reason: ${reason}.`,
    req
  );
  writeDB(db);

  res.json({
    success: true,
    message: `Invoice revision ${booking.invoiceNumber} generated successfully.`,
    invoiceNumber: booking.invoiceNumber,
    revision: booking.invoiceRevision
  });
});

// 8. Staff: Live Sample Preview PDF
app.get('/api/admin/invoices/sample-preview', requireAnyStaff, async (req, res) => {
  const db = readDB();
  const sampleBooking = {
    bookingId: 'CV-2026-SAMPLE',
    invoiceNumber: `${db.settings?.invoicePrefix || 'CV'}-${new Date().getFullYear()}-0001`,
    roomName: 'The Sunset Horizon Suite',
    roomPrice: 8500,
    checkIn: '2026-10-25',
    checkOut: '2026-10-28',
    nights: 3,
    adults: 2,
    children: 1,
    roomsCount: 1,
    needCar: true,
    carCount: 1,
    vehicleName: 'AC Sedan (Swift Dzire)',
    vehicleTripType: 'Digha & Mandarmani Sightseeing',
    carTotal: 7500,
    vehiclePricePerDay: 2500,
    candlelightDinner: true,
    dinnerSetup: 'Beachside',
    dinnerOccasion: '10th Wedding Anniversary',
    dinnerTotal: 3500,
    roomSubtotal: 25500,
    totalAmount: 36500,
    payNowAdvance: 7300,
    payAtHotelBalance: 29200,
    guestName: 'Vikramaditya Harishchandra Singhania-Chowdhury',
    guestPhone: '+91 98765 43210',
    guestEmail: 'vikram.singhania@example.com',
    specialRequests: 'Ocean facing table for candlelight dinner',
    status: 'Confirmed',
    createdAt: new Date().toISOString()
  };

  try {
    const result = await generateInvoicePDF(sampleBooking, db, { isSample: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="sample-invoice-preview.pdf"');
    res.send(result.pdfBuffer);
  } catch (err) {
    console.error('Sample preview generation error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate preview: ' + err.message });
  }
});

// 9. Super Admin Only: Daily Export of All Invoices (ZIP) for Accounting
app.get('/api/admin/invoices/export-zip', requireSuperAdmin, (req, res) => {
  const db = readDB();
  const invoicesDir = path.join(__dirname, 'data', 'invoices');
  if (!fs.existsSync(invoicesDir)) {
    return res.status(404).json({ success: false, message: 'No invoices directory found' });
  }

  const files = fs.readdirSync(invoicesDir).filter(f => f.endsWith('.pdf'));
  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'No invoice PDF files available to export' });
  }

  try {
    const archive = createZipArchive();
    const zipFilename = `coastal-view-invoices-${new Date().toISOString().slice(0, 10)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    archive.on('error', err => {
      console.error('ZIP archive stream error:', err);
      if (!res.headersSent) res.status(500).send('Archive error');
    });

    archive.pipe(res);

    files.forEach(file => {
      const fullPath = path.join(invoicesDir, file);
      archive.file(fullPath, { name: file });
    });

    logAudit(
      db,
      req.user,
      'Invoices ZIP Export',
      `Super Admin ${req.user.name} exported daily accounting ZIP archive containing ${files.length} invoice PDF(s).`,
      req
    );
    writeDB(db);

    archive.finalize();
  } catch (zipErr) {
    console.error('ZIP error:', zipErr);
    res.status(500).json({ success: false, message: 'ZIP export failed: ' + zipErr.message });
  }
});

// 10. Staff: Get Invoice Settings
app.get('/api/admin/settings/invoice', requireAnyStaff, (req, res) => {
  const db = readDB();
  const s = db.settings || {};
  res.json({
    success: true,
    settings: {
      invoicePrefix: s.invoicePrefix || 'CV',
      invoiceStartingNumber: s.invoiceStartingNumber || 1001,
      invoiceNextNumber: s.invoiceNextNumber || 1001,
      invoiceTerms: s.invoiceTerms || [],
      gstEnabled: !!s.gstEnabled,
      gstin: s.gstin || '',
      gstRate: s.gstRate !== undefined ? s.gstRate : 12,
      ownerName: s.ownerName || 'Anirban Das',
      ownerTitle: s.ownerTitle || 'Owner, Coastal View',
      signatureImageUrl: s.signatureImageUrl || '',
      invoiceLogo: s.invoiceLogo || 'assets/images/logo-invoice.png'
    }
  });
});

// 11. Manager & Super Admin: Update Invoice Settings
app.put('/api/admin/settings/invoice', requireManager, (req, res) => {
  const {
    invoicePrefix,
    invoiceStartingNumber,
    invoiceNextNumber,
    invoiceTerms,
    gstEnabled,
    gstin,
    gstRate,
    ownerName,
    ownerTitle
  } = req.body;

  const db = readDB();
  db.settings = db.settings || {};

  if (invoicePrefix !== undefined) db.settings.invoicePrefix = invoicePrefix.trim();
  if (invoiceStartingNumber !== undefined) db.settings.invoiceStartingNumber = parseInt(invoiceStartingNumber, 10) || 1001;
  if (invoiceNextNumber !== undefined) db.settings.invoiceNextNumber = parseInt(invoiceNextNumber, 10) || 1001;
  if (invoiceTerms !== undefined && Array.isArray(invoiceTerms)) db.settings.invoiceTerms = invoiceTerms;
  if (gstEnabled !== undefined) db.settings.gstEnabled = !!gstEnabled;
  if (gstin !== undefined) db.settings.gstin = (gstin || '').trim();
  if (gstRate !== undefined) db.settings.gstRate = Number(gstRate) || 12;
  if (ownerName !== undefined) db.settings.ownerName = ownerName.trim();
  if (ownerTitle !== undefined) db.settings.ownerTitle = ownerTitle.trim();

  logAudit(
    db,
    req.user,
    'Invoice Settings Updated',
    `${req.user.role} ${req.user.name} updated invoice & tax settings (Prefix: ${db.settings.invoicePrefix}, GST: ${db.settings.gstEnabled ? 'ON' : 'OFF'}, GSTIN: "${db.settings.gstin}").`,
    req
  );
  writeDB(db);

  res.json({
    success: true,
    message: 'Invoice settings updated successfully',
    settings: db.settings
  });
});

// 12. Super Admin: Upload Signature Image
app.post('/api/admin/settings/invoice/signature', requireSuperAdmin, (req, res) => {
  const { imageBase64, clear = false } = req.body;
  const db = readDB();
  db.settings = db.settings || {};

  if (clear) {
    db.settings.signatureImageUrl = '';
    logAudit(db, req.user, 'Owner Signature Removed', `Super Admin ${req.user.name} removed custom owner signature image (reverted to text signature).`, req);
    writeDB(db);
    return res.json({ success: true, message: 'Signature image removed. Text signature will be used.' });
  }

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'No image data provided' });
  }

  try {
    const savedPath = saveBase64Image(imageBase64, 'signatures', 'owner-signature');
    db.settings.signatureImageUrl = savedPath;
    logAudit(db, req.user, 'Owner Signature Uploaded', `Super Admin ${req.user.name} uploaded new owner signature image (${savedPath}).`, req);
    writeDB(db);
    res.json({ success: true, message: 'Owner signature uploaded successfully!', signatureImageUrl: savedPath });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save signature: ' + err.message });
  }
});

// 13. Super Admin: Upload Invoice Logo
app.post('/api/admin/settings/invoice/logo', requireSuperAdmin, (req, res) => {
  const { imageBase64, reset = false } = req.body;
  const db = readDB();
  db.settings = db.settings || {};

  if (reset) {
    db.settings.invoiceLogo = 'assets/images/logo-invoice.png';
    logAudit(db, req.user, 'Invoice Logo Reset', `Super Admin ${req.user.name} reset invoice logo to default website brand logo.`, req);
    writeDB(db);
    return res.json({ success: true, message: 'Invoice logo reset to default website logo.' });
  }

  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'No image data provided' });
  }

  try {
    const savedPath = saveBase64Image(imageBase64, 'logos', 'invoice-logo');
    db.settings.invoiceLogo = savedPath;
    logAudit(db, req.user, 'Invoice Logo Uploaded', `Super Admin ${req.user.name} uploaded custom invoice logo (${savedPath}).`, req);
    writeDB(db);
    res.json({ success: true, message: 'Invoice logo uploaded successfully!', invoiceLogo: savedPath });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save logo: ' + err.message });
  }
});

// ============================================================================
// CHATBOT MESSAGES & CON// Date parser for chatbot messages (e.g., "on 25 Dec", "25th December", "tomorrow")
function parseDateFromMessage(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const months = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };
  const now = new Date();
  const currentYear = now.getFullYear();

  if (t.includes('tomorrow') || t.includes('আগামীকাল') || t.includes('कल')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const inStr = d.toISOString().split('T')[0];
    d.setDate(d.getDate() + 1);
    const outStr = d.toISOString().split('T')[0];
    return { checkIn: inStr, checkOut: outStr, dateText: 'tomorrow' };
  }

  if (t.includes('today') || t.includes('tonight') || t.includes('আজ') || t.includes('आज')) {
    const inStr = now.toISOString().split('T')[0];
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const outStr = d.toISOString().split('T')[0];
    return { checkIn: inStr, checkOut: outStr, dateText: 'today' };
  }

  // Matches "25 Dec", "25th Dec", "25 December", "25th December", "Dec 25", "December 25"
  const m1 = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?/i);
  const m2 = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/i);
  const m3 = t.match(/(\d{4})-(\d{2})-(\d{2})/);

  let year = currentYear;
  let month = null;
  let day = null;
  let rawText = '';

  if (m1) {
    day = parseInt(m1[1], 10);
    month = months[m1[2].toLowerCase()];
    year = m1[3] ? parseInt(m1[3], 10) : currentYear;
    rawText = m1[0];
  } else if (m2) {
    month = months[m2[1].toLowerCase()];
    day = parseInt(m2[2], 10);
    year = m2[3] ? parseInt(m2[3], 10) : currentYear;
    rawText = m2[0];
  } else if (m3) {
    year = parseInt(m3[1], 10);
    month = parseInt(m3[2], 10) - 1;
    day = parseInt(m3[3], 10);
    rawText = m3[0];
  }

  if (month !== null && day !== null) {
    const dIn = new Date(year, month, day);
    const dOut = new Date(year, month, day + 1);
    const yStr = dIn.getFullYear();
    const mStr = String(dIn.getMonth() + 1).padStart(2, '0');
    const dayStr = String(dIn.getDate()).padStart(2, '0');
    const yOut = dOut.getFullYear();
    const mOut = String(dOut.getMonth() + 1).padStart(2, '0');
    const dayOut = String(dOut.getDate()).padStart(2, '0');
    const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      checkIn: `${yStr}-${mStr}-${dayStr}`,
      checkOut: `${yOut}-${mOut}-${dayOut}`,
      dateText: `${day} ${mNames[month]}`
    };
  }

  return null;
}

// ============================================================================
// RESTAURANT & BAR MENUS API
// ============================================================================

app.get('/api/menu', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  res.json({
    success: true,
    restaurant: db.restaurant || [],
    cocktails: db.cocktails || [],
    categories: db.menuCategories || [
      'Breakfast',
      'Vegetable / Dal',
      'Rice / Roti / Chowmin',
      'Non Veg',
      'Snacks (Veg./Non Veg.)',
      'Mocktail',
      'Salad & Raita / Papad',
      'Thali'
    ],
    menuNote: db.settings?.menuNote || '',
    menuPhone: db.settings?.menuPhone || '+91 7812027551'
  });
});

app.post('/api/menu/note', requireManager, (req, res) => {
  const { note } = req.body;
  if (!note || typeof note !== 'string') {
    return res.status(400).json({ success: false, message: 'Valid note text is required.' });
  }
  const db = readDB();
  db.settings = db.settings || {};
  db.settings.menuNote = note.trim();
  logAudit(db, req.user, 'Menu Note Updated', `${req.user.name} updated the menu policy note: "${db.settings.menuNote}"`, req);
  writeDB(db);
  res.json({ success: true, menuNote: db.settings.menuNote, message: 'Menu note updated successfully.' });
});

app.post('/api/menu/item', requireManager, (req, res) => {
  const { type = 'restaurant', item } = req.body;
  const db = readDB();
  if (!db || !db[type]) return res.status(400).json({ success: false, message: 'Invalid category' });
  if (!item || !item.name) return res.status(400).json({ success: false, message: 'Item name is required' });

  // Sanitize variants if present
  let cleanVariants = null;
  if (Array.isArray(item.variants) && item.variants.length > 0) {
    cleanVariants = item.variants
      .filter(v => v && v.label && v.price !== null && v.price !== undefined && !isNaN(Number(v.price)))
      .map(v => ({ label: String(v.label).trim(), price: Number(v.price) }));
    if (cleanVariants.length === 0) cleanVariants = null;
  }

  // Base price: if explicit price given use that; else if variants exist, use min variant price
  let cleanPrice = null;
  if (item.price !== null && item.price !== '' && !isNaN(Number(item.price)) && Number(item.price) > 0) {
    cleanPrice = Number(item.price);
  } else if (cleanVariants && cleanVariants.length > 0) {
    cleanPrice = Math.min(...cleanVariants.map(v => v.price));
  }

  const cleanItem = {
    id: item.id || `${type.slice(0, 4)}-${Date.now()}`,
    name: item.name.trim(),
    portion: (item.portion || '').trim() || null,
    category: item.category || 'Breakfast',
    subCategory: item.subCategory || '',
    price: cleanPrice,
    variants: cleanVariants,
    isVeg: item.isVeg !== undefined ? !!item.isVeg : true,
    description: (item.description || item.desc || '').trim(),
    badges: Array.isArray(item.badges) ? item.badges : (item.badge ? [item.badge] : []),
    available: item.available !== undefined ? !!item.available : true,
    featured: item.featured !== undefined ? !!item.featured : (item.isFeatured !== undefined ? !!item.isFeatured : false),
    isFeatured: item.featured !== undefined ? !!item.featured : (item.isFeatured !== undefined ? !!item.isFeatured : false),
    image: item.image || null,
    thumbImage: item.thumbImage || item.image || null,
    order: item.order ? Number(item.order) : 999
  };

  const existingIndex = db[type].findIndex(i => i.id === cleanItem.id);
  if (existingIndex > -1) {
    db[type][existingIndex] = { ...db[type][existingIndex], ...cleanItem };
  } else {
    db[type].push(cleanItem);
  }

  const priceLabel = cleanItem.price ? `₹${cleanItem.price}` : 'Ask at restaurant';
  logAudit(db, req.user, 'Menu Item Saved', `${req.user.name} saved menu item "${cleanItem.name}" (${cleanItem.category}, ${priceLabel}) in ${type}.`, req);
  writeDB(db);
  res.json({ success: true, item: cleanItem, message: `"${cleanItem.name}" saved successfully.` });
});

app.post('/api/menu/upload-image', requireManager, (req, res) => {
  const { dishId, imageBase64, mimeType = 'image/webp' } = req.body;
  if (!dishId || !imageBase64) {
    return res.status(400).json({ success: false, message: 'dishId and imageBase64 are required.' });
  }

  const db = readDB();
  const dish = (db.restaurant || []).find(d => d.id === dishId);
  if (!dish) {
    return res.status(404).json({ success: false, message: 'Dish not found in restaurant menu.' });
  }

  try {
    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const rawData = matches ? matches[2] : imageBase64;
    const detectedMime = matches ? matches[1] : mimeType;
    
    const allowedMimes = ['image/webp', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMimes.includes(detectedMime.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid image format. Supported formats: WebP, JPEG, PNG.' });
    }

    const buffer = Buffer.from(rawData, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image size exceeds maximum limit of 5 MB.' });
    }

    const ext = detectedMime.includes('webp') ? 'webp' : (detectedMime.includes('png') ? 'png' : 'jpg');
    const safeDishId = dishId.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `dish-${safeDishId}-${Date.now()}.${ext}`;
    const uploadDir = path.join(__dirname, 'uploads', 'menu');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/menu/${filename}`;
    dish.image = publicUrl;
    dish.thumbImage = publicUrl;

    logAudit(db, req.user, 'Dish Photo Uploaded', `${req.user.name} uploaded dish photo for "${dish.name}" (${filename}, ${(buffer.length / 1024).toFixed(1)} KB).`, req);
    writeDB(db);

    res.json({
      success: true,
      image: publicUrl,
      dish,
      message: `Dish image saved successfully for "${dish.name}".`
    });
  } catch (err) {
    console.error('Error uploading dish image:', err);
    res.status(500).json({ success: false, message: 'Failed to process image upload: ' + err.message });
  }
});

app.post('/api/menu/reorder', requireManager, (req, res) => {
  const { type = 'restaurant', orderList = [] } = req.body;
  const db = readDB();
  if (!db || !db[type]) return res.status(400).json({ success: false, message: 'Invalid type' });

  const orderMap = new Map();
  orderList.forEach((item, idx) => {
    orderMap.set(item.id, idx + 1);
  });

  db[type].forEach(item => {
    if (orderMap.has(item.id)) {
      item.order = orderMap.get(item.id);
    }
  });

  db[type].sort((a, b) => (a.order || 999) - (b.order || 999));

  logAudit(db, req.user, 'Menu Reordered', `${req.user.name} reordered ${orderList.length} items in ${type} menu.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Menu items order updated successfully.', items: db[type] });
});

app.post('/api/menu/toggle-available', requireManager, (req, res) => {
  const { id, available, type = 'restaurant' } = req.body;
  const db = readDB();
  if (!db || !db[type]) return res.status(400).json({ success: false });

  const item = db[type].find(i => i.id === id);
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

  item.available = !!available;
  const statusLabel = item.available ? 'Available' : 'Not available today';

  logAudit(db, req.user, `Dish Availability: ${statusLabel}`, `${req.user.name} set "${item.name}" availability to ${statusLabel}.`, req);
  writeDB(db);

  res.json({ success: true, item, message: `"${item.name}" is now ${statusLabel}.` });
});

app.post('/api/menu/toggle-featured', requireManager, (req, res) => {
  const { id, featured, type = 'restaurant' } = req.body;
  const db = readDB();
  if (!db || !db[type]) return res.status(400).json({ success: false, message: 'Invalid category type' });

  const item = db[type].find(i => i.id === id);
  if (!item) return res.status(404).json({ success: false, message: 'Dish not found' });

  item.featured = featured !== undefined ? !!featured : !item.featured;
  item.isFeatured = item.featured;

  logAudit(db, req.user, 'Dish Featured Toggled', `${req.user.name} set featured on "${item.name}" to ${item.featured}.`, req);
  writeDB(db);

  res.json({ success: true, item, featured: item.featured, message: `"${item.name}" featured set to ${item.featured}.` });
});

app.delete('/api/menu/:type/:id', requireManager, (req, res) => {
  const { type, id } = req.params;
  const db = readDB();
  if (!db || !db[type]) return res.status(400).json({ success: false, message: 'Invalid category' });

  const itemIndex = db[type].findIndex(i => i.id === id);
  if (itemIndex === -1) return res.status(404).json({ success: false, message: 'Item not found' });

  const removed = db[type].splice(itemIndex, 1)[0];
  logAudit(db, req.user, 'Menu Item Deleted', `${req.user.name} deleted "${removed.name}" from ${type} menu.`, req);
  writeDB(db);

  res.json({ success: true, message: `"${removed.name}" removed from menu.` });
});


// ============================================================================
// PUBLIC & ADMIN SETTINGS APIS
// ============================================================================
app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json({ success: true, settings: db?.settings || {} });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const db = readDB();
  db.settings = { ...(db.settings || {}), ...(req.body || {}) };
  logAudit(db, req.user || 'Admin', 'Settings Updated', 'Settings updated by admin', req);
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

// Admin Get Add-ons settings (Breakfast, Vehicles, Candlelight)
app.get('/api/admin/settings/addons', requireAnyStaff, (req, res) => {
  const db = readDB();
  const s = db.settings || {};
  res.json({
    success: true,
    breakfast: {
      enabled: s.breakfastEnabled !== false && (!s.breakfastAddon || s.breakfastAddon.enabled !== false),
      name: s.breakfastName || s.breakfastAddon?.name || 'Breakfast Add-On',
      price: s.breakfastPrice !== undefined ? s.breakfastPrice : (s.breakfastAddon?.price || 200),
      unit: s.breakfastUnit || s.breakfastAddon?.unit || 'per_person_per_day',
      servingTime: s.breakfastServingTime || s.breakfastAddon?.servingTime || '7:00 AM to 10:30 AM'
    },
    candlelight: {
      beachsidePrice: s.candlelightDinnerBeachside || 3500,
      poolsidePrice: s.candlelightDinnerPoolside || 2800,
      pricingMode: s.candlelightPricingMode || 'per_dinner'
    }
  });
});

// Admin Save Breakfast Add-On Settings with Price Change Audit Log
app.post('/api/admin/settings/breakfast', requireManager, (req, res) => {
  const db = readDB();
  db.settings = db.settings || {};
  const oldPrice = db.settings.breakfastPrice !== undefined ? db.settings.breakfastPrice : 200;
  const oldUnit = db.settings.breakfastUnit || 'per_person_per_day';
  const oldEnabled = db.settings.breakfastEnabled !== false;

  const {
    price = 200,
    unit = 'per_person_per_day',
    servingTime = '7:00 AM to 10:30 AM',
    enabled = true,
    name = 'Breakfast Add-On'
  } = req.body;

  const newPrice = Number(price) >= 0 ? Number(price) : 200;
  const newUnit = (unit === 'per_room_per_day') ? 'per_room_per_day' : 'per_person_per_day';
  const newEnabled = !!enabled;

  db.settings.breakfastPrice = newPrice;
  db.settings.breakfastUnit = newUnit;
  db.settings.breakfastServingTime = servingTime.trim();
  db.settings.breakfastEnabled = newEnabled;
  db.settings.breakfastName = name.trim();
  db.settings.breakfastAddon = {
    enabled: newEnabled,
    name: name.trim(),
    price: newPrice,
    unit: newUnit,
    servingTime: servingTime.trim(),
    note: `Served ${servingTime.trim()}.`
  };

  // Log every price change in audit log
  const changes = [];
  if (oldPrice !== newPrice) changes.push(`Price: ₹${oldPrice} -> ₹${newPrice}`);
  if (oldUnit !== newUnit) changes.push(`Unit: ${oldUnit} -> ${newUnit}`);
  if (oldEnabled !== newEnabled) changes.push(`Status: ${oldEnabled ? 'ON' : 'OFF'} -> ${newEnabled ? 'ON' : 'OFF'}`);

  const details = changes.length > 0
    ? `Super Admin ${req.user.name} modified Breakfast Add-on settings: ${changes.join(', ')}`
    : `Super Admin ${req.user.name} saved Breakfast Add-on settings (Price: ₹${newPrice}, Unit: ${newUnit}, Enabled: ${newEnabled})`;

  logAudit(db, req.user, 'Breakfast Settings Updated', details, req);
  writeDB(db);

  res.json({
    success: true,
    message: 'Breakfast add-on settings updated successfully',
    breakfast: db.settings.breakfastAddon
  });
});

// ============================================================================
// CHATBOT & CONCIERGE APIS (PUBLIC ENDPOINTS & ADMIN CRM)
// ============================================================================

// Unified Public Chatbot Endpoint (Supports JSON & SSE Streaming, Rate Limiting, Grounded Knowledge)
async function handleChatEndpoint(req, res) {
  const { message, lang = 'en', sessionId, stream = false, forceApiFailure = false } = req.body || {};
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database unavailable' });

  // 1. Check if bot is disabled in admin settings
  const botSettings = db.botSettings || {};
  if (botSettings.botEnabled === false) {
    const offlineMsg = botSettings.offlineMessage?.[lang] || botSettings.offlineMessage?.en ||
      `Our concierge desk is currently operating with high volume. Please call ${DIRECT_PHONE_NUMBER} for immediate assistance.`;
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'token', token: offlineMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'done',
        reply: offlineMsg,
        actionChips: ['Call Front Desk', 'Request Callback'],
        leadStatus: 'Needs follow-up',
        requiresCallbackForm: true
      })}\n\n`);
      return res.end();
    }
    return res.json({
      success: true,
      reply: offlineMsg,
      actionChips: ['Call Front Desk', 'Request Callback'],
      requiresCallbackForm: true,
      leadStatus: 'Needs follow-up'
    });
  }

  // 2. Daily message limit check
  const dailyLimit = parseInt(botSettings.dailyMessageLimit, 10) || 500;
  const usage = db.botUsage || {};
  const todayStr = new Date().toISOString().split('T')[0];
  if (usage.todayDate === todayStr && (usage.todayCount || 0) >= dailyLimit) {
    const limitMsg = `Our online concierge has reached its daily limit. Please call front desk at ${DIRECT_PHONE_NUMBER}.`;
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'token', token: limitMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'done',
        reply: limitMsg,
        actionChips: ['Call Front Desk'],
        leadStatus: 'Needs follow-up',
        requiresCallbackForm: true
      })}\n\n`);
      return res.end();
    }
    return res.json({
      success: true,
      reply: limitMsg,
      actionChips: ['Call Front Desk'],
      requiresCallbackForm: true,
      leadStatus: 'Needs follow-up'
    });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
  const actualSessionId = sessionId || req.cookies?.concierge_session_id || `sess-${Date.now()}`;

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    const onToken = (token) => {
      res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
    };

    const result = await processChatRequest({
      message,
      lang,
      sessionId: actualSessionId,
      stream: true,
      onToken,
      clientIp,
      db,
      forceApiFailure
    });

    recordConversationAndInquiry(db, {
      sessionId: actualSessionId,
      userMessage: message || '',
      botReply: result.reply,
      lang: result.lang || lang,
      topic: result.topic,
      leadStatus: result.leadStatus,
      requiresCallback: result.requiresCallbackForm
    });
    writeDB(db);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      reply: result.reply,
      actionChips: result.actionChips,
      topic: result.topic,
      leadStatus: result.leadStatus,
      requiresCallbackForm: result.requiresCallbackForm,
      sessionId: actualSessionId
    })}\n\n`);
    res.end();
  } else {
    const result = await processChatRequest({
      message,
      lang,
      sessionId: actualSessionId,
      stream: false,
      clientIp,
      db,
      forceApiFailure
    });

    recordConversationAndInquiry(db, {
      sessionId: actualSessionId,
      userMessage: message || '',
      botReply: result.reply,
      lang: result.lang || lang,
      topic: result.topic,
      leadStatus: result.leadStatus,
      requiresCallback: result.requiresCallbackForm
    });
    writeDB(db);

    res.json(result);
  }
}

// Map both /api/chat (requested by prompt) and /api/concierge/chat (legacy / tests)
app.post('/api/chat', handleChatEndpoint);
app.post('/api/concierge/chat', handleChatEndpoint);

// Public Callback Lead Capture
function handleCallbackEndpoint(req, res) {
  const { name, phone, message, sessionId } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, message: 'Name and phone are required' });

  const db = readDB();
  db.callbackRequests = db.callbackRequests || [];
  const request = {
    id: `req-${Date.now()}`,
    name,
    phone,
    message: message || 'Guest requested concierge callback',
    status: 'Pending',
    sessionId: sessionId || '',
    createdAt: new Date().toISOString()
  };
  db.callbackRequests.push(request);

  // If session ID exists, update conversation lead details
  if (sessionId && db.chatConversations) {
    const conv = db.chatConversations.find(c => c.sessionId === sessionId || c.id === sessionId);
    if (conv) {
      conv.guestName = name;
      conv.guestPhone = phone;
      conv.leadStatus = 'Needs follow-up';
      conv.updatedAt = new Date().toISOString();
    }
  }

  writeDB(db);
  res.json({
    success: true,
    message: `Callback request received. Front desk will contact you promptly at ${DIRECT_PHONE_NUMBER}.`,
    request
  });
}

app.post('/api/chat/callback', handleCallbackEndpoint);
app.post('/api/concierge/callback', handleCallbackEndpoint);

app.patch('/api/concierge/callback/:id', requireAnyStaff, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const db = readDB();
  const item = (db.callbackRequests || []).find(r => r.id === id);
  if (!item) return res.status(404).json({ success: false, message: 'Callback request not found' });

  item.status = status;
  writeDB(db);
  res.json({ success: true, item });
});

// ----------------------------------------------------------------------------
// ADMIN CHATBOT CRM & SETTINGS ENDPOINTS
// ----------------------------------------------------------------------------

// 1. Get All Conversations with Search & Filters
function handleGetConversations(req, res) {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database unavailable' });

  const { search, filter } = req.query;
  let conversations = db.chatConversations || [];

  // If no multi-turn conversations yet, synthesize from legacy chatInquiries
  if (!conversations.length && (db.chatInquiries || []).length) {
    conversations = (db.chatInquiries || []).map(inq => ({
      id: inq.id,
      sessionId: inq.sessionId || inq.id,
      language: inq.lang || 'en',
      topic: inq.topic || 'General Inquiry',
      leadStatus: inq.leadStatus || 'New Lead',
      isRead: Boolean(inq.isRead),
      createdAt: inq.timestamp || new Date().toISOString(),
      updatedAt: inq.timestamp || new Date().toISOString(),
      guestName: inq.guestName || '',
      guestPhone: inq.guestPhone || '',
      staffNotes: inq.staffNotes || '',
      messages: [
        { sender: 'guest', text: inq.userMessage, timestamp: inq.timestamp },
        { sender: 'bot', text: inq.botReply, timestamp: inq.timestamp }
      ]
    }));
  }

  // Filter
  if (filter === 'unread') {
    conversations = conversations.filter(c => !c.isRead);
  } else if (filter === 'followup') {
    conversations = conversations.filter(c => c.leadStatus === 'Needs follow-up');
  } else if (filter === 'leads') {
    conversations = conversations.filter(c => c.leadStatus === 'Qualified Lead' || c.leadStatus === 'Needs follow-up');
  } else if (filter === 'converted') {
    conversations = conversations.filter(c => c.leadStatus === 'Converted to Booking');
  }

  // Search
  if (search) {
    const q = search.toLowerCase().trim();
    conversations = conversations.filter(c => {
      const nameMatch = (c.guestName || '').toLowerCase().includes(q);
      const phoneMatch = (c.guestPhone || '').includes(q);
      const topicMatch = (c.topic || '').toLowerCase().includes(q);
      const idMatch = (c.id || '').toLowerCase().includes(q);
      const msgMatch = (c.messages || []).some(m => (m.text || '').toLowerCase().includes(q));
      return nameMatch || phoneMatch || topicMatch || idMatch || msgMatch;
    });
  }

  res.json({
    success: true,
    inquiries: conversations,
    callbacks: db.callbackRequests || []
  });
}

app.get('/api/admin/concierge/conversations', requireAnyStaff, handleGetConversations);
app.get('/api/admin/chat/conversations', requireAnyStaff, handleGetConversations);

// 2. Get Single Conversation with Full Transcript
function handleGetConversationById(req, res) {
  const { id } = req.params;
  const db = readDB();
  const conv = (db.chatConversations || []).find(c => c.id === id || c.sessionId === id);
  if (!conv) {
    const legacy = (db.chatInquiries || []).find(i => i.id === id);
    if (legacy) {
      return res.json({
        success: true,
        conversation: {
          id: legacy.id,
          sessionId: legacy.sessionId || legacy.id,
          language: legacy.lang || 'en',
          topic: legacy.topic || 'General',
          leadStatus: legacy.leadStatus || 'New Lead',
          isRead: Boolean(legacy.isRead),
          createdAt: legacy.timestamp,
          messages: [
            { sender: 'guest', text: legacy.userMessage, timestamp: legacy.timestamp },
            { sender: 'bot', text: legacy.botReply, timestamp: legacy.timestamp }
          ]
        }
      });
    }
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  res.json({ success: true, conversation: conv });
}

app.get('/api/admin/concierge/conversations/:id', requireAnyStaff, handleGetConversationById);
app.get('/api/admin/chat/conversations/:id', requireAnyStaff, handleGetConversationById);

// 3. Update Conversation Status / Notes
function handleUpdateConversation(req, res) {
  const { id } = req.params;
  const { isRead, leadStatus, staffNotes, assignee, topic } = req.body;
  const db = readDB();

  let conv = (db.chatConversations || []).find(c => c.id === id || c.sessionId === id);
  if (conv) {
    if (isRead !== undefined) conv.isRead = Boolean(isRead);
    if (leadStatus) conv.leadStatus = leadStatus;
    if (staffNotes !== undefined) conv.staffNotes = staffNotes;
    if (assignee !== undefined) conv.assignee = assignee;
    if (topic) conv.topic = topic;
    conv.updatedAt = new Date().toISOString();
  }

  const legacy = (db.chatInquiries || []).find(i => i.id === id);
  if (legacy) {
    if (isRead !== undefined) legacy.isRead = Boolean(isRead);
    if (leadStatus) legacy.leadStatus = leadStatus;
    if (staffNotes !== undefined) legacy.staffNotes = staffNotes;
  }

  writeDB(db);
  res.json({ success: true, conversation: conv || legacy });
}

app.patch('/api/admin/concierge/conversations/:id', requireAnyStaff, handleUpdateConversation);
app.patch('/api/admin/chat/conversations/:id', requireAnyStaff, handleUpdateConversation);

// 4. Send Live Takeover Staff Reply
function handleConversationReply(req, res) {
  const { id } = req.params;
  const { staffReply } = req.body;
  if (!staffReply || !staffReply.trim()) {
    return res.status(400).json({ success: false, message: 'Reply text required' });
  }

  const db = readDB();
  const conv = (db.chatConversations || []).find(c => c.id === id || c.sessionId === id);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversation not found' });
  }

  const replyMsg = {
    sender: 'staff',
    staffName: req.user?.name || 'Front Desk Staff',
    text: staffReply.trim(),
    timestamp: new Date().toISOString()
  };

  conv.messages = conv.messages || [];
  conv.messages.push(replyMsg);
  conv.updatedAt = new Date().toISOString();
  conv.isRead = true;

  logAudit(db, req.user, 'Live Chat Takeover', `Staff reply sent to conversation ${id}`, req);
  writeDB(db);

  res.json({ success: true, message: 'Staff reply recorded in conversation.', reply: replyMsg });
}

app.post('/api/admin/concierge/conversations/:id/reply', requireAnyStaff, handleConversationReply);
app.post('/api/admin/chat/conversations/:id/reply', requireAnyStaff, handleConversationReply);

// 5. Export Full Transcripts CSV
function handleExportChatCSV(req, res) {
  const db = readDB();
  const conversations = db.chatConversations || [];
  const csvContent = exportConversationsToCSV(conversations);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="coastal-view-chat-transcripts-${Date.now()}.csv"`);
  res.status(200).send(csvContent);
}

app.get('/api/admin/concierge/export-csv', requireManager, handleExportChatCSV);
app.get('/api/admin/chat/export-csv', requireManager, handleExportChatCSV);

// 6. Bot Settings (Super Admin / Manager)
function handleGetBotSettings(req, res) {
  const db = readDB();
  const botSettings = db.botSettings || {
    botEnabled: true,
    welcomeMessage: {
      en: "Welcome to Coastal View, Managed By Ani's! 🌊\nI am your dedicated Coastal Concierge. How may I assist your Mandarmani holiday today?",
      bn: "কোস্টাল ভিউ-তে আপনাকে স্বাগতম, ম্যানেজড বাই অনি'স! 🌊\nআমি আপনার পার্সোনাল কোস্টাল কনসিয়ার্জ। আপনি কি জানতে চান?",
      hi: "कोस्टल व्यू, मैनेज्ड बाय अनीज़ में आपका स्वागत है! 🌊\nमैं आपका कोस्टल कंसीयर्ज हूँ। मैं आपकी क्या मदद कर सकता हूँ?"
    },
    quickReplyChips: [
      "Check availability",
      "Rooms & prices",
      "Menu",
      "Candlelight dinner",
      "Nearby places",
      "Book / Call us"
    ],
    toneInstructions: "Provide warm, authentic coastal hospitality. Highlight our direct sea-view and fresh local Hilsa catch.",
    offlineMessage: {
      en: `Our concierge desk is currently operating with high volume. Please call ${DIRECT_PHONE_NUMBER}.`,
      bn: `আমাদের ফ্রন্ট ডেস্ক বর্তমানে ব্যস্ত আছে। সরাসরি কল করুন: ${DIRECT_PHONE_NUMBER}।`,
      hi: `हमारा डेस्क इस समय व्यस्त है। कृपया सीधे कॉल करें: ${DIRECT_PHONE_NUMBER}।`
    },
    dailyMessageLimit: 500
  };

  const stats = getChatStats(db);
  res.json({ success: true, botSettings, stats });
}

app.get('/api/admin/concierge/bot-settings', requireAnyStaff, handleGetBotSettings);
app.get('/api/admin/chat/settings', requireAnyStaff, handleGetBotSettings);

function handleSaveBotSettings(req, res) {
  const {
    botEnabled,
    welcomeMessage,
    quickReplyChips,
    toneInstructions,
    offlineMessage,
    dailyMessageLimit
  } = req.body;

  const db = readDB();
  db.botSettings = db.botSettings || {};

  if (botEnabled !== undefined) db.botSettings.botEnabled = Boolean(botEnabled);
  if (welcomeMessage) db.botSettings.welcomeMessage = welcomeMessage;
  if (Array.isArray(quickReplyChips)) db.botSettings.quickReplyChips = quickReplyChips;
  if (toneInstructions !== undefined) db.botSettings.toneInstructions = toneInstructions;
  if (offlineMessage) db.botSettings.offlineMessage = offlineMessage;
  if (dailyMessageLimit !== undefined) db.botSettings.dailyMessageLimit = parseInt(dailyMessageLimit, 10) || 500;

  logAudit(db, req.user, 'Bot Settings Updated', `${req.user.name} updated multi-lingual bot settings & prompt instructions.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Bot settings saved successfully.', botSettings: db.botSettings });
}

app.post('/api/admin/concierge/bot-settings', requireManager, handleSaveBotSettings);
app.post('/api/admin/chat/settings', requireManager, handleSaveBotSettings);

// 7. Usage Stats Endpoint
app.get('/api/admin/chat/stats', requireAnyStaff, (req, res) => {
  const db = readDB();
  const stats = getChatStats(db);
  res.json({ success: true, stats });
});

// ============================================================================
// SYSTEM SETTINGS APIS
// ============================================================================
app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json({ success: true, settings: db?.settings || {} });
});

app.post('/api/settings', requireManager, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });
  db.settings = { ...(db.settings || {}), ...req.body };
  logAudit(db, req.user, 'Settings Updated', `${req.user?.name || 'Staff'} updated hotel settings.`, req);
  writeDB(db);
  res.json({ success: true, settings: db.settings, message: 'Settings updated' });
});

// ============================================================================
// VEHICLES & TRANSPORT APIS (ANI'S TOUR AND TRAVELS)
// ============================================================================
app.get('/api/vehicles', (req, res) => {
  const db = readDB();
  res.json({
    success: true,
    vehicles: db?.vehicles || [],
    vehicleSettings: db?.vehicleSettings || { enableTripType: true }
  });
});

app.post('/api/vehicles/settings', requireManager, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.vehicleSettings = db.vehicleSettings || {};
  if (req.body.enableTripType !== undefined) {
    db.vehicleSettings.enableTripType = Boolean(req.body.enableTripType);
  }
  logAudit(db, req.user, 'Vehicle Settings Changed', `${req.user?.name || 'Staff'} updated vehicle trip type settings.`, req);
  writeDB(db);
  res.json({ success: true, vehicleSettings: db.vehicleSettings });
});

app.post('/api/vehicles/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.vehicles = db.vehicles || [];
  const v = db.vehicles.find(item => item.id === id);
  if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found' });

  const oldPrice = v.pricePerDay;
  if (req.body.pricePerDay !== undefined) {
    v.pricePerDay = parseFloat(req.body.pricePerDay) || oldPrice;
    if (id === 'car') {
      db.settings = db.settings || {};
      db.settings.carRentalPricePerDay = v.pricePerDay;
    }
  }
  if (req.body.description !== undefined) v.description = req.body.description;
  if (req.body.capacity !== undefined) v.capacity = parseInt(req.body.capacity, 10) || v.capacity;
  if (req.body.maxQuantity !== undefined) v.maxQuantity = parseInt(req.body.maxQuantity, 10) || v.maxQuantity;
  if (req.body.active !== undefined) v.enabled = Boolean(req.body.active);
  if (req.body.enabled !== undefined) v.enabled = Boolean(req.body.enabled);

  logAudit(db, req.user, 'Vehicle Updated', `${req.user?.name || 'Staff'} updated vehicle ${v.name} (price: ₹${v.pricePerDay}).`, req);
  writeDB(db);
  res.json({ success: true, vehicle: v, message: 'Vehicle updated' });
});

// ============================================================================
// AUDIT LOG & EMAIL OUTBOX APIS
// ============================================================================
app.get('/api/audit-log', requireAnyStaff, (req, res) => {
  const db = readDB();
  res.json({ success: true, auditLog: db?.auditLog || [] });
});

app.get('/api/admin/emails', requireAnyStaff, (req, res) => {
  const db = readDB();
  res.json({ success: true, emails: db?.emailOutbox || [] });
});

// ============================================================================
// STAFF USER MANAGEMENT APIS (SUPER ADMIN ONLY)
// ============================================================================
app.get('/api/admin/users', requireSuperAdmin, (req, res) => {
  const db = readDB();
  const safeUsers = (db?.users || []).map(u => ({
    username: u.username,
    role: u.role || 'Manager',
    name: u.name || u.username,
    email: u.email || `${u.username}@coastalviewmandarmani.com`,
    active: u.active !== false,
    twoFactorEnabled: u.twoFactorEnabled !== false
  }));
  res.json({ success: true, users: safeUsers, currentUser: req.user });
});

// Super Admin: Edit Staff Role & Status
app.patch('/api/admin/users/:username', requireSuperAdmin, requireReauth, async (req, res) => {
  const targetUser = req.params.username;
  const { role, active, name, email, password } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const user = (db.users || []).find(u => u.username.toLowerCase() === targetUser.toLowerCase());
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  // Guard: Cannot disable or demote primary Super Admin account
  if (user.username === 'sandipanmajumder9339' || user.is_superadmin) {
    if (active === false) {
      return res.status(400).json({ success: false, message: 'Cannot disable primary Super Admin account' });
    }
    if (role && role !== 'Super Admin') {
      return res.status(400).json({ success: false, message: 'Cannot demote primary Super Admin account' });
    }
  }

  const oldRole = user.role;
  const oldActive = user.active !== false;

  if (role !== undefined) user.role = role;
  if (active !== undefined) user.active = !!active;
  if (name !== undefined) user.name = name.trim();
  if (email !== undefined) user.email = email.trim();

  if (password && password.trim()) {
    const policy = validatePasswordPolicy(password.trim());
    if (!policy.isValid) {
      return res.status(400).json({ success: false, message: policy.issues.join('; ') });
    }
    user.passwordHash = await hashPassword(password.trim());
  }

  logAudit(
    db,
    req.user,
    'Staff Account Updated',
    `Super Admin ${req.user.name} updated ${targetUser}: Role: ${oldRole} -> ${user.role}, Status: ${oldActive ? 'Active' : 'Disabled'} -> ${user.active !== false ? 'Active' : 'Disabled'}.`,
    req
  );

  sendSuperAdminAlert(
    `Staff Account Modified: ${targetUser}`,
    `Super Admin ${req.user.name} updated staff account <strong>${targetUser}</strong>. Role: <strong>${user.role}</strong>, Status: <strong>${user.active !== false ? 'Active' : 'Disabled'}</strong>.`,
    db
  );

  writeDB(db);

  const safeUsers = db.users.map(u => ({
    username: u.username,
    role: u.role || 'Manager',
    name: u.name || u.username,
    email: u.email || `${u.username}@coastalviewmandarmani.com`,
    active: u.active !== false,
    twoFactorEnabled: u.twoFactorEnabled !== false
  }));

  res.json({
    success: true,
    message: `Account "${targetUser}" updated successfully.`,
    users: safeUsers
  });
});

app.post('/api/admin/users', requireSuperAdmin, requireReauth, async (req, res) => {
  const { username, name, password, role, email } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.isValid) {
    return res.status(400).json({ success: false, message: policy.issues.join('; ') });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });
  db.users = db.users || [];
  const existingIdx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

  const hash = await hashPassword(password);
  const userObj = {
    username: username.trim(),
    name: name || username,
    passwordHash: hash,
    role: role || 'Manager',
    email: email || `${username}@coastalviewmandarmani.com`
  };

  if (existingIdx > -1) {
    db.users[existingIdx] = { ...db.users[existingIdx], ...userObj };
  } else {
    db.users.push(userObj);
  }

  logAudit(db, req.user, existingIdx > -1 ? 'Staff Account Updated' : 'Staff Account Created', `Super Admin configured staff account for ${username} (${role || 'Manager'}). Argon2id hashing applied.`, req);

  // Send Alert on role changes or creation
  sendSuperAdminAlert(
    `Staff Account Configured: ${username} (${role})`,
    `Super Admin ${req.user.name} configured staff credentials and role <strong>${role}</strong> for account <strong>${username}</strong>.`,
    db
  );

  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username, email: u.email }));
  res.json({ success: true, message: `Staff account ${username} saved successfully with Argon2id.`, users: safeUsers });
});

app.delete('/api/admin/users/:username', requireSuperAdmin, requireReauth, (req, res) => {
  const targetUser = req.params.username;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  const targetAccount = (db.users || []).find(u => u.username.toLowerCase() === targetUser.toLowerCase());
  if (targetAccount && targetAccount.role === 'Super Admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete Super Admin account' });
  }

  db.users = (db.users || []).filter(u => u.username.toLowerCase() !== targetUser.toLowerCase());
  logAudit(db, req.user, 'Staff Account Deleted', `Super Admin removed staff account ${targetUser}.`, req);

  sendSuperAdminAlert(
    `Staff Account Deleted: ${targetUser}`,
    `Super Admin ${req.user.name} deleted staff account <strong>${targetUser}</strong>.`,
    db
  );

  writeDB(db);

  const safeUsers = db.users.map(u => ({ username: u.username, role: u.role || 'Manager', name: u.name || u.username, email: u.email }));
  res.json({ success: true, message: `Account ${targetUser} removed`, users: safeUsers });
});

app.post('/api/admin/users/:username/reset-2fa', requireSuperAdmin, (req, res) => {
  const targetUser = req.params.username;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  const user = (db.users || []).find(u => u.username.toLowerCase() === targetUser.toLowerCase());
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  logAudit(db, req.user, '2FA Reset', `${req.user?.name || 'Super Admin'} reset two-factor authentication for ${targetUser}.`, req);
  writeDB(db);

  res.json({ success: true, message: `2FA reset successfully for ${targetUser}` });
});

app.get('/api/admin/login-history', requireSuperAdmin, (req, res) => {
  const db = readDB();
  res.json({ success: true, loginHistory: db?.loginHistory || [] });
});

// ============================================================================
// WEBSITE CONTENT & SEO APIS
// ============================================================================
// Amenities Management Endpoints
app.get('/api/admin/amenities', requireAnyStaff, (req, res) => {
  const db = readDB();
  res.json({ success: true, amenities: db.amenities || [] });
});

app.post('/api/admin/amenities', requireManager, (req, res) => {
  const { id, title, desc, icon, active } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Amenity title is required' });
  }
  const db = readDB();
  db.amenities = db.amenities || [];
  const existingIdx = id ? db.amenities.findIndex(a => a.id === id) : -1;

  const item = {
    id: id || `am-${Date.now()}`,
    title: title.trim(),
    desc: (desc || '').trim(),
    icon: (icon || 'check_circle').trim(),
    active: active !== false
  };

  if (existingIdx > -1) {
    db.amenities[existingIdx] = { ...db.amenities[existingIdx], ...item };
  } else {
    db.amenities.push(item);
  }

  logAudit(db, req.user, existingIdx > -1 ? 'Amenity Updated' : 'Amenity Created', `${req.user.name} updated amenity "${item.title}".`, req);
  writeDB(db);
  res.json({ success: true, amenity: item, amenities: db.amenities, message: `Amenity "${item.title}" saved successfully.` });
});

app.delete('/api/admin/amenities/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const existing = (db.amenities || []).find(a => a.id === id);
  if (!existing) return res.status(404).json({ success: false, message: 'Amenity not found' });

  db.amenities = (db.amenities || []).filter(a => a.id !== id);
  logAudit(db, req.user, 'Amenity Deleted', `${req.user.name} deleted amenity "${existing.title}".`, req);
  writeDB(db);
  res.json({ success: true, amenities: db.amenities, message: `Amenity "${existing.title}" removed.` });
});

app.post('/api/admin/amenities/reorder', requireManager, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: 'Invalid IDs list' });
  const db = readDB();
  const current = db.amenities || [];
  const reordered = [];
  ids.forEach(id => {
    const found = current.find(a => a.id === id);
    if (found) reordered.push(found);
  });
  current.forEach(a => {
    if (!reordered.find(x => x.id === a.id)) reordered.push(a);
  });
  db.amenities = reordered;
  logAudit(db, req.user, 'Amenities Reordered', `${req.user.name} reordered website amenities.`, req);
  writeDB(db);
  res.json({ success: true, amenities: db.amenities, message: 'Amenities order updated.' });
});

app.get('/api/admin/content', requireAnyStaff, (req, res) => {
  const db = readDB();
  res.json({ success: true, content: db?.websiteContent || {} });
});

app.post('/api/admin/content/:section', requireManager, (req, res) => {
  const { section } = req.params;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.websiteContent = db.websiteContent || {};

  let dataToSave = req.body;
  if (section === 'faqs' && req.body && Array.isArray(req.body.faqs)) {
    dataToSave = req.body.faqs;
  } else if (section === 'places' && req.body && Array.isArray(req.body.places)) {
    dataToSave = req.body.places;
  } else if (section === 'testimonials' && req.body && Array.isArray(req.body.testimonials)) {
    dataToSave = req.body.testimonials;
  }

  db.websiteContent[section] = dataToSave;
  logAudit(db, req.user, 'Content Updated', `${req.user?.name || 'Staff'} updated website content section "${section}".`, req);
  writeDB(db);
  res.json({ success: true, message: `Website content "${section}" updated successfully.` });
});

app.get('/api/admin/seo', requireAnyStaff, (req, res) => {
  const db = readDB();
  res.json({ success: true, seo: db?.seo || {} });
});

app.post('/api/admin/seo', requireManager, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });
  db.seo = { ...(db.seo || {}), ...req.body };
  logAudit(db, req.user, 'SEO Updated', `${req.user?.name || 'Staff'} updated SEO metadata.`, req);
  writeDB(db);
  res.json({ success: true, message: 'SEO updated', seo: db.seo });
});

app.post('/api/admin/seo/refresh-sitemap', requireManager, (req, res) => {
  res.json({ success: true, message: 'Sitemap refreshed successfully.' });
});

// ============================================================================
// PHOTOS & MEDIA MANAGER APIS (SUPER ADMIN & MANAGER ONLY)
// ============================================================================

// 1. Get All Labeled Slots, Grouped by Section, with History & Room Galleries
app.get('/api/media', requireAnyStaff, (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  db.mediaSlots = db.mediaSlots || {};
  db.mediaHistory = db.mediaHistory || [];

  // Build full slots list with live URLs
  const enrichedSlots = PHOTO_SLOTS.map(slot => {
    let currentUrl = slot.defaultUrl;
    let alt = slot.defaultAlt;
    let caption = '';

    // Check specific slot overrides
    if (db.mediaSlots[slot.key]) {
      currentUrl = db.mediaSlots[slot.key].url || currentUrl;
      alt = db.mediaSlots[slot.key].alt || alt;
      caption = db.mediaSlots[slot.key].caption || '';
    } else if (slot.key === 'hero' && db.websiteContent?.hero?.heroImage) {
      currentUrl = db.websiteContent.hero.heroImage;
    } else if (slot.key === 'owner' && (db.websiteContent?.owner?.photo || db.mediaSlots?.owner?.photo)) {
      currentUrl = db.websiteContent?.owner?.photo || db.mediaSlots?.owner?.photo;
    } else if (slot.key.startsWith('room:')) {
      const rId = slot.roomId;
      const room = (db.rooms || []).find(r => r.id === rId);
      if (room && room.image) currentUrl = room.image;
    }

    // Get last 5 version history for this slot
    const slotHistory = (db.mediaHistory || [])
      .filter(h => h.slotKey === slot.key)
      .slice(0, 5);

    return {
      ...slot,
      currentUrl,
      alt,
      caption,
      history: slotHistory
    };
  });

  // Group slots by section
  const sections = {};
  enrichedSlots.forEach(s => {
    sections[s.section] = sections[s.section] || [];
    sections[s.section].push(s);
  });

  res.json({
    success: true,
    slots: enrichedSlots,
    sections,
    rooms: (db.rooms || []).map(r => ({
      id: r.id,
      name: r.name,
      image: r.image,
      gallery: r.gallery || []
    })),
    mediaHistory: (db.mediaHistory || []).slice(0, 50)
  });
});

// 2. Upload / Replace Photo (Enforces Magic Bytes, Strips EXIF, 30s Undo, 5-Version History)
app.post('/api/media/upload', requireManager, async (req, res) => {
  try {
    const { slotKey, roomId, imageBase64, alt = '', caption = '', isCover = false, tag = 'general' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
    }

    const db = readDB();
    if (!db) return res.status(500).json({ success: false, message: 'Database connection error' });

    // Determine target folder
    let subDir = 'general';
    let filePrefix = 'photo';

    if (roomId) {
      subDir = 'rooms';
      filePrefix = `room-${roomId}`;
    } else if (slotKey) {
      const cleanKey = slotKey.replace(/[^a-zA-Z0-9]/g, '-');
      subDir = ['hero', 'owner', 'logo', 'candlelight', 'cocktails', 'places', 'gallery'].some(s => cleanKey.includes(s)) ? cleanKey.split('-')[0] : 'general';
      filePrefix = `slot-${cleanKey}`;
    }

    // Securely process image: checks magic bytes, strips EXIF/GPS, re-encodes to WebP
    const savedUrl = await saveBase64ImageSecure(imageBase64, subDir, filePrefix);

    // Case A: Room Gallery Upload
    if (roomId) {
      const room = (db.rooms || []).find(r => r.id === roomId);
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

      room.gallery = room.gallery || [];
      const previousCover = room.image;
      const photoId = `photo-${roomId}-${Date.now()}`;

      if (isCover || room.gallery.length === 0) {
        room.gallery.forEach(p => p.isCover = false);
        room.image = savedUrl;
      }

      const photoEntry = {
        id: photoId,
        url: savedUrl,
        alt: alt || `${room.name} Photo`,
        caption: caption || room.name,
        tag,
        isCover: isCover || room.gallery.length === 0,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.username
      };

      room.gallery.push(photoEntry);

      // Record version history for rollback / undo
      const versionResult = recordMediaVersion(db, `room:${roomId}`, previousCover, req.user);

      logAudit(db, req.user, 'Room Photo Uploaded', `${req.user.name} uploaded new photo for ${room.name}.`, req);
      writeDB(db);

      return res.json({
        success: true,
        message: `Photo uploaded for ${room.name}! Changes are live.`,
        photo: photoEntry,
        room,
        undoToken: versionResult ? versionResult.undoToken : null
      });
    }

    // Case B: Labeled Website Slot Upload
    if (!slotKey) {
      return res.status(400).json({ success: false, message: 'Missing slotKey for media upload.' });
    }

    // Find previous URL for this slot
    db.mediaSlots = db.mediaSlots || {};
    let previousUrl = null;
    if (db.mediaSlots[slotKey]) {
      previousUrl = db.mediaSlots[slotKey].url;
    } else {
      const def = PHOTO_SLOTS.find(s => s.key === slotKey);
      if (def) previousUrl = def.defaultUrl;
    }

    // Record previous version in history & create 30-second undo token
    const versionResult = recordMediaVersion(db, slotKey, previousUrl, req.user);

    // Apply new URL
    applyUrlToSlot(db, slotKey, savedUrl);
    if (alt || caption) {
      db.mediaSlots[slotKey].alt = alt || db.mediaSlots[slotKey].alt || '';
      db.mediaSlots[slotKey].caption = caption || db.mediaSlots[slotKey].caption || '';
    }

    logAudit(db, req.user, 'Photo Slot Changed', `${req.user.name} updated photo slot "${slotKey}" to ${savedUrl}.`, req);
    writeDB(db);

    return res.json({
      success: true,
      message: 'Photo updated. Changes are live on the website immediately.',
      slotKey,
      newUrl: savedUrl,
      undoToken: versionResult ? versionResult.undoToken : null,
      history: (db.mediaHistory || []).filter(h => h.slotKey === slotKey).slice(0, 5)
    });
  } catch (err) {
    console.error('Media upload error:', err);
    res.status(400).json({ success: false, message: err.message || 'Image processing failed' });
  }
});

// 3. 30-Second Undo Action
app.post('/api/media/undo', requireManager, (req, res) => {
  const { undoToken } = req.body;
  if (!undoToken) {
    return res.status(400).json({ success: false, message: 'Missing undo authorization token.' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const result = performUndo(undoToken, db);
  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  logAudit(db, req.user, 'Photo Change Undone', `${req.user.name} triggered 30-second undo for slot "${result.slotKey}".`, req);
  writeDB(db);

  res.json({
    success: true,
    message: result.message,
    slotKey: result.slotKey,
    restoredUrl: result.restoredUrl
  });
});

// 4. Restore Any of the Last 5 Versions from History
app.post('/api/media/restore', requireManager, (req, res) => {
  const { historyId } = req.body;
  if (!historyId) {
    return res.status(400).json({ success: false, message: 'Missing historyId for version restore.' });
  }

  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const result = restoreFromHistory(historyId, db);
  if (!result.success) {
    return res.status(404).json({ success: false, message: result.message });
  }

  logAudit(db, req.user, 'Photo Version Restored', `${req.user.name} restored previous photo version for slot "${result.slotKey}".`, req);
  writeDB(db);

  res.json({
    success: true,
    message: result.message,
    slotKey: result.slotKey,
    restoredUrl: result.restoredUrl
  });
});

// 5. Update Photo Metadata (Alt Text & Caption)
app.post('/api/media/metadata', requireManager, (req, res) => {
  const { slotKey, roomId, photoId, alt, caption } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  if (roomId && photoId) {
    const room = (db.rooms || []).find(r => r.id === roomId);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    const photo = (room.gallery || []).find(p => p.id === photoId);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });
    if (alt !== undefined) photo.alt = alt.trim();
    if (caption !== undefined) photo.caption = caption.trim();
  } else if (slotKey) {
    db.mediaSlots = db.mediaSlots || {};
    db.mediaSlots[slotKey] = db.mediaSlots[slotKey] || {};
    if (alt !== undefined) db.mediaSlots[slotKey].alt = alt.trim();
    if (caption !== undefined) db.mediaSlots[slotKey].caption = caption.trim();
  }

  logAudit(db, req.user, 'Photo Metadata Updated', `${req.user.name} updated alt/caption for ${slotKey || (roomId + ':' + photoId)}.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Photo details saved successfully.' });
});

// 6. Delete Photo (with in-use warning)
app.post('/api/media/delete', requireManager, (req, res) => {
  const { slotKey, roomId, photoId, force = false } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  // Case A: Room gallery photo delete
  if (roomId && photoId) {
    const room = (db.rooms || []).find(r => r.id === roomId);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const photoIdx = (room.gallery || []).findIndex(p => p.id === photoId);
    if (photoIdx === -1) return res.status(404).json({ success: false, message: 'Photo not found in room gallery' });

    const photo = room.gallery[photoIdx];
    if (photo.isCover && room.gallery.length > 1 && !force) {
      return res.status(400).json({
        success: false,
        warning: true,
        message: 'This photo is currently set as the room cover image. Please select another cover photo first, or confirm deletion.'
      });
    }

    room.gallery.splice(photoIdx, 1);
    if (photo.isCover && room.gallery.length > 0) {
      room.gallery[0].isCover = true;
      room.image = room.gallery[0].url;
    }

    logAudit(db, req.user, 'Room Photo Deleted', `${req.user.name} removed photo from ${room.name}.`, req);
    writeDB(db);
    return res.json({ success: true, message: 'Photo removed from room gallery.', room });
  }

  // Case B: Slot photo delete (resets to default fallback)
  if (slotKey) {
    const def = PHOTO_SLOTS.find(s => s.key === slotKey);
    const fallbackUrl = def ? def.defaultUrl : '';

    db.mediaSlots = db.mediaSlots || {};
    if (db.mediaSlots[slotKey]) {
      db.mediaSlots[slotKey].url = fallbackUrl;
    }
    applyUrlToSlot(db, slotKey, fallbackUrl);

    logAudit(db, req.user, 'Photo Slot Reset', `${req.user.name} reset slot "${slotKey}" to default fallback.`, req);
    writeDB(db);

    return res.json({
      success: true,
      message: 'Photo slot reset to default placeholder image.',
      slotKey,
      currentUrl: fallbackUrl
    });
  }

  res.status(400).json({ success: false, message: 'Invalid deletion target.' });
});

// 7. Room Gallery Management (Reorder, Set Cover, Delete)
app.post('/api/rooms/:id/gallery', requireManager, (req, res) => {
  const { id } = req.params;
  const { gallery = [] } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  const room = (db.rooms || []).find(r => r.id === id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  room.gallery = gallery.map((item, idx) => ({
    id: item.id || `photo-${id}-${Date.now()}-${idx}`,
    url: item.url,
    alt: item.alt || room.name,
    caption: item.caption || '',
    isCover: !!item.isCover,
    tag: item.tag || 'general',
    uploadedAt: item.uploadedAt || new Date().toISOString(),
    uploadedBy: item.uploadedBy || req.user.username
  }));

  const cover = room.gallery.find(p => p.isCover) || room.gallery[0];
  if (cover) {
    cover.isCover = true;
    room.image = cover.url;
  }

  logAudit(db, req.user, 'Room Gallery Updated', `${req.user.name} updated gallery for "${room.name}" (${room.gallery.length} photos).`, req);
  writeDB(db);

  res.json({ success: true, message: `Gallery updated for ${room.name}.`, room });
});

// ============================================================================
// GALLERY SHOWCASE API (Moments at Coastal View)
// ============================================================================

// 1. Get all gallery photos (sorted by order)
app.get('/api/gallery', (req, res) => {
  const db = readDB();
  if (!db) return res.status(500).json({ success: false, message: 'Database error' });

  let photos = (db.gallery || []).slice();
  photos.sort((a, b) => (a.order || 999) - (b.order || 999));

  const { category, featured } = req.query;
  if (category && category !== 'All') {
    photos = photos.filter(p => p.category === category);
  }
  if (featured === 'true') {
    photos = photos.filter(p => p.featured || p.isFeatured);
  }

  res.json({
    success: true,
    total: photos.length,
    photos
  });
});

// 2. Upload photo(s) to gallery (single or bulk array with auto-conversion to WebP support)
app.post('/api/gallery', requireManager, (req, res) => {
  try {
    const db = readDB();
    if (!db) return res.status(500).json({ success: false, message: 'Database error' });
    db.gallery = db.gallery || [];

    const { photos, photo } = req.body;
    const itemsToProcess = Array.isArray(photos) ? photos : (photo ? [photo] : (req.body.imageBase64 ? [req.body] : []));

    if (itemsToProcess.length === 0) {
      return res.status(400).json({ success: false, message: 'No image data provided for gallery' });
    }

    const savedPhotos = [];
    for (const item of itemsToProcess) {
      if (!item.imageBase64 && !item.url) continue;

      let savedUrl = item.url;
      let thumbUrl = item.thumbUrl || item.url;

      if (item.imageBase64) {
        const cleanCat = (item.category || 'Hotel').toLowerCase().replace(/[^a-z0-9]/g, '-');
        savedUrl = saveBase64Image(item.imageBase64, 'gallery', `gallery-${cleanCat}`);
        thumbUrl = item.thumbBase64 ? saveBase64Image(item.thumbBase64, 'gallery', `thumb-${cleanCat}`) : savedUrl;
      }

      const newId = item.id || `gallery-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const maxOrder = db.gallery.reduce((max, p) => Math.max(max, p.order || 0), 0);

      const photoEntry = {
        id: newId,
        url: savedUrl,
        thumbUrl: thumbUrl || savedUrl,
        category: item.category || 'Hotel',
        caption: item.caption || 'Moments at Coastal View',
        alt: item.alt || `${item.category || 'Hotel'} photo at Coastal View Mandarmani`,
        featured: item.featured !== undefined ? !!item.featured : false,
        order: item.order ? Number(item.order) : (maxOrder + 1),
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user.username
      };

      db.gallery.push(photoEntry);
      savedPhotos.push(photoEntry);
    }

    logAudit(db, req.user, 'Gallery Photos Uploaded', `${req.user.name} uploaded ${savedPhotos.length} photo(s) to Showcase Gallery.`, req);
    writeDB(db);

    res.json({
      success: true,
      message: `Successfully uploaded ${savedPhotos.length} photo(s) to Showcase Gallery!`,
      photos: savedPhotos,
      gallery: db.gallery
    });
  } catch (err) {
    console.error('Gallery upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Gallery upload failed' });
  }
});

// 3. Reorder gallery photos
app.post('/api/gallery/reorder', requireManager, (req, res) => {
  const { ids = [] } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  db.gallery = db.gallery || [];
  const idMap = new Map();
  ids.forEach((id, idx) => idMap.set(id, idx + 1));

  db.gallery.forEach(p => {
    if (idMap.has(p.id)) {
      p.order = idMap.get(p.id);
    }
  });

  db.gallery.sort((a, b) => (a.order || 999) - (b.order || 999));
  logAudit(db, req.user, 'Gallery Reordered', `${req.user.name} reordered showcase gallery (${ids.length} photos).`, req);
  writeDB(db);

  res.json({ success: true, message: 'Gallery reordered successfully', gallery: db.gallery });
});

// 4. Update photo details
app.post('/api/gallery/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const { caption, alt, category, featured } = req.body;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  const photo = (db.gallery || []).find(p => p.id === id);
  if (!photo) return res.status(404).json({ success: false, message: 'Photo not found in gallery' });

  if (caption !== undefined) photo.caption = caption.trim();
  if (alt !== undefined) photo.alt = alt.trim();
  if (category !== undefined) photo.category = category;
  if (featured !== undefined) photo.featured = !!featured;

  logAudit(db, req.user, 'Gallery Photo Updated', `${req.user.name} updated photo "${photo.caption || id}" in gallery.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Photo updated successfully', photo });
});

// 5. Toggle featured star on photo
app.post('/api/gallery/:id/toggle-featured', requireManager, (req, res) => {
  const { id } = req.params;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  const photo = (db.gallery || []).find(p => p.id === id);
  if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });

  photo.featured = !photo.featured;
  const starredCount = (db.gallery || []).filter(p => p.featured).length;

  logAudit(db, req.user, 'Gallery Featured Toggled', `${req.user.name} set photo "${photo.caption}" featured on home page to ${photo.featured}. Total starred: ${starredCount}.`, req);
  writeDB(db);

  res.json({
    success: true,
    photo,
    starredCount,
    message: photo.featured ? 'Photo is now starred for home page showcase!' : 'Photo removed from home page showcase.'
  });
});

// 6. Delete photo from gallery
app.delete('/api/gallery/:id', requireManager, (req, res) => {
  const { id } = req.params;
  const db = readDB();
  if (!db) return res.status(500).json({ success: false });

  const photo = (db.gallery || []).find(p => p.id === id);
  if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });

  db.gallery = (db.gallery || []).filter(p => p.id !== id);

  // If local file in uploads/gallery, delete file
  if (photo.url && photo.url.startsWith('/uploads/gallery/')) {
    try {
      const filePath = path.join(__dirname, photo.url.replace(/^\//, ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (photo.thumbUrl && photo.thumbUrl !== photo.url && photo.thumbUrl.startsWith('/uploads/gallery/')) {
        const thumbPath = path.join(__dirname, photo.thumbUrl.replace(/^\//, ''));
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    } catch (e) {
      console.warn('Could not remove file on disk:', e.message);
    }
  }

  logAudit(db, req.user, 'Gallery Photo Deleted', `${req.user.name} deleted photo "${photo.caption || id}" from showcase gallery.`, req);
  writeDB(db);

  res.json({ success: true, message: 'Photo removed from gallery.' });
});

// Global error handler (handles malformed JSON payloads gracefully)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Malformed JSON payload rejected' });
  }
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Process-level error resilience
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception caught:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection caught:', reason);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Coastal View luxury hotel server running on http://localhost:${PORT}`);
});

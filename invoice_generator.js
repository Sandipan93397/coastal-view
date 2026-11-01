const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const sharp = require('sharp');

const { getDataDir } = require('./db_store');
const FONTS_DIR = path.join(__dirname, 'assets', 'fonts');
const IMAGES_DIR = path.join(__dirname, 'assets', 'images');
const INVOICES_DIR = process.env.INVOICES_DIR
  ? path.resolve(process.env.INVOICES_DIR)
  : path.join(getDataDir(), 'invoices');

// Ensure invoices directory exists
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

// Indian Currency Formatter: ₹12,500
function formatINR(val) {
  const num = Math.round(Number(val) || 0);
  return '₹' + num.toLocaleString('en-IN');
}

// Format Date strictly in Indian Standard Time (IST): e.g. "02 Nov 2026"
function formatDateIST(dStr) {
  if (!dStr) return '';
  try {
    const s = String(dStr).trim();
    // YYYY-MM-DD pattern: avoid any timezone shifts
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
    }
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return s;
    return dt.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return String(dStr);
  }
}

// Backward compatibility alias
const formatDateStr = formatDateIST;

// Register fonts on PDFKit document
function registerCustomFonts(doc) {
  const regFont = (name, filename) => {
    const p = path.join(FONTS_DIR, filename);
    if (fs.existsSync(p)) {
      doc.registerFont(name, p);
    }
  };

  regFont('Poppins', 'Poppins-Regular.ttf');
  regFont('Poppins-Medium', 'Poppins-Medium.ttf');
  regFont('Poppins-SemiBold', 'Poppins-SemiBold.ttf');
  regFont('Poppins-Bold', 'Poppins-Bold.ttf');
  regFont('Playfair-Bold', 'PlayfairDisplay-Bold.ttf');
  regFont('Playfair-Regular', 'PlayfairDisplay-Regular.ttf');
}

/**
 * Generate a luxury, print-ready, single-page A4 booking invoice PDF.
 * @param {Object} booking - Booking data
 * @param {Object} db - Current database object (for settings & content)
 * @param {Object} options - Options (savePath, baseUrl, stream, etc.)
 * @returns {Promise<Buffer|Object>}
 */
async function generateInvoicePDF(booking, db, options = {}) {
  const settings = (db && db.settings) || {};
  const websiteContent = (db && db.websiteContent) || {};

  // Authoritative IDs & Dates
  const bookingId = booking.bookingId || 'CV-2026-000001';
  const invoiceNum = booking.invoiceNumber || `INV-2026-000001`;
  const issueDate = formatDateIST(booking.createdAt || new Date());
  const checkInDate = formatDateIST(booking.checkIn);
  const checkOutDate = formatDateIST(booking.checkOut);

  // Hotel details strictly from Admin Settings > Website Content
  const hotelName = settings.hotelName || 'Coastal View';
  const management = settings.management || "Managed By Ani's";
  const address = settings.address || '';
  const phone = settings.phone || '';
  const email = (typeof settings.email === 'string' ? settings.email : settings.email?.senderEmail) || '';
  const website = settings.website || 'https://coastalviewmandarmani.com';
  const checkInTime = settings.checkInTime || '11:00 AM';
  const checkOutTime = settings.checkOutTime || '9:30 AM';
  const paymentUPI = (settings.paymentUPI || '').trim();
  const paymentMethods = (settings.paymentMethods || '').trim();
  const ownerName = settings.ownerName || websiteContent.owner?.name || 'Anirban Das';
  const ownerTitle = settings.ownerTitle || 'Owner, Coastal View';

  // Tax settings
  const gstEnabled = !!settings.gstEnabled;
  const gstin = (settings.gstin || '').trim();
  const gstRate = gstEnabled ? (Number(settings.gstRate) || 12) : 0;

  // Logo file selection & optimization (keeps PDF strictly under 300 KB)
  let logoPath = path.join(IMAGES_DIR, 'logo-invoice.png');
  if (settings.invoiceLogo && fs.existsSync(path.resolve(settings.invoiceLogo))) {
    logoPath = path.resolve(settings.invoiceLogo);
  } else if (!fs.existsSync(logoPath)) {
    logoPath = path.join(IMAGES_DIR, 'logo.png');
  }

  let optimizedLogoBuffer = null;
  if (fs.existsSync(logoPath)) {
    try {
      optimizedLogoBuffer = await sharp(logoPath)
        .resize({ width: 320, withoutEnlargement: true })
        .png({ quality: 80, compressionLevel: 9 })
        .toBuffer();
    } catch (e) {
      optimizedLogoBuffer = fs.readFileSync(logoPath);
    }
  }

  // Base URL for links
  const baseUrl = options.baseUrl || 'https://coastalviewmandarmani.com';

  // 1. QR Code 1: "Verify booking" (token verification or hotel location)
  const verifyTargetUrl = booking.invoiceToken
    ? `${baseUrl}/api/invoices/public/view/${booking.invoiceToken}`
    : 'https://maps.google.com/?q=Coastal+View+Mandarmani';

  let verifyQrBuffer = null;
  try {
    verifyQrBuffer = await QRCode.toBuffer(verifyTargetUrl, {
      margin: 1,
      width: 250,
      color: {
        dark: '#073B4C',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.warn('Verify QR generation notice:', err.message);
  }

  // 2. QR Code 2: "Review us" (Google Review URL from admin Settings > Website Content)
  const reviewUrl = (typeof settings.reviewLink === 'string' ? settings.reviewLink : settings.reviewLink?.url) ||
                    (typeof websiteContent.reviewLink === 'string' ? websiteContent.reviewLink : websiteContent.reviewLink?.url) ||
                    'https://maps.app.goo.gl/NroV1rQ4ZkgKuqQg7';
  let reviewQrBuffer = null;

  // Check if custom uploaded QR image exists
  if (settings.reviewQrImage && fs.existsSync(path.resolve(settings.reviewQrImage))) {
    try {
      reviewQrBuffer = fs.readFileSync(path.resolve(settings.reviewQrImage));
    } catch (e) {
      reviewQrBuffer = null;
    }
  }

  if (!reviewQrBuffer) {
    try {
      reviewQrBuffer = await QRCode.toBuffer(reviewUrl, {
        margin: 2, // white margin around it
        width: 300, // sharp vector resolution
        color: {
          dark: '#073B4C',
          light: '#FFFFFF'
        }
      });
    } catch (err) {
      console.warn('Review QR generation notice:', err.message);
    }
  }

  return new Promise((resolve, reject) => {
    // Standard A4: 595.28 x 841.89 points
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 42; // ~15-16mm margin
    const CONTENT_W = PAGE_W - (MARGIN * 2); // ~511 pt

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Invoice ${invoiceNum} - Coastal View Mandarmani`,
        Author: 'Coastal View Hotel',
        Subject: `Booking Confirmation Voucher & Invoice: ${booking.guestName || 'Guest'} (${bookingId})`,
        Keywords: 'hotel, invoice, mandarmani, coastal view, reservation'
      }
    });

    registerCustomFonts(doc);

    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      if (options.savePath) {
        fs.writeFile(options.savePath, pdfBuffer, err => {
          if (err) return reject(err);
          resolve({ pdfBuffer, savePath: options.savePath, fileSize: pdfBuffer.length });
        });
      } else {
        resolve({ pdfBuffer, fileSize: pdfBuffer.length });
      }
    });
    doc.on('error', reject);

    // =========================================================================
    // 1. LUXURY PAGE BORDERS & WATERMARK
    // =========================================================================
    // Outer champagne gold border
    doc.rect(14, 14, PAGE_W - 28, PAGE_H - 28)
       .lineWidth(1.2)
       .strokeColor('#E8C77B')
       .stroke();

    // Subtle inner accent border
    doc.rect(18, 18, PAGE_W - 36, PAGE_H - 36)
       .lineWidth(0.5)
       .strokeColor('#F3E5C8')
       .stroke();

    // Background faint logo watermark (centered)
    if (optimizedLogoBuffer) {
      try {
        doc.save();
        doc.opacity(0.04);
        const wmWidth = 200;
        doc.image(optimizedLogoBuffer, (PAGE_W - wmWidth) / 2, 280, { width: wmWidth });
        doc.restore();
      } catch (e) {}
    }

    // =========================================================================
    // 2. HEADER: BRAND LOGO (LEFT) & INVOICE BOX (RIGHT)
    // =========================================================================
    const topY = 28;

    // LEFT HEADER: Fixed logo container (~140 x 46 pt box, object-fit: contain)
    const logoBoxW = 140;
    const logoBoxH = 46;

    if (optimizedLogoBuffer) {
      try {
        doc.image(optimizedLogoBuffer, MARGIN, topY, { fit: [logoBoxW, logoBoxH], align: 'left', valign: 'center' });
      } catch (imgErr) {
        doc.font('Playfair-Bold').fontSize(18).fillColor('#073B4C').text(hotelName, MARGIN, topY + 8);
      }
    } else {
      doc.font('Playfair-Bold').fontSize(18).fillColor('#073B4C').text(hotelName, MARGIN, topY + 8);
    }

    // Hotel details below logo (properly spaced, no overlap)
    const brandInfoY = topY + logoBoxH + 4;
    doc.font('Poppins-Bold').fontSize(10.5).fillColor('#073B4C').text(hotelName, MARGIN, brandInfoY);
    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#06B6B0').text(management.toUpperCase(), MARGIN, brandInfoY + 13, { characterSpacing: 1.1 });
    
    let infoLineY = brandInfoY + 24;
    if (address) {
      doc.font('Poppins').fontSize(7.2).fillColor('#475569').text(address, MARGIN, infoLineY, { width: 235 });
      infoLineY += 10;
    }
    
    const contactParts = [];
    if (phone) contactParts.push(`Phone: ${phone}`);
    if (email) contactParts.push(`Email: ${email}`);
    if (contactParts.length > 0) {
      doc.font('Poppins').fontSize(7.2).fillColor('#475569').text(contactParts.join('  •  '), MARGIN, infoLineY, { width: 235 });
      infoLineY += 10;
    }

    if (gstEnabled && gstin) {
      doc.font('Poppins-SemiBold').fontSize(7.2).fillColor('#073B4C').text(`GSTIN: ${gstin}`, MARGIN, infoLineY);
    }

    // RIGHT HEADER: Invoice Meta Card
    const bandW = 215;
    const bandH = 96;
    const bandX = PAGE_W - MARGIN - bandW;
    const bandY = topY;

    doc.roundedRect(bandX, bandY, bandW, bandH, 6)
       .fillColor('#FFF2DC')
       .fill();

    doc.roundedRect(bandX, bandY, bandW, bandH, 6)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    doc.font('Playfair-Bold').fontSize(10).fillColor('#073B4C')
       .text('INVOICE / CONFIRMATION', bandX + 8, bandY + 8, { width: bandW - 16, align: 'center' });

    doc.moveTo(bandX + 16, bandY + 22)
       .lineTo(bandX + bandW - 16, bandY + 22)
       .lineWidth(0.6)
       .strokeColor('#E8C77B')
       .stroke();

    const metaY = bandY + 26;
    // BOOKING ID (Prominent)
    doc.font('Poppins-SemiBold').fontSize(7.2).fillColor('#64748B').text('BOOKING ID:', bandX + 14, metaY);
    doc.font('Poppins-Bold').fontSize(8.5).fillColor('#06B6B0').text(bookingId, bandX + 82, metaY);

    // INVOICE NO
    doc.font('Poppins-SemiBold').fontSize(7.2).fillColor('#64748B').text('INVOICE NO:', bandX + 14, metaY + 13);
    doc.font('Poppins-Bold').fontSize(8).fillColor('#073B4C').text(invoiceNum, bandX + 82, metaY + 13);

    // DATE
    doc.font('Poppins-SemiBold').fontSize(7.2).fillColor('#64748B').text('DATE:', bandX + 14, metaY + 25);
    doc.font('Poppins-Medium').fontSize(7.5).fillColor('#1E293B').text(issueDate, bandX + 82, metaY + 25);

    // Real Status Badge
    const isConfirmed = booking.status === 'Confirmed' || booking.status === 'Checked-in' || booking.status === 'Completed';
    const isCancelled = booking.status === 'Cancelled';
    const badgeText = isCancelled ? 'CANCELLED' : (isConfirmed ? 'ADVANCE PAID' : 'PAYMENT PENDING');
    const badgeBg = isCancelled ? '#FEE2E2' : (isConfirmed ? '#D1FAE5' : '#FEF3C7');
    const badgeColor = isCancelled ? '#B91C1C' : (isConfirmed ? '#065F46' : '#92400E');

    doc.roundedRect(bandX + 14, metaY + 41, bandW - 28, 16, 3)
       .fillColor(badgeBg)
       .fill();

    doc.font('Poppins-Bold').fontSize(7.2).fillColor(badgeColor)
       .text(badgeText, bandX + 14, metaY + 44, { width: bandW - 28, align: 'center', characterSpacing: 0.8 });

    // Gold Divider line below Header
    const sepY = 136;
    doc.moveTo(MARGIN, sepY)
       .lineTo(PAGE_W - MARGIN, sepY)
       .lineWidth(0.9)
       .strokeColor('#E8C77B')
       .stroke();

    // =========================================================================
    // 3. BILLED TO & STAY DETAILS (2-Column Equal Cards)
    // =========================================================================
    const cardY = sepY + 7;
    const cardGap = 11;
    const cardW = (CONTENT_W - cardGap) / 2; // ~250 pt each
    const cardH = 82;

    // Card 1: Billed To
    const card1X = MARGIN;
    doc.roundedRect(card1X, cardY, cardW, cardH, 5)
       .fillColor('#F8FAFC')
       .fill();
    doc.roundedRect(card1X, cardY, cardW, cardH, 5)
       .lineWidth(0.6)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#06B6B0')
       .text('BILLED TO (GUEST DETAILS)', card1X + 10, cardY + 7, { characterSpacing: 0.6 });

    // Guest name with proper wrapping
    doc.font('Poppins-Bold').fontSize(9.5).fillColor('#073B4C')
       .text(booking.guestName || 'Valued Guest', card1X + 10, cardY + 19, { width: cardW - 20, lineBreak: true });

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text(`Phone: ${booking.guestPhone || 'N/A'}`, card1X + 10, cardY + 34);

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text(`Email: ${booking.guestEmail || 'Not Provided'}`, card1X + 10, cardY + 46, { width: cardW - 20, ellipsis: true });

    if (booking.specialRequests) {
      doc.font('Poppins-Medium').fontSize(6.8).fillColor('#64748B')
         .text(`Note: "${booking.specialRequests.substring(0, 50)}${booking.specialRequests.length > 50 ? '...' : ''}"`, card1X + 10, cardY + 59, { width: cardW - 20 });
    }

    // Card 2: Stay Details
    const card2X = card1X + cardW + cardGap;
    doc.roundedRect(card2X, cardY, cardW, cardH, 5)
       .fillColor('#F8FAFC')
       .fill();
    doc.roundedRect(card2X, cardY, cardW, cardH, 5)
       .lineWidth(0.6)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#06B6B0')
       .text('STAY & ACCOMMODATION OVERVIEW', card2X + 10, cardY + 7, { characterSpacing: 0.6 });

    const roomsCount = booking.roomsCount || 1;
    doc.font('Poppins-Bold').fontSize(9.5).fillColor('#073B4C')
       .text(`${booking.roomName || 'Luxury Room'} (${roomsCount} room${roomsCount > 1 ? 's' : ''})`, card2X + 10, cardY + 19, { width: cardW - 20, ellipsis: true });

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text(`Check-In:  ${checkInDate} (from ${checkInTime})`, card2X + 10, cardY + 34);

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text(`Check-Out: ${checkOutDate} (until ${checkOutTime})`, card2X + 10, cardY + 46);

    const guestCountStr = booking.children
      ? `${booking.adults || 2} Adults + ${booking.children} Child${booking.children > 1 ? 'ren' : ''}`
      : `${booking.adults || 2} Adult${(booking.adults || 2) > 1 ? 's' : ''}`;
    doc.font('Poppins-Medium').fontSize(7).fillColor('#64748B')
       .text(`Duration: ${booking.nights || 1} Night(s)  •  Occupancy: ${guestCountStr}`, card2X + 10, cardY + 59);

    // =========================================================================
    // 4. ITEMIZED CHARGES TABLE
    // =========================================================================
    const tblY = cardY + cardH + 9;
    const colDescX = MARGIN;
    const colDescW = 250;
    const colQtyX = colDescX + colDescW;
    const colQtyW = 75;
    const colRateX = colQtyX + colQtyW;
    const colRateW = 80;
    const colAmtX = colRateX + colRateW;
    const colAmtW = CONTENT_W - (colDescW + colQtyW + colRateW); // ~106 pt

    // Table Header Bar (Ocean Blue #073B4C)
    doc.roundedRect(MARGIN, tblY, CONTENT_W, 20, 3)
       .fillColor('#073B4C')
       .fill();

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#FFFFFF')
       .text('DESCRIPTION', colDescX + 8, tblY + 5)
       .text('QTY', colQtyX, tblY + 5, { width: colQtyW, align: 'center' })
       .text('RATE', colRateX, tblY + 5, { width: colRateW - 8, align: 'right' })
       .text('AMOUNT', colAmtX, tblY + 5, { width: colAmtW - 10, align: 'right' });

    // Build Table Rows
    const rows = [];

    // Row 1: Room accommodation
    const nights = booking.nights || 1;
    const roomRate = booking.roomPrice || Math.round((booking.roomSubtotal || 0) / (roomsCount * nights));
    const roomSub = booking.roomSubtotal || (roomRate * roomsCount * nights);

    rows.push({
      title: `${booking.roomName || 'Room Accommodation'}`,
      subtitle: `${nights} night(s) × ${roomsCount} room(s) [${checkInDate} to ${checkOutDate}]`,
      qty: `${nights}N × ${roomsCount}R`,
      rate: formatINR(roomRate),
      amount: formatINR(roomSub)
    });

    // Row 2: Breakfast Add-on (if selected)
    if (booking.breakfast) {
      const bfUnit = booking.breakfastUnit || 'per_person_per_day';
      const bfRate = booking.breakfastPrice !== undefined ? booking.breakfastPrice : 200;
      const bfDays = booking.breakfastDays || booking.nights || 1;
      const bfGuests = booking.breakfastGuests || booking.breakfastCount || ((booking.adults || 2) + (booking.children || 0));
      const isPerRoom = bfUnit === 'per_room_per_day';
      const bfQtyCount = isPerRoom ? roomsCount : bfGuests;
      const bfSub = booking.breakfastTotal !== undefined ? booking.breakfastTotal : (bfRate * bfQtyCount * bfDays);

      const subtitle = isPerRoom
        ? `${roomsCount} room(s) × ${bfDays} day(s) · Morning breakfast service`
        : `${bfGuests} guest(s) × ${bfDays} day(s) · Morning breakfast service`;
      const qtyStr = isPerRoom ? `${roomsCount}R × ${bfDays}d` : `${bfGuests}G × ${bfDays}d`;

      rows.push({
        title: 'Optional Breakfast Add-On (7:00 AM - 10:30 AM)',
        subtitle: subtitle,
        qty: qtyStr,
        rate: formatINR(bfRate),
        amount: formatINR(bfSub)
      });
    }

    // Row 3: Private Transport (Vehicle Lines)
    if (booking.needCar) {
      if (Array.isArray(booking.vehicleLines) && booking.vehicleLines.length > 0) {
        booking.vehicleLines.forEach(line => {
          let details = [];
          if (line.pickupPoint || line.pickupTime) {
            details.push(`Pickup: ${line.pickupPoint || 'Specified point'}${line.pickupTime ? ' @ ' + line.pickupTime : ''}`.trim());
          }
          if (line.dropPoint || line.dropTime) {
            details.push(`Drop: ${line.dropPoint || 'Specified point'}${line.dropTime ? ' @ ' + line.dropTime : ''}`.trim());
          }
          if (line.tourNotes) {
            details.push(`Notes: ${line.tourNotes}`);
          }
          const detStr = details.length ? ` • ${details.join(' | ')}` : '';
          const dayStr = line.days ? ` × ${line.days} day(s)` : '';
          const qtyStr = line.days ? `${line.quantity}U × ${line.days}d` : `${line.quantity} trip`;

          rows.push({
            title: `Private Transport: ${line.vehicleName || 'Vehicle'} · ${line.serviceLabel || 'Service'}`,
            subtitle: `${line.quantity} vehicle(s)${dayStr}${detStr}`,
            qty: qtyStr,
            rate: formatINR(line.price || Math.round(line.subtotal / (line.quantity * (line.days || 1)))),
            amount: formatINR(line.subtotal || 0)
          });
        });
      } else {
        const vQty = booking.carCount || booking.vehicleQuantity || 1;
        const vDays = booking.vehicleDays || nights;
        const vRate = booking.vehiclePricePerDay || Math.round((booking.carTotal || 0) / (vQty * vDays));
        const vTrip = booking.vehicleTripType ? ` (${booking.vehicleTripType})` : '';

        rows.push({
          title: `Private Transport: ${booking.vehicleName || 'Vehicle'}`,
          subtitle: `${vQty} vehicle(s) × ${vDays} day(s)${vTrip} - Ani's Travels`,
          qty: `${vQty}U × ${vDays}d`,
          rate: formatINR(vRate),
          amount: formatINR(booking.carTotal || 0)
        });
      }
    }

    // Row 4: Candlelight Dinner (if selected)
    if (booking.candlelightDinner) {
      const occasionStr = booking.dinnerOccasion ? ` - ${booking.dinnerOccasion}` : '';
      rows.push({
        title: `Candlelight Dinner Add-On (${booking.dinnerSetup || 'Beachside'} Romance)`,
        subtitle: `Private seaside candlelit setup${occasionStr} with bespoke dining`,
        qty: '1 Experience',
        rate: formatINR(booking.dinnerTotal || 0),
        amount: formatINR(booking.dinnerTotal || 0)
      });
    }

    // Render Table Rows (Dynamic compact row height)
    let curRowY = tblY + 22;
    rows.forEach((r, idx) => {
      const rowH = 26;
      if (idx % 2 === 1) {
        doc.rect(MARGIN, curRowY, CONTENT_W, rowH)
           .fillColor('#F8FAFC')
           .fill();
      }

      doc.moveTo(MARGIN, curRowY + rowH)
         .lineTo(PAGE_W - MARGIN, curRowY + rowH)
         .lineWidth(0.5)
         .strokeColor('#E2E8F0')
         .stroke();

      doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#073B4C')
         .text(r.title, colDescX + 8, curRowY + 3, { width: colDescW - 12, ellipsis: true });
      doc.font('Poppins').fontSize(6.5).fillColor('#64748B')
         .text(r.subtitle, colDescX + 8, curRowY + 14, { width: colDescW - 12, ellipsis: true });

      doc.font('Poppins').fontSize(7.2).fillColor('#334155')
         .text(r.qty, colQtyX, curRowY + 8, { width: colQtyW, align: 'center' });

      doc.font('Poppins').fontSize(7.2).fillColor('#334155')
         .text(r.rate, colRateX, curRowY + 8, { width: colRateW - 8, align: 'right' });

      doc.font('Poppins-Bold').fontSize(7.8).fillColor('#073B4C')
         .text(r.amount, colAmtX, curRowY + 8, { width: colAmtW - 10, align: 'right' });

      curRowY += rowH;
    });

    // Subtotal / Tax Calculation
    const totalAmount = Number(booking.totalAmount) || 0;
    let taxableAmount = totalAmount;
    let cgstAmt = 0;
    let sgstAmt = 0;

    if (gstEnabled && gstRate > 0) {
      const baseBeforeTax = Math.round(totalAmount / (1 + (gstRate / 100)));
      const taxTotal = totalAmount - baseBeforeTax;
      taxableAmount = baseBeforeTax;
      cgstAmt = Math.round(taxTotal / 2);
      sgstAmt = taxTotal - cgstAmt;
    }

    // Taxes block (if enabled)
    let totalsStartY = curRowY + 3;
    const totLabelX = colRateX - 35;
    const totLabelW = 115;

    if (gstEnabled && gstRate > 0) {
      doc.font('Poppins').fontSize(7.2).fillColor('#64748B').text('Taxable Subtotal:', totLabelX, totalsStartY, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(7.5).fillColor('#334155').text(formatINR(taxableAmount), colAmtX, totalsStartY, { width: colAmtW - 10, align: 'right' });

      const halfRate = (gstRate / 2).toFixed(1).replace('.0', '');
      doc.font('Poppins').fontSize(7.2).fillColor('#64748B').text(`CGST (${halfRate}%):`, totLabelX, totalsStartY + 11, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(7.5).fillColor('#334155').text(formatINR(cgstAmt), colAmtX, totalsStartY + 11, { width: colAmtW - 10, align: 'right' });

      doc.font('Poppins').fontSize(7.2).fillColor('#64748B').text(`SGST (${halfRate}%):`, totLabelX, totalsStartY + 22, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(7.5).fillColor('#334155').text(formatINR(sgstAmt), colAmtX, totalsStartY + 22, { width: colAmtW - 10, align: 'right' });

      curRowY = totalsStartY + 35;
    } else {
      curRowY = totalsStartY;
    }

    // Grand Total Row with soft champagne background
    doc.roundedRect(colDescX, curRowY, CONTENT_W, 20, 3)
       .fillColor('#FFF2DC')
       .fill();
    doc.roundedRect(colDescX, curRowY, CONTENT_W, 20, 3)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    doc.font('Poppins-Bold').fontSize(8.5).fillColor('#073B4C')
       .text('TOTAL BOOKING AMOUNT:', colDescX + 10, curRowY + 5);
    doc.font('Poppins-Bold').fontSize(10.5).fillColor('#073B4C')
       .text(formatINR(totalAmount), colAmtX, curRowY + 4, { width: colAmtW - 10, align: 'right' });

    // =========================================================================
    // 5. PAYMENT BREAKDOWN (HIGHLIGHTED 20% ADVANCE & 80% BALANCE BOX)
    // =========================================================================
    const payBoxY = curRowY + 25;
    const payBoxH = 58;

    doc.roundedRect(MARGIN, payBoxY, CONTENT_W, payBoxH, 5)
       .fillColor('#FFFDF9')
       .fill();
    doc.roundedRect(MARGIN, payBoxY, CONTENT_W, payBoxH, 5)
       .lineWidth(0.9)
       .strokeColor('#E8C77B')
       .stroke();

    const payAdv = Number(booking.payNowAdvance) || Math.round((totalAmount * 20) / 100);
    const payBal = Number(booking.payAtHotelBalance) || (totalAmount - payAdv);

    // Left column: 20% Advance Status
    const payCol1X = MARGIN + 10;
    const payColW = (CONTENT_W - 30) / 2;

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#06B6B0')
       .text('PAYMENT SUMMARY & SCHEDULE', payCol1X, payBoxY + 6);

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text('20% Advance Booking Fee:', payCol1X, payBoxY + 18);
    doc.font('Poppins-Bold').fontSize(9.5).fillColor('#073B4C')
       .text(formatINR(payAdv), payCol1X + 120, payBoxY + 17);

    // Pay mode text: strictly from settings if set, hide UPI if unset
    let payModeText = '';
    if (isConfirmed) {
      payModeText = `Advance Received on ${issueDate} via ${booking.paymentMode || 'Direct Transfer'}${booking.transactionId ? ` (Txn ID: ${booking.transactionId})` : ''}`;
    } else {
      payModeText = paymentUPI 
        ? `Advance Pending (Transfer to ${paymentUPI} to confirm)`
        : 'Advance Pending (Pay at front desk or direct bank transfer)';
    }

    doc.font('Poppins-Medium').fontSize(6.5).fillColor(isConfirmed ? '#059669' : '#D97706')
       .text(payModeText, payCol1X, payBoxY + 31, { width: payColW });

    doc.font('Poppins').fontSize(6.2).fillColor('#94A3B8')
       .text(`* ${settings.advancePolicyNote || 'The 20% advance is non-refundable.'}`, payCol1X, payBoxY + 43);

    // Right column: 80% Balance Due at Hotel
    const payCol2X = payCol1X + payColW + 12;

    doc.moveTo(payCol2X - 6, payBoxY + 6)
       .lineTo(payCol2X - 6, payBoxY + payBoxH - 6)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins').fontSize(7.5).fillColor('#475569')
       .text('80% Balance Payable at Hotel:', payCol2X, payBoxY + 18);
    doc.font('Poppins-Bold').fontSize(9.5).fillColor('#06B6B0')
       .text(formatINR(payBal), payCol2X + 130, payBoxY + 17);

    doc.font('Poppins').fontSize(6.8).fillColor('#475569')
       .text('Payable upon check-in / check-out directly at resort desk.', payCol2X, payBoxY + 31);

    if (paymentMethods) {
      doc.font('Poppins').fontSize(6.2).fillColor('#64748B')
         .text(`Accepted methods: ${paymentMethods}`, payCol2X, payBoxY + 43);
    }

    // =========================================================================
    // 6. TERMS & IMPORTANT RESORT POLICIES
    // =========================================================================
    const termsY = payBoxY + payBoxH + 8;
    doc.font('Poppins-SemiBold').fontSize(7.2).fillColor('#073B4C')
       .text('TERMS & IMPORTANT RESORT POLICIES:', MARGIN, termsY);

    const defaultTerms = [
      `1. Advance Policy: The 20% advance is non-refundable upon cancellation.`,
      `2. Remaining 80% balance is payable at check-in / check-out at the hotel desk.`,
      `3. Check-In & Check-Out: Check-in from ${checkInTime}; Check-out until ${checkOutTime}. Early check-in subject to availability.`,
      `4. Guest Identification: Valid Government photo ID (Aadhaar, Passport, Voter ID) is mandatory for all adult guests.`,
      `5. Hotel Rules: Outside food and beverages are strictly not allowed inside hotel premises.`
    ];

    const termsToRender = (Array.isArray(settings.invoiceTerms) && settings.invoiceTerms.length > 0)
      ? settings.invoiceTerms
      : defaultTerms;

    let termLineY = termsY + 10;
    termsToRender.slice(0, 5).forEach(t => {
      doc.font('Poppins').fontSize(6.5).fillColor('#475569')
         .text(t, MARGIN, termLineY, { width: CONTENT_W });
      termLineY += 8.5;
    });

    // =========================================================================
    // 7. BALANCED BOTTOM SECTION: VERIFY QR + REVIEW US QR + SIGNATURE
    // =========================================================================
    const bottomDividerY = termLineY + 5;

    doc.moveTo(MARGIN, bottomDividerY)
       .lineTo(PAGE_W - MARGIN, bottomDividerY)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    const bottomAreaY = bottomDividerY + 6;

    // --- Col 1: VERIFY BOOKING QR CODE ---
    const col1W = 75;
    if (verifyQrBuffer) {
      doc.image(verifyQrBuffer, MARGIN + 12, bottomAreaY + 2, { width: 48 });
      doc.font('Poppins-Bold').fontSize(6.5).fillColor('#073B4C')
         .text('Verify booking', MARGIN, bottomAreaY + 52, { width: col1W + 24, align: 'center' });
      doc.font('Poppins').fontSize(5.5).fillColor('#94A3B8')
         .text('Scan to verify reservation', MARGIN, bottomAreaY + 60, { width: col1W + 24, align: 'center' });
    }

    // Divider between Col 1 and Col 2
    doc.moveTo(MARGIN + 95, bottomAreaY + 4)
       .lineTo(MARGIN + 95, bottomAreaY + 66)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    // --- Col 2: REVIEW US QR CODE (30 mm ≈ 85 pt) ---
    const reviewX = MARGIN + 105;
    const reviewW = 210;

    doc.font('Poppins-Bold').fontSize(8).fillColor('#073B4C')
       .text('Loved your stay? Review us on Google', reviewX, bottomAreaY + 2);
    doc.font('Poppins').fontSize(6.5).fillColor('#64748B')
       .text('Scan the QR code to share your experience', reviewX, bottomAreaY + 13);

    // QR image (~52 pt on canvas, equivalent to ~25-30 mm box with clean white margin)
    if (reviewQrBuffer) {
      doc.image(reviewQrBuffer, reviewX, bottomAreaY + 24, { width: 44 });
      doc.font('Poppins-Bold').fontSize(6.5).fillColor('#06B6B0')
         .text('Review us', reviewX, bottomAreaY + 69, { width: 44, align: 'center' });

      // Review message beside the QR
      doc.font('Playfair-Bold').fontSize(8.5).fillColor('#073B4C')
         .text('Thank you for choosing Coastal View!', reviewX + 52, bottomAreaY + 27, { width: reviewW - 54 });
      doc.font('Poppins').fontSize(6.2).fillColor('#475569')
         .text('We look forward to welcoming you to Mandarmani beach. Your feedback inspires our hospitality.', reviewX + 52, bottomAreaY + 39, { width: reviewW - 54 });
    }

    // Divider between Col 2 and Col 3
    doc.moveTo(PAGE_W - MARGIN - 130, bottomAreaY + 4)
       .lineTo(PAGE_W - MARGIN - 130, bottomAreaY + 66)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    // --- Col 3: AUTHORIZED SIGNATURE ---
    const signBoxX = PAGE_W - MARGIN - 120;
    const signBoxY = bottomAreaY + 8;

    let renderedSigImg = false;
    if (settings.signatureImageUrl && fs.existsSync(path.resolve(settings.signatureImageUrl))) {
      try {
        doc.image(path.resolve(settings.signatureImageUrl), signBoxX + 10, signBoxY, { width: 100, height: 30 });
        renderedSigImg = true;
      } catch (e) {
        renderedSigImg = false;
      }
    }

    if (!renderedSigImg) {
      doc.font('Playfair-Bold').fontSize(10.5).fillColor('#073B4C')
         .text(ownerName, signBoxX, signBoxY + 8, { width: 120, align: 'center' });
    }

    doc.moveTo(signBoxX + 5, signBoxY + 28)
       .lineTo(signBoxX + 115, signBoxY + 28)
       .lineWidth(0.5)
       .strokeColor('#CBD5E1')
       .stroke();

    doc.font('Poppins-Medium').fontSize(6.8).fillColor('#64748B')
       .text(ownerTitle, signBoxX, signBoxY + 31, { width: 120, align: 'center' });

    // =========================================================================
    // 8. PINNED BOTTOM FOOTER
    // =========================================================================
    const footerY = PAGE_H - 40;
    doc.moveTo(MARGIN, footerY - 4)
       .lineTo(PAGE_W - MARGIN, footerY - 4)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    const footerParts = [];
    footerParts.push(`${hotelName}, ${management}`);
    if (address) footerParts.push(address);
    if (phone) footerParts.push(`Phone: ${phone}`);
    if (website) footerParts.push(website);

    doc.font('Poppins').fontSize(6.5).fillColor('#64748B')
       .text(footerParts.join('  •  '), MARGIN, footerY, { width: CONTENT_W, align: 'center' });

    doc.font('Poppins').fontSize(6).fillColor('#94A3B8')
       .text('This is a computer-generated booking invoice / confirmation voucher. Valid without physical stamp.', MARGIN, footerY + 10, { width: CONTENT_W, align: 'center' });

    // Finalize PDF document
    doc.end();
  });
}

/**
 * Assign a sequential Booking ID and matching Invoice Number (INV-...) to a booking if missing,
 * create signed token, generate and persist PDF in private data/invoices folder.
 */
async function getOrCreateBookingInvoice(booking, db, options = {}) {
  let modified = false;

  db.settings = db.settings || {};
  const prefix = (db.settings.bookingPrefix || db.settings.invoicePrefix || 'CV').trim();
  const year = db.settings.bookingYear ? String(db.settings.bookingYear).trim() : String(new Date().getFullYear());

  // 1. Ensure Sequential Booking ID exists
  if (!booking.bookingId || booking.bookingId === 'CV-SAMPLE-000') {
    let nextNum = parseInt(db.settings.bookingNextNumber || db.settings.invoiceNextNumber, 10);
    if (isNaN(nextNum) || nextNum < 1) nextNum = 1;

    const seqStr = String(nextNum).padStart(6, '0');
    booking.bookingId = `${prefix}-${year}-${seqStr}`;
    booking.invoiceNumber = `INV-${year}-${seqStr}`;
    booking.invoiceRevision = 0;
    db.settings.bookingNextNumber = nextNum + 1;
    db.settings.invoiceNextNumber = nextNum + 1;
    modified = true;
  } else if (!booking.invoiceNumber) {
    // If bookingId exists (e.g. CV-2026-000123), create matching invoice number INV-2026-000123
    const match = booking.bookingId.match(/^[A-Za-z]+-(\d{4})-(\d+)$/);
    if (match) {
      booking.invoiceNumber = `INV-${match[1]}-${match[2]}`;
    } else {
      let nextNum = parseInt(db.settings.invoiceNextNumber || db.settings.bookingNextNumber, 10);
      if (isNaN(nextNum) || nextNum < 1) nextNum = 1;
      const seqStr = String(nextNum).padStart(6, '0');
      booking.invoiceNumber = `INV-${year}-${seqStr}`;
      db.settings.invoiceNextNumber = nextNum + 1;
    }
    booking.invoiceRevision = 0;
    modified = true;
  }

  // 2. Generate secure signed token for guest view/download link (valid for 90 days)
  if (!booking.invoiceToken) {
    booking.invoiceToken = crypto.randomBytes(24).toString('hex');
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 90);
    booking.invoiceTokenExpiresAt = expDate.toISOString();
    modified = true;
  }

  // 3. PDF file destination in private folder
  const pdfFilename = `${booking.invoiceNumber || booking.bookingId}.pdf`;
  const pdfFullPath = path.join(INVOICES_DIR, pdfFilename);
  booking.invoicePdfPath = pdfFullPath;

  // 4. Generate or re-generate PDF file if missing or forced
  if (options.forceRegenerate || !fs.existsSync(pdfFullPath)) {
    try {
      await generateInvoicePDF(booking, db, {
        savePath: pdfFullPath,
        baseUrl: options.baseUrl
      });
      booking.invoiceGeneratedAt = new Date().toISOString();
      modified = true;
    } catch (genErr) {
      console.error(`Error generating PDF for ${booking.bookingId}:`, genErr);
      booking.invoiceGenError = genErr.message;
    }
  }

  return { booking, modified, pdfFullPath };
}

/**
 * Creates a revision for an invoice (e.g., INV-2026-000123-R1) upon edit,
 * keeping the EXACT SAME Booking ID, archiving the previous PDF and record into history.
 */
async function createInvoiceRevision(booking, db, reason = 'Booking Modified', options = {}) {
  db.settings = db.settings || {};
  booking.invoiceHistory = booking.invoiceHistory || [];

  // Archive current revision into history
  if (booking.invoiceNumber && booking.invoicePdfPath && fs.existsSync(booking.invoicePdfPath)) {
    booking.invoiceHistory.push({
      invoiceNumber: booking.invoiceNumber,
      revision: booking.invoiceRevision || 0,
      pdfPath: booking.invoicePdfPath,
      archivedAt: new Date().toISOString(),
      status: booking.status,
      reason
    });
  }

  // Base number without -R suffix
  const baseNum = (booking.invoiceNumber || `INV-${new Date().getFullYear()}-000001`).replace(/-R\d+$/, '');
  const nextRev = (booking.invoiceRevision || 0) + 1;
  const newInvoiceNum = `${baseNum}-R${nextRev}`;

  booking.invoiceNumber = newInvoiceNum;
  booking.invoiceRevision = nextRev;
  // NOTE: booking.bookingId REMAINS IDENTICAL!

  // Generate new PDF for this revision
  const newPdfFilename = `${newInvoiceNum}.pdf`;
  const newPdfFullPath = path.join(INVOICES_DIR, newPdfFilename);
  booking.invoicePdfPath = newPdfFullPath;

  try {
    await generateInvoicePDF(booking, db, {
      savePath: newPdfFullPath,
      baseUrl: options.baseUrl
    });
    booking.invoiceGeneratedAt = new Date().toISOString();
  } catch (err) {
    console.error(`Error creating invoice revision for ${booking.bookingId}:`, err);
    booking.invoiceGenError = err.message;
  }

  return { booking, newInvoiceNum, newPdfFullPath };
}

/**
 * Verify a guest's invoice token securely.
 */
function verifyInvoiceToken(token, db) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing or invalid token format' };
  }

  const cleanToken = token.trim();
  const booking = (db.bookings || []).find(b => b.invoiceToken === cleanToken);
  if (!booking) {
    return { valid: false, error: 'Invoice not found or invalid access token' };
  }

  if (booking.invoiceTokenExpiresAt) {
    const exp = new Date(booking.invoiceTokenExpiresAt);
    if (!isNaN(exp.getTime()) && Date.now() > exp.getTime()) {
      return { valid: false, error: 'This invoice link has expired after 90 days. Please contact front desk.' };
    }
  }

  return { valid: true, booking };
}

module.exports = {
  generateInvoicePDF,
  getOrCreateBookingInvoice,
  createInvoiceRevision,
  verifyInvoiceToken,
  formatINR,
  formatDateIST,
  formatDateStr
};

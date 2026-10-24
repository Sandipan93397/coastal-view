const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const FONTS_DIR = path.join(__dirname, 'assets', 'fonts');
const IMAGES_DIR = path.join(__dirname, 'assets', 'images');
const INVOICES_DIR = path.join(__dirname, 'data', 'invoices');

// Ensure invoices directory exists
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

// Indian Currency Formatter: ₹12,500
function formatINR(val) {
  const num = Math.round(Number(val) || 0);
  return '₹' + num.toLocaleString('en-IN');
}

// Clean date formatter: e.g. "20 Oct 2026"
function formatDateStr(dStr) {
  if (!dStr) return '';
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate().toString().padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dStr;
  }
}

// Register fonts on document
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
 * @param {Object} db - Current database object (for settings)
 * @param {Object} options - Options (savePath, baseUrl, stream, etc.)
 * @returns {Promise<Buffer|Object>}
 */
async function generateInvoicePDF(booking, db, options = {}) {
  const settings = (db && db.settings) || {};
  const isSample = !!options.isSample;

  // Determine active invoice number & revision
  const invoiceNum = booking.invoiceNumber || `CV-${new Date().getFullYear()}-0001`;
  const bookingId = booking.bookingId || 'CV-SAMPLE-000';
  const issueDate = formatDateStr(booking.createdAt || new Date());
  const checkInDate = formatDateStr(booking.checkIn);
  const checkOutDate = formatDateStr(booking.checkOut);

  // Hotel details from settings
  const hotelName = settings.hotelName || 'Coastal View';
  const management = settings.management || "Managed By Ani's";
  const address = settings.address || 'Rina Rd, Mandarmani, West Bengal 721455';
  const phone = settings.phone || '+91 98300 12345';
  const email = settings.email || 'reservations@coastalviewmandarmani.com';
  const website = settings.website || 'https://coastalviewmandarmani.com';
  const checkInTime = settings.checkInTime || '12:00 PM';
  const checkOutTime = settings.checkOutTime || '11:00 AM';

  // Tax settings
  const gstEnabled = !!settings.gstEnabled;
  const gstin = (settings.gstin || '').trim();
  const gstRate = gstEnabled ? (Number(settings.gstRate) || 12) : 0;

  // Logo file selection
  let logoPath = path.join(IMAGES_DIR, 'logo-invoice.png');
  if (settings.invoiceLogo && fs.existsSync(path.resolve(settings.invoiceLogo))) {
    logoPath = path.resolve(settings.invoiceLogo);
  } else if (!fs.existsSync(logoPath)) {
    logoPath = path.join(IMAGES_DIR, 'logo.png');
  }

  // QR Code Generation
  const baseUrl = options.baseUrl || 'https://coastalviewmandarmani.com';
  const qrTargetUrl = booking.invoiceToken
    ? `${baseUrl}/api/invoices/public/view/${booking.invoiceToken}`
    : 'https://maps.google.com/?q=Coastal+View+Mandarmani';

  let qrBuffer = null;
  try {
    qrBuffer = await QRCode.toBuffer(qrTargetUrl, {
      margin: 1,
      width: 150,
      color: {
        dark: '#073B4C',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.warn('QR Code generation notice:', err.message);
  }

  return new Promise((resolve, reject) => {
    // Standard A4: 595.28 x 841.89 points
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Invoice ${invoiceNum} - Coastal View Mandarmani`,
        Author: 'Coastal View Hotel',
        Subject: `Booking Confirmation Voucher & Invoice: ${booking.guestName}`,
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
    // 1. LUXURY PAGE BORDER & WATERMARK
    // =========================================================================
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;

    // Thin champagne gold outer border
    doc.rect(16, 16, PAGE_W - 32, PAGE_H - 32)
       .lineWidth(1.2)
       .strokeColor('#E8C77B')
       .stroke();

    // Subtle inner corner accents
    const inset = 20;
    doc.rect(inset, inset, PAGE_W - (inset * 2), PAGE_H - (inset * 2))
       .lineWidth(0.5)
       .strokeColor('#F3E5C8')
       .stroke();

    // Background faint logo watermark (centered)
    if (fs.existsSync(logoPath)) {
      doc.save();
      doc.opacity(0.045);
      const wmWidth = 220;
      doc.image(logoPath, (PAGE_W - wmWidth) / 2, 280, { width: wmWidth });
      doc.restore();
    }

    // =========================================================================
    // 2. HEADER: HOTEL BRAND & INVOICE TITLE
    // =========================================================================
    const topY = 32;

    // Left: Hotel Logo & Coordinates
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 34, topY, { width: 120 });
      } catch (imgErr) {
        // Fallback title if image error
        doc.font('Playfair-Bold').fontSize(18).fillColor('#073B4C').text('Coastal View', 34, topY);
      }
    } else {
      doc.font('Playfair-Bold').fontSize(18).fillColor('#073B4C').text('Coastal View', 34, topY);
    }

    // Hotel details below logo
    const brandInfoY = topY + 48;
    doc.font('Poppins-SemiBold').fontSize(9).fillColor('#073B4C').text('Coastal View', 34, brandInfoY);
    doc.font('Poppins-Medium').fontSize(7.5).fillColor('#06B6B0').text(management.toUpperCase(), 34, brandInfoY + 12, { characterSpacing: 1.2 });
    doc.font('Poppins').fontSize(7.5).fillColor('#475569').text(address, 34, brandInfoY + 23, { width: 220 });
    doc.font('Poppins').fontSize(7.5).fillColor('#475569').text(`Phone: ${phone}  •  Email: ${email}`, 34, brandInfoY + 34, { width: 250 });

    if (gstEnabled && gstin) {
      doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#073B4C').text(`GSTIN: ${gstin}`, 34, brandInfoY + 46);
    }

    // Right: Soft Sand Band for "INVOICE / BOOKING CONFIRMATION"
    const bandW = 240;
    const bandH = 96;
    const bandX = PAGE_W - 34 - bandW;
    const bandY = topY;

    // Sand background pill/card
    doc.roundedRect(bandX, bandY, bandW, bandH, 8)
       .fillColor('#FFF2DC')
       .fill();

    doc.roundedRect(bandX, bandY, bandW, bandH, 8)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    // Title
    doc.font('Playfair-Bold').fontSize(12).fillColor('#073B4C')
       .text('INVOICE / BOOKING CONFIRMATION', bandX + 12, bandY + 12, { width: bandW - 24, align: 'center' });

    // Gold divider in band
    doc.moveTo(bandX + 24, bandY + 28)
       .lineTo(bandX + bandW - 24, bandY + 28)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    // Invoice meta items
    const metaY = bandY + 34;
    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#64748B').text('INVOICE NO:', bandX + 16, metaY);
    doc.font('Poppins-Bold').fontSize(8.5).fillColor('#073B4C').text(invoiceNum, bandX + 85, metaY);

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#64748B').text('DATE:', bandX + 16, metaY + 14);
    doc.font('Poppins-Medium').fontSize(8).fillColor('#1E293B').text(issueDate, bandX + 85, metaY + 14);

    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#64748B').text('BOOKING ID:', bandX + 16, metaY + 28);
    doc.font('Poppins-Medium').fontSize(8).fillColor('#06B6B0').text(bookingId, bandX + 85, metaY + 28);

    // Status Badge inside Meta Band
    const isConfirmed = booking.status === 'Confirmed' || booking.status === 'Checked-in' || booking.status === 'Completed';
    const isCancelled = booking.status === 'Cancelled';
    const badgeText = isCancelled ? 'CANCELLED' : (isConfirmed ? 'ADVANCE PAID' : 'PAYMENT PENDING');
    const badgeBg = isCancelled ? '#FEE2E2' : (isConfirmed ? '#D1FAE5' : '#FEF3C7');
    const badgeColor = isCancelled ? '#B91C1C' : (isConfirmed ? '#065F46' : '#92400E');

    doc.roundedRect(bandX + 16, metaY + 44, bandW - 32, 16, 4)
       .fillColor(badgeBg)
       .fill();

    doc.font('Poppins-Bold').fontSize(7.5).fillColor(badgeColor)
       .text(badgeText, bandX + 16, metaY + 47, { width: bandW - 32, align: 'center', characterSpacing: 0.8 });

    // Gold full-width divider below Header
    const sepY = 142;
    doc.moveTo(34, sepY)
       .lineTo(PAGE_W - 34, sepY)
       .lineWidth(1)
       .strokeColor('#E8C77B')
       .stroke();

    // =========================================================================
    // 3. BILLED TO & STAY DETAILS (2-Column Luxury Cards)
    // =========================================================================
    const cardY = sepY + 8;
    const cardW = (PAGE_W - 68 - 14) / 2; // ~260 pt each
    const cardH = 92;

    // --- Card 1: Billed To ---
    const card1X = 34;
    doc.roundedRect(card1X, cardY, cardW, cardH, 6)
       .fillColor('#F8FAFC')
       .fill();
    doc.roundedRect(card1X, cardY, cardW, cardH, 6)
       .lineWidth(0.6)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins-SemiBold').fontSize(8).fillColor('#06B6B0')
       .text('BILLED TO (GUEST DETAILS)', card1X + 12, cardY + 8, { characterSpacing: 0.8 });

    doc.font('Poppins-Bold').fontSize(10).fillColor('#073B4C')
       .text(booking.guestName || 'Valued Guest', card1X + 12, cardY + 22, { width: cardW - 24, ellipsis: true });

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text(`Phone: ${booking.guestPhone || 'N/A'}`, card1X + 12, cardY + 36);

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text(`Email: ${booking.guestEmail || 'Not Provided'}`, card1X + 12, cardY + 49, { width: cardW - 24, ellipsis: true });

    if (booking.specialRequests) {
      doc.font('Poppins-Medium').fontSize(7).fillColor('#64748B')
         .text(`Note: "${booking.specialRequests.substring(0, 48)}${booking.specialRequests.length > 48 ? '...' : ''}"`, card1X + 12, cardY + 64, { width: cardW - 24 });
    }

    // --- Card 2: Reservation & Stay Details ---
    const card2X = card1X + cardW + 14;
    doc.roundedRect(card2X, cardY, cardW, cardH, 6)
       .fillColor('#F8FAFC')
       .fill();
    doc.roundedRect(card2X, cardY, cardW, cardH, 6)
       .lineWidth(0.6)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins-SemiBold').fontSize(8).fillColor('#06B6B0')
       .text('STAY & ACCOMMODATION OVERVIEW', card2X + 12, cardY + 8, { characterSpacing: 0.8 });

    doc.font('Poppins-Bold').fontSize(9).fillColor('#073B4C')
       .text(`${booking.roomName || 'Luxury Suite'} (${booking.roomsCount || 1} room${(booking.roomsCount || 1) > 1 ? 's' : ''})`, card2X + 12, cardY + 22, { width: cardW - 24, ellipsis: true });

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text(`Check-In:  ${checkInDate} (from ${checkInTime})`, card2X + 12, cardY + 36);

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text(`Check-Out: ${checkOutDate} (until ${checkOutTime})`, card2X + 12, cardY + 49);

    const guestCountStr = booking.children
      ? `${booking.adults || 2} Adults + ${booking.children} Child${booking.children > 1 ? 'ren' : ''}`
      : `${booking.adults || 2} Adult${(booking.adults || 2) > 1 ? 's' : ''}`;
    doc.font('Poppins-Medium').fontSize(7.5).fillColor('#64748B')
       .text(`Duration: ${booking.nights} Night(s)  •  Occupancy: ${guestCountStr}`, card2X + 12, cardY + 63);

    // =========================================================================
    // 4. ITEMIZED CHARGES TABLE
    // =========================================================================
    const tblY = cardY + cardH + 12;
    const colDescX = 34;
    const colDescW = 255;
    const colQtyX = colDescX + colDescW;
    const colQtyW = 75;
    const colRateX = colQtyX + colQtyW;
    const colRateW = 85;
    const colAmtX = colRateX + colRateW;
    const colAmtW = PAGE_W - 34 - colAmtX; // ~114 pt

    // Table Header Bar (Ocean Blue #073B4C)
    doc.roundedRect(34, tblY, PAGE_W - 68, 22, 4)
       .fillColor('#073B4C')
       .fill();

    doc.font('Poppins-SemiBold').fontSize(8).fillColor('#FFFFFF')
       .text('DESCRIPTION', colDescX + 10, tblY + 6)
       .text('QTY', colQtyX, tblY + 6, { width: colQtyW, align: 'center' })
       .text('RATE', colRateX, tblY + 6, { width: colRateW - 8, align: 'right' })
       .text('AMOUNT', colAmtX, tblY + 6, { width: colAmtW - 10, align: 'right' });

    // Table Lines Array
    const rows = [];

    // Line 1: Room accommodation
    const roomsCount = booking.roomsCount || 1;
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

    // Line 2: Private Transport (Vehicle Pricing Matrix)
    if (booking.needCar) {
      if (Array.isArray(booking.vehicleLines) && booking.vehicleLines.length > 0) {
        booking.vehicleLines.forEach(line => {
          let details = [];
          if (line.pickupPoint || line.pickupTime) {
            details.push(`Pickup: ${line.pickupPoint || 'Specified location'}${line.pickupTime ? ' @ ' + line.pickupTime : ''}`.trim());
          }
          if (line.dropPoint || line.dropTime) {
            details.push(`Drop: ${line.dropPoint || 'Specified location'}${line.dropTime ? ' @ ' + line.dropTime : ''}`.trim());
          }
          if (line.tourNotes) {
            details.push(`Notes: ${line.tourNotes}`);
          }
          const detStr = details.length ? ` • ${details.join(' | ')}` : '';
          const dayStr = line.days ? ` × ${line.days} day(s)` : '';
          const qtyStr = line.days ? `${line.quantity}U × ${line.days}d` : `${line.quantity} trip`;

          rows.push({
            title: `Private Transport: ${line.vehicleName || 'Vehicle'} · ${line.serviceLabel || 'Service'}`,
            subtitle: `${line.quantity} vehicle(s)${dayStr}${detStr} - Ani's Travels Fleet`,
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
          subtitle: `${vQty} vehicle(s) × ${vDays} day(s)${vTrip} - Ani's Travels Fleet`,
          qty: `${vQty} unit × ${vDays}d`,
          rate: formatINR(vRate),
          amount: formatINR(booking.carTotal || 0)
        });
      }
    }

    // Line 3: Candlelight Dinner (if applicable)
    if (booking.candlelightDinner) {
      const occasionStr = booking.dinnerOccasion ? ` - ${booking.dinnerOccasion}` : '';
      rows.push({
        title: `Candlelight Dinner Add-On (${booking.dinnerSetup || 'Beachside'} Romance)`,
        subtitle: `Private seaside candlelit setup${occasionStr} with bespoke chef curation`,
        qty: '1 Experience',
        rate: formatINR(booking.dinnerTotal || 0),
        amount: formatINR(booking.dinnerTotal || 0)
      });
    }

    // Line 4: Breakfast Add-on (only when selected)
    if (booking.breakfast) {
      const bfUnit = booking.breakfastUnit || 'per_person_per_day';
      const bfRate = booking.breakfastPrice !== undefined ? booking.breakfastPrice : 200;
      const bfDays = booking.breakfastDays || booking.nights || 1;
      const bfGuests = booking.breakfastGuests || booking.breakfastCount || ((booking.adults || 2) + (booking.children || 0));
      const isPerRoom = bfUnit === 'per_room_per_day';
      const bfQtyCount = isPerRoom ? (booking.roomsCount || 1) : bfGuests;
      const bfSub = booking.breakfastTotal !== undefined ? booking.breakfastTotal : (bfRate * bfQtyCount * bfDays);

      const subtitle = isPerRoom
        ? `${booking.roomsCount || 1} room(s) × ${bfDays} day(s) · Morning breakfast service (7:00 AM - 10:30 AM)`
        : `${bfGuests} guest(s) × ${bfDays} day(s) · Morning breakfast service (7:00 AM - 10:30 AM)`;
      const qtyStr = isPerRoom ? `${booking.roomsCount || 1}R × ${bfDays}d` : `${bfGuests}G × ${bfDays}d`;

      rows.push({
        title: 'Optional Breakfast Add-On (7:00 AM - 10:30 AM)',
        subtitle: subtitle,
        qty: qtyStr,
        rate: formatINR(bfRate),
        amount: formatINR(bfSub)
      });
    }

    // Render Table Rows
    let curRowY = tblY + 24;
    rows.forEach((r, idx) => {
      const rowH = 28;
      if (idx % 2 === 1) {
        doc.rect(34, curRowY, PAGE_W - 68, rowH)
           .fillColor('#F8FAFC')
           .fill();
      }

      // Border bottom
      doc.moveTo(34, curRowY + rowH)
         .lineTo(PAGE_W - 34, curRowY + rowH)
         .lineWidth(0.5)
         .strokeColor('#E2E8F0')
         .stroke();

      doc.font('Poppins-SemiBold').fontSize(8).fillColor('#073B4C')
         .text(r.title, colDescX + 10, curRowY + 4, { width: colDescW - 14, ellipsis: true });
      doc.font('Poppins').fontSize(6.8).fillColor('#64748B')
         .text(r.subtitle, colDescX + 10, curRowY + 15, { width: colDescW - 14, ellipsis: true });

      doc.font('Poppins').fontSize(7.5).fillColor('#334155')
         .text(r.qty, colQtyX, curRowY + 9, { width: colQtyW, align: 'center' });

      doc.font('Poppins').fontSize(7.5).fillColor('#334155')
         .text(r.rate, colRateX, curRowY + 9, { width: colRateW - 8, align: 'right' });

      doc.font('Poppins-Bold').fontSize(8).fillColor('#073B4C')
         .text(r.amount, colAmtX, curRowY + 9, { width: colAmtW - 10, align: 'right' });

      curRowY += rowH;
    });

    // Subtotal / Tax Calculation
    const totalAmount = Number(booking.totalAmount) || 0;
    let taxableAmount = totalAmount;
    let cgstAmt = 0;
    let sgstAmt = 0;

    if (gstEnabled && gstRate > 0) {
      // If GST is included or added
      // Prompt: "GST: don't add tax unless enabled in Admin Settings. If enabled, show the GSTIN, tax rate, and CGST/SGST lines."
      // Assuming inclusive rate or transparent breakdown:
      const baseBeforeTax = Math.round(totalAmount / (1 + (gstRate / 100)));
      const taxTotal = totalAmount - baseBeforeTax;
      taxableAmount = baseBeforeTax;
      cgstAmt = Math.round(taxTotal / 2);
      sgstAmt = taxTotal - cgstAmt;
    }

    // Totals Block
    const totalsStartY = curRowY + 4;
    const totLabelX = colRateX - 30;
    const totLabelW = 115;

    if (gstEnabled && gstRate > 0) {
      doc.font('Poppins').fontSize(7.5).fillColor('#64748B').text('Taxable Subtotal:', totLabelX, totalsStartY, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(8).fillColor('#334155').text(formatINR(taxableAmount), colAmtX, totalsStartY, { width: colAmtW - 10, align: 'right' });

      const halfRate = (gstRate / 2).toFixed(1).replace('.0', '');
      doc.font('Poppins').fontSize(7.5).fillColor('#64748B').text(`CGST (${halfRate}%):`, totLabelX, totalsStartY + 12, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(8).fillColor('#334155').text(formatINR(cgstAmt), colAmtX, totalsStartY + 12, { width: colAmtW - 10, align: 'right' });

      doc.font('Poppins').fontSize(7.5).fillColor('#64748B').text(`SGST (${halfRate}%):`, totLabelX, totalsStartY + 24, { width: totLabelW, align: 'right' });
      doc.font('Poppins-Medium').fontSize(8).fillColor('#334155').text(formatINR(sgstAmt), colAmtX, totalsStartY + 24, { width: colAmtW - 10, align: 'right' });

      curRowY = totalsStartY + 38;
    } else {
      curRowY = totalsStartY;
    }

    // Grand Total Row with soft champagne background
    doc.roundedRect(colDescX, curRowY, PAGE_W - 68, 22, 4)
       .fillColor('#FFF2DC')
       .fill();
    doc.roundedRect(colDescX, curRowY, PAGE_W - 68, 22, 4)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    doc.font('Poppins-Bold').fontSize(9).fillColor('#073B4C')
       .text('TOTAL BOOKING AMOUNT:', colDescX + 10, curRowY + 6);
    doc.font('Poppins-Bold').fontSize(11).fillColor('#073B4C')
       .text(formatINR(totalAmount), colAmtX, curRowY + 5, { width: colAmtW - 10, align: 'right' });

    // =========================================================================
    // 5. PAYMENT BREAKDOWN (HIGHLIGHTED 20% ADVANCE & 80% BALANCE BOX)
    // =========================================================================
    const payBoxY = curRowY + 28;
    const payBoxH = 68;

    // Highlighted card container
    doc.roundedRect(34, payBoxY, PAGE_W - 68, payBoxH, 6)
       .fillColor('#FFFDF9')
       .fill();
    doc.roundedRect(34, payBoxY, PAGE_W - 68, payBoxH, 6)
       .lineWidth(1)
       .strokeColor('#E8C77B')
       .stroke();

    const payAdv = Number(booking.payNowAdvance) || Math.round((totalAmount * 20) / 100);
    const payBal = Number(booking.payAtHotelBalance) || (totalAmount - payAdv);

    // Left split: 20% Advance Status
    const payCol1X = 46;
    const payColW = (PAGE_W - 68 - 36) / 2;

    doc.font('Poppins-SemiBold').fontSize(8).fillColor('#06B6B0')
       .text('PAYMENT SUMMARY & SCHEDULE', payCol1X, payBoxY + 8);

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text('20% Advance Booking Fee:', payCol1X, payBoxY + 22);
    doc.font('Poppins-Bold').fontSize(10).fillColor('#073B4C')
       .text(formatINR(payAdv), payCol1X + 130, payBoxY + 21);

    const payModeText = isConfirmed
      ? `Advance Received on ${issueDate} via ${booking.paymentMode || 'Direct Transfer'}${booking.transactionId ? ` (Txn ID: ${booking.transactionId})` : ''}`
      : `Advance Pending (Transfer to ${settings.paymentUPI || 'coastalview@upi'} to confirm)`;

    doc.font('Poppins-Medium').fontSize(6.8).fillColor(isConfirmed ? '#059669' : '#D97706')
       .text(payModeText, payCol1X, payBoxY + 36, { width: payColW - 10 });

    doc.font('Poppins').fontSize(6.5).fillColor('#94A3B8')
       .text(`* ${settings.advancePolicyNote || 'The 20% advance is non-refundable.'}`, payCol1X, payBoxY + 50);

    // Right split: 80% Balance Due at Hotel
    const payCol2X = payCol1X + payColW + 12;

    doc.moveTo(payCol2X - 6, payBoxY + 8)
       .lineTo(payCol2X - 6, payBoxY + payBoxH - 8)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins').fontSize(8).fillColor('#475569')
       .text('80% Balance Payable at Hotel:', payCol2X, payBoxY + 22);
    doc.font('Poppins-Bold').fontSize(10).fillColor('#06B6B0')
       .text(formatINR(payBal), payCol2X + 140, payBoxY + 21);

    doc.font('Poppins').fontSize(7).fillColor('#475569')
       .text('Payable upon check-in / check-out directly at resort desk.', payCol2X, payBoxY + 36);

    doc.font('Poppins').fontSize(6.5).fillColor('#64748B')
       .text('Accepted methods: UPI, NetBanking, Debit/Credit Cards & Cash.', payCol2X, payBoxY + 50);

    // =========================================================================
    // 6. TERMS & IMPORTANT NOTES
    // =========================================================================
    const termsY = payBoxY + payBoxH + 10;
    doc.font('Poppins-SemiBold').fontSize(7.5).fillColor('#073B4C')
       .text('TERMS & IMPORTANT RESORT POLICIES:', 34, termsY);

    const defaultTerms = [
      `1. Advance Policy: The 20% advance is non-refundable upon cancellation.`,
      `2. Remaining 80% balance is payable at check-in / check-out at the hotel desk.`,
      `3. Check-In & Check-Out: Check-in from ${checkInTime}; Check-out until ${checkOutTime}. Early check-in is subject to availability.`,
      `4. Guest Identification: Valid Government photo ID (Aadhaar, Passport, Voter ID, Driving License) is mandatory for all adult guests.`,
      `5. Hotel Rules: Outside food and beverages are strictly not allowed inside hotel premises.`
    ];

    const termsToRender = (Array.isArray(settings.invoiceTerms) && settings.invoiceTerms.length > 0)
      ? settings.invoiceTerms
      : defaultTerms;

    let termLineY = termsY + 11;
    termsToRender.slice(0, 5).forEach(t => {
      doc.font('Poppins').fontSize(6.8).fillColor('#475569')
         .text(t, 34, termLineY, { width: PAGE_W - 68 });
      termLineY += 9;
    });

    // =========================================================================
    // 7. QR CODE, SIGNATURE & THANK YOU MESSAGE
    // =========================================================================
    const signAreaY = termLineY + 6;

    // Divider line
    doc.moveTo(34, signAreaY)
       .lineTo(PAGE_W - 34, signAreaY)
       .lineWidth(0.8)
       .strokeColor('#E8C77B')
       .stroke();

    const bottomBlockY = signAreaY + 8;

    // Left: QR Code linking to online verification / hotel location
    if (qrBuffer) {
      doc.image(qrBuffer, 34, bottomBlockY, { width: 52 });
      doc.font('Poppins').fontSize(6).fillColor('#94A3B8')
         .text('Scan to Verify / Location', 28, bottomBlockY + 54, { width: 64, align: 'center' });
    }

    // Middle: Warm Luxury Thank You Note
    const middleX = 104;
    const middleW = 280;
    doc.font('Playfair-Bold').fontSize(10).fillColor('#073B4C')
       .text('Thank you for choosing Coastal View!', middleX, bottomBlockY + 6);

    doc.font('Poppins').fontSize(7.2).fillColor('#475569')
       .text(
         'We look forward to welcoming you to Mandarmani beach. If you require private transport coordination or custom dining, please contact our concierge desk.',
         middleX,
         bottomBlockY + 20,
         { width: middleW }
       );

    // Right: Signature Area ("Anirban Das, Owner")
    const signBoxX = PAGE_W - 34 - 150;
    const signBoxY = bottomBlockY;

    // Check if owner signature image exists
    let renderedSigImg = false;
    if (settings.signatureImageUrl && fs.existsSync(path.resolve(settings.signatureImageUrl))) {
      try {
        doc.image(path.resolve(settings.signatureImageUrl), signBoxX + 15, signBoxY, { width: 120, height: 35 });
        renderedSigImg = true;
      } catch (e) {
        renderedSigImg = false;
      }
    }

    if (!renderedSigImg) {
      // Clean signature styling with text (as requested: "Anirban Das, Owner (name only, text, no fake signature image)")
      doc.font('Playfair-Bold').fontSize(11).fillColor('#073B4C')
         .text(settings.ownerName || 'Anirban Das', signBoxX, signBoxY + 12, { width: 150, align: 'center' });
    }

    // Line below signature
    doc.moveTo(signBoxX + 10, signBoxY + 30)
       .lineTo(signBoxX + 140, signBoxY + 30)
       .lineWidth(0.5)
       .strokeColor('#CBD5E1')
       .stroke();

    doc.font('Poppins-Medium').fontSize(7.2).fillColor('#64748B')
       .text(settings.ownerTitle || 'Owner, Coastal View', signBoxX, signBoxY + 33, { width: 150, align: 'center' });

    // =========================================================================
    // 8. LUXURY BOTTOM FOOTER
    // =========================================================================
    const footerY = PAGE_H - 44;
    doc.moveTo(34, footerY - 4)
       .lineTo(PAGE_W - 34, footerY - 4)
       .lineWidth(0.5)
       .strokeColor('#E2E8F0')
       .stroke();

    doc.font('Poppins').fontSize(6.8).fillColor('#64748B')
       .text(
         `${hotelName}, ${management}  •  ${address}  •  Phone: ${phone}  •  ${website}`,
         34,
         footerY,
         { width: PAGE_W - 68, align: 'center' }
       );

    doc.font('Poppins').fontSize(6.2).fillColor('#94A3B8')
       .text(
         'This is a computer-generated booking invoice / confirmation voucher. Valid without physical stamp.',
         34,
         footerY + 10,
         { width: PAGE_W - 68, align: 'center' }
       );

    // Finalize PDF document
    doc.end();
  });
}

/**
 * Assign a sequential invoice number to a booking if missing, create signed token,
 * generate and persist PDF in private data/invoices folder.
 */
async function getOrCreateBookingInvoice(booking, db, options = {}) {
  let modified = false;

  // Initialize invoice settings if absent
  db.settings = db.settings || {};
  const prefix = (db.settings.invoicePrefix || 'CV').trim();
  const year = new Date().getFullYear();

  if (!booking.invoiceNumber) {
    let nextNum = parseInt(db.settings.invoiceNextNumber, 10);
    if (isNaN(nextNum) || nextNum < 1) nextNum = 1;

    // Formatting: CV-2026-0001
    const seqStr = nextNum.toString().padStart(4, '0');
    booking.invoiceNumber = `${prefix}-${year}-${seqStr}`;
    booking.invoiceRevision = 0;
    db.settings.invoiceNextNumber = nextNum + 1;
    modified = true;
  }

  // Generate secure signed token for guest view/download link (valid for 90 days)
  if (!booking.invoiceToken) {
    booking.invoiceToken = crypto.randomBytes(24).toString('hex');
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 90);
    booking.invoiceTokenExpiresAt = expDate.toISOString();
    modified = true;
  }

  // PDF file destination in private folder
  const pdfFilename = `${booking.invoiceNumber}.pdf`;
  const pdfFullPath = path.join(INVOICES_DIR, pdfFilename);
  booking.invoicePdfPath = pdfFullPath;

  // Generate or re-generate PDF file if missing or forced
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
      // Non-blocking: record error flag
      booking.invoiceGenError = genErr.message;
    }
  }

  return { booking, modified, pdfFullPath };
}

/**
 * Creates a revision for an invoice (e.g., CV-2026-0001-R1) upon cancellation or edit,
 * archiving the previous PDF and record into history.
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
  const baseNum = (booking.invoiceNumber || 'CV-2026-0001').replace(/-R\d+$/, '');
  const nextRev = (booking.invoiceRevision || 0) + 1;
  const newInvoiceNum = `${baseNum}-R${nextRev}`;

  booking.invoiceNumber = newInvoiceNum;
  booking.invoiceRevision = nextRev;

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
  formatDateStr
};

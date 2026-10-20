<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'GET') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $bookings = array_reverse($db['bookings'] ?? []);
    echo json_encode(['success' => true, 'bookings' => $bookings]);
    exit;
}

if ($method === 'POST') {
    $input = getJsonInput();
    $roomId = $input['roomId'] ?? '';
    $checkIn = $input['checkIn'] ?? '';
    $checkOut = $input['checkOut'] ?? '';
    $guestName = $input['guestName'] ?? '';
    $guestPhone = $input['guestPhone'] ?? '';

    if (!$roomId || !$checkIn || !$checkOut || !$guestName || !$guestPhone) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Missing required fields']);
        exit;
    }

    $selectedRoom = null;
    foreach ($db['rooms'] as $r) {
        if ($r['id'] === $roomId) {
            $selectedRoom = $r;
            break;
        }
    }

    if (!$selectedRoom) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Room not found']);
        exit;
    }
    if ($selectedRoom['isSoldOut']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Selected room is Sold Out']);
        exit;
    }

    $in = strtotime($checkIn);
    $out = strtotime($checkOut);
    $nights = max(1, round(($out - $in) / 86400));
    $roomsCount = intval($input['roomsCount'] ?? 1) ?: 1;

    // Calculate availability by inventory quantity for date range
    $totalInventory = intval($selectedRoom['quantity'] ?? 1) ?: 1;
    $blockedQuantity = intval($selectedRoom['blockedQuantity'] ?? 0);
    
    // Check overlapping bookings (checkout date is not occupied)
    $activeBookings = array_filter($db['bookings'] ?? [], function($b) use ($roomId) {
        return ($b['roomId'] ?? '') === $roomId && in_array($b['status'] ?? '', ['Confirmed', 'Checked-in', 'Pending Advance', 'Pending']);
    });

    $minAvailable = $totalInventory;
    for ($t = $in; $t < $out; $t += 86400) {
        $nightStr = date('Y-m-d', $t);
        $bookedOnNight = 0;
        foreach ($activeBookings as $b) {
            $bIn = $b['checkIn'] ?? '';
            $bOut = $b['checkOut'] ?? '';
            if ($bIn <= $nightStr && $bOut > $nightStr) {
                $bookedOnNight += intval($b['roomsCount'] ?? 1) ?: 1;
            }
        }
        $availOnNight = max(0, $totalInventory - $bookedOnNight - $blockedQuantity);
        if ($availOnNight < $minAvailable) {
            $minAvailable = $availOnNight;
        }
    }

    if ($minAvailable <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => "We are sorry, but {$selectedRoom['name']} is completely sold out for your requested dates ({$checkIn} to {$checkOut}). Please select alternative dates or explore our other suites."]);
        exit;
    }

    if ($roomsCount > $minAvailable) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => "Only {$minAvailable} room(s) available for {$selectedRoom['name']} between {$checkIn} and {$checkOut}. You requested {$roomsCount} room(s). Please adjust your room count."]);
        exit;
    }

    // Formula 1: Room cost = room price per night × number of nights × number of rooms
    $roomSubtotal = $selectedRoom['price'] * $nights * $roomsCount;
    $roomLine = "Room: ₹" . number_format($selectedRoom['price']) . " × {$nights} night" . ($nights > 1 ? 's' : '') . " × {$roomsCount} room" . ($roomsCount > 1 ? 's' : '');

    // Formula 2: Transport cost (only if “Need a car?” is ON) = selected vehicle price (Toto / Auto / Car) × quantity × number of days
    $needCar = !empty($input['needCar']);
    $carTotal = 0;
    $selectedVehicle = null;
    $vehicleQty = 0;
    $transportLine = '';
    $vShortName = 'Car';

    if ($needCar) {
        $vType = strtolower($input['vehicleType'] ?? 'car');
        foreach ($db['vehicles'] ?? [] as $v) {
            if ($v['id'] === $vType || strtolower($v['name']) === $vType || strpos(strtolower($v['name']), $vType) !== false) {
                $selectedVehicle = $v;
                break;
            }
        }
        if (!$selectedVehicle) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Selected vehicle type does not exist']);
            exit;
        }
        if (empty($selectedVehicle['enabled'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => "{$selectedVehicle['name']} is currently unavailable."]);
            exit;
        }

        $maxQ = intval($selectedVehicle['maxQuantity'] ?? 5) ?: 5;
        $vehicleQty = min($maxQ, max(1, intval($input['vehicleQuantity'] ?? ($input['carCount'] ?? 1))));
        $carTotal = floatval($selectedVehicle['pricePerDay']) * $vehicleQty * $nights;

        $vShortName = ($selectedVehicle['id'] === 'toto') ? 'Toto' : (($selectedVehicle['id'] === 'auto') ? 'Auto' : (($selectedVehicle['id'] === 'car') ? 'Car' : trim(explode('(', $selectedVehicle['name'])[0])));
        $transportLine = "{$vShortName} × {$vehicleQty} × {$nights} day" . ($nights > 1 ? 's' : '');
    }

    // Formula 3: Candlelight dinner (only if selected) = dinner price × number of dinners (or guests, as set in admin)
    $candlelightDinner = !empty($input['candlelightDinner']);
    $dinnerSetup = $input['dinnerSetup'] ?? 'Beachside';
    $dinnerTotal = 0;
    $dinnerLine = '';
    $dinnerPrice = 0;
    $dinnerMultiplier = 1;

    if ($candlelightDinner) {
        $dinnerPrice = ($dinnerSetup === 'Beachside')
            ? ($db['settings']['candlelightDinnerBeachside'] ?? 3500)
            : ($db['settings']['candlelightDinnerPoolside'] ?? 2800);

        $isPerGuest = ($db['settings']['candlelightPricingMode'] ?? 'per_dinner') === 'per_guest';
        $dinnerMultiplier = $isPerGuest ? max(1, intval($input['adults'] ?? 2)) : max(1, intval($input['dinnerCount'] ?? 1));
        $dinnerTotal = $dinnerPrice * $dinnerMultiplier;

        if ($isPerGuest) {
            $dinnerLine = "Candlelight dinner ({$dinnerSetup}) × {$dinnerMultiplier} guests";
        } elseif ($dinnerMultiplier > 1) {
            $dinnerLine = "Candlelight dinner ({$dinnerSetup}) × {$dinnerMultiplier}";
        } else {
            $dinnerLine = "Candlelight dinner";
        }
    }

    // Formula: Optional Breakfast Add-on
    $breakfast = !empty($input['breakfast']);
    $bfSettings = $db['settings']['breakfastAddon'] ?? [];
    $bfEnabled = ($db['settings']['breakfastEnabled'] ?? true) && ($bfSettings['enabled'] ?? true);
    $bfUnit = $db['settings']['breakfastUnit'] ?? ($bfSettings['unit'] ?? 'per_person_per_day');
    $bfPrice = floatval($db['settings']['breakfastPrice'] ?? ($bfSettings['price'] ?? 200));
    $breakfastTotal = 0;
    $breakfastLine = '';
    $bfQty = 0;

    if ($breakfast && $bfEnabled) {
        if ($bfUnit === 'per_room_per_day') {
            $bfQty = $roomsCount;
            $breakfastTotal = $bfPrice * $roomsCount * $nights;
            $breakfastLine = "Breakfast × {$roomsCount} room" . ($roomsCount > 1 ? 's' : '') . " × {$nights} day" . ($nights > 1 ? 's' : '') . " = ₹" . number_format($breakfastTotal);
        } else {
            $effectiveBfGuests = max(1, intval($input['breakfastGuests'] ?? ($input['breakfastCount'] ?? (intval($input['adults'] ?? 2) + intval($input['children'] ?? 0)))));
            $bfQty = $effectiveBfGuests;
            $breakfastTotal = $bfPrice * $effectiveBfGuests * $nights;
            $breakfastLine = "Breakfast × {$effectiveBfGuests} guest" . ($effectiveBfGuests > 1 ? 's' : '') . " × {$nights} day" . ($nights > 1 ? 's' : '') . " = ₹" . number_format($breakfastTotal);
        }
    }

    // Formula 4: Estimated Total = room cost + transport cost + candlelight dinner + breakfast
    $baseSubtotal = $roomSubtotal + $carTotal + $dinnerTotal + $breakfastTotal;

    // Tax setting: Don't add taxes unless a tax setting is enabled in admin
    $taxAmount = 0;
    $taxLine = '';
    $isTaxEnabled = !empty($db['settings']['enableTax']);
    $taxPercentage = $isTaxEnabled ? floatval($db['settings']['taxPercentage'] ?? 0) : 0;
    if ($isTaxEnabled && $taxPercentage > 0) {
        $taxAmount = round(($baseSubtotal * $taxPercentage) / 100);
        $taxLine = "GST / Taxes ({$taxPercentage}%): ₹" . number_format($taxAmount);
    }

    // Server-side authoritative recalculation: ignore any total sent from the browser
    $totalAmount = $baseSubtotal + $taxAmount;

    $advPercent = $db['settings']['advancePercentage'] ?? 20;
    $payNowAdvance = round(($totalAmount * $advPercent) / 100);
    $payAtHotel = $totalAmount - $payNowAdvance;

    $bookingId = 'CV-' . date('Y') . '-' . rand(100000, 999999);

    $breakdownLines = [$roomLine];
    if ($needCar && $transportLine) $breakdownLines[] = $transportLine;
    if ($candlelightDinner && $dinnerLine) $breakdownLines[] = $dinnerLine;
    if ($taxLine) $breakdownLines[] = $taxLine;

    $breakdown = [
        'roomCost' => $roomSubtotal,
        'transportCost' => $carTotal,
        'candlelightCost' => $dinnerTotal,
        'taxAmount' => $taxAmount,
        'subtotal' => $baseSubtotal,
        'totalAmount' => $totalAmount,
        'lines' => $breakdownLines,
        'details' => [
            'room' => ['name' => $selectedRoom['name'], 'price' => $selectedRoom['price'], 'nights' => $nights, 'roomsCount' => $roomsCount, 'subtotal' => $roomSubtotal, 'line' => $roomLine],
            'transport' => $needCar && $selectedVehicle ? ['vehicle' => $selectedVehicle['name'], 'shortName' => $vShortName, 'rate' => $selectedVehicle['pricePerDay'], 'quantity' => $vehicleQty, 'days' => $nights, 'subtotal' => $carTotal, 'line' => $transportLine] : null,
            'candlelight' => $candlelightDinner ? ['setup' => $dinnerSetup, 'price' => $dinnerPrice, 'multiplier' => $dinnerMultiplier, 'subtotal' => $dinnerTotal, 'line' => $dinnerLine] : null,
            'tax' => $taxAmount > 0 ? ['percentage' => $taxPercentage, 'amount' => $taxAmount, 'line' => $taxLine] : null
        ]
    ];

    $booking = [
        'bookingId' => $bookingId,
        'roomId' => $selectedRoom['id'],
        'roomName' => $selectedRoom['name'],
        'roomPrice' => $selectedRoom['price'],
        'checkIn' => $checkIn,
        'checkOut' => $checkOut,
        'nights' => $nights,
        'adults' => intval($input['adults'] ?? 2) ?: 2,
        'children' => intval($input['children'] ?? 0),
        'roomsCount' => $roomsCount,
        'needCar' => $needCar,
        'carCount' => $needCar ? $vehicleQty : 0,
        'carTotal' => $carTotal,
        'vehicleType' => $needCar && $selectedVehicle ? $selectedVehicle['id'] : null,
        'vehicleName' => $needCar && $selectedVehicle ? $selectedVehicle['name'] : null,
        'vehicleQuantity' => $needCar ? $vehicleQty : 0,
        'vehiclePricePerDay' => $needCar && $selectedVehicle ? $selectedVehicle['pricePerDay'] : 0,
        'vehicleDays' => $needCar ? $nights : 0,
        'vehicleTripType' => $needCar ? ($input['vehicleTripType'] ?? (!empty($db['vehicleSettings']['enableTripType']) ? 'Full-day tour' : 'Standard trip')) : null,
        'transportCost' => $carTotal,
        'transportSummary' => $transportLine,
        'breakfast' => ($breakfast && $bfEnabled),
        'breakfastGuests' => $bfQty,
        'breakfastPrice' => $bfPrice,
        'breakfastUnit' => $bfUnit,
        'breakfastDays' => $nights,
        'breakfastTotal' => $breakfastTotal,
        'breakfastLine' => $breakfastLine,
        'candlelightDinner' => $candlelightDinner,
        'dinnerSetup' => $candlelightDinner ? $dinnerSetup : null,
        'dinnerCount' => $candlelightDinner ? $dinnerMultiplier : 0,
        'dinnerOccasion' => $candlelightDinner ? ($input['dinnerOccasion'] ?? 'Romantic Getaway') : null,
        'dinnerTotal' => $dinnerTotal,
        'roomSubtotal' => $roomSubtotal,
        'taxAmount' => $taxAmount,
        'totalAmount' => $totalAmount,
        'breakdown' => $breakdown,
        'advancePercentage' => $advPercent,
        'payNowAdvance' => $payNowAdvance,
        'payAtHotelBalance' => $payAtHotel,
        'advancePolicyNote' => $db['settings']['advancePolicyNote'] ?? 'The 20% advance is non-refundable.',
        'guestName' => $guestName,
        'guestPhone' => $guestPhone,
        'guestEmail' => $input['guestEmail'] ?? '',
        'specialRequests' => $input['specialRequests'] ?? '',
        'status' => 'Pending Advance',
        'createdAt' => date('c')
    ];

    // Build confirmation email HTML & record in outbox
    $transportRow = $needCar ? "<tr><td style='padding:10px;border-bottom:1px solid #E2E8F0;'><strong>{$booking['vehicleName']}</strong> ({$vehicleQty} vehicle, {$nights} days)</td><td style='padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;'>₹" . number_format($carTotal) . "</td></tr>" : "";
    $dinnerRow = $candlelightDinner ? "<tr><td style='padding:10px;border-bottom:1px solid #E2E8F0;'>Candlelight Dinner ({$dinnerSetup})</td><td style='padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;'>₹" . number_format($dinnerTotal) . "</td></tr>" : "";
    $taxRow = ($taxAmount > 0) ? "<tr><td style='padding:10px;border-bottom:1px solid #E2E8F0;'>GST / Taxes ({$taxPercentage}%)</td><td style='padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;'>₹" . number_format($taxAmount) . "</td></tr>" : "";

    $emailHtml = "
    <div style='font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #E8C77B;border-radius:12px;overflow:hidden;'>
      <div style='background:#073B4C;color:#fff;padding:24px;text-align:center;'>
        <h2 style='margin:0;color:#E8C77B;'>Coastal View, Managed By Ani's</h2>
        <p style='margin:4px 0 0;font-size:13px;'>BOOKING CONFIRMATION: {$bookingId}</p>
      </div>
      <div style='padding:20px;'>
        <p>Dear <strong>{$guestName}</strong>,</p>
        <p>Your beachfront reservation details:</p>
        <table style='width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;'>
          <tr><td style='padding:10px;border-bottom:1px solid #E2E8F0;'>{$selectedRoom['name']} ({$roomsCount} room, {$nights} nights)</td><td style='padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;'>₹" . number_format($roomSubtotal) . "</td></tr>
          {$transportRow}
          {$dinnerRow}
          {$taxRow}
          <tr style='font-weight:bold;color:#073B4C;'><td style='padding:10px;'>Total Reservation Amount</td><td style='padding:10px;text-align:right;'>₹" . number_format($totalAmount) . "</td></tr>
          <tr style='color:#FF6B5E;'><td style='padding:10px;'>20% Advance Payable Now</td><td style='padding:10px;text-align:right;'>₹" . number_format($payNowAdvance) . "</td></tr>
          <tr style='color:#06B6B0;'><td style='padding:10px;'>80% Balance at Hotel</td><td style='padding:10px;text-align:right;'>₹" . number_format($payAtHotel) . "</td></tr>
        </table>
        <p style='font-size:12px;color:#FF6B5E;'>* {$booking['advancePolicyNote']}</p>
        <p style='font-size:13px;'>UPI ID: <strong>" . ($db['settings']['paymentUPI'] ?? 'coastalview@upi') . "</strong><br>WhatsApp: <strong>" . ($db['settings']['whatsapp'] ?? '+91 98300 12345') . "</strong></p>
      </div>
    </div>";

    $emailStatus = 'Saved in Outbox';
    if (!empty($input['guestEmail'])) {
        $headers = "MIME-Version: 1.0\r\n";
        $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
        $headers .= "From: Coastal View <" . ($db['settings']['email'] ?? 'reservations@coastalviewmandarmani.com') . ">\r\n";
        $sent = @mail($input['guestEmail'], "Booking Confirmation: {$bookingId} - Coastal View", $emailHtml, $headers);
        if ($sent) $emailStatus = 'Sent via Mail';
    }

    $db['emailOutbox'] = $db['emailOutbox'] ?? [];
    array_unshift($db['emailOutbox'], [
        'id' => 'email-' . time(),
        'bookingId' => $bookingId,
        'to' => $input['guestEmail'] ?: 'Guest',
        'subject' => "Booking Confirmation: {$bookingId} - Coastal View",
        'html' => $emailHtml,
        'sentAt' => date('c'),
        'status' => $emailStatus
    ]);
    if (count($db['emailOutbox']) > 200) {
        $db['emailOutbox'] = array_slice($db['emailOutbox'], 0, 200);
    }

    $booking['emailStatus'] = $emailStatus;
    $db['bookings'] = $db['bookings'] ?? [];
    $db['bookings'][] = $booking;
    saveDB($db);

    echo json_encode([
        'success' => true,
        'message' => 'Booking created successfully',
        'booking' => $booking
    ]);
    exit;
}

if ($method === 'PATCH') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $id = $_GET['id'] ?? '';
    $input = getJsonInput();
    $status = $input['status'] ?? '';

    foreach ($db['bookings'] as &$b) {
        if ($b['bookingId'] === $id) {
            $b['status'] = $status;
            saveDB($db);
            echo json_encode(['success' => true, 'booking' => $b]);
            exit;
        }
    }
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Booking not found']);
    exit;
}

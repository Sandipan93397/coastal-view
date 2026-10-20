<?php
require_once __DIR__ . '/db_helper.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($action === 'chat' || ($method === 'POST' && !$action)) {
    $input = getJsonInput();
    $message = trim($input['message'] ?? '');
    $lang = $input['lang'] ?? 'en';
    $text = strtolower($message);

    $availableRooms = array_filter($db['rooms'], fn($r) => empty($r['isSoldOut']));
    $soldOutRooms = array_filter($db['rooms'], fn($r) => !empty($r['isSoldOut']));

    $isBengali = ($lang === 'bn') || preg_match('/[\x{0980}-\x{09FF}]/u', $message);
    $isHindi = ($lang === 'hi') || preg_match('/[\x{0900}-\x{097F}]/u', $message);

    $reply = '';
    $requiresCallbackForm = false;
    $actionChips = [];

    // Inclusions & Complimentary services query
    if (
        str_contains($text, 'inclusion') || str_contains($text, 'included') || 
        str_contains($text, 'complimentary') ||
        str_contains($text, 'অন্তর্ভুক্ত') || str_contains($text, 'কী অন্তর্ভুক্ত') ||
        str_contains($text, 'शामिल') || str_contains($text, 'क्या शामिल')
    ) {
        $firstRoom = $availableRooms[0] ?? ($db['rooms'][0] ?? []);
        $incs = $firstRoom['inclusions'] ?? [

            ['text' => 'AC'],
            ['text' => 'Free Wi-Fi'],
            ['text' => 'Smart TV'],
            ['text' => 'Pool access'],
            ['text' => 'Housekeeping'],
            ['text' => 'Hot water']
        ];
        $incLines = implode("\n", array_map(fn($i) => "✅ " . (is_array($i) ? $i['text'] : $i), $incs));
        $exts = $firstRoom['extras'] ?? [
            ['text' => 'Candlelight Dinner'],
            ['text' => 'Car / Toto / Auto pickup']
        ];
        $extLines = implode("\n", array_map(fn($e) => "➕ " . (is_array($e) ? $e['text'] : $e), $exts));

        if ($isBengali) {
            $reply = "কোস্টাল ভিউ হোটেলে রুমের সাথে অন্তর্ভুক্ত সুবিধাসমূহ (Inclusions):\n\n{$incLines}\n\nঅতিরিক্ত প্রদেয় সুবিধা (Extras):\n{$extLines}\n\nনীতিমালা: ২০% অফেরতযোগ্য অগ্রিম দিয়ে বুকিং নিশ্চিত করুন; অবশিষ্ট ৮০% হোটেলে পৌঁছানোর পর প্রদেয়।";
        } elseif ($isHindi) {
            $reply = "कोस्टल व्यू होटल में कमरे के साथ शामिल सुविधाएं (Included in your stay):\n\n{$incLines}\n\nअतिरिक्त सुविधाएं (Extras - pay extra):\n{$extLines}\n\nनीति: बुकिंग कन्फर्म करने के लिए 20% एडवांस, शेष 80% होटल में देय है।";
        } else {
            $reply = "Official Room Inclusions at Coastal View (Verified from Front Desk Database):\n\nIncluded in your stay:\n{$incLines}\n\nExtras (Pay Extra):\n{$extLines}\n\nPayment Policy: Pay 20% non-refundable advance to confirm your stay; the remaining 80% is payable at the hotel.";
        }
        $actionChips = ['Book a Room', 'Show Rooms & Prices', 'Candlelight Dinner'];

    } elseif (str_contains($text, 'availability') || str_contains($text, 'available') || str_contains($text, 'বুকিং') || str_contains($text, 'উপলব্ধ') || str_contains($text, 'খালি')) {
        if ($isBengali) {
            $roomList = implode("\n", array_map(fn($r) => "• {$r['name']} - ₹" . number_format($r['price']) . "/রাত ({$r['tag']})", $availableRooms));
            $soldList = !empty($soldOutRooms) ? "\n\nবর্তমানে বুকড (Sold Out): " . implode(', ', array_column($soldOutRooms, 'name')) : '';
            $reply = "আমাদের বর্তমান রুমের অবস্থা:\n\n{$roomList}{$soldList}\n\nনীতিমালা: ২০% অগ্রিম জমা দিয়ে বুকিং নিশ্চিত করতে হয় (অফেরতযোগ্য), বাকি ৮০% হোটেলে পৌঁছে দিতে হবে।";
        } elseif ($isHindi) {
            $roomList = implode("\n", array_map(fn($r) => "• {$r['name']} - ₹" . number_format($r['price']) . "/रात ({$r['tag']})", $availableRooms));
            $soldList = !empty($soldOutRooms) ? "\n\nवर्तमान में सोल्ड आउट: " . implode(', ', array_column($soldOutRooms, 'name')) : '';
            $reply = "वर्तमान कमरे की उपलब्धता:\n\n{$roomList}{$soldList}\n\nनीति: बुकिंग कन्फर्म करने के लिए 20% एडवांस (नॉन-रिफंडेबल), शेष 80% होटल में देय है।";
        } else {
            $roomList = implode("\n", array_map(fn($r) => "• {$r['name']}: ₹" . number_format($r['price']) . "/night [{$r['tag']}]", $availableRooms));
            $soldList = !empty($soldOutRooms) ? "\n\nCurrently Sold Out: " . implode(', ', array_column($soldOutRooms, 'name')) : '';
            $reply = "Current Room Availability at Coastal View:\n\n{$roomList}{$soldList}\n\nPayment Policy: Pay 20% non-refundable advance to confirm your stay; the remaining 80% is payable at the hotel.";
        }
        $actionChips = ['Book a Room', 'Candlelight Dinner', 'Contact Front Desk'];

    } elseif (str_contains($text, 'toto') || str_contains($text, 'auto') || str_contains($text, 'car') || str_contains($text, 'cab') || str_contains($text, 'vehicle') || str_contains($text, 'transport') || str_contains($text, 'taxi') || str_contains($text, 'টোটো') || str_contains($text, 'অটো') || str_contains($text, 'গাড়ি') || str_contains($text, 'গাড়ি') || str_contains($text, 'ট্যাক্সি') || str_contains($text, 'टोटो') || str_contains($text, 'ऑटो') || str_contains($text, 'गाड़ी')) {
        $activeVehicles = array_filter($db['vehicles'] ?? [], fn($v) => !empty($v['enabled']));
        if ($isBengali) {
            $vList = implode("\n", array_map(fn($v) => "• {$v['name']}: {$v['description']} (সর্বোচ্চ {$v['capacity']} জন যাত্রী) — ₹" . number_format($v['pricePerDay']) . "/দিন", $activeVehicles));
            $reply = "অনির ট্যুর অ্যান্ড ট্রাভেলসের অনুমোদিত যানবাহনের আসল মূল্য তালিকা:\n\n{$vList}\n\nআপনি রুম বুকিংয়ের সাথে সরাসরি পছন্দের বাহন ও সংখ্যা নির্বাচন করতে পারেন।";
        } elseif ($isHindi) {
            $vList = implode("\n", array_map(fn($v) => "• {$v['name']}: {$v['description']} (अधिकतम {$v['capacity']} यात्री) — ₹" . number_format($v['pricePerDay']) . "/दिन", $activeVehicles));
            $reply = "अनीज टूर एंड ट्रेवल्स के आधिकारिक वाहन दर और विवरण:\n\n{$vList}\n\nकमरे की बुकिंग के समय आप सीधे वाहन और संख्या चुन सकते हैं।";
        } else {
            $vList = implode("\n", array_map(fn($v) => "• {$v['name']}: {$v['description']} (Up to {$v['capacity']} passengers) — ₹" . number_format($v['pricePerDay']) . "/day", $activeVehicles));
            $reply = "Official Vehicle Rates & Transport Options (Ani's Tour & Travels):\n\n{$vList}\n\nYou can select your preferred vehicle type and quantity directly in the live booking bar.";
        }
        $actionChips = ['Book a Room', 'Check Availability', 'Contact Front Desk'];

    } elseif (
        str_contains($text, 'outside food') || 
        (str_contains($text, 'outside') && (str_contains($text, 'food') || str_contains($text, 'allowed') || str_contains($text, 'bring'))) || 
        str_contains($text, 'per kg') || str_contains($text, 'per-kg') || str_contains($text, 'perkg') ||
        str_contains($text, 'chicken per kg') || str_contains($text, 'mutton per kg') || str_contains($text, 'fish per kg') ||
        (str_contains($text, 'rate') && (str_contains($text, 'chicken') || str_contains($text, 'mutton') || str_contains($text, 'fish') || str_contains($text, 'kg'))) ||
        str_contains($text, 'hookah') || str_contains($text, 'বাইরের খাবার') || str_contains($text, 'হুক্কা')
    ) {
        $reply = "Official Policy & Custom Cooking Services at Coastal View Hotel & Restaurant, Mandarmani:\n\n• Fish & Chicken (per kg): ₹300/kg\n• Mutton (per kg): ₹350/kg\n• Outside food is strictly not allowed on hotel premises.\n• Drinks & hookah are available at our restaurant.\n\nFor kitchen cooking requests or table reservations, please call +91 7812027551.";
        $actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

    } elseif (str_contains($text, 'thali') || str_contains($text, 'থালা') || str_contains($text, 'थाली')) {
        $dishes = $db['restaurant'] ?? [];
        $thalis = array_filter($dishes, fn($d) => ($d['category'] ?? '') === 'Thali');
        $thaliList = implode("\n", array_map(function($d) {
            $p = "₹" . ($d['price'] ?? 0);
            if (!empty($d['variants']) && is_array($d['variants'])) {
                $p = implode(' | ', array_map(fn($v) => "{$v['label']} ₹{$v['price']}", $d['variants']));
            }
            $portion = !empty($d['portion']) ? " ({$d['portion']})" : '';
            return "• {$d['name']}{$portion}: {$p}";
        }, $thalis));
        $reply = "Authentic Bengali Thalis served at Coastal View Hotel & Restaurant:\n\n{$thaliList}\n\nAll thalis include steamed rice, yellow dal, aloo bhaja, seasonal sabji, papad, salad, and chutney.\nFor table reservations or room delivery, call +91 7812027551.";
        $actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

    } elseif (str_contains($text, 'breakfast') && (str_contains($text, 'time') || str_contains($text, 'timing') || str_contains($text, 'when') || str_contains($text, 'hour') || str_contains($text, 'সময়') || str_contains($text, 'টাইম') || str_contains($text, 'कब'))) {
        $reply = "Breakfast Timings at Coastal View Hotel & Restaurant, Mandarmani:\n\n⏰ Timing: 7:00 AM to 10:30 AM (Daily)\n\nMorning Specialties from our printed menu:\n• Puri Sabji (4 pcs.) ₹70 | Extra Puri ₹20\n• Aloo Paratha (2 pc.) with dahi & aachar ₹150\n• Sandwich (Veg ₹80 | Chicken ₹100 | Egg ₹120)\n• Maggie (Veg ₹70 | Egg ₹90 | Chicken ₹110)\n• Jam/Butter Toast (4 pc.) ₹60\n• Egg Boiled (2 pc.) ₹50 | Omelet (2 pc.) ₹60 | Egg Poach (2 pc.) ₹50 | Egg Bhujia (2 pc.) ₹80\n• Hot Beverages: Tea ₹30 | Black Tea ₹25 | Coffee ₹70 | Black Coffee ₹50 | Green Tea ₹60\n\nManaged by Ani's Tour and Travels. For room service or table reservation, call +91 7812027551.";
        $actionChips = ['View Full Menu', 'Reserve Table', 'Call +91 7812027551'];

    } elseif (
        str_contains($text, 'menu') || str_contains($text, 'food') || str_contains($text, 'dining') || str_contains($text, 'dish') || 
        str_contains($text, 'breakfast') || str_contains($text, 'ilish') || str_contains($text, 'hilsa') || str_contains($text, 'seafood') || 
        str_contains($text, 'biryani') || str_contains($text, 'biriyani') || str_contains($text, 'sandwich') || str_contains($text, 'maggie') || 
        str_contains($text, 'chicken') || str_contains($text, 'mutton') || str_contains($text, 'paneer') || str_contains($text, 'chowmin') ||
        str_contains($text, 'prawn') || str_contains($text, 'chingri') || str_contains($text, 'pomfret') || str_contains($text, 'parshe') ||
        str_contains($text, 'bhetki') || str_contains($text, 'vetki') || str_contains($text, 'crab') || str_contains($text, 'tandoori') ||
        str_contains($text, 'mocktail') || str_contains($text, 'drinks') || str_contains($text, 'খাবার') || str_contains($text, 'মেনু') || 
        str_contains($text, 'ইলিশ') || str_contains($text, 'खाना') || str_contains($text, 'मछली')
    ) {
        $dishes = $db['restaurant'] ?? [];
        $scored = [];
        foreach ($dishes as $d) {
            $dName = strtolower($d['name']);
            $clean = trim(preg_replace('/,\s*\d+\s*pcs?\.?/', '', preg_replace('/\s*\(.*?\)/', '', $dName)));
            $score = 0;
            if (str_contains($text, $dName)) $score += 100;
            if (str_contains($text, $clean)) $score += 80;
            if (!empty($d['variants']) && is_array($d['variants'])) {
                foreach ($d['variants'] as $v) {
                    if (str_contains($text, strtolower($v['label']))) {
                        $score += 15;
                        $mainWord = explode(' ', $clean)[0];
                        if (str_contains($text, $mainWord)) $score += 50;
                    }
                }
            }
            $words = array_filter(preg_split('/[\s\/,\.]+/', $clean), fn($w) => strlen($w) > 2);
            $matchedWords = 0;
            foreach ($words as $w) {
                if (str_contains($text, $w)) $matchedWords++;
            }
            if ($matchedWords > 0) {
                $score += $matchedWords * 20;
                if ($matchedWords === count($words)) $score += 30;
            }
            if ($score >= 35) {
                $scored[] = ['dish' => $d, 'score' => $score];
            }
        }
        usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);
        $matched = array_map(fn($s) => $s['dish'], $scored);

        if (!empty($matched)) {
            $lines = [];
            foreach (array_slice($matched, 0, 5) as $d) {
                $specificVariant = null;
                if (!empty($d['variants']) && is_array($d['variants'])) {
                    foreach ($d['variants'] as $v) {
                        $vLabel = strtolower($v['label']);
                        if (str_contains($text, $vLabel) || ($vLabel === 'veg' && str_contains($text, 'veg.'))) {
                            $specificVariant = $v;
                            break;
                        }
                    }
                }

                if ($specificVariant) {
                    $allVarStr = implode(' | ', array_map(fn($v) => "{$v['label']} ₹{$v['price']}", $d['variants']));
                    $priceStr = "{$specificVariant['label']}: ₹{$specificVariant['price']} (All options: {$allVarStr})";
                } elseif (!empty($d['variants']) && is_array($d['variants'])) {
                    $priceStr = implode(' | ', array_map(fn($v) => "{$v['label']} ₹{$v['price']}", $d['variants']));
                } else {
                    $priceStr = "₹" . ($d['price'] ?? 0);
                }

                $diet = !empty($d['isVeg']) ? '🌱 Pure Veg' : '🍗 Non-Veg';
                $portion = !empty($d['portion']) ? " [{$d['portion']}]" : '';
                $lines[] = "• {$d['name']}{$portion}: {$priceStr} | {$diet}";
            }
            $list = implode("\n", $lines);
            $reply = "Yes! Coastal View Hotel & Restaurant serves:\n\n{$list}\n\nGuidelines: Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.\nManaged by Ani's Tour and Travels. For room service or table reservation, call +91 7812027551.";
            $actionChips = ['View Full Menu', 'Breakfast Timings', 'Reserve Table'];
        } else {
            $reply = "Welcome to Coastal View Hotel & Restaurant, Mandarmani!\n\nOur official printed menu features 93 authentic coastal delicacies across 8 categories with real prices:\n1. Breakfast (7:00 AM to 10:30 AM)\n2. Vegetable / Dal\n3. Rice / Roti / Chowmin\n4. Non Veg\n5. Snacks (Veg./Non Veg.)\n6. Mocktail\n7. Salad & Raita / Papad\n8. Thali\n\nSpecial Cooking: Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.\n\nCall +91 7812027551 (Managed by Ani's Tour and Travels) for reservations or room service.";
            $actionChips = ['Breakfast Timings', 'Thali Menu', 'Full Menu', 'Call: +91 7812027551'];
        }

    } elseif (str_contains($text, 'price') || str_contains($text, 'rate') || str_contains($text, 'cost') || str_contains($text, 'room') || str_contains($text, 'stay') || str_contains($text, 'tariff') || str_contains($text, 'দাম') || str_contains($text, 'ভাড়া') || str_contains($text, 'किराया')) {
        $rates = implode("\n", array_map(fn($r) => "• {$r['name']}: ₹" . number_format($r['price']) . "/night " . (!empty($r['isSoldOut']) ? '[SOLD OUT]' : ''), $db['rooms']));
        $activeVehicles = array_filter($db['vehicles'] ?? [], fn($v) => !empty($v['enabled']));
        $vSummary = implode("\n", array_map(fn($v) => "• {$v['name']}: ₹" . number_format($v['pricePerDay']) . "/day", $activeVehicles));
        $reply = "Official Room & Service Rates at Coastal View:\n\n{$rates}\n\nAdd-ons:\n• Beachside Candlelight Dinner: ₹{$db['settings']['candlelightDinnerBeachside']}\n• Poolside Candlelight Dinner: ₹{$db['settings']['candlelightDinnerPoolside']}\n\nVehicle Rates (Ani's Tour & Travels):\n{$vSummary}";
        $actionChips = ['Check Availability', 'Payment Policy', 'Book Room'];

    } elseif (str_contains($text, 'candle') || str_contains($text, 'dinner') || str_contains($text, 'romantic') || str_contains($text, 'হনিমুন') || str_contains($text, 'ক্যান্ডেললাইট')) {
        $reply = "Luxury Candlelight Dinner Arrangements:\n\n• Beachside Starlit Canopy: ₹{$db['settings']['candlelightDinnerBeachside']}\n• Infinity Poolside Romantic Deck: ₹{$db['settings']['candlelightDinnerPoolside']}\n\nIncludes: 4-course gourmet dinner, dedicated butler, glowing lanterns, fresh floral decor, celebration cake, and welcome mocktails. You can add this directly to your room booking.";
        $actionChips = ['Book Candlelight Dinner', 'View Rooms', 'Contact Us'];

    } elseif (str_contains($text, 'nearby') || str_contains($text, 'place') || str_contains($text, 'tajpur') || str_contains($text, 'digha') || str_contains($text, 'কাছাকাছি') || str_contains($text, 'आसपास')) {
        $reply = "Popular Places Near Mandarmani:\n\n1. Mandarmani Beach (0 km - Direct beachfront access)\n2. Tajpur Beach (18 km - Famous for red ghost crabs & pine forest)\n3. Shankarpur Fishing Harbor & Beach (24 km)\n4. Digha Promenade & Marine Center (30 km)\n5. Mandarmani Mohana Local Seafood Market (4 km)\n6. Bakkhali Scenic Tour\n\nAni's Tour and Travels provides luxury AC cars for all sightseeing & Kolkata transfers.";
        $actionChips = ['Explore Ani Tours', 'Check Rooms', 'Call Front Desk'];

    } elseif (str_contains($text, 'policy') || str_contains($text, 'advance') || str_contains($text, 'refund') || str_contains($text, 'পেমেন্ট')) {
        $reply = "Booking & Payment Policy:\n\n• Payment Terms: Pay 20% advance online/UPI to confirm your reservation. The remaining 80% is payable at the hotel at check-in/check-out.\n• Advance Policy: The 20% advance is non-refundable.\n• Check-in Time: {$db['settings']['checkInTime']} | Check-out Time: {$db['settings']['checkOutTime']}\n• Address: {$db['settings']['address']}\n• Couple & Family Friendly: All couples and families are welcome with valid government photo IDs.";
        $actionChips = ['Show Rooms', 'Book Now', 'Contact Front Desk'];

    } elseif (str_contains($text, 'contact') || str_contains($text, 'phone') || str_contains($text, 'number') || str_contains($text, 'যোগাযোগ')) {
        $reply = "Hotel Contact Information:\n\n• Hotel: Coastal View, Managed By Ani's\n• Host / Owner: Anirban Das\n• Phone & WhatsApp: {$db['settings']['phone']}\n• Email: {$db['settings']['email']}\n• Location: {$db['settings']['address']}\n\nWould you like our front desk to call you back right away? Leave your phone number below!";
        $requiresCallbackForm = true;
        $actionChips = ['Request Callback', 'Book a Room'];

    } else {
        $reply = "I only provide verified, real-time information from Coastal View's management system to ensure 100% accuracy. For this specific request, please share your name and contact number below, and Anirban Das or our front desk will call you back immediately.";
        $requiresCallbackForm = true;
        $actionChips = ['Request Callback', 'Show Rooms & Prices', 'Check Availability'];
    }

    $db['chatInquiries'] = $db['chatInquiries'] ?? [];
    $db['chatInquiries'][] = [
        'id' => 'chat-' . time(),
        'userMessage' => $message,
        'botReply' => $reply,
        'lang' => $lang,
        'timestamp' => date('c')
    ];
    if (count($db['chatInquiries']) > 200) {
        $db['chatInquiries'] = array_slice($db['chatInquiries'], -200);
    }
    saveDB($db);

    echo json_encode([
        'success' => true,
        'reply' => $reply,
        'requiresCallbackForm' => $requiresCallbackForm,
        'actionChips' => $actionChips
    ]);
    exit;
}

if ($action === 'callback') {
    $input = getJsonInput();
    $name = trim($input['name'] ?? '');
    $phone = trim($input['phone'] ?? '');
    if (!$name || !$phone) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Name and phone required']);
        exit;
    }
    $req = [
        'id' => 'req-' . time(),
        'name' => $name,
        'phone' => $phone,
        'message' => $input['message'] ?? 'Concierge callback requested',
        'status' => 'Pending',
        'createdAt' => date('c')
    ];
    $db['callbackRequests'] = $db['callbackRequests'] ?? [];
    $db['callbackRequests'][] = $req;
    saveDB($db);
    echo json_encode(['success' => true, 'message' => 'Callback scheduled promptly!']);
    exit;
}

if ($action === 'inquiries' || $action === 'conversations') {
    $conversations = $db['chatConversations'] ?? [];
    if (empty($conversations) && !empty($db['chatInquiries'])) {
        foreach ($db['chatInquiries'] as $inq) {
            $conversations[] = [
                'id' => $inq['id'],
                'sessionId' => $inq['sessionId'] ?? $inq['id'],
                'language' => $inq['lang'] ?? 'en',
                'topic' => $inq['topic'] ?? 'General Inquiry',
                'leadStatus' => $inq['leadStatus'] ?? 'New Lead',
                'isRead' => !empty($inq['isRead']),
                'createdAt' => $inq['timestamp'] ?? date('c'),
                'messages' => [
                    ['sender' => 'guest', 'text' => $inq['userMessage'] ?? '', 'timestamp' => $inq['timestamp'] ?? date('c')],
                    ['sender' => 'bot', 'text' => $inq['botReply'] ?? '', 'timestamp' => $inq['timestamp'] ?? date('c')]
                ]
            ];
        }
    }
    echo json_encode([
        'success' => true,
        'inquiries' => $conversations,
        'chatInquiries' => array_reverse($db['chatInquiries'] ?? []),
        'callbacks' => array_reverse($db['callbackRequests'] ?? []),
        'callbackRequests' => array_reverse($db['callbackRequests'] ?? [])
    ]);
    exit;
}

if ($action === 'bot_settings') {
    if ($method === 'POST') {
        $input = getJsonInput();
        $db['botSettings'] = array_merge($db['botSettings'] ?? [], $input);
        saveDB($db);
        echo json_encode(['success' => true, 'botSettings' => $db['botSettings']]);
        exit;
    }
    echo json_encode([
        'success' => true,
        'botSettings' => $db['botSettings'] ?? [],
        'stats' => $db['botUsage'] ?? []
    ]);
    exit;
}

if ($action === 'stats') {
    echo json_encode([
        'success' => true,
        'stats' => $db['botUsage'] ?? []
    ]);
    exit;
}

if ($action === 'export_csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="chat-transcripts.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['ID', 'Session ID', 'Created At', 'Language', 'Topic', 'Lead Status', 'Guest Name', 'Phone', 'Message Count', 'Transcript']);
    $convs = $db['chatConversations'] ?? [];
    foreach ($convs as $c) {
        $trans = '';
        foreach ($c['messages'] ?? [] as $m) {
            $trans .= '[' . strtoupper($m['sender']) . ']: ' . ($m['text'] ?? '') . "\n";
        }
        fputcsv($out, [
            $c['id'] ?? '',
            $c['sessionId'] ?? '',
            $c['createdAt'] ?? '',
            $c['language'] ?? 'en',
            $c['topic'] ?? 'General',
            $c['leadStatus'] ?? 'New Lead',
            $c['guestName'] ?? '',
            $c['guestPhone'] ?? '',
            count($c['messages'] ?? []),
            $trans
        ]);
    }
    fclose($out);
    exit;
}

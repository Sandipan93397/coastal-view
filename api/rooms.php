<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'GET') {
    $rooms = array_values(array_filter($db['rooms'] ?? [], function($r) {
        return empty($r['isArchived']);
    }));
    echo json_encode(['success' => true, 'rooms' => $rooms]);
    exit;
}

if ($method === 'POST') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $id = $_GET['id'] ?? '';
    $action = $_GET['action'] ?? '';
    $input = getJsonInput();

    // Toggle Sold Out
    if ($action === 'toggle-soldout' && $id) {
        foreach ($db['rooms'] as &$room) {
            if ($room['id'] === $id) {
                $room['isSoldOut'] = !empty($input['isSoldOut']) ? true : !$room['isSoldOut'];
                $room['soldOutReason'] = $input['reason'] ?? ($room['isSoldOut'] ? 'Peak period reservation' : null);
                $room['soldOutUntil'] = $input['soldOutUntil'] ?? ($room['isSoldOut'] ? 'Until further notice' : null);
                if (isset($input['blockedQuantity'])) {
                    $room['blockedQuantity'] = max(0, (int)$input['blockedQuantity']);
                }
                saveDB($db);
                echo json_encode(['success' => true, 'isSoldOut' => $room['isSoldOut'], 'room' => $room]);
                exit;
            }
        }
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Room not found']);
        exit;
    }

    // Reorder rooms
    if ($action === 'reorder' || (isset($input['roomIds']) && is_array($input['roomIds']))) {
        $roomIds = $input['roomIds'] ?? [];
        $roomMap = [];
        foreach ($db['rooms'] as $r) {
            $roomMap[$r['id']] = $r;
        }
        $reordered = [];
        foreach ($roomIds as $rid) {
            if (isset($roomMap[$rid])) {
                $reordered[] = $roomMap[$rid];
                unset($roomMap[$rid]);
            }
        }
        foreach ($roomMap as $remaining) {
            $reordered[] = $remaining;
        }
        $db['rooms'] = $reordered;
        saveDB($db);
        echo json_encode(['success' => true, 'rooms' => array_values(array_filter($db['rooms'], fn($r) => empty($r['isArchived'])))]);
        exit;
    }

    // Edit Room
    if ($id) {
        foreach ($db['rooms'] as &$room) {
            if ($room['id'] === $id) {
                if (isset($input['name'])) $room['name'] = trim($input['name']);
                if (isset($input['tag'])) $room['tag'] = trim($input['tag']);
                if (isset($input['category'])) $room['category'] = trim($input['category']);
                if (isset($input['view'])) $room['view'] = trim($input['view']);
                if (isset($input['bed'])) $room['bed'] = trim($input['bed']);
                if (isset($input['size'])) $room['size'] = trim($input['size']);
                if (isset($input['description'])) $room['description'] = trim($input['description']);
                if (isset($input['quantity'])) $room['quantity'] = max(1, (int)$input['quantity']);
                if (isset($input['blockedQuantity'])) $room['blockedQuantity'] = max(0, (int)$input['blockedQuantity']);
                if (array_key_exists('price', $input)) {
                    $room['price'] = ($input['price'] === null || $input['price'] === '' || $input['price'] === 'null') ? null : (float)$input['price'];
                }
                if (isset($input['maxAdults'])) $room['maxAdults'] = (int)$input['maxAdults'];
                if (isset($input['maxChildren'])) $room['maxChildren'] = (int)$input['maxChildren'];
                if (isset($input['features']) && is_array($input['features'])) $room['features'] = $input['features'];
                if (isset($input['image'])) $room['image'] = trim($input['image']);
                if (isset($input['inclusions']) && is_array($input['inclusions'])) $room['inclusions'] = $input['inclusions'];
                if (isset($input['extras']) && is_array($input['extras'])) $room['extras'] = $input['extras'];
                
                saveDB($db);
                echo json_encode(['success' => true, 'room' => $room]);
                exit;
            }
        }
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Room not found']);
        exit;
    }

    // Add New Room
    if (!empty($input['name'])) {
        $name = trim($input['name']);
        $baseId = strtolower(preg_replace('/[^a-z0-9]+/', '-', $name));
        $baseId = trim($baseId, '-');
        if (!$baseId) $baseId = 'room-' . time();
        $uniqueId = $baseId;
        $counter = 1;
        $existingIds = array_column($db['rooms'], 'id');
        while (in_array($uniqueId, $existingIds)) {
            $uniqueId = $baseId . '-' . ($counter++);
        }

        $newPrice = ($input['price'] === null || $input['price'] === '' || !is_numeric($input['price'])) ? null : (float)$input['price'];
        $newRoom = [
            'id' => $uniqueId,
            'name' => $name,
            'price' => $newPrice,
            'quantity' => isset($input['quantity']) ? max(1, (int)$input['quantity']) : 4,
            'blockedQuantity' => 0,
            'tag' => $input['tag'] ?? 'DELUXE',
            'category' => $input['category'] ?? 'cosy-deluxe',
            'view' => $input['view'] ?? 'Garden/Courtyard',
            'isLuxury' => in_array($input['category'] ?? '', ['sea-view', 'family']),
            'isSoldOut' => false,
            'maxAdults' => (int)($input['maxAdults'] ?? 2),
            'maxChildren' => (int)($input['maxChildren'] ?? 0),
            'bed' => $input['bed'] ?? 'King Bed',
            'size' => $input['size'] ?? '400 sq. ft.',
            'image' => $input['image'] ?? 'assets/images/room-cosy-deluxe.jpg',
            'description' => $input['description'] ?? '',
            'features' => is_array($input['features'] ?? null) ? $input['features'] : [],
            'inclusions' => is_array($input['inclusions'] ?? null) ? $input['inclusions'] : [

                ['text' => 'AC', 'icon' => 'ac_unit'],
                ['text' => 'Free Wi-Fi', 'icon' => 'wifi'],
                ['text' => 'Smart TV', 'icon' => 'tv'],
                ['text' => 'Pool access', 'icon' => 'pool'],
                ['text' => 'Housekeeping', 'icon' => 'cleaning_services'],
                ['text' => 'Hot water', 'icon' => 'water_drop']
            ],
            'extras' => is_array($input['extras'] ?? null) ? $input['extras'] : [
                ['text' => 'Candlelight Dinner', 'icon' => 'favorite'],
                ['text' => 'Car / Toto / Auto pickup', 'icon' => 'directions_car']
            ],
            'soldOutUntil' => null,
            'soldOutReason' => null,
            'gallery' => [
                [
                    'id' => "photo-{$uniqueId}-1",
                    'url' => $input['image'] ?? 'assets/images/room-cosy-deluxe.jpg',
                    'thumbUrl' => $input['image'] ?? 'assets/images/room-cosy-deluxe.jpg',
                    'mediumUrl' => $input['image'] ?? 'assets/images/room-cosy-deluxe.jpg',
                    'alt' => "{$name} at Coastal View Mandarmani",
                    'caption' => "{$name} primary view",
                    'tag' => 'view',
                    'isCover' => true
                ]
            ]
        ];

        $db['rooms'][] = $newRoom;
        saveDB($db);
        echo json_encode(['success' => true, 'room' => $newRoom]);
        exit;
    }
}

if ($method === 'DELETE') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $id = $_GET['id'] ?? '';
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Room ID required']);
        exit;
    }

    $activeCount = count(array_filter($db['rooms'], fn($r) => empty($r['isArchived'])));
    if ($activeCount <= 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Cannot delete the only active room']);
        exit;
    }

    foreach ($db['rooms'] as $idx => &$room) {
        if ($room['id'] === $id) {
            $room['isArchived'] = true;
            $db['archivedRooms'] = $db['archivedRooms'] ?? [];
            $db['archivedRooms'][] = $room;
            array_splice($db['rooms'], $idx, 1);
            saveDB($db);
            echo json_encode(['success' => true, 'message' => 'Room archived']);
            exit;
        }
    }
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Room not found']);
    exit;
}

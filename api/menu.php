<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = getDB();

if ($method === 'GET') {
    echo json_encode([
        'success' => true,
        'restaurant' => $db['restaurant'] ?? [],
        'cocktails' => $db['cocktails'] ?? [],
        'categories' => $db['menuCategories'] ?? [],
        'menuNote' => $db['settings']['menuNote'] ?? "Fish & Chicken (per kg): ₹300/kg. Mutton: ₹350/kg. Outside food not allowed. Drinks & hookah available.",
        'menuPhone' => $db['settings']['menuPhone'] ?? "+91 7812027551"
    ]);
    exit;
}

if ($method === 'POST') {
    $user = getSessionUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }

    $input = getJsonInput();

    // 0. Update menu note
    if ($action === 'update_note' || isset($input['menuNote'])) {
        $note = trim($input['menuNote'] ?? ($input['note'] ?? ''));
        $db['settings']['menuNote'] = $note;
        saveDB($db);
        echo json_encode(['success' => true, 'menuNote' => $note, 'message' => 'Menu note updated successfully']);
        exit;
    }

    $input = getJsonInput();

    // 1. Upload Dish Photo with circular crop
    if ($action === 'upload_image' || isset($input['imageBase64'])) {
        $dishId = $input['dishId'] ?? '';
        $imageBase64 = $input['imageBase64'] ?? '';
        $mimeType = $input['mimeType'] ?? 'image/webp';

        if (!$dishId || !$imageBase64) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'dishId and imageBase64 required']);
            exit;
        }

        $dishFound = false;
        $dishIndex = -1;
        foreach ($db['restaurant'] as $idx => $d) {
            if ($d['id'] === $dishId) {
                $dishFound = true;
                $dishIndex = $idx;
                break;
            }
        }

        if (!$dishFound) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Dish not found']);
            exit;
        }

        // Process base64
        if (preg_match('/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/', $imageBase64, $matches)) {
            $mimeType = $matches[1];
            $rawData = $matches[2];
        } else {
            $rawData = $imageBase64;
        }

        $data = base64_decode($rawData);
        if (!$data || strlen($data) > 5 * 1024 * 1024) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid image data or exceeds 5MB limit']);
            exit;
        }

        $ext = 'webp';
        if (str_contains($mimeType, 'png')) $ext = 'png';
        elseif (str_contains($mimeType, 'jpeg') || str_contains($mimeType, 'jpg')) $ext = 'jpg';

        $safeDishId = preg_replace('/[^a-zA-Z0-9_-]/', '', $dishId);
        $filename = "dish-{$safeDishId}-" . time() . ".{$ext}";
        $uploadDir = dirname(__DIR__) . '/uploads/menu';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        file_put_contents("{$uploadDir}/{$filename}", $data);
        $publicUrl = "/uploads/menu/{$filename}";

        $db['restaurant'][$dishIndex]['image'] = $publicUrl;
        $db['restaurant'][$dishIndex]['thumbImage'] = $publicUrl;

        // Log audit
        $db['auditLog'] = $db['auditLog'] ?? [];
        array_unshift($db['auditLog'], [
            'id' => 'audit-' . time(),
            'timestamp' => date('c'),
            'user' => $user['username'] ?? 'admin',
            'role' => $user['role'] ?? 'Manager',
            'name' => $user['name'] ?? 'Staff',
            'ip' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
            'action' => 'Dish Photo Uploaded',
            'details' => "Uploaded circular dish photo for {$db['restaurant'][$dishIndex]['name']}."
        ]);

        saveDB($db);
        echo json_encode(['success' => true, 'image' => $publicUrl, 'dish' => $db['restaurant'][$dishIndex]]);
        exit;
    }

    // 2. Reorder items
    if ($action === 'reorder' || isset($input['orderList'])) {
        $type = $input['type'] ?? 'restaurant';
        $orderList = $input['orderList'] ?? [];
        if (!isset($db[$type])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid category']);
            exit;
        }

        $orderMap = [];
        foreach ($orderList as $idx => $ord) {
            if (isset($ord['id'])) {
                $orderMap[$ord['id']] = $idx + 1;
            }
        }

        foreach ($db[$type] as &$item) {
            if (isset($orderMap[$item['id']])) {
                $item['order'] = $orderMap[$item['id']];
            }
        }

        usort($db[$type], fn($a, $b) => ($a['order'] ?? 999) <=> ($b['order'] ?? 999));
        saveDB($db);
        echo json_encode(['success' => true, 'items' => $db[$type]]);
        exit;
    }

    // 3. Toggle availability
    if ($action === 'toggle_available' || isset($input['available']) && isset($input['id'])) {
        $type = $input['type'] ?? 'restaurant';
        $id = $input['id'] ?? '';
        $available = !empty($input['available']);

        if (!isset($db[$type])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid type']);
            exit;
        }

        $updatedItem = null;
        foreach ($db[$type] as &$item) {
            if ($item['id'] === $id) {
                $item['available'] = $available;
                $updatedItem = $item;
                break;
            }
        }

        if ($updatedItem) {
            saveDB($db);
            echo json_encode(['success' => true, 'item' => $updatedItem]);
            exit;
        }

        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Item not found']);
        exit;
    }

    // 3b. Toggle Featured on Home Page
    if ($action === 'toggle_featured') {
        $id = $input['id'] ?? '';
        $featured = isset($input['featured']) ? (bool)$input['featured'] : null;
        $type = $input['type'] ?? 'restaurant';

        $updatedItem = null;
        $featuredCount = 0;
        foreach ($db[$type] as &$item) {
            if ($item['id'] === $id) {
                $item['featured'] = $featured !== null ? $featured : empty($item['featured']);
                $item['isFeatured'] = $item['featured'];
                $updatedItem = $item;
            }
            if (!empty($item['featured']) || !empty($item['isFeatured'])) {
                $featuredCount++;
            }
        }

        if ($updatedItem) {
            $warning = ($featuredCount > 10) ? "Warning: {$featuredCount} dishes are now starred for home page highlights. A maximum of 10 is recommended." : null;
            saveDB($db);
            echo json_encode([
                'success' => true,
                'item' => $updatedItem,
                'featuredCount' => $featuredCount,
                'warning' => $warning,
                'message' => $updatedItem['featured'] ? "Item starred for home page highlights" : "Item removed from highlights"
            ]);
            exit;
        }

        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Item not found']);
        exit;
    }

    // 4. Standard Add / Edit Item
    $type = $input['type'] ?? 'restaurant'; // restaurant or cocktails
    $item = $input['item'] ?? [];

    if (!isset($db[$type])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid category']);
        exit;
    }

    // Clean price
    if (isset($item['price']) && ($item['price'] === '' || $item['price'] === null)) {
        if (!empty($item['variants']) && is_array($item['variants']) && isset($item['variants'][0]['price'])) {
            $item['price'] = floatval($item['variants'][0]['price']);
        } else {
            $item['price'] = null;
        }
    } elseif (isset($item['price']) && is_numeric($item['price'])) {
        $item['price'] = floatval($item['price']);
    }

    $found = false;
    foreach ($db[$type] as &$existing) {
        if ($existing['id'] === ($item['id'] ?? '')) {
            $existing = array_merge($existing, $item);
            $found = true;
            $item = $existing;
            break;
        }
    }
    if (!$found) {
        $item['id'] = ($item['id'] ?? '') ?: (substr($type, 0, 4) . '-' . time());
        $db[$type][] = $item;
    }

    // Audit log
    $db['auditLog'] = $db['auditLog'] ?? [];
    array_unshift($db['auditLog'], [
        'id' => 'audit-' . time(),
        'timestamp' => date('c'),
        'user' => $user['username'] ?? 'admin',
        'role' => $user['role'] ?? 'Manager',
        'name' => $user['name'] ?? 'Staff',
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1',
        'action' => 'Menu Item Saved',
        'details' => "Saved menu item '{$item['name']}' in {$type}."
    ]);

    saveDB($db);
    echo json_encode(['success' => true, 'item' => $item]);
    exit;
}

if ($method === 'DELETE') {
    $user = getSessionUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $type = $_GET['type'] ?? '';
    $id = $_GET['id'] ?? '';
    if (isset($db[$type])) {
        $db[$type] = array_values(array_filter($db[$type], function($i) use ($id) {
            return $i['id'] !== $id;
        }));
        saveDB($db);
        echo json_encode(['success' => true]);
        exit;
    }
    http_response_code(400);
    echo json_encode(['success' => false]);
    exit;
}

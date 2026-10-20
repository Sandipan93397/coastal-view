<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = $_GET['id'] ?? '';
$db = getDB();

if ($method === 'GET') {
    $photos = $db['gallery'] ?? [];
    usort($photos, function($a, $b) {
        return ($a['order'] ?? 999) - ($b['order'] ?? 999);
    });

    $category = $_GET['category'] ?? '';
    $featured = $_GET['featured'] ?? '';

    if ($category && $category !== 'All') {
        $photos = array_values(array_filter($photos, function($p) use ($category) {
            return ($p['category'] ?? '') === $category;
        }));
    }

    if ($featured === 'true') {
        $photos = array_values(array_filter($photos, function($p) {
            return !empty($p['featured']) || !empty($p['isFeatured']);
        }));
    }

    echo json_encode([
        'success' => true,
        'total' => count($photos),
        'photos' => $photos
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
    $db['gallery'] = $db['gallery'] ?? [];

    // Reorder
    if ($action === 'reorder') {
        $ids = $input['ids'] ?? [];
        $orderMap = array_flip($ids);
        foreach ($db['gallery'] as &$p) {
            if (isset($orderMap[$p['id']])) {
                $p['order'] = $orderMap[$p['id']] + 1;
            }
        }
        usort($db['gallery'], function($a, $b) {
            return ($a['order'] ?? 999) - ($b['order'] ?? 999);
        });
        saveDB($db);
        echo json_encode(['success' => true, 'gallery' => $db['gallery']]);
        exit;
    }

    // Toggle Featured
    if ($action === 'toggle-featured' || ($id && strpos($_SERVER['REQUEST_URI'], 'toggle-featured') !== false)) {
        $found = null;
        $starredCount = 0;
        foreach ($db['gallery'] as &$p) {
            if ($p['id'] === $id) {
                $p['featured'] = empty($p['featured']);
                $found = $p;
            }
            if (!empty($p['featured'])) $starredCount++;
        }
        if ($found) {
            saveDB($db);
            echo json_encode(['success' => true, 'photo' => $found, 'starredCount' => $starredCount]);
            exit;
        }
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Photo not found']);
        exit;
    }

    // Update single photo details
    if ($id) {
        $found = null;
        foreach ($db['gallery'] as &$p) {
            if ($p['id'] === $id) {
                if (isset($input['caption'])) $p['caption'] = trim($input['caption']);
                if (isset($input['alt'])) $p['alt'] = trim($input['alt']);
                if (isset($input['category'])) $p['category'] = $input['category'];
                if (isset($input['featured'])) $p['featured'] = (bool)$input['featured'];
                $found = $p;
                break;
            }
        }
        if ($found) {
            saveDB($db);
            echo json_encode(['success' => true, 'photo' => $found]);
            exit;
        }
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Photo not found']);
        exit;
    }

    // Upload photo(s)
    $items = isset($input['photos']) && is_array($input['photos']) ? $input['photos'] : (isset($input['photo']) ? [$input['photo']] : (isset($input['imageBase64']) ? [$input] : []));
    $saved = [];
    $uploadDir = __DIR__ . '/../uploads/gallery';
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0755, true);
    }

    foreach ($items as $item) {
        $url = $item['url'] ?? '';
        $thumbUrl = $item['thumbUrl'] ?? $url;

        if (!empty($item['imageBase64'])) {
            $base64 = $item['imageBase64'];
            $mime = 'image/webp';
            if (preg_match('/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/', $base64, $m)) {
                $mime = $m[1];
                $data = base64_decode($m[2]);
            } else {
                $data = base64_decode($base64);
            }

            $ext = strpos($mime, 'webp') !== false ? 'webp' : (strpos($mime, 'png') !== false ? 'png' : 'jpg');
            $fname = 'gallery-' . time() . '-' . rand(100, 999) . '.' . $ext;
            file_put_contents($uploadDir . '/' . $fname, $data);
            $url = '/uploads/gallery/' . $fname;
            $thumbUrl = $url;
        }

        $photoEntry = [
            'id' => $item['id'] ?? ('gallery-' . time() . '-' . rand(100, 999)),
            'url' => $url,
            'thumbUrl' => $thumbUrl,
            'category' => $item['category'] ?? 'Hotel',
            'caption' => $item['caption'] ?? 'Moments at Coastal View',
            'alt' => $item['alt'] ?? 'Coastal View photo',
            'featured' => !empty($item['featured']),
            'order' => intval($item['order'] ?? (count($db['gallery']) + 1)),
            'uploadedAt' => date('c'),
            'uploadedBy' => $user['username'] ?? 'admin'
        ];

        $db['gallery'][] = $photoEntry;
        $saved[] = $photoEntry;
    }

    saveDB($db);
    echo json_encode(['success' => true, 'photos' => $saved, 'gallery' => $db['gallery']]);
    exit;
}

if ($method === 'DELETE') {
    $user = getSessionUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }

    $id = $_GET['id'] ?? '';
    $deleted = false;
    $db['gallery'] = array_values(array_filter($db['gallery'] ?? [], function($p) use ($id, &$deleted) {
        if ($p['id'] === $id) {
            $deleted = true;
            if (!empty($p['url']) && strpos($p['url'], '/uploads/gallery/') === 0) {
                $f = __DIR__ . '/..' . $p['url'];
                if (file_exists($f)) @unlink($f);
            }
            return false;
        }
        return true;
    }));

    if ($deleted) {
        saveDB($db);
        echo json_encode(['success' => true, 'message' => 'Photo deleted']);
        exit;
    }

    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Photo not found']);
    exit;
}

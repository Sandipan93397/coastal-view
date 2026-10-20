<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'GET') {
    echo json_encode([
        'success' => true,
        'slots' => $db['mediaSlots'] ?? [],
        'rooms' => array_map(function($r) {
            return [
                'id' => $r['id'],
                'name' => $r['name'],
                'image' => $r['image'] ?? '',
                'gallery' => $r['gallery'] ?? []
            ];
        }, $db['rooms'] ?? []),
        'websiteContent' => $db['websiteContent'] ?? [],
        'amenities' => $db['amenities'] ?? [],
        'places' => $db['websiteContent']['places'] ?? [],
        'gallery' => $db['websiteContent']['gallery'] ?? [],
        'mediaHistory' => $db['mediaHistory'] ?? [],
        'logo' => $db['mediaSlots']['logo']['url'] ?? 'assets/images/logo.png',
        'hero' => $db['mediaSlots']['hero'] ?? ['image' => 'assets/images/hero-sunset-pool.jpg'],
        'owner' => $db['mediaSlots']['owner'] ?? ['photo' => 'assets/images/anirban-das-owner.jpg'],
        'candlelight' => $db['mediaSlots']['candlelight'] ?? ['image' => 'assets/images/candlelight-dinner.jpg'],
        'cocktails' => $db['mediaSlots']['cocktails'] ?? ['image' => 'assets/images/cocktail-lounge.jpg']
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

    $action = $_GET['action'] ?? '';
    $input = getJsonInput();

    // 1. Upload or Replace Media
    if ($action === 'upload' || isset($input['imageBase64'])) {
        $slotId = $input['slotId'] ?? 'general';
        $roomId = $input['roomId'] ?? '';
        $imageBase64 = $input['imageBase64'] ?? '';
        $tag = $input['tag'] ?? 'general';
        $alt = $input['alt'] ?? '';
        $caption = $input['caption'] ?? '';
        $isCover = !empty($input['isCover']);

        if (!$imageBase64) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'No image data provided']);
            exit;
        }

        // Process base64
        $mimeType = 'image/webp';
        if (preg_match('/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/', $imageBase64, $matches)) {
            $mimeType = $matches[1];
            $rawData = $matches[2];
        } else {
            $rawData = $imageBase64;
        }

        $allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!in_array(strtolower($mimeType), $allowedMimes)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Unsupported format. Only JPG, PNG, and WebP are allowed.']);
            exit;
        }

        $data = base64_decode($rawData);
        if (!$data || strlen($data) > 8 * 1024 * 1024) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Image exceeds 8 MB limit.']);
            exit;
        }

        $ext = 'webp';
        if (str_contains($mimeType, 'png')) $ext = 'png';
        elseif (str_contains($mimeType, 'jpeg') || str_contains($mimeType, 'jpg')) $ext = 'jpg';

        $subDir = ($slotId === 'room') ? 'rooms' : (preg_match('/^(hero|owner|logo|candlelight|cocktails|places|amenities|gallery)$/', $slotId) ? $slotId : 'general');
        $uploadDir = dirname(__DIR__) . '/uploads/' . $subDir;
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $safePrefix = preg_replace('/[^a-zA-Z0-9_-]/', '', ($slotId === 'room' ? "room-{$roomId}-{$tag}" : "slot-{$slotId}"));
        $filename = "{$safePrefix}-" . time() . '-' . substr(md5(uniqid()), 0, 8) . ".{$ext}";
        file_put_contents("{$uploadDir}/{$filename}", $data);
        $publicUrl = "/uploads/{$subDir}/{$filename}";

        if ($slotId === 'room' && $roomId) {
            foreach ($db['rooms'] as &$r) {
                if ($r['id'] === $roomId) {
                    $r['gallery'] = $r['gallery'] ?? [];
                    if ($isCover) {
                        foreach ($r['gallery'] as &$p) { $p['isCover'] = false; }
                        $r['prevImage'] = $r['image'] ?? null;
                        $r['image'] = $publicUrl;
                    }
                    $photoEntry = [
                        'id' => "photo-{$roomId}-" . time(),
                        'url' => $publicUrl,
                        'thumbUrl' => $publicUrl,
                        'mediumUrl' => $publicUrl,
                        'prevUrl' => null,
                        'alt' => $alt ?: "{$r['name']} - {$tag} photo",
                        'caption' => $caption ?: "{$r['name']} ({$tag})",
                        'tag' => $tag,
                        'isCover' => $isCover,
                        'uploadedAt' => date('c'),
                        'uploadedBy' => $user['username'] ?? 'admin'
                    ];
                    $r['gallery'][] = $photoEntry;
                    saveDB($db);
                    echo json_encode(['success' => true, 'message' => "Photo uploaded for {$r['name']}", 'photo' => $photoEntry, 'room' => $r]);
                    exit;
                }
            }
        } else {
            $db['mediaSlots'] = $db['mediaSlots'] ?? [];
            $existing = $db['mediaSlots'][$slotId] ?? [];
            $prevUrl = $existing['url'] ?? null;

            if ($prevUrl) {
                $db['mediaHistory'] = $db['mediaHistory'] ?? [];
                array_unshift($db['mediaHistory'], [
                    'id' => 'hist-' . time(),
                    'slotId' => $slotId,
                    'url' => $prevUrl,
                    'replacedAt' => date('c'),
                    'replacedBy' => $user['username'] ?? 'admin',
                    'action' => 'Replaced'
                ]);
            }

            $db['mediaSlots'][$slotId] = array_merge($existing, [
                'slotId' => $slotId,
                'url' => $publicUrl,
                'prevUrl' => $prevUrl,
                'alt' => $alt ?: ($existing['alt'] ?? ''),
                'caption' => $caption ?: ($existing['caption'] ?? ''),
                'updatedAt' => date('c'),
                'updatedBy' => $user['username'] ?? 'admin'
            ]);

            if ($slotId === 'hero' && isset($db['websiteContent']['hero'])) {
                $db['websiteContent']['hero']['heroImage'] = $publicUrl;
            } elseif ($slotId === 'owner' && isset($db['websiteContent']['owner'])) {
                $db['websiteContent']['owner']['photo'] = $publicUrl;
            }

            saveDB($db);
            echo json_encode(['success' => true, 'message' => "Media slot {$slotId} updated!", 'slot' => $db['mediaSlots'][$slotId]]);
            exit;
        }
    }
}

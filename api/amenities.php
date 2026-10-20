<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'GET') {
    echo json_encode(['success' => true, 'amenities' => $db['amenities'] ?? []]);
    exit;
}

if ($method === 'POST') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $input = getJsonInput();
    $db['amenities'] = $input['amenities'] ?? [];
    saveDB($db);
    echo json_encode(['success' => true, 'amenities' => $db['amenities']]);
    exit;
}

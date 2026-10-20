<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $db = getDB();
    if (!$db) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Database error']);
        exit;
    }
    echo json_encode(['success' => true, 'settings' => $db['settings']]);
    exit;
}

if ($method === 'POST') {
    if (!verifyAdminSession()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $db = getDB();
    $input = getJsonInput();
    $db['settings'] = array_merge($db['settings'], $input);
    saveDB($db);
    echo json_encode(['success' => true, 'settings' => $db['settings'], 'message' => 'Settings updated']);
    exit;
}

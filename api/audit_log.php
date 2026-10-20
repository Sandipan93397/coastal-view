<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if (!verifyAdminSession()) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Unauthorized']);
    exit;
}

if ($method === 'GET') {
    echo json_encode([
        'success' => true,
        'auditLog' => $db['auditLog'] ?? []
    ]);
    exit;
}

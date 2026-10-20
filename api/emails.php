<?php
require_once __DIR__ . '/db_helper.php';

$user = getSessionUser();
if (!$user) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Unauthorized']);
    exit;
}

$db = getDB();
$emails = $db['emailOutbox'] ?? [];

echo json_encode([
    'success' => true,
    'emails' => $emails
]);

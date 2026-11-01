<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

echo json_encode([
    'status' => 'ok',
    'timestamp' => date('c'),
    'service' => 'Coastal View Luxury Hotel PHP API'
]);
exit;

<?php
// Database & Common Helper for Hostinger Web Hosting
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

define('DB_FILE', dirname(__DIR__) . '/data/db.json');
define('SESSION_FILE', dirname(__DIR__) . '/data/sessions.json');

function getDB() {
    if (!file_exists(DB_FILE)) {
        return null;
    }
    $content = file_get_contents(DB_FILE);
    return json_decode($content, true);
}

function saveDB($data) {
    return file_put_contents(DB_FILE, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

function getJsonInput() {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?: [];
}

function getBearerToken() {
    $headers = null;
    if (isset($_SERVER['Authorization'])) {
        $headers = trim($_SERVER["Authorization"]);
    } else if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $headers = trim($_SERVER["HTTP_AUTHORIZATION"]);
    } elseif (function_exists('apache_request_headers')) {
        $requestHeaders = apache_request_headers();
        $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
        if (isset($requestHeaders['Authorization'])) {
            $headers = trim($requestHeaders['Authorization']);
        }
    }
    if (!empty($headers) && preg_match('/Bearer\s(\S+)/', $headers, $matches)) {
        return $matches[1];
    }
    return null;
}

function getSessionUser() {
    $token = getBearerToken();
    if (!$token || !file_exists(SESSION_FILE)) return null;
    $sessions = json_decode(file_get_contents(SESSION_FILE), true) ?: [];
    if (!isset($sessions[$token])) return null;
    $s = $sessions[$token];
    if (is_numeric($s)) {
        if (time() - $s >= 86400 * 7) return null;
        return ['username' => 'admin', 'role' => 'Super Admin', 'name' => 'Anirban Das'];
    }
    if (isset($s['time']) && (time() - $s['time'] >= 86400 * 7)) return null;
    return $s;
}

function verifyAdminSession() {
    return getSessionUser() !== null;
}

function saveAdminSession($token, $userData = null) {
    $sessions = [];
    if (file_exists(SESSION_FILE)) {
        $sessions = json_decode(file_get_contents(SESSION_FILE), true) ?: [];
    }
    if ($userData && is_array($userData)) {
        $userData['time'] = time();
        $sessions[$token] = $userData;
    } else {
        $sessions[$token] = time();
    }
    file_put_contents(SESSION_FILE, json_encode($sessions, JSON_PRETTY_PRINT), LOCK_EX);
}

function removeAdminSession($token) {
    if (file_exists(SESSION_FILE)) {
        $sessions = json_decode(file_get_contents(SESSION_FILE), true) ?: [];
        unset($sessions[$token]);
        file_put_contents(SESSION_FILE, json_encode($sessions, JSON_PRETTY_PRINT), LOCK_EX);
    }
}


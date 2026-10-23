<?php
require_once __DIR__ . '/db_helper.php';

$action = isset($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($action === 'captcha-config' || ($method === 'GET' && $action === 'captcha')) {
    $siteKey = getenv('TURNSTILE_SITE_KEY') ?: (getenv('NEXT_PUBLIC_TURNSTILE_SITE_KEY') ?: '');
    $policy = getenv('CAPTCHA_POLICY') ?: ($db['settings']['captchaPolicy'] ?? 'smart');
    if (!$siteKey) {
        $siteKey = '1x00000000000000000000AA'; // official test site key
    }
    echo json_encode([
        'success' => true,
        'provider' => 'turnstile',
        'siteKey' => $siteKey,
        'policy' => $policy,
        'required' => $policy === 'always'
    ]);
    exit;
}

if ($action === 'login' || ($method === 'POST' && !$action)) {
    $input = getJsonInput();
    $username = trim($input['username'] ?? '');
    $password = trim($input['password'] ?? '');
    $captchaToken = trim($input['captchaToken'] ?? ($input['cf-turnstile-response'] ?? ''));

    $secretKey = getenv('TURNSTILE_SECRET_KEY') ?: (getenv('CF_TURNSTILE_SECRET_KEY') ?: '1x0000000000000000000000000000000AA');
    $policy = getenv('CAPTCHA_POLICY') ?: ($db['settings']['captchaPolicy'] ?? 'smart');
    $isCaptchaRequired = ($policy === 'always');

    if ($isCaptchaRequired || !empty($captchaToken)) {
        if (empty($captchaToken)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'requireCaptcha' => true, 'message' => 'Please complete the security check']);
            exit;
        }

        // Verify with Cloudflare Turnstile
        $postData = http_build_query([
            'secret' => $secretKey,
            'response' => $captchaToken,
            'remoteip' => $_SERVER['REMOTE_ADDR'] ?? ''
        ]);
        $opts = [
            'http' => [
                'method' => 'POST',
                'header' => "Content-type: application/x-www-form-urlencoded\r\n",
                'content' => $postData,
                'timeout' => 5
            ]
        ];
        $context = stream_context_create($opts);
        $verifyRes = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $context);
        if ($verifyRes) {
            $cfData = json_decode($verifyRes, true);
            if (!$cfData || empty($cfData['success'])) {
                $errCodes = $cfData['error-codes'] ?? [];
                $msg = in_array('timeout-or-duplicate', $errCodes) ? 'Security check expired, try again' : 'Security check failed. Please try again.';
                http_response_code(400);
                echo json_encode(['success' => false, 'requireCaptcha' => true, 'resetCaptcha' => true, 'message' => $msg]);
                exit;
            }
        }
    }

    $users = $db['users'] ?? [];

    $matched = null;
    foreach ($users as $u) {
        if (strcasecmp($u['username'], $username) === 0 || (!empty($u['email']) && strcasecmp($u['email'], $username) === 0)) {
            // Verify password via password_verify or hash check
            $hash = $u['passwordHash'] ?? '';
            if (!empty($hash) && (password_verify($password, $hash) || $hash === $password)) {
                $matched = $u;
                break;
            }
        }
    }

    if ($matched) {
        $token = bin2hex(random_bytes(24));
        $sessionData = [
            'username' => $matched['username'],
            'role' => $matched['role'] ?? 'Super Admin',
            'name' => $matched['name'] ?? $matched['username']
        ];
        saveAdminSession($token, $sessionData);
        echo json_encode([
            'success' => true,
            'token' => $token,
            'username' => $matched['username'],
            'role' => $sessionData['role'],
            'name' => $sessionData['name'],
            'user' => $sessionData,
            'message' => 'Login successful'
        ]);
        exit;
    }
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Wrong email or password', 'requireCaptcha' => true, 'resetCaptcha' => true]);
    exit;
}

if ($action === 'verify' || ($method === 'GET' && $action === 'verify')) {
    $user = getSessionUser();
    if ($user) {
        echo json_encode(['success' => true, 'message' => 'Active session', 'user' => $user]);
    } else {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);
    }
    exit;
}

if ($action === 'logout') {
    $token = getBearerToken();
    if ($token) removeAdminSession($token);
    echo json_encode(['success' => true, 'message' => 'Logged out']);
    exit;
}

if ($action === 'change-password') {
    $user = getSessionUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }
    $input = getJsonInput();
    $current = $input['currentPassword'] ?? '';
    $newPass = $input['newPassword'] ?? '';
    if (strlen($newPass) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password must be 6+ chars']);
        exit;
    }

    $db = getDB();
    $found = false;
    if (isset($db['users'])) {
        foreach ($db['users'] as &$u) {
            if ($u['username'] === $user['username']) {
                if ($u['passwordHash'] !== $current) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'message' => 'Current password incorrect']);
                    exit;
                }
                $u['passwordHash'] = $newPass;
                $found = true;
                break;
            }
        }
    }

    if (!$found && $user['username'] === ($db['admin']['username'] ?? 'admin')) {
        if ($db['admin']['passwordHash'] !== $current) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Current password incorrect']);
            exit;
        }
        $db['admin']['passwordHash'] = $newPass;
        $found = true;
    }

    if ($found) {
        saveDB($db);
        echo json_encode(['success' => true, 'message' => 'Password changed']);
    } else {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'User not found']);
    }
    exit;
}

// User & Manager Management
if ($action === 'users') {
    $user = getSessionUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }

    if ($method === 'GET') {
        $users = array_map(function($u) {
            return ['username' => $u['username'], 'role' => $u['role'] ?? 'Manager', 'name' => $u['name'] ?? $u['username']];
        }, $db['users'] ?? []);
        echo json_encode(['success' => true, 'users' => $users, 'currentUser' => $user]);
        exit;
    }

    if ($method === 'POST') {
        if (($user['role'] ?? '') !== 'Super Admin') {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Super Admin only']);
            exit;
        }
        $input = getJsonInput();
        $uName = trim($input['username'] ?? '');
        $uPass = trim($input['password'] ?? '');
        $uRole = trim($input['role'] ?? 'Manager');
        $uRealName = trim($input['name'] ?? $uName);

        if (!$uName || strlen($uPass) < 6) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Valid username and 6+ character password required']);
            exit;
        }

        $db['users'] = $db['users'] ?? [];
        $existingIdx = -1;
        foreach ($db['users'] as $idx => $item) {
            if ($item['username'] === $uName) {
                $existingIdx = $idx;
                break;
            }
        }

        if ($existingIdx > -1) {
            $db['users'][$existingIdx]['passwordHash'] = $uPass;
            $db['users'][$existingIdx]['role'] = $uRole;
            $db['users'][$existingIdx]['name'] = $uRealName;
        } else {
            $db['users'][] = [
                'username' => $uName,
                'passwordHash' => $uPass,
                'role' => $uRole,
                'name' => $uRealName
            ];
        }

        $db['auditLog'] = $db['auditLog'] ?? [];
        array_unshift($db['auditLog'], [
            'id' => 'audit-' . time(),
            'timestamp' => date('c'),
            'user' => $user['username'],
            'role' => $user['role'],
            'action' => $existingIdx > -1 ? 'User Updated' : 'User Created',
            'vehicleId' => 'users',
            'vehicleName' => $uName,
            'oldPrice' => null,
            'newPrice' => null,
            'details' => "{$user['role']} {$user['username']} configured account for {$uName} ({$uRole})."
        ]);

        saveDB($db);
        $safeUsers = array_map(function($u) {
            return ['username' => $u['username'], 'role' => $u['role'] ?? 'Manager', 'name' => $u['name'] ?? $u['username']];
        }, $db['users'] ?? []);
        echo json_encode(['success' => true, 'message' => "Manager {$uName} saved successfully", 'users' => $safeUsers]);
        exit;
    }

    if ($method === 'DELETE') {
        if (($user['role'] ?? '') !== 'Super Admin') {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Super Admin only']);
            exit;
        }
        $targetUser = $_GET['username'] ?? '';
        if ($targetUser === 'admin') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Cannot delete primary Super Admin']);
            exit;
        }

        $db['users'] = array_values(array_filter($db['users'] ?? [], fn($u) => $u['username'] !== $targetUser));

        $db['auditLog'] = $db['auditLog'] ?? [];
        array_unshift($db['auditLog'], [
            'id' => 'audit-' . time(),
            'timestamp' => date('c'),
            'user' => $user['username'],
            'role' => $user['role'],
            'action' => 'User Deleted',
            'vehicleId' => 'users',
            'vehicleName' => $targetUser,
            'oldPrice' => null,
            'newPrice' => null,
            'details' => "{$user['role']} {$user['username']} removed account {$targetUser}."
        ]);

        saveDB($db);
        $safeUsers = array_map(function($u) {
            return ['username' => $u['username'], 'role' => $u['role'] ?? 'Manager', 'name' => $u['name'] ?? $u['username']];
        }, $db['users'] ?? []);
        echo json_encode(['success' => true, 'message' => "Account {$targetUser} removed", 'users' => $safeUsers]);
        exit;
    }
}

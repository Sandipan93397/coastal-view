<?php
require_once __DIR__ . '/db_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

if ($method === 'GET') {
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    echo json_encode([
        'success' => true,
        'vehicles' => $db['vehicles'] ?? [],
        'vehicleSettings' => $db['vehicleSettings'] ?? ['enableTripType' => true]
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
    $idParam = $_GET['id'] ?? '';
    $input = getJsonInput();

    if ($action === 'cell' || strpos($_SERVER['REQUEST_URI'] ?? '', '/cell') !== false) {
        $id = $_GET['id'] ?? ($input['id'] ?? '');
        $serviceType = $input['serviceType'] ?? '';
        $price = $input['price'] ?? null;
        $enabled = isset($input['enabled']) ? boolval($input['enabled']) : true;

        $db['vehicles'] = $db['vehicles'] ?? [];
        $found = false;
        foreach ($db['vehicles'] as &$v) {
            if ($v['id'] === $id) {
                $v['services'] = $v['services'] ?? [];
                $numPrice = ($price === null || $price === '' || !is_numeric($price)) ? null : max(0, floatval($price));
                $isEnabled = $numPrice === null ? false : $enabled;
                $v['services'][$serviceType] = [
                    'price' => $numPrice,
                    'enabled' => $isEnabled
                ];
                if ($serviceType === 'tour') {
                    $v['pricePerDay'] = $numPrice;
                }
                $found = true;
                break;
            }
        }
        if ($found) {
            saveDB($db);
            echo json_encode(['success' => true, 'message' => 'Cell updated']);
        } else {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Vehicle not found']);
        }
        exit;
    }

    if ($action === 'toggle-triptype' || $action === 'settings' || $idParam === 'settings') {
        $enable = !empty($input['enableTripType']);
        $db['vehicleSettings'] = $db['vehicleSettings'] ?? [];
        $db['vehicleSettings']['enableTripType'] = $enable;

        $db['auditLog'] = $db['auditLog'] ?? [];
        array_unshift($db['auditLog'], [
            'id' => 'audit-' . time(),
            'timestamp' => date('c'),
            'user' => $user['username'],
            'role' => $user['role'] ?? 'Admin',
            'action' => 'Settings Changed',
            'vehicleId' => 'tripType',
            'vehicleName' => 'Trip Type Selector',
            'oldPrice' => null,
            'newPrice' => null,
            'details' => "{$user['role']} {$user['username']} " . ($enable ? 'enabled' : 'disabled') . " the optional Trip Type selector."
        ]);

        saveDB($db);
        echo json_encode(['success' => true, 'vehicleSettings' => $db['vehicleSettings']]);
        exit;
    }

    $id = $_GET['id'] ?? ($input['id'] ?? '');
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Vehicle ID required']);
        exit;
    }

    $found = false;
    $updatedVehicle = null;
    $db['vehicles'] = $db['vehicles'] ?? [];

    foreach ($db['vehicles'] as &$v) {
        if ($v['id'] === $id) {
            $oldPrice = $v['pricePerDay'];
            $newPrice = isset($input['pricePerDay']) ? floatval($input['pricePerDay']) : $oldPrice;

            if (isset($input['pricePerDay']) && $newPrice !== $oldPrice) {
                $db['auditLog'] = $db['auditLog'] ?? [];
                array_unshift($db['auditLog'], [
                    'id' => 'audit-' . time() . '-' . rand(100, 999),
                    'timestamp' => date('c'),
                    'user' => $user['username'],
                    'role' => $user['role'] ?? 'Admin',
                    'action' => 'Price Updated',
                    'vehicleId' => $id,
                    'vehicleName' => $input['name'] ?? $v['name'],
                    'oldPrice' => $oldPrice,
                    'newPrice' => $newPrice,
                    'details' => "{$user['role']} {$user['username']} updated price of {$v['name']} from ₹" . number_format($oldPrice) . " to ₹" . number_format($newPrice) . "/day."
                ]);
                $v['pricePerDay'] = $newPrice;

                if ($id === 'car') {
                    $db['settings']['carRentalPricePerDay'] = $newPrice;
                }
            }

            if (isset($input['enabled']) && boolval($input['enabled']) !== boolval($v['enabled'])) {
                $nowEnabled = boolval($input['enabled']);
                $db['auditLog'] = $db['auditLog'] ?? [];
                array_unshift($db['auditLog'], [
                    'id' => 'audit-' . time() . '-' . rand(100, 999),
                    'timestamp' => date('c'),
                    'user' => $user['username'],
                    'role' => $user['role'] ?? 'Admin',
                    'action' => $nowEnabled ? 'Vehicle Enabled' : 'Vehicle Disabled',
                    'vehicleId' => $id,
                    'vehicleName' => $v['name'],
                    'oldPrice' => $v['pricePerDay'],
                    'newPrice' => $v['pricePerDay'],
                    'details' => "{$user['role']} {$user['username']} " . ($nowEnabled ? 'enabled' : 'disabled') . " availability for {$v['name']}."
                ]);
                $v['enabled'] = $nowEnabled;
            }

            if (isset($input['name'])) $v['name'] = trim($input['name']);
            if (isset($input['description'])) $v['description'] = trim($input['description']);
            if (isset($input['capacity'])) $v['capacity'] = intval($input['capacity']);
            if (isset($input['maxQuantity'])) $v['maxQuantity'] = intval($input['maxQuantity']);

            $updatedVehicle = $v;
            $found = true;
            break;
        }
    }

    if (!$found) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Vehicle not found']);
        exit;
    }

    if (isset($db['auditLog']) && count($db['auditLog']) > 500) {
        $db['auditLog'] = array_slice($db['auditLog'], 0, 500);
    }

    saveDB($db);
    echo json_encode([
        'success' => true,
        'vehicle' => $updatedVehicle,
        'message' => "{$updatedVehicle['name']} updated successfully"
    ]);
    exit;
}

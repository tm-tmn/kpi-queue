<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

try {
    $cfg = require __DIR__ . '/config.php';
    Json::send((new QueueService(Database::pdo(), $cfg['hn_mask_digits']))->today());
} catch (Throwable $e) {
    Json::fail($e);
}

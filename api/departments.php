<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

Auth::requireAdmin();
try {
    Json::send((new DepartmentService(Database::pdo()))->all());
} catch (Throwable $e) {
    Json::fail($e);
}

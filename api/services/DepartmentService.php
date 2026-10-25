<?php
declare(strict_types=1);

/** รายชื่อแผนกจาก HOSxP: kskdepartment(depcode, department) */
final class DepartmentService
{
    public function __construct(private PDO $db) {}

    /** @return array<int, array{depcode:string, department:string}> */
    public function all(): array
    {
        return Database::select('SELECT depcode, department FROM kskdepartment ORDER BY depcode');
    }
}

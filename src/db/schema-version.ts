/**
 * Latest migration version this build expects. /ready fails if the database is behind.
 * tests/unit/migrations.test.ts asserts this matches the newest file in src/db/migrations.
 */
export const EXPECTED_SCHEMA_VERSION = 2;

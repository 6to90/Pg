-- Destructive: drops all core tables and their data.
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;
DROP TABLE IF EXISTS indexer_checkpoints;
DROP TABLE IF EXISTS chain_events;
DROP TABLE IF EXISTS payment_transactions;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS tokens;
DROP TABLE IF EXISTS merchants;
DROP FUNCTION IF EXISTS audit_logs_immutable();
DROP FUNCTION IF EXISTS set_updated_at();

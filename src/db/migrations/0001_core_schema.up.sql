-- Core schema. Amounts are integers in token base units (NUMERIC(78,0) holds uint256).
-- Addresses and hashes are stored lowercase hex; CHECK constraints enforce the format.
-- Only testnet chain ids (31337 anvil, 84532 base sepolia) are accepted at the DB level too.

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE merchants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  recipient_address text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-f]{40}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tokens (
  chain_id   integer NOT NULL CHECK (chain_id IN (31337, 84532)),
  address    text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  symbol     text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 16),
  decimals   smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES merchants (id),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  key_prefix   text NOT NULL UNIQUE CHECK (char_length(key_prefix) BETWEEN 8 AND 32),
  key_hash     bytea NOT NULL CHECK (octet_length(key_hash) = 32), -- SHA-256 of the full key
  rotated_from uuid REFERENCES api_keys (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_keys_merchant_idx ON api_keys (merchant_id);

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         uuid NOT NULL REFERENCES merchants (id),
  merchant_order_id   text NOT NULL CHECK (char_length(merchant_order_id) BETWEEN 1 AND 128),
  -- 32 random bytes generated server-side; unpredictable, globally unique (it is the on-chain key).
  invoice_id          text NOT NULL UNIQUE CHECK (invoice_id ~ '^0x[0-9a-f]{64}$'),
  -- Chain, token and recipient are fixed at creation time and never updated.
  chain_id            integer NOT NULL CHECK (chain_id IN (31337, 84532)),
  gateway_address     text NOT NULL CHECK (gateway_address ~ '^0x[0-9a-f]{40}$'),
  token_address       text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  token_decimals      smallint NOT NULL CHECK (token_decimals BETWEEN 0 AND 36),
  currency            text NOT NULL CHECK (char_length(currency) BETWEEN 1 AND 16),
  recipient_address   text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-f]{40}$'),
  amount_atomic       numeric(78, 0) NOT NULL CHECK (amount_atomic > 0 AND amount_atomic < power(2::numeric, 256)),
  paid_amount_atomic  numeric(78, 0) CHECK (paid_amount_atomic >= 0 AND paid_amount_atomic < power(2::numeric, 256)),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'detected', 'confirming', 'confirmed', 'expired',
                        'underpaid', 'overpaid', 'failed', 'manual_review')),
  success_url         text CHECK (success_url IS NULL OR success_url ~ '^https?://'),
  cancel_url          text CHECK (cancel_url IS NULL OR cancel_url ~ '^https?://'),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  expires_at          timestamptz NOT NULL,
  detected_at         timestamptz,
  confirmed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (chain_id, token_address) REFERENCES tokens (chain_id, address),
  UNIQUE (merchant_id, merchant_order_id)
);
CREATE INDEX orders_merchant_created_idx ON orders (merchant_id, created_at DESC, id);
CREATE INDEX orders_pending_expiry_idx ON orders (expires_at) WHERE status = 'pending';
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE payment_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders (id),
  chain_id         integer NOT NULL CHECK (chain_id IN (31337, 84532)),
  tx_hash          text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index        integer NOT NULL CHECK (log_index >= 0),
  block_number     bigint NOT NULL CHECK (block_number >= 0),
  block_hash       text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  payer_address    text NOT NULL CHECK (payer_address ~ '^0x[0-9a-f]{40}$'),
  token_address    text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  recipient_address text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-f]{40}$'),
  amount_atomic    numeric(78, 0) NOT NULL CHECK (amount_atomic >= 0 AND amount_atomic < power(2::numeric, 256)),
  status           text NOT NULL DEFAULT 'observed'
                     CHECK (status IN ('observed', 'confirming', 'confirmed', 'orphaned', 'rejected')),
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- The same on-chain log can never be recorded twice.
  UNIQUE (chain_id, tx_hash, log_index)
);
-- At most one live transaction per order (orphaned/rejected ones are history).
CREATE UNIQUE INDEX payment_transactions_one_live_per_order
  ON payment_transactions (order_id) WHERE status IN ('observed', 'confirming', 'confirmed');

CREATE TABLE chain_events (
  id               bigserial PRIMARY KEY,
  chain_id         integer NOT NULL CHECK (chain_id IN (31337, 84532)),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash          text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index        integer NOT NULL CHECK (log_index >= 0),
  block_number     bigint NOT NULL CHECK (block_number >= 0),
  block_hash       text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  event_name       text NOT NULL,
  invoice_id       text CHECK (invoice_id IS NULL OR invoice_id ~ '^0x[0-9a-f]{64}$'),
  args             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'observed'
                     CHECK (status IN ('observed', 'confirmed', 'orphaned', 'rejected')),
  reject_reason    text,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX chain_events_block_idx ON chain_events (chain_id, block_number);
CREATE INDEX chain_events_invoice_idx ON chain_events (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE indexer_checkpoints (
  chain_id             integer NOT NULL CHECK (chain_id IN (31337, 84532)),
  contract_address     text NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  last_processed_block bigint NOT NULL CHECK (last_processed_block >= 0),
  -- Recent [blockNumber, blockHash] pairs used to detect reorgs.
  recent_blocks        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recent_blocks) = 'array'),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE webhook_endpoints (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                 uuid NOT NULL REFERENCES merchants (id),
  url                         text NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 2048),
  -- Secrets are encrypted at the application layer; never stored in plaintext.
  secret_ciphertext           bytea NOT NULL,
  previous_secret_ciphertext  bytea,
  previous_secret_expires_at  timestamptz,
  enabled                     boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_merchant_idx ON webhook_endpoints (merchant_id);

-- Doubles as the transactional outbox: rows are inserted in the same transaction as the
-- state change that caused them, and a worker delivers them afterwards.
CREATE TABLE webhook_deliveries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              text NOT NULL CHECK (event_id ~ '^evt_[0-9a-f]{32}$'),
  merchant_id           uuid NOT NULL REFERENCES merchants (id),
  endpoint_id           uuid NOT NULL REFERENCES webhook_endpoints (id),
  order_id              uuid REFERENCES orders (id),
  event_type            text NOT NULL,
  payload               jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'delivering', 'succeeded', 'failed', 'dead')),
  attempt_count         integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  last_attempt_at       timestamptz,
  last_response_code    integer,
  last_response_snippet text CHECK (last_response_snippet IS NULL OR char_length(last_response_snippet) <= 2048),
  last_error            text,
  delivered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX webhook_deliveries_order_idx ON webhook_deliveries (order_id);

CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES merchants (id),
  key             text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 255),
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  resource_type   text,
  resource_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  UNIQUE (merchant_id, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type  text NOT NULL CHECK (actor_type IN ('operator', 'merchant_api_key', 'system', 'indexer')),
  actor_id    text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  request_id  text,
  ip          inet,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_logs_time_idx ON audit_logs (occurred_at DESC);

-- Append-only: block UPDATE/DELETE/TRUNCATE regardless of which role connects.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER merchants_updated_at BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tokens_updated_at BEFORE UPDATE ON tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_transactions_updated_at BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER chain_events_updated_at BEFORE UPDATE ON chain_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER indexer_checkpoints_updated_at BEFORE UPDATE ON indexer_checkpoints FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER webhook_endpoints_updated_at BEFORE UPDATE ON webhook_endpoints FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER webhook_deliveries_updated_at BEFORE UPDATE ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

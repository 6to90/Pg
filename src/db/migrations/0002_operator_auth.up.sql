-- Single-operator dashboard authentication (logic arrives in Phase 6; schema is ready now).

CREATE TABLE operators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) <= 254),
  password_hash text NOT NULL, -- Argon2id PHC string
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operators_updated_at BEFORE UPDATE ON operators FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE operator_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32), -- SHA-256 of cookie value
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at      timestamptz,
  ip              inet,
  user_agent      text CHECK (user_agent IS NULL OR char_length(user_agent) <= 512)
);
CREATE INDEX operator_sessions_operator_idx ON operator_sessions (operator_id);

-- Failed/successful login attempts for throttling. `subject` is a keyed hash, not raw email/IP.
CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  subject      text NOT NULL,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_subject_idx ON login_attempts (subject, attempted_at DESC);

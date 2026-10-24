CREATE TABLE admins (
  id               serial PRIMARY KEY,
  username         text NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 64),
  password_hash    text NOT NULL,
  totp_secret      text,
  totp_last_step   bigint,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- В базе хранится только SHA-256 от токена сессии: утечка таблицы не даёт войти.
CREATE TABLE sessions (
  id          text PRIMARY KEY,
  admin_id    integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf_token  text NOT NULL,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_admin_idx ON sessions (admin_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE site_content (
  id          integer PRIMARY KEY CHECK (id = 1),
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id          uuid PRIMARY KEY,
  file_name   text NOT NULL,
  thumb_name  text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  bytes       integer NOT NULL,
  alt         text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    integer REFERENCES admins(id) ON DELETE SET NULL,
  action      text NOT NULL,
  ip          text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Migration 019: Generic per-user OAuth token storage
-- Created: 2026-04-30
-- Purpose: Foundation for per-user OAuth tokens across providers (Granola first).
--          Generalizes the per-provider Google token columns on the users table
--          (added in migration 004) into a separate table keyed by (user_id, provider).
--          Tokens stored plaintext, mirroring the existing Google convention; see
--          DECISIONS.md.

CREATE TABLE IF NOT EXISTS user_oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TIMESTAMP,
  server_url TEXT,
  scope TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_user_id
  ON user_oauth_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_user_oauth_tokens_lookup
  ON user_oauth_tokens(user_id, provider);

-- Reuse update_user_timestamp() defined in migration 001_users_table.sql
CREATE TRIGGER trigger_update_user_oauth_tokens_timestamp
BEFORE UPDATE ON user_oauth_tokens
FOR EACH ROW
EXECUTE FUNCTION update_user_timestamp();

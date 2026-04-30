-- Migration 020: Storage for OAuth Dynamic Client Registration (DCR) credentials
-- Created: 2026-04-30
-- Purpose: Per-deployment, per-provider DCR client info. One row per provider.
--          When the hub registers itself with a remote MCP server's OAuth
--          authorization server (e.g. Granola), the DCR response yields a
--          client_id (and possibly client_secret) shared by all users of this
--          deployment authenticating to that provider.
--          Used by the OAuthClientProvider implementations introduced in
--          Task 3B+.

CREATE TABLE IF NOT EXISTS mcp_dcr_clients (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  client_id_issued_at TIMESTAMP,
  client_secret_expires_at TIMESTAMP,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reuse update_user_timestamp() defined in migration 001_users_table.sql
CREATE TRIGGER trigger_update_mcp_dcr_clients_timestamp
BEFORE UPDATE ON mcp_dcr_clients
FOR EACH ROW
EXECUTE FUNCTION update_user_timestamp();

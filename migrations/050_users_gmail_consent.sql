-- Migration 050: Record that a user opted in to Oracle reading their Gmail
--
-- WHY
-- Gmail access is a separate, per-user opt-in (GET /api/auth/gmail, allowlisted
-- by GMAIL_CONSENT_ALLOWLIST), never part of the default Hub sign-in. The
-- granted scopes alone can't say "this person deliberately connected Gmail":
-- include_granted_scopes carries them forward on every later sign-in. This
-- column is that deliberate act, stamped by the consent callback.
--
-- CONNECTED = THIS COLUMN IS NOT NULL *AND* BOTH GMAIL SCOPES ARE IN
-- users.google_granted_scopes (hasGmailScopes in src/tools/gmail.js). A revoked
-- grant drops the scopes, so the column alone is never trusted.
--
-- Idempotent and safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN users.gmail_connected_at IS
  'When this user completed the opt-in Gmail consent (gmail.readonly + gmail.compose). NULL = never connected. Read with google_granted_scopes: both must agree.';

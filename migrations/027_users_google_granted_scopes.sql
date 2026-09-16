-- Migration 027: Remember which Google scopes a user actually granted
--
-- WHY
-- src/api/auth.js receives `tokens.scope` from Google on every sign-in and
-- throws it away: the upsert stores only access token, refresh token and expiry.
-- So nothing can answer "does this user's token include Chat read access?"
-- without asking Google.
--
-- That matters now because sessions are 7-day JWTs and stored refresh tokens
-- keep minting access tokens on whatever grant they were issued under. Adding a
-- scope to the sign-in list does NOT upgrade anyone already signed in; they keep
-- the old grant until they log out and back in. A tool that needs a new scope
-- therefore has to detect the gap and ask for a re-sign-in, in words, instead of
-- failing with a Google error.
--
-- NULL MEANS "NOT KNOWN YET", NOT "NO SCOPES"
-- Every existing row starts NULL. Code treats NULL as unknown and asks Google's
-- tokeninfo endpoint once, then backfills this column — so nobody is wrongly
-- told to sign in again, and the lookup happens at most once per user.
--
-- NOT AUTHORITATIVE
-- A user can revoke access out-of-band and this column will not know. It is a
-- fast pre-check; the 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT classifier that
-- src/tools/google-sheets.js and google-calendar.js already use stays the
-- backstop.
--
-- Idempotent and safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_granted_scopes TEXT;

COMMENT ON COLUMN users.google_granted_scopes IS
  'Space-delimited scope string Google returned with this user''s token, stored at sign-in. NULL = not known yet (pre-migration sign-in); code resolves it via tokeninfo and backfills. Not authoritative — out-of-band revocation is caught by the 403 scope classifier instead.';

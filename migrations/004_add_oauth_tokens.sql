-- Add OAuth token columns to users table
-- These store the user's Google OAuth tokens for creating documents on their behalf

ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP;

-- Index for faster lookups when refreshing tokens
CREATE INDEX IF NOT EXISTS idx_users_refresh_token ON users(google_refresh_token);

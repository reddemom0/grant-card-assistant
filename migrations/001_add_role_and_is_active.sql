-- Migration: Add role and is_active columns to users table
-- Date: 2025-11-04
-- Purpose: Fix 401 errors caused by missing columns in JWT verification

BEGIN;

-- Add role column (default: 'user')
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';

-- Add is_active column (default: true)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add updated_at column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Update existing rows to have default values
UPDATE users SET role = 'user' WHERE role IS NULL;
UPDATE users SET is_active = true WHERE is_active IS NULL;
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;

-- Add index for role queries (admin checks)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Add index for active users
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

COMMIT;

-- Verification queries (run these after migration)
-- SELECT COUNT(*) FROM users WHERE role IS NULL;        -- Should return 0
-- SELECT COUNT(*) FROM users WHERE is_active IS NULL;   -- Should return 0
-- SELECT id, email, role, is_active FROM users LIMIT 5; -- Verify data

COMMENT ON COLUMN users.role IS 'User role: user or admin';
COMMENT ON COLUMN users.is_active IS 'Whether user account is active';

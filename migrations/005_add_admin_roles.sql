-- Migration: 005_add_admin_roles.sql
-- Add role-based access control to users table
-- This enables admin functionality and user management

-- Add role column with default 'user'
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user';

-- Add active status flag
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;

-- Add last login timestamp for activity tracking
ALTER TABLE users ADD COLUMN last_login TIMESTAMP;

-- Create indexes for efficient queries
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_last_login ON users(last_login);

-- Add column comments
COMMENT ON COLUMN users.role IS 'User role: admin, user, client, guest';
COMMENT ON COLUMN users.is_active IS 'Whether user account is active';
COMMENT ON COLUMN users.last_login IS 'Timestamp of last successful login';

-- Note: To create your first admin user, run:
-- UPDATE users SET role = 'admin' WHERE email = 'your-email@granted.com';

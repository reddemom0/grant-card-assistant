-- Fix users table id to be SERIAL (INTEGER) instead of UUID
-- This matches what the users migration was supposed to create

-- Drop and recreate users table with correct schema
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);

-- Trigger to update users.updated_at
CREATE OR REPLACE FUNCTION update_user_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_timestamp
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_user_timestamp();

-- Add comments
COMMENT ON TABLE users IS 'Stores user authentication data from Google OAuth';
COMMENT ON COLUMN users.id IS 'Auto-incrementing integer user ID';
COMMENT ON COLUMN users.google_id IS 'Unique Google user ID';
COMMENT ON COLUMN users.email IS 'User email from Google';

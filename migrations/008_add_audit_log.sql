-- Migration: 008_add_audit_log.sql
-- Add admin activity audit log for security and compliance

CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id VARCHAR(255),
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX idx_audit_log_admin_user_id ON admin_audit_log(admin_user_id);
CREATE INDEX idx_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_audit_log_target_type ON admin_audit_log(target_type);

-- Add comments
COMMENT ON TABLE admin_audit_log IS 'Audit trail of all admin actions for security and compliance';
COMMENT ON COLUMN admin_audit_log.admin_user_id IS 'Admin user who performed the action';
COMMENT ON COLUMN admin_audit_log.action IS 'Action performed (e.g., user_role_changed, conversation_deleted, user_deactivated)';
COMMENT ON COLUMN admin_audit_log.target_type IS 'Type of entity affected (e.g., user, conversation, agent)';
COMMENT ON COLUMN admin_audit_log.target_id IS 'ID of the affected entity';
COMMENT ON COLUMN admin_audit_log.details IS 'JSON object with additional action details (before/after values, etc.)';
COMMENT ON COLUMN admin_audit_log.ip_address IS 'IP address of admin user';
COMMENT ON COLUMN admin_audit_log.user_agent IS 'Browser/client user agent string';

-- Example audit log entries:
-- INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
-- VALUES (1, 'user_role_changed', 'user', '123', '{"from": "user", "to": "admin", "reason": "promoted to team admin"}');

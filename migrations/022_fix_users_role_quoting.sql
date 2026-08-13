-- Migration 022: Fix quote-wrapped users.role values and column default
--
-- PROBLEM
-- users.role was stored as '"user"' — six bytes INCLUDING literal double
-- quotes (hex 227573657222). Because src/middleware/admin.js:28 tests
-- `req.user.role !== 'admin'`, requireAdmin rejected every account, making the
-- entire /api/admin/* router (30 routes) unreachable by the whole team.
--
-- SOURCE
-- The column default itself: '"user"'::text. Every migration in this repo
-- declares it correctly — 001_add_role_and_is_active.sql:8 and
-- 005_add_admin_roles.sql:6 both say DEFAULT 'user' as VARCHAR — but the live
-- column is TEXT with a JSON-quoted default, matching no migration file. It was
-- introduced by a manual ALTER outside version control.
--
-- Both application write paths are parameterized and clean
-- (src/database/admin-queries.js:107 and scripts/create-admin.js:45), and
-- src/api/auth.js:262 omits `role` from its INSERT so new users inherit the
-- column default. Fixing the default is therefore durable — no code path can
-- reinstate the quotes.
--
-- This migration is idempotent and safe to re-run.

-- 1. Fix the default so newly created users get an unquoted role.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- 2. Strip surrounding quotes from existing values. The LIKE guard means only
--    genuinely quote-wrapped values are touched, so re-running is a no-op and
--    an already-correct 'admin' or 'user' is left alone.
UPDATE users
SET role = trim(both '"' from role)
WHERE role LIKE '"%"';

-- NOTE: role is intentionally left NULLABLE. src/middleware/auth.js:68 already
-- coalesces with `user.role || 'user'`, and changing nullability is outside the
-- scope of this fix.

-- Migration: Deactivate Brandon Holden
-- Date: 2025-01-20
-- Purpose: Remove Brandon Holden from usage analytics (no longer with company)

BEGIN;

-- Find and display the user before deactivation
DO $$
DECLARE
    user_record RECORD;
BEGIN
    SELECT id, email, name, is_active, created_at
    INTO user_record
    FROM users
    WHERE LOWER(name) LIKE '%brandon%holden%'
       OR LOWER(email) LIKE '%brandon%holden%'
    LIMIT 1;

    IF FOUND THEN
        RAISE NOTICE 'Found user to deactivate:';
        RAISE NOTICE '  ID: %', user_record.id;
        RAISE NOTICE '  Name: %', user_record.name;
        RAISE NOTICE '  Email: %', user_record.email;
        RAISE NOTICE '  Currently Active: %', user_record.is_active;
    ELSE
        RAISE NOTICE 'No user found matching "Brandon Holden"';
    END IF;
END $$;

-- Deactivate Brandon Holden
UPDATE users
SET is_active = false,
    updated_at = NOW()
WHERE LOWER(name) LIKE '%brandon%holden%'
   OR LOWER(email) LIKE '%brandon%holden%';

-- Verify the update
DO $$
DECLARE
    user_record RECORD;
BEGIN
    SELECT id, email, name, is_active
    INTO user_record
    FROM users
    WHERE LOWER(name) LIKE '%brandon%holden%'
       OR LOWER(email) LIKE '%brandon%holden%'
    LIMIT 1;

    IF FOUND THEN
        RAISE NOTICE '✅ User successfully deactivated:';
        RAISE NOTICE '  Name: %', user_record.name;
        RAISE NOTICE '  Email: %', user_record.email;
        RAISE NOTICE '  Active: %', user_record.is_active;
    END IF;
END $$;

COMMIT;

-- Verification query (run separately to check)
-- SELECT id, email, name, is_active, updated_at
-- FROM users
-- WHERE LOWER(name) LIKE '%brandon%holden%';

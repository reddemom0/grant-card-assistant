-- Migration: Remove foreign key constraint on conversations.user_id
-- This allows conversations to be created for anonymous users without requiring a users table entry

-- First, find the constraint name
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  -- Get the foreign key constraint name
  SELECT constraint_name INTO constraint_name_var
  FROM information_schema.table_constraints
  WHERE table_name = 'conversations'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name LIKE '%user_id%';

  -- Drop the constraint if it exists
  IF constraint_name_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', constraint_name_var);
    RAISE NOTICE 'Dropped foreign key constraint: %', constraint_name_var;
  ELSE
    RAISE NOTICE 'No foreign key constraint found for user_id';
  END IF;
END $$;

-- Add a comment to document the change
COMMENT ON COLUMN conversations.user_id IS 'User UUID (nullable for anonymous users, no foreign key constraint)';

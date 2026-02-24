-- Migration 015: Add pre-chat form fields to lead_gen_conversations
-- Date: 2026-02-24
-- Purpose: Store pre-chat form data (company name, website) and extracted company background

ALTER TABLE lead_gen_conversations
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS company_website TEXT,
  ADD COLUMN IF NOT EXISTS company_background JSONB DEFAULT '{}';

-- Index for company lookups
CREATE INDEX IF NOT EXISTS idx_lead_gen_company_name
  ON lead_gen_conversations(company_name);

COMMENT ON COLUMN lead_gen_conversations.company_name IS
  'Company name entered in pre-chat form';
COMMENT ON COLUMN lead_gen_conversations.company_website IS
  'Company website URL entered in pre-chat form (normalized with https://)';
COMMENT ON COLUMN lead_gen_conversations.company_background IS
  'Extracted company information from website scrape: {description, industry, location, estimated_team_size, products_services}';

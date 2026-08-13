-- Migration 023: Map Hub users to their HubSpot owner records
--
-- WHY
-- Until now nothing connected a signed-in Hub user to their HubSpot owner ID.
-- `list_hubspot_owners` fetches the whole owner list live and takes no user
-- argument, so staff identity was never propagated into HubSpot. The
-- hubspot/DEAL_CREATION skill worked around this by instructing the model to
-- ask who the Deal Owner should be and to never default to a person.
--
-- HOW THE MAPPING WAS DERIVED
-- Exact, case-insensitive email match against GET /crm/v3/owners (14
-- non-archived + 99 archived owners). Name matching was deliberately NOT used:
-- three owner records are named "Stephanie Sang" and two are "Chris Small",
-- but every email match is unique.
--
-- NULLABLE BY DESIGN
-- Three of the eleven accounts have no usable owner: jorge@ and brandon@ match
-- owners whose HubSpot records are ARCHIVED (assignment would likely fail), and
-- chris.small011@gmail.com has no owner record at all. NULL means "no valid
-- owner" and callers must handle it — the skill falls back to asking.
--
-- Idempotent and safe to re-run.

-- BIGINT, not INTEGER: owner IDs already exceed 32-bit range
-- (e.g. delpreet@granted.ca -> 2047536337).
ALTER TABLE users ADD COLUMN IF NOT EXISTS hubspot_owner_id BIGINT;

COMMENT ON COLUMN users.hubspot_owner_id IS
  'HubSpot owner ID for this user, matched by exact email against GET /crm/v3/owners. NULL = no valid owner (archived owner record, or no owner exists). Used as the default Deal Owner; see .claude/skills/hubspot/DEAL_CREATION.md section 5.6.';

-- Partial index: most lookups go the other way (user -> owner), but reverse
-- lookups during auditing benefit, and NULLs are excluded since they are not
-- meaningful to search on.
CREATE INDEX IF NOT EXISTS idx_users_hubspot_owner_id
  ON users(hubspot_owner_id)
  WHERE hubspot_owner_id IS NOT NULL;

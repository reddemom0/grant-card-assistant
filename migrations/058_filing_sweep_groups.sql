-- Filing sweep pilot fixes (src/services/filing-sweep.js, src/cards/sweep-card.js):
-- files going to the same folder share one card (group_id), "not sure" items get
-- a Leave it here button (status 'left'), and a wage-subsidy paystub whose
-- employer has no client folder gets an advisory card (status 'advised').
-- Idempotent. Apply before deploying the code that writes group_id:
--   node migrations/run-migration.js migrations/058_filing_sweep_groups.sql

ALTER TABLE filing_sweep_suggestions ADD COLUMN IF NOT EXISTS group_id UUID;
CREATE INDEX IF NOT EXISTS filing_sweep_suggestions_group ON filing_sweep_suggestions (group_id);

ALTER TABLE filing_sweep_suggestions DROP CONSTRAINT IF EXISTS filing_sweep_suggestions_status_check;
ALTER TABLE filing_sweep_suggestions ADD CONSTRAINT filing_sweep_suggestions_status_check CHECK (status IN
  ('ok', 'excluded', 'unsure', 'would_suggest', 'suggested', 'listed',
   'confirmed', 'skipped', 'ignored', 'failed', 'advised', 'left'));

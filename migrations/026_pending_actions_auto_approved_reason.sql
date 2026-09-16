-- Migration 026: Record WHY a gated action ran without a human
--
-- WHY
-- The HubSpot webhook runs Oracle headlessly as the dedicated system account in
-- HUBSPOT_WEBHOOK_USER_EMAIL (src/api/hubspot-webhook.js resolveWebhookUser).
-- Nobody is present to reply "yes", so migration 025's gate made webhook deal
-- writes impossible. Deal create/update are now exempt for that one account —
-- and ONLY that account, and ONLY those two tools. Merges stay gated for
-- everyone.
--
-- An exempt call still writes a pending_actions row, with status 'auto_approved'
-- instead of 'confirmed', so the audit trail covers every gated call whether a
-- human approved it or the exemption did. This column says which exemption
-- applied, in words, so a future reader does not have to infer it from the
-- absence of confirmed_by.
--
-- Idempotent and safe to re-run.

ALTER TABLE pending_actions ADD COLUMN IF NOT EXISTS auto_approved_reason TEXT;

COMMENT ON COLUMN pending_actions.auto_approved_reason IS
  'Why this action ran without human confirmation, e.g. "webhook system account". NULL for every human-confirmed action.';

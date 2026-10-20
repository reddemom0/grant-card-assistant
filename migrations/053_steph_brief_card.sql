-- Migration 053: Steph's morning brief — what the redesigned card shows
--
-- WHY (card redesign, DECISIONS.md 2026-10-20)
-- The card now opens with "Start here" (the 1–2 most urgent items, ranked by
-- consequence), shows where each draft's context came from, links straight to
-- the saved Gmail draft, and badges mail sent to former staff. It is rebuilt
-- from steph_brief_items whenever Done is pressed, so these live on the row:
--
--   urgency            0–3 from the classify call (3 = needs an answer today)
--   finance            money involved (invoices, payments, contracts)
--   due_on             a promise's or a bill's due date
--   held               the saved draft is a holding reply — "Before you send"
--   sources            what was actually checked for the draft: HubSpot, Drive,
--                      Granola, Chat, GetGranted, website, the web
--   draft_message_id   the Gmail message id of the saved draft ("Open draft")
--   company            the sender's company, for "<Sender>, <Company>"
--   sent_to            the former-staff colleague the email was addressed to
--
-- Depends on: 052. Idempotent and safe to re-run.

ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS urgency SMALLINT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS finance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS due_on DATE;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS held BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS sources TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS draft_message_id TEXT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS sent_to TEXT;

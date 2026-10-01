-- 040: When each GetGranted Pulse alert last went out
--
-- One row per alert type. 'chat_spike' (src/services/pulse-spike.js) is the
-- first; later Pulse updates add their own alert_key. last_sent_at is the
-- cooldown clock: an alert is claimed by moving it forward in one statement,
-- and only when the previous send is older than the cooldown, so a redeploy or
-- a second instance can't send twice. Nothing else is stored — no counts, no
-- user ids, no client data.
--
-- Depends on: none. Apply BEFORE setting PULSE_SPIKE_SUBSCRIBERS — until then
-- the spike check logs once and skips every run rather than alert without a
-- cooldown. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS pulse_alert_state (
  alert_key    TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE pulse_alert_state IS
  'GetGranted Pulse alert cooldowns: one row per alert type, last_sent_at = when it last went out. Written by src/services/pulse-spike.js.';

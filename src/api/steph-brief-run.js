/**
 * POST /api/admin/steph-brief-run?secret=…&dry_run=1
 *
 * Manual trigger for Steph's morning brief (src/services/steph-brief.js).
 * Same auth as the other internal admin triggers (gg3-refresh): an admin Hub
 * session (authenticateUser + requireAdmin, applied in server.js) AND
 * ?secret= matching MIGRATION_SECRET || JWT_SECRET, compared in constant time.
 *
 *   dry_run=1 (the default) — reads Steph's mail as her and runs the Oracle
 *     steps (that costs money), creates NO Gmail drafts, writes only is_test
 *     rows, leaves her real item state untouched, and posts the card to the
 *     DM of the INBOX OWNER — never the caller's, unless the caller is that
 *     owner. No reachable DM for the owner → 409 inbox_owner_has_no_dm.
 *     The answer and the logs carry no mail content (quietLogs).
 *   dry_run=0 — a real run, through the same daily claim as the 08:00 job
 *     (so it can't double-post a day the job already ran).
 *
 *   inbox=<email> (dry runs only) — read that consented inbox instead of
 *     Steph's, e.g. Chris vetting the brief before Steph connects. Must be in
 *     GMAIL_CONSENT_ALLOWLIST; given with dry_run=0 or not allowlisted → 400.
 *     Still Steph's voice guide and meeting links; client Oracle runs act as
 *     that inbox's owner; is_test rows keyed by that inbox; no drafts; the
 *     card goes to that inbox's owner.
 *
 * Answers at once (202) after the cheap checks; the brief itself takes
 * minutes and lands in Chat. A check that fails answers 409 with its reason.
 */

import crypto from 'crypto';
import { inboxAllowed, preflight, runStephBrief, defaultDeps } from '../services/steph-brief.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function secretMatches(provided) {
  const expected = process.env.MIGRATION_SECRET || process.env.JWT_SECRET;
  if (!expected || typeof provided !== 'string' || !provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function stephBriefRunEndpoint(req, res, { deps = defaultDeps(), run = runStephBrief } = {}) {
  if (!secretMatches(req.query.secret)) return res.status(401).json({ error: 'Unauthorized' });
  const dryRun = req.query.dry_run !== '0';
  const dmToEmail = dryRun ? req.user?.email : null;
  let inboxEmail = null;
  if (req.query.inbox !== undefined) {
    const inbox = typeof req.query.inbox === 'string' ? req.query.inbox.trim().toLowerCase() : '';
    if (!dryRun) return res.status(400).json({ error: 'inbox_only_in_dry_run' });
    if (!EMAIL.test(inbox) || !inboxAllowed(inbox)) return res.status(400).json({ error: 'inbox_not_allowlisted' });
    inboxEmail = inbox;
  }
  let pre;
  try {
    pre = await preflight({ deps, dryRun, dmToEmail, inboxEmail });
    if (!pre.ok) return res.status(409).json({ started: false, dryRun, reason: pre.reason });
  } catch (err) {
    return res.status(500).json({ error: 'preflight_failed', code: err?.code || err?.name || 'unknown' });
  }
  // No addresses, names or mail content in the answer: where it goes, nothing more.
  res.status(202).json({ started: true, dryRun, postsTo: !dryRun ? "Steph's DM" : pre.toCaller ? 'your DM' : "the inbox owner's DM" });
  run({ deps, dryRun, dmToEmail, inboxEmail }).catch((err) => {
    console.error(`❌ Steph brief (manual) failed — code: ${err?.code || err?.name || 'unknown'}`);
  });
}

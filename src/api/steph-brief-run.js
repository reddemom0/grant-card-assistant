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
 *     CALLER's own DM, with each draft shown for review.
 *   dry_run=0 — a real run, through the same daily claim as the 08:00 job
 *     (so it can't double-post a day the job already ran).
 *
 * Answers at once (202) after the cheap checks; the brief itself takes
 * minutes and lands in Chat. A check that fails answers 409 with its reason.
 */

import crypto from 'crypto';
import { preflight, runStephBrief, defaultDeps } from '../services/steph-brief.js';

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
  try {
    const pre = await preflight({ deps, dryRun, dmToEmail });
    if (!pre.ok) return res.status(409).json({ started: false, dryRun, reason: pre.reason });
  } catch (err) {
    return res.status(500).json({ error: 'preflight_failed', code: err?.code || err?.name || 'unknown' });
  }
  res.status(202).json({ started: true, dryRun, postsTo: dryRun ? 'your DM' : "Steph's DM" });
  run({ deps, dryRun, dmToEmail }).catch((err) => {
    console.error(`❌ Steph brief (manual) failed — code: ${err?.code || err?.name || 'unknown'}`);
  });
}

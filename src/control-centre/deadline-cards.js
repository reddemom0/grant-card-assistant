/**
 * Control Centre — deadline cards (migration 057). Reads only, except through
 * review-queue.js addFlag.
 *
 *   runDeadlineSweep({write, deps, log})
 *       Today's live grants whose deadline text is a past date while their
 *       status is still active (coverage.js deadlineFlags — one parser,
 *       src/tools/deadline.js) → one review card per grant root (kind
 *       'grant_deadline'), flagged with source 'catalogue_check'. The flag's
 *       source_ref carries the parsed date, so the same date is a no-op on
 *       every later run; a deadline edited to another past date adds a flag
 *       (and reopens a closed card). A dry run returns what it would file and
 *       writes nothing.
 *
 * Runs inside the hourly review sweep (review-queue.js runReviewSweep), which
 * passes its own addFlag; a failure here is logged there and never stops the
 * 👎 path. No model call: the sweep's diagnosis gives these cards owner
 * research and verdict deadline_passed in code (diagnosis.js). Blank and
 * unreadable deadlines are counted, not filed. Docs: docs/control-centre.md.
 */

import { appQuery as appQueryDefault } from './db.js';
import { liveGrants as liveGrantsDefault } from './live-sources.js';
import { deadlineFlags } from './coverage.js';
import { vancouverDay } from './rollup.js';

export const DEADLINE_SOURCE = 'catalogue_check';
export const DEADLINE_ACTOR = 'system:deadline-check';
export const deadlineRef = (grantId, deadline) => `deadline:${grantId}:${deadline}`;

/** Pure: a passed-deadline row (deadlineFlags) → the flag addFlag files. */
export function deadlineFlagFor(row, today) {
  const daysOver = -(row.days ?? 0);
  return {
    kind: 'grant_deadline',
    grant_root_id: row.grant_id,
    source: DEADLINE_SOURCE,
    source_ref: deadlineRef(row.grant_id, row.deadline),
    source_created_at: null,
    actor: DEADLINE_ACTOR,
    comment: `Deadline "${row.deadline_text}" (${row.deadline}) is ${daysOver} ${daysOver === 1 ? 'day' : 'days'} past; the grant is still active`,
    snapshot: {
      source: DEADLINE_SOURCE,
      checked_on: today,
      grant: { id: row.grant_id, title: row.title ?? null, grantor: row.grantor ?? null,
        deadline_text: row.deadline_text, deadline: row.deadline, days_over: daysOver, status: 'active' }
    }
  };
}

/**
 * @param {{write?: boolean, deps?: {appQuery?, liveGrants?, addFlag?, now?}, log?}} [opts]
 * @returns {Promise<object>} counts, the rows (each with the flag it files), and the write results
 */
export async function runDeadlineSweep({ write = false, deps = {}, log = console.log } = {}) {
  const appQuery = deps.appQuery ?? appQueryDefault;
  const today = vancouverDay(deps.now ? deps.now() : new Date());
  const grants = await (deps.liveGrants ?? liveGrantsDefault)({ query: appQuery });
  const flags = deadlineFlags(grants, today);
  const summary = {
    today, live: grants.length, passed: flags.passed.length, due_soon: flags.due_soon.length,
    blank: flags.blank.length, unreadable: flags.unreadable.length, rolling: flags.rolling.length,
    rows: flags.passed.map((r) => ({ grant_id: r.grant_id, title: r.title, deadline: r.deadline,
      deadline_text: r.deadline_text, days_over: -r.days, flag: deadlineFlagFor(r, today) })),
    filed: 0, new_items: 0, reopened: 0, duplicate: 0, failed: 0, written: write
  };
  if (!write) {
    log(`CC deadline sweep (dry run): ${summary.passed} live grants past their deadline (${summary.blank} blank, ${summary.unreadable} unreadable)`);
    return summary;
  }
  if (typeof deps.addFlag !== 'function') throw new Error('runDeadlineSweep needs deps.addFlag to write');
  for (const row of summary.rows) {
    try {
      const r = await deps.addFlag(row.flag);
      if (r.duplicate) { summary.duplicate += 1; continue; }
      summary.filed += 1;
      if (r.created) summary.new_items += 1;
      if (r.reopened) summary.reopened += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`❌ CC deadline sweep: a flag failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  }
  log(`CC deadline sweep: ${summary.passed} past deadline → filed ${summary.filed} (${summary.new_items} new, ${summary.reopened} reopened), `
    + `${summary.duplicate} already on file, ${summary.failed} failed`);
  return summary;
}

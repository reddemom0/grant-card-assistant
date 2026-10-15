/**
 * Control Centre grant-pattern cards (migration 047)
 *
 * The AI Final Review (gg3-ai-service, ops ai_review_log) cuts grants from a
 * client's list with a reason category: wrong_industry, wrong_region,
 * ineligible, … When it cuts the same grant for the same reason for
 * PATTERN_MIN_COMPANIES or more companies in PATTERN_WINDOW_DAYS, the grant's
 * own data is the likelier problem than any one profile, so one card is filed
 * for the (grant root, category) pair.
 *
 *   - every cut in the group becomes a flag on the card: source ai_review_cut,
 *     source_ref ai_review:<ai_review_log id>, actor the client's Clerk id,
 *     comment the review's reason. source_ref dedupes, so the hourly run only
 *     adds what is new.
 *   - a card that already exists keeps collecting its pair's cuts even after
 *     the 7-day count drops below the threshold.
 *   - a closed card reopens only on a cut that happened after it was closed
 *     (review-queue.js reopensClosed); an older cut arriving late is evidence.
 *   - companies are counted through the app DB (Clerk id → company). Internal
 *     accounts count and are tagged in the evidence; a Clerk user with no
 *     company is kept as evidence but doesn't count.
 *   - every pattern card is linked to every match card for the same grant
 *     (cc_review_links), on each run.
 *
 * Diagnosis (diagnosis.js) takes the snapshot from patternSnapshot below: the
 * grant's current tags and card text from the Hub's gg3_grants copy, and the
 * review reasons with each company named.
 *
 * Reads ops and app read-only (db.js); writes the Hub only through addFlag
 * and LINK_PATTERNS_SQL. Logs carry counts and codes, never ids or reasons.
 *
 * Runs inside the hourly review sweep (review-queue.js runReviewSweep).
 * Docs: docs/control-centre.md.
 */

import { query } from '../database/connection.js';
import { opsQuery, appQuery } from './db.js';
import { identitiesForClerkIds, companyNamesForIds } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';

export const PATTERN_WINDOW_DAYS = 7;
export const PATTERN_MIN_COMPANIES = 3;
export const PATTERN_SOURCE = 'ai_review_cut';
export const PATTERN_REF_PREFIX = 'ai_review:';
export const MAX_SNAPSHOT_CUTS = 40;

const CARD_SECTION_CHARS = 3000;

// Ops DB, read-only. ai_review_log.company_id holds the client's Clerk id
// ("user_…"); anything else is a harness and is left out, as the roll-up does.
export const CUTS_SQL = `
  SELECT a.id::text AS id, a.occurred_at, a.grant_id, a.category, a.track, a.reason,
         a.suspected_cause, a.company_id AS clerk_id
    FROM ai_review_log a
   WHERE a.action = 'cut'
     AND a.occurred_at > now() - make_interval(days => $1::int)
     AND a.grant_id IS NOT NULL
     AND a.category IS NOT NULL
     AND a.company_id LIKE 'user\\_%'
   ORDER BY a.occurred_at, a.id`;

export const CUTS_BY_ID_SQL = `
  SELECT a.id::text AS id, a.occurred_at, a.grant_id, a.category, a.track, a.reason,
         a.suspected_cause, a.company_id AS clerk_id
    FROM ai_review_log a
   WHERE a.id = ANY($1::bigint[])
   ORDER BY a.occurred_at, a.id`;

// Hub DB.
export const PATTERN_ITEMS_SQL = `
  SELECT id, grant_root_id, pattern_category, status, closed_at
    FROM cc_review_items
   WHERE kind = 'grant_pattern'`;

// Every grant_pattern card ↔ every match card for the same grant root.
export const LINK_PATTERNS_SQL = `
  INSERT INTO cc_review_links (item_id, linked_item_id, relation)
  SELECT p.id, m.id, 'same_grant'
    FROM cc_review_items p
    JOIN cc_review_items m ON m.kind = 'match' AND m.grant_root_id = p.grant_root_id
   WHERE p.kind = 'grant_pattern'
  ON CONFLICT (item_id, linked_item_id) DO NOTHING`;

export const KNOWN_CUT_REFS_SQL = 'SELECT source_ref FROM cc_review_flags WHERE source_ref = ANY($1::text[])';

export const PATTERN_FLAG_REFS_SQL = `
  SELECT source_ref FROM cc_review_flags
   WHERE item_id = $1 AND source = 'ai_review_cut'
   ORDER BY source_created_at DESC NULLS LAST, id DESC
   LIMIT $2`;

export const GRANT_ROW_SQL = `
  SELECT id, grant_name, status, grant_type, program_provider, regions, industries, genre_scores,
         boost_attributes, eligibility_criteria, field_content
    FROM gg3_grants
   WHERE id = $1`;

export const refFor = (cutId) => `${PATTERN_REF_PREFIX}${cutId}`;
export const cutIdOf = (ref) => (String(ref).startsWith(PATTERN_REF_PREFIX) ? String(ref).slice(PATTERN_REF_PREFIX.length) : null);
const keyOf = (grantId, category) => `${grantId}|${category}`;

/**
 * Pure: cuts (each with company_id resolved, or null) → one group per
 * (grant, category), with the distinct companies that count.
 *
 * @returns {Map<string, {grant_id: number, category: string, cuts: Array, companies: number[]}>}
 */
export function groupCuts(cuts) {
  const groups = new Map();
  for (const c of cuts) {
    const key = keyOf(c.grant_id, c.category);
    let g = groups.get(key);
    if (!g) {
      g = { grant_id: Number(c.grant_id), category: c.category, cuts: [], companies: [] };
      groups.set(key, g);
    }
    g.cuts.push(c);
    if (c.company_id != null && !g.companies.includes(c.company_id)) g.companies.push(c.company_id);
  }
  return groups;
}

/** A group files a card at the threshold, or keeps feeding a card that already exists. */
export function qualifies(group, existing) {
  return Boolean(existing) || group.companies.length >= PATTERN_MIN_COMPANIES;
}

async function resolveCompanies(cuts, identities) {
  const ids = await identities([...new Set(cuts.map((c) => c.clerk_id))]);
  return cuts.map((c) => ({ ...c, company_id: ids.get(c.clerk_id)?.company_id ?? null }));
}

/**
 * Read the window's cuts, group them, and file what qualifies. Dry run unless
 * write is true: then it reads the Hub only for existing cards and filed refs,
 * and returns what it would file.
 *
 * @returns {Promise<{cuts_read: number, groups: number, qualifying: Array, filed: number, new_items: number,
 *                    reopened: number, late: number, failed: number, linked: number|null, written: boolean}>}
 */
export async function runPatternSweep({ write = false, deps = {}, log = console.log } = {}) {
  const ops = deps.opsQuery ?? opsQuery;
  const hubQuery = deps.hubQuery ?? query;
  const identities = deps.identities ?? ((ids) => identitiesForClerkIds(ids, { query: deps.appQuery ?? appQuery }));
  const flag = deps.addFlag;
  if (write && typeof flag !== 'function') throw new Error('runPatternSweep: deps.addFlag is required to write');

  const cuts = await resolveCompanies((await ops(CUTS_SQL, [PATTERN_WINDOW_DAYS])).rows, identities);
  const groups = groupCuts(cuts);
  let existingRows;
  let migrationMissing = false;
  try {
    existingRows = (await hubQuery(PATTERN_ITEMS_SQL)).rows;
  } catch (err) {
    // Before migration 047 there are no pattern cards. A dry run can still show
    // what would be filed; a write can't, and fails here.
    if (write || err?.code !== '42703') throw err;
    existingRows = [];
    migrationMissing = true;
  }
  const existing = new Map(existingRows.map((r) => [keyOf(r.grant_root_id, r.pattern_category), r]));

  const qualifying = [...groups.values()].filter((g) => qualifies(g, existing.get(keyOf(g.grant_id, g.category))));
  const refs = qualifying.flatMap((g) => g.cuts.map((c) => refFor(c.id)));
  const known = refs.length ? new Set((await hubQuery(KNOWN_CUT_REFS_SQL, [refs])).rows.map((r) => r.source_ref)) : new Set();

  const summary = {
    cuts_read: cuts.length, groups: groups.size, qualifying: [],
    filed: 0, new_items: 0, reopened: 0, late: 0, failed: 0, linked: null, written: write,
    ...(migrationMissing ? { note: 'migration 047 not applied here: no pattern cards exist yet' } : {})
  };

  for (const g of qualifying) {
    const item = existing.get(keyOf(g.grant_id, g.category)) ?? null;
    const fresh = g.cuts.filter((c) => !known.has(refFor(c.id)));
    const closedAt = item?.status === 'closed' && item.closed_at ? new Date(item.closed_at).getTime() : null;
    const reopenBy = closedAt == null ? [] : fresh.filter((c) => new Date(c.occurred_at).getTime() > closedAt);
    summary.qualifying.push({
      grant_id: g.grant_id, category: g.category, companies: g.companies, cuts: g.cuts.length,
      new_cuts: fresh.length, item_id: item?.id ?? null, item_status: item?.status ?? null,
      action: !item ? 'file' : !fresh.length ? 'none' : closedAt == null ? 'add evidence'
        : reopenBy.length ? 'reopen' : 'add late evidence (stays closed)',
      group: g
    });
  }

  if (!write) {
    log(`CC pattern sweep (dry run): ${cuts.length} cuts in ${groups.size} grant/reason groups; `
      + `${qualifying.length} at ${PATTERN_MIN_COMPANIES}+ companies or already carded`);
    return summary;
  }

  for (const g of qualifying) {
    for (const c of g.cuts) {
      if (known.has(refFor(c.id))) continue;
      try {
        const r = await flag({
          kind: 'grant_pattern', grant_root_id: g.grant_id, pattern_category: g.category,
          source: PATTERN_SOURCE, source_ref: refFor(c.id), source_created_at: c.occurred_at,
          actor: c.clerk_id, comment: c.reason || null
        });
        if (r.duplicate) continue;
        summary.filed += 1;
        if (r.created) summary.new_items += 1;
        if (r.reopened) summary.reopened += 1;
        if (r.late) summary.late += 1;
      } catch (err) {
        summary.failed += 1;
        console.error(`❌ CC pattern sweep: a flag failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
      }
    }
  }

  try {
    summary.linked = (await hubQuery(LINK_PATTERNS_SQL)).rowCount ?? 0;
  } catch (err) {
    console.error(`❌ CC pattern sweep: linking failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
  }

  log(`CC pattern sweep: filed ${summary.filed} cuts (${summary.new_items} new cards, ${summary.reopened} reopened, `
    + `${summary.late} late evidence), ${summary.linked ?? 0} new links, ${summary.failed} failed`);
  return summary;
}

// ---------------------------------------------------------------------------
// Snapshot (diagnosis)
// ---------------------------------------------------------------------------

/** Pure: a gg3_grants row → what the diagnosis needs of its tags and card. */
export function grantEvidence(row, { grantTags, cardSections }) {
  if (!row) return null;
  const { links, ...tags } = grantTags(row);
  return {
    ...tags,
    card: cardSections(row.field_content).map((s) => ({
      section: s.label,
      text: s.text.length > CARD_SECTION_CHARS ? `${s.text.slice(0, CARD_SECTION_CHARS)}…` : s.text
    }))
  };
}

/**
 * The evidence for a grant_pattern card: the grant as it is tagged now, and
 * the cuts behind the card (newest MAX_SNAPSHOT_CUTS) with each company named
 * and tagged internal. `cutIds` overrides the card's flags (the dry run has no
 * card yet).
 *
 * @returns {Promise<{ok: true, body: object} | {ok: false, code: string}>}
 */
export async function patternSnapshot(item, { hubQuery = query, opsQuery: ops = opsQuery, appQuery: app = appQuery, cutIds = null } = {}) {
  const grantData = await import('../tools/grant-data-modes.js');
  let ids = cutIds;
  if (!ids) {
    ids = (await hubQuery(PATTERN_FLAG_REFS_SQL, [item.id, MAX_SNAPSHOT_CUTS])).rows.map((r) => cutIdOf(r.source_ref)).filter(Boolean);
  }
  ids = ids.slice(-MAX_SNAPSHOT_CUTS);
  const cuts = ids.length ? (await ops(CUTS_BY_ID_SQL, [ids])).rows : [];
  if (!cuts.length) return { ok: false, code: 'pattern_no_cuts' };

  const resolved = await resolveCompanies(cuts, (clerkIds) => identitiesForClerkIds(clerkIds, { query: app }));
  const names = await companyNamesForIds(resolved.map((c) => c.company_id), { query: app });
  const row = (await hubQuery(GRANT_ROW_SQL, [item.grant_root_id])).rows[0] ?? null;
  const companies = [...new Set(resolved.map((c) => c.company_id).filter((id) => id != null))];

  return {
    ok: true,
    body: {
      grant_root_id: item.grant_root_id,
      category: item.pattern_category,
      window_days: PATTERN_WINDOW_DAYS,
      companies: companies.length,
      internal_companies: companies.filter(isInternalCompany).length,
      grant: grantEvidence(row, grantData),
      cuts: resolved.map((c) => ({
        ai_review_id: c.id,
        date: new Date(c.occurred_at).toISOString().slice(0, 10),
        company_id: c.company_id,
        company_name: c.company_id != null ? names.get(c.company_id) ?? null : null,
        company_internal: isInternalCompany(c.company_id),
        section: c.track ?? null,
        reason: c.reason ?? null,
        suspected_cause: c.suspected_cause ?? null
      }))
    }
  };
}

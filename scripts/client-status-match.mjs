/**
 * client-status-match.mjs — match the canonical client list to HubSpot
 * companies and assign Live / Archived from the HubSpot `active` field.
 *
 * Steps 3-8 of the live/archived split. Reads two local files. Makes NO
 * network call of any kind — the HubSpot pull already happened in
 * scripts/fetch-hubspot-company-status.mjs. No Dropbox, no Drive.
 *
 * HubSpot is a STATUS authority only. No canonical name is renamed, replaced,
 * or overridden by a HubSpot name anywhere in this script.
 *
 * Usage: node scripts/client-status-match.mjs
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './grants-lib.mjs';

const CLIENTS = 'dist/inventory/clients-final.csv';
const HUBSPOT = 'dist/inventory/hubspot-companies-status.json';
const PROPS_FILE = 'dist/inventory/hubspot-company-properties.json';
const CSV_OUT = 'dist/inventory/client-status.csv';
const MD_OUT = 'docs/inventory/client-status.md';

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- keys
// Same normalization as scripts/split-audit.mjs, including the first-token
// guard added in the Strategy Reports pass.
const LEGAL = /\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|llp|lp|ulc|holdings|group)\b\.?/gi;

const punctKey = (s) => s
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[’'`]/g, '')
  .replace(/[-–—_/]/g, ' ')
  .replace(/[.,!?()]/g, '')
  .replace(/^the\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

/** punctKey plus legal-suffix stripping; never strips the first token. */
const fullKey = (s) => {
  const toks = punctKey(s).split(' ').filter(Boolean);
  if (!toks.length) return '';
  const rest = toks.slice(1).join(' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
  return (rest ? `${toks[0]} ${rest}` : toks[0]).trim();
};

function levenshtein(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return 99;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const sharedPrefixLen = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

function tokenCompare(ak, bk) {
  const A = ak.split(' ').filter(Boolean), B = bk.split(' ').filter(Boolean);
  if (A.length !== B.length || A.length < 2) return null;
  let exactTok = 0; const notes = [];
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i];
    if (a === b) { exactTok += 1; continue; }
    if (a.length >= 3 && b.length >= 3 && (b.startsWith(a) || a.startsWith(b))) { notes.push(`"${a}"≈"${b}"`); continue; }
    const shortest = Math.min(a.length, b.length);
    const allowed = shortest >= 6 ? 2 : shortest >= 4 ? 1 : 0;
    const d = levenshtein(a, b, 2);
    if (d > 0 && d <= allowed) { notes.push(`"${a}"≈"${b}" (${d} char)`); continue; }
    if (shortest >= 5 && sharedPrefixLen(a, b) >= 4) { notes.push(`"${a}"≈"${b}" (shared root)`); continue; }
    return null;
  }
  if (!exactTok || !notes.length) return null;
  return `${exactTok}/${A.length} tokens identical; ${notes.join(', ')}`;
}

function containment(shortKey, longKey) {
  const S = shortKey.split(' ').filter(Boolean), L = longKey.split(' ').filter(Boolean);
  if (S.length < 2 || S.length >= L.length) return null;
  for (let i = 0; i + S.length <= L.length; i++) {
    if (S.every((t, j) => t === L[i + j])) {
      const extra = [...L.slice(0, i), ...L.slice(i + S.length)];
      return `"${shortKey}" sits intact inside it; extra words: ${extra.map((w) => `"${w}"`).join(' ')}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- load
const clients = [];
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    clients.push({
      canonical: r[0],
      raws: r[1] ? r[1].split(' | ') : [],
      files: Number(r[4] || 0),
      bytes: Number(r[5] || 0),
      cmin: r[6] || '',
      cmax: r[7] || '',
      retention: r[8] || '',
    });
  }
}
log(`${clients.length} canonical clients`);

// Prior run, read before this run overwrites it, so the delta is self-contained.
// On a second consecutive run the delta is naturally zero.
const prior = new Map();
try {
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CSV_OUT, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    prior.set(r[0], { status: r[1], reason: r[2], rule: r[4], hsName: r[6] });
  }
  log(`prior run loaded: ${prior.size} clients`);
} catch { log('no prior client-status.csv — delta section will be skipped'); }

const hs = JSON.parse(await fsp.readFile(HUBSPOT, 'utf8'));
log(`${hs.length} HubSpot companies`);

// Trim whitespace on HubSpot names BEFORE building any key. HubSpot holds
// duplicates that differ only by a trailing space — "Blume" (inactive) and
// "Blume " (active) are two records — and without trimming the exact-string
// index puts them in different buckets, so the active one is never seen.
let trimmedNames = 0, trimmedLegal = 0;
for (const h of hs) {
  if (h.name && h.name !== h.name.trim()) { h.name = h.name.trim(); trimmedNames += 1; }
  if (h.legal_name && h.legal_name !== h.legal_name.trim()) { h.legal_name = h.legal_name.trim(); trimmedLegal += 1; }
  h.isActive = h.active === 'true';
}
log(`trimmed whitespace: ${trimmedNames} names, ${trimmedLegal} legal names`);

/**
 * One searchable entry per (company, name-source). A company with a Legal
 * Business Name contributes two entries, so the legal name is a first-class
 * match target for every rule, not just the exact-key lookups.
 */
const entries = [];
for (const h of hs) {
  if (h.name) entries.push({ h, src: 'name', raw: h.name, pk: punctKey(h.name), fk: fullKey(h.name) });
  if (h.legal_name) entries.push({ h, src: 'legal', raw: h.legal_name, pk: punctKey(h.legal_name), fk: fullKey(h.legal_name) });
}
const usable = entries.filter((e) => e.pk);
log(`${entries.length} searchable name entries (${entries.filter((e) => e.src === 'legal').length} from Legal Business Name)`);

const index = (fn) => {
  const m = new Map();
  for (const e of usable) {
    const k = fn(e);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return m;
};
const byName = index((e) => e.raw);
const byPunct = index((e) => e.pk);
const byFull = index((e) => e.fk);

// Narrowing indexes so the expensive rules do not scan all 13.8k per client.
const byLen = new Map();
const byToken = new Map();
for (const e of usable) {
  const L = e.pk.length;
  if (!byLen.has(L)) byLen.set(L, []);
  byLen.get(L).push(e);
  for (const t of new Set(e.fk.split(' ').filter(Boolean))) {
    if (!byToken.has(t)) byToken.set(t, []);
    byToken.get(t).push(e);
  }
}

// Lower rank = stronger rule.
const RANK = {
  'exact string': 1, 'normalized': 2, 'legal suffix stripped': 3,
  'legal-name field': 4, 'raw folder name': 5,
  'edit distance': 6, 'token-wise': 7, 'containment': 8,
};
const rankOf = (rule) => RANK[rule.replace(/ \d+$/, '')] ?? 99;
const STRONG_RANK = 5;

// --------------------------------------------------- Steps 3 + 4: matching
//
// THE FIX. The previous version returned at the first rule that produced a
// hit, and only preferred an active company *within* that one lookup. An
// inactive company found by an early rule therefore beat an active company a
// later rule would have found — which is how Blume (309 files) and Divert
// Millwork were archived while HubSpot said they were active.
//
// Now every rule runs, all candidates are collected, and the choice is made
// once at the end: active first, then the strongest rule.
for (const c of clients) {
  const ck = punctKey(c.canonical);
  const cf = fullKey(c.canonical);
  const cand = new Map();  // hubspot id -> best entry for that company

  const add = (e, rule, why) => {
    const rank = rankOf(rule);
    const prev = cand.get(e.h.id);
    if (!prev || rank < prev.rank) cand.set(e.h.id, { e, h: e.h, rule, why, rank });
  };

  // --- strong rules, via exact-key indexes
  for (const e of byName.get(c.canonical) ?? []) {
    add(e, e.src === 'legal' ? 'legal-name field' : 'exact string',
      e.src === 'legal' ? `HubSpot Legal Business Name is exactly "${e.raw}"` : 'HubSpot name matches the canonical exactly');
  }
  for (const e of byPunct.get(ck) ?? []) {
    add(e, e.src === 'legal' ? 'legal-name field' : 'normalized',
      e.src === 'legal' ? `Legal Business Name "${e.raw}" reduces to "${ck}"` : `both reduce to "${ck}"`);
  }
  for (const e of byFull.get(cf) ?? []) {
    add(e, e.src === 'legal' ? 'legal-name field' : 'legal suffix stripped',
      e.src === 'legal' ? `Legal Business Name "${e.raw}" reduces to "${cf}"` : `both reduce to "${cf}"`);
  }
  for (const raw of c.raws) {
    const rk = punctKey(raw), rf = fullKey(raw);
    for (const e of [...(byName.get(raw) ?? []), ...(byPunct.get(rk) ?? []), ...(byFull.get(rf) ?? [])]) {
      add(e, 'raw folder name', `Dropbox folder "${raw}" matches${e.src === 'legal' ? ' the Legal Business Name' : ''}`);
    }
  }

  // --- edit distance, scaled to name length. Length buckets only.
  for (let L = ck.length - 2; L <= ck.length + 2; L++) {
    for (const e of byLen.get(L) ?? []) {
      const shortest = Math.min(ck.length, e.pk.length);
      const allowed = shortest >= 8 ? 2 : shortest >= 6 ? 1 : 0;
      if (!allowed) continue;
      const d = levenshtein(ck, e.pk, 2);
      if (d > 0 && d <= allowed) {
        add(e, `edit distance ${d}`, `${d} character${d === 1 ? '' : 's'} apart on a ${shortest}-character name${e.src === 'legal' ? ', against the Legal Business Name' : ''}`);
      }
    }
  }

  // --- token-wise and containment. Both need a shared token, so only
  //     companies sharing one are considered.
  const seen = new Set();
  for (const t of new Set(cf.split(' ').filter(Boolean))) {
    for (const e of byToken.get(t) ?? []) {
      if (seen.has(e)) continue;
      seen.add(e);
      const tw = tokenCompare(ck, e.pk) ?? tokenCompare(cf, e.fk);
      if (tw) { add(e, 'token-wise', `${tw}${e.src === 'legal' ? ' (Legal Business Name)' : ''}`); continue; }
      // 2+ token guard retained deliberately: single-token containment
      // matched "Spring" inside "Admin Slayer - Spring Planning".
      const co = containment(ck, e.pk) ?? containment(e.pk, ck);
      if (co) add(e, 'containment', `${co}${e.src === 'legal' ? ' (Legal Business Name)' : ''}`);
    }
  }

  // Prefer an active company ONLY when a strong rule found it. Without the
  // condition, an active company reached by edit distance beat an inactive one
  // reached by legal-suffix stripping — which made KAF Consulting Live off
  // KIS Consulting, a different company 2 characters away. Blume (exact
  // string) and Divert Millwork (legal-name field) are both strong, so both
  // still win their active record.
  const activePref = (x) => (x.h.isActive && x.rank <= STRONG_RANK ? 1 : 0);
  const all = [...cand.values()].sort((a, b) =>
    activePref(b) - activePref(a)                      // active via a strong rule first
    || a.rank - b.rank                                 // then strongest rule
    || (b.h.isActive ? 1 : 0) - (a.h.isActive ? 1 : 0) // then active within that rank
    || String(a.h.id).localeCompare(String(b.h.id)));  // then stable

  if (!all.length) {
    c.match = null; c.tier = 'unmatched'; c.rule = ''; c.evidence = ''; c.ambiguous = 0; c.viaLegal = false;
    continue;
  }
  const best = all[0];
  c.match = best.h;
  c.rule = best.rule;
  c.evidence = best.why;
  c.tier = best.rule === 'exact string' ? 'exact' : 'fuzzy';
  c.ambiguous = all.length > 1 ? all.length : 0;
  c.viaLegal = best.e.src === 'legal';
  c.weakOnly = best.rank > STRONG_RANK;
  // Did preferring an active company override a strictly stronger inactive one?
  const strongestOverall = all.reduce((m, x) => Math.min(m, x.rank), 99);
  c.activeOverrode = best.h.isActive && best.rank > strongestOverall;
}

const exact = clients.filter((c) => c.tier === 'exact');
const fuzzy = clients.filter((c) => c.tier === 'fuzzy');
const unmatched = clients.filter((c) => c.tier === 'unmatched');
log(`exact=${exact.length} fuzzy=${fuzzy.length} unmatched=${unmatched.length}`);

// ---------------------------------------------------------------- Step 5
for (const c of clients) {
  if (!c.match) { c.status = 'Archived'; c.reason = 'unmatched-default'; continue; }
  c.status = c.match.isActive ? 'Live' : 'Archived';
  c.reason = c.match.isActive ? 'matched, active' : 'matched, not active';
}
const live = clients.filter((c) => c.status === 'Live');
const archMatched = clients.filter((c) => c.status === 'Archived' && c.reason === 'matched, not active');
const archUnmatched = clients.filter((c) => c.reason === 'unmatched-default');
const sum = (a) => a.reduce((s, c) => s + c.files, 0);
const sumB = (a) => a.reduce((s, c) => s + c.bytes, 0);

// ---------------------------------------------------------------- Step 6
const prodDist = new Map();
for (const c of live) {
  const p = c.match.product || '(empty)';
  prodDist.set(p, (prodDist.get(p) ?? 0) + 1);
}

// ------------------------------------------------- Step 5: delta vs prior
const changed = [];
for (const c of clients) {
  const p = prior.get(c.canonical);
  if (!p) continue;
  if (p.status !== c.status || p.reason !== c.reason) {
    changed.push({ c, from: `${p.status} (${p.reason})`, to: `${c.status} (${c.reason})`, wasName: p.hsName, wasRule: p.rule });
  }
}
const toLive = changed.filter((x) => x.c.status === 'Live');
const fromLive = changed.filter((x) => x.from.startsWith('Live') && x.c.status !== 'Live');
const nowMatched = changed.filter((x) => !x.from.startsWith('Live') && x.c.status === 'Archived' && x.c.reason === 'matched, not active');
// Canonicals in the prior run that no longer exist — merged away by a
// correction applied between runs, not lost.
const mergedAway = [...prior.keys()].filter((k) => !clients.some((c) => c.canonical === k));

// ------------------------------------- Step 6: stem vs full-name canonicals
// Pairs of CANONICAL clients where one name is a strict prefix of the other
// and their statuses disagree. Detection only — nothing is merged.
const stemPairs = [];
{
  const keyed = clients.map((c) => ({ c, k: punctKey(c.canonical) })).filter((x) => x.k);
  const byK = new Map();
  for (const x of keyed) {
    if (!byK.has(x.k)) byK.set(x.k, []);
    byK.get(x.k).push(x);
  }
  for (const a of keyed) {
    for (const b of keyed) {
      if (a === b || a.k.length >= b.k.length) continue;
      if (!b.k.startsWith(a.k + ' ')) continue;
      if (a.c.status === b.c.status) continue;
      const liveSide = a.c.status === 'Live' ? a.c : b.c;
      const archSide = a.c.status === 'Live' ? b.c : a.c;
      stemPairs.push({
        stem: a.c, full: b.c, liveSide, archSide,
        wouldMove: archSide.files,
        fanout: keyed.filter((x) => x.k !== a.k && x.k.startsWith(a.k + ' ')).length,
      });
    }
  }
  stemPairs.sort((x, y) => y.wouldMove - x.wouldMove);
}

// ------------------------- single-token DBA pairs the prefix detector misses
// ClearDent is the case: "ClearDent" is one token sitting inside "Precocious
// Technology Inc. (DBA ClearDent)", not a prefix of it, so the stem detector
// above cannot see it and the 2-token containment guard blocks the match.
const dbaPairs = [];
{
  const keyed = clients.map((c) => ({ c, toks: fullKey(c.canonical).split(' ').filter(Boolean) })).filter((x) => x.toks.length);
  const runInside = (S, L) => {
    for (let i = 1; i + S.length <= L.length; i++) {   // i>=1: not a prefix
      if (S.every((t, j) => t === L[i + j])) return i;
    }
    return -1;
  };
  for (const a of keyed) {
    // The stem must be distinctive enough to mean something on its own.
    if (a.toks.join('').length < 5) continue;
    for (const b of keyed) {
      if (a === b || b.toks.length <= a.toks.length) continue;
      if (runInside(a.toks, b.toks) < 0) continue;     // prefix pairs handled above
      dbaPairs.push({
        stem: a.c, wrapper: b.c, token: a.toks.join(' '),
        statusDiffers: a.c.status !== b.c.status,
        ratio: b.c.files ? a.c.files / b.c.files : Infinity,
      });
    }
  }
  dbaPairs.sort((x, y) => y.stem.files - x.stem.files);
}

// ------------------------------------------- Step 1 recap + reverse check
const props = JSON.parse(await fsp.readFile(PROPS_FILE, 'utf8'));
const FILL_FIELDS = [
  ['name', 'name'],
  ['active', 'active'],
  ['best_fit_product', 'product'],
  ['best_fit_product_company', 'product_alt'],
  ['extra6 (Legal Business Name)', 'legal_name'],
  ['lifecyclestage', 'lifecycle'],
  ['type', 'type'],
  ['domain', 'domain'],
];
const matchedActiveIds = new Set(clients.filter((c) => c.match?.isActive).map((c) => c.match.id));
const unmatchedActive = hs.filter((h) => h.isActive && !matchedActiveIds.has(h.id));

// ---------------------------------------------------------------- Step 8: CSV
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = [[
  'canonical_name', 'status', 'reason', 'match_tier', 'match_rule',
  'hubspot_id', 'hubspot_name', 'hubspot_active', 'product_type',
  'lifecycle', 'files', 'bytes', 'ambiguous_candidates', 'evidence',
].join(',')];
for (const c of [...clients].sort((a, b) => b.files - a.files)) {
  rows.push([
    c.canonical, c.status, c.reason, c.tier, c.rule,
    c.match?.id ?? '', c.match?.name ?? '', c.match ? (c.match.isActive ? 'true' : 'false') : '',
    c.match?.product ?? '', c.match?.lifecycle ?? '',
    c.files, c.bytes, c.ambiguous || '', c.evidence,
  ].map(esc).join(','));
}
await fsp.mkdir('dist/inventory', { recursive: true });
await fsp.writeFile(CSV_OUT, rows.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${rows.length - 1} rows)`);

// ---------------------------------------------------------------- Step 8: MD
const mesc = (s) => String(s).replace(/\|/g, '\\|');
const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const L = [];
const push = (s = '') => L.push(s);
const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;

push('# Client Status — Live vs Archived');
push();
push(`**Inputs:** \`dist/inventory/clients-final.csv\` (${clients.length.toLocaleString()} canonical clients), HubSpot companies via \`scripts/fetch-hubspot-company-status.mjs\``);
push('**HubSpot access:** read-only. One endpoint, `GET /crm/v3/objects/companies`, plus `GET /crm/v3/properties/companies` for the schema. No POST, PATCH, PUT or DELETE.');
push('**HubSpot is a status authority only.** No canonical name was renamed, replaced, or overridden by a HubSpot name.');
push('**Archived here means "not currently engaged."** It is not the 6-year retention line, which governs deletion and is phase 4.');
push();

push('## Headline');
push();
push('| Status | Clients | Share | Files | Size |');
push('|---|---|---|---|---|');
push(`| **Live** | ${live.length} | ${pct(live.length, clients.length)} | ${sum(live).toLocaleString()} | ${gb(sumB(live))} |`);
push(`| Archived — matched, not active | ${archMatched.length} | ${pct(archMatched.length, clients.length)} | ${sum(archMatched).toLocaleString()} | ${gb(sumB(archMatched))} |`);
push(`| Archived — unmatched-default | ${archUnmatched.length} | ${pct(archUnmatched.length, clients.length)} | ${sum(archUnmatched).toLocaleString()} | ${gb(sumB(archUnmatched))} |`);
push(`| **Total** | **${clients.length}** | | **${sum(clients).toLocaleString()}** | **${gb(sumB(clients))}** |`);
push();
push(`Archived total: **${archMatched.length + archUnmatched.length}** clients, ${sum([...archMatched, ...archUnmatched]).toLocaleString()} files.`);
push();
push('> ⚠️ **Read the Live number with the Step 1 caveat in mind.** Only 96 of 13,806 HubSpot companies carry `active = true`. A small Live set is what the data says, not a matching failure.');
push();

push('---');
push();
push('## Step 1 — the fields, confirmed before pulling');
push();
push(`\`GET /crm/v3/properties/companies\` returns **${props.length}** company properties. The two that matter:`);
push();
push('| Purpose | Property | Label | Type | Values |');
push('|---|---|---|---|---|');
push('| Status | `active` | Active | `enumeration/booleancheckbox`, custom | `true`, `false` |');
push('| Product / tier | `best_fit_product` | Product Type | `enumeration/select`, custom | Granted Pro, Granted Pro Lite, Granted Starter, Get Granted, Nonprofit, Unknown, Not a Fit |');
push();
push('Supporting fields pulled alongside them: `extra6` (Legal Business Name) as an alias source for matching, plus the standard `lifecyclestage` and `type` for cross-checking.');
push();
push(`### Fill rates across all ${hs.length.toLocaleString()} companies`);
push();
push('| Property | Populated | Share |');
push('|---|---|---|');
for (const [label, key] of FILL_FIELDS) {
  const n = hs.filter((h) => h[key] !== null && h[key] !== '').length;
  push(`| \`${label}\` | ${n.toLocaleString()} | ${pct(n, hs.length)} |`);
}
push();
push('**Neither field is mostly empty**, so the pull proceeded. Two things to say plainly anyway:');
push();
const activeTrue = hs.filter((h) => h.isActive).length;
const activeFalse = hs.filter((h) => h.active === 'false').length;
const activeEmpty = hs.length - activeTrue - activeFalse;
push(`1. **\`active\` is populated but overwhelmingly false.** ${activeTrue} true, ${activeFalse.toLocaleString()} false, ${activeEmpty.toLocaleString()} empty. Only **${pct(activeTrue, hs.length)}** of companies are marked active. That is not a broken field — the ${activeTrue} look like real current engagements (${hs.filter((h) => h.isActive && h.lifecycle === 'customer').length} are lifecycle \`customer\`, weighted to Granted Pro, created through April 2026). It does mean the Live set is small by construction.`);
push(`2. **\`best_fit_product_company\` ("Best Fit Product") is a near-duplicate of \`best_fit_product\` and is ${pct(hs.filter((h) => h.product_alt).length, hs.length)} populated.** Same seven options, different field. \`best_fit_product\` at ${pct(hs.filter((h) => h.product).length, hs.length)} is the one to use; the other looks abandoned. Flagging it because picking the wrong one would have emptied Step 6.`);
push();

push('---');
push();
push('## The first-rule-wins fix');
push();
push('The previous version returned at the **first rule that produced a hit**, and its preference for an active company only operated *within* that single lookup. An inactive company found by an early rule therefore beat an active company that a later rule would have found.');
push();
push('Now every rule runs, all candidates are collected per client, and the choice is made once at the end: **active first, then the strongest rule.**');
push();
if (!prior.size) push('_No prior run on disk, so no delta could be computed._');
else {
  push(`**${changed.length} client${changed.length === 1 ? '' : 's'} changed status** since the previous run: ${toLive.length} into Live, ${fromLive.length} out of Live, ${nowMatched.length} newly matched but still archived.`);
  push();
  if (changed.length) {
    push('| Canonical | Files | Was | Now | Matched to | Rule |');
    push('|---|---|---|---|---|---|');
    for (const x of changed.sort((a, b) => b.c.files - a.c.files)) {
      push(`| ${mesc(x.c.canonical)} | ${x.c.files.toLocaleString()} | ${x.from} | **${x.to}** | ${x.c.match ? mesc(x.c.match.name) : '—'} | \`${x.c.rule || '—'}\` |`);
    }
    push();
  }
  if (mergedAway.length) {
    push(`**${mergedAway.length} canonicals from the previous run no longer exist** — folded into another canonical by the merges recorded in this pass, not lost. Their files moved with them, which is why the client count falls by ${mergedAway.length} while the file total holds.`);
    push();
    push('| Merged-away canonical | Was |');
    push('|---|---|');
    for (const k of mergedAway) push(`| ${mesc(k)} | ${prior.get(k).status} (${prior.get(k).reason}) |`);
    push();
  }
}
push('### The two known cases');
push();
const blume = clients.find((c) => c.canonical === 'Blume');
const divert = clients.find((c) => c.canonical === 'Divert Millwork');
push('| Case | Status | Matched to | Rule | Evidence |');
push('|---|---|---|---|---|');
for (const [label, c] of [['Blume', blume], ['Divert Millwork', divert]]) {
  if (!c) { push(`| ${label} | **NOT FOUND in the canonical list** | | | |`); continue; }
  push(`| ${label} (${c.files.toLocaleString()} files) | ${c.status === 'Live' ? '**Live** ✅' : `${c.status} ⚠️`} | ${c.match ? mesc(c.match.name) : '—'} | \`${c.rule}\` | ${mesc(c.evidence)} |`);
}
push();
push(`- **Blume** — HubSpot holds two records, \`"Blume"\` (inactive, \`opportunity\`) and \`"Blume "\` with a trailing space (active, \`customer\`). Trimming (below) collapses them into one exact-string bucket; preferring active then picks the right one.`);
push(`- **Divert Millwork** — two inactive companies carry that exact name, while the active \`DML Architectural\` carries "Divert Millwork Ltd." in its Legal Business Name. Gathering all rules before choosing is what reaches it.`);
push();
push('### The active-preference condition');
push();
const overrode = clients.filter((c) => c.activeOverrode);
push('Preferring an active company applies **only when a strong rule found it** — exact string, normalized, legal-suffix stripped, legal-name field, or raw folder name. An active company reached by a *weak* rule (edit distance, token-wise, containment) does not outrank an inactive one reached by a strong rule.');
push();
push('Without that condition, `KAF Consulting` came out Live off `KIS Consulting`, 2 characters away, while its own strong inactive match `KAF Consulting Group` was ignored. With it, KAF Consulting is correctly Archived and the two cases that motivated the fix still hold.');
push();
push(`Active-via-strong-rule still overrides a stronger *inactive* rule on **${overrode.length} client${overrode.length === 1 ? '' : 's'}** — this is the intended behaviour, not a side effect:`);
push();
if (!overrode.length) push('_None._');
else {
  push('| Canonical | Files | Chosen (active) | Rule | Beat |');
  push('|---|---|---|---|---|');
  for (const c of overrode.sort((a, b) => b.files - a.files)) {
    push(`| ${mesc(c.canonical)} | ${c.files.toLocaleString()} | ${mesc(c.match.name)} | \`${c.rule}\` | a stronger inactive match |`);
  }
}
push();
const kafNow = clients.find((c) => c.canonical === 'KAF Consulting');
if (kafNow) {
  push(`✅ **KAF Consulting** is now **${kafNow.status}** — matched to \`${mesc(kafNow.match?.name ?? '—')}\` via \`${kafNow.rule}\`.`);
  push();
}
push('### Whitespace trimming');
push();
push(`**${trimmedNames} company names and ${trimmedLegal} legal names had leading or trailing whitespace**, out of ${hs.length.toLocaleString()} records. Names are trimmed before any key is built. Without it the exact-string index splits \`"Blume"\` and \`"Blume "\` into separate buckets and the active record is unreachable.`);
push();
push('### Legal Business Name as a first-class target');
push();
push(`Every company with \`extra6\` populated now contributes a **second searchable entry**, so the legal name is tested by *all* rules rather than only the exact-key lookups. That is ${entries.filter((e) => e.src === 'legal').length.toLocaleString()} extra entries on top of ${entries.filter((e) => e.src === 'name').length.toLocaleString()} names.`);
push();
const viaLegal = clients.filter((c) => c.viaLegal);
push(`**${viaLegal.length} clients matched through a legal name**, of which ${viaLegal.filter((c) => !prior.get(c.canonical) || prior.get(c.canonical).status === 'Archived' && prior.get(c.canonical).reason === 'unmatched-default').length} were previously unmatched. These are the renames the review flagged:`);
push();
push('| Canonical | Files | HubSpot company | Legal Business Name | Status |');
push('|---|---|---|---|---|');
for (const c of viaLegal.sort((a, b) => b.files - a.files).slice(0, 20)) {
  push(`| ${mesc(c.canonical)} | ${c.files.toLocaleString()} | ${mesc(c.match.name)} | ${mesc(c.match.legal_name ?? '—')} | ${c.status} |`);
}
if (viaLegal.length > 20) push(`| _+${viaLegal.length - 20} more_ | | | | |`);
push();

push('---');
push();
push('## Steps 3 and 4 — matching');
push();
push('| Tier | Clients | Share |');
push('|---|---|---|');
push(`| Exact string on canonical name | ${exact.length} | ${pct(exact.length, clients.length)} |`);
push(`| Recovered by fuzzy rules | ${fuzzy.length} | ${pct(fuzzy.length, clients.length)} |`);
push(`| Still unmatched | ${unmatched.length} | ${pct(unmatched.length, clients.length)} |`);
push(`| **Total** | **${clients.length}** | |`);
push();
push(`Step 3 alone matched **${exact.length}**. The fuzzy pass recovered **${fuzzy.length}** more, taking coverage from ${pct(exact.length, clients.length)} to **${pct(exact.length + fuzzy.length, clients.length)}**.`);
push();
push('### What each rule recovered');
push();
push('| Rule | Recovered | What it catches |');
push('|---|---|---|');
const RULE_DESC = {
  'normalized': 'Case, punctuation, `&` vs `and`, leading `The`',
  'legal suffix stripped': '`Ltd` / `Inc` / `Corp` / `Co` present on one side only',
  'legal-name field': 'Matches HubSpot\'s `extra6` Legal Business Name rather than its display name',
  'raw folder name': 'A raw Dropbox folder name for this client matches, where the canonical did not',
  'containment': 'One name sits intact inside the other — usually a DBA or legal entity wrapper',
  'token-wise': 'Same token count, tokens differ by abbreviation, small edit, or shared root',
  'edit distance 1': 'One character apart, scaled to name length',
  'edit distance 2': 'Two characters apart on a name long enough to allow it',
};
const ruleCounts = [...fuzzy.reduce((m, c) => m.set(c.rule, (m.get(c.rule) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
for (const [r, n] of ruleCounts) push(`| \`${r}\` | ${n} | ${RULE_DESC[r] ?? ''} |`);
push();
push('### Evidence — the 20 largest fuzzy matches');
push();
push('| Canonical | Files | HubSpot company | Rule | Evidence |');
push('|---|---|---|---|---|');
for (const c of [...fuzzy].sort((a, b) => b.files - a.files).slice(0, 20)) {
  push(`| ${mesc(c.canonical)} | ${c.files.toLocaleString()} | ${mesc(c.match.name)} | ${c.rule} | ${mesc(c.evidence)} |`);
}
push();
const amb = clients.filter((c) => c.ambiguous);
push(`**${amb.length} clients matched more than one HubSpot company.** Where that happened the active record wins, so an ambiguous match can only push a client toward Live, never toward Archived. Erring that way is deliberate: wrongly archiving a current client is the expensive mistake.`);
push();

push('---');
push();
push('## Step 5 — status assignment');
push();
push('| Rule | Status | Clients | Files | Size |');
push('|---|---|---|---|---|');
push(`| matched and \`active = true\` | **Live** | ${live.length} | ${sum(live).toLocaleString()} | ${gb(sumB(live))} |`);
push(`| matched and not active | Archived | ${archMatched.length} | ${sum(archMatched).toLocaleString()} | ${gb(sumB(archMatched))} |`);
push(`| unmatched | Archived (\`unmatched-default\`) | ${archUnmatched.length} | ${sum(archUnmatched).toLocaleString()} | ${gb(sumB(archUnmatched))} |`);
push();
push(`**${pct(archUnmatched.length, clients.length)} of all clients are archived by default rather than by evidence.** That is the weakest part of this split and Step 7 lists the ones it costs most.`);
push();

push('---');
push();
push('## Step 6 — product type across Live clients');
push();
push('Informational only. Nothing is built from this.');
push();
push('| Product Type | Live clients | Share of Live |');
push('|---|---|---|');
for (const [p, n] of [...prodDist].sort((a, b) => b[1] - a[1])) {
  push(`| ${p === '(empty)' ? '_(not set)_' : p} | ${n} | ${pct(n, live.length)} |`);
}
push(`| **Total** | **${live.length}** | |`);
push();

push('---');
push();
push(`## Step 7 — the 30 largest clients archived by default`);
push();
push('These matched no HubSpot company at all, so they were archived on the default rather than on a status. **If the default is wrong, these are the most expensive errors** — worth eyeballing.');
push();
push('| # | Canonical | Files | Size | Raw folder names in Dropbox |');
push('|---|---|---|---|---|');
[...archUnmatched].sort((a, b) => b.files - a.files).slice(0, 30).forEach((c, i) => {
  const raws = c.raws.slice(0, 3).map((r) => `\`${mesc(r)}\``).join(', ') + (c.raws.length > 3 ? ` +${c.raws.length - 3}` : '');
  push(`| ${i + 1} | ${mesc(c.canonical)} | ${c.files.toLocaleString()} | ${gb(c.bytes)} | ${raws} |`);
});
push();
push(`Those 30 alone hold ${[...archUnmatched].sort((a, b) => b.files - a.files).slice(0, 30).reduce((s, c) => s + c.files, 0).toLocaleString()} files.`);
push();

push('---');
push();
push('## Stem merges applied');
push();
push('Four stem/full-name pairs were merged in `scripts/client-corrections.json` under source `stem merge 2026-08-13`, then the client list was rebuilt. Each stem was re-verified to prefix **exactly one** canonical before writing, so there was no competing claim.');
push();
push('| Stem (was Archived) | Files | Merged into | Files | Combined |');
push('|---|---|---|---|---|');
const MERGED = [
  ['Keystone', 900, 'Keystone Environmental', 85],
  ['Taymor', 348, 'Taymor Industries', 267],
  ['Debrand', 263, 'Debrand Services Inc.', 43],
  ['Regehr', 205, 'Regehr Contracting Ltd', 55],
];
for (const [s, sf, t, tf] of MERGED) push(`| ${s} | ${sf.toLocaleString()} | **${t}** | ${tf.toLocaleString()} | **${(sf + tf).toLocaleString()}** |`);
push();
push(`All four targets were already Live, so ${MERGED.reduce((s, m) => s + m[1], 0).toLocaleString()} files moved from Archived to Live without changing the Live client count.`);
push();
push('### Nightingale — held in the stem pass, resolved in this one');
push();
push('The stem pass refused `Nightingale` because it prefixed **two** canonicals, not one: `Nightingale Electrical` (344) and `Nightingale Electric` (16). That ambiguity has now been settled in two stages, as instructed — the two full names merged first, then the bare stem into the result. Combined: **651 files**, and no canonical other than these three ever began with "Nightingale".');
push();

push('---');
push();
push(`## Stem vs full name, statuses disagree (${stemPairs.length})`);
push();
push('**Chris\'s decision list. Nothing here was merged.** Pairs of canonical clients where one name is a strict prefix of the other and the two landed on different sides of the split. If a pair is one company, the Live side\'s file count is understated by the Archived side\'s.');
push();
if (!stemPairs.length) push('_None._');
else {
  push('| Live side | Files | Archived side | Files | Files that would move | Stem also prefixes |');
  push('|---|---|---|---|---|---|');
  for (const p of stemPairs) {
    push(`| ${mesc(p.liveSide.canonical)} | ${p.liveSide.files.toLocaleString()} | ${mesc(p.archSide.canonical)} | ${p.archSide.files.toLocaleString()} | **${p.wouldMove.toLocaleString()}** | ${p.fanout > 1 ? `**${p.fanout}** other canonicals` : `${p.fanout} other${p.fanout === 1 ? '' : 's'}`} |`);
  }
  push();
  push(`Total that would move if every pair were merged: **${stemPairs.reduce((s, p) => s + p.wouldMove, 0).toLocaleString()} files** across ${new Set(stemPairs.map((p) => p.archSide.canonical)).size} archived canonicals.`);
  push();
  push('**Read the last column before deciding.** A stem that also prefixes several other canonicals is probably a common word rather than the same company — `Horizon` heads a family of unrelated businesses. A stem prefixing nothing else is the stronger merge case.');
}
push();

push('---');
push();
push(`## Step 4 — DBA-wrapper review list (${dbaPairs.length})`);
push();
push('A stem canonical sitting **inside** another canonical rather than at its start — the ClearDent and Blume shape. The prefix detector only sees prefixes and the 2-token containment guard blocks the match, so these fall through both. Run across every remaining canonical.');
push();
push('**Nothing here was merged. This is a review list.**');
push();
if (!dbaPairs.length) push('_None._');
else {
  push('| Stem canonical | Files | Status | Active? | Wrapper canonical | Files | Status | Active? | Shared |');
  push('|---|---|---|---|---|---|---|---|---|');
  const act = (c) => (c.match ? (c.match.isActive ? '**yes**' : 'no') : '—');
  for (const p of dbaPairs) {
    push(`| ${mesc(p.stem.canonical)} | ${p.stem.files.toLocaleString()} | ${p.stem.status} | ${act(p.stem)} | ${mesc(p.wrapper.canonical)} | ${p.wrapper.files.toLocaleString()} | ${p.wrapper.status} | ${act(p.wrapper)} | \`${p.token}\` |`);
  }
  push();
  const diff = dbaPairs.filter((p) => p.statusDiffers);
  push(`${diff.length} of ${dbaPairs.length} straddle the Live/Archived line, which is where a wrong call costs the most.`);
  push();
}
const ellebox = clients.find((c) => c.canonical === 'Elleboxco (Blume)');
if (ellebox) {
  push(`> ⚠️ **\`Elleboxco (Blume)\` (${ellebox.files} files, ${ellebox.status}) was NOT merged.** It is the same company as \`Blume\` on the same evidence — the parenthetical names Blume outright, and HubSpot's active Blume record carries Legal Business Name "ElleBoxCo Inc.". The brief named only \`Blume / Ellebox\`, and merging pairs that were not named was out of scope, so this one is reported instead. It should almost certainly go the same way.`);
  push();
}
// The three identity merges are applied by now, so the wrapper canonicals no
// longer exist. Report the outcome rather than the old side-by-side.
const IDENTITY = [
  ['ClearDent', 'ClearDent', ['ClearDent (501)', 'Precocious Technology Inc. (DBA ClearDent) (2)'],
   'One HubSpot record covers both — "Prococious Technology Inc. (DBA ClearDent)", active, domain `cleardent.com`. Canonical kept as **ClearDent**: that is what the GCs call it and where the files are. `Precocious` vs `Prococious` is a typo in one source, not a second company.'],
  ['Nightingale Electrical', 'Nightingale Electrical', ['Nightingale Electrical (344)', 'Nightingale Electric (16)', 'Nightingale (291)'],
   'Merged in two stages as instructed: the two full names first (one character apart, both matched the same active HubSpot company), then the bare stem into the result. No canonical other than these three begins with "Nightingale".'],
  ['Blume', 'Blume', ['Blume (309)', 'Blume / Ellebox (13)'],
   'Same shape as ClearDent. The active HubSpot record carries Legal Business Name **"ElleBoxCo Inc."** and domain `blume.com`, so ElleBoxCo is the legal entity and Blume the operating name. The `Blume` canonical already absorbed the raw folder `Blume (Ellebox)`, and **no standalone `Ellebox` canonical exists anywhere in the tree**.'],
];
push('## Steps 1-3 — identity merges applied');
push();
push('Recorded in `scripts/client-corrections.json` under source `client identity 2026-08-13`, then the client list was rebuilt.');
push();
push('| Canonical kept | Merged from | Combined files | Status now |');
push('|---|---|---|---|');
for (const [canon, , members] of IDENTITY) {
  const c = clients.find((x) => x.canonical === canon);
  push(`| **${mesc(canon)}** | ${members.map((m) => `\`${mesc(m)}\``).join(', ')} | ${c ? c.files.toLocaleString() : '?'} | ${c ? (c.status === 'Live' ? '**Live** ✅' : c.status) : '?'} |`);
}
push();
for (const [canon, , , why] of IDENTITY) push(`- **${mesc(canon)}** — ${why}`);
push();
const cdNow = clients.find((c) => c.canonical === 'ClearDent');
if (cdNow) {
  push(`\`ClearDent\` is **${cdNow.status}**, matched to \`${mesc(cdNow.match?.name ?? '—')}\` via \`${cdNow.rule}\`${cdNow.match?.isActive ? ' (active)' : ''}. Its ${cdNow.files.toLocaleString()} files moved from Archived to Live.`);
  push();
}
push('> ⚠️ **One knock-on to settle.** `scripts/canexport-mapping.mjs` records `blume : ellebox` in its `JOINT` map as a **two-client** folder, to be dual-filed as `Blume` + `Ellebox`. That was a provisional call from the colon triage and it now contradicts this merge. The JOINT map was not edited — out of scope here — but that entry should be removed or it will dual-file a folder belonging to one company.');
push();

push('---');
push();
push('## Reverse check — active companies with no Dropbox folder');
push();
push(`Of the ${activeTrue} companies HubSpot marks active, **${matchedActiveIds.size} matched a canonical client and ${activeTrue - matchedActiveIds.size} did not.**`);
push();
push('That is not alarming on its face: most of the unmatched ones are lifecycle `lead` or `Get Granted` self-serve, who would not have a Grants delivery folder. The ones worth a second look are the `customer` + `Granted Pro` records, which normally would.');
push();
push('| Lifecycle | Companies active but unmatched |');
push('|---|---|');
for (const [k, n] of [...unmatchedActive.reduce((m, h) => m.set(h.lifecycle ?? '(empty)', (m.get(h.lifecycle ?? '(empty)') ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])) {
  push(`| ${k} | ${n} |`);
}
push();
push('### The 2-token containment guard, retained');
push();
const blumeNow = clients.find((c) => c.canonical === 'Blume');
push(ellebox
  ? `\`Blume\` is **Live** with ${blumeNow ? blumeNow.files.toLocaleString() : '—'} files. \`Elleboxco (Blume)\` (${ellebox.files} files) is the one fragment still on the Archived side.`
  : `\`Blume\` is **Live** with ${blumeNow ? blumeNow.files.toLocaleString() : '—'} files across ${blumeNow ? blumeNow.raws.length : '—'} raw folder names. Every Blume variant now resolves to this one canonical — no fragment left on the Archived side.`);
push();
push('The guard requiring **two or more tokens** in a containment match stays in place. It exists because single-token containment matched `Spring` inside `Admin Slayer - Spring Planning`; relaxing it would reintroduce `Icon` inside `Micon Products` and `home` inside `Lux Quality Homes`. The Step 4 list above is how single-token cases get surfaced instead — detection without letting them match automatically.');
push();

push('---');
push();
push('## What this is not');
push();
push('- **Not a retention decision.** Archived here means "not currently engaged". The 6-year retention line governs deletion and is phase 4. A client can be Archived and still well inside retention.');
push('- **Not a renaming pass.** HubSpot supplied status only. Every canonical name in the output CSV is exactly the name from `clients-final.csv`.');
push('- **Not a mapping.** No file was copied, moved, renamed, or deleted, and nothing was written to Dropbox or Drive.');
push();

push('## Output');
push();
push(`\`dist/inventory/client-status.csv\` — one row per canonical client, ${clients.length} rows, sorted by file count. Columns: canonical_name, status, reason, match_tier, match_rule, hubspot_id, hubspot_name, hubspot_active, product_type, lifecycle, files, bytes, ambiguous_candidates, evidence.`);
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/hubspot-company-schema.mjs        # GET /crm/v3/properties/companies');
push('node scripts/fetch-hubspot-company-status.mjs  # GET /crm/v3/objects/companies (paged)');
push('node scripts/client-status-match.mjs           # local matching, no network');
push('```');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n') + '\n');

console.log(JSON.stringify({
  clients: clients.length,
  hubspot: hs.length,
  exact: exact.length, fuzzy: fuzzy.length, unmatched: unmatched.length,
  live: live.length, archived_matched: archMatched.length, archived_unmatched: archUnmatched.length,
  files: { live: sum(live), archived_matched: sum(archMatched), archived_unmatched: sum(archUnmatched) },
  fuzzy_by_rule: [...fuzzy.reduce((m, c) => m.set(c.rule, (m.get(c.rule) ?? 0) + 1), new Map())],
  live_products: [...prodDist].sort((a, b) => b[1] - a[1]),
}, null, 2));

/**
 * grant_data — the backend-data modes over the GG3 copy
 *
 * report, check, find, tags and compare. Each reads gg3_grants (plus the GG1
 * `grants` table and gg1_gg3_links for compare) with the same filters as search:
 * status defaults to active (compare: every visible status), hide only with
 * include_hidden, regions / industries / grant_types / funders through
 * filterClauses. One SELECT loads the matching grants; everything after that is
 * plain JS over the rows, so the rules below are testable with fixtures.
 *
 *   report  — counts grouped by one or two of status, region, industry,
 *             grant_type, funder, deadline_month; or a list with chosen columns.
 *             Grants tagged with ≥90% of all industry tags are the "all
 *             industries" group, returned separately; overlap is noted.
 *   check   — missing core sections / blank cards, past deadlines (unreadable
 *             ones listed apart, never guessed), amount or percentage
 *             contradictions, stale import text and past years in intake wording.
 *   find    — every card with an exact phrase or number, one row per hit with a
 *             snippet. No cap.
 *   tags    — one grant's tags, or grants with no industry tags, empty
 *             eligibility tags, or low tagging confidence.
 *   compare — GG1 vs GG3 for one grant, or linked grants whose statuses differ,
 *             GG1-only grants, and active GG3 grants with no GG1 record.
 *
 * buildModeResult returns every row and never writes. runMode adds the sheet:
 * over SHEET_THRESHOLD rows, a new Google Sheet in the asker's Drive
 * (grant-data-sheet.js), and only the first rows come back inline.
 */

import { query } from '../database/connection.js';
import {
  APP_URL, ADMIN_URL, GG3_VISIBLE_STATUSES, filterClauses, statusesFor, dataAsOf, asOfNote,
  decode, list, expandRegions, idsFromQuery, normalize, queryTerms, isClearlyNamed
} from './grant-data.js';

export const SHEET_THRESHOLD = 10;
const SNIPPET_CHARS = 60;
const ALL_INDUSTRIES_SHARE = 0.9;
const CANDIDATES_SHOWN = 5;
const TOP_GENRES = 5;

const GROUP_DIMENSIONS = ['status', 'region', 'industry', 'grant_type', 'funder', 'deadline_month'];
const DIMENSION_LABELS = {
  status: 'GG3 status', region: 'Region', industry: 'Industry', grant_type: 'Grant type',
  funder: 'Funder', deadline_month: 'Deadline month'
};
const ALL_INDUSTRIES = 'All industries';
const CHECKS = ['missing_sections', 'past_deadlines', 'contradictions', 'stale_text'];
const CHECK_LABELS = {
  missing_sections: 'Missing sections', past_deadlines: 'Past deadline',
  contradictions: 'Contradiction', stale_text: 'Stale text'
};
const TAG_CHECKS = ['no_industry_tags', 'empty_eligibility_tags', 'low_confidence'];
const COMPARE_LISTS = ['status_differs', 'gg1_only', 'gg3_only_active'];
const COMPARE_LABELS = {
  status_differs: 'Statuses differ', gg1_only: 'Only in GG1', gg3_only_active: 'Active in GG3, no GG1 record'
};

/** GG3 grant types. One contains a comma, so grant_type is split against this list first. */
export const KNOWN_GRANT_TYPES = [
  'Business Assessments, Planning & Coaching', 'Capital Costs', 'Contest & Prizes', 'Hiring',
  'Investment', 'Loan', 'Market Expansion', 'Research & Development', 'Systems & Processes', 'Training'
];

/**
 * Core card sections, each met by any of its field_content keys (English or
 * French). The deadline has no card key; it is the deadline field.
 */
export const CORE_SECTIONS = [
  { label: 'overview', keys: ['grant_overview_2', 'program_details_2'] },
  {
    label: 'eligibility',
    keys: ['eligible_applicants_2', 'eligible_employers_2', 'eligible_candidates_2', 'general_requirements_2',
      'demandeurs_admissibles_2', 'employeurs_admissibles_2', 'candidats_admissibles_2']
  },
  { label: 'funding value', keys: ['grant_value_2', 'valeur_de_la_subvention_2'] }
];

const LIST_COLUMNS = {
  name: { label: 'Grant', get: r => r.grant_name },
  status: { label: 'GG3 status', get: r => r.status },
  funder: { label: 'Funder', get: r => r.program_provider },
  amount: { label: 'Amount', get: r => numberOrText(r.grant_amount) },
  contribution: { label: 'Contribution %', get: r => numberOrText(r.contribution_percentage) },
  deadline: { label: 'Deadline', get: r => r.deadline },
  regions: { label: 'Regions', get: r => arr(r.regions).join(', ') },
  industries: { label: 'Industries', get: r => (isAllIndustries(r) ? ALL_INDUSTRIES : arr(r.industries).join(', ')) },
  grant_type: { label: 'Grant type', get: r => splitGrantTypes(r.grant_type).join(', ') },
  last_updated: { label: 'Last updated', get: r => r.last_updated }
};
const DEFAULT_LIST_COLUMNS = ['name', 'status', 'funder', 'amount', 'deadline'];

// Set per run by loadIndustryVocabulary; read by isAllIndustries.
let industryVocabulary = 0;

const arr = (v) => (Array.isArray(v) ? v : []);
const blank = (v) => v == null || String(v).trim() === '';
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '');
const links = (id) => ({ app: `${APP_URL}${id}`, admin: `${ADMIN_URL}${id}` });

function numberOrText(v) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : String(v);
}

/** A field's number, or null when it is blank, zero or not a number. */
function positiveNumber(v) {
  const n = numberOrText(v);
  return typeof n === 'number' && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Card text
// ---------------------------------------------------------------------------

/** Card HTML as plain text: block tags become line breaks, entities decoded. */
export function plainText(html) {
  return decode(String(html ?? '')
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n[\s\n]*/g, '\n')
    .trim();
}

/** "eligible_expenses_2" → "Eligible expenses". */
export function sectionLabel(key) {
  const words = String(key).replace(/_\d+$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The card's non-blank sections as plain text, in key order. */
export function cardSections(fieldContent) {
  const fc = fieldContent && typeof fieldContent === 'object' && !Array.isArray(fieldContent) ? fieldContent : {};
  return Object.keys(fc).sort()
    .map(key => ({ key, label: sectionLabel(key), text: plainText(fc[key]) }))
    .filter(s => s.text);
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

const MONTHS = {
  january: 1, jan: 1, janvier: 1, february: 2, feb: 2, fevrier: 2, march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, may: 5, mai: 5, june: 6, jun: 6, juin: 6, july: 7, jul: 7, juillet: 7,
  august: 8, aug: 8, aout: 8, september: 9, sep: 9, sept: 9, septembre: 9, october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11, december: 12, dec: 12, decembre: 12
};
const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const ROLLING = /open until|until filled|until funds|while funds|jusqu|epuisement|ongoing|continuous|rolling|year round|no deadline|no fixed deadline|en continu/;

const pad = (n) => String(n).padStart(2, '0');
function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Read a deadline as written on the card. Never guesses: a numeric date whose
 * day and month could swap (04/09/2026), a month with no day, or text with more
 * than one date is unreadable.
 * @returns {{kind: 'blank'|'rolling'|'date'|'unreadable', date?: string}}
 */
export function parseDeadline(text) {
  if (blank(text)) return { kind: 'blank' };
  const s = fold(text).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  if (ROLLING.test(s)) return { kind: 'rolling' };

  const found = [];
  let ambiguous = false;
  const t = s.replace(/(\d+)(st|nd|rd|th|er)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) found.push(isoDate(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    if (a > 12) found.push(isoDate(y, b, a));
    else if (b > 12) found.push(isoDate(y, a, b));
    else if (a === b) found.push(isoDate(y, a, a));
    else ambiguous = true;
  }
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_WORD})\\.? (\\d{1,2}) (\\d{4})\\b`, 'g'))) found.push(isoDate(+m[3], MONTHS[m[1]], +m[2]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2}) (?:de )?(${MONTH_WORD})\\.? (\\d{4})\\b`, 'g'))) found.push(isoDate(+m[3], MONTHS[m[2]], +m[1]));

  const dates = [...new Set(found)];
  if (ambiguous || dates.length !== 1 || dates[0] === null) return { kind: 'unreadable' };
  return { kind: 'date', date: dates[0] };
}

/** Today's date in Vancouver, YYYY-MM-DD. */
export function todayIn(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateWords = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${d}, ${y}`; };

// ---------------------------------------------------------------------------
// Tags and groups
// ---------------------------------------------------------------------------

/** Tagged with at least 90% of the industry tags in use: the "all industries" grants. */
export function isAllIndustries(row) {
  return industryVocabulary > 0 && arr(row.industries).length >= ALL_INDUSTRIES_SHARE * industryVocabulary;
}

/** "Hiring, Business Assessments, Planning & Coaching" → ["Hiring", "Business Assessments, Planning & Coaching"]. */
export function splitGrantTypes(value) {
  if (blank(value)) return [];
  let rest = `, ${String(value)} ,`;
  const types = [];
  for (const type of [...KNOWN_GRANT_TYPES].sort((a, b) => b.length - a.length)) {
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`,\\s*${escaped}\\s*(?=,)`, 'i');
    if (re.test(rest)) { types.push(type); rest = rest.replace(re, ''); }
  }
  const others = rest.split(',').map(x => x.trim()).filter(Boolean);
  const order = (t) => { const i = String(value).toLowerCase().indexOf(t.toLowerCase()); return i < 0 ? Infinity : i; };
  return [...types, ...others].sort((a, b) => order(a) - order(b));
}

function deadlineMonth(row) {
  const d = parseDeadline(row.deadline);
  if (d.kind === 'date') return d.date.slice(0, 7);
  return { blank: 'No deadline', rolling: 'Open until filled', unreadable: "Deadline can't be read" }[d.kind];
}

/** The groups a grant counts in for one dimension. */
export function groupsFor(row, dimension) {
  switch (dimension) {
    case 'status': return [row.status ?? 'No status'];
    case 'region': return arr(row.regions).length ? [...new Set(arr(row.regions))] : ['No region tags'];
    case 'industry':
      if (isAllIndustries(row)) return [ALL_INDUSTRIES];
      return arr(row.industries).length ? [...new Set(arr(row.industries))] : ['No industry tags'];
    case 'grant_type': { const t = splitGrantTypes(row.grant_type); return t.length ? t : ['No grant type']; }
    case 'funder': return [blank(row.program_provider) ? 'No funder' : String(row.program_provider).trim()];
    case 'deadline_month': return [deadlineMonth(row)];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const GRANT_COLUMNS = `gg.id, gg.grant_name, gg.status, gg.grant_type, gg.program_provider, gg.regions, gg.industries,
       gg.grant_amount, gg.contribution_percentage, gg.deadline, gg.last_updated,
       gg.grant_criteria, gg.best_practices, gg.field_content, gg.eligibility_criteria,
       gg.genre_scores, gg.boost_attributes,
       l.gg1_id, g1.grant_name AS gg1_name, g1.is_active AS gg1_active,
       g1.currently_accepting AS gg1_accepting, g1.deadline AS gg1_deadline`;
const GRANT_JOINS = `FROM gg3_grants gg
  LEFT JOIN gg1_gg3_links l ON l.gg3_id = gg.id
  LEFT JOIN grants g1 ON g1.grant_id = l.gg1_id`;

/** Grants at these statuses passing the filters, with their GG1 link. */
export async function loadGrants(opts, statuses) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [`gg.status = ANY(${p(statuses)}::text[])`, ...filterClauses(opts, p)];
  const { rows } = await query(
    `SELECT ${GRANT_COLUMNS}
       ${GRANT_JOINS}
      WHERE ${where.join('\n        AND ')}
      ORDER BY gg.id`,
    params
  );
  return rows;
}

async function loadGrantsById(ids) {
  const { rows } = await query(`SELECT ${GRANT_COLUMNS} ${GRANT_JOINS} WHERE gg.id = ANY($1::int[]) ORDER BY gg.id`, [ids]);
  return rows;
}

async function loadIndustryVocabulary() {
  const { rows } = await query(
    `SELECT count(DISTINCT i)::int AS n
       FROM gg3_grants gg,
            jsonb_array_elements_text(CASE jsonb_typeof(gg.industries) WHEN 'array' THEN gg.industries ELSE '[]'::jsonb END) i`
  );
  industryVocabulary = Number(rows[0]?.n ?? 0);
  return industryVocabulary;
}

/** The filters used, in plain words, for the sheet's first tab and the answer. */
function describeFilters(opts, statuses) {
  const parts = [`Status: ${statuses.join(', ')}`];
  const regions = expandRegions(opts.regions);
  if (regions.length) parts.push(`Regions: ${regions.join(', ')} (grants open to All of Canada included)`);
  for (const [key, label] of [['industries', 'Industries'], ['grant_types', 'Grant types'], ['funders', 'Funders']]) {
    const values = list(opts[key]);
    if (values.length) parts.push(`${label}: ${values.join(', ')}`);
  }
  return parts;
}

const grantRow = (r) => ({ id: Number(r.id), name: r.grant_name, status: r.status });
const withLinks = (row) => { const l = links(row.id); return { ...row, app_link: l.app, admin_link: l.admin }; };
const LINK_COLUMNS = [{ key: 'app_link', label: 'App link', type: 'link' }, { key: 'admin_link', label: 'Admin link', type: 'link' }];
const GRANT_COLUMNS_OUT = [{ key: 'id', label: 'GG3 id' }, { key: 'name', label: 'Grant' }, { key: 'status', label: 'GG3 status' }];

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

export function buildReport(rows, opts) {
  if (Array.isArray(opts.columns) && opts.columns.length) return buildList(rows, opts.columns);
  const dims = [...new Set(list(opts.group_by).map(d => d.toLowerCase()))].filter(d => GROUP_DIMENSIONS.includes(d));
  if (!dims.length || dims.length > 2) {
    return { error: `report needs group_by with one or two of: ${GROUP_DIMENSIONS.join(', ')} — or columns for a list.` };
  }

  const counts = new Map();
  const allIndustries = new Map();
  let overlaps = false;
  for (const r of rows) {
    const g1 = groupsFor(r, dims[0]);
    const g2 = dims[1] ? groupsFor(r, dims[1]) : [null];
    if (g1.length > 1 || g2.length > 1) overlaps = true;
    for (const a of g1) {
      for (const b of g2) {
        if (a === ALL_INDUSTRIES || b === ALL_INDUSTRIES) {
          const other = a === ALL_INDUSTRIES ? b : a;
          allIndustries.set(other, (allIndustries.get(other) ?? 0) + 1);
          continue;
        }
        const k = JSON.stringify([a, b]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }

  const out = [...counts].map(([k, count]) => {
    const [a, b] = JSON.parse(k);
    return dims[1] ? { group_1: a, group_2: b, count } : { group: a, count };
  }).sort((x, y) => y.count - x.count ||
    String(x.group ?? x.group_1).localeCompare(String(y.group ?? y.group_1)) ||
    String(x.group_2 ?? '').localeCompare(String(y.group_2 ?? '')));

  const columns = dims[1]
    ? [{ key: 'group_1', label: DIMENSION_LABELS[dims[0]] }, { key: 'group_2', label: DIMENSION_LABELS[dims[1]] }, { key: 'count', label: 'Grants', type: 'number' }]
    : [{ key: 'group', label: DIMENSION_LABELS[dims[0]] }, { key: 'count', label: 'Grants', type: 'number' }];

  const result = { report: 'counts', group_by: dims, total_grants: rows.length, columns, rows: out };
  const notes = [];
  if (dims.includes('industry')) {
    const n = [...allIndustries.values()].reduce((s, x) => s + x, 0);
    result.all_industries = dims[1]
      ? { count: new Set(rows.filter(isAllIndustries).map(r => r.id)).size, by: Object.fromEntries(allIndustries) }
      : { count: n };
    const n1 = result.all_industries.count;
    notes.push(`${n1} ${n1 === 1 ? 'grant is' : 'grants are'} open to all industries (tagged with at least ${Math.ceil(ALL_INDUSTRIES_SHARE * industryVocabulary)} of the ${industryVocabulary} industry tags). They are counted once, in "All industries", not in each industry.`);
  }
  if (overlaps) {
    result.overlap_note = `Counts overlap: a grant with several ${dims.map(d => DIMENSION_LABELS[d].toLowerCase()).join(' or ')} values is counted in each of its groups, so the groups add up to more than the ${rows.length} grants.`;
    notes.push(result.overlap_note);
  }
  result.what = `${rows.length === 1 ? 'Grant' : 'Grants'} by ${dims.map(d => DIMENSION_LABELS[d].toLowerCase()).join(' and ')}`;
  result.notes = notes;
  return result;
}

function buildList(rows, columns) {
  const keys = [...new Set(columns.map(c => String(c).toLowerCase()))].filter(c => LIST_COLUMNS[c]);
  const chosen = keys.length ? keys : DEFAULT_LIST_COLUMNS;
  const out = rows.map(r => withLinks({
    id: Number(r.id),
    ...Object.fromEntries(chosen.map(c => [c, LIST_COLUMNS[c].get(r) ?? null]))
  }));
  const notes = [];
  if (keys.length !== columns.length) notes.push(`Unknown columns left out. Available: ${Object.keys(LIST_COLUMNS).join(', ')}.`);
  return {
    report: 'list',
    total_grants: rows.length,
    columns: [{ key: 'id', label: 'GG3 id' }, ...chosen.map(c => ({ key: c, label: LIST_COLUMNS[c].label })), ...LINK_COLUMNS],
    rows: out,
    what: 'Grant list',
    notes
  };
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function missingSections(r) {
  const sections = cardSections(r.field_content);
  const has = new Set(sections.map(s => s.key));
  const noDeadline = blank(r.deadline);
  if (!sections.length) return `Card is blank (no sections filled in)${noDeadline ? ' and has no deadline' : ''}`;
  const missing = CORE_SECTIONS.filter(c => !c.keys.some(k => has.has(k))).map(c => c.label);
  if (noDeadline) missing.push('deadline');
  if (!missing.length) return null;
  return `Missing ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`}`;
}

const MONEY = [
  // $22,000 · $ 1.5M · $50K · $2 million
  /\$\s?(\d{1,3}(?:[,\u00a0\u202f]\d{3})+|\d+)(?:\.(\d+))?(?:\s?(k|m|mm|b|million|thousand|billion)\b)?/gi,
  // 22 000 $ · 22 000,50 $ (French) · 22,000$
  /(?<![\d.,$])(\d{1,3}(?:[,\u00a0\u202f ]\d{3})+|\d+)(?:,(\d{1,2}))?\s?\$/g
];
const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const PERCENT = /(?<![\d.,])(\d{1,3}(?:[.,]\d+)?)\s?(?:%|per ?cent\b|pour ?cent\b)/gi;

/** Dollar amounts written in card text, as numbers. */
export function moneyIn(text) {
  const out = new Set();
  for (const re of MONEY) {
    for (const m of String(text).matchAll(re)) {
      const whole = Number(m[1].replace(/[^\d]/g, ''));
      const n = (whole + (m[2] ? Number(`0.${m[2]}`) : 0)) * (SCALE[(m[3] || '').toLowerCase()] ?? 1);
      if (n > 0) out.add(n);
    }
  }
  return [...out];
}

/** Percentages written in card text, as numbers. */
export function percentsIn(text) {
  return [...new Set([...String(text).matchAll(PERCENT)].map(m => Number(m[1].replace(',', '.'))))];
}

const dollars = (n) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
const pct = (n) => `${n}%`;
function mentions(values, fmt) {
  const shown = values.slice(0, 5).map(fmt);
  return shown.join(', ') + (values.length > 5 ? ` and ${values.length - 5} more` : '');
}

function contradictions(r) {
  const text = cardSections(r.field_content).map(s => s.text).join('\n');
  const problems = [];
  const amount = positiveNumber(r.grant_amount);
  if (amount) {
    const found = moneyIn(text);
    if (found.length && !found.some(n => Math.abs(n - amount) < 0.5)) {
      problems.push(`Amount field says ${dollars(amount)}; card mentions ${mentions(found, dollars)}, not ${dollars(amount)}`);
    }
  }
  const contribution = positiveNumber(r.contribution_percentage);
  if (contribution) {
    const found = percentsIn(text);
    if (found.length && !found.some(n => Math.abs(n - contribution) < 0.01)) {
      problems.push(`Contribution field says ${pct(contribution)}; card mentions ${mentions(found, pct)}, not ${pct(contribution)}`);
    }
  }
  return problems;
}

const INTAKE_WORDS = /\b(deadlines?|intakes?|apply by|applications? (?:open|close|closes|closed|are due|due|will be accepted|accepted)|closing date|closes|application window|due date|date limite|periode de reception|appel de (?:propositions|projets)|call for (?:proposals|applications))\b/;

/** Sentences with intake or deadline wording that name a year before this one. */
export function staleYearSentences(text, currentYear) {
  const out = [];
  for (const sentence of String(text).split(/(?<=[.!?;])\s+|\n+/)) {
    const folded = fold(sentence).toLowerCase();
    if (!INTAKE_WORDS.test(folded)) continue;
    // A range that reaches this year or later ("2025-2026", "2025/26") is current, not stale.
    const withoutCurrentRanges = folded.replace(/\b((?:19|20)\d{2})\s?[-–/]\s?(\d{2}|\d{4})\b/g, (all, a, b) => {
      const end = b.length === 2 ? Number(a.slice(0, 2) + b) : Number(b);
      return end >= currentYear ? ' ' : all;
    });
    const years = [...withoutCurrentRanges.matchAll(/\b((?:19|20)\d{2})\b/g)].map(m => Number(m[1])).filter(y => y < currentYear);
    if (years.length) out.push({ year: Math.max(...years), sentence: sentence.trim().replace(/\s+/g, ' ').slice(0, 200) });
  }
  return out;
}

function staleText(r, currentYear) {
  const problems = [];
  const sections = cardSections(r.field_content);
  if (!sections.length && (!blank(plainText(r.grant_criteria)) || !blank(plainText(r.best_practices)))) {
    problems.push('Content only in the old GG1 import text; no card sections filled in');
  }
  const stale = staleYearSentences(sections.map(s => s.text).join('\n'), currentYear);
  if (stale.length) {
    problems.push(`Intake or deadline wording mentions ${[...new Set(stale.map(s => s.year))].sort().join(', ')}: "${stale[0].sentence}"${stale.length > 1 ? ` (and ${stale.length - 1} more)` : ''}`);
  }
  return problems;
}

export function buildCheck(rows, opts, { now = new Date() } = {}) {
  const asked = list(opts.checks).map(c => c.toLowerCase()).filter(c => CHECKS.includes(c));
  const checks = asked.length ? asked : CHECKS;
  const today = todayIn(now);
  const currentYear = Number(today.slice(0, 4));
  const out = [];
  const unreadable = [];
  const push = (r, check, problem) => out.push(withLinks({ ...grantRow(r), check: CHECK_LABELS[check], problem }));

  for (const r of rows) {
    if (checks.includes('missing_sections')) {
      const problem = missingSections(r);
      if (problem) push(r, 'missing_sections', problem);
    }
    if (checks.includes('past_deadlines')) {
      const d = parseDeadline(r.deadline);
      if (d.kind === 'date' && d.date < today) push(r, 'past_deadlines', `Deadline ${dateWords(d.date)} has passed (card says "${String(r.deadline).trim()}")`);
      if (d.kind === 'unreadable') unreadable.push(withLinks({ ...grantRow(r), deadline: String(r.deadline).trim() }));
    }
    if (checks.includes('contradictions')) for (const p of contradictions(r)) push(r, 'contradictions', p);
    if (checks.includes('stale_text')) for (const p of staleText(r, currentYear)) push(r, 'stale_text', p);
  }

  const byCheck = Object.fromEntries(checks.map(c => [CHECK_LABELS[c], out.filter(x => x.check === CHECK_LABELS[c]).length]));
  const result = {
    checks,
    grants_checked: rows.length,
    failing_grants: new Set(out.map(x => x.id)).size,
    by_check: byCheck,
    columns: [...GRANT_COLUMNS_OUT, { key: 'check', label: 'Check' }, { key: 'problem', label: 'What failed' }, ...LINK_COLUMNS],
    rows: out,
    what: checks.length === 1 ? `Card check – ${CHECK_LABELS[checks[0]].toLowerCase()}` : 'Card checks',
    notes: checks.includes('missing_sections')
      ? [`Core sections checked: ${CORE_SECTIONS.map(c => c.label).join(', ')} and deadline.`]
      : []
  };
  if (checks.includes('past_deadlines')) {
    result.unreadable_deadlines = unreadable;
    result.extra_tabs = [{
      title: "Deadlines can't be read",
      columns: [...GRANT_COLUMNS_OUT, { key: 'deadline', label: 'Deadline as written' }, ...LINK_COLUMNS],
      rows: unreadable
    }];
    result.notes.push(`Past deadlines are compared with today in Vancouver (${today}). ${unreadable.length} deadline${unreadable.length === 1 ? '' : 's'} could not be read as one date and ${unreadable.length === 1 ? 'is' : 'are'} listed separately, not guessed.`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

/** Lowercase, accent-folded text with a map from each folded char back to the original index. */
function foldWithMap(text) {
  let folded = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]).toLowerCase();
    for (const ch of f) { folded += /\s/.test(ch) ? ' ' : ch; map.push(i); }
  }
  return { folded, map };
}

const ALNUM = /[\p{L}\p{N}]/u;
const DIGIT = /\d/;

/**
 * Every place the phrase appears in text, whole-word at alphanumeric edges, and
 * whole-number at digit edges: "70%" is not in "170%", "70" is not in "700" or "7.70".
 * @returns {{start: number, end: number}[]} original-text offsets
 */
export function findPhrase(text, phrase) {
  const needle = fold(phrase).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!needle) return [];
  const source = String(text).replace(/\s+/g, ' ');
  const { folded, map } = foldWithMap(source);
  const startsAlnum = ALNUM.test(needle[0]);
  const endsAlnum = ALNUM.test(needle.at(-1));
  const hits = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    const before = folded[at - 1] ?? '';
    const after = folded[end] ?? '';
    const numberBefore = DIGIT.test(needle[0]) && /[.,]/.test(before) && DIGIT.test(folded[at - 2] ?? '');
    const numberAfter = DIGIT.test(needle.at(-1)) && /[.,]/.test(after) && DIGIT.test(folded[end + 1] ?? '');
    const ok = !(startsAlnum && ALNUM.test(before)) && !(endsAlnum && ALNUM.test(after)) && !numberBefore && !numberAfter;
    if (ok) { hits.push({ start: map[at], end: map[end - 1] + 1, source }); from = end; } else from = at + 1;
  }
  return hits;
}

/** About SNIPPET_CHARS either side of the hit, cut at word edges. */
export function snippetAround(source, start, end) {
  let a = Math.max(0, start - SNIPPET_CHARS);
  let b = Math.min(source.length, end + SNIPPET_CHARS);
  if (a > 0) { const sp = source.indexOf(' ', a); if (sp >= 0 && sp < start) a = sp + 1; }
  if (b < source.length) { const sp = source.lastIndexOf(' ', b); if (sp > end) b = sp; }
  return `${a > 0 ? '…' : ''}${source.slice(a, b).trim()}${b < source.length ? '…' : ''}`;
}

export function buildFind(rows, opts) {
  const phrase = String(opts.phrase ?? opts.query ?? '').trim();
  if (!phrase) return { error: 'find needs phrase: the exact words or number to look for, e.g. "70%".' };
  const out = [];
  for (const r of rows) {
    const sections = [{ label: 'Grant name', text: String(r.grant_name ?? '') }, ...cardSections(r.field_content)];
    for (const s of sections) {
      for (const h of findPhrase(s.text, phrase)) {
        out.push(withLinks({ ...grantRow(r), section: s.label, snippet: snippetAround(h.source, h.start, h.end) }));
      }
    }
  }
  return {
    phrase,
    grants_searched: rows.length,
    total_grants: new Set(out.map(x => x.id)).size,
    total_hits: out.length,
    columns: [...GRANT_COLUMNS_OUT, { key: 'section', label: 'Section' }, { key: 'snippet', label: 'Text around it' }, ...LINK_COLUMNS],
    rows: out,
    what: `Cards containing "${phrase}"`,
    notes: []
  };
}

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------

const TAG_META = new Set(['extracted_at', 'prompt_version', 'extraction_confidence', 'extraction_notes']);
const isEmptyTag = (v) => v == null || v === '' || v === false ||
  (Array.isArray(v) && v.every(isEmptyTag)) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEmptyTag));

/** Eligibility tags missing, or present with nothing set in any part. */
export function eligibilityTagsEmpty(ec) {
  if (!ec || typeof ec !== 'object') return true;
  return Object.entries(ec).filter(([k]) => !TAG_META.has(k)).every(([, v]) => isEmptyTag(v));
}

const human = (key) => sectionLabel(key).replace(/\bmin\b/i, 'minimum').replace(/\bmax\b/i, 'maximum');
function describeTagValue(v) {
  if (Array.isArray(v)) return v.map(describeTagValue).join(', ');
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => !isEmptyTag(x)).map(([k, x]) => `${human(k)}: ${describeTagValue(x)}`).join('; ');
  return typeof v === 'string' ? v.replace(/[-_]/g, ' ') : String(v);
}

/** Eligibility tags as plain lines, one per part with anything set. */
export function describeEligibility(ec) {
  if (!ec || typeof ec !== 'object') return [];
  return Object.entries(ec)
    .filter(([k, v]) => !TAG_META.has(k) && !isEmptyTag(v))
    .map(([k, v]) => `${human(k)} — ${describeTagValue(v)}`);
}

function topGenres(genreScores) {
  const scores = genreScores?.scores;
  if (!scores || typeof scores !== 'object') return [];
  const flat = [];
  for (const [family, genres] of Object.entries(scores)) {
    if (!genres || typeof genres !== 'object') continue;
    for (const [genre, score] of Object.entries(genres)) if (Number(score) > 0) flat.push({ family, genre, score: Number(score) });
  }
  return flat.sort((a, b) => b.score - a.score || a.genre.localeCompare(b.genre)).slice(0, TOP_GENRES).map(g => `${g.genre} (${g.family}): ${g.score}`);
}

function boostTags(boost) {
  if (!boost || typeof boost !== 'object') return [];
  return Object.entries(boost).filter(([, v]) => !isEmptyTag(v)).map(([k, v]) => (v === true ? human(k) : `${human(k)}: ${describeTagValue(v)}`));
}

export function grantTags(r) {
  const ec = r.eligibility_criteria;
  return {
    id: Number(r.id),
    name: r.grant_name,
    status: r.status,
    industries: isAllIndustries(r) ? [`${ALL_INDUSTRIES} (${arr(r.industries).length} tags)`] : arr(r.industries),
    regions: arr(r.regions),
    grant_types: splitGrantTypes(r.grant_type),
    eligibility_tags: describeEligibility(ec),
    tagging_confidence: ec?.extraction_confidence ?? null,
    tagging_notes: ec?.extraction_notes ?? null,
    top_genres: topGenres(r.genre_scores),
    boost_tags: boostTags(r.boost_attributes),
    links: links(r.id)
  };
}

export function buildTagLists(rows, opts) {
  const asked = list(opts.tag_check).map(c => c.toLowerCase()).filter(c => TAG_CHECKS.includes(c));
  const checks = asked.length ? asked : TAG_CHECKS;
  const out = [];
  const byCheck = Object.fromEntries(checks.map(c => [c, 0]));
  const push = (r, check, problem) => { byCheck[check]++; out.push(withLinks({ ...grantRow(r), problem })); };
  for (const r of rows) {
    const ec = r.eligibility_criteria;
    if (checks.includes('no_industry_tags') && !arr(r.industries).length) push(r, 'no_industry_tags', 'No industry tags');
    if (checks.includes('empty_eligibility_tags') && eligibilityTagsEmpty(ec)) {
      push(r, 'empty_eligibility_tags', ec ? 'Eligibility tags are all empty' : 'No eligibility tags');
    }
    if (checks.includes('low_confidence') && String(ec?.extraction_confidence ?? '').toLowerCase() === 'low') {
      push(r, 'low_confidence', `Tagging confidence is low${ec.extraction_notes ? `: ${String(ec.extraction_notes).slice(0, 300)}` : ''}`);
    }
  }
  return {
    tag_checks: checks,
    grants_checked: rows.length,
    by_check: byCheck,
    columns: [...GRANT_COLUMNS_OUT, { key: 'problem', label: 'Tag problem' }, ...LINK_COLUMNS],
    rows: out,
    what: 'Tag gaps',
    notes: []
  };
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

const gg1Status = (active) => (active === true ? 'active' : active === false ? 'inactive' : null);
const gg1Accepting = (v) => (v === true ? 'yes' : v === false ? 'no' : null);
/** GG1 text was scraped: collapse whitespace and drop a leading "Deadline" label. */
const gg1Text = (v) => (blank(v) ? null : String(v).replace(/\s+/g, ' ').replace(/^deadline\s*:?\s*/i, '').trim() || null);
const REASONS = { no_counterpart: 'No grant with this name on the other side', ambiguous: 'Several grants on the other side share this name' };

async function loadUnmatched() {
  const { rows } = await query(`SELECT side, grant_id, reason FROM gg1_gg3_unmatched`);
  return new Map(rows.map(r => [`${r.side}:${r.grant_id}`, r.reason]));
}

export function compareOne(r, unmatched) {
  const out = {
    gg3: { id: Number(r.id), name: r.grant_name, status: r.status, deadline: r.deadline ?? null, links: links(r.id) },
    gg1: null,
    link: null
  };
  if (r.gg1_id != null) {
    out.gg1 = { id: r.gg1_id, name: gg1Text(r.gg1_name), status: gg1Status(r.gg1_active), accepting: gg1Accepting(r.gg1_accepting), deadline: gg1Text(r.gg1_deadline) };
    out.link = 'Matched by exact name';
    out.statuses_differ = out.gg1.status !== null && (out.gg1.status === 'active') !== (r.status === 'active');
  } else {
    const reason = unmatched.get(`gg3:${r.id}`);
    out.link = reason === 'ambiguous' ? 'Several GG1 grants could match this name; none linked' : 'No GG1 grant with this name';
  }
  return out;
}

async function loadGg1Only() {
  const { rows } = await query(
    `SELECT g1.grant_id, g1.grant_name, g1.is_active, g1.currently_accepting, g1.deadline, u.reason
       FROM grants g1
       LEFT JOIN gg1_gg3_links l ON l.gg1_id = g1.grant_id
       LEFT JOIN gg1_gg3_unmatched u ON u.side = 'gg1' AND u.grant_id = g1.grant_id
      WHERE l.gg1_id IS NULL
      ORDER BY g1.grant_name`
  );
  return rows;
}

export function buildCompareLists(rows, opts, { unmatched, gg1Only, statuses }) {
  const asked = list(opts.compare_list).map(c => c.toLowerCase()).filter(c => COMPARE_LISTS.includes(c));
  const lists = asked.length ? asked : COMPARE_LISTS;
  const out = [];
  const gg3Row = (r, which, reason) => withLinks({
    list: COMPARE_LABELS[which], gg3_id: Number(r.id), gg3_name: r.grant_name, gg3_status: r.status,
    gg1_id: r.gg1_id ?? null, gg1_name: gg1Text(r.gg1_name), gg1_status: gg1Status(r.gg1_active),
    gg1_accepting: gg1Accepting(r.gg1_accepting), gg3_deadline: r.deadline ?? null, gg1_deadline: gg1Text(r.gg1_deadline),
    note: reason ?? null, id: Number(r.id)
  });
  if (lists.includes('status_differs')) {
    for (const r of rows) {
      const s = gg1Status(r.gg1_active);
      if (r.gg1_id != null && s !== null && (s === 'active') !== (r.status === 'active')) out.push(gg3Row(r, 'status_differs'));
    }
  }
  if (lists.includes('gg3_only_active')) {
    for (const r of rows) {
      if (r.status !== 'active' || r.gg1_id != null) continue;
      out.push(gg3Row(r, 'gg3_only_active', unmatched.get(`gg3:${r.id}`) === 'ambiguous'
        ? 'Several GG1 grants could match this name' : 'No GG1 grant with this name'));
    }
  }
  if (lists.includes('gg1_only')) {
    for (const g of gg1Only) {
      out.push({
        list: COMPARE_LABELS.gg1_only, gg3_id: null, gg3_name: null, gg3_status: null,
        gg1_id: g.grant_id, gg1_name: gg1Text(g.grant_name), gg1_status: gg1Status(g.is_active), gg1_accepting: gg1Accepting(g.currently_accepting),
        gg3_deadline: null, gg1_deadline: gg1Text(g.deadline),
        note: g.reason === 'ambiguous' ? 'Several GG3 grants could match this name' : 'No GG3 grant with this name',
        app_link: null, admin_link: null
      });
    }
  }
  const notes = ['No verdict on which side is right.'];
  if (lists.includes('gg1_only')) notes.push('The GG3 filters do not apply to the GG1-only list: it is every GG1 grant with no linked GG3 grant.');
  if (lists.includes('gg3_only_active') && !statuses.includes('active')) notes.push('Active was not among the statuses asked for, so the active-in-GG3 list is empty.');
  return {
    compare_lists: lists,
    by_list: Object.fromEntries(lists.map(l => [COMPARE_LABELS[l], out.filter(x => x.list === COMPARE_LABELS[l]).length])),
    columns: [
      { key: 'list', label: 'List' }, { key: 'gg3_id', label: 'GG3 id' }, { key: 'gg3_name', label: 'GG3 grant' },
      { key: 'gg3_status', label: 'GG3 status' }, { key: 'gg1_id', label: 'GG1 id' }, { key: 'gg1_name', label: 'GG1 grant' },
      { key: 'gg1_status', label: 'GG1 status' }, { key: 'gg1_accepting', label: 'GG1 currently accepting' },
      { key: 'gg3_deadline', label: 'GG3 deadline' }, { key: 'gg1_deadline', label: 'GG1 deadline' }, { key: 'note', label: 'Note' },
      ...LINK_COLUMNS
    ],
    rows: out.map(({ id, ...row }) => row),
    what: lists.length === 1 ? `GG1 vs GG3 – ${COMPARE_LABELS[lists[0]].toLowerCase()}` : 'GG1 vs GG3',
    notes
  };
}

// ---------------------------------------------------------------------------
// One grant, for tags and compare
// ---------------------------------------------------------------------------

/**
 * The grant a tags or compare query means: ids and links look up directly; a
 * name must clearly name exactly one grant, else the best candidates come back.
 */
async function resolveOne(opts, statuses) {
  const ids = idsFromQuery(opts.query);
  if (ids) {
    const rows = await loadGrantsById(ids.slice(0, 1));
    return rows.length ? { row: rows[0] } : { notFound: ids[0] };
  }
  const rows = await loadGrants(opts, statuses);
  const terms = queryTerms(opts.query);
  const named = rows.filter(r => isClearlyNamed(normalize(r.grant_name), terms));
  const exact = named.filter(r => normalize(r.grant_name) === terms.phrase);
  const pick = exact.length === 1 ? exact : named;
  if (pick.length === 1) return { row: pick[0] };
  const score = (r) => { const n = ` ${normalize(r.grant_name)} `; return terms.tokens.filter(t => n.includes(` ${t}`)).length; };
  const candidates = (named.length ? named : rows.filter(r => score(r) > 0))
    .sort((a, b) => score(b) - score(a) || Number(a.id) - Number(b.id))
    .slice(0, CANDIDATES_SHOWN)
    .map(r => ({ ...grantRow(r), links: links(r.id) }));
  return { candidates };
}

function oneGrantResult(mode, resolved, asOf, build) {
  const base = { success: true, mode, data_as_of: asOf, ...asOfNote(asOf) };
  if (resolved.row) return { ...base, grant: build(resolved.row) };
  if (resolved.notFound != null) return { ...base, grant: null, note: `Grant ${resolved.notFound} is not in GG3.` };
  return {
    ...base,
    grant: null,
    candidates: resolved.candidates,
    note: resolved.candidates.length
      ? 'No grant is clearly named by that query. Ask which of these is meant, or pass its id or link.'
      : 'No grant matches that name.'
  };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Run a backend-data mode and return every row. Never writes anything.
 * @param {Object} input - the tool input
 * @param {{now?: Date}} options
 */
export async function buildModeResult(input = {}, { now = new Date() } = {}) {
  const mode = input.mode;
  const wantsOne = (mode === 'tags' || mode === 'compare') && !blank(input.query);
  // compare lists look across every visible status (a GG1-active grant archived
  // in GG3 is the point); so does finding one grant by name.
  const defaultAll = (mode === 'compare' || wantsOne) && list(input.status).length === 0;
  const { statuses: asked } = statusesFor(input);
  const statuses = defaultAll
    ? [...GG3_VISIBLE_STATUSES, ...(asked.includes('hide') ? ['hide'] : [])]
    : asked;

  if (wantsOne) {
    if (mode === 'tags') await loadIndustryVocabulary();
    const [resolved, unmatched] = [await resolveOne(input, statuses), mode === 'compare' ? await loadUnmatched() : null];
    const asOf = await dataAsOf();
    return oneGrantResult(mode, resolved, asOf, mode === 'tags' ? grantTags : (r) => compareOne(r, unmatched));
  }

  if (mode === 'report') await loadIndustryVocabulary();
  const rows = await loadGrants(input, statuses);
  let built;
  switch (mode) {
    case 'report': built = buildReport(rows, input); break;
    case 'check': built = buildCheck(rows, input, { now }); break;
    case 'find': built = buildFind(rows, input); break;
    case 'tags': built = buildTagLists(rows, input); break;
    case 'compare': built = buildCompareLists(rows, input, { unmatched: await loadUnmatched(), gg1Only: await loadGg1Only(), statuses }); break;
    default: return { success: false, error: `Unknown grant_data mode "${mode ?? ''}".` };
  }
  if (built.error) return { success: false, mode, error: built.error };

  const asOf = await dataAsOf();
  return {
    success: true,
    mode,
    data_as_of: asOf,
    ...asOfNote(asOf),
    statuses,
    filters: describeFilters(input, statuses),
    ...built,
    total_rows: built.rows.length
  };
}

/** Rows as plain objects for the tool result: no column specs. */
const inlineRows = (rows, n) => rows.slice(0, n);

/**
 * The tool path: build the result, and when any table runs over
 * SHEET_THRESHOLD rows, write it to a new sheet in the asker's Drive and
 * return only the first rows. A sheet that can't be written never fails the call.
 */
export async function runMode(input = {}, { userId = null, now = new Date() } = {}) {
  const result = await buildModeResult(input, { now });
  if (!result.success || !Array.isArray(result.rows)) return result;

  const tables = [{ title: 'Results', columns: result.columns, rows: result.rows }, ...(result.extra_tabs ?? [])];
  const { columns, extra_tabs, what, ...out } = result;
  if (!tables.some(t => t.rows.length > SHEET_THRESHOLD)) return out;

  out.rows = inlineRows(result.rows, SHEET_THRESHOLD);
  out.rows_returned = out.rows.length;
  if (out.unreadable_deadlines) {
    out.unreadable_deadlines_total = out.unreadable_deadlines.length;
    out.unreadable_deadlines = inlineRows(out.unreadable_deadlines, SHEET_THRESHOLD);
  }

  const about = [
    ['Asked for', what],
    ['Filters', result.filters.join('; ')],
    ['Data as of', result.data_as_of ? new Date(result.data_as_of).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown'],
    ['Created', todayIn(now)],
    ['Rows', String(result.rows.length)],
    ...(result.all_industries ? [['All industries', `${result.all_industries.count} grants, counted apart from the industry groups`]] : []),
    ...(result.notes ?? []).map(n => ['Note', n])
  ];
  try {
    const { writeResultSheet } = await import('./grant-data-sheet.js');
    out.sheet = await writeResultSheet(userId, { title: `Oracle – ${what} – ${todayIn(now)}`, about, tables });
    out.note = `Showing the first ${out.rows_returned} of ${result.rows.length} rows; the full result is in the new sheet.`;
  } catch (err) {
    out.sheet = null;
    out.sheet_error = err?.userMessage ?? `The results sheet could not be created (${err?.message ?? 'unknown error'}).`;
    out.note = `Showing the first ${out.rows_returned} of ${result.rows.length} rows; no sheet was created.`;
  }
  return out;
}

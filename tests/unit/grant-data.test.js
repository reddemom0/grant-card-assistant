/**
 * grant_data — search mode over the GG3 copy
 *
 * The SQL is recorded, not run; fixture rows come back from a fake query()
 * routed by statement: candidates, details, hidden count, data_as_of.
 * What must hold: grant ids and GG3 links look up exactly those grants at any
 * status, naming the ones not in GG3; keywords become parameterised word-start
 * conditions with filler words and bare numbers left out; ranking puts an exact
 * name, then a phrase, above partial matches, and "Stream 2" above "Stream 1";
 * every filter adds its clause with escaped patterns; hidden grants are out by
 * default with their count returned; at most 20 results plus the total; linked
 * grants carry GG1 status and a mismatch flag; links and data_as_of are right.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/grant-data.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let candidateRows = [];
let detailRows = new Map();
let hiddenCount = 0;
let asOf = new Date('2026-09-29T12:32:28Z');
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text, params = []) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    sent.push({ text: flat, params });
    if (/FROM gg3_refresh_runs/.test(flat)) return { rows: asOf ? [{ finished_at: asOf }] : [] };
    if (/count\(\*\)::int AS n/.test(flat)) return { rows: [{ n: hiddenCount }] };
    if (/AS name_hits/.test(flat)) return { rows: candidateRows };
    if (/WHERE g\.id = ANY/.test(flat)) return { rows: params[0].map(id => detailRows.get(id)).filter(Boolean).reverse() };
    return { rows: [] };
  }
}));

const {
  runGrantData, searchGrantData, keywordTokens, queryTerms, idsFromQuery, rankCandidates, isClearlyNamed, normalize, expandRegions, summarize
} = await import('../../src/tools/grant-data.js');

const candidateQuery = () => sent.find(s => /AS name_hits/.test(s.text));
const detailQuery = () => sent.find(s => /WHERE g\.id = ANY/.test(s.text));
const hiddenQuery = () => sent.find(s => /count\(\*\)::int AS n/.test(s.text));

function detail(id, extra = {}) {
  return {
    id, grant_name: `Grant ${id}`, status: 'active', program_provider: 'Funder', grant_amount: '50000',
    deadline: 'Open Until Filled', regions: ['British Columbia'], industries: ['Manufacturing'],
    summary_src: '<p>Short overview.</p>', gg1_id: null, gg1_active: null, ...extra
  };
}
const cand = (id, name, extra = {}) => ({ id, grant_name: name, status: 'active', name_n: normalize(name), last_updated: '2026/01/01', name_hits: 0, body_hits: 0, ...extra });
/** Candidates for the given ids, and details for all of them. */
function fixtures(rows) {
  candidateRows = rows.map(r => cand(r.id, r.name, { status: r.detail?.status ?? 'active', ...r }));
  detailRows = new Map(rows.map(r => [r.id, detail(r.id, { grant_name: r.name, ...(r.detail || {}) })]));
}

beforeEach(() => {
  sent.length = 0;
  candidateRows = [];
  detailRows = new Map();
  hiddenCount = 0;
  asOf = new Date('2026-09-29T12:32:28Z');
});

describe('ID lookup', () => {
  test('which queries are lookups', () => {
    expect(idsFromQuery('1856')).toEqual([1856]);
    expect(idsFromQuery(' #1856, 1425 ')).toEqual([1856, 1425]);
    expect(idsFromQuery('https://app.getgranted.ai/grants/1856')).toEqual([1856]);
    expect(idsFromQuery('check admin.getgranted.ai/grants/1425 and https://app.getgranted.ai/grants/1856 please')).toEqual([1425, 1856]);
    expect(idsFromQuery('Stream 2')).toBeNull();
    expect(idsFromQuery('2026 hiring')).toBeNull();
    expect(idsFromQuery('https://app.getgranted.ca/grants/571')).toBeNull();   // GG1 link, not GG3
    expect(idsFromQuery('')).toBeNull();
  });

  test('a bare number returns that grant, with no search and no status filter', async () => {
    detailRows = new Map([[1856, detail(1856, { grant_name: 'Green Jobs - Sustainable Energy' })]]);
    const r = await searchGrantData({ query: '1856' });
    expect(r).toMatchObject({ success: true, lookup: 'id', total_matches: 1, returned: 1, not_found: [], hidden_matches: null });
    expect(r.results[0]).toMatchObject({ id: 1856, name: 'Green Jobs - Sustainable Energy' });
    expect(detailQuery().params).toEqual([[1856]]);
    expect(candidateQuery()).toBeUndefined();
    expect(detailQuery().text.split(' WHERE ')[1]).toBe('g.id = ANY($1::int[])');   // no status filter
  });

  test('app and admin links resolve to the same grant', async () => {
    detailRows = new Map([[1856, detail(1856)]]);
    for (const q of ['https://app.getgranted.ai/grants/1856', 'https://admin.getgranted.ai/grants/1856']) {
      sent.length = 0;
      const r = await searchGrantData({ query: q });
      expect(r.results.map(x => x.id)).toEqual([1856]);
    }
  });

  test('a hidden grant is returned by id', async () => {
    detailRows = new Map([[1348, detail(1348, { status: 'hide' })]]);
    const r = await searchGrantData({ query: '1348' });
    expect(r.results[0].status).toBe('hide');
  });

  test('an id not in GG3 comes back in not_found with a plain note; filters are ignored and said so', async () => {
    detailRows = new Map([[1425, detail(1425)]]);
    const r = await searchGrantData({ query: 'app.getgranted.ai/grants/1425 app.getgranted.ai/grants/99999', regions: ['BC'] });
    expect(r.results.map(x => x.id)).toEqual([1425]);
    expect(r.not_found).toEqual([99999]);
    expect(r.note).toMatch(/Grant 99999 is not in GG3 \(Oracle's copy as of 2026-09-29 12:32 UTC\)\./);
    expect(r.note).toMatch(/regions ignored/);
  });
});

describe('keywords', () => {
  test('filler words and bare numbers never match; numbers are kept for the phrase and tie-break', () => {
    expect(queryTerms('Agricultural Water Infrastructure Program – Stream 2')).toEqual({
      phrase: 'agricultural water infrastructure program stream 2',
      tokens: ['agricultural', 'water', 'infrastructure'],
      numbers: ['2']
    });
    expect(keywordTokens('Wage subsidy for YOUTH grants — Québec fund')).toEqual(['wage', 'subsidy', 'youth', 'quebec']);
    expect(keywordTokens('grant program stream 2')).toEqual([]);
    expect(queryTerms('ESSOR 1B').numbers).toEqual(['1b']);
  });

  test('keyword search: tokens as a parameter, word-start matching on name and card text, phrase on the name', async () => {
    await searchGrantData({ query: 'CanExport SME' });
    const q = candidateQuery();
    expect(q.params[0]).toEqual(['canexport', 'sme']);
    expect(q.params[1]).toBe('canexport sme');
    expect(q.text).toMatch(/\(' ' \|\| g\.name_n\) LIKE '% ' \|\| k \|\| '%' OR g\.body_n LIKE '% ' \|\| k \|\| '%'/);
    expect(q.text).toMatch(/\(' ' \|\| g\.name_n \|\| ' '\) LIKE '% ' \|\| \$2 \|\| ' %'/);
    expect(q.text).toMatch(/jsonb_each_text/);
    expect(q.text).not.toMatch(/canexport/i);                       // never interpolated
  });

  test('a filler-and-number query matches on the phrase alone, without scanning card text', async () => {
    await searchGrantData({ query: 'Stream 2' });
    const q = candidateQuery();
    expect(q.params[0]).toBe('stream 2');
    expect(q.text).not.toMatch(/jsonb_each_text|unnest/);
  });

  test('no query → no keyword clause at all', async () => {
    await searchGrantData({ regions: ['BC'] });
    expect(candidateQuery().text).toMatch(/WHERE TRUE$/);
  });
});

describe('ranking', () => {
  const terms = (q) => queryTerms(q);
  const order = (rows, q) => rankCandidates(rows, terms(q)).map(r => r.id);

  test('exact name, then phrase, then more keyword hits', () => {
    const rows = [
      cand(1, 'Clean Water Infrastructure Innovation Grant', { name_hits: 3, body_hits: 3 }),
      cand(2, 'BC Water Infrastructure Program Top-Up', { name_hits: 2 }),
      cand(3, 'Water Infrastructure Program', { name_hits: 2 })
    ];
    expect(order(rows, 'Water Infrastructure Program')).toEqual([3, 2, 1]);
  });

  test('"Stream 2" beats "Stream 1": exact phrase, and as a tie-break when neither name is exact', () => {
    const streams = [
      cand(1424, 'Agricultural Water Infrastructure Program - Stream 1', { name_hits: 3 }),
      cand(1425, 'Agricultural Water Infrastructure Program - Stream 2', { name_hits: 3 }),
      cand(1426, 'Agricultural Water Infrastructure Program - Stream 3', { name_hits: 3 })
    ];
    expect(order(streams, 'Agricultural Water Infrastructure Program Stream 2')[0]).toBe(1425);
    const partial = streams.map(r => ({ ...r, name_hits: 2 }));
    expect(order(partial, 'water infrastructure stream 2')[0]).toBe(1425);
  });

  test('filler words do not score: overlap on "program" and "fund" alone ranks nothing up', () => {
    const rows = [
      cand(1, 'Talent Fund Program', { last_updated: '2026/09/01' }),
      cand(2, 'Export Accelerator', { name_hits: 1, last_updated: '2025/01/01' })
    ];
    expect(order(rows, 'export program fund')).toEqual([2, 1]);
  });

  test('ties fall back to newest, then id', () => {
    const rows = [cand(5, 'A', { last_updated: '2026/01/01' }), cand(4, 'B', { last_updated: '2026/05/01' }), cand(3, 'C', { last_updated: '2026/05/01' })];
    expect(order(rows, '')).toEqual([3, 4, 5]);
  });

  test('the search returns details in ranked order, not database order', async () => {
    fixtures([
      { id: 1424, name: 'Agricultural Water Infrastructure Program - Stream 1', name_hits: 3 },
      { id: 1425, name: 'Agricultural Water Infrastructure Program - Stream 2', name_hits: 3 },
      { id: 1426, name: 'Agricultural Water Infrastructure Program - Stream 3', name_hits: 3 }
    ]);
    const r = await searchGrantData({ query: 'Agricultural Water Infrastructure Program Stream 2' });
    expect(r.results.map(x => x.id)).toEqual([1425, 1424, 1426]);
    expect(detailQuery().params).toEqual([[1425, 1424, 1426]]);
  });
});

describe('filters', () => {
  test('province codes expand; unknown values pass through folded', () => {
    expect(expandRegions(['BC', 'q.c.', 'Nunavut', 'Québec'])).toEqual(['British Columbia', 'Quebec', 'Nunavut', 'Quebec']);
  });

  test('region: any element matches, All of Canada always included', async () => {
    await searchGrantData({ regions: ['BC', 'on'] });
    const q = candidateQuery();
    expect(q.text).toMatch(/jsonb_array_elements_text\(CASE jsonb_typeof\(gg\.regions\).*r = 'All of Canada' OR r ILIKE ANY\(\$1::text\[\]\)/);
    expect(q.params[0]).toEqual(['%British Columbia%', '%Ontario%']);
  });

  test('industry, grant type and funder each add a clause; % and _ are escaped', async () => {
    await searchGrantData({ industries: ['Tech - AI'], grant_types: ['Hiring'], funders: ['100%_Fund'] });
    const q = candidateQuery();
    expect(q.text).toMatch(/i ILIKE ANY\(\$1::text\[\]\)/);
    expect(q.text).toMatch(/gg\.grant_type ILIKE ANY\(\$2::text\[\]\)/);
    expect(q.text).toMatch(/gg\.program_provider ILIKE ANY\(\$3::text\[\]\)/);
    expect(q.params.slice(0, 3)).toEqual([['%Tech - AI%'], ['%Hiring%'], ['%100\\%\\_Fund%']]);
  });

  test('status defaults to active; asked statuses are used; unknown ones dropped', async () => {
    // one scan: the asked statuses first, then the visible ones left out (for other_status_matches)
    expect((await searchGrantData({})).statuses).toEqual(['active']);
    expect(candidateQuery().params).toContainEqual(['active', 'inactive', 'archived', 'draft']);
    sent.length = 0;
    expect((await searchGrantData({ status: ['inactive', 'archived', 'bogus'] })).statuses).toEqual(['inactive', 'archived']);
    expect(candidateQuery().params).toContainEqual(['inactive', 'archived', 'active', 'draft']);
  });

  test('status and cheap filters run before the card text is built; keywords after', async () => {
    await searchGrantData({ query: 'tariff', regions: ['BC'] });
    const q = candidateQuery().text;
    const inner = q.slice(q.indexOf('FROM gg3_grants gg'), q.indexOf('OFFSET 0'));
    expect(inner).toMatch(/gg\.status = ANY\(\$\d+::text\[\]\)/);
    expect(inner).toMatch(/gg\.regions/);
    expect(inner).not.toMatch(/unnest/);
    expect(q.slice(q.indexOf('OFFSET 0'))).toMatch(/WHERE \(EXISTS \(SELECT 1 FROM unnest/);
  });
});

describe('hidden grants', () => {
  test('excluded by default, their count returned from a second query with the same filters', async () => {
    hiddenCount = 4;
    const r = await searchGrantData({ query: 'tariff', regions: ['BC'] });
    expect(candidateQuery().params.flat()).not.toContain('hide');
    const h = hiddenQuery();
    expect(h.text).toMatch(/gg\.status = 'hide'/);
    expect(h.params).toEqual([['%British Columbia%'], ['tariff'], 'tariff']);
    expect(r.hidden_matches).toBe(4);
  });

  test('include_hidden adds hide to the statuses and skips the count', async () => {
    const r = await searchGrantData({ query: 'tariff', include_hidden: true });
    expect(candidateQuery().params).toContainEqual(['active', 'hide', 'inactive', 'archived', 'draft']);
    expect(hiddenQuery()).toBeUndefined();
    expect(r.hidden_matches).toBeNull();
    expect(r.statuses).toEqual(['active', 'hide']);
  });
});

describe('results', () => {
  test('at most 20 results; total_matches counts every candidate', async () => {
    fixtures(Array.from({ length: 57 }, (_, i) => ({ id: 1000 + i, name: `Grant ${i}` })));
    const r = await searchGrantData({ limit: 500 });
    expect(detailQuery().params[0]).toHaveLength(20);
    expect(r).toMatchObject({ total_matches: 57, returned: 20 });
    sent.length = 0;
    await searchGrantData({});
    expect(detailQuery().params[0]).toHaveLength(10);            // default
  });

  test('each result has the fields and both links', async () => {
    fixtures([{ id: 1314, name: 'Employer Training Grant (ETG)', detail: { program_provider: 'WorkBC', deadline: 'March 31, 2027' } }]);
    const [r] = (await searchGrantData({ query: 'ETG' })).results;
    expect(r).toEqual({
      id: 1314, name: 'Employer Training Grant (ETG)', status: 'active', funder: 'WorkBC', amount: '50000',
      deadline: 'March 31, 2027', regions: ['British Columbia'], industries: ['Manufacturing'],
      summary: 'Short overview.',
      links: { app: 'https://app.getgranted.ai/grants/1314', admin: 'https://admin.getgranted.ai/grants/1314' }
    });
    expect(r).not.toHaveProperty('gg1');                         // unlinked: no GG1 fields at all
  });

  test('long region and industry lists are cut to 12 with a count of the rest', async () => {
    fixtures([{ id: 1, name: 'Any Industry', detail: { industries: Array.from({ length: 80 }, (_, i) => `Industry ${i}`) } }]);
    const [r] = (await searchGrantData({})).results;
    expect(r.industries).toHaveLength(12);
    expect(r.industries_more).toBe(68);
    expect(r).not.toHaveProperty('regions_more');
  });

  test('linked grants carry GG1 status and flag a mismatch', async () => {
    fixtures([
      { id: 1, name: 'A', detail: { gg1_id: '741', gg1_active: true, status: 'archived' } },
      { id: 2, name: 'B', detail: { gg1_id: '571', gg1_active: true, status: 'active' } },
      { id: 3, name: 'C', detail: { gg1_id: '92', gg1_active: false, status: 'active' } },
      { id: 4, name: 'D', detail: { gg1_id: '93', gg1_active: false, status: 'inactive' } }
    ]);
    const results = (await searchGrantData({ status: ['active', 'inactive', 'archived'] })).results;
    expect(results.map(r => [r.id, r.gg1, r.status_mismatch])).toEqual([
      [1, { id: '741', status: 'active' }, true],
      [2, { id: '571', status: 'active' }, false],
      [3, { id: '92', status: 'inactive' }, true],
      [4, { id: '93', status: 'inactive' }, false]
    ]);
    expect(detailQuery().text).toMatch(/LEFT JOIN gg1_gg3_links l ON l\.gg3_id = g\.id LEFT JOIN grants g1 ON g1\.grant_id = l\.gg1_id/);
  });

  test('summary strips HTML and entities and cuts at a word', () => {
    expect(summarize('<p>Up to&nbsp;$5,000 &amp; <strong>more</strong></p>')).toBe('Up to $5,000 & more');
    const long = summarize(`<p>${'word '.repeat(80)}</p>`);
    expect(long.length).toBeLessThanOrEqual(241);
    expect(long.endsWith('word…')).toBe(true);
    expect(summarize(null)).toBeNull();
  });

  test('data_as_of is the latest successful refresh; null with a note when there is none', async () => {
    expect((await searchGrantData({})).data_as_of).toEqual(new Date('2026-09-29T12:32:28Z'));
    expect(sent.find(s => /gg3_refresh_runs/.test(s.text)).text).toMatch(/WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1/);
    asOf = null;
    const r = await searchGrantData({});
    expect(r.data_as_of).toBeNull();
    expect(r.data_note).toMatch(/No successful GG3 refresh/);
  });
});

describe('matches at other statuses', () => {
  const water = (id, stream, status) => ({ id, name: `Agricultural Water Infrastructure Program - Stream ${stream}`, name_hits: 3, detail: { status } });

  test('a default search reports matching inactive grants in other_status_matches.top', async () => {
    fixtures([
      { id: 1660, name: 'Agriculture and Food Innovation Program', name_hits: 1 },
      water(1424, 1, 'hide'),          // never in the candidate scan: hide is not a visible status
      water(1425, 2, 'inactive'),
      water(1426, 3, 'inactive'),
      { id: 1287, name: 'Accelerating Agricultural Innovations 2.0', name_hits: 1, detail: { status: 'archived' } }
    ].filter(r => r.detail?.status !== 'hide'));
    // two meaningful words: nothing is clearly named, so the inactive ones stay in other_status_matches
    const r = await searchGrantData({ query: 'Agricultural Water' });
    expect(r.results.map(x => x.id)).toEqual([1660]);
    expect(r.total_matches).toBe(1);
    expect(r.other_status_matches).toEqual({
      count: 3,
      by_status: { inactive: 2, archived: 1 },
      top: [
        { id: 1425, name: 'Agricultural Water Infrastructure Program - Stream 2', status: 'inactive' },
        { id: 1426, name: 'Agricultural Water Infrastructure Program - Stream 3', status: 'inactive' },
        { id: 1287, name: 'Accelerating Agricultural Innovations 2.0', status: 'archived' }
      ]
    });
    expect(detailQuery().params).toEqual([[1660]]);   // details only for the asked statuses
  });

  test('searching every visible status returns no other_status_matches', async () => {
    fixtures([water(1425, 2, 'inactive')]);
    const r = await searchGrantData({ query: 'water', status: ['active', 'inactive', 'archived', 'draft'] });
    expect(r.results.map(x => x.id)).toEqual([1425]);
    expect(r).not.toHaveProperty('other_status_matches');
  });

  test('hidden grants are never scanned for it — they are counted only in hidden_matches', async () => {
    hiddenCount = 2;
    const r = await searchGrantData({ query: 'water' });
    expect(candidateQuery().params.flat()).not.toContain('hide');
    expect(r.hidden_matches).toBe(2);
    expect(r.other_status_matches).toEqual({ count: 0, by_status: {}, top: [] });
    sent.length = 0;
    await searchGrantData({ query: 'water', include_hidden: true });
    // hide is asked for, so it sits in the asked statuses, never in the "other" ones
    expect(candidateQuery().params).toContainEqual(['active', 'hide', 'inactive', 'archived', 'draft']);
  });

  test('a filtered-out status still scores through the same ranking', async () => {
    fixtures([
      { id: 1, name: 'Water Plan', name_hits: 1, detail: { status: 'draft' } },
      { id: 2, name: 'Agricultural Water Infrastructure Program', name_hits: 3, detail: { status: 'archived' } }
    ]);
    const r = await searchGrantData({ query: 'water' });
    expect(r.other_status_matches.top.map(t => t.id)).toEqual([2, 1]);
  });
});

describe('named grants', () => {
  const STREAM_2 = 'Agricultural Water Infrastructure Program - Stream 2';

  test('which queries clearly name a grant', () => {
    const n = normalize;
    expect(isClearlyNamed(n(STREAM_2), queryTerms('Agricultural Water Infrastructure Program Stream 2'))).toBe(true);   // exact
    expect(isClearlyNamed(n('BC Clean Energy Vehicles for Business Rebate'), queryTerms('clean energy vehicles'))).toBe(true);   // 3-word phrase
    expect(isClearlyNamed(n('Clean Energy Vehicles Rebate'), queryTerms('clean energy'))).toBe(false);   // 2 words: not enough
    expect(isClearlyNamed(n('Clean Energy'), queryTerms('clean energy'))).toBe(true);   // but an exact name always is
    expect(isClearlyNamed(n('PSCE - Stream 2'), queryTerms('Stream 2'))).toBe(false);   // filler and numbers only
    expect(isClearlyNamed(n('Water Vehicles Energy Clean'), queryTerms('clean energy vehicles'))).toBe(false);   // words, not the phrase
  });

  test('an exact name at inactive status is never promoted into results: it leads other_status_matches', async () => {
    fixtures([
      { id: 1660, name: 'Agriculture and Food Innovation Program', name_hits: 1 },
      { id: 1425, name: STREAM_2, name_hits: 3, detail: { status: 'inactive', gg1_id: '852', gg1_active: true } },
      { id: 1426, name: 'Agricultural Water Infrastructure Program - Stream 3', name_hits: 3, detail: { status: 'inactive' } }
    ]);
    const r = await searchGrantData({ query: 'Agricultural Water Infrastructure Program Stream 2' });
    expect(r.results.map(x => x.id)).toEqual([1660]);
    expect(r.total_matches).toBe(1);                                             // active only
    expect(r.other_status_matches).toEqual({
      count: 2, by_status: { inactive: 2 },
      top: [
        { id: 1425, name: STREAM_2, status: 'inactive', exact_match: true },
        { id: 1426, name: 'Agricultural Water Infrastructure Program - Stream 3', status: 'inactive' }
      ]
    });
  });

  test('a 3-word phrase inside an archived name stays out of results, at the top of other_status_matches', async () => {
    fixtures([
      { id: 8, name: 'Clean Tech Vehicles Fund', name_hits: 2, detail: { status: 'archived' } },
      { id: 7, name: 'BC Clean Energy Vehicles for Business Rebate', name_hits: 3, detail: { status: 'archived' } }
    ]);
    const r = await searchGrantData({ query: 'clean energy vehicles' });
    expect(r.results).toEqual([]);
    expect(r.other_status_matches.top.map(t => [t.id, t.exact_match ?? false])).toEqual([[7, false], [8, false]]);
  });

  test('a 2-word phrase is not auto-included; it stays in other_status_matches', async () => {
    fixtures([{ id: 7, name: 'Clean Energy Vehicles Rebate', name_hits: 2, detail: { status: 'inactive' } }]);
    const r = await searchGrantData({ query: 'clean energy' });
    expect(r.results).toEqual([]);
    expect(r.other_status_matches.top.map(t => t.id)).toEqual([7]);
  });

  test('a hidden exact match is not auto-included: the scan never holds hide unless asked', async () => {
    hiddenCount = 1;
    const r = await searchGrantData({ query: 'Activate Circular Accelerator - COIL' });
    expect(candidateQuery().params.flat()).not.toContain('hide');
    expect(r.results).toEqual([]);
    expect(r.hidden_matches).toBe(1);
  });

  test('a named grant already at an asked status is flagged too, and never listed twice', async () => {
    fixtures([
      { id: 1, name: 'Wage Subsidy Youth Program', name_hits: 3 },
      { id: 2, name: 'Youth Wage Subsidy Top-Up', name_hits: 3, last_updated: '2026/09/01' }
    ]);
    const r = await searchGrantData({ query: 'wage subsidy youth program' });
    expect(r.results.map(x => [x.id, x.named_match ?? false])).toEqual([[1, true], [2, false]]);
    expect(r.total_matches).toBe(2);
  });
});

// THE RULE (active exact-name match first):
// 1. default searches: results are active only; an exact name ranks first among them
// 2. a non-active exact match never enters results; it leads other_status_matches, labelled with its status
// 3. with no active exact match, the non-active exact match still leads other_status_matches
// 4. an explicitly asked non-active status: the exact name ranks first within it
describe('active exact-name match first (ETG)', () => {
  const ETG = [
    { id: 1314, name: 'Employer Training Grant (ETG)', name_hits: 1, last_updated: '2025/01/01' },
    { id: 1501, name: 'LNG Canada Trades Training Fund (TTF)', name_hits: 1, last_updated: '2026/09/01' },
    { id: 935, name: '(Z-EXPIRED) 2019 BC Employer Training Grant (ETG) - Workforce - Intake #1', name_hits: 4, last_updated: '2026/09/30', detail: { status: 'archived' } },
    { id: 990, name: 'Employer Training Grant (ETG)', name_hits: 1, last_updated: '2026/09/30', detail: { status: 'archived' } }
  ];

  test('rule 1: a default search returns active grants only, the active exact name first', async () => {
    fixtures(ETG);
    const r = await searchGrantData({ query: 'Employer Training Grant (ETG)' });
    expect(r.statuses).toEqual(['active']);
    expect(r.results.map(x => [x.id, x.status])).toEqual([[1314, 'active'], [1501, 'active']]);
    expect(r.results[0].named_match).toBe(true);
    expect(r.total_matches).toBe(2);
  });

  test('rule 1: a longer query that archived cards contain still keeps them out of results', async () => {
    fixtures(ETG);
    const r = await searchGrantData({ query: 'BC Employer Training Grant' });
    expect(r.results.every(x => x.status === 'active')).toBe(true);
    expect(r.other_status_matches.top[0]).toMatchObject({ id: 935, status: 'archived' });
  });

  test('rule 2: the archived exact match leads other_status_matches, labelled with its status', async () => {
    fixtures(ETG);
    const r = await searchGrantData({ query: 'Employer Training Grant (ETG)' });
    expect(r.results.map(x => x.id)).not.toContain(990);
    expect(r.other_status_matches.top[0]).toEqual({ id: 990, name: 'Employer Training Grant (ETG)', status: 'archived', exact_match: true });
    expect(r.other_status_matches.top[1]).toMatchObject({ id: 935, status: 'archived' });
    expect(r.other_status_matches.top[1]).not.toHaveProperty('exact_match');
  });

  test('rule 2: every exact match leads, even past the usual three', async () => {
    fixtures([1, 2, 3, 4].map(id => ({ id, name: 'Employer Training Grant (ETG)', name_hits: 1, detail: { status: id % 2 ? 'archived' : 'inactive' } }))
      .concat([{ id: 5, name: 'Employer Training Grant (ETG) Extra Stream', name_hits: 9, detail: { status: 'archived' } }]));
    const r = await searchGrantData({ query: 'Employer Training Grant (ETG)' });
    expect(r.other_status_matches.top.map(t => [t.id, t.exact_match ?? false])).toEqual([[1, true], [2, true], [3, true], [4, true]]);
  });

  test('rule 3: no active exact match — the archived exact match still leads other_status_matches', async () => {
    fixtures([
      { id: 1501, name: 'LNG Canada Trades Training Fund (TTF)', name_hits: 1 },
      { id: 990, name: 'ETG', name_hits: 1, detail: { status: 'archived' } },
      { id: 935, name: '(Z-EXPIRED) 2019 BC ETG Workforce', name_hits: 1, last_updated: '2026/09/30', detail: { status: 'archived' } }
    ]);
    const r = await searchGrantData({ query: 'ETG' });
    expect(r.results.map(x => x.id)).toEqual([1501]);
    expect(r.other_status_matches.top[0]).toEqual({ id: 990, name: 'ETG', status: 'archived', exact_match: true });
  });

  test('rule 4: asking for archived puts the archived exact match first within that status', async () => {
    fixtures(ETG);
    const r = await searchGrantData({ query: 'Employer Training Grant (ETG)', status: ['archived'] });
    expect(r.results.map(x => [x.id, x.status])).toEqual([[990, 'archived'], [935, 'archived']]);
    expect(r.results[0].named_match).toBe(true);
    // the active exact match is then the one reported elsewhere
    expect(r.other_status_matches.top[0]).toEqual({ id: 1314, name: 'Employer Training Grant (ETG)', status: 'active', exact_match: true });
  });

  test('all statuses asked (how Oracle finds a named grant in client conversations): exact name first, flagged', async () => {
    fixtures(ETG);
    const r = await searchGrantData({ query: 'Employer Training Grant (ETG)', status: ['active', 'inactive', 'archived', 'draft'] });
    expect(r.results.slice(0, 2).map(x => [x.id, x.named_match ?? false])).toEqual([[990, true], [1314, true]]);
    expect(r).not.toHaveProperty('other_status_matches');
  });
});

describe('modes', () => {
  test('search dispatches; anything else is an error, not a throw', async () => {
    expect((await runGrantData({ mode: 'search', query: 'x' })).mode).toBe('search');
    expect(await runGrantData({ mode: 'counts' })).toEqual({ success: false, error: 'Unknown grant_data mode "counts". Available: search, report, check, find, tags, compare.' });
    expect((await runGrantData({})).success).toBe(false);
  });
});

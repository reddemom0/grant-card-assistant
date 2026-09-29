/**
 * grant_data — search mode over the GG3 copy
 *
 * The SQL is recorded, not run; fixture rows come back from a fake query().
 * What must hold: keywords become parameterised name / card-text conditions;
 * every filter adds its clause with escaped patterns (province codes expanded,
 * All-of-Canada always in); hidden grants are out by default with their count
 * returned, in with include_hidden; at most 20 results plus the total; linked
 * grants carry GG1 status and a mismatch flag; links and data_as_of are right.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/grant-data.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let pageRows = [];
let hiddenCount = 0;
let asOf = new Date('2026-09-29T12:32:28Z');
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text, params = []) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    sent.push({ text: flat, params });
    if (/FROM gg3_refresh_runs/.test(flat)) return { rows: asOf ? [{ finished_at: asOf }] : [] };
    if (/count\(\*\)::int AS n/.test(flat)) return { rows: [{ n: hiddenCount }] };
    return { rows: pageRows };
  }
}));

const { runGrantData, searchGrantData, keywordTokens, expandRegions, summarize } = await import('../../src/tools/grant-data.js');

const pageQuery = () => sent.find(s => /count\(\*\) OVER \(\)/.test(s.text));
const hiddenQuery = () => sent.find(s => /count\(\*\)::int AS n/.test(s.text));

function row(id, extra = {}) {
  return {
    id, grant_name: `Grant ${id}`, status: 'active', program_provider: 'Funder', grant_amount: '50000',
    deadline: 'Open Until Filled', regions: ['British Columbia'], industries: ['Manufacturing'],
    summary_src: '<p>Short overview.</p>', gg1_id: null, gg1_active: null, total_matches: '1', ...extra
  };
}

beforeEach(() => {
  sent.length = 0;
  pageRows = [];
  hiddenCount = 0;
  asOf = new Date('2026-09-29T12:32:28Z');
});

describe('keywords', () => {
  test('folded, split, filler dropped, deduped', () => {
    expect(keywordTokens('Wage subsidy for YOUTH grants — Québec youth')).toEqual(['wage', 'subsidy', 'youth', 'quebec']);
    expect(keywordTokens('grant program')).toEqual(['grant', 'program']);   // only filler: kept
    expect(keywordTokens('')).toEqual([]);
  });

  test('a keyword search matches name or card text as parameters, and ranks name matches higher', async () => {
    await searchGrantData({ query: 'CanExport SME' });
    const q = pageQuery();
    expect(q.params[0]).toEqual(['canexport', 'sme']);
    expect(q.text).toMatch(/g\.name_f LIKE '%' \|\| k \|\| '%' OR g\.body_f LIKE '%' \|\| k \|\| '%'/);
    expect(q.text).toMatch(/THEN 2 WHEN g\.body_f LIKE .* THEN 1/);
    expect(q.text).toMatch(/jsonb_each_text/);                   // card text comes from field_content
    expect(q.text).not.toMatch(/canexport/i);                    // never interpolated
  });

  test('no keywords → no card-text scan, no keyword clause, ordered by recency alone', async () => {
    await searchGrantData({ regions: ['BC'] });
    expect(pageQuery().text).not.toMatch(/jsonb_each_text|unnest/);
    // not "ORDER BY 0 DESC": Postgres reads a bare integer as a column position (42P10)
    expect(pageQuery().text).toMatch(/ORDER BY g\.last_updated DESC NULLS LAST, g\.id/);
  });
});

describe('filters', () => {
  test('province codes expand; unknown values pass through folded', () => {
    expect(expandRegions(['BC', 'q.c.', 'Nunavut', 'Québec'])).toEqual(['British Columbia', 'Quebec', 'Nunavut', 'Quebec']);
  });

  test('region: any element matches, All of Canada always included', async () => {
    await searchGrantData({ regions: ['BC', 'on'] });
    const q = pageQuery();
    expect(q.text).toMatch(/jsonb_array_elements_text\(CASE jsonb_typeof\(gg\.regions\).*r = 'All of Canada' OR r ILIKE ANY\(\$1::text\[\]\)/);
    expect(q.params[0]).toEqual(['%British Columbia%', '%Ontario%']);
  });

  test('industry, grant type and funder each add a clause; % and _ are escaped', async () => {
    await searchGrantData({ industries: ['Tech - AI'], grant_types: ['Hiring'], funders: ['100%_Fund'] });
    const q = pageQuery();
    expect(q.text).toMatch(/i ILIKE ANY\(\$1::text\[\]\)/);
    expect(q.text).toMatch(/gg\.grant_type ILIKE ANY\(\$2::text\[\]\)/);
    expect(q.text).toMatch(/gg\.program_provider ILIKE ANY\(\$3::text\[\]\)/);
    expect(q.params.slice(0, 3)).toEqual([['%Tech - AI%'], ['%Hiring%'], ['%100\\%\\_Fund%']]);
  });

  test('status defaults to active; asked statuses are used; unknown ones dropped', async () => {
    await searchGrantData({});
    expect(pageQuery().params).toContainEqual(['active']);
    sent.length = 0;
    await searchGrantData({ status: ['inactive', 'archived', 'bogus'] });
    expect(pageQuery().params).toContainEqual(['inactive', 'archived']);
  });
});

describe('hidden grants', () => {
  test('excluded by default, their count returned from a second query with the same filters', async () => {
    hiddenCount = 4;
    const r = await searchGrantData({ query: 'tariff', regions: ['BC'] });
    expect(pageQuery().params).toContainEqual(['active']);
    expect(pageQuery().params.flat()).not.toContain('hide');
    const h = hiddenQuery();
    expect(h.text).toMatch(/gg\.status = 'hide'/);
    expect(h.params).toEqual([['%British Columbia%'], ['tariff']]);
    expect(r.hidden_matches).toBe(4);
  });

  test('include_hidden adds hide to the statuses and skips the count', async () => {
    const r = await searchGrantData({ query: 'tariff', include_hidden: true });
    expect(pageQuery().params).toContainEqual(['active', 'hide']);
    expect(hiddenQuery()).toBeUndefined();
    expect(r.hidden_matches).toBeNull();
    expect(r.statuses).toEqual(['active', 'hide']);
  });
});

describe('results', () => {
  test('at most 20 results; total_matches is the full count', async () => {
    await searchGrantData({ limit: 500 });
    expect(pageQuery().params.at(-1)).toBe(20);
    sent.length = 0;
    await searchGrantData({});
    expect(pageQuery().params.at(-1)).toBe(10);                  // default
    pageRows = [row(1, { total_matches: '57' }), row(2, { total_matches: '57' })];
    const r = await searchGrantData({ limit: 2 });
    expect(r).toMatchObject({ success: true, mode: 'search', total_matches: 57, returned: 2 });
  });

  test('each result has the fields and both links', async () => {
    pageRows = [row(1314, { grant_name: 'Employer Training Grant (ETG)', program_provider: 'WorkBC', deadline: 'March 31, 2027' })];
    const [r] = (await searchGrantData({ query: 'ETG' })).results;
    expect(r).toEqual({
      id: 1314, name: 'Employer Training Grant (ETG)', status: 'active', funder: 'WorkBC', amount: '50000',
      deadline: 'March 31, 2027', regions: ['British Columbia'], industries: ['Manufacturing'],
      summary: 'Short overview.',
      links: { app: 'https://app.getgranted.ai/grants/1314', admin: 'https://admin.getgranted.ai/grants/1314' }
    });
    expect(r).not.toHaveProperty('gg1');                         // unlinked: no GG1 fields at all
  });

  test('status and cheap filters run before the card text is built; keywords after', async () => {
    await searchGrantData({ query: 'tariff', regions: ['BC'] });
    const q = pageQuery().text;
    const inner = q.slice(q.indexOf('FROM gg3_grants gg'), q.indexOf('OFFSET 0'));
    expect(inner).toMatch(/gg\.status = ANY\(\$\d+::text\[\]\)/);
    expect(inner).toMatch(/gg\.regions/);
    expect(inner).not.toMatch(/unnest/);
    expect(q.slice(q.indexOf('OFFSET 0'))).toMatch(/WHERE EXISTS \(SELECT 1 FROM unnest/);
  });

  test('long region and industry lists are cut to 12 with a count of the rest', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `Industry ${i}`);
    pageRows = [row(1, { industries: many })];
    const [r] = (await searchGrantData({})).results;
    expect(r.industries).toHaveLength(12);
    expect(r.industries_more).toBe(68);
    expect(r).not.toHaveProperty('regions_more');
  });

  test('linked grants carry GG1 status and flag a mismatch', async () => {
    pageRows = [
      row(1, { gg1_id: '741', gg1_active: true, status: 'archived' }),
      row(2, { gg1_id: '571', gg1_active: true, status: 'active' }),
      row(3, { gg1_id: '92', gg1_active: false, status: 'active' }),
      row(4, { gg1_id: '93', gg1_active: false, status: 'inactive' })
    ];
    const results = (await searchGrantData({ status: ['active', 'inactive', 'archived'] })).results;
    expect(results.map(r => [r.gg1, r.status_mismatch])).toEqual([
      [{ id: '741', status: 'active' }, true],
      [{ id: '571', status: 'active' }, false],
      [{ id: '92', status: 'inactive' }, true],
      [{ id: '93', status: 'inactive' }, false]
    ]);
    expect(pageQuery().text).toMatch(/LEFT JOIN gg1_gg3_links l ON l\.gg3_id = g\.id LEFT JOIN grants g1 ON g1\.grant_id = l\.gg1_id/);
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

describe('modes', () => {
  test('search dispatches; anything else is an error, not a throw', async () => {
    expect((await runGrantData({ mode: 'search', query: 'x' })).mode).toBe('search');
    expect(await runGrantData({ mode: 'counts' })).toEqual({ success: false, error: 'Unknown grant_data mode "counts". Available: search.' });
    expect((await runGrantData({})).success).toBe(false);
  });
});

/**
 * grant_data — report, check, find, tags, compare, and the results sheet
 *
 * The SQL is recorded, not run; a fake query() answers by statement from
 * fixture rows (filtered by the status parameter, so the status defaults are
 * real). The sheet writer is mocked.
 * What must hold: every mode takes search's filters, status defaults to active
 * (compare: every visible status) and hides "hide"; report counts overlap and
 * says so, with all-industry grants apart; grant types split on the known
 * names, commas and all; check finds missing sections, blank cards, past
 * deadlines, contradictions and stale text, and lists unreadable deadlines
 * without guessing; find has no cap and respects number edges; tags and
 * compare handle one grant and their lists; over 10 rows a sheet is written
 * and only 10 rows come back; a failed sheet never fails the call.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/grant-data-modes.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let grants = [];
let gg1Only = [];
let unmatched = [];
let vocabulary = 10;
const asOf = new Date('2026-09-29T12:00:00Z');

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text, params = []) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    sent.push({ text: flat, params });
    if (/FROM gg3_refresh_runs/.test(flat)) return { rows: [{ finished_at: asOf }] };
    if (/count\(DISTINCT i\)/.test(flat)) return { rows: [{ n: vocabulary }] };
    if (/FROM grants g1/.test(flat)) return { rows: gg1Only };
    if (/FROM gg1_gg3_unmatched/.test(flat)) return { rows: unmatched };
    if (/WHERE gg\.id = ANY/.test(flat)) return { rows: grants.filter(g => params[0].includes(g.id)) };
    if (/FROM gg3_grants gg/.test(flat)) return { rows: grants.filter(g => params[0].includes(g.status)) };
    return { rows: [] };
  }
}));

const writeResultSheet = jest.fn(async (userId, { title }) => ({ url: 'https://docs.google.com/spreadsheets/d/abc', title, id: 'abc' }));
jest.unstable_mockModule('../../src/tools/grant-data-sheet.js', () => ({ writeResultSheet }));

const {
  buildModeResult, runMode, parseDeadline, splitGrantTypes, findPhrase, moneyIn, percentsIn,
  staleYearSentences, eligibilityTagsEmpty, plainText, SHEET_THRESHOLD
} = await import('../../src/tools/grant-data-modes.js');
const { runGrantData } = await import('../../src/tools/grant-data.js');

const NOW = new Date('2026-09-29T18:00:00Z');
const FULL_CARD = {
  grant_overview_2: '<p>Helps small firms.</p>',
  eligible_applicants_2: '<p>BC businesses.</p>',
  grant_value_2: '<p>Up to $50,000, covering 50% of costs.</p>'
};

function grant(id, extra = {}) {
  return {
    id, grant_name: `Grant ${id}`, status: 'active', grant_type: 'Hiring', program_provider: 'Funder',
    regions: ['British Columbia'], industries: ['Manufacturing'], grant_amount: '50000', contribution_percentage: '50',
    deadline: 'Open Until Filled', last_updated: '2026/09/01', grant_criteria: null, best_practices: null,
    field_content: { ...FULL_CARD }, eligibility_criteria: { size: { revenue_max: 1000 }, extraction_confidence: 'high' },
    genre_scores: null, boost_attributes: null,
    gg1_id: null, gg1_name: null, gg1_active: null, gg1_accepting: null, gg1_deadline: null,
    ...extra
  };
}
const statusParam = () => sent.find(s => /FROM gg3_grants gg/.test(s.text) && !/count\(DISTINCT/.test(s.text))?.params[0];

beforeEach(() => {
  sent.length = 0;
  grants = [];
  gg1Only = [];
  unmatched = [];
  vocabulary = 10;
  writeResultSheet.mockClear();
});

describe('filters and statuses', () => {
  test('every mode defaults to active and leaves hidden grants out', async () => {
    grants = [grant(1), grant(2, { status: 'inactive' }), grant(3, { status: 'hide' })];
    const r = await buildModeResult({ mode: 'report', group_by: ['status'] });
    expect(statusParam()).toEqual(['active']);
    expect(r.rows).toEqual([{ group: 'active', count: 1 }]);
    expect(r.data_as_of).toEqual(asOf);
    expect(r.filters).toEqual(['Status: active']);
  });

  test('statuses and include_hidden widen it; search filters become the same clauses', async () => {
    grants = [grant(1), grant(2, { status: 'inactive' }), grant(3, { status: 'hide' })];
    await buildModeResult({ mode: 'find', phrase: 'small', status: ['active', 'inactive'], include_hidden: true, regions: ['BC'], funders: ['Innovate BC'] });
    const sql = sent.find(s => /FROM gg3_grants gg/.test(s.text));
    expect(sql.params[0]).toEqual(['active', 'inactive', 'hide']);
    expect(sql.text).toMatch(/r = 'All of Canada' OR r ILIKE ANY/);
    expect(sql.params).toContainEqual(['%British Columbia%']);
    expect(sql.params).toContainEqual(['%Innovate BC%']);
  });

  test('compare defaults to every visible status', async () => {
    grants = [grant(1, { status: 'archived' })];
    await buildModeResult({ mode: 'compare', compare_list: ['status_differs'] });
    expect(statusParam()).toEqual(['active', 'inactive', 'archived', 'draft']);
  });

  test('runGrantData dispatches every mode; unknown modes are an error', async () => {
    grants = [grant(1)];
    expect((await runGrantData({ mode: 'find', phrase: 'small' })).mode).toBe('find');
    expect((await runGrantData({ mode: 'nope' })).success).toBe(false);
  });
});

describe('report', () => {
  test('industry counts put all-industry grants apart and say counts overlap', async () => {
    vocabulary = 10;
    const all = Array.from({ length: 9 }, (_, i) => `Industry ${i}`);
    grants = [
      grant(1, { industries: ['Manufacturing', 'Tech'] }),
      grant(2, { industries: ['Manufacturing'] }),
      grant(3, { industries: all }),
      grant(4, { industries: [] })
    ];
    const r = await buildModeResult({ mode: 'report', group_by: ['industry'] });
    expect(r.rows).toEqual([
      { group: 'Manufacturing', count: 2 },
      { group: 'No industry tags', count: 1 },
      { group: 'Tech', count: 1 }
    ]);
    expect(r.all_industries).toEqual({ count: 1 });
    expect(r.overlap_note).toMatch(/Counts overlap/);
    expect(r.notes.join(' ')).toMatch(/1 grant is open to all industries \(tagged with at least 9 of the 10/);
  });

  test('no overlap note when every grant is in exactly one group', async () => {
    grants = [grant(1), grant(2, { program_provider: 'Other' })];
    const r = await buildModeResult({ mode: 'report', group_by: ['funder'] });
    expect(r.overlap_note).toBeUndefined();
    expect(r.rows).toEqual([{ group: 'Funder', count: 1 }, { group: 'Other', count: 1 }]);
  });

  test('grant types split on the known names, including the one with a comma', () => {
    expect(splitGrantTypes('Hiring, Business Assessments, Planning & Coaching, Loan'))
      .toEqual(['Hiring', 'Business Assessments, Planning & Coaching', 'Loan']);
    expect(splitGrantTypes('Market Expansion, Something New')).toEqual(['Market Expansion', 'Something New']);
    expect(splitGrantTypes(null)).toEqual([]);
  });

  test('two dimensions cross-tab; deadline months group rolling, blank and unreadable', async () => {
    grants = [
      grant(1, { grant_type: 'Hiring, Training', deadline: 'March 31, 2027' }),
      grant(2, { deadline: null }),
      grant(3, { deadline: 'Spring 2027' })
    ];
    const r = await buildModeResult({ mode: 'report', group_by: ['grant_type', 'deadline_month'] });
    expect(r.rows).toEqual(expect.arrayContaining([
      { group_1: 'Hiring', group_2: '2027-03', count: 1 },
      { group_1: 'Training', group_2: '2027-03', count: 1 },
      { group_1: 'Hiring', group_2: 'No deadline', count: 1 },
      { group_1: 'Hiring', group_2: "Deadline can't be read", count: 1 }
    ]));
    expect(r.overlap_note).toMatch(/overlap/);
  });

  test('list returns every grant with the chosen columns and links', async () => {
    grants = [grant(1, { grant_amount: '22000' })];
    const r = await buildModeResult({ mode: 'report', columns: ['name', 'amount'] });
    expect(r.rows).toEqual([{
      id: 1, name: 'Grant 1', amount: 22000,
      app_link: 'https://app.getgranted.ai/grants/1', admin_link: 'https://admin.getgranted.ai/grants/1'
    }]);
  });

  test('bad group_by is an error, not a throw', async () => {
    expect(await buildModeResult({ mode: 'report', group_by: ['colour'] })).toMatchObject({ success: false });
  });
});

describe('check', () => {
  const run = async (checks) => buildModeResult({ mode: 'check', checks }, { now: NOW });

  test('missing core sections, and a blank card as one row', async () => {
    grants = [
      grant(1),
      grant(2, { field_content: { grant_overview_2: '<p>Hi</p>', demandeurs_admissibles_2: '<p>PME</p>' } }),
      grant(3, { field_content: { grant_overview_2: '<p>&nbsp;</p>' }, deadline: '' })
    ];
    const r = await run(['missing_sections']);
    expect(r.rows.map(x => [x.id, x.problem])).toEqual([
      [2, 'Missing funding value'],
      [3, 'Card is blank (no sections filled in) and has no deadline']
    ]);
    expect(r.rows[0]).toMatchObject({ check: 'Missing sections', app_link: 'https://app.getgranted.ai/grants/2' });
  });

  test('past deadlines fail; rolling is skipped; unreadable ones are listed apart, not guessed', async () => {
    grants = [
      grant(1, { deadline: 'May 27, 2026' }),
      grant(2, { deadline: '2027-02-05' }),
      grant(3, { deadline: 'Ouvert jusqu’à épuisement des fonds' }),
      grant(4, { deadline: '04/09/2026' }),
      grant(5, { deadline: 'Spring intake' }),
      grant(6, { deadline: '15/04/2021' })
    ];
    const r = await run(['past_deadlines']);
    expect(r.rows.map(x => x.id)).toEqual([1, 6]);
    expect(r.rows[0].problem).toBe('Deadline May 27, 2026 has passed (card says "May 27, 2026")');
    expect(r.unreadable_deadlines.map(x => [x.id, x.deadline])).toEqual([[4, '04/09/2026'], [5, 'Spring intake']]);
    expect(r.notes.join(' ')).toMatch(/2 deadlines could not be read/);
  });

  test('contradictions: card amounts or percentages that never match the fields', async () => {
    grants = [
      grant(1),
      grant(2, { grant_amount: '22000', field_content: { ...FULL_CARD, grant_value_2: '<p>Up to $15,000 or $30K for 75% of costs.</p>' } }),
      grant(3, { grant_amount: '0', contribution_percentage: null, field_content: { ...FULL_CARD, grant_value_2: '$1' } })
    ];
    const r = await run(['contradictions']);
    expect(r.rows.map(x => x.problem)).toEqual([
      'Amount field says $22,000; card mentions $15,000, $30,000, not $22,000',
      'Contribution field says 50%; card mentions 75%, not 50%'
    ]);
  });

  test('stale text: legacy-only cards and past years in intake wording', async () => {
    grants = [
      grant(1, { field_content: {}, grant_criteria: 'Old GG1 text' }),
      grant(2, { field_content: { ...FULL_CARD, program_details_2: '<p>Intakes: Winter 2025 closed.</p><p>The 2026-2027 intake is open.</p>' } }),
      grant(3, { field_content: { ...FULL_CARD, program_details_2: '<p>Founded in 2019. The 2025/26 intake runs to March.</p>' } })
    ];
    const r = await run(['stale_text']);
    expect(r.rows.map(x => [x.id, x.problem])).toEqual([
      [1, 'Content only in the old GG1 import text; no card sections filled in'],
      [2, 'Intake or deadline wording mentions 2025: "Intakes: Winter 2025 closed."']
    ]);
  });

  test('all checks by default, counted by check', async () => {
    grants = [grant(1, { deadline: 'January 1, 2026' })];
    const r = await buildModeResult({ mode: 'check' }, { now: NOW });
    expect(r.checks).toEqual(['missing_sections', 'past_deadlines', 'contradictions', 'stale_text']);
    expect(r.by_check).toEqual({ 'Missing sections': 0, 'Past deadline': 1, Contradiction: 0, 'Stale text': 0 });
  });
});

describe('parsers', () => {
  test('deadlines: formats read, ambiguity and several dates unreadable', () => {
    expect(parseDeadline('March 31, 2027')).toEqual({ kind: 'date', date: '2027-03-31' });
    expect(parseDeadline('1st December 2026')).toEqual({ kind: 'date', date: '2026-12-01' });
    expect(parseDeadline('August 13 2026')).toEqual({ kind: 'date', date: '2026-08-13' });
    expect(parseDeadline('31/03/2027')).toEqual({ kind: 'date', date: '2027-03-31' });
    expect(parseDeadline('09/09/2026')).toEqual({ kind: 'date', date: '2026-09-09' });
    expect(parseDeadline('2026-07-15')).toEqual({ kind: 'date', date: '2026-07-15' });
    expect(parseDeadline('15 mars 2027')).toEqual({ kind: 'date', date: '2027-03-15' });
    expect(parseDeadline('Open until filled')).toEqual({ kind: 'rolling' });
    expect(parseDeadline(null)).toEqual({ kind: 'blank' });
    expect(parseDeadline('04/09/2026')).toEqual({ kind: 'unreadable' });
    expect(parseDeadline('March 2027')).toEqual({ kind: 'unreadable' });
    expect(parseDeadline('February 30, 2027')).toEqual({ kind: 'unreadable' });
    expect(parseDeadline('Intake 1: March 1, 2027; Intake 2: June 1, 2027')).toEqual({ kind: 'unreadable' });
  });

  test('money and percentages in card text', () => {
    expect(moneyIn('Up to $1.5M, $50K or $22,000; also 22 000 $')).toEqual([1500000, 50000, 22000]);
    expect(percentsIn('70% or 12,5 % or 40 per cent')).toEqual([70, 12.5, 40]);
  });

  test('stale years ignore ranges that reach this year', () => {
    expect(staleYearSentences('The 2025-2026 intake is open. Deadline was May 2024.', 2026))
      .toEqual([{ year: 2024, sentence: 'Deadline was May 2024.' }]);
  });

  test('plain text keeps block breaks and decodes entities', () => {
    expect(plainText('<p>A&amp;B</p><ul><li>one</li><li>two</li></ul>')).toBe('A&B\none\ntwo');
  });
});

describe('find', () => {
  test('no cap: every hit, one row each, with section and snippet', async () => {
    grants = Array.from({ length: 30 }, (_, i) => grant(i + 1, {
      field_content: { ...FULL_CARD, eligible_expenses_2: '<p>Covers 70% of wages.</p>' }
    }));
    const r = await buildModeResult({ mode: 'find', phrase: '70%' });
    expect(r.total_hits).toBe(30);
    expect(r.total_grants).toBe(30);
    expect(r.rows).toHaveLength(30);
    expect(r.rows[0]).toMatchObject({ id: 1, section: 'Eligible expenses', snippet: 'Covers 70% of wages.' });
  });

  test('number and word edges: 70% is not in 170%, 70 is not in 700 or 7.70', () => {
    expect(findPhrase('covers 170% and 700 and 7.70', '70')).toEqual([]);
    expect(findPhrase('pays 170%', '70%')).toEqual([]);
    expect(findPhrase('pays 70%, then (70 %) and 70%.', '70%')).toHaveLength(2);
    expect(findPhrase('Stackable funding', 'stack')).toEqual([]);
    expect(findPhrase('Montréal firms', 'montreal')).toHaveLength(1);
  });

  test('matches the grant name, and long text gets a cut snippet', async () => {
    const long = `${'word '.repeat(40)}stackable ${'more '.repeat(40)}`;
    grants = [grant(1, { grant_name: 'Stackable Fund', field_content: { ...FULL_CARD, program_details_2: long } })];
    const r = await buildModeResult({ mode: 'find', phrase: 'stackable' });
    expect(r.rows.map(x => x.section)).toEqual(['Grant name', 'Program details']);
    expect(r.rows[1].snippet).toMatch(/^….*stackable.*…$/);
    expect(r.rows[1].snippet.length).toBeLessThan(140);
  });

  test('no phrase is an error', async () => {
    expect(await buildModeResult({ mode: 'find' })).toMatchObject({ success: false });
  });
});

describe('tags', () => {
  test('one grant by id: tags in plain words', async () => {
    grants = [grant(7, {
      status: 'inactive',
      grant_type: 'Hiring, Loan',
      eligibility_criteria: { size: { revenue_max: 2000000, employee_max: null }, stage: { stage_required: [] }, extraction_confidence: 'medium', extraction_notes: 'Thin card' },
      genre_scores: { scores: { 'Grant Type': { Hiring: 3, Training: 0 } } },
      boost_attributes: { rolling_intake: true, covers_capex: 'covered', stackable_funding: false }
    })];
    const r = await buildModeResult({ mode: 'tags', query: '7' });
    expect(r.grant).toMatchObject({
      id: 7, status: 'inactive', grant_types: ['Hiring', 'Loan'],
      eligibility_tags: ['Size — Revenue maximum: 2000000'],
      tagging_confidence: 'medium', tagging_notes: 'Thin card',
      top_genres: ['Hiring (Grant Type): 3'],
      boost_tags: ['Rolling intake', 'Covers capex: covered']
    });
  });

  test('a vague name returns candidates, not a guess', async () => {
    grants = [grant(1, { grant_name: 'Youth Hiring Grant' }), grant(2, { grant_name: 'Youth Training Grant' })];
    const r = await buildModeResult({ mode: 'tags', query: 'youth' });
    expect(r.grant).toBeNull();
    expect(r.candidates.map(c => c.id)).toEqual([1, 2]);
  });

  test('lists: no industry tags, empty eligibility tags, low confidence', async () => {
    grants = [
      grant(1),
      grant(2, { industries: [] }),
      grant(3, { eligibility_criteria: null }),
      grant(4, { eligibility_criteria: { size: { revenue_max: null }, stage: { stage_required: [] }, extracted_at: '2026-07-01' } }),
      grant(5, { eligibility_criteria: { size: { revenue_max: 1 }, extraction_confidence: 'low', extraction_notes: 'Minimal criteria' } })
    ];
    const r = await buildModeResult({ mode: 'tags' });
    expect(r.rows.map(x => [x.id, x.problem])).toEqual([
      [2, 'No industry tags'],
      [3, 'No eligibility tags'],
      [4, 'Eligibility tags are all empty'],
      [5, 'Tagging confidence is low: Minimal criteria']
    ]);
    expect(r.by_check).toEqual({ no_industry_tags: 1, empty_eligibility_tags: 2, low_confidence: 1 });
    expect(eligibilityTagsEmpty({ industry: { restriction_level: 'agnostic' } })).toBe(false);
  });
});

describe('compare', () => {
  test('one grant: both sides, the link, no verdict', async () => {
    grants = [grant(9, { status: 'archived', gg1_id: '35', gg1_name: 'Grant 9 ', gg1_active: true, gg1_accepting: true, gg1_deadline: 'Deadline\n\n  Open until filled' })];
    const r = await buildModeResult({ mode: 'compare', query: 'https://admin.getgranted.ai/grants/9' });
    expect(r.grant).toEqual({
      gg3: { id: 9, name: 'Grant 9', status: 'archived', deadline: 'Open Until Filled', links: { app: 'https://app.getgranted.ai/grants/9', admin: 'https://admin.getgranted.ai/grants/9' } },
      gg1: { id: '35', name: 'Grant 9', status: 'active', accepting: 'yes', deadline: 'Open until filled' },
      link: 'Matched by exact name',
      statuses_differ: true
    });
  });

  test('an unlinked grant says why', async () => {
    grants = [grant(9)];
    unmatched = [{ side: 'gg3', grant_id: '9', reason: 'ambiguous' }];
    const r = await buildModeResult({ mode: 'compare', query: '9' });
    expect(r.grant.gg1).toBeNull();
    expect(r.grant.link).toMatch(/Several GG1 grants/);
  });

  test('lists: statuses differ, GG1-only, active GG3 with no GG1 record', async () => {
    grants = [
      grant(1, { gg1_id: '10', gg1_active: true }),
      grant(2, { status: 'inactive', gg1_id: '11', gg1_active: true }),
      grant(3, { gg1_id: '12', gg1_active: false }),
      grant(4),
      grant(5, { status: 'archived' })
    ];
    gg1Only = [{ grant_id: '99', grant_name: 'Old GG1 Grant', is_active: true, currently_accepting: false, deadline: null, reason: 'no_counterpart' }];
    const r = await buildModeResult({ mode: 'compare' });
    expect(r.rows.map(x => [x.list, x.gg3_id ?? x.gg1_id])).toEqual([
      ['Statuses differ', 2], ['Statuses differ', 3],
      ['Active in GG3, no GG1 record', 4],
      ['Only in GG1', '99']
    ]);
    expect(r.by_list).toEqual({ 'Statuses differ': 2, 'Only in GG1': 1, 'Active in GG3, no GG1 record': 1 });
    expect(r.notes.join(' ')).toMatch(/No verdict/);
  });
});

describe('results sheet', () => {
  const rowsOf = (n) => Array.from({ length: n }, (_, i) => grant(i + 1, { field_content: { ...FULL_CARD, eligible_expenses_2: '70%' } }));

  test(`${SHEET_THRESHOLD} rows come back inline, no sheet`, async () => {
    grants = rowsOf(SHEET_THRESHOLD);
    const r = await runMode({ mode: 'find', phrase: '70%' }, { userId: 4, now: NOW });
    expect(writeResultSheet).not.toHaveBeenCalled();
    expect(r.rows).toHaveLength(SHEET_THRESHOLD);
    expect(r.sheet).toBeUndefined();
    expect(r.columns).toBeUndefined();
  });

  test('over the threshold: a new sheet as the asker, first 10 rows back', async () => {
    grants = rowsOf(SHEET_THRESHOLD + 1);
    const r = await runMode({ mode: 'find', phrase: '70%', regions: ['BC'] }, { userId: 4, now: NOW });
    expect(writeResultSheet).toHaveBeenCalledTimes(1);
    const [userId, content] = writeResultSheet.mock.calls[0];
    expect(userId).toBe(4);
    expect(content.title).toBe('Oracle – Cards containing "70%" – 2026-09-29');
    expect(content.about).toEqual(expect.arrayContaining([
      ['Filters', 'Status: active; Regions: British Columbia (grants open to All of Canada included)'],
      ['Data as of', '2026-09-29 12:00 UTC'],
      ['Rows', '11']
    ]));
    expect(content.tables[0].rows).toHaveLength(11);
    expect(content.tables[0].columns.filter(c => c.type === 'link').map(c => c.key)).toEqual(['app_link', 'admin_link']);
    expect(r.sheet).toEqual({ url: 'https://docs.google.com/spreadsheets/d/abc', title: content.title, id: 'abc' });
    expect(r.rows).toHaveLength(SHEET_THRESHOLD);
    expect(r.total_rows).toBe(11);
  });

  test('a long unreadable-deadlines list also triggers the sheet, as its own tab', async () => {
    grants = Array.from({ length: 12 }, (_, i) => grant(i + 1, { deadline: 'Spring' }));
    const r = await runMode({ mode: 'check', checks: ['past_deadlines'] }, { userId: 4, now: NOW });
    const { tables } = writeResultSheet.mock.calls[0][1];
    expect(tables.map(t => [t.title, t.rows.length])).toEqual([['Results', 0], ["Deadlines can't be read", 12]]);
    expect(r.unreadable_deadlines).toHaveLength(SHEET_THRESHOLD);
    expect(r.unreadable_deadlines_total).toBe(12);
  });

  test('a sheet that cannot be written still answers inline, with the reason', async () => {
    grants = rowsOf(SHEET_THRESHOLD + 1);
    writeResultSheet.mockRejectedValueOnce(Object.assign(new Error('403'), { userMessage: 'Google Sheets access not granted.' }));
    const r = await runMode({ mode: 'find', phrase: '70%' }, { userId: 4, now: NOW });
    expect(r.success).toBe(true);
    expect(r.sheet).toBeNull();
    expect(r.sheet_error).toBe('Google Sheets access not granted.');
    expect(r.rows).toHaveLength(SHEET_THRESHOLD);
  });

  test('counts reports over 10 groups go to a sheet too', async () => {
    vocabulary = 100;
    grants = [grant(1, { industries: Array.from({ length: 12 }, (_, i) => `Industry ${i}`) })];
    const r = await runMode({ mode: 'report', group_by: ['industry'] }, { userId: 4, now: NOW });
    expect(writeResultSheet).toHaveBeenCalledTimes(1);
    expect(r.total_rows).toBe(12);
    expect(r.rows).toHaveLength(SHEET_THRESHOLD);
  });

  test('a single-grant result never makes a sheet', async () => {
    grants = [grant(1)];
    await runMode({ mode: 'tags', query: '1' }, { userId: 4, now: NOW });
    expect(writeResultSheet).not.toHaveBeenCalled();
  });
});

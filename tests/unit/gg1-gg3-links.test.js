/**
 * GG1 ↔ GG3 links by exact normalized name
 *
 * buildLinks is pure and tested on fixtures: a link needs exactly one record on
 * each side with the same match key; the reconciliation normalization (accents,
 * [brackets], punctuation) applies; names that differ by a stream number never
 * link, even when the number sits in dropped brackets; two or more candidates
 * put every record under that name on both sides into unmatched as ambiguous;
 * a name on one side only is no_counterpart. The rebuild's SQL is recorded, not
 * run: both tables replaced inside one transaction.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gg1-gg3-links.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let tables = { grants: [], gg3_grants: [] };
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text) => {
    sent.push({ text: text.replace(/\s+/g, ' ').trim(), inTx: false });
    if (/FROM grants\b/.test(text)) return { rows: tables.grants };
    if (/FROM gg3_grants\b/.test(text)) return { rows: tables.gg3_grants };
    return { rows: [] };
  },
  transaction: async (callback) => {
    sent.push({ text: 'BEGIN', inTx: true });
    const client = {
      query: async (text, params = []) => {
        sent.push({ text: text.replace(/\s+/g, ' ').trim(), params, inTx: true });
        return { rows: [] };
      }
    };
    const result = await callback(client);
    sent.push({ text: 'COMMIT', inTx: true });
    return result;
  }
}));

const { buildLinks, normalizeGrantName, streamTags, rebuildGg1Gg3Links } = await import('../../src/services/gg1-gg3-links.js');

let nextId = 1;
const gg1 = (name, status = 'active') => ({ id: String(100 + nextId++), name, status });
const gg3 = (name, status = 'active') => ({ id: 900 + nextId++, name, status });
const linkedPairs = ({ links }) => links.map(l => [l.gg1_id, l.gg3_id]);
const unmatchedOf = ({ unmatched }, row) => unmatched.find(u => u.grant_id === String(row.id));

beforeEach(() => {
  sent.length = 0;
  tables = { grants: [], gg3_grants: [] };
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('normalization', () => {
  test('the reconciliation rule: accents, [brackets], punctuation and dashes, case, spacing', () => {
    expect(normalizeGrantName('  ECO Canada – Science Horizons Internship Program [Waitlist] ')).toBe('eco canada science horizons internship program');
    expect(normalizeGrantName("Programme d’incitation à l’emploi des jeunes de l’Alberta")).toBe('programme d incitation a l emploi des jeunes de l alberta');
    expect(normalizeGrantName('Employer Training Grant (ETG)')).toBe('employer training grant etg');
    expect(normalizeGrantName('[Coming Soon]')).toBe('');
    expect(normalizeGrantName(null)).toBe('');
  });

  test('stream tags are read before brackets are dropped', () => {
    expect(streamTags('Green Freight Program [Stream 2]')).toEqual(['stream 2']);
    expect(streamTags('ESSOR - Stream 1B')).toEqual(['stream 1b']);
    expect(streamTags('Enabling Accessibility Fund - Small Projects Component')).toEqual([]);
    expect(streamTags('Creative Export Canada - Export-Ready Stream')).toEqual([]);
  });
});

describe('linking', () => {
  test('exact match → one link', () => {
    const a = gg1('Employer Training Grant (ETG)');
    const b = gg3('Employer Training Grant (ETG)');
    const r = buildLinks([a], [b]);
    expect(linkedPairs(r)).toEqual([[a.id, b.id]]);
    expect(r.links[0].normalized_name).toBe('employer training grant etg');
    expect(r.unmatched).toEqual([]);
  });

  test('accent, bracket and punctuation differences still link', () => {
    const pairs = [
      [gg1("Programme d'incitation a l'emploi"), gg3('Programme d’incitation à l’emploi')],
      [gg1('ECO Canada - Science Horizons'), gg3('ECO Canada – Science Horizons [Waitlist]')],
      [gg1('R&D Partnership Fund: EV'), gg3('R&D Partnership Fund – EV')]
    ];
    const r = buildLinks(pairs.map(p => p[0]), pairs.map(p => p[1]));
    expect(linkedPairs(r)).toEqual(pairs.map(([a, b]) => [a.id, b.id]));
  });

  test('exact means exact: "B.C." and "BC" do not link', () => {
    const r = buildLinks([gg1('B.C. Agri-Business Planning Program')], [gg3('BC Agri Business Planning Program')]);
    expect(r.links).toEqual([]);
    expect(r.unmatched.map(u => u.reason)).toEqual(['no_counterpart', 'no_counterpart']);
  });
});

describe('stream guard', () => {
  test('Stream 1 never links to Stream 2', () => {
    const r = buildLinks([gg1('Green Freight Program - Stream 1')], [gg3('Green Freight Program - Stream 2')]);
    expect(r.links).toEqual([]);
  });

  test('streams in dropped brackets still keep grants apart', () => {
    expect(normalizeGrantName('Green Freight Program [Stream 1]')).toBe(normalizeGrantName('Green Freight Program [Stream 2]'));
    const r = buildLinks([gg1('Green Freight Program [Stream 1]')], [gg3('Green Freight Program [Stream 2]')]);
    expect(r.links).toEqual([]);
  });

  test('a stream on one side only never links to the plain name', () => {
    const r = buildLinks([gg1('Green Freight Program')], [gg3('Green Freight Program [Stream 1]')]);
    expect(r.links).toEqual([]);
  });

  test('lettered streams 1B vs 1C stay apart; the same stream links', () => {
    const b1 = gg1('ESSOR - Stream 1B');
    const c1 = gg1('ESSOR - Stream 1C');
    const b3 = gg3('ESSOR – Stream 1B');
    const r = buildLinks([b1, c1], [b3]);
    expect(linkedPairs(r)).toEqual([[b1.id, b3.id]]);
    expect(unmatchedOf(r, c1)).toMatchObject({ side: 'gg1', reason: 'no_counterpart' });
  });
});

describe('unmatched', () => {
  test('two GG3 records with one GG1 name → all three ambiguous, no link', () => {
    const name = 'Innovative Clean Energy Fund (ICE) -Call for Innovation and Partnerships';
    const a = gg1(name);
    const b1 = gg3(name);
    const b2 = gg3(name, 'inactive');
    const r = buildLinks([a], [b1, b2]);
    expect(r.links).toEqual([]);
    expect(r.unmatched).toHaveLength(3);
    expect(r.unmatched.every(u => u.reason === 'ambiguous')).toBe(true);
    expect(unmatchedOf(r, b2)).toMatchObject({ side: 'gg3', status: 'inactive', normalized_name: normalizeGrantName(name) });
  });

  test('two GG1 records with one GG3 name → ambiguous on both sides', () => {
    const r = buildLinks([gg1('Ontario Job Grant'), gg1('Ontario Job Grant', 'inactive')], [gg3('Ontario Job Grant')]);
    expect(r.links).toEqual([]);
    expect(r.unmatched.map(u => [u.side, u.reason]).sort()).toEqual([
      ['gg1', 'ambiguous'], ['gg1', 'ambiguous'], ['gg3', 'ambiguous']
    ]);
  });

  test('no counterpart on each side', () => {
    const onlyGg1 = gg1('Zensurance Small Business Grant', 'inactive');
    const onlyGg3 = gg3('Site Readiness Program');
    const r = buildLinks([onlyGg1], [onlyGg3]);
    expect(r.links).toEqual([]);
    expect(unmatchedOf(r, onlyGg1)).toMatchObject({ side: 'gg1', reason: 'no_counterpart', status: 'inactive', name: 'Zensurance Small Business Grant' });
    expect(unmatchedOf(r, onlyGg3)).toMatchObject({ side: 'gg3', reason: 'no_counterpart', status: 'active' });
  });

  test('French-named GG3 record with no GG1 twin → GG3 no_counterpart, status kept', () => {
    const fr = gg3("Initiative régionale de réponse aux tarifs douaniers (RTRI) -Sud de l’Ontario", 'hide');
    const en = gg1('Regional Tariff Response Initiative - Southern Ontario');
    const r = buildLinks([en], [fr]);
    expect(r.links).toEqual([]);
    expect(unmatchedOf(r, fr)).toMatchObject({
      side: 'gg3', reason: 'no_counterpart', status: 'hide',
      normalized_name: 'initiative regionale de reponse aux tarifs douaniers rtri sud de l ontario'
    });
  });

  test('a name that is only brackets never links', () => {
    const r = buildLinks([gg1('[Coming Soon]')], [gg3('[Coming Soon]')]);
    expect(r.links).toEqual([]);
    expect(r.unmatched.map(u => u.reason)).toEqual(['no_counterpart', 'no_counterpart']);
  });
});

test('one-to-one: across a mixed set no id is linked twice, and every record lands once', () => {
  const g1 = [gg1('A Grant'), gg1('B Grant'), gg1('C Grant'), gg1('C Grant'), gg1('D - Stream 1'), gg1('E Grant')];
  const g3 = [gg3('A Grant'), gg3('b grant'), gg3('C Grant'), gg3('D - Stream 2'), gg3('F Grant')];
  const r = buildLinks(g1, g3);
  const gg1Ids = r.links.map(l => l.gg1_id);
  const gg3Ids = r.links.map(l => l.gg3_id);
  expect(new Set(gg1Ids).size).toBe(gg1Ids.length);
  expect(new Set(gg3Ids).size).toBe(gg3Ids.length);
  expect(r.links).toHaveLength(2);
  const seen = [...gg1Ids.map(id => `gg1:${id}`), ...gg3Ids.map(id => `gg3:${id}`), ...r.unmatched.map(u => `${u.side}:${u.grant_id}`)];
  expect(seen.sort()).toEqual([...g1.map(x => `gg1:${x.id}`), ...g3.map(x => `gg3:${x.id}`)].sort());
});

test('rebuild: reads both copies, replaces both tables in one transaction', async () => {
  tables = {
    grants: [
      { grant_id: '571', grant_name: 'Employer Training Grant (ETG)', is_active: true },
      { grant_id: '4931', grant_name: 'Zensurance Small Business Grant', is_active: false }
    ],
    gg3_grants: [{ id: 1314, grant_name: 'Employer Training Grant (ETG)', status: 'active' }]
  };
  const counts = await rebuildGg1Gg3Links();
  expect(counts).toEqual({ linked: 1, ambiguous: 0, gg1_only: 1, gg3_only: 0 });

  const tx = sent.filter(s => s.inTx).map(s => s.text);
  expect(tx[0]).toBe('BEGIN');
  expect(tx[1]).toBe('DELETE FROM gg1_gg3_links');
  expect(tx[2]).toBe('DELETE FROM gg1_gg3_unmatched');
  expect(tx[3]).toMatch(/^INSERT INTO gg1_gg3_links/);
  expect(tx[4]).toMatch(/^INSERT INTO gg1_gg3_unmatched/);
  expect(tx.at(-1)).toBe('COMMIT');

  const [linkInsert, unmatchedInsert] = sent.filter(s => /^INSERT/.test(s.text));
  expect(JSON.parse(linkInsert.params[0])).toEqual([{ gg1_id: '571', gg3_id: 1314, normalized_name: 'employer training grant etg' }]);
  expect(JSON.parse(unmatchedInsert.params[0])).toEqual([{
    side: 'gg1', grant_id: '4931', name: 'Zensurance Small Business Grant', status: 'inactive',
    normalized_name: 'zensurance small business grant', reason: 'no_counterpart'
  }]);
});

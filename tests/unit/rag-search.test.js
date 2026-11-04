/**
 * Granted Files RAG — search (src/services/rag/search.js, store.js searchChunks /
 * scannedCandidates) and Oracle's search_granted_files tool
 * (src/tools/granted-files-search.js).
 *
 * Filters reaching the SQL, grouping and snippet caps, the Old Files label and
 * boost, scanned name-only files, empty results, rerank on and off, the asker
 * access filter (fail closed), and log lines that carry no query, names or
 * snippets. Voyage, Drive and the database are stand-ins; no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-search.test.js
 */

import { jest } from '@jest/globals';

const query = jest.fn(async () => ({ rows: [] }));
jest.unstable_mockModule('../../src/database/connection.js', () => ({ query, transaction: jest.fn(), getPool: jest.fn() }));

const store = await import('../../src/services/rag/store.js');
const { searchGrantedFiles, groupByFile, trimResults, boosted, labelFor, snippet, terms, DEFAULTS } = await import('../../src/services/rag/search.js');
const { runGrantedFilesSearch, accessChecker } = await import('../../src/tools/granted-files-search.js');

const chunk = (file_id, score, over = {}) => ({
  file_id, name: `${file_id}.pdf`, path: 'Clients/Acme/ETG/2025', area: 'Clients', client: 'Acme', program: 'ETG', year: 2025,
  mime: 'application/pdf', locator: 'p. 1', text: `chunk text for ${file_id}`, score, ...over
});
const deps = (chunks = [], scanned = [], rerankScores = null) => ({
  embedQuery: jest.fn(async () => ({ vector: new Array(512).fill(0.1), tokens: 7 })),
  searchChunks: jest.fn(async () => chunks),
  scannedCandidates: jest.fn(async () => scanned),
  rerank: jest.fn(async (_q, docs) => ({
    ranked: docs.map((_, index) => ({ index, score: rerankScores ? rerankScores[index] : 0.9 - index * 0.01 })).sort((a, b) => b.score - a.score),
    tokens: 100
  }))
});

describe('store SQL', () => {
  beforeEach(() => query.mockClear());

  test('searchChunks: only indexed canonical files; filters become parameters, never text', async () => {
    await store.searchChunks(new Array(512).fill(0), { k: 30, area: 'Clients', client: "Acme%_'", program: 'ETG', yearFrom: 2020, yearTo: 2024 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/f\.status = 'indexed' AND f\.duplicate_of IS NULL/);
    expect(sql).toMatch(/c\.area = \$3/);
    expect(sql).toMatch(/c\.year >= \$4/);
    expect(sql).toMatch(/c\.year <= \$5/);
    expect(sql).toMatch(/\(f\.client ILIKE \$6 OR f\.path ILIKE \$6\)/);  // Active Clients/<client> files carry no client tag
    expect(sql).toMatch(/f\.program ILIKE \$7/);
    expect(sql).not.toContain('Acme');
    expect(params.slice(1)).toEqual([30, 'Clients', 2020, 2024, "%Acme\\%\\_'%", '%ETG%']);
  });

  test('scannedCandidates: scanned canonical files only, OR of cleaned words; nothing to match → no query', async () => {
    await store.scannedCandidates(['etg', 'trades', "o'brien"], { limit: 10, area: 'Old Files' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/f\.status = 'scanned' AND f\.duplicate_of IS NULL/);
    expect(sql).toMatch(/f\.area = \$3/);
    expect(params).toEqual(['etg | trades | obrien', 10, 'Old Files']);
    query.mockClear();
    expect(await store.scannedCandidates([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ranking helpers', () => {
  test('Old Files label, with and without a year; scanned label', () => {
    expect(labelFor({ area: 'Old Files', year: 2018 })).toBe('older material (2018)');
    expect(labelFor({ area: 'Old Files', year: null })).toBe('older material');
    expect(labelFor({ area: 'Clients', year: 2025 })).toBeNull();
    expect(labelFor({ area: 'Clients', scanned: true })).toBe('scanned file — name only');
  });

  test('boost reorders close calls only', () => {
    const recent = boosted(0.80, { area: 'Clients', year: 2026 });
    const old = boosted(0.82, { area: 'Old Files', year: 2017 });
    expect(recent).toBeGreaterThan(old);                                   // 0.02 apart: newer wins
    expect(boosted(0.70, { area: 'Clients', year: 2026 })).toBeLessThan(boosted(0.80, { area: 'Old Files', year: 2017 }));  // 0.10 apart: relevance wins
  });

  test('snippets are capped and cut at a word', () => {
    const s = snippet('word '.repeat(200), 300);
    expect(s.length).toBeLessThanOrEqual(301);
    expect(s.endsWith('…')).toBe(true);
    expect(s).not.toMatch(/wor…$/);
  });

  test('query words drop stop words and short words', () => {
    expect(terms('Show me a strong ETG business case for a trades company')).toEqual(['etg', 'business', 'case', 'trades', 'company']);
  });

  test('grouping: files in order of best chunk, 2 snippets per file, max files; trim by chunk budget', () => {
    const hits = [chunk('a', 0.9), chunk('b', 0.8), chunk('a', 0.7, { locator: 'p. 4' }), chunk('a', 0.6, { locator: 'p. 9' }), chunk('c', 0.5)]
      .map(h => ({ ...h, final: h.score }));
    const files = groupByFile(hits, { ...DEFAULTS, maxFiles: 2 });
    expect(files.map(f => f.file_id)).toEqual(['a', 'b']);
    expect(files[0].snippets).toHaveLength(2);
    expect(files[0].locators).toEqual(['p. 1', 'p. 4', 'p. 9']);
    expect(files[0].link).toBe('https://drive.google.com/open?id=a');
    expect(trimResults(files, { limit: 3 }).map(f => f.file_id)).toEqual(['a']);  // a used 3 chunks
    expect(trimResults(files, { limit: 4 })[0]).not.toHaveProperty('chunks');
  });
});

describe('searchGrantedFiles', () => {
  test('rerank on: reranked order, floor applied, scanned file kept only above its threshold', async () => {
    const d = deps([chunk('a', 0.6), chunk('b', 0.55), chunk('c', 0.5)],
      [{ file_id: 's1', name: 'ETG trades scan.pdf', path: 'Clients/Acme', area: 'Clients', year: 2024 },
        { file_id: 's2', name: 'Unrelated scan.pdf', path: 'Clients/Zed', area: 'Clients', year: 2024 }],
      [0.55, 0.9, 0.45, 0.6, 0.4]);  // a, b, c, s1, s2
    const { files, stats } = await searchGrantedFiles('ETG trades', {}, d);
    expect(files.map(f => f.file_id)).toEqual(['b', 's1', 'a']);  // c below the rerank floor (0.5); s2 below the scanned threshold
    expect(files[1].label).toBe('scanned file — name only');
    expect(files[1].snippets).toEqual([]);
    expect(stats).toMatchObject({ candidates: 3, scanned_candidates: 2, rerank: true, tokens: 107 });
  });

  test('rerank off: cosine floor; scanned file needs most of the query words in its name or folder', async () => {
    const d = deps([chunk('a', 0.6), chunk('b', 0.5)],
      [{ file_id: 's1', name: 'ETG trades plan.pdf', path: 'Clients/Acme', area: 'Clients', year: 2024 },
        { file_id: 's2', name: 'ETG misc.pdf', path: 'Clients/Zed', area: 'Clients', year: 2024 }]);
    const { files } = await searchGrantedFiles('ETG trades plan', { rerank: false }, d);
    expect(files.map(f => f.file_id)).toEqual(['a', 's1']);
    expect(d.rerank).not.toHaveBeenCalled();
  });

  test('Old Files results are labelled and lose close calls to newer files', async () => {
    const d = deps([chunk('old', 0.8, { area: 'Old Files', year: 2017 }), chunk('new', 0.79, { year: 2026 })], [], [0.80, 0.79]);
    const { files } = await searchGrantedFiles('x y', {}, d);
    expect(files.map(f => [f.file_id, f.label])).toEqual([['new', null], ['old', 'older material (2017)']]);
  });

  test('filters are passed through to both queries', async () => {
    const d = deps();
    await searchGrantedFiles('budget', { area: 'Clients', client: 'Norland', yearFrom: 2022 }, d);
    expect(d.searchChunks).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ k: 30, area: 'Clients', client: 'Norland', yearFrom: 2022 }));
    expect(d.scannedCandidates).toHaveBeenCalledWith(['budget'], expect.objectContaining({ area: 'Clients', client: 'Norland', yearFrom: 2022 }));
  });

  test('weak matches only → nothing (the floor, not padding)', async () => {
    const d = deps([chunk('a', 0.45), chunk('b', 0.43)], [], [0.44, 0.41]);
    expect((await searchGrantedFiles('quantum satellites in Antarctica', {}, d)).files).toEqual([]);
    expect((await searchGrantedFiles('quantum satellites in Antarctica', { rerank: false }, deps([chunk('a', 0.50)]))).files).toEqual([]);
  });

  test('nothing relevant → no files, no rerank call', async () => {
    const d = deps();
    const { files } = await searchGrantedFiles('quantum satellites in Antarctica', {}, d);
    expect(files).toEqual([]);
    expect(d.rerank).not.toHaveBeenCalled();
  });
});

describe('search_granted_files tool', () => {
  const found = (ids) => ({ files: ids.map(id => ({ file_id: id, name: `Secret Name ${id}.pdf`, link: `https://drive.google.com/open?id=${id}`,
    path: 'Clients/Acme', area: 'Clients', year: 2025, label: null, locators: ['p. 1'], snippets: [{ locator: 'p. 1', text: `snippet text ${id}` }], chunks: 1, score: 0.9 })),
  stats: { candidates: 30, ms_sql: 120, tokens: 50, rerank: true } });

  test('files the asker cannot open are dropped and only counted; logs carry no content', async () => {
    const lines = [];
    const out = await runGrantedFilesSearch({ query: 'strong ETG business case', client: 'Acme' }, { userEmail: 'nat@granted.ca' }, {
      search: async () => found(['a', 'b', 'c']), canOpen: async (id) => id !== 'b', log: (l) => lines.push(l)
    });
    expect(out).toMatchObject({ success: true, hidden_no_access: 1, note: null });
    expect(out.results.map(r => r.file_id)).toEqual(['a', 'c']);
    const log = lines.join('\n');
    expect(log).toMatch(/"query_len":24/);
    expect(log).toMatch(/"filters":\["client"\]/);
    expect(log).not.toMatch(/ETG|Acme|Secret Name|snippet text/);
  });

  test('every candidate hidden → says so; nothing found → plain note', async () => {
    const hidden = await runGrantedFilesSearch({ query: 'x' }, { userEmail: 'a@granted.ca' }, { search: async () => found(['a']), canOpen: async () => false, log: () => {} });
    expect(hidden).toMatchObject({ success: true, results: [], hidden_no_access: 1, note: 'Nothing relevant that you have access to.' });
    const none = await runGrantedFilesSearch({ query: 'x' }, { userEmail: 'a@granted.ca' }, { search: async () => found([]), canOpen: async () => true, log: () => {} });
    expect(none.note).toBe('Nothing relevant found in Granted Files.');
  });

  test('fails closed: no asker, or Drive unreachable as the asker', async () => {
    const search = jest.fn(async () => found(['a']));
    expect(await runGrantedFilesSearch({ query: 'x' }, {}, { search, canOpen: async () => true, log: () => {} }))
      .toEqual({ success: false, error: 'Drive access unavailable' });
    expect(search).not.toHaveBeenCalled();
    const broken = accessChecker({ files: { get: async () => { throw Object.assign(new Error('unauthorized_client'), { response: { status: 401 } }); } } });
    expect(await runGrantedFilesSearch({ query: 'x' }, { userEmail: 'a@granted.ca' }, { search, canOpen: broken, log: () => {} }))
      .toEqual({ success: false, error: 'Drive access unavailable' });
  });

  test('access check: 403 and 404 mean no access', async () => {
    const drive = (status) => ({ files: { get: async () => { throw Object.assign(new Error('x'), { code: status }); } } });
    expect(await accessChecker(drive(404))('f')).toBe(false);
    expect(await accessChecker(drive(403))('f')).toBe(false);
    expect(await accessChecker({ files: { get: async () => ({ data: { id: 'f' } }) } })('f')).toBe(true);
  });

  test('input checks', async () => {
    const run = (input) => runGrantedFilesSearch(input, { userEmail: 'a@granted.ca' }, { search: async () => found([]), canOpen: async () => true, log: () => {} });
    expect(await run({})).toMatchObject({ success: false, error: 'query is required' });
    expect(await run({ query: 'x', area: 'HR' })).toMatchObject({ success: false });
    expect(await run({ query: 'x', year_from: 'soon' })).toMatchObject({ success: false, error: 'year_from must be a year' });
    expect(await run({ query: 'x', limit: 20 })).toMatchObject({ success: false, error: 'limit must be 1–8' });
    expect(await run({ query: 'y'.repeat(501) })).toMatchObject({ success: false });
  });
});

describe('registration', () => {
  test('Oracle has it, always loaded and never logged; the orchestrator and other agents do not', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { getToolsForAgent } = await import('../../src/tools/definitions.js');
    const { ORACLE_DEFERRED_TOOLS } = await import('../../src/claude/client.js');
    const { QUIET_TOOLS } = await import('../../src/tools/executor.js');
    expect(getToolsForAgent('internal-oracle').some(t => t.name === 'search_granted_files')).toBe(true);
    expect(ORACLE_DEFERRED_TOOLS).not.toContain('search_granted_files');
    expect(QUIET_TOOLS.has('search_granted_files')).toBe(true);
    for (const agent of ['orchestrator', 'etg-writer', 'canexport-writer', 'lead-gen', 'getgranted-ai']) {
      expect(getToolsForAgent(agent).some(t => t.name === 'search_granted_files')).toBe(false);
    }
  });
});

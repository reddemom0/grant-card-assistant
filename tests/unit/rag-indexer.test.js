/**
 * Granted Files RAG — bulk indexer (src/services/rag/indexer.js, drive-retry.js, voyage.js)
 *
 * Dedupe choice, resume and skip logic, the token ceiling, log lines that carry
 * no names, text or secrets, Drive retry, and the estimate. Drive, Voyage and the
 * database are stand-ins; no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-indexer.test.js
 */

import { jest } from '@jest/globals';
import {
  resolvePaths, inSubtrees, chooseCanonical, planRun, duplicateRow, TokenBudget, estimate,
  pickTrialClients, logLine, runIndex, MEAN_TOKENS
} from '../../src/services/rag/indexer.js';
import { withDriveRetry, isRetryable, createLimiter } from '../../src/services/rag/drive-retry.js';
import { embedDocuments, VoyageKeyError } from '../../src/services/rag/voyage.js';

const PDF = 'application/pdf';
const GDOC = 'application/vnd.google-apps.document';
const f = (id, path, over = {}) => ({ id, name: `${id}.pdf`, mimeType: PDF, md5Checksum: `md5-${id}`, modifiedTime: '2026-01-01T00:00:00Z', size: 1000, path: path.split('/').filter(Boolean), ...over });

describe('listing', () => {
  test('paths resolve from the parents chain; folders drop out', () => {
    const items = [
      { id: 'c', name: 'Clients', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOT'] },
      { id: 'a', name: 'Acme', mimeType: 'application/vnd.google-apps.folder', parents: ['c'] },
      { id: 'x', name: 'x.pdf', mimeType: PDF, parents: ['a'] },
      { id: 'y', name: 'y.pdf', mimeType: PDF, parents: ['ROOT'] }
    ];
    expect(resolvePaths(items)).toEqual([
      { id: 'x', name: 'x.pdf', mimeType: PDF, path: ['Clients', 'Acme'] },
      { id: 'y', name: 'y.pdf', mimeType: PDF, path: [] }
    ]);
  });

  test('subtree filter matches folder names loosely, by whole segments', () => {
    const files = [f('1', 'Programs/ETG'), f('2', 'Clients/Acme Ltd/ETG'), f('3', 'Clients/Acme Ltd Two'), f('4', 'Old Files/Programs')];
    expect(inSubtrees(files, ['programs', 'Clients/acme-ltd']).map(x => x.id)).toEqual(['1', '2']);
    expect(inSubtrees(files, [])).toHaveLength(4);
  });
});

describe('dedupe choice', () => {
  test('a specific area beats Old Files, even when older', () => {
    const group = [f('old', 'Old Files/Clients/Acme', { modifiedTime: '2026-06-01T00:00:00Z' }), f('live', 'Clients/Acme/ETG/2024', { modifiedTime: '2020-01-01T00:00:00Z' })];
    expect(chooseCanonical(group).id).toBe('live');
  });

  test('then the most recently modified, then the lowest ID', () => {
    expect(chooseCanonical([f('a', 'Programs/ETG', { modifiedTime: '2024-01-01T00:00:00Z' }), f('b', 'Clients/X', { modifiedTime: '2025-01-01T00:00:00Z' })]).id).toBe('b');
    expect(chooseCanonical([f('b', 'Programs/ETG'), f('a', 'Departments/Sales')]).id).toBe('a');
  });

  test('excluded copies are never canonical; they stay excluded', () => {
    const files = [f('hr', 'Departments/HR', { md5Checksum: 'm' }), f('ok', 'Old Files/Misc', { md5Checksum: 'm' })];
    const plan = planRun(files);
    expect(plan.find(p => p.file.id === 'ok').action).toBe('process');
    expect(plan.find(p => p.file.id === 'hr').action).toBe('process');  // prepare() records it as excluded
  });

  test('copies become duplicates of the chosen one', () => {
    const files = [f('a', 'Old Files/X', { md5Checksum: 'm' }), f('b', 'Clients/Acme', { md5Checksum: 'm' }), f('c', 'Programs/ETG', { md5Checksum: 'm', modifiedTime: '2027-01-01T00:00:00Z' })];
    const plan = planRun(files);
    expect(plan.map(p => [p.file.id, p.action, p.canonicalId])).toEqual([
      ['a', 'duplicate', 'c'], ['b', 'duplicate', 'c'], ['c', 'process', undefined]
    ]);
  });

  test('native Google files are never grouped', () => {
    const plan = planRun([f('g1', 'Clients/A', { mimeType: GDOC, md5Checksum: undefined }), f('g2', 'Clients/B', { mimeType: GDOC, md5Checksum: undefined })]);
    expect(plan.map(p => p.action)).toEqual(['process', 'process']);
  });

  test('a better copy than the one stored earlier is re-homed, not re-embedded', () => {
    const files = [f('old', 'Old Files/X', { md5Checksum: 'm' }), f('live', 'Clients/Acme', { md5Checksum: 'm' })];
    const existing = new Map([['old', { file_id: 'old', md5: 'm', name: 'old.pdf', path: 'Old Files/X', status: 'indexed', duplicate_of: null }]]);
    const plan = planRun(files, existing, new Map([['m', 'old']]));
    expect(plan.find(p => p.file.id === 'live')).toMatchObject({ action: 'rehome', previousId: 'old' });
    expect(plan.find(p => p.file.id === 'old')).toMatchObject({ action: 'duplicate', canonicalId: 'live' });
  });

  test('a stored canonical outside this listing is kept', () => {
    const plan = planRun([f('b', 'Clients/Acme', { md5Checksum: 'm' })], new Map(), new Map([['m', 'elsewhere']]));
    expect(plan[0]).toMatchObject({ action: 'duplicate', canonicalId: 'elsewhere' });
  });

  test('duplicate rows carry the canonical status and no chunks', () => {
    expect(duplicateRow(f('d', 'Old Files/Clients/Acme/2019'), 'c', 'scanned')).toMatchObject({
      file_id: 'd', duplicate_of: 'c', status: 'scanned', status_reason: 'duplicate', chunk_count: 0, area: 'Old Files', client: 'Acme', year: 2019
    });
  });
});

describe('resume', () => {
  const stored = (over = {}) => ({ file_id: '1', md5: 'md5-1', name: '1.pdf', path: 'Clients/Acme', modified_time: new Date('2026-01-01T00:00:00Z'), status: 'indexed', duplicate_of: null, ...over });

  test('unchanged files are skipped', () => {
    expect(planRun([f('1', 'Clients/Acme')], new Map([['1', stored()]]))[0].action).toBe('skip');
  });

  test('native files compare modifiedTime', () => {
    const g = f('1', 'Clients/Acme', { mimeType: GDOC, md5Checksum: undefined });
    expect(planRun([g], new Map([['1', stored({ md5: null })]]))[0].action).toBe('skip');
    expect(planRun([{ ...g, modifiedTime: '2026-02-01T00:00:00Z' }], new Map([['1', stored({ md5: null })]]))[0].action).toBe('process');
  });

  test('changed content is reprocessed', () => {
    expect(planRun([f('1', 'Clients/Acme', { md5Checksum: 'new' })], new Map([['1', stored()]]))[0].action).toBe('process');
  });

  test('a rename or move with the same content is a metadata update', () => {
    expect(planRun([f('1', 'Clients/Acme/ETG/2026')], new Map([['1', stored()]]))[0].action).toBe('move');
  });

  test('failed files are retried only with --resume', () => {
    const existing = new Map([['1', stored({ status: 'failed' })]]);
    expect(planRun([f('1', 'Clients/Acme')], existing)[0].action).toBe('skip');
    expect(planRun([f('1', 'Clients/Acme')], existing, new Map(), { resume: true })[0].action).toBe('process');
  });
});

describe('estimate', () => {
  test('counts and tokens from the measured means', () => {
    const plan = planRun([f('1', 'Clients/A'), f('2', 'Clients/B', { mimeType: GDOC, md5Checksum: undefined }), f('3', 'Clients/C', { mimeType: 'image/png', md5Checksum: undefined })]);
    const est = estimate(plan);
    expect(est.byAction).toEqual({ process: 3 });
    expect(est.byKind).toEqual({ pdf: 1, gdoc: 1 });
    expect(est.tokens).toBe(Math.round(MEAN_TOKENS.pdf + MEAN_TOKENS.gdoc));
    expect(est.usd).toBe(+(est.tokens / 1e6 * 0.06).toFixed(2));
  });
});

describe('trial clients', () => {
  test('picks across size bands and covers years', () => {
    const files = [];
    for (let c = 0; c < 40; c++) {
      const year = 2019 + (c % 8);
      for (let i = 0; i <= c; i++) files.push(f(`${c}-${i}`, `Clients/Client ${String(c).padStart(2, '0')}/ETG/${year}`));
    }
    files.push(f('ny', 'Clients/No Year Co/General'));
    const picked = pickTrialClients(files, 20);
    expect(picked).toHaveLength(20);
    expect(new Set(picked.map(p => p.name)).size).toBe(20);
    expect(picked.map(p => p.name)).not.toContain('No Year Co');
    expect(new Set(picked.flatMap(p => p.years))).toEqual(new Set([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]));
    expect(picked.some(p => p.files >= 30)).toBe(true);
    expect(picked.some(p => p.files <= 10)).toBe(true);
    expect(pickTrialClients(files, 20)).toEqual(picked);  // deterministic
  });
});

describe('log lines', () => {
  test('only whitelisted fields; never names, text, values or keys', () => {
    const line = logLine('file', {
      file_id: 'abc', status: 'indexed', chunks: 2, tokens: 900, ms: 12,
      name: 'Payroll-Jane Doe.pdf', text: 'SIN 046 454 286', private_key: '-----BEGIN PRIVATE KEY-----', path: 'Clients/Acme'
    });
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(['chunks', 'event', 'file_id', 'ms', 'status', 't', 'tokens']);
    expect(line).not.toMatch(/Jane|046|PRIVATE|Acme/);
  });
});

describe('runIndex', () => {
  const prepared = (id, chunkCount, { text = 'chunk text', status = 'indexed' } = {}) => ({
    row: { file_id: id, status, status_reason: null, token_count: chunkCount * 500, area: 'Clients', year: 2026, path: 'Clients/Acme', name: `${id}.pdf` },
    chunks: Array.from({ length: chunkCount }, (_, i) => ({ chunk_no: i, locator: null, text: `${text} ${i}`, token_count: 500 }))
  });
  const deps = (prepareMap, over = {}) => {
    const writes = [];
    const lines = [];
    return {
      writes, lines,
      prepare: async (file) => prepareMap[file.id],
      embed: async (texts) => ({ vectors: texts.map(() => new Array(512).fill(0.1)), tokens: texts.length * 500 }),
      store: {
        writeFile: async (row, chunks, vectors) => { writes.push({ id: row.file_id, status: row.status, chunks: chunks.length, vectors: vectors.length, duplicate_of: row.duplicate_of }); },
        rehome: async () => {}, updateMove: async () => {}
      },
      log: (l) => lines.push(l),
      ...over
    };
  };

  test('embeds, writes each file with its vectors, then writes duplicates', async () => {
    const files = [f('a', 'Clients/A', { md5Checksum: 'm' }), f('b', 'Old Files/A', { md5Checksum: 'm' }), f('c', 'Clients/C')];
    const d = deps({ a: prepared('a', 3), c: prepared('c', 2) });
    const stats = await runIndex(planRun(files), d, { concurrency: 2 });
    expect(stats).toMatchObject({ done: 2, chunks: 5, embedded_tokens: 2500, duplicates: 1, stopped: null });
    expect(d.writes.find(w => w.id === 'a')).toMatchObject({ chunks: 3, vectors: 3 });
    expect(d.writes.find(w => w.id === 'b')).toMatchObject({ chunks: 0, duplicate_of: 'a', status: 'indexed' });
  });

  test('the token ceiling stops cleanly; files already written stay written', async () => {
    const files = Array.from({ length: 10 }, (_, i) => f(`f${i}`, 'Clients/A'));
    const map = Object.fromEntries(files.map(x => [x.id, prepared(x.id, 100)]));  // 50k tokens each
    const d = deps(map);
    const stats = await runIndex(planRun(files), d, { budget: new TokenBudget(160000), concurrency: 1 });
    expect(stats.stopped).toBe('token ceiling');
    expect(stats.embedded_tokens).toBeLessThanOrEqual(160000);
    expect(d.writes.every(w => w.chunks === w.vectors)).toBe(true);
    expect(d.writes.length).toBeGreaterThan(0);
    expect(d.writes.length).toBeLessThan(10);
    expect(d.lines.at(-1)).toContain('"stopped":"token ceiling"');
  });

  test('--limit caps files processed; duplicates of unwritten files wait', async () => {
    const files = [f('a', 'Clients/A'), f('b', 'Clients/B', { md5Checksum: 'm' }), f('c', 'Old Files/B', { md5Checksum: 'm' })];
    const d = deps({ a: prepared('a', 1), b: prepared('b', 1) });
    const stats = await runIndex(planRun(files), d, { limit: 1 });
    expect(stats.done).toBe(1);
    expect(stats.duplicates).toBe(0);
  });

  test('a non-key embedding error fails that batch only; a rejected key stops the run', async () => {
    const files = [f('a', 'Clients/A'), f('b', 'Clients/B')];
    let calls = 0;
    const flaky = deps({ a: prepared('a', 128), b: prepared('b', 1) }, {  // a fills a batch on its own
      embed: async (texts) => { if (calls++ === 0) throw Object.assign(new Error('bad'), { statusCode: 400 }); return { vectors: texts.map(() => new Array(512).fill(0)), tokens: 1 }; }
    });
    const stats = await runIndex(planRun(files), flaky, { concurrency: 1 });
    expect(stats.byReason).toEqual({ 'embed:400': 1 });
    expect(flaky.writes.map(w => w.status)).toEqual(['failed', 'indexed']);

    const dead = deps({ a: prepared('a', 1) }, { embed: async () => { throw new VoyageKeyError(); } });
    await expect(runIndex(planRun([f('a', 'Clients/A')]), dead)).rejects.toThrow('value not shown');
  });

  test('logs never carry file text, names or redacted values', async () => {
    const d = deps({ a: prepared('a', 2, { text: 'Jane Doe SIN [REDACTED-SIN] api_key=sk-test' }) });
    await runIndex(planRun([f('a', 'Clients/Acme Payroll Co')]), d);
    const all = d.lines.join('\n');
    expect(all).not.toMatch(/Jane|REDACTED|sk-test|Acme|\.pdf/);
    expect(all).toContain('"file_id":"a"');
  });
});

describe('Drive retry', () => {
  const err = (status, reason) => Object.assign(new Error('x'), { response: { status, headers: {} }, errors: reason ? [{ reason }] : undefined });

  test('which errors are retried', () => {
    expect(isRetryable(err(403, 'userRateLimitExceeded'))).toBe(true);
    expect(isRetryable(err(403, 'insufficientFilePermissions'))).toBe(false);
    expect(isRetryable(err(404))).toBe(false);
    expect(isRetryable(err(429))).toBe(true);
    expect(isRetryable(err(503))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
  });

  test('backs off and succeeds; gives up on a plain 403', async () => {
    const waits = [];
    let n = 0;
    const ok = await withDriveRetry(async () => { if (n++ < 2) throw err(429); return 'ok'; }, { wait: async (ms) => waits.push(ms) });
    expect(ok).toBe('ok');
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
    await expect(withDriveRetry(async () => { throw err(403, 'forbidden'); }, { wait: async () => {} })).rejects.toThrow();
  });

  test('stops after the attempt limit', async () => {
    let n = 0;
    await expect(withDriveRetry(async () => { n++; throw err(500); }, { attempts: 3, wait: async () => {} })).rejects.toThrow();
    expect(n).toBe(3);
  });

  test('the limiter spaces calls at 4 per second', async () => {
    let clock = 0;
    const waits = [];
    const limit = createLimiter(4, { now: () => clock, wait: async (ms) => { waits.push(ms); } });
    await limit(); await limit(); await limit();
    expect(waits).toEqual([250, 500]);
  });
});

describe('Voyage wrapper', () => {
  test('sends voyage-3.5 at 512 dims as documents and returns measured tokens', async () => {
    const api = jest.fn(async (req) => ({ data: req.input.map((_, i) => ({ index: i, embedding: new Array(512).fill(i) })), usage: { totalTokens: 42 } }));
    const out = await embedDocuments(['a', 'b'], { api });
    expect(api).toHaveBeenCalledWith({ input: ['a', 'b'], model: 'voyage-3.5', inputType: 'document', outputDimension: 512 });
    expect(out.tokens).toBe(42);
    expect(out.vectors[1][0]).toBe(1);
  });

  test('a rejected key throws without the key; 429 retries', async () => {
    await expect(embedDocuments(['a'], { api: async () => { throw Object.assign(new Error('Unauthorized sk-secret'), { statusCode: 401 }); } }))
      .rejects.toThrow('Voyage key rejected (value not shown)');
    let n = 0;
    const out = await embedDocuments(['a'], {
      wait: async () => {},
      api: async () => { if (n++ === 0) throw Object.assign(new Error('rate'), { statusCode: 429 }); return { data: [{ index: 0, embedding: new Array(512).fill(0) }], usage: { totalTokens: 1 } }; }
    });
    expect(out.tokens).toBe(1);
  });
});

/**
 * Granted Files RAG — nightly updater (src/services/rag/nightly.js, changes.js)
 *
 * Each change type (new, edited, moved, renamed, trashed, into and out of an
 * excluded area, restored), folder moves and trashed folders, the duplicate
 * rehome, the token ceiling with resume, the baseline-only first run, the flag
 * gate, and log lines that carry no names or text. Drive, Voyage and the
 * database are stand-ins; no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-nightly.test.js
 */

import { jest } from '@jest/globals';
import { planNightly, collectChanges, runNightly, startRagNightly, countActions, SCHEDULE } from '../../src/services/rag/nightly.js';
import { readChanges } from '../../src/services/rag/changes.js';
import { prepareFile } from '../../src/services/rag/prepare.js';
import { GRANTED_FILES_DRIVE_ID as DRIVE, FOLDER_MIME } from '../../src/tools/google-drive.js';

const PDF = 'application/pdf';
const GDOC = 'application/vnd.google-apps.document';
const f = (id, path, over = {}) => ({ id, name: `${id}.pdf`, mimeType: PDF, md5Checksum: `md5-${id}`, modifiedTime: '2026-01-01T00:00:00Z', size: 1000, path: path.split('/').filter(Boolean), ...over });
const row = (file, over = {}) => ({
  file_id: file.id, md5: file.md5Checksum ?? null, name: file.name, path: file.path.join('/'), mime: file.mimeType,
  modified_time: new Date(file.modifiedTime), status: 'indexed', duplicate_of: null, ...over
});
const plan = ({ changed = [], gone = [], rows = [] }) => {
  const existing = new Map(rows.map(r => [r.file_id, r]));
  return planNightly({ changed, goneIds: new Set(gone), existing, groups: rows.filter(r => r.md5 && r.status !== 'removed') });
};
const actionOf = (p, id) => p.plan.find(x => x.file.id === id)?.action ?? (p.remove.includes(id) ? 'remove' : 'skip');

describe('planNightly — each change type', () => {
  test('new file → process', () => {
    expect(actionOf(plan({ changed: [f('n', 'Clients/Acme/CanExport/2026')] }), 'n')).toBe('process');
  });

  test('content edited (md5) → process; native doc edited (modifiedTime) → process', () => {
    const old = f('a', 'Clients/Acme/CanExport/2026');
    expect(actionOf(plan({ changed: [{ ...old, md5Checksum: 'md5-new' }], rows: [row(old)] }), 'a')).toBe('process');
    const doc = f('d', 'Programs/ETG', { mimeType: GDOC, md5Checksum: undefined, name: 'Notes' });
    expect(actionOf(plan({ changed: [{ ...doc, modifiedTime: '2026-11-04T09:00:00Z' }], rows: [row(doc)] }), 'd')).toBe('process');
    expect(actionOf(plan({ changed: [doc], rows: [row(doc)] }), 'd')).toBe('skip');
  });

  test('moved only → move; renamed only → move; neither re-embeds', () => {
    const a = f('a', 'Clients/Norland/CanExport/2026');
    const moved = plan({ changed: [{ ...a, path: ['Active Clients', 'Norland', 'CanExport', '2026'] }], rows: [row(a)] });
    expect(actionOf(moved, 'a')).toBe('move');
    expect(actionOf(plan({ changed: [{ ...a, name: 'Renamed.pdf' }], rows: [row(a)] }), 'a')).toBe('move');
  });

  test('trashed or deleted → remove (a file with no row is ignored)', () => {
    const a = f('a', 'Clients/Acme/CanExport/2026');
    const p = plan({ gone: ['a', 'never-indexed'], rows: [row(a)] });
    expect(p.remove).toEqual(['a']);
    expect(p.plan).toEqual([]);
  });

  test.each([
    ['Departments/LEADERSHIP/Strategy', 'a.pdf'],
    ['Pre-Call Briefings/2026', 'a.pdf'],
    ['Clients/Acme/General/Legal', 'a.pdf'],
    ['Clients/Acme/CanExport/2026', 'Payroll 2026.pdf']
  ])('moved or renamed into an excluded area (%s, %s) → process, which records it excluded', (path, name) => {
    const a = f('a', 'Clients/Acme/CanExport/2026');
    expect(actionOf(plan({ changed: [{ ...a, name, path: path.split('/') }], rows: [row(a)] }), 'a')).toBe('process');
  });

  test('moved out of an excluded area → process', () => {
    const a = f('a', 'Departments/HR/Old');
    const p = plan({ changed: [{ ...a, path: ['Clients', 'Acme', 'CanExport', '2026'] }], rows: [row(a, { status: 'excluded' })] });
    expect(actionOf(p, 'a')).toBe('process');
  });

  test('moved within an excluded area stays a metadata move', () => {
    const a = f('a', 'Departments/HR/Old');
    const p = plan({ changed: [{ ...a, path: ['Departments', 'HR', 'Archive'] }], rows: [row(a, { status: 'excluded' })] });
    expect(actionOf(p, 'a')).toBe('move');
  });

  test('restored from the trash → process', () => {
    const a = f('a', 'Clients/Acme/CanExport/2026');
    expect(actionOf(plan({ changed: [a], rows: [row(a, { status: 'removed' })] }), 'a')).toBe('process');
  });
});

describe('planNightly — duplicates', () => {
  // A is the kept copy (Clients); B (Old Files) and C (Programs) are copies of the same content.
  const A = f('A', 'Clients/Acme/CanExport/2026', { md5Checksum: 'same' });
  const B = f('B', 'Old Files/Acme', { md5Checksum: 'same' });
  const C = f('C', 'Programs/CanExport', { md5Checksum: 'same' });
  const rows = [row(A), row(B, { duplicate_of: 'A' }), row(C, { duplicate_of: 'A' })];

  test('kept copy trashed → rehome to the best allowed copy, others re-pointed, no re-embed', () => {
    const p = plan({ gone: ['A'], rows });
    expect(p.rehomes).toEqual([expect.objectContaining({ previousId: 'A', status: 'indexed', file: expect.objectContaining({ id: 'C' }) })]);
    expect(p.remove).toEqual(['A']);
    expect(p.plan).toEqual([expect.objectContaining({ action: 'duplicate', canonicalId: 'C', file: expect.objectContaining({ id: 'B' }) })]);
    expect(p.plan.some(x => x.action === 'process')).toBe(false);
  });

  test('kept copy moved into an excluded area → rehome first, then it is processed as excluded', () => {
    const p = plan({ changed: [{ ...A, path: ['Departments', 'LEADERSHIP'] }], rows });
    expect(p.rehomes.map(r => [r.previousId, r.file.id])).toEqual([['A', 'C']]);
    expect(actionOf(p, 'A')).toBe('process');
    expect(actionOf(p, 'B')).toBe('duplicate');
  });

  test('kept copy edited → its old content rehomes to a copy; the edit is processed', () => {
    const p = plan({ changed: [{ ...A, md5Checksum: 'edited' }], rows });
    expect(p.rehomes.map(r => [r.previousId, r.file.id])).toEqual([['A', 'C']]);
    expect(actionOf(p, 'A')).toBe('process');
  });

  test('kept copy trashed and no allowed copy left → remove only', () => {
    const X = f('X', 'Departments/HR', { md5Checksum: 'same' });
    const p = plan({ gone: ['A'], rows: [row(A), row(X, { status: 'excluded' })] });
    expect(p.rehomes).toEqual([]);
    expect(p.remove).toEqual(['A']);
  });

  test('a copy trashed → remove it; the kept copy is untouched', () => {
    const p = plan({ gone: ['B'], rows });
    expect(p.rehomes).toEqual([]);
    expect(p.remove).toEqual(['B']);
    expect(p.plan).toEqual([]);
    expect(countActions(p)).toMatchObject({ remove: 1, rehome: 0 });
  });
});

// ---------------------------------------------------------------- Drive stand-ins

const folder = (id, name, parent) => ({ id, name, mimeType: FOLDER_MIME, parents: [parent] });
function fakeDrive({ changes = [], items = [], startToken = 'T-start' } = {}) {
  const byId = new Map(items.map(i => [i.id, i]));
  return {
    changes: {
      getStartPageToken: jest.fn(async () => ({ data: { startPageToken: startToken } })),
      list: jest.fn(async () => ({ data: { changes, newStartPageToken: 'T-after' } }))
    },
    files: {
      get: jest.fn(async ({ fileId }) => {
        if (!byId.has(fileId)) throw Object.assign(new Error('not found'), { statusCode: 404 });
        return { data: byId.get(fileId) };
      }),
      list: jest.fn(async ({ q }) => {
        const parent = /'([^']+)' in parents/.exec(q)[1];
        return { data: { files: items.filter(i => i.parents?.[0] === parent && !i.trashed) } };
      })
    }
  };
}
const change = (file, over = {}) => ({ fileId: file.id, removed: false, time: '2026-11-04T10:00:00Z', file: { driveId: DRIVE, ...file }, ...over });

describe('readChanges', () => {
  test('removed, trashed and other-drive changes are gone; drive-level changes are ignored; the last change per item wins; since filters by change time', async () => {
    const drive = fakeDrive({ changes: [
      change({ id: 'a', name: 'a.pdf' }),
      { fileId: 'b', removed: true, time: '2026-11-04T10:00:00Z' },
      change({ id: 'c', name: 'c.pdf', trashed: true }),
      change({ id: 'd', name: 'd.pdf', driveId: 'OTHER' }),
      change({ id: 'a', name: 'a.pdf', trashed: true }, { time: '2026-11-04T11:00:00Z' }),
      change({ id: 'e', name: 'e.pdf' }, { time: '2026-11-01T00:00:00Z' }),
      { changeType: 'drive', driveId: DRIVE, removed: false, time: '2026-11-04T10:00:00Z' }
    ] });
    const all = await readChanges(drive, 'T0');
    expect([...all.live.keys()]).toEqual(['e']);
    expect([...all.gone.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(all.token).toBe('T-after');
    const since = await readChanges(drive, 'T0', { since: '2026-11-03T22:39:00Z' });
    expect(since.live.has('e')).toBe(false);
  });
});

// ---------------------------------------------------------------- in-memory store

function memoryStore(rows = [], runs = []) {
  const files = new Map(rows.map(r => [r.file_id, { ...r }]));
  const writes = [];
  const store = {
    files, writes, runs,
    existingRows: async (ids) => ids.filter(id => files.has(id)).map(id => files.get(id)),
    groupRows: async (md5s) => [...files.values()].filter(r => md5s.includes(r.md5) && r.status !== 'removed'),
    hasRowsUnder: jest.fn(async (prefix) => [...files.values()]
      .some(r => r.status !== 'removed' && (r.path === prefix || r.path.startsWith(`${prefix}/`)))),
    rowsUnderPath: jest.fn(async (prefix) => [...files.values()]
      .filter(r => r.status !== 'removed' && (r.path === prefix || r.path.startsWith(`${prefix}/`))).map(r => r.file_id)),
    writeFile: async (r, chunks = []) => { files.set(r.file_id, { ...r, mime: r.mime }); writes.push({ id: r.file_id, status: r.status, chunks: chunks.length, duplicate_of: r.duplicate_of }); },
    rehome: jest.fn(async (previousId, canon) => { files.set(canon.file_id, { ...files.get(canon.file_id), ...canon }); files.set(previousId, { ...files.get(previousId), duplicate_of: canon.file_id }); }),
    updateMove: jest.fn(async (r) => { files.set(r.file_id, { ...files.get(r.file_id), ...r }); }),
    markRemoved: jest.fn(async (id) => { files.set(id, { ...files.get(id), status: 'removed', duplicate_of: null }); }),
    claimRun: jest.fn(async (kind, date, before) => {
      const owner = runs.find(r => r.date === date);
      if (owner && owner.status !== 'stopped') return null;
      const run = { id: runs.length + 1, kind, date, before, status: 'building' };
      if (owner) runs.splice(runs.indexOf(owner), 1);
      runs.push(run);
      return run.id;
    }),
    finishRun: jest.fn(async (id, fields) => { Object.assign(runs.find(r => r.id === id), fields, { after: fields.status === 'done' ? fields.tokenAfter : null }); }),
    lastToken: async () => {
      const last = [...runs].reverse().find(r => ['done', 'stopped', 'failed'].includes(r.status));
      return last ? (last.status === 'done' ? last.after : last.before) : null;
    },
    sweepTokenAtOrBefore: async () => ({ token: 'SWEEP', at: new Date('2026-11-02T16:32:00Z') })
  };
  return store;
}

const ROOT_ITEMS = [folder('CL', 'Clients', DRIVE), folder('AC', 'Active Clients', DRIVE), folder('ACME', 'Acme', 'CL')];

describe('collectChanges — folders', () => {
  test('a moved folder expands to every file below it, with new paths → moves', async () => {
    const x = f('x', 'Clients/Norland/CanExport/2026');
    const y = f('y', 'Clients/Norland');
    const items = [...ROOT_ITEMS, folder('NOR', 'Norland', 'AC'), folder('CE', 'CanExport', 'NOR'), folder('Y26', '2026', 'CE'),
      { ...x, parents: ['Y26'] }, { ...y, parents: ['NOR'] }].map(({ path, ...i }) => i);
    const drive = fakeDrive({ changes: [change(folder('NOR', 'Norland', 'AC'))], items });
    const store = memoryStore([row(x), row(y)]);
    const c = await collectChanges({ drive, call: (_m, fn) => fn(), store }, 'T0');
    expect(c.folders).toBe(1);
    expect(Object.fromEntries(c.changed.map(i => [i.id, i.path.join('/')]))).toEqual({ x: 'Active Clients/Norland/CanExport/2026', y: 'Active Clients/Norland' });
    const p = planNightly(c);
    expect(p.plan.map(i => [i.file.id, i.action]).sort()).toEqual([['x', 'move'], ['y', 'move']]);
  });

  test('a folder reported only because its contents changed is not listed', async () => {
    const x = f('x', 'Clients/Acme/CanExport');
    const n = { id: 'n', name: 'New.pdf', mimeType: PDF, md5Checksum: 'mn', modifiedTime: '2026-11-04T09:00:00Z', parents: ['ACME'] };
    const drive = fakeDrive({ changes: [change(folder('ACME', 'Acme', 'CL')), change(n)], items: ROOT_ITEMS });
    const store = memoryStore([row(x)]);
    const c = await collectChanges({ drive, call: (_m, fn) => fn(), store }, 'T0');
    expect(store.hasRowsUnder).toHaveBeenCalledWith('Clients/Acme');
    expect(drive.files.list).not.toHaveBeenCalled();
    expect(c).toMatchObject({ folders: 0, foldersSkipped: 1 });
    expect(c.changed.map(i => [i.id, i.path.join('/')])).toEqual([['n', 'Clients/Acme']]);
  });

  test('a trashed folder removes every row under its old path', async () => {
    const a1 = f('a1', 'Clients/Acme/CanExport/2026');
    const a2 = f('a2', 'Clients/Acme');
    const keep = f('k', 'Clients/Acme Two');
    const drive = fakeDrive({ changes: [change({ ...folder('ACME', 'Acme', 'CL'), trashed: true })], items: ROOT_ITEMS });
    const store = memoryStore([row(a1), row(a2), row(keep)]);
    const c = await collectChanges({ drive, call: (_m, fn) => fn(), store }, 'T0');
    expect(store.rowsUnderPath).toHaveBeenCalledWith('Clients/Acme');
    expect([...c.goneIds].sort()).toEqual(['a1', 'a2']);
    expect(planNightly(c).remove.sort()).toEqual(['a1', 'a2']);
  });
});

// ---------------------------------------------------------------- runNightly

const prepared = (file, tokens = 100000) => ({
  row: { file_id: file.id, md5: file.md5Checksum, name: file.name, path: file.path.join('/'), mime: file.mimeType, status: 'indexed', token_count: tokens, chunk_count: 1 },
  chunks: [{ chunk_no: 0, text: `secret text of ${file.name}`, token_count: tokens, file_id: file.id }]
});
function runDeps({ drive, store, prepare } = {}) {
  const lines = [];
  return {
    lines,
    deps: {
      drive, store, call: (_m, fn) => fn(), log: (l) => lines.push(l),
      prepare: jest.fn(prepare || (async (file) => prepared(file))),
      embed: jest.fn(async (texts) => ({ vectors: texts.map(() => new Array(512).fill(0.1)), tokens: texts.length * 100000 }))
    }
  };
}
const NOW = new Date('2026-11-05T10:00:00Z');

describe('runNightly', () => {
  test('first run with no position records one and processes nothing', async () => {
    const drive = fakeDrive({ changes: [change({ id: 'n', name: 'n.pdf', parents: ['ACME'] })], items: ROOT_ITEMS });
    const store = memoryStore();
    const { deps } = runDeps({ drive, store });
    expect(await runNightly({ deps, now: NOW })).toEqual({ status: 'baseline' });
    expect(store.runs).toEqual([expect.objectContaining({ kind: 'baseline', status: 'done', after: 'T-start' })]);
    expect(drive.changes.list).not.toHaveBeenCalled();
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  test('token ceiling: stops cleanly, keeps the old position; the re-run skips what was written', async () => {
    const n1 = { id: 'n1', name: 'One Acme.pdf', mimeType: PDF, md5Checksum: 'm1', modifiedTime: '2026-11-04T09:00:00Z', parents: ['ACME'] };
    const n2 = { ...n1, id: 'n2', name: 'Two Acme.pdf', md5Checksum: 'm2' };
    const drive = fakeDrive({ changes: [change(n1), change(n2)], items: ROOT_ITEMS });
    const store = memoryStore([], [{ id: 1, kind: 'baseline', date: '2026-11-04', status: 'done', after: 'T0' }]);

    // n2 is prepared after n1's batch is embedded, so the ceiling falls between them.
    const later = async (file) => { if (file.id === 'n2') await new Promise(r => setTimeout(r, 20)); return prepared(file); };
    const first = runDeps({ drive, store, prepare: later });
    const r1 = await runNightly({ deps: first.deps, now: NOW, maxTokens: 150000 });
    expect(r1).toMatchObject({ status: 'stopped', tokens: 100000 });
    expect(store.writes.map(w => w.id)).toEqual(['n1']);
    expect(store.runs.at(-1)).toMatchObject({ status: 'stopped', before: 'T0', after: null });
    expect(await store.lastToken()).toBe('T0');

    const second = runDeps({ drive, store });
    const r2 = await runNightly({ deps: second.deps, now: NOW, maxTokens: 150000 });
    expect(r2).toMatchObject({ status: 'done', tokens: 100000 });
    expect(second.deps.prepare.mock.calls.map(([file]) => file.id)).toEqual(['n2']);
    expect(await store.lastToken()).toBe('T-after');
  });

  test('moved into LEADERSHIP: rows lose their chunks without any download; trashed → removed', async () => {
    const a = f('a', 'Clients/Acme');
    const t = f('t', 'Clients/Acme');
    const items = [...ROOT_ITEMS, folder('DEP', 'Departments', DRIVE), folder('LEAD', 'LEADERSHIP', 'DEP')];
    const drive = fakeDrive({ changes: [change({ ...a, path: undefined, parents: ['LEAD'] }), { fileId: 't', removed: true, time: '2026-11-04T10:00:00Z' }], items });
    const store = memoryStore([row(a), row(t)], [{ id: 1, kind: 'baseline', date: '2026-11-04', status: 'done', after: 'T0' }]);
    const fetchBytes = jest.fn(async () => { throw new Error('must not download'); });
    const { deps, lines } = runDeps({ drive, store, prepare: (file) => prepareFile(file, fetchBytes) });
    const r = await runNightly({ deps, now: NOW });
    expect(r).toMatchObject({ status: 'done', actions: expect.objectContaining({ process: 1, remove: 1 }) });
    expect(store.writes).toEqual([expect.objectContaining({ id: 'a', status: 'excluded', chunks: 0 })]);
    expect(store.files.get('a').path).toBe('Departments/LEADERSHIP');
    expect(store.markRemoved).toHaveBeenCalledWith('t');
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
    const out = lines.join('\n');
    expect(out).not.toMatch(/a\.pdf|Acme|secret text/);  // reason codes such as area:Departments/LEADERSHIP are categories, as in phase 2
  });

  test('kept copy trashed: chunks rehomed before the row is removed', async () => {
    const A = f('A', 'Clients/Acme', { md5Checksum: 'same' });
    const C = f('C', 'Programs/CanExport', { md5Checksum: 'same' });
    const drive = fakeDrive({ changes: [{ fileId: 'A', removed: true, time: '2026-11-04T10:00:00Z' }], items: ROOT_ITEMS });
    const store = memoryStore([row(A), row(C, { duplicate_of: 'A' })], [{ id: 1, kind: 'baseline', date: '2026-11-04', status: 'done', after: 'T0' }]);
    const order = [];
    store.rehome.mockImplementation(async (prev, canon) => { order.push(['rehome', prev, canon.file_id, canon.duplicate_of]); });
    store.markRemoved.mockImplementation(async (id) => { order.push(['remove', id]); });
    const { deps } = runDeps({ drive, store });
    await runNightly({ deps, now: NOW });
    expect(order).toEqual([['rehome', 'A', 'C', null], ['remove', 'A']]);
    expect(deps.embed).not.toHaveBeenCalled();
  });

  test('a run already done today is not repeated', async () => {
    const store = memoryStore([], [{ id: 1, kind: 'nightly', date: '2026-11-05', status: 'done', after: 'T1', before: 'T0' }]);
    const { deps } = runDeps({ drive: fakeDrive(), store });
    expect(await runNightly({ deps, now: NOW })).toEqual({ status: 'already_ran' });
  });

  test('--dry plans from the borrowed sweep position: no claim, no writes, no embeddings', async () => {
    const n = { id: 'n', name: 'n.pdf', mimeType: PDF, md5Checksum: 'mn', modifiedTime: '2026-11-04T09:00:00Z', parents: ['ACME'] };
    const drive = fakeDrive({ changes: [change(n)], items: ROOT_ITEMS });
    const store = memoryStore();
    const { deps } = runDeps({ drive, store });
    const r = await runNightly({ deps, now: NOW, dry: true, since: '2026-11-04T05:16:00Z' });
    expect(r).toMatchObject({ status: 'dry', changes: 1, actions: expect.objectContaining({ process: 1 }) });
    expect(drive.changes.list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: 'SWEEP' }));
    expect(store.claimRun).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
  });

  test('migration 060 missing → no_state_table, nothing else', async () => {
    const store = memoryStore();
    store.lastToken = async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const { deps } = runDeps({ drive: fakeDrive(), store });
    expect(await runNightly({ deps, now: NOW })).toEqual({ status: 'no_state_table' });
  });
});

describe('schedule', () => {
  test('off unless RAG_NIGHTLY_ENABLED is exactly "true"', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const cron = { schedule: jest.fn() };
    expect(startRagNightly(cron, {})).toBe(false);
    expect(startRagNightly(cron, { RAG_NIGHTLY_ENABLED: '1' })).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(startRagNightly(cron, { RAG_NIGHTLY_ENABLED: 'true' })).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), { name: 'rag-nightly', timezone: 'America/Vancouver', noOverlap: true });
    expect(SCHEDULE).toBe('0 2 * * *');
  });
});

/**
 * control-centre AI knowledge queue (migration 057): the markdown export is
 * pure and anonymised, exporting marks every pending row under one batch (and
 * writes nothing when there is nothing to export), re-downloading a batch, and
 * the routes' download headers. Fakes switch on the exported SQL; no DB.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-knowledge.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const K = await import('../../src/control-centre/knowledge.js');
const { createKnowledgeRouter } = await import('../../src/control-centre/knowledge-routes.js');

const STAFF = 'chris@granted.ca';

const row = (over = {}) => ({
  id: '1', item_id: '110', conversation_id: 290, company_id: 135,
  question: 'What does it entail to have your consulting team at NYA Ventures manage the application end to end?',
  question_rewritten: 'What does it involve to have the consulting team manage an application end to end?',
  ai_reply: 'GetGranted does not offer application writing; you can email help@granted.ca.',
  answer: 'Our consultants scope the program, draft the application with you and handle submission. Book a call.',
  approved_by: STAFF, approved_at: '2026-10-22T18:00:00Z', status: 'pending', exported_at: null, export_batch: null, ...over
});

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('knowledgeMarkdown', () => {
  test('one file: title, export line, one section per row with the anonymised question first and no company names', () => {
    const md = K.knowledgeMarkdown([row(), row({ id: '2', item_id: '111', question_rewritten: null, question: 'Can you write it for us?', ai_reply: null })],
      { batch: '2026-10-22-abcdef01', at: new Date('2026-10-22T19:00:00Z') });
    expect(md.startsWith('# GetGranted — consultant answers approved for the AI')).toBe(true);
    expect(md).toContain('Exported 2026-10-22 · batch 2026-10-22-abcdef01 · 2 answers.');
    expect(md).toContain('## 1. What does it involve to have the consulting team manage an application end to end?');
    // The client's own words only under "Client asked", and the fallback heading when there is no rewrite.
    expect(md).toContain('> What does it entail to have your consulting team at NYA Ventures manage the application end to end?');
    expect(md).toContain('## 2. Can you write it for us?');
    expect(md).toContain('> (no reply recorded)');
    expect(md).toContain('**Approved answer**\n\nOur consultants scope the program');
    expect(md).toContain('_Approved by chris@granted.ca on 2026-10-22 · Control Centre card #110._');
    expect(md).not.toMatch(/company_name|Maximizer/);
  });

  test('pure: the same rows give the same file', () => {
    const at = new Date('2026-10-22T19:00:00Z');
    expect(K.knowledgeMarkdown([row()], { batch: 'b', at })).toBe(K.knowledgeMarkdown([row()], { batch: 'b', at }));
  });

  test('a batch id is the day plus 8 hex characters', () => {
    expect(K.newBatchId(new Date('2026-10-22T19:00:00Z'))).toMatch(/^2026-10-22-[0-9a-f]{8}$/);
  });
});

/** A fake Hub: pending rows, and what MARK_EXPORTED_SQL was asked to do. */
function fakeHub(rows) {
  const marked = [];
  const client = {
    query: jest.fn(async (sql, p) => {
      if (sql === K.PENDING_FOR_EXPORT_SQL) return { rows: rows.filter((r) => r.status === 'pending') };
      if (sql === K.MARK_EXPORTED_SQL) { marked.push(p); return { rowCount: p[0].length }; }
      throw new Error(`unexpected SQL ${sql.slice(0, 40)}`);
    })
  };
  const hubTransaction = jest.fn(async (cb) => cb(client));
  const hubQuery = jest.fn(async (sql, p) => {
    if (sql === K.LIST_KNOWLEDGE_SQL) return { rows: rows.filter((r) => p[0] == null || r.status === p[0]).slice(0, p[1]) };
    if (sql === K.COUNTS_SQL) return { rows: [{ status: 'pending', n: rows.filter((r) => r.status === 'pending').length }, { status: 'exported', n: rows.filter((r) => r.status === 'exported').length }] };
    if (sql === K.BATCH_SQL) return { rows: rows.filter((r) => r.export_batch === p[0]) };
    throw new Error(`unexpected SQL ${sql.slice(0, 40)}`);
  });
  return { client, hubTransaction, hubQuery, marked };
}

describe('exportPending', () => {
  test('nothing pending: count 0 and no write', async () => {
    const hub = fakeHub([row({ status: 'exported', export_batch: '2026-10-20-00000000' })]);
    const out = await K.exportPending(STAFF, { hubTransaction: hub.hubTransaction });
    expect(out).toEqual({ count: 0, batch: null, markdown: null, exported_at: null });
    expect(hub.marked).toEqual([]);
  });

  test('every pending row is marked exported under one batch id, and the markdown covers them all', async () => {
    const hub = fakeHub([row(), row({ id: '2', item_id: '111' }), row({ id: '3', status: 'exported', export_batch: 'old' })]);
    const out = await K.exportPending(STAFF, { hubTransaction: hub.hubTransaction, now: () => new Date('2026-10-22T19:00:00Z') });
    expect(out.count).toBe(2);
    expect(out.batch).toMatch(/^2026-10-22-[0-9a-f]{8}$/);
    expect(hub.marked).toEqual([[['1', '2'], out.batch]]);
    expect(out.markdown).toContain('· 2 answers.');
    expect(out.markdown).toContain(`batch ${out.batch}`);
    expect(out.exported_at).toBe('2026-10-22T19:00:00.000Z');
  });
});

describe('listKnowledge and batchMarkdown', () => {
  test('rows with numeric ids, company names when the app DB answers, and the counts', async () => {
    const hub = fakeHub([row(), row({ id: '2', status: 'exported', export_batch: '2026-10-20-0000abcd' })]);
    const appQuery = async () => ({ rows: [{ id: 135, name: 'NYA Ventures' }] });
    const out = await K.listKnowledge({ status: 'pending' }, { hubQuery: hub.hubQuery, appQuery });
    expect(out.items).toEqual([expect.objectContaining({ id: 1, item_id: 110, company_name: 'NYA Ventures', company_internal: false })]);
    expect(out.counts).toEqual({ pending: 1, exported: 1 });
    // A names failure keeps the rows.
    const off = await K.listKnowledge({}, { hubQuery: hub.hubQuery, appQuery: async () => { throw new Error('down'); } });
    expect(off.items.map((r) => r.company_name)).toEqual([null, null]);
    await expect(K.listKnowledge({ status: 'nope' }, { hubQuery: hub.hubQuery })).rejects.toMatchObject({ status: 400 });
  });

  test('a past batch is served again; an unknown or malformed one is not', async () => {
    const hub = fakeHub([row({ status: 'exported', export_batch: '2026-10-20-0000abcd', exported_at: '2026-10-20T10:00:00Z' })]);
    const out = await K.batchMarkdown('2026-10-20-0000abcd', { hubQuery: hub.hubQuery });
    expect(out).toMatchObject({ count: 1, batch: '2026-10-20-0000abcd' });
    expect(out.markdown).toContain('Exported 2026-10-20 · batch 2026-10-20-0000abcd');
    expect(await K.batchMarkdown('2026-10-21-ffffffff', { hubQuery: hub.hubQuery })).toBeNull();
    await expect(K.batchMarkdown('../etc', { hubQuery: hub.hubQuery })).rejects.toMatchObject({ status: 400 });
  });
});

describe('routes', () => {
  let srv;
  afterEach(async () => { await srv?.close(); srv = null; });

  async function serve(overrides) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { email: STAFF }; next(); });
    app.use('/knowledge', createKnowledgeRouter(overrides));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/knowledge`;
    return { fetch: (path, init) => fetch(`${base}${path}`, init), close: () => new Promise((r) => server.close(r)) };
  }

  test('GET / passes the status filter and returns items and counts; a bad status is 400', async () => {
    const listKnowledge = jest.fn(async () => ({ items: [{ id: 1 }], counts: { pending: 1, exported: 0 } }));
    srv = await serve({ listKnowledge });
    const r = await srv.fetch('/?status=pending');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ items: [{ id: 1 }], counts: { pending: 1, exported: 0 } });
    expect(listKnowledge).toHaveBeenCalledWith({ status: 'pending' });
    await srv.close();
    srv = await serve({ listKnowledge: async () => { throw new K.KnowledgeError(400, 'status must be one of pending, exported'); } });
    expect((await srv.fetch('/?status=x')).status).toBe(400);
  });

  test('POST /export: a markdown download with the batch in its filename, by the signed-in staff member; {count: 0} when nothing is pending', async () => {
    const exportPending = jest.fn(async (actor) => ({ count: 2, batch: '2026-10-22-abcdef01', markdown: '# file', exported_at: 'x', actor }));
    srv = await serve({ exportPending });
    const r = await srv.fetch('/export', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="ai-knowledge-2026-10-22-abcdef01.md"');
    expect(r.headers.get('x-export-count')).toBe('2');
    expect(await r.text()).toBe('# file');
    expect(exportPending).toHaveBeenCalledWith(STAFF);
    await srv.close();
    srv = await serve({ exportPending: async () => ({ count: 0, batch: null, markdown: null }) });
    const none = await srv.fetch('/export', { method: 'POST' });
    expect(none.headers.get('content-type')).toMatch(/json/);
    expect(await none.json()).toEqual({ count: 0 });
  });

  test('GET /export/:batch re-serves a batch and 404s an unknown one; a missing table is 503 migration_missing', async () => {
    srv = await serve({ batchMarkdown: async (b) => (b === '2026-10-20-0000abcd' ? { count: 1, batch: b, markdown: '# again' } : null) });
    const r = await srv.fetch('/export/2026-10-20-0000abcd');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="ai-knowledge-2026-10-20-0000abcd.md"');
    expect(await r.text()).toBe('# again');
    expect((await srv.fetch('/export/2026-10-21-ffffffff')).status).toBe(404);
    await srv.close();
    srv = await serve({ listKnowledge: async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); } });
    const missing = await srv.fetch('/');
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: 'migration_missing' });
  });
});

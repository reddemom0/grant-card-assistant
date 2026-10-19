/**
 * Pre-call briefing DMs as sent: recording, finding the post a reply belongs
 * to (same space; same thread or a quote of it), and the context block.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/briefing-posts.test.js
 */

import { jest } from '@jest/globals';

const P = await import('../../src/services/briefing-posts.js');

const ROW = {
  meeting_date: '2026-10-20', meeting_type: 'discovery', company_name: 'Fresh Is Best', is_test: true,
  doc_url: 'https://docs.google.com/document/d/D/edit', briefing_markdown: '# Fresh Is Best\n- Revenue $5M–$10M (calculator)',
  facts_json: { calculator: { revenue: '$5 million to $10 million' } }, created_at: '2026-10-19T11:00:00Z'
};

describe('recording', () => {
  test('writes one row with the thread; never throws', async () => {
    const q = jest.fn(async () => ({ rows: [] }));
    expect(await P.recordBriefingPost({ eventId: 'e1', meetingDate: '2026-10-20', meetingType: 'discovery', spaceName: 'spaces/A',
      messageName: 'spaces/A/messages/1', threadName: 'spaces/A/threads/T', markdown: 'md', facts: { x: 1 }, isTest: true }, q)).toBe(true);
    const [sql, params] = q.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO briefing_posts/);
    expect(params.slice(4, 9)).toEqual([true, null, 'spaces/A', 'spaces/A/messages/1', 'spaces/A/threads/T']);
    expect(JSON.parse(params[11])).toEqual({ x: 1 });
  });
  test('a missing table or a bad row records nothing and does not throw', async () => {
    P._resetBriefingPostsForTests();
    const q = jest.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); });
    expect(await P.recordBriefingPost({ eventId: 'e', spaceName: 's', messageName: 'm', markdown: '', facts: {} }, q)).toBe(false);
    expect(await P.recordBriefingPost({ spaceName: 's' }, q)).toBe(false);
  });
});

describe('thread lookup', () => {
  test('matches on space + thread, or space + quoted message', async () => {
    const q = jest.fn(async () => ({ rows: [ROW] }));
    const post = await P.findBriefingPost({ spaceName: 'spaces/A', threadName: 'spaces/A/threads/T' }, q);
    expect(post).toMatchObject({ meetingDate: '2026-10-20', meetingType: 'discovery', companyName: 'Fresh Is Best', isTest: true });
    expect(q.mock.calls[0][1]).toEqual(['spaces/A', 'spaces/A/threads/T', null]);
    expect(q.mock.calls[0][0]).toMatch(/meeting_date::text AS meeting_date/);
    await P.findBriefingPost({ spaceName: 'spaces/A', quotedMessageName: 'spaces/A/messages/1' }, q);
    expect(q.mock.calls[1][1]).toEqual(['spaces/A', null, 'spaces/A/messages/1']);
  });
  test('a quote-reply starts its own thread (the reply arrow in a DM) and still finds the briefing', async () => {
    const q = jest.fn(async () => ({ rows: [{ ...ROW, thread_name: 'spaces/A/threads/B', message_name: 'spaces/A/messages/B.B' }] }));
    const viaQuote = await P.findBriefingPost({ spaceName: 'spaces/A', threadName: 'spaces/A/threads/R', quotedMessageName: 'spaces/A/messages/B.B' }, q);
    expect(viaQuote).toMatchObject({ companyName: 'Fresh Is Best', matchedBy: 'quote' });
    expect(q.mock.calls[0][1]).toEqual(['spaces/A', 'spaces/A/threads/R', 'spaces/A/messages/B.B']);
    const viaThread = await P.findBriefingPost({ spaceName: 'spaces/A', threadName: 'spaces/A/threads/B' }, q);
    expect(viaThread.matchedBy).toBe('thread');
  });
  test('no thread and no quote, no row, or no table → null', async () => {
    const q = jest.fn(async () => ({ rows: [] }));
    expect(await P.findBriefingPost({ spaceName: 'spaces/A' }, q)).toBeNull();
    expect(q).not.toHaveBeenCalled();
    expect(await P.findBriefingPost({ spaceName: 'spaces/A', threadName: 't' }, q)).toBeNull();
    const missing = jest.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); });
    expect(await P.findBriefingPost({ spaceName: 'spaces/A', threadName: 't' }, missing)).toBeNull();
  });
});

describe('context block', () => {
  test('carries the rules and the briefing + facts, wrapped as untrusted', async () => {
    const post = await P.findBriefingPost({ spaceName: 's', threadName: 't' }, async () => ({ rows: [ROW] }));
    const block = P.briefingContextBlock(post);
    expect(block).toMatch(/pre-call briefing for Fresh Is Best — discovery call on 2026-10-20 \(a test send\)/);
    expect(block).toMatch(/say "not on file"/);
    expect(block).toMatch(/Never guess/);
    expect(block).toMatch(/Cite sources the way the briefing does/);
    expect(block).toMatch(/tool="pre_call_briefing" trust="untrusted"/);
    expect(block).toMatch(/tool="pre_call_briefing_facts" trust="untrusted"/);
    expect(block).toContain('Revenue $5M–$10M (calculator)');
  });
});

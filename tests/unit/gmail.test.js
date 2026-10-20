/**
 * Gmail reader (src/tools/gmail.js): the no-send guard, the facade, reply
 * detection, draft building, label merging and the opt-in scope check.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gmail.test.js
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const G = await import('../../src/tools/gmail.js');

const SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../src/tools/gmail.js');
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';
const ME = 'ssang@granted.ca';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const unb64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const connectedQuery = jest.fn(async () => ({ rows: [{ google_granted_scopes: `email profile ${SCOPES}`, gmail_connected_at: new Date() }] }));

function rawMessage({ id, from, labels = ['INBOX'], at, subject = 'Contract renewal', text = 'Hello', msgId, refs, html, files = [] }) {
  const headers = [
    { name: 'From', value: from }, { name: 'To', value: ME }, { name: 'Subject', value: subject },
    { name: 'Date', value: new Date(at).toUTCString() },
    ...(msgId ? [{ name: 'Message-ID', value: msgId }] : []),
    ...(refs ? [{ name: 'References', value: refs }] : [])
  ];
  const parts = [
    html ? { mimeType: 'text/html', body: { data: b64(html) } } : { mimeType: 'text/plain', body: { data: b64(text) } },
    ...files.map(f => ({ mimeType: 'application/pdf', filename: f, body: { attachmentId: 'att' } }))
  ];
  return { id, internalDate: String(at), labelIds: labels, payload: { mimeType: 'multipart/mixed', headers, parts } };
}

/** A fake facade: every method a jest.fn, so tests can see exactly what was called. */
function fakeGmail({ labels = [], threadsByLabel = {}, thread = null } = {}) {
  return {
    listLabels: jest.fn(async () => ({ data: { labels } })),
    listThreads: jest.fn(async ({ labelIds }) => ({ data: { threads: threadsByLabel[labelIds[0]] || [] } })),
    getThread: jest.fn(async () => ({ data: thread })),
    createDraft: jest.fn(async () => ({ data: { id: 'draft-1', message: { id: 'm-draft' } } })),
    getProfile: jest.fn(async () => ({ data: { emailAddress: ME } }))
  };
}

// ── The hard rule ────────────────────────────────────────────────────────────
describe('no-send guard', () => {
  const code = readFileSync(SOURCE_PATH, 'utf8')
    // Comments may name the forbidden methods (they explain the rule); code may not.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test.each([
    ['messages.send', /messages\s*\.\s*send\b/],
    ['drafts.send', /drafts\s*\.\s*send\b/],
    ['any .send( call', /\.\s*send\s*\(/],
    ['a "send" method name in brackets', /\[\s*['"`]send['"`]\s*\]/],
    ['modify / batchModify', /\.\s*(batchModify|modify)\s*\(/],
    ['trash / untrash', /\.\s*(trash|untrash)\s*\(/],
    ['delete / batchDelete', /\.\s*(delete|batchDelete)\s*\(/],
    ['messages.insert / import', /messages\s*\.\s*(insert|import)\b/],
    ['label writes', /labels\s*\.\s*(create|update|patch|delete)\b/],
    ['settings (filters, forwarding, send-as)', /users\s*\.\s*settings\b/],
    ['watch / stop', /\.\s*(watch|stop)\s*\(/]
  ])('src/tools/gmail.js contains no %s', (_label, re) => {
    expect(code).not.toMatch(re);
  });

  test('the only Gmail API calls are the five allowlisted reads + drafts.create', () => {
    const calls = [...code.matchAll(/client\.users\.([\w.]+)\s*\(/g)].map(m => m[1]).sort();
    expect(calls).toEqual(['drafts.create', 'getProfile', 'labels.list', 'threads.get', 'threads.list']);
  });

  test('the facade exposes exactly GMAIL_METHODS, frozen', () => {
    const client = { users: { labels: {}, threads: {}, drafts: {}, messages: { send: jest.fn() } } };
    const facade = G.gmailFacade(client);
    expect(Object.keys(facade).sort()).toEqual([...G.GMAIL_METHODS].sort());
    expect(Object.isFrozen(facade)).toBe(true);
    expect(facade.send).toBeUndefined();
    expect(client.users.messages.send).not.toHaveBeenCalled();
  });

  test('createDraftReply only reads and calls drafts.create — never anything that sends', async () => {
    const thread = { id: 't1', messages: [rawMessage({ id: 'a', from: 'Arie <arie@client.ca>', at: 1000, msgId: '<a@x>' })] };
    const gmail = fakeGmail({ thread });
    await G.createDraftReply(1, 't1', 'Sounds good.', { gmail, query: connectedQuery, userEmail: ME });
    expect(gmail.createDraft).toHaveBeenCalledTimes(1);
    expect(gmail.createDraft.mock.calls[0][0].message.threadId).toBe('t1');
  });
});

// ── The hard rule, for the morning brief (Stage 2) ──────────────────────────
describe('no-send guard: morning brief code', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const FILES = [
    'src/services/steph-brief.js', 'src/services/steph-brief-triage.js', 'src/services/steph-brief-classify.js',
    'src/services/steph-brief-context.js', 'src/services/steph-brief-promises.js', 'src/services/steph-brief-learn.js', 'src/services/steph-brief-rank.js',
    'src/cards/brief-card.js', 'src/api/steph-brief-run.js'
  ];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // What the brief may take from gmail.js: reads, the reply check, drafts. Nothing else exists there, but the
  // list is explicit so a future gmail.js export can't be picked up silently.
  const ALLOWED_GMAIL = new Set(['listThreadsSince', 'getThread', 'replyState', 'createDraftReply', 'hasGmailScopes', 'addressOf']);

  test.each(FILES)('%s: no send / modify / trash / delete / label / filter / settings call', (file) => {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    for (const re of [/messages\s*\.\s*send\b/, /drafts\s*\.\s*send\b/, /\[\s*['"`]send['"`]\s*\]/, /\.\s*(batchModify|modify|trash|untrash|batchDelete)\s*\(/,
      /messages\s*\.\s*(insert|import|delete)\b/, /threads\s*\.\s*(modify|trash|delete)\b/, /labels\s*\.\s*(create|update|patch|delete)\b/,
      /users\s*\.\s*settings\b/, /\bforward\w*\s*\(/i, /filters\s*\.\s*create\b/]) {
      expect(code).not.toMatch(re);
    }
  });
  test.each(FILES)('%s: never builds its own Gmail client', (file) => {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    expect(code).not.toMatch(/google\s*\.\s*gmail\s*\(/);
    expect(code).not.toMatch(/gmail\.googleapis\.com/);
    expect(code).not.toMatch(/from\s+['"]googleapis['"]/);
  });
  test.each(FILES)('%s: uses only the allowed gmail.js functions', (file) => {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    const named = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][./]*tools\/gmail\.js['"]/g)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const viaDynamic = [...code.matchAll(/\(await\s+gmail\(\)\)\.(\w+)/g)].map(m => m[1]);
    for (const name of [...named, ...viaDynamic]) expect(ALLOWED_GMAIL.has(name)).toBe(true);
  });
});

// ── Reply detection ─────────────────────────────────────────────────────────
describe('replyState', () => {
  const parse = (msgs) => ({ messages: msgs.map(m => G.parseMessage(rawMessage(m), ME)) });
  const IN = (id, at) => ({ id, from: 'Neil <neil@client.ca>', at });
  const OUT = (id, at, labels = ['SENT']) => ({ id, from: `Steph Sang <${ME}>`, labels, at });

  test('inbound with no reply → replied false', () => {
    expect(G.replyState(parse([IN('a', 1000)]))).toMatchObject({ replied: false, latestInboundAt: 1000, latestReplyAt: null, latestInboundId: 'a' });
  });
  test('reply after the latest inbound → replied true', () => {
    expect(G.replyState(parse([IN('a', 1000), OUT('b', 2000)]))).toMatchObject({ replied: true, latestReplyAt: 2000 });
  });
  test('a new inbound after her reply → replied false again', () => {
    expect(G.replyState(parse([IN('a', 1000), OUT('b', 2000), IN('c', 3000)]))).toMatchObject({ replied: false, latestInboundId: 'c' });
  });
  test('a draft is not a reply', () => {
    expect(G.replyState(parse([IN('a', 1000), OUT('d', 2000, ['DRAFT'])]))).toMatchObject({ replied: false });
  });
  test('her own message without the SENT label still counts, by From address', () => {
    expect(G.replyState(parse([IN('a', 1000), OUT('b', 2000, ['INBOX'])]))).toMatchObject({ replied: true });
  });
  test('outbound only → replied null (nothing to reply to)', () => {
    expect(G.replyState(parse([OUT('b', 2000)]))).toMatchObject({ replied: null, latestInboundAt: null });
  });
  test('order of messages in the thread does not matter', () => {
    expect(G.replyState(parse([OUT('b', 2000), IN('a', 1000)]))).toMatchObject({ replied: true });
  });
});

// ── Parsing ─────────────────────────────────────────────────────────────────
describe('parseMessage', () => {
  test('plain-text body, attachments by name only', () => {
    const m = G.parseMessage(rawMessage({ id: 'a', from: 'x@y.ca', at: 1, text: 'Body here', files: ['contract.pdf'] }), ME);
    expect(m.body).toBe('Body here');
    expect(m.attachments).toEqual(['contract.pdf']);
    expect(m.from_user).toBe(false);
  });
  test('falls back to stripped HTML when there is no text part', () => {
    const m = G.parseMessage(rawMessage({ id: 'a', from: 'x@y.ca', at: 1, html: '<p>Hi <b>there</b></p><script>x()</script>' }), ME);
    expect(m.body).toBe('Hi there');
  });
});

// ── Drafts ──────────────────────────────────────────────────────────────────
describe('buildReplyRaw', () => {
  const inbound = G.parseMessage(rawMessage({ id: 'a', from: 'Ricky <ricky@cedar.ca>', at: 1, subject: 'Call today', msgId: '<m1@cedar.ca>', refs: '<m0@cedar.ca>' }), ME);

  test('threads the reply: To, Re: subject, In-Reply-To, References', () => {
    const raw = unb64(G.buildReplyRaw(inbound, 'Line one\nLine two'));
    expect(raw).toMatch(/^To: Ricky <ricky@cedar.ca>\r\n/);
    expect(raw).toContain('Subject: Re: Call today\r\n');
    expect(raw).toContain('In-Reply-To: <m1@cedar.ca>\r\n');
    expect(raw).toContain('References: <m0@cedar.ca> <m1@cedar.ca>\r\n');
    expect(raw).toMatch(/\r\n\r\nLine one\r\nLine two$/);
  });
  test('does not double the Re: prefix', () => {
    const re = { ...inbound, subject: 'RE: Call today' };
    expect(unb64(G.buildReplyRaw(re, 'x'))).toContain('Subject: RE: Call today\r\n');
  });
  test('strips CR/LF from header values (no header injection)', () => {
    const evil = { ...inbound, subject: 'Hi\r\nBcc: attacker@evil.com', from: 'a@b.ca\nBcc: x@evil.com' };
    const raw = unb64(G.buildReplyRaw(evil, 'x'));
    const headerBlock = raw.split('\r\n\r\n')[0];
    expect(headerBlock.split('\r\n').some(l => /^Bcc:/i.test(l))).toBe(false);
  });
  test('non-ASCII subject is RFC 2047 encoded', () => {
    const raw = unb64(G.buildReplyRaw({ ...inbound, subject: 'Québec' }, 'x'));
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  });
  test('createDraftReply refuses an empty body and a thread with no inbound', async () => {
    await expect(G.createDraftReply(1, 't', '  ', { gmail: fakeGmail(), query: connectedQuery })).rejects.toThrow(/bodyText/);
    const thread = { id: 't', messages: [rawMessage({ id: 'o', from: ME, labels: ['SENT'], at: 1 })] };
    await expect(G.createDraftReply(1, 't', 'hi', { gmail: fakeGmail({ thread }), query: connectedQuery, userEmail: ME }))
      .rejects.toThrow(/no inbound/);
  });
});

// ── Listing ─────────────────────────────────────────────────────────────────
describe('listThreadsSince', () => {
  test('one list per label, merged by thread id, missing label reported, after: in epoch seconds', async () => {
    const gmail = fakeGmail({
      labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'Label_7', name: 'Former staff' }],
      threadsByLabel: { INBOX: [{ id: 't1', snippet: 's1' }, { id: 't2' }], Label_7: [{ id: 't2' }, { id: 't3' }] }
    });
    const r = await G.listThreadsSince(1, new Date('2026-10-19T00:00:00Z'), undefined, { gmail, query: connectedQuery });
    expect(r.threads.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(r.threads.find(t => t.id === 't2').labels).toEqual(['INBOX', 'Former staff']);
    expect(r.missingLabels).toEqual(['Notifications']);
    expect(gmail.listThreads).toHaveBeenCalledTimes(2);
    expect(gmail.listThreads.mock.calls[0][0].q).toBe(`after:${Date.parse('2026-10-19T00:00:00Z') / 1000}`);
  });
  test('rejects an unreadable since', async () => {
    await expect(G.listThreadsSince(1, 'yesterday-ish', undefined, { gmail: fakeGmail(), query: connectedQuery })).rejects.toThrow(/since/);
  });
});

// ── Opt-in ──────────────────────────────────────────────────────────────────
describe('hasGmailScopes and the connection gate', () => {
  const q = (row) => jest.fn(async () => ({ rows: row ? [row] : [] }));

  test('connected: column set and both scopes held', async () => {
    expect((await G.hasGmailScopes(1, { query: connectedQuery })).ok).toBe(true);
  });
  test('scopes held but never opted in → not connected', async () => {
    const r = await G.hasGmailScopes(1, { query: q({ google_granted_scopes: SCOPES, gmail_connected_at: null }) });
    expect(r.ok).toBe(false);
  });
  test('opted in but compose revoked → not connected, compose missing', async () => {
    const r = await G.hasGmailScopes(1, { query: q({ google_granted_scopes: 'https://www.googleapis.com/auth/gmail.readonly', gmail_connected_at: new Date() }) });
    expect(r).toMatchObject({ ok: false, missing: ['https://www.googleapis.com/auth/gmail.compose'] });
    expect(r.connectUrl).toMatch(/\/api\/auth\/gmail$/);
  });
  test('unknown user → not connected', async () => {
    expect((await G.hasGmailScopes(99, { query: q(null) })).ok).toBe(false);
  });
  test('every entry point refuses before touching Gmail when not connected', async () => {
    const gmail = fakeGmail();
    const notConnected = q({ google_granted_scopes: null, gmail_connected_at: null });
    await expect(G.listThreadsSince(1, Date.now(), undefined, { gmail, query: notConnected })).rejects.toBeInstanceOf(G.GmailNotConnectedError);
    await expect(G.getThread(1, 't', { gmail, query: notConnected })).rejects.toBeInstanceOf(G.GmailNotConnectedError);
    await expect(G.createDraftReply(1, 't', 'hi', { gmail, query: notConnected })).rejects.toBeInstanceOf(G.GmailNotConnectedError);
    Object.values(gmail).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });
});

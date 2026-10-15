/**
 * control-centre digest themes (migration 046): rows from a built digest,
 * the summary backfill parser, the week-replacing write, and the Overview read
 * (internal tag, toggle data). Fixtures only — no DB, no model.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-digest-themes.test.js
 */

import { jest } from '@jest/globals';
import {
  rowsFromDigest, parseDigestSummary, rowsFromSummary, saveDigestThemes, saveBackfill, latestDigest,
  DELETE_WEEK_THEMES_SQL, DELETE_WEEK_QUESTIONS_SQL, INSERT_THEME_SQL, INSERT_QUESTION_SQL,
  LATEST_WEEK_SQL, WEEK_THEMES_SQL, WEEK_QUESTIONS_SQL
} from '../../src/control-centre/digest-themes.js';

const built = {
  monday: '2026-10-12',
  askedBy: ['user_a', null, 'user_staff'],
  themes: { status: 'ok', themes: [
    { name: 'Hiring', takeaway: 'Hiring money.', questions: ['q1', '(not rewritten — left out)'], items: [{ id: 1, text: 'Any hiring grants for [company]?' }] },
    { name: 'Other', takeaway: 'Questions not placed in a theme.', questions: ['q3'], items: [{ id: 3, text: 'Is CanExport open?' }] }
  ] }
};

// The stored summary of the real Oct 5–11 digest (pulse_posts), abridged to its themes section.
const SUMMARY = `📊 GetGranted weekly — Oct 5 to Oct 11

**Usage**
• Chat users: 7 (+4, +133% vs week before)

**What clients asked**
• Broad eligibility overview (6) — Clients asked what grants they qualify for; assistant consistently started by loading their profile. e.g. "What grants am I most eligible for?"
• Hiring and training grants (6) — Clients asked about hiring or training support. e.g. "What grants could help me hire and train a new engineer this year, and which one would you apply for first?"
• Other (2) — Questions not placed in a theme. e.g. "My revenues were $300K"

**Most-matched grants**
• Career Ready Student Work Placement Program (SWPP) — matched to 5 companies (+1, +25% vs week before)`;

function fakeTx() {
  const calls = [];
  const client = { query: jest.fn(async (sql, p) => { calls.push([sql, p]); return { rows: [] }; }) };
  return { calls, hubTransaction: (cb) => cb(client) };
}

describe('rowsFromDigest', () => {
  test('one row per theme; one per rewritten question, with who asked and their company', () => {
    const { themes, questions } = rowsFromDigest(built, new Map([['user_a', 120], ['user_staff', 81]]));
    expect(themes).toEqual([
      { week_start: '2026-10-12', position: 1, name: 'Hiring', question_count: 2, takeaway: 'Hiring money.', source: 'digest' },
      { week_start: '2026-10-12', position: 2, name: 'Other', question_count: 1, takeaway: 'Questions not placed in a theme.', source: 'digest' }
    ]);
    expect(questions).toEqual([
      { week_start: '2026-10-12', theme_position: 1, question: 'Any hiring grants for [company]?', question_order: 1, clerk_id: 'user_a', company_id: 120, source: 'digest' },
      { week_start: '2026-10-12', theme_position: 2, question: 'Is CanExport open?', question_order: 3, clerk_id: 'user_staff', company_id: 81, source: 'digest' }
    ]);
  });
});

describe('saveDigestThemes', () => {
  test('replaces the week in one transaction: delete, then insert', async () => {
    const tx = fakeTx();
    const identities = jest.fn(async () => new Map([['user_a', { company_id: 120 }], ['user_staff', { company_id: 81 }]]));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const n = await saveDigestThemes(built, { hubTransaction: tx.hubTransaction, identities });
    log.mockRestore();
    expect(n).toEqual({ themes: 2, questions: 2 });
    expect(identities).toHaveBeenCalledWith(['user_a', 'user_staff']);
    expect(tx.calls.map(([sql]) => sql)).toEqual([DELETE_WEEK_QUESTIONS_SQL, DELETE_WEEK_THEMES_SQL, INSERT_THEME_SQL, INSERT_THEME_SQL, INSERT_QUESTION_SQL, INSERT_QUESTION_SQL]);
    expect(tx.calls[4][1]).toEqual(['2026-10-12', 1, 'Any hiring grants for [company]?', 1, 'user_a', 120, 'digest']);
  });

  test('without the app DB the Clerk id is still kept, company null', async () => {
    const tx = fakeTx();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await saveDigestThemes(built, { hubTransaction: tx.hubTransaction, identities: async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); } });
    warn.mockRestore(); log.mockRestore();
    expect(tx.calls[4][1].slice(4, 6)).toEqual(['user_a', null]);
  });
});

describe('backfill from pulse_posts.summary', () => {
  test('parses theme name, count, takeaway and the example question; stops at the next section', () => {
    const parsed = parseDigestSummary(SUMMARY);
    expect(parsed.map((t) => [t.name, t.count])).toEqual([['Broad eligibility overview', 6], ['Hiring and training grants', 6], ['Other', 2]]);
    expect(parsed[0].takeaway).toBe('Clients asked what grants they qualify for; assistant consistently started by loading their profile.');
    expect(parsed[2].example).toBe('My revenues were $300K');
  });

  test('a summary with no themes section, or a failed themes call, gives nothing', () => {
    expect(parseDigestSummary('**Usage**\n• Chat users: 1')).toEqual([]);
    expect(parseDigestSummary('**What clients asked**\nThemes unavailable this week (code: 529).')).toEqual([]);
  });

  test('backfilled rows carry no client and are marked as backfill', async () => {
    const rows = rowsFromSummary('2026-10-05', parseDigestSummary(SUMMARY));
    expect(rows.themes.every((t) => t.source === 'backfill_summary')).toBe(true);
    expect(rows.questions).toHaveLength(3);
    expect(rows.questions.every((q) => q.clerk_id === null && q.company_id === null)).toBe(true);
    const tx = fakeTx();
    expect(await saveBackfill('2026-10-05', parseDigestSummary(SUMMARY), { hubTransaction: tx.hubTransaction })).toEqual({ themes: 3, questions: 3 });
  });
});

describe('latestDigest', () => {
  test('the latest week, themes with internal counts, newest questions named and tagged', async () => {
    const hubQuery = jest.fn(async (sql) => {
      if (sql === LATEST_WEEK_SQL) return { rows: [{ week: '2026-10-12' }] };
      if (sql === WEEK_THEMES_SQL) return { rows: [{ position: 1, name: 'Hiring', question_count: 2, takeaway: 'Hiring money.', source: 'digest' }, { position: 2, name: 'Other', question_count: 1, takeaway: null, source: 'digest' }] };
      if (sql === WEEK_QUESTIONS_SQL) return { rows: [
        { theme_position: 2, question: 'Is CanExport open?', question_order: 3, company_id: 81, source: 'digest' },
        { theme_position: 1, question: 'Any hiring grants for [company]?', question_order: 1, company_id: 120, source: 'digest' }
      ] };
      throw new Error('unexpected');
    });
    const appQuery = jest.fn(async () => ({ rows: [{ id: 81, name: 'Maximizer' }, { id: 120, name: 'Acme' }] }));
    const d = await latestDigest({ hubQuery, appQuery });
    expect(d).toMatchObject({ week_start: '2026-10-12', week_end: '2026-10-18', source: 'digest' });
    expect(d.themes).toEqual([
      { name: 'Hiring', count: 2, takeaway: 'Hiring money.', internal_count: 0 },
      { name: 'Other', count: 1, takeaway: null, internal_count: 1 }
    ]);
    expect(d.recent_questions[0]).toMatchObject({ text: 'Is CanExport open?', theme: 'Other', company_id: 81, company_name: 'Maximizer', company_internal: true, linked: true });
    expect(d.recent_questions[1]).toMatchObject({ company_name: 'Acme', company_internal: false });
  });

  test('nothing stored → null', async () => {
    expect(await latestDigest({ hubQuery: async () => ({ rows: [{ week: null }] }) })).toBeNull();
  });

  test('every statement it reads with is a SELECT', () => {
    for (const sql of [LATEST_WEEK_SQL, WEEK_THEMES_SQL, WEEK_QUESTIONS_SQL]) expect(sql.trim()).toMatch(/^SELECT/);
  });
});

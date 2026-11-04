/**
 * The lead-gen prompt follows the session's matcher stamp.
 *
 * - selectMatcherBlocks / loadAgentPrompt (src/agents/load-agents.js): Variant B
 *   marks the search_getgranted text legacy-only. A legacy session gets the
 *   files exactly as written minus the marker lines; a gg3 session never sees
 *   search_getgranted.
 * - loadAgentPromptCached keeps one cached prompt per matcher.
 * - getLeadGenMatcher (src/utils/lead-gen-context.js) reads the stamp; anything
 *   missing or failing is legacy.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-matcher-prompt.test.js
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));

const { query } = await import('../../src/database/connection.js');
const { loadAgentPrompt, loadAgentPromptCached, clearPromptCache, selectMatcherBlocks } = await import('../../src/agents/load-agents.js');
const { getLeadGenMatcher } = await import('../../src/utils/lead-gen-context.js');

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.claude/skills/lead-gen-variant-b');
const FILES = ['base-system-prompt.md', 'client-communication.md', 'system-operations.md'];
const MARKER = /^<!-- \/?(?:legacy|gg3)-matcher -->$/;

/** The files as written, with gg3 blocks removed and every marker line gone. */
function expectedLegacy() {
  return FILES.map((f) => {
    const out = [];
    let inGg3 = false;
    for (const line of fs.readFileSync(path.join(SKILLS, f), 'utf-8').split('\n')) {
      if (line === '<!-- gg3-matcher -->') { inGg3 = true; continue; }
      if (line === '<!-- /gg3-matcher -->') { inGg3 = false; continue; }
      if (inGg3 || MARKER.test(line)) continue;
      out.push(line);
    }
    return out.join('\n').trim();
  }).join('\n\n---\n\n');
}

const savedVariant = process.env.LEAD_GEN_VARIANT;
const savedEnv = process.env.NODE_ENV;
beforeAll(() => { process.env.LEAD_GEN_VARIANT = 'B'; });
afterAll(() => {
  if (savedVariant === undefined) delete process.env.LEAD_GEN_VARIANT; else process.env.LEAD_GEN_VARIANT = savedVariant;
  process.env.NODE_ENV = savedEnv;
});
beforeEach(() => { query.mockReset(); });

describe('selectMatcherBlocks', () => {
  const text = 'a\n<!-- legacy-matcher -->\nL\n<!-- /legacy-matcher -->\n<!-- gg3-matcher -->\nG\n<!-- /gg3-matcher -->\nb\n';
  test('legacy keeps legacy text, drops gg3 text and every marker', () => {
    expect(selectMatcherBlocks(text, 'legacy')).toBe('a\nL\nb\n');
  });
  test('gg3 keeps gg3 text, drops legacy text and every marker', () => {
    expect(selectMatcherBlocks(text, 'gg3')).toBe('a\nG\nb\n');
  });
  test('anything but gg3 is legacy; unmarked text is untouched', () => {
    expect(selectMatcherBlocks(text, undefined)).toBe('a\nL\nb\n');
    expect(selectMatcherBlocks('plain\ntext\n', 'gg3')).toBe('plain\ntext\n');
  });
});

describe('Variant B prompt per matcher', () => {
  test('a gg3 prompt never mentions search_getgranted', () => {
    const gg3 = loadAgentPrompt('lead-gen', { matcher: 'gg3' });
    expect(gg3).not.toContain('search_getgranted');
    expect(gg3).not.toMatch(/-matcher -->/);
    expect(gg3).toContain('<precomputed_estimate>');
    expect(gg3).toContain('Flow: the Funding estimate in <lead_info> →');
    expect(gg3).not.toContain('<search_strategy>');
    expect(gg3).not.toContain('<accuracy>');
  });

  test('a legacy prompt is the files as written, minus only the marker lines', () => {
    const legacy = loadAgentPrompt('lead-gen', { matcher: 'legacy' });
    expect(legacy).toBe(expectedLegacy());
    expect(legacy).toContain('Call search_getgranted ONCE with minimal parameters');
    expect(legacy).toContain('Flow: search_getgranted (2x) → estimate →');
    expect(legacy).not.toContain('Flow: the Funding estimate in <lead_info>');
    expect(legacy).not.toMatch(/-matcher -->/);
  });

  test('no matcher given → legacy', () => {
    expect(loadAgentPrompt('lead-gen')).toBe(loadAgentPrompt('lead-gen', { matcher: 'legacy' }));
  });

  test('in production, gg3 and legacy are cached separately', () => {
    process.env.NODE_ENV = 'production';
    clearPromptCache();
    const legacy = loadAgentPromptCached('lead-gen', { matcher: 'legacy' });
    const gg3 = loadAgentPromptCached('lead-gen', { matcher: 'gg3' });
    expect(gg3).not.toBe(legacy);
    expect(loadAgentPromptCached('lead-gen', { matcher: 'legacy' })).toBe(legacy);
    expect(loadAgentPromptCached('lead-gen')).toBe(legacy);
    clearPromptCache();
    process.env.NODE_ENV = savedEnv;
  });
});

describe('getLeadGenMatcher', () => {
  test('a gg3-stamped session → gg3', async () => {
    query.mockResolvedValueOnce({ rows: [{ prospect_data: { lead_gen_matcher: 'gg3' } }] });
    expect(await getLeadGenMatcher('s1')).toBe('gg3');
  });
  test('no stamp, no row, no id or a DB error → legacy', async () => {
    query.mockResolvedValueOnce({ rows: [{ prospect_data: { industry: 'Retail' } }] });
    expect(await getLeadGenMatcher('s1')).toBe('legacy');
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getLeadGenMatcher('s2')).toBe('legacy');
    expect(await getLeadGenMatcher(null)).toBe('legacy');
    query.mockRejectedValueOnce(new Error('db down'));
    expect(await getLeadGenMatcher('s3')).toBe('legacy');
  });
});

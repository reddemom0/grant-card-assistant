/**
 * The Hub's copy of the engine's industry vocabulary
 * (src/control-centre/industry-vocabulary.js) must equal gg3-ai-service
 * src/lib/matching/vocabulary.ts: the 12 main industries, the token → main
 * table and the profile aliases. Reads the sibling repo from disk; skipped
 * (with a message) when it isn't there, e.g. on Railway.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-industry-vocabulary.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const V = await import('../../src/control-centre/industry-vocabulary.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.GG3_AI_SERVICE_DIR
  ? path.join(process.env.GG3_AI_SERVICE_DIR, 'src/lib/matching/vocabulary.ts')
  : path.resolve(here, '../../../gg3-ai-service/src/lib/matching/vocabulary.ts');
const present = fs.existsSync(SOURCE);
if (!present) console.warn(`industry vocabulary drift check skipped: ${SOURCE} not found`);

/** The three literals, read the same way they were copied. */
function parse(src) {
  const block = (start, end) => {
    const i = src.indexOf(start);
    if (i < 0) throw new Error(`vocabulary.ts no longer has: ${start}`);
    return src.slice(i + start.length, src.indexOf(end, i));
  };
  return {
    mains: [...block('export const CANONICAL_INDUSTRIES = [', '] as const').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    map: Object.fromEntries([...block('const GRANT_INDUSTRY_TO_CANONICAL: Record<string, readonly CanonicalIndustry[]> = {', '\n};')
      .matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])])),
    aliases: Object.fromEntries([...block('const PROFILE_INDUSTRY_ALIASES: Record<string, CanonicalIndustry> = {', '\n};')
      .matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
  };
}

(present ? describe : describe.skip)('industry vocabulary matches gg3-ai-service', () => {
  const src = present ? parse(fs.readFileSync(SOURCE, 'utf8')) : null;
  test('the 12 main industries', () => { expect([...V.MAIN_INDUSTRIES]).toEqual(src.mains); });
  test('every token and its main industries', () => { expect({ ...V.TOKEN_TO_MAINS }).toEqual(src.map); });
  test('the profile aliases', () => { expect({ ...V.PROFILE_ALIASES }).toEqual(src.aliases); });
});

describe('the copy itself', () => {
  test('12 mains, 84 tokens, every mapped main is a main industry', () => {
    expect(V.MAIN_INDUSTRIES).toHaveLength(12);
    expect(Object.keys(V.TOKEN_TO_MAINS)).toHaveLength(84);
    for (const mains of Object.values(V.TOKEN_TO_MAINS)) for (const m of mains) expect(V.MAIN_INDUSTRIES).toContain(m);
  });
  test('profileMains follows the engine: alias, then main name, then token, case-insensitive', () => {
    expect(V.profileMains('Software and IT')).toEqual(['Software']);
    expect(V.profileMains('software')).toEqual(['Software']);
    expect(V.profileMains('TECH - AI')).toEqual(['Software']);
    expect(V.profileMains('Tech - Video Game')).toEqual(['Software', 'Digital Media']);
    expect(V.profileMains('Charity/Non-profit')).toEqual([]);
    expect(V.profileMains('')).toEqual([]);
  });
});

/**
 * Per-user writing-style guides for drafting email AS that user.
 *
 * Gated by email on purpose: the guide files live under .claude/skills/ but are
 * NOT registered in SKILL_PATHS / the load_skill enums, so no agent can load
 * them through load_skill — any agent can load any registered skill, which
 * would let anyone's Oracle write in Steph's voice. The only way in is this
 * function, called by the brief that drafts for that user (Stage 2).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.claude/skills');

/** email (lowercase) → guide file under .claude/skills/ */
export const STYLE_GUIDES = Object.freeze({
  'ssang@granted.ca': 'steph-writing-voice/voice-guide.md'
});

const cache = new Map();

/**
 * The style guide for this user, or null if they have none.
 * @param {string} email
 * @returns {string|null}
 */
export function loadStyleGuide(email) {
  const key = String(email || '').trim().toLowerCase();
  const file = STYLE_GUIDES[key];
  if (!file) return null;
  if (!cache.has(key)) cache.set(key, readFileSync(join(SKILLS_DIR, file), 'utf8'));
  return cache.get(key);
}

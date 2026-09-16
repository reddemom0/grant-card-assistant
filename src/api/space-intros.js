/**
 * What Oracle says when it is added to a Chat space
 *
 * The text lives in data/chat/space-intros.json so it can be edited without
 * touching code. This module only resolves it: pick the right intro for a space,
 * fill in the name when there is no specific one, and append the shared closing.
 *
 * Separate from chat-google.js so the resolution is testable on its own, without
 * a Chat payload or a posting client.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazily read once per process, like data/rates in src/services/grant-categorization.js.
let intros = null;

function load() {
  if (intros) return intros;
  const path = join(__dirname, '../../data/chat/space-intros.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));

  // Lowercase the keys once, so lookup is case-insensitive without rescanning.
  const byName = new Map(
    Object.entries(raw.spaces || {}).map(([name, text]) => [name.trim().toLowerCase(), text])
  );

  intros = { closing: raw.closing || '', generic: raw.generic || '', byName };
  return intros;
}

/**
 * The intro to post when Oracle is added to a space.
 *
 * @param {Object} params
 * @param {string} [params.displayName] - the space's display name
 * @param {boolean} [params.isDm] - a direct message, where an intro would be noise
 * @returns {string|null} the message to post, or null when there should be none
 */
export function resolveSpaceIntro({ displayName, isDm } = {}) {
  // A DM is already one-to-one; announcing yourself to someone who just opened a
  // conversation with you adds nothing.
  if (isDm) return null;

  const { closing, generic, byName } = load();
  const key = String(displayName || '').trim().toLowerCase();
  const specific = key ? byName.get(key) : null;

  const body = specific
    || generic.replace('{space}', String(displayName || '').trim() || 'this space');

  return closing ? `${body}\n\n${closing}` : body;
}

/** Space names with a hand-written intro. Exported for tests and diagnostics. */
export function knownSpaceNames() {
  return [...load().byName.keys()];
}

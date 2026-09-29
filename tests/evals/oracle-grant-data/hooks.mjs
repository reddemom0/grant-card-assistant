/**
 * Module hooks for the Oracle grant-data eval (registered by run.mjs).
 *
 * Swaps four modules for stubs so a run can't write anything:
 *   src/tools/executor.js             → stubs/executor.mjs (read tools only)
 *   src/database/messages.js          → stubs/messages.mjs (kept in memory)
 *   src/database/learning-tracking.js → stubs/learning-tracking.mjs (no-op)
 *   src/database/api-cost-events.js   → stubs/api-cost-events.mjs (no-op)
 * Anything else that tries to write fails on the read-only database session.
 * A stub loads the real module as "<path>?real", which passes through untouched.
 */

const STUBS = {
  '/src/tools/executor.js': './stubs/executor.mjs',
  '/src/database/messages.js': './stubs/messages.mjs',
  '/src/database/learning-tracking.js': './stubs/learning-tracking.mjs',
  '/src/database/api-cost-events.js': './stubs/api-cost-events.mjs'
};

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (!resolved.url.startsWith('file:')) return resolved;
  const url = new URL(resolved.url);
  if (url.search === '?real') return resolved;
  for (const [suffix, stub] of Object.entries(STUBS)) {
    if (url.pathname.endsWith(suffix)) {
      return { url: new URL(stub, import.meta.url).href, shortCircuit: true };
    }
  }
  return resolved;
}

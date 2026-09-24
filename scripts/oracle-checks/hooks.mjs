/**
 * Module hooks for read-only Oracle runs.
 *
 * - Every `pg` import resolves to pg-stub.mjs, so no module — including the ones that
 *   open their own Pool (learning-tracking, sentiment, memory…) — can write to the
 *   database. Reads pass through; writes are logged and dropped.
 * - src/tools/executor.js resolves to exec-stub.mjs, which only lets read-type tools run.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXECUTOR = path.join(REPO, 'src/tools/executor.js');
const PG_STUB = new URL('./pg-stub.mjs', import.meta.url).href;
const EXEC_STUB = new URL('./exec-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pg' && context.parentURL !== PG_STUB) return { url: PG_STUB, shortCircuit: true };
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.startsWith('file://') && !resolved.url.includes('?real')
      && fileURLToPath(resolved.url) === EXECUTOR) {
    return { url: EXEC_STUB, shortCircuit: true };
  }
  return resolved;
}

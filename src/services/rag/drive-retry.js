/**
 * Granted Files RAG — Drive pacing and retry
 *
 * The pattern from scripts/gdrive-org-inventory.mjs, for googleapis calls: Google
 * signals read throttling with 403 userRateLimitExceeded / rateLimitExceeded, not
 * only 429, so a 403 is retried only when its reason says throttling. 429, 5xx and
 * timeouts are retried too, with exponential backoff (2 s doubling to 64 s, plus
 * jitter, retry-after honoured), 8 attempts in all.
 *
 * Every call also waits on a shared limiter so the whole run stays at or under
 * ~4 Drive requests per second.
 */

const RETRYABLE_403 = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded', 'backendError']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Spaces calls at least `1000 / perSecond` ms apart across all callers. */
export function createLimiter(perSecond = 4, { now = Date.now, wait = sleep } = {}) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + gap;
    if (at > t) await wait(at - t);
  };
}

const statusOf = (err) => Number(err?.response?.status || err?.code) || 0;
const reasonOf = (err) => err?.errors?.[0]?.reason || err?.response?.data?.error?.errors?.[0]?.reason || '';

/** Should this googleapis error be retried? */
export function isRetryable(err) {
  const status = statusOf(err);
  if (status === 403) return RETRYABLE_403.has(reasonOf(err));
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return err?.name === 'TimeoutError' || ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(err?.code)
    || /socket hang up|fetch failed|network/i.test(err?.message || '');
}

/**
 * Run `fn` (one Drive request) under the limiter, retrying throttles and transient errors.
 * @param {() => Promise<any>} fn
 * @param {{limiter?: Function, attempts?: number, wait?: Function, onRetry?: Function}} [opts]
 */
export async function withDriveRetry(fn, { limiter = async () => {}, attempts = 8, wait = sleep, onRetry = () => {} } = {}) {
  let delay = 2000;
  for (let i = 1; ; i++) {
    await limiter();
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || i >= attempts) throw err;
      const retryAfter = Number(err?.response?.headers?.['retry-after'] || 0) * 1000;
      const ms = retryAfter || delay + Math.floor(Math.random() * 500);
      onRetry({ attempt: i, status: statusOf(err) || err?.code || err?.name, ms });
      await wait(ms);
      delay = Math.min(delay * 2, 64000);
    }
  }
}

/**
 * Granted Files RAG — Voyage embeddings
 *
 * One model everywhere for this index: voyage-3.5 at 512 dimensions, stored as
 * halfvec(512). Documents are embedded with input_type "document", questions with
 * "query". Returns Voyage's own token count, which the cost report uses.
 * 429 and 5xx back off and retry; a rejected key stops the run and never echoes
 * the key.
 */

import { VoyageAIClient } from 'voyageai';

export const MODEL = 'voyage-3.5';
export const DIMENSIONS = 512;
/** List price per million tokens (before any free-tier allowance). */
export const USD_PER_MILLION = 0.06;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class VoyageKeyError extends Error {
  constructor() {
    super('Voyage key rejected (value not shown)');
    this.code = 'voyage_key';
  }
}

let client = null;
function voyage() {
  if (!process.env.VOYAGE_API_KEY) throw Object.assign(new Error('VOYAGE_API_KEY is not set'), { code: 'voyage_key' });
  client ||= new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
  return client;
}

const statusOf = (err) => Number(err?.statusCode || err?.status || err?.response?.status) || 0;

async function embed(input, inputType, { attempts = 8, wait = sleep, api = null } = {}) {
  const call = api || ((req) => voyage().embed(req));
  let delay = 2000;
  for (let i = 1; ; i++) {
    try {
      const res = await call({ input, model: MODEL, inputType, outputDimension: DIMENSIONS });
      const vectors = (res.data || []).sort((a, b) => a.index - b.index).map(d => d.embedding);
      if (vectors.length !== input.length || vectors.some(v => v?.length !== DIMENSIONS)) {
        throw Object.assign(new Error('unexpected embedding shape'), { code: 'voyage_shape' });
      }
      return { vectors, tokens: res.usage?.totalTokens ?? 0 };
    } catch (err) {
      const status = statusOf(err);
      if (status === 401 || status === 403) throw new VoyageKeyError();
      const retryable = status === 429 || (status >= 500 && status < 600) || err?.name === 'TimeoutError' || /fetch failed|ECONNRESET|socket/i.test(err?.message || '');
      if (!retryable || i >= attempts) throw err;
      await wait(delay + Math.floor(Math.random() * 500));
      delay = Math.min(delay * 2, 64000);
    }
  }
}

/** @param {string[]} texts @returns {Promise<{vectors: number[][], tokens: number}>} */
export const embedDocuments = (texts, opts) => embed(texts, 'document', opts);

/** @param {string} text @returns {Promise<{vector: number[], tokens: number}>} */
export async function embedQuery(text, opts) {
  const { vectors, tokens } = await embed([text], 'query', opts);
  return { vector: vectors[0], tokens };
}

/** Postgres halfvec literal. */
export const toHalfvec = (vector) => `[${vector.join(',')}]`;

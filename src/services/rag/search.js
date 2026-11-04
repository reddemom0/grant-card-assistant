/**
 * Granted Files RAG — search (Oracle's search_granted_files)
 *
 * Embed the query (voyage-3.5, 512, input_type "query"), take the 30 closest
 * chunks by exact cosine from indexed canonical files, add scanned (name-only)
 * files whose name or folder matches, rerank everything with Voyage
 * rerank-2.5-lite, apply a small recency boost and an Old Files penalty, and
 * group the best chunks by file.
 *
 * Nothing here logs: the query and snippets are user content. The caller logs
 * counts and timings from `stats`. Snippets were redacted at index time.
 */

import { openUrl } from '../../cards/doc-links.js';

export const DEFAULTS = Object.freeze({
  k: 30,                    // chunks from the cosine search
  scannedK: 10,             // scanned name-only candidates
  rerankTop: 12,            // chunks kept from the rerank
  limit: 8,                 // chunks across all files returned
  maxFiles: 6,
  snippetsPerFile: 2,
  snippetChars: 300,
  rerankFloor: 0.5,         // below this a reranked chunk is noise (eval: irrelevant ≤ 0.44, relevant 0.67+)
  scannedRerankMin: 0.5,    // a scanned file must match its name/folder this well
  cosineFloor: 0.55,        // floor when rerank is off (eval: irrelevant ≤ 0.50)
  scannedCoverage: 0.6,     // share of query words a scanned file's name/folder must hold when rerank is off
  recency: 0.02,            // up to +0.02 for 2026 vs 2019
  oldFilesPenalty: 0.03
});

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'our', 'that', 'this', 'what', 'have', 'how', 'show',
  'example', 'examples', 'strong', 'good', 'who', 'did', 'does', 'are', 'was', 'were', 'been', 'into', 'about',
  'any', 'all', 'can', 'you', 'your', 'find', 'give', 'need', 'some', 'use', 'used', 'done', 'past']);

/** Plain query words worth matching on file names (3+ letters, no stop words). */
export function terms(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(w => !STOP.has(w));
}

/** Share of the query words found in `text`. */
export function coverage(queryTerms, text) {
  if (!queryTerms.length) return 0;
  const words = new Set(terms(text));
  return queryTerms.filter(t => words.has(t)).length / queryTerms.length;
}

/** About `n` characters, cut at a word. */
export function snippet(text, n = DEFAULTS.snippetChars) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const space = cut.lastIndexOf(' ');
  return `${space > n * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Relevance plus a small recency boost, minus a small Old Files penalty. */
export function boosted(score, { area, year }, o = DEFAULTS) {
  const recency = year ? Math.min(1, Math.max(0, (Number(year) - 2019) / 7)) : 0;
  return score + o.recency * recency - (area === 'Old Files' ? o.oldFilesPenalty : 0);
}

export function labelFor({ area, year, scanned }) {
  if (scanned) return 'scanned file — name only';
  if (area === 'Old Files') return year ? `older material (${year})` : 'older material';
  return null;
}

/**
 * Hits (best first) → files in order of their best hit, each with up to
 * `snippetsPerFile` snippets, at most `maxFiles` files.
 */
export function groupByFile(hits, o = DEFAULTS) {
  const files = new Map();
  for (const h of hits) {
    let f = files.get(h.file_id);
    if (!f) {
      if (files.size >= o.maxFiles) continue;
      f = {
        file_id: h.file_id, name: h.name, link: openUrl({ fileId: h.file_id }), path: h.path, area: h.area,
        year: h.year ?? null, label: labelFor(h), locators: [], snippets: [], chunks: 0, score: +h.final.toFixed(3)
      };
      files.set(h.file_id, f);
    }
    f.chunks++;
    if (h.scanned) continue;
    if (h.locator && !f.locators.includes(h.locator)) f.locators.push(h.locator);
    if (f.snippets.length < o.snippetsPerFile) f.snippets.push({ locator: h.locator || null, text: snippet(h.text, o.snippetChars) });
  }
  return [...files.values()];
}

/** Keep files in order until `limit` chunks (a scanned file counts as one) or `maxFiles` files. */
export function trimResults(files, { limit = DEFAULTS.limit, maxFiles = DEFAULTS.maxFiles } = {}) {
  const out = [];
  let used = 0;
  for (const f of files) {
    if (out.length >= maxFiles || used >= limit) break;
    out.push(f);
    used += Math.max(1, f.chunks);
  }
  return out.map(({ chunks, ...f }) => f);
}

async function loadDeps() {
  const store = await import('./store.js');
  const voyage = await import('./voyage.js');
  return { searchChunks: store.searchChunks, scannedCandidates: store.scannedCandidates, embedQuery: voyage.embedQuery, rerank: voyage.rerank };
}

/**
 * Search the index. Returns more files than are shown (`maxFiles` 10) so the
 * caller can drop files the asker can't open, then `trimResults`.
 * @param {{area?, client?, program?, yearFrom?, yearTo?, rerank?: boolean}} [opts]
 * @returns {Promise<{files: Object[], stats: Object}>}
 */
export async function searchGrantedFiles(query, opts = {}, deps = null) {
  const o = { ...DEFAULTS, rerank: true, maxFiles: 10, limit: 20, ...opts };
  const d = deps || await loadDeps();
  const started = performance.now();
  const filters = { area: o.area, client: o.client, program: o.program, yearFrom: o.yearFrom, yearTo: o.yearTo };

  const { vector, tokens: queryTokens } = await d.embedQuery(query, { attempts: 3 });
  const sqlStart = performance.now();
  const queryTerms = terms(query);
  const [chunks, scanned] = await Promise.all([
    d.searchChunks(vector, { k: o.k, ...filters }),
    d.scannedCandidates(queryTerms, { limit: o.scannedK, ...filters })
  ]);
  const sqlMs = performance.now() - sqlStart;

  let hits;
  let rerankTokens = 0;
  if (o.rerank && (chunks.length || scanned.length)) {
    const docs = [
      ...chunks.map(c => `${c.name}${c.locator ? ` (${c.locator})` : ''}\n${c.text}`),
      ...scanned.map(s => `File: ${s.name}. Folder: ${s.path}`)
    ];
    const { ranked, tokens } = await d.rerank(query, docs, { topK: Math.min(docs.length, o.rerankTop + scanned.length) });
    rerankTokens = tokens;
    hits = ranked
      .map(({ index, score }) => (index < chunks.length ? { ...chunks[index], score } : { ...scanned[index - chunks.length], score, scanned: true }))
      .filter(h => h.score >= (h.scanned ? o.scannedRerankMin : o.rerankFloor));
  } else {
    hits = chunks.filter(c => c.score >= o.cosineFloor).map(c => ({ ...c }));
    if (queryTerms.length >= 2) {
      hits.push(...scanned.filter(s => coverage(queryTerms, `${s.name} ${s.path.replace(/\//g, ' ')}`) >= o.scannedCoverage)
        .map(s => ({ ...s, score: o.cosineFloor, scanned: true })));
    }
  }
  for (const h of hits) h.final = boosted(h.score, h, o);
  hits.sort((a, b) => b.final - a.final);

  const files = groupByFile(hits, o);
  return {
    files,
    stats: {
      candidates: chunks.length, scanned_candidates: scanned.length, hits: hits.length, files: files.length,
      ms_sql: Math.round(sqlMs), ms: Math.round(performance.now() - started), tokens: queryTokens + rerankTokens, rerank: Boolean(o.rerank)
    }
  };
}

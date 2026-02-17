/**
 * Lead-Gen Knowledge Base Search Tools
 *
 * Two lightweight search tools for the public lead-gen agent:
 *   - search_lead_gen_knowledge  — FAQ / prospect questions
 *   - search_lead_gen_strategy   — consulting frameworks / strategic insight
 *
 * Both share the same implementation:
 *   - JSON files loaded once on first call, cached in module scope
 *   - Keyword scoring: tokenize query → count overlaps with each entry's
 *     keywords array + topic/question fields → rank by score
 *   - Return top 1-2 entries (score > 0), or a fallback string
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Module-level caches (loaded once, kept for the lifetime of the process)
// ============================================================================

let kbCache = null;       // lead-gen-knowledge-base.json
let strategyCache = null; // lead-gen-strategy-knowledge.json

const KB_PATH       = path.join(__dirname, '../../data/lead-gen-knowledge-base.json');
const STRATEGY_PATH = path.join(__dirname, '../../data/lead-gen-strategy-knowledge.json');

const FALLBACK = 'No specific knowledge base entry found for this query. Use your general knowledge and the uncertainty protocol.';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Load a JSON file into memory (cached).
 */
function loadFile(filePath, cache) {
  if (cache !== null) return cache;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Failed to load knowledge base file: ${filePath}`, err.message);
    return [];
  }
}

/**
 * Tokenize a string into lowercase words, stripping punctuation.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score a knowledge base entry against a query.
 *
 * Scoring:
 *   - Each query token that appears in the entry's keywords array → +2 points
 *   - Each query token that appears in the entry's question/topic text → +1 point
 * This keeps keywords as the primary signal while letting topic text break ties.
 */
function scoreEntry(entry, queryTokens) {
  if (queryTokens.length === 0) return 0;

  const keywords  = (entry.keywords || []).map(k => k.toLowerCase());
  const topicText = tokenize([entry.topic, entry.question].filter(Boolean).join(' '));

  let score = 0;
  for (const token of queryTokens) {
    if (keywords.some(k => k.includes(token) || token.includes(k))) score += 2;
    if (topicText.includes(token)) score += 1;
  }

  return score;
}

/**
 * Core search: score all entries, return top N with score > 0.
 */
function search(entries, query, topN = 2) {
  const queryTokens = tokenize(query);

  const scored = entries
    .map(entry => ({ entry, score: scoreEntry(entry, queryTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(item => item.entry);

  return scored;
}

// ============================================================================
// Public functions
// ============================================================================

/**
 * Search the FAQ / prospect knowledge base.
 * @param {Object} input - { query: string }
 * @returns {Object} Search result
 */
export function searchLeadGenKnowledge({ query }) {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Missing required parameter: query' };
  }

  kbCache = loadFile(KB_PATH, kbCache);

  const results = search(kbCache, query);

  if (results.length === 0) {
    return { success: true, results: [], message: FALLBACK };
  }

  return {
    success: true,
    query,
    results,
    count: results.length
  };
}

/**
 * Search the strategic consulting knowledge base.
 * @param {Object} input - { query: string }
 * @returns {Object} Search result
 */
export function searchLeadGenStrategy({ query }) {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'Missing required parameter: query' };
  }

  strategyCache = loadFile(STRATEGY_PATH, strategyCache);

  const results = search(strategyCache, query);

  if (results.length === 0) {
    return { success: true, results: [], message: FALLBACK };
  }

  return {
    success: true,
    query,
    results,
    count: results.length
  };
}

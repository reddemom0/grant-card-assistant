/**
 * Tool Search Implementation
 *
 * Provides semantic search over tool definitions using pre-generated embeddings.
 * Reduces token usage by discovering tools on-demand instead of loading all tools upfront.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getToolDefinition } from './definitions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBEDDINGS_FILE = path.join(__dirname, 'tool-embeddings.json');

// Cache the embeddings in memory
let embeddingsCache = null;

/**
 * Load tool embeddings from file (cached)
 */
async function loadEmbeddings() {
  if (embeddingsCache) {
    return embeddingsCache;
  }

  try {
    const data = await fs.readFile(EMBEDDINGS_FILE, 'utf8');
    embeddingsCache = JSON.parse(data);
    console.log(`📦 Loaded ${embeddingsCache.tools.length} tool embeddings (${embeddingsCache.dimensions}D)`);
    return embeddingsCache;
  } catch (error) {
    console.error('❌ Failed to load tool embeddings:', error);
    throw new Error('Tool embeddings file not found. Run: node scripts/generate-tool-embeddings.js');
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Simple text-to-embedding using TF-IDF approximation
 * (Used when Python embedder is not available)
 */
function simpleTextEmbedding(text, dimension = 384) {
  // Normalize text
  const normalized = text.toLowerCase();

  // Create a deterministic hash-based embedding
  const embedding = new Array(dimension).fill(0);

  // Split into words and generate features
  const words = normalized.split(/\s+/);
  words.forEach((word, wordIndex) => {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    // Map hash to embedding dimensions
    const index = Math.abs(hash) % dimension;
    embedding[index] += 1.0 / (wordIndex + 1); // Weight by position
  });

  // Normalize the embedding
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

/**
 * Search for tools using semantic similarity
 *
 * @param {string} query - Natural language search query
 * @param {number} topK - Number of results to return
 * @param {Array<string>} excludeTools - Tool names to exclude from results
 * @returns {Promise<Array>} - Array of {toolName, score, definition} sorted by relevance
 */
export async function searchTools(query, topK = 5, excludeTools = []) {
  const embeddings = await loadEmbeddings();

  // Generate query embedding using simple method
  // (In production, we could call Python for better quality)
  const queryEmbedding = simpleTextEmbedding(query, embeddings.dimensions);

  // Calculate similarity scores
  const scores = embeddings.tools.map(tool => ({
    name: tool.name,
    score: cosineSimilarity(queryEmbedding, tool.embedding),
    text: tool.text
  }));

  // Filter out excluded tools
  const filtered = scores.filter(s => !excludeTools.includes(s.name));

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  // Take top K
  const topTools = filtered.slice(0, topK);

  // Get full tool definitions
  const results = topTools.map(item => {
    const definition = getToolDefinition(item.name);
    return {
      toolName: item.name,
      score: item.score,
      definition: definition
    };
  }).filter(r => r.definition !== null); // Filter out any missing definitions

  return results;
}

/**
 * Handle tool_search tool invocation
 *
 * @param {string} query - Search query from Claude
 * @param {number} topK - Number of tools to return
 * @param {Array<string>} excludeTools - Tools to exclude
 * @returns {Promise<Array>} - Array of tool_reference objects for Claude
 */
export async function handleToolSearch(query, topK = 5, excludeTools = []) {
  console.log(`\n🔍 Tool search: "${query}" (top_k=${topK})`);

  const results = await searchTools(query, topK, excludeTools);

  console.log('   Found tools:');
  results.forEach((result, index) => {
    console.log(`   ${index + 1}. ${result.toolName} (similarity: ${result.score.toFixed(3)})`);
  });

  // Return tool_reference objects (Claude will get full definitions)
  const toolReferences = results.map(result => ({
    type: 'tool_reference',
    tool_name: result.toolName
  }));

  return toolReferences;
}

/**
 * Tool search tool definition
 */
export const TOOL_SEARCH_DEFINITION = {
  name: 'tool_search',
  description: 'Search for available tools that can help with a task. Returns tool definitions for matching tools. Use this when you need a capability but don\'t have the right tool available yet. Discovers tools on-demand using semantic search.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of what you need to do (e.g., "search HubSpot for companies", "create a Google document", "find grants for a client", "read files from Google Drive")'
      },
      top_k: {
        type: 'number',
        description: 'Number of tools to return (default: 5, max: 10)',
        default: 5,
        minimum: 1,
        maximum: 10
      }
    },
    required: ['query']
  }
};

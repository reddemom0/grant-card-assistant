/**
 * Vector Search with Reranking (RAG Level 3)
 *
 * Implements Anthropic's RAG best practices:
 * - Semantic search using vector embeddings (cosine similarity)
 * - Claude-based reranking for improved precision
 */

import { VoyageAIClient } from 'voyageai';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import { calculateRequestCost } from '../config/cost-settings.js';

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} a - First vector
 * @param {Array<number>} b - Second vector
 * @returns {number} Similarity score (0-1)
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
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
 * Vector search for relevant chunks
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.k - Number of results (default 15)
 * @param {number} options.similarityThreshold - Minimum similarity (default 0.7)
 * @param {string} options.department - Filter by department (optional)
 * @param {string} options.fileType - Filter by file type (optional)
 * @param {string} options.source - Filter by source: 'dropbox' or 'google-drive' (optional)
 * @returns {Promise<Array>} Array of matching chunks with similarity scores
 */
export async function vectorSearch(query, options = {}) {
  const {
    k = 15,
    similarityThreshold = 0.7,
    department = null,
    fileType = null,
    source = null
  } = options;

  console.log(`🔍 Vector search: "${query}"`);
  console.log(`   k=${k}, threshold=${similarityThreshold}`);

  // STEP 1: Embed query
  const queryEmbeddingResult = await voyage.embed({ input: [query], model: 'voyage-2' });
  const queryEmbedding = queryEmbeddingResult.data[0].embedding;

  console.log(`   ✓ Query embedded (${queryEmbedding.length} dimensions)`);

  // STEP 2: Get candidate chunk IDs (apply filters)
  let candidateChunkIds = [];

  if (department) {
    // Filter by department
    candidateChunkIds = await redis.smembers(`oracle:dept:${department}`);
    console.log(`   ✓ Department filter: ${candidateChunkIds.length} chunks`);
  } else if (fileType) {
    // Filter by file type
    candidateChunkIds = await redis.smembers(`oracle:type:${fileType}`);
    console.log(`   ✓ File type filter: ${candidateChunkIds.length} chunks`);
  } else if (source) {
    // Filter by source
    candidateChunkIds = await redis.smembers(`oracle:source:${source}`);
    console.log(`   ✓ Source filter: ${candidateChunkIds.length} chunks`);
  } else {
    // Get all chunk IDs (expensive for large corpus)
    // Better: scan keys matching pattern oracle:chunk:*
    const keys = await redis.keys('oracle:chunk:*');
    candidateChunkIds = keys.map(key => key.replace('oracle:chunk:', ''));
    console.log(`   ✓ All chunks: ${candidateChunkIds.length}`);
  }

  if (candidateChunkIds.length === 0) {
    console.log(`   ⚠️  No chunks found with filters`);
    return [];
  }

  // STEP 3: Retrieve embeddings and calculate similarity
  console.log(`   🧮 Computing similarity for ${candidateChunkIds.length} chunks...`);

  const similarities = [];

  for (const chunkId of candidateChunkIds) {
    try {
      // Get chunk embedding
      const embeddingStr = await redis.get(`oracle:embedding:${chunkId}`);

      if (!embeddingStr) {
        // Chunk doesn't have embedding (old indexing)
        continue;
      }

      const embeddingObj = JSON.parse(embeddingStr);
      const chunkEmbedding = embeddingObj.embedding || embeddingObj; // Support both formats

      // Calculate cosine similarity
      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

      if (similarity >= similarityThreshold) {
        similarities.push({ chunkId, similarity });
      }
    } catch (error) {
      // Skip chunks with errors
      console.error(`   ⚠️  Error processing ${chunkId}: ${error.message}`);
    }
  }

  // STEP 4: Sort by similarity (descending)
  similarities.sort((a, b) => b.similarity - a.similarity);

  // STEP 5: Get top k
  const topResults = similarities.slice(0, k);

  console.log(`   ✓ Found ${topResults.length} results above threshold`);

  // STEP 6: Load full chunk metadata
  const results = await Promise.all(
    topResults.map(async ({ chunkId, similarity }) => {
      const chunkData = await redis.hgetall(`oracle:chunk:${chunkId}`);
      return {
        ...chunkData,
        chunkId,
        similarity
      };
    })
  );

  return results;
}

/**
 * Rerank results using Claude (Level 3)
 *
 * Takes 15-20 vector search candidates and asks Claude to select
 * the most relevant 5 based on semantic understanding.
 *
 * @param {string} query - Original search query
 * @param {Array} candidates - Array of chunk objects from vector search
 * @param {number} k - Number of results to return (default 5)
 * @returns {Promise<Array>} Reranked top-k results
 */
export async function rerankWithClaude(query, candidates, k = 5) {
  if (candidates.length === 0) {
    return [];
  }

  if (candidates.length <= k) {
    // Already have fewer than k results, no need to rerank
    return candidates;
  }

  console.log(`🧠 Reranking ${candidates.length} candidates → top ${k}`);

  // Prepare summaries for Claude
  const summaries = candidates.map((chunk, idx) => {
    return `[${idx}] ${chunk.heading}\nSummary: ${chunk.summary}\nKeywords: ${chunk.keywords}`;
  }).join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Query: ${query}

You are helping select the most relevant documents for this query. Below are ${candidates.length} candidate documents, each with an index number.

<documents>
${summaries}
</documents>

Select the ${k} MOST RELEVANT documents to answer the query. Output ONLY the index numbers (0-${candidates.length - 1}), comma-separated, in order of relevance (most relevant first).

Example output: 3,7,1,12,5

Your selection:`
      }]
    });

    // Log cost
    if (response.usage) {
      const cost = calculateRequestCost(response.usage, 'claude-haiku-4-5-20251001');
      console.log(`💰 [Vector Search Reranking] Request cost: $${cost.toFixed(4)} (Candidates: ${candidates.length})`);
    }

    const text = response.content[0].text.trim();
    console.log(`   Claude selected: ${text}`);

    // Parse indices
    const indices = text
      .split(',')
      .map(idx => parseInt(idx.trim()))
      .filter(idx => !isNaN(idx) && idx >= 0 && idx < candidates.length)
      .slice(0, k); // Ensure we don't exceed k

    // If parsing failed, fall back to top k by vector similarity
    if (indices.length === 0) {
      console.warn(`   ⚠️  Parsing failed, using top ${k} by vector similarity`);
      return candidates.slice(0, k);
    }

    // Return reranked results
    const reranked = indices.map(idx => ({
      ...candidates[idx],
      rerankScore: k - indices.indexOf(idx) // Higher score for top results
    }));

    console.log(`   ✓ Reranked to ${reranked.length} results`);

    return reranked;

  } catch (error) {
    console.error(`   ❌ Reranking failed: ${error.message}`);
    // Fallback: return top k by vector similarity
    return candidates.slice(0, k);
  }
}

/**
 * Search with vector embeddings + reranking (Level 3 RAG)
 *
 * Complete pipeline: vector search → reranking → return top results
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} options.k - Final number of results (default 5)
 * @param {number} options.initialK - Candidates for reranking (default 15)
 * @param {number} options.similarityThreshold - Minimum similarity (default 0.7)
 * @param {string} options.department - Filter by department (optional)
 * @param {string} options.fileType - Filter by file type (optional)
 * @param {string} options.source - Filter by source (optional)
 * @returns {Promise<Array>} Top-k reranked results
 */
export async function searchRAG(query, options = {}) {
  const {
    k = 5,
    initialK = 15,
    similarityThreshold = 0.7,
    department = null,
    fileType = null,
    source = null
  } = options;

  // STEP 1: Vector search (get top initialK candidates)
  const candidates = await vectorSearch(query, {
    k: initialK,
    similarityThreshold,
    department,
    fileType,
    source
  });

  if (candidates.length === 0) {
    return [];
  }

  // STEP 2: Rerank with Claude (narrow down to top k)
  const reranked = await rerankWithClaude(query, candidates, k);

  return reranked;
}

export default { searchRAG, vectorSearch, rerankWithClaude, cosineSimilarity };

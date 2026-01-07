/**
 * Oracle Search Tool
 *
 * Searches the Oracle knowledge base metadata in Redis
 * and returns relevant documents for the agent to load.
 */

import { createClient } from '@vercel/kv';

const redis = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

/**
 * Extract keywords from a search query
 */
function extractKeywords(query) {
  // Lowercase and remove special characters
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  // Split into words and remove common stop words
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with', 'what', 'when', 'where', 'who', 'why',
    'how', 'our', 'us', 'we', 'you', 'your', 'me', 'my', 'do', 'does',
    'did', 'can', 'could', 'should', 'would', 'tell', 'show', 'find',
    'get', 'give'
  ]);

  const words = cleaned
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return [...new Set(words)]; // Remove duplicates
}

/**
 * Detect department from query
 */
function detectDepartment(query) {
  const lowerQuery = query.toLowerCase();

  const departmentKeywords = {
    'Writers': ['write', 'writing', 'application', 'template', 'draft', 'canexport', 'etg', 'bcafe'],
    'Strategy': ['strategy', 'pricing', 'discovery', 'intake', 'readiness', 'client'],
    'Research': ['research', 'eligibility', 'grant program', 'rubric', 'grading', 'launch'],
    'Marketing': ['marketing', 'webinar', 'blog', 'content', 'calendar', 'partnership', 'success story'],
    'GCs': ['branding', 'color', 'logo', 'brand', 'hiring', 'claim', 'submission']
  };

  for (const [dept, keywords] of Object.entries(departmentKeywords)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
      return dept;
    }
  }

  return null; // No specific department detected
}

/**
 * Search Oracle knowledge base
 *
 * @param {string} query - Search query from user
 * @param {Object} options - Search options
 * @param {string} options.department - Filter by department (optional)
 * @param {string} options.fileType - Filter by file type (optional)
 * @param {number} options.limit - Max results to return (default 10)
 * @returns {Promise<Array>} Array of document metadata objects
 */
export async function searchOracleKnowledgeBase(query, options = {}) {
  try {
    const {
      department = null,
      fileType = null,
      limit = 10
    } = options;

    console.log(`🔍 Oracle Search: "${query}"`);
    if (department) console.log(`   Department filter: ${department}`);
    if (fileType) console.log(`   Type filter: ${fileType}`);

    // Extract keywords from query
    const keywords = extractKeywords(query);
    console.log(`   Keywords: ${keywords.join(', ')}`);

    if (keywords.length === 0) {
      console.warn('   ⚠️  No meaningful keywords extracted from query');
      return [];
    }

    // Get candidate file IDs from keyword indexes
    const candidateScores = {};

    for (const keyword of keywords) {
      const fileIds = await redis.smembers(`oracle:keyword:${keyword}`);

      if (fileIds && fileIds.length > 0) {
        console.log(`   "${keyword}" → ${fileIds.length} docs`);

        fileIds.forEach(fileId => {
          candidateScores[fileId] = (candidateScores[fileId] || 0) + 1;
        });
      }
    }

    if (Object.keys(candidateScores).length === 0) {
      console.log('   ⚠️  No documents matched keywords');
      return [];
    }

    console.log(`   Found ${Object.keys(candidateScores).length} candidate documents`);

    // Apply department filter
    if (department) {
      const deptDocs = await redis.smembers(`oracle:dept:${department}`);

      Object.keys(candidateScores).forEach(fileId => {
        if (!deptDocs.includes(fileId)) {
          delete candidateScores[fileId];
        }
      });

      console.log(`   After department filter: ${Object.keys(candidateScores).length} docs`);
    }

    // Apply file type filter
    if (fileType) {
      const typeDocs = await redis.smembers(`oracle:type:${fileType}`);

      Object.keys(candidateScores).forEach(fileId => {
        if (!typeDocs.includes(fileId)) {
          delete candidateScores[fileId];
        }
      });

      console.log(`   After type filter: ${Object.keys(candidateScores).length} docs`);
    }

    // Sort by score (number of keyword matches)
    const sortedFileIds = Object.entries(candidateScores)
      .sort(([, a], [, b]) => b - a)
      .map(([fileId, score]) => ({ fileId, score }))
      .slice(0, limit);

    // Load metadata for top results
    const results = await Promise.all(
      sortedFileIds.map(async ({ fileId, score }) => {
        const metadata = await redis.hgetall(`oracle:doc:${fileId}`);
        return {
          ...metadata,
          relevanceScore: score,
          keywordMatches: score
        };
      })
    );

    console.log(`   ✅ Returning ${results.length} results`);

    return results;

  } catch (error) {
    console.error('❌ Oracle search error:', error);
    throw error;
  }
}

/**
 * Tool definition for Claude agent
 */
export const oracleSearchTool = {
  name: 'search_oracle_kb',
  description: `Search Granted Consulting's internal knowledge base (Oracle).

Use this to find company documents, processes, templates, examples, and information across all departments.

The knowledge base includes:
- **Writers**: Application templates, writing guides, program documentation
- **Strategy**: Pricing guides, discovery scripts, client intake processes
- **Research**: Grant program databases, eligibility rubrics, procedures
- **Marketing**: Content calendars, webinar topics, customer story templates
- **GCs**: Branding guidelines, hiring processes, claim procedures

Returns metadata about matching documents including file name, summary, keywords, and Google Drive link.

After searching, use read_google_drive_file to load the full content of relevant documents.`,

  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (keywords or natural language question)'
      },
      department: {
        type: 'string',
        enum: ['Writers', 'Strategy', 'Research', 'Marketing', 'GCs'],
        description: 'Optional: Filter results to specific department'
      },
      fileType: {
        type: 'string',
        enum: ['template', 'example', 'process', 'reference', 'data'],
        description: 'Optional: Filter by document type (template=blank forms, example=completed samples, process=SOPs, reference=guidelines, data=databases/lists)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10, max 20)',
        minimum: 1,
        maximum: 20
      }
    },
    required: ['query']
  },

  handler: async (input) => {
    const { query, department, fileType, limit } = input;

    // Auto-detect department if not specified
    const effectiveDepartment = department || detectDepartment(query);

    if (effectiveDepartment && !department) {
      console.log(`   🎯 Auto-detected department: ${effectiveDepartment}`);
    }

    const results = await searchOracleKnowledgeBase(query, {
      department: effectiveDepartment,
      fileType,
      limit: Math.min(limit || 10, 20)
    });

    if (results.length === 0) {
      return {
        success: false,
        message: `No documents found matching "${query}"${effectiveDepartment ? ` in ${effectiveDepartment}` : ''}`,
        suggestion: 'Try different keywords, remove department filter, or check if the document exists in the knowledge base.'
      };
    }

    return {
      success: true,
      query,
      department: effectiveDepartment,
      resultsCount: results.length,
      results: results.map(doc => ({
        fileId: doc.fileId,
        fileName: doc.fileName,
        department: doc.department,
        fileType: doc.fileType,
        summary: doc.summary,
        keywords: doc.keywords,
        relevanceScore: doc.relevanceScore,
        webViewLink: doc.webViewLink,
        dateModified: doc.dateModified
      }))
    };
  }
};

export default oracleSearchTool;

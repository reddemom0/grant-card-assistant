/**
 * Oracle Search with RAG (Hybrid Approach)
 *
 * - Dropbox docs: RAG with vector embeddings + reranking (static content)
 * - Google Drive docs: Keyword search + tool retrieval (live content)
 *
 * This combines the best of both worlds:
 * - Semantic search for knowledge base documents
 * - Fresh data retrieval for live documents
 */

import { searchRAG } from '../utils/vector-search.js';
import { searchOracleKnowledgeBase, detectDepartment } from './oracle-search.js';

/**
 * Search Oracle with hybrid approach
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.department - Filter by department (optional)
 * @param {string} options.fileType - Filter by file type (optional)
 * @param {number} options.limit - Max results (default 10)
 * @param {boolean} options.dropboxOnly - Only search Dropbox (default false)
 * @param {boolean} options.googleDriveOnly - Only search Google Drive (default false)
 * @returns {Promise<Array>} Combined search results
 */
export async function searchOracleHybrid(query, options = {}) {
  const {
    department = null,
    fileType = null,
    limit = 10,
    dropboxOnly = false,
    googleDriveOnly = false
  } = options;

  console.log(`🔮 Oracle Hybrid Search: "${query}"`);

  const results = [];

  // DROPBOX: RAG with vector embeddings (if enabled)
  if (!googleDriveOnly) {
    try {
      console.log('   📦 Searching Dropbox with RAG...');

      const dropboxResults = await searchRAG(query, {
        k: limit,
        initialK: 20, // Retrieve 20, rerank to `limit`
        similarityThreshold: 0.7,
        department: department || detectDepartment(query),
        fileType,
        source: 'dropbox'
      });

      results.push(...dropboxResults);
      console.log(`   ✓ Dropbox: ${dropboxResults.length} results (RAG)`);

    } catch (error) {
      console.error(`   ❌ Dropbox RAG failed: ${error.message}`);
      // Fall through to keyword search as backup
    }
  }

  // GOOGLE DRIVE: Keyword search (if enabled)
  if (!dropboxOnly) {
    try {
      console.log('   📁 Searching Google Drive with keywords...');

      const googleDriveResults = await searchOracleKnowledgeBase(query, {
        department: department || detectDepartment(query),
        fileType,
        limit: Math.ceil(limit / 2) // Split results between sources
      });

      // Convert keyword results to consistent format
      const formattedGDResults = googleDriveResults.map(doc => ({
        ...doc,
        source: doc.source || 'google-drive',
        searchMethod: 'keyword'
      }));

      results.push(...formattedGDResults);
      console.log(`   ✓ Google Drive: ${googleDriveResults.length} results (keyword)`);

    } catch (error) {
      console.error(`   ❌ Google Drive search failed: ${error.message}`);
    }
  }

  // Sort combined results (RAG results have similarity/rerankScore, keyword have relevanceScore)
  const sortedResults = results.sort((a, b) => {
    const scoreA = a.rerankScore || a.similarity || a.relevanceScore || 0;
    const scoreB = b.rerankScore || b.similarity || b.relevanceScore || 0;
    return scoreB - scoreA;
  });

  // Limit final results
  const finalResults = sortedResults.slice(0, limit);

  console.log(`   ✅ Total: ${finalResults.length} results (${results.length} before limiting)`);

  return finalResults;
}

/**
 * Tool definition for Claude agent
 */
export const oracleSearchRAGTool = {
  name: 'search_oracle_kb',
  description: `Search Granted Consulting's internal knowledge base (Oracle) with semantic understanding.

Uses advanced RAG (Retrieval Augmented Generation) for Dropbox documents and keyword search for Google Drive documents.

The knowledge base includes:
- **Writers**: Application templates, writing guides, program documentation
- **Strategy**: Pricing guides, discovery scripts, client intake processes
- **Research**: Grant program databases, eligibility rubrics, procedures
- **Marketing**: Content calendars, webinar topics, customer story templates
- **GCs**: Branding guidelines, hiring processes, claim procedures

**Dropbox documents** are searched using:
- Vector embeddings (semantic understanding)
- Document chunking (section-level precision)
- Claude-based reranking (improved relevance)

**Google Drive documents** are searched using:
- Keyword matching (always returns fresh content)
- Metadata indexing (summaries, keywords, file types)

After searching, check the 'source' field:
- If source = 'google-drive', use read_google_drive_file with the fileId
- If source = 'dropbox', use read_dropbox_file with the dropboxPath

Returns metadata about matching documents including summaries, relevance scores, and storage locations.`,

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
        description: 'Optional: Filter by document type'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10, max 20)',
        minimum: 1,
        maximum: 20
      },
      dropboxOnly: {
        type: 'boolean',
        description: 'Optional: Only search Dropbox (for semantic RAG search)'
      },
      googleDriveOnly: {
        type: 'boolean',
        description: 'Optional: Only search Google Drive (for live document keyword search)'
      }
    },
    required: ['query']
  },

  handler: async (input) => {
    const { query, department, fileType, limit, dropboxOnly, googleDriveOnly } = input;

    // Auto-detect department if not specified
    const effectiveDepartment = department || detectDepartment(query);

    if (effectiveDepartment && !department) {
      console.log(`   🎯 Auto-detected department: ${effectiveDepartment}`);
    }

    const results = await searchOracleHybrid(query, {
      department: effectiveDepartment,
      fileType,
      limit: Math.min(limit || 10, 20),
      dropboxOnly: dropboxOnly || false,
      googleDriveOnly: googleDriveOnly || false
    });

    if (results.length === 0) {
      return {
        success: false,
        message: `No documents found matching "${query}"${effectiveDepartment ? ` in ${effectiveDepartment}` : ''}`,
        suggestion: 'Try different keywords, remove filters, or check if the document exists in the knowledge base.'
      };
    }

    return {
      success: true,
      query,
      department: effectiveDepartment,
      resultsCount: results.length,
      ragEnabled: true,
      results: results.map(doc => {
        // Format result for Claude
        const formatted = {
          fileName: doc.fileName,
          heading: doc.heading, // Chunk heading (for Dropbox RAG)
          summary: doc.summary,
          department: doc.department,
          fileType: doc.fileType,
          keywords: doc.keywords,
          source: doc.source,
          searchMethod: doc.searchMethod || (doc.similarity ? 'vector+rerank' : 'keyword')
        };

        // Add relevance score
        if (doc.rerankScore) {
          formatted.relevanceScore = doc.rerankScore;
        } else if (doc.similarity) {
          formatted.relevanceScore = Math.round(doc.similarity * 100);
        } else if (doc.keywordMatches) {
          formatted.relevanceScore = doc.keywordMatches;
        }

        // Add retrieval info based on source
        if (doc.source === 'dropbox') {
          formatted.dropboxPath = doc.dropboxPath || doc.filePath;
          formatted.chunkId = doc.chunkId; // For debugging
        } else {
          formatted.fileId = doc.fileId;
          formatted.webViewLink = doc.webViewLink;
        }

        formatted.dateModified = doc.dateModified;

        return formatted;
      })
    };
  }
};

export default oracleSearchRAGTool;

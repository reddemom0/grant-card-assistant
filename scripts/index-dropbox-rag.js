/**
 * Dropbox RAG Indexer (Level 3)
 *
 * Implements Anthropic's RAG best practices:
 * - Level 1: Vector embeddings with Voyage AI
 * - Level 2: Summary indexing for each chunk
 * - Level 3: Ready for reranking (implemented in search)
 *
 * Usage:
 *   node scripts/index-dropbox-rag.js           # Index new/changed docs
 *   node scripts/index-dropbox-rag.js --full    # Re-index everything
 */

import Anthropic from '@anthropic-ai/sdk';
import { VoyageAIClient } from 'voyageai';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { listDropboxFolder, readDropboxFile } from '../src/tools/dropbox.js';
import { chunkByHeadings, generateChunkSummary, estimateTokens } from '../src/utils/document-chunker.js';

dotenv.config();

// Configuration
let DROPBOX_KB_PATH = process.env.DROPBOX_ORACLE_KB_PATH || '/Oracle KB';
if (DROPBOX_KB_PATH === '/' && process.env.DROPBOX_NAMESPACE_ID) {
  DROPBOX_KB_PATH = '';
}

const BATCH_SIZE = 5; // Process 5 docs at a time
const EMBEDDING_BATCH_SIZE = 128; // Voyage AI batch size
const CONTENT_MAX_SIZE = 50000; // Max chars to process per document

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Detect department from file path
 */
function detectDepartment(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[1];
  }
  return 'General';
}

/**
 * Generate file ID from Dropbox file
 */
function generateFileId(file) {
  return `dropbox_${file.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Generate chunk ID
 */
function generateChunkId(fileId, chunkIndex) {
  return `${fileId}_chunk_${chunkIndex}`;
}

/**
 * Extract keywords from text using Claude
 */
async function extractKeywords(fileName, content) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract 8-12 relevant keywords from this document for search indexing.

Document Name: ${fileName}
Content: ${content.substring(0, 1000)}

Return comma-separated keywords (lowercase, use underscores for multi-word phrases).
Example: grant_application,eligibility,manufacturing,training,business_case

Keywords:`
      }]
    });

    const keywords = response.content[0].text.trim();
    return keywords;
  } catch (error) {
    console.error('Keyword extraction failed:', error.message);
    // Fallback: extract from filename
    return fileName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 5).join(',');
  }
}

/**
 * Classify document type using Claude
 */
async function classifyDocumentType(fileName, content) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Classify this document into ONE type:
- template: Blank forms, templates, structures to fill out
- example: Completed samples, case studies, past applications
- process: SOPs, workflows, how-to guides, procedures
- reference: Guidelines, eligibility, program rules, standards
- data: Databases, lists, calendars, pricing sheets

Document: ${fileName}
Content: ${content.substring(0, 500)}

Type (one word):`
      }]
    });

    const type = response.content[0].text.trim().toLowerCase();
    const validTypes = ['template', 'example', 'process', 'reference', 'data'];

    return validTypes.includes(type) ? type : 'reference';
  } catch (error) {
    console.error('Document classification failed:', error.message);
    return 'reference';
  }
}

/**
 * Process a single document: chunk, summarize, embed
 */
async function processDocument(file, department, forceReindex) {
  const fileId = generateFileId(file);

  // Check if reindex needed
  if (!forceReindex) {
    const existing = await redis.get(`oracle:doc_indexed:${fileId}`);
    if (existing) {
      const existingData = JSON.parse(existing);
      if (existingData.modified === file.modified) {
        console.log(`  ⏭️  Skipping (unchanged): ${file.name}`);
        return { skipped: true };
      }
    }
  }

  console.log(`  📄 Processing: ${file.name}`);

  // Read file content
  const readResult = await readDropboxFile(file.path);

  if (!readResult.success || !readResult.content) {
    console.log(`  ⚠️  Failed to read file: ${readResult.error || 'empty content'}`);
    return { error: true };
  }

  const content = readResult.content.substring(0, CONTENT_MAX_SIZE);

  // STEP 1: Chunk document by headings
  const chunks = chunkByHeadings(content, file.name);
  console.log(`     📑 Chunked into ${chunks.length} sections`);

  // STEP 2: Generate metadata (keywords, type) for overall document
  const [keywords, fileType] = await Promise.all([
    extractKeywords(file.name, content),
    classifyDocumentType(file.name, content)
  ]);

  // STEP 3: Generate summaries for each chunk (Level 2: Summary Indexing)
  const chunksWithSummaries = [];

  for (const chunk of chunks) {
    const summary = await generateChunkSummary(chunk.heading, chunk.text, anthropic);
    chunksWithSummaries.push({
      ...chunk,
      summary
    });
  }

  // STEP 4: Embed chunks (Level 1: Vector Embeddings)
  // Format: "Heading: {heading}\n\nSummary: {summary}\n\nContent: {text}"
  const textsToEmbed = chunksWithSummaries.map(chunk =>
    `Heading: ${chunk.heading}\n\nSummary: ${chunk.summary}\n\nContent: ${chunk.text.substring(0, 3000)}`
  );

  console.log(`     🧮 Embedding ${textsToEmbed.length} chunks...`);

  // Batch embed (Voyage AI supports up to 128 at once)
  const embeddings = [];
  for (let i = 0; i < textsToEmbed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = textsToEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
    const result = await voyage.embed({
      input: batch,
      model: 'voyage-2'
    });
    embeddings.push(...result.data);
  }

  // STEP 5: Store chunks with embeddings in Redis
  const pipeline = redis.pipeline();

  chunksWithSummaries.forEach((chunk, idx) => {
    const chunkId = generateChunkId(fileId, chunk.chunkIndex);

    // Store chunk metadata + embedding
    const chunkData = {
      chunkId,
      fileId,
      fileName: file.name,
      filePath: file.path,
      department,
      fileType,
      heading: chunk.heading,
      text: chunk.text,
      summary: chunk.summary,
      characterCount: chunk.characterCount,
      tokenCount: estimateTokens(chunk.text),
      keywords,
      dateModified: file.modified,
      dateIndexed: new Date().toISOString(),
      source: 'dropbox',
      dropboxPath: file.path
    };

    // Store chunk data (Hash)
    pipeline.hset(`oracle:chunk:${chunkId}`, chunkData);

    // Store embedding (separate, as binary)
    pipeline.set(`oracle:embedding:${chunkId}`, JSON.stringify(embeddings[idx]));

    // Index chunk by department
    pipeline.sadd(`oracle:dept:${department}`, chunkId);

    // Index chunk by file type
    pipeline.sadd(`oracle:type:${fileType}`, chunkId);

    // Index chunk by keywords
    keywords.split(',').forEach(keyword => {
      const kw = keyword.trim();
      if (kw) pipeline.sadd(`oracle:keyword:${kw}`, chunkId);
    });

    // Index chunk by source
    pipeline.sadd(`oracle:source:dropbox`, chunkId);

    // Add chunk to file's chunk list
    pipeline.sadd(`oracle:file_chunks:${fileId}`, chunkId);
  });

  // Store file-level metadata
  pipeline.set(`oracle:doc_indexed:${fileId}`, JSON.stringify({
    fileId,
    fileName: file.name,
    modified: file.modified,
    chunkCount: chunks.length,
    indexed: new Date().toISOString()
  }));

  await pipeline.exec();

  console.log(`     ✅ Indexed ${chunks.length} chunks with embeddings`);

  return {
    processed: true,
    chunkCount: chunks.length,
    fileType
  };
}

/**
 * Main indexing function
 */
async function indexDropboxRAG(forceReindex) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📁 Scanning Dropbox: ${DROPBOX_KB_PATH}`);
  console.log(`🧠 RAG Mode: Chunking + Summary Indexing + Vector Embeddings`);
  console.log('='.repeat(80));

  // List all files
  const result = await listDropboxFolder(DROPBOX_KB_PATH, true);

  if (!result.success) {
    throw new Error(`Failed to list Dropbox folder: ${result.error}`);
  }

  // Filter files with smart rules
  const files = result.files.filter(file => {
    const lowerPath = file.path.toLowerCase();

    // Check if file is in /SALES/grants folder
    if (lowerPath.includes('/sales/grants/')) {
      // Only include files from 2025 or later
      const fileDate = new Date(file.modified);
      const cutoffDate = new Date('2025-01-01');

      if (fileDate < cutoffDate) {
        return false; // Exclude old files in /SALES/grants
      }
    }

    return true; // Include everything else
  });

  console.log(`Found ${result.files.length} total files`);
  console.log(`Processing ${files.length} files (excluded: ${result.files.length - files.length})`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let totalChunks = 0;

  // Group by department
  const filesByDepartment = {};
  files.forEach(file => {
    const dept = detectDepartment(file.path);
    if (!filesByDepartment[dept]) filesByDepartment[dept] = [];
    filesByDepartment[dept].push(file);
  });

  console.log(`\nDepartments: ${Object.keys(filesByDepartment).join(', ')}`);

  // Process each department
  for (const [department, deptFiles] of Object.entries(filesByDepartment)) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📂 ${department} (${deptFiles.length} files)`);
    console.log('─'.repeat(80));

    // Process in batches
    for (let i = 0; i < deptFiles.length; i += BATCH_SIZE) {
      const batch = deptFiles.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (file) => {
        try {
          const result = await processDocument(file, department, forceReindex);

          if (result.skipped) {
            skipped++;
          } else if (result.error) {
            errors++;
          } else {
            processed++;
            totalChunks += result.chunkCount || 0;
          }
        } catch (error) {
          console.error(`  ❌ Error: ${file.name}: ${error.message}`);
          errors++;
        }
      }));

      // Rate limit pause
      if (i + BATCH_SIZE < deptFiles.length) {
        console.log(`  ⏸️  Batch complete, pausing 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  return { processed, skipped, errors, totalChunks };
}

/**
 * Main
 */
async function main() {
  const forceReindex = process.argv.includes('--full');

  console.log('\n' + '█'.repeat(80));
  console.log('🔮 Dropbox RAG Indexer (Level 3)');
  console.log('█'.repeat(80));
  console.log(`Mode: ${forceReindex ? 'FULL REINDEX' : 'Incremental'}`);
  console.log(`Path: ${DROPBOX_KB_PATH}\n`);

  // Check for Voyage API key
  if (!process.env.VOYAGE_API_KEY) {
    console.error('❌ VOYAGE_API_KEY not set in environment');
    console.error('   Get your key at: https://www.voyageai.com/');
    process.exit(1);
  }

  try {
    const startTime = Date.now();

    const stats = await indexDropboxRAG(forceReindex);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Update stats
    await redis.hset('oracle:stats', {
      dropboxDocuments: processed + skipped,
      dropboxChunks: stats.totalChunks,
      lastIndexedAt: new Date().toISOString(),
      ragEnabled: 'true'
    });

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 INDEXING COMPLETE');
    console.log('='.repeat(80));
    console.log(`✅ Processed: ${stats.processed} documents`);
    console.log(`📑 Total chunks: ${stats.totalChunks}`);
    console.log(`⏭️  Skipped: ${stats.skipped} (unchanged)`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('');

    if (stats.errors === 0) {
      console.log('🎉 All documents indexed with RAG embeddings!');
    } else {
      console.log('⚠️  Some documents failed. Review errors above.');
    }

    console.log('\n✅ Dropbox RAG ready for semantic search + reranking!\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main()
  .then(() => {
    redis.disconnect();
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    redis.disconnect();
    process.exit(1);
  });

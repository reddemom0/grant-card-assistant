/**
 * Dropbox Oracle Metadata Indexer
 *
 * Scans a Dropbox folder, analyzes documents with Claude,
 * and stores searchable metadata in Redis (same format as Google Drive Oracle KB).
 *
 * Usage:
 *   node scripts/index-dropbox-kb.js           # Index new/changed docs
 *   node scripts/index-dropbox-kb.js --full    # Re-index everything
 */

import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { listDropboxFolder, readDropboxFile } from '../src/tools/dropbox.js';

dotenv.config();

// Configuration
const DROPBOX_KB_PATH = process.env.DROPBOX_ORACLE_KB_PATH || '/Oracle KB';
const BATCH_SIZE = 5; // Process 5 docs at a time to avoid rate limits
const CONTENT_SAMPLE_SIZE = 10000; // First 10K chars for analysis

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Detect department from file path
 * Assumes folder structure: /Oracle KB/{Department}/{files}
 */
function detectDepartment(path) {
  const parts = path.split('/').filter(Boolean);

  // If path is like "/Oracle KB/Writers/file.pdf", department is "Writers"
  if (parts.length >= 2) {
    return parts[1]; // Index 0 is "Oracle KB", index 1 is department
  }

  return 'General'; // Default department
}

/**
 * Generate unique file ID from Dropbox file
 * We'll use the file's content hash + path as a unique identifier
 */
function generateFileId(file) {
  // Use Dropbox ID directly (format: id:xxxxx)
  // Convert to a simpler format for Redis keys
  return `dropbox_${file.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Generate metadata for a document using Claude
 */
async function generateMetadata(fileName, content) {
  if (!content || content.trim().length < 50) {
    console.warn(`  ⚠️  Content too short, using filename only`);
    return {
      summary: `Document: ${fileName}`,
      keywords: fileName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 5).join(','),
      fileType: 'reference'
    };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this document and provide metadata for search indexing.

Document Name: ${fileName}

Document Content (first 10,000 characters):
${content}

Provide:
1. **summary**: A 2-3 sentence summary explaining the document's purpose and key topics
2. **keywords**: 8-12 relevant keywords (comma-separated, lowercase, no spaces in keywords use underscore)
3. **fileType**: Choose ONE: template, example, process, reference, or data

Guidelines:
- **template**: Blank forms, templates, standard structures to fill out
- **example**: Completed samples, case studies, past applications
- **process**: SOPs, workflows, how-to guides, procedures
- **reference**: Guidelines, eligibility criteria, program rules, brand standards
- **data**: Databases, lists, calendars, pricing sheets, contact lists

Return ONLY valid JSON:
{
  "summary": "your summary here",
  "keywords": "keyword1,keyword2,keyword3",
  "fileType": "template"
}`
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const metadata = JSON.parse(jsonMatch[0]);

    // Validate
    if (!metadata.summary || !metadata.keywords || !metadata.fileType) {
      throw new Error('Missing required fields in metadata');
    }

    return metadata;

  } catch (error) {
    console.error(`  ❌ Claude API failed: ${error.message}`);
    // Fallback metadata
    return {
      summary: `Document: ${fileName}`,
      keywords: fileName.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 5).join(','),
      fileType: 'reference'
    };
  }
}

/**
 * Store document metadata in Redis (same format as Google Drive)
 */
async function storeMetadata(fileId, metadata) {
  // Store document metadata (Hash)
  await redis.hset(`oracle:doc:${fileId}`, metadata);

  // Add to department index (Set)
  await redis.sadd(`oracle:dept:${metadata.department}`, fileId);

  // Add to file type index (Set)
  await redis.sadd(`oracle:type:${metadata.fileType}`, fileId);

  // Add to keyword indexes (Set for each keyword)
  const keywords = metadata.keywords.split(',').map(k => k.trim()).filter(Boolean);
  for (const keyword of keywords) {
    await redis.sadd(`oracle:keyword:${keyword}`, fileId);
  }

  // Add to source index (to distinguish Dropbox from Google Drive)
  await redis.sadd(`oracle:source:dropbox`, fileId);
}

/**
 * Check if a document needs reindexing
 */
async function needsReindex(fileId, modifiedTime, forceReindex) {
  if (forceReindex) return true;

  const existing = await redis.hget(`oracle:doc:${fileId}`, 'dateModified');
  if (!existing) return true;

  return new Date(modifiedTime) > new Date(existing);
}

/**
 * Process files from Dropbox
 */
async function processDropboxFiles(forceReindex) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📁 Scanning Dropbox: ${DROPBOX_KB_PATH}`);
  console.log('='.repeat(80));

  // List all files recursively
  const result = await listDropboxFolder(DROPBOX_KB_PATH, true);

  if (!result.success) {
    throw new Error(`Failed to list Dropbox folder: ${result.error}`);
  }

  const files = result.files;
  console.log(`Found ${files.length} files`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Group files by department for better organization
  const filesByDepartment = {};
  files.forEach(file => {
    const dept = detectDepartment(file.path);
    if (!filesByDepartment[dept]) {
      filesByDepartment[dept] = [];
    }
    filesByDepartment[dept].push(file);
  });

  console.log(`\nDepartments found: ${Object.keys(filesByDepartment).join(', ')}`);

  // Process each department
  for (const [department, deptFiles] of Object.entries(filesByDepartment)) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📂 Processing department: ${department} (${deptFiles.length} files)`);
    console.log('─'.repeat(80));

    // Process in batches to avoid rate limits
    for (let i = 0; i < deptFiles.length; i += BATCH_SIZE) {
      const batch = deptFiles.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (file) => {
        try {
          const fileId = generateFileId(file);

          // Check if reindex needed
          const needsUpdate = await needsReindex(fileId, file.modified, forceReindex);

          if (!needsUpdate) {
            console.log(`  ⏭️  Skipping (unchanged): ${file.name}`);
            skipped++;
            return;
          }

          console.log(`  📄 Processing: ${file.name}`);

          // Read file content
          const readResult = await readDropboxFile(file.path);

          if (!readResult.success) {
            console.log(`  ⚠️  Failed to read file: ${readResult.error}`);
            errors++;
            return;
          }

          const content = readResult.content.substring(0, CONTENT_SAMPLE_SIZE);

          if (!content || content.includes('[Unsupported file type')) {
            console.log(`  ⚠️  Unsupported or empty content, indexing metadata only`);
          }

          // Generate metadata with Claude
          const aiMetadata = await generateMetadata(file.name, content || '');

          // Build full metadata object (compatible with Google Drive format)
          const metadata = {
            fileId: fileId,
            fileName: file.name,
            filePath: file.path,
            department: department,
            fileType: aiMetadata.fileType,
            mimeType: readResult.file.type,
            summary: aiMetadata.summary,
            keywords: aiMetadata.keywords,
            dateModified: file.modified,
            dateIndexed: new Date().toISOString(),
            fileSizeBytes: file.size || 0,
            webViewLink: '', // Dropbox doesn't have direct web view links like GDrive
            dropboxPath: file.path, // Store Dropbox path for retrieval
            source: 'dropbox' // Mark as Dropbox source
          };

          // Store in Redis
          await storeMetadata(fileId, metadata);

          console.log(`  ✅ Indexed: ${file.name}`);
          console.log(`     Type: ${metadata.fileType} | Keywords: ${metadata.keywords.split(',').length}`);
          processed++;

        } catch (error) {
          console.error(`  ❌ Error processing ${file.name}: ${error.message}`);
          errors++;
        }
      }));

      // Rate limiting pause between batches
      if (i + BATCH_SIZE < deptFiles.length) {
        console.log(`  ⏸️  Batch complete, pausing 2s...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  return { processed, skipped, errors };
}

/**
 * Main function
 */
async function main() {
  const forceReindex = process.argv.includes('--full');

  console.log('\n' + '█'.repeat(80));
  console.log('🔮 Dropbox Oracle Metadata Indexer');
  console.log('█'.repeat(80));
  console.log(`Mode: ${forceReindex ? 'FULL REINDEX' : 'Incremental update'}`);
  console.log(`Path: ${DROPBOX_KB_PATH}`);
  console.log('');

  try {
    const startTime = Date.now();

    // Process Dropbox files
    const stats = await processDropboxFiles(forceReindex);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Update global stats (add to existing count from Google Drive)
    const currentTotal = await redis.hget('oracle:stats', 'totalDocuments') || 0;
    const newTotal = parseInt(currentTotal) + stats.processed;

    await redis.hset('oracle:stats', {
      totalDocuments: newTotal,
      lastIndexedAt: new Date().toISOString(),
      dropboxDocuments: stats.processed + stats.skipped
    });

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 INDEXING COMPLETE');
    console.log('='.repeat(80));
    console.log(`✅ Processed: ${stats.processed} documents`);
    console.log(`⏭️  Skipped: ${stats.skipped} (unchanged)`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log(`📁 Total Dropbox docs: ${stats.processed + stats.skipped} documents`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('');

    if (stats.errors > 0) {
      console.log('⚠️  Some documents failed to index. Review errors above.');
    } else {
      console.log('🎉 All Dropbox documents indexed successfully!');
    }

    console.log('\n✅ Dropbox files are now searchable in Oracle!\n');

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

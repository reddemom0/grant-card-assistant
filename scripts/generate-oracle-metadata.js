/**
 * Oracle Metadata Generator
 *
 * Scans the Oracle Knowledge Base folder, analyzes documents with Claude,
 * and stores searchable metadata in Redis.
 *
 * Usage:
 *   node scripts/generate-oracle-metadata.js           # Index new/changed docs
 *   node scripts/generate-oracle-metadata.js --full    # Re-index everything
 */

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';

dotenv.config();

// Configuration
const ORACLE_FOLDER_ID = '1Dn0bqabKU1Z7NLKrFUOhR18vXxnYhEev';
const BATCH_SIZE = 5; // Process 5 docs at a time to avoid rate limits
const CONTENT_SAMPLE_SIZE = 10000; // First 10K chars for analysis

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Initialize Google Drive API client
 */
function getDriveClient() {
  const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment');
  }

  try {
    const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });

    return google.drive({ version: 'v3', auth });
  } catch (error) {
    throw new Error(`Failed to initialize Drive client: ${error.message}`);
  }
}

/**
 * List all department folders in Oracle KB
 */
async function listDepartmentFolders(drive) {
  const response = await drive.files.list({
    q: `'${ORACLE_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name'
  });

  return response.data.files || [];
}

/**
 * List all files in a department folder
 */
async function listFilesInFolder(drive, folderId) {
  const files = [];
  let pageToken = null;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, shortcutDetails)',
      pageSize: 100,
      pageToken
    });

    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return files;
}

/**
 * Download and extract text content from a file
 */
async function extractFileContent(drive, fileId, mimeType) {
  try {
    // Google Docs - export as plain text
    if (mimeType === 'application/vnd.google-apps.document') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/plain'
      });
      return response.data.substring(0, CONTENT_SAMPLE_SIZE);
    }

    // Google Sheets - export as CSV
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const response = await drive.files.export({
        fileId,
        mimeType: 'text/csv'
      });
      return response.data.substring(0, CONTENT_SAMPLE_SIZE);
    }

    // PDFs, DOCX, other files - download and parse
    const response = await drive.files.get({
      fileId,
      alt: 'media'
    }, { responseType: 'arraybuffer' });

    const buffer = Buffer.from(response.data);

    // Parse DOCX
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.substring(0, CONTENT_SAMPLE_SIZE);
    }

    // Parse PDF
    if (mimeType === 'application/pdf') {
      const data = await pdf(buffer);
      return data.text.substring(0, CONTENT_SAMPLE_SIZE);
    }

    // Plain text
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      return buffer.toString('utf-8').substring(0, CONTENT_SAMPLE_SIZE);
    }

    // Unsupported type
    console.warn(`  ⚠️  Unsupported file type: ${mimeType}`);
    return null;

  } catch (error) {
    console.error(`  ❌ Failed to extract content: ${error.message}`);
    return null;
  }
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
      model: 'claude-haiku-4-5-20250929', // Fastest, cheapest for metadata generation
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
 * Store document metadata in Redis
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
 * Process a single department folder
 */
async function processDepartment(drive, department, forceReindex) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📁 Processing: ${department.name}`);
  console.log('='.repeat(80));

  const files = await listFilesInFolder(drive, department.id);
  console.log(`Found ${files.length} files`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches to avoid rate limits
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (file) => {
      try {
        // Check if reindex needed
        const needsUpdate = await needsReindex(file.id, file.modifiedTime, forceReindex);

        if (!needsUpdate) {
          console.log(`  ⏭️  Skipping (unchanged): ${file.name}`);
          skipped++;
          return;
        }

        console.log(`  📄 Processing: ${file.name}`);

        // Extract content
        const content = await extractFileContent(drive, file.id, file.mimeType);

        if (!content) {
          console.log(`  ⚠️  No content extracted, indexing metadata only`);
        }

        // Generate metadata with Claude
        const aiMetadata = await generateMetadata(file.name, content || '');

        // Build full metadata object
        const metadata = {
          fileId: file.id,
          fileName: file.name,
          department: department.name,
          fileType: aiMetadata.fileType,
          mimeType: file.mimeType,
          summary: aiMetadata.summary,
          keywords: aiMetadata.keywords,
          dateModified: file.modifiedTime,
          dateIndexed: new Date().toISOString(),
          fileSizeBytes: file.size || 0,
          webViewLink: file.webViewLink || '',
          isShortcut: !!file.shortcutDetails
        };

        // Store in Redis
        await storeMetadata(file.id, metadata);

        console.log(`  ✅ Indexed: ${file.name}`);
        console.log(`     Type: ${metadata.fileType} | Keywords: ${metadata.keywords.split(',').length}`);
        processed++;

      } catch (error) {
        console.error(`  ❌ Error processing ${file.name}: ${error.message}`);
        errors++;
      }
    }));

    // Rate limiting pause between batches
    if (i + BATCH_SIZE < files.length) {
      console.log(`  ⏸️  Batch complete, pausing 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
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
  console.log('🔮 Oracle Metadata Generator');
  console.log('█'.repeat(80));
  console.log(`Mode: ${forceReindex ? 'FULL REINDEX' : 'Incremental update'}`);
  console.log(`Folder: ${ORACLE_FOLDER_ID}`);
  console.log('');

  try {
    const drive = getDriveClient();

    // Get department folders
    const departments = await listDepartmentFolders(drive);
    console.log(`✓ Found ${departments.length} department folders: ${departments.map(d => d.name).join(', ')}`);

    const startTime = Date.now();
    let totalStats = { processed: 0, skipped: 0, errors: 0 };

    // Process each department
    for (const dept of departments) {
      const stats = await processDepartment(drive, dept, forceReindex);
      totalStats.processed += stats.processed;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Update global stats
    const totalDocs = totalStats.processed + totalStats.skipped;
    await redis.hset('oracle:stats', {
      totalDocuments: totalDocs,
      lastIndexedAt: new Date().toISOString()
    });

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 INDEXING COMPLETE');
    console.log('='.repeat(80));
    console.log(`✅ Processed: ${totalStats.processed} documents`);
    console.log(`⏭️  Skipped: ${totalStats.skipped} (unchanged)`);
    console.log(`❌ Errors: ${totalStats.errors}`);
    console.log(`📁 Total in KB: ${totalDocs} documents`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('');

    if (totalStats.errors > 0) {
      console.log('⚠️  Some documents failed to index. Review errors above.');
    } else {
      console.log('🎉 All documents indexed successfully!');
    }

    console.log('\n✅ Oracle is ready to search!\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

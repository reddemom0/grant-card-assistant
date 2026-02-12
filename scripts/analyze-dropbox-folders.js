/**
 * Dropbox Folder Analyzer
 *
 * Analyzes Dropbox folders to estimate RAG indexing cost BEFORE running the indexer.
 * Shows file counts, sizes, and estimated costs per folder.
 *
 * Usage:
 *   node scripts/analyze-dropbox-folders.js
 */

import { listDropboxFolder } from '../src/tools/dropbox.js';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
let DROPBOX_KB_PATH = process.env.DROPBOX_ORACLE_KB_PATH || '/Oracle KB';
if (DROPBOX_KB_PATH === '/' && process.env.DROPBOX_NAMESPACE_ID) {
  DROPBOX_KB_PATH = '';
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Estimate indexing cost based on file count and size
 */
function estimateCost(fileCount, totalBytes) {
  // Assumptions (conservative):
  // - Average file: 10 pages, ~5,000 chars extracted text
  // - Each file chunks into ~3 chunks on average
  // - Each chunk: 3K chars content + 200 chars summary

  const avgChunksPerFile = 3;
  const totalChunks = fileCount * avgChunksPerFile;

  // Claude Haiku costs (summary generation)
  // Input: ~3K chars per chunk = ~750 tokens
  // Output: ~200 chars per summary = ~50 tokens
  const inputTokensPerChunk = 750;
  const outputTokensPerChunk = 50;
  const claudeInputCost = (totalChunks * inputTokensPerChunk) / 1_000_000 * 0.25; // $0.25/M tokens
  const claudeOutputCost = (totalChunks * outputTokensPerChunk) / 1_000_000 * 1.25; // $1.25/M tokens
  const claudeTotalCost = claudeInputCost + claudeOutputCost;

  // Voyage AI costs (embeddings)
  // Each chunk: ~3K chars = ~750 tokens
  const voyageTokensPerChunk = 750;
  const voyageCost = (totalChunks * voyageTokensPerChunk) / 1_000_000 * 0.10; // $0.10/M tokens

  // Total cost
  const totalCost = claudeTotalCost + voyageCost;

  return {
    estimatedChunks: totalChunks,
    claudeCost: claudeTotalCost,
    voyageCost: voyageCost,
    totalCost: totalCost
  };
}

/**
 * Detect supported file types
 */
function getFileType(filename) {
  const ext = filename.toLowerCase().split('.').pop();

  const supportedTypes = {
    'pdf': '📄 PDF',
    'docx': '📝 DOCX',
    'doc': '⚠️  DOC (legacy, not supported)',
    'txt': '📋 TXT',
    'md': '📋 Markdown',
    'csv': '📊 CSV',
    'xlsx': '⚠️  XLSX (not text-extractable)',
    'pptx': '⚠️  PPTX (not supported)',
    'zip': '⚠️  ZIP (not supported)',
    'png': '⚠️  Image (not supported)',
    'jpg': '⚠️  Image (not supported)',
    'jpeg': '⚠️  Image (not supported)'
  };

  return supportedTypes[ext] || `❓ .${ext}`;
}

/**
 * Analyze folder structure
 */
async function analyzeFolders() {
  console.log('\n' + '█'.repeat(80));
  console.log('📊 Dropbox Folder Analysis for RAG Indexing');
  console.log('█'.repeat(80));
  console.log(`Path: ${DROPBOX_KB_PATH}`);
  console.log('');

  try {
    // List all files recursively
    console.log('🔍 Scanning Dropbox...\n');
    const result = await listDropboxFolder(DROPBOX_KB_PATH, true);

    if (!result.success) {
      throw new Error(`Failed to list Dropbox folder: ${result.error}`);
    }

    const allFiles = result.files;
    console.log(`✓ Found ${allFiles.length} total files\n`);

    // Group files by folder (first-level directories)
    const folderStats = {};

    allFiles.forEach(file => {
      // Extract folder path (everything before the filename)
      const pathParts = file.path.split('/').filter(Boolean);

      if (pathParts.length < 2) {
        // File is in root
        if (!folderStats['(root)']) {
          folderStats['(root)'] = { files: [], totalSize: 0 };
        }
        folderStats['(root)'].files.push(file);
        folderStats['(root)'].totalSize += file.size || 0;
      } else {
        // File is in a subfolder
        // Use first subfolder as grouping (e.g., "/Oracle KB/Writers/subfolder/file.pdf" -> "Writers")
        const topFolder = pathParts[1]; // Skip "Oracle KB", take next level

        if (!folderStats[topFolder]) {
          folderStats[topFolder] = { files: [], totalSize: 0 };
        }
        folderStats[topFolder].files.push(file);
        folderStats[topFolder].totalSize += file.size || 0;
      }
    });

    // Sort folders by file count (descending)
    const sortedFolders = Object.entries(folderStats)
      .sort(([, a], [, b]) => b.files.length - a.files.length);

    console.log('='.repeat(80));
    console.log('📁 FOLDER BREAKDOWN');
    console.log('='.repeat(80));
    console.log('');

    let grandTotalFiles = 0;
    let grandTotalSize = 0;
    let grandTotalCost = 0;

    // Print each folder
    sortedFolders.forEach(([folderName, stats]) => {
      const fileCount = stats.files.length;
      const totalSize = stats.totalSize;
      const cost = estimateCost(fileCount, totalSize);

      console.log(`📂 ${folderName}`);
      console.log(`   Files: ${fileCount}`);
      console.log(`   Total Size: ${formatBytes(totalSize)}`);
      console.log(`   Estimated Chunks: ${cost.estimatedChunks}`);
      console.log(`   Estimated Cost: $${cost.totalCost.toFixed(2)}`);
      console.log(`      Claude (summaries): $${cost.claudeCost.toFixed(2)}`);
      console.log(`      Voyage (embeddings): $${cost.voyageCost.toFixed(2)}`);

      // Show file type breakdown
      const typeCounts = {};
      stats.files.forEach(file => {
        const type = getFileType(file.name);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      });

      const sortedTypes = Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5); // Top 5 types

      console.log(`   File Types:`);
      sortedTypes.forEach(([type, count]) => {
        console.log(`      ${type}: ${count}`);
      });

      console.log('');

      grandTotalFiles += fileCount;
      grandTotalSize += totalSize;
      grandTotalCost += cost.totalCost;
    });

    // Grand totals
    console.log('='.repeat(80));
    console.log('💰 TOTAL ESTIMATE (All Folders)');
    console.log('='.repeat(80));
    console.log(`Total Files: ${grandTotalFiles}`);
    console.log(`Total Size: ${formatBytes(grandTotalSize)}`);
    console.log(`Estimated Total Cost: $${grandTotalCost.toFixed(2)}`);
    console.log('');

    // Show unsupported files summary
    const unsupportedFiles = allFiles.filter(file => {
      const ext = file.name.toLowerCase().split('.').pop();
      const supported = ['pdf', 'docx', 'txt', 'md', 'csv'];
      return !supported.includes(ext);
    });

    if (unsupportedFiles.length > 0) {
      console.log('⚠️  UNSUPPORTED FILES');
      console.log('─'.repeat(80));
      console.log(`${unsupportedFiles.length} files cannot be indexed (unsupported formats)`);

      // Group unsupported by extension
      const unsupportedByExt = {};
      unsupportedFiles.forEach(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        if (!unsupportedByExt[ext]) unsupportedByExt[ext] = [];
        unsupportedByExt[ext].push(file.name);
      });

      Object.entries(unsupportedByExt).forEach(([ext, files]) => {
        console.log(`   .${ext}: ${files.length} files`);
      });
      console.log('');
    }

    // Show recommendations
    console.log('💡 RECOMMENDATIONS');
    console.log('─'.repeat(80));
    console.log('1. Start with smaller folders first to test the system');
    console.log('2. Focus on frequently-accessed knowledge (templates, SOPs, examples)');
    console.log('3. Skip folders with mostly images/unsupported files');
    console.log('4. Run incremental indexing for large folders (index-dropbox-rag.js without --full)');
    console.log('');

    // Show folder selection guide
    console.log('📋 NEXT STEPS');
    console.log('─'.repeat(80));
    console.log('To index specific folders, you can:');
    console.log('');
    console.log('Option 1: Index specific folders by updating DROPBOX_ORACLE_KB_PATH in .env');
    console.log('   Example: DROPBOX_ORACLE_KB_PATH="/Oracle KB/Writers"');
    console.log('');
    console.log('Option 2: Modify index-dropbox-rag.js to filter specific folders');
    console.log('   Example: Add folder name to excludedPaths array');
    console.log('');
    console.log('Option 3: Index everything (use --full flag):');
    console.log('   node scripts/index-dropbox-rag.js --full');
    console.log(`   Estimated cost: $${grandTotalCost.toFixed(2)}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run analysis
analyzeFolders()
  .then(() => {
    console.log('✅ Analysis complete!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

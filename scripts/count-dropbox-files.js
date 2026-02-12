/**
 * Count files that would be indexed by RAG system
 */

import dotenv from 'dotenv';
import { listDropboxFolder } from '../src/tools/dropbox.js';

dotenv.config();

// Configuration
let DROPBOX_KB_PATH = process.env.DROPBOX_ORACLE_KB_PATH || '/Oracle KB';
if (DROPBOX_KB_PATH === '/' && process.env.DROPBOX_NAMESPACE_ID) {
  DROPBOX_KB_PATH = '';
}

async function countFiles() {
  console.log('\n📊 Counting Dropbox files for RAG indexing...');
  console.log(`📁 Root path: ${DROPBOX_KB_PATH || '/'}`);
  console.log('');

  // List all files recursively
  console.log('🔍 Scanning Dropbox (this may take a minute for large folders)...');
  const result = await listDropboxFolder(DROPBOX_KB_PATH, true);

  if (!result.success) {
    throw new Error(`Failed to list Dropbox folder: ${result.error}`);
  }

  const totalFiles = result.files.length;
  console.log(`✅ Found ${totalFiles.toLocaleString()} total files\n`);

  // Apply exclusion filter
  const excludedPaths = [
    '/SALES/grants',
    '/sales/grants',
    '/Sales/Grants',
    '/SALES/Grants'
  ];

  const filteredFiles = result.files.filter(file =>
    !excludedPaths.some(excluded => file.path.toLowerCase().startsWith(excluded.toLowerCase()))
  );

  const excludedCount = totalFiles - filteredFiles.length;

  // Analyze by folder
  const folderCounts = {};
  filteredFiles.forEach(file => {
    const parts = file.path.split('/').filter(Boolean);
    const topFolder = parts.length > 0 ? `/${parts[0]}` : '/';
    folderCounts[topFolder] = (folderCounts[topFolder] || 0) + 1;
  });

  // Summary
  console.log('═'.repeat(80));
  console.log('📊 INDEXING SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total files in Dropbox:     ${totalFiles.toLocaleString()}`);
  console.log(`Excluded files:             ${excludedCount.toLocaleString()}`);
  console.log(`Files to be indexed:        ${filteredFiles.length.toLocaleString()}`);
  console.log('');

  console.log('📂 Files by top-level folder:');
  console.log('─'.repeat(80));
  Object.entries(folderCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([folder, count]) => {
      const percentage = ((count / filteredFiles.length) * 100).toFixed(1);
      console.log(`${folder.padEnd(40)} ${count.toString().padStart(6)} files (${percentage}%)`);
    });

  // Cost estimate
  console.log('');
  console.log('💰 ESTIMATED COSTS:');
  console.log('─'.repeat(80));
  const costPerDoc = 0.0035; // $0.0035 per document (Claude + Voyage AI)
  const estimatedCost = (filteredFiles.length * costPerDoc).toFixed(2);
  const estimatedTime = Math.ceil(filteredFiles.length / 5 / 60 * 3); // 5 docs/batch, 3s delay

  console.log(`Initial indexing cost:      ~$${estimatedCost}`);
  console.log(`Estimated time:             ~${estimatedTime} minutes`);
  console.log(`Incremental updates:        Only changed files (much cheaper)`);
  console.log('');

  // Sample paths
  console.log('📄 Sample file paths (first 10):');
  console.log('─'.repeat(80));
  filteredFiles.slice(0, 10).forEach(file => {
    console.log(`  ${file.path}`);
  });

  if (filteredFiles.length > 10) {
    console.log(`  ... and ${(filteredFiles.length - 10).toLocaleString()} more files`);
  }

  console.log('');
  console.log('✅ Ready to index! Run: node scripts/index-dropbox-rag.js --full');
  console.log('');
}

// Run
countFiles()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });

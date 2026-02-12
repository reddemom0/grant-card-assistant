/**
 * Analyze a single Dropbox folder
 * Usage: node scripts/analyze-single-folder.js "/path/to/folder"
 */

import { listDropboxFolder } from '../src/tools/dropbox.js';
import dotenv from 'dotenv';

dotenv.config();

const folderPath = process.argv[2] || '/Granted Team Folder/HR';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function estimateCost(fileCount) {
  const avgChunksPerFile = 3;
  const totalChunks = fileCount * avgChunksPerFile;

  // Claude: $0.25/M input, $1.25/M output
  const claudeCost = (totalChunks * 750) / 1_000_000 * 0.25 + (totalChunks * 50) / 1_000_000 * 1.25;

  // Voyage: $0.10/M tokens
  const voyageCost = (totalChunks * 750) / 1_000_000 * 0.10;

  return {
    chunks: totalChunks,
    claude: claudeCost,
    voyage: voyageCost,
    total: claudeCost + voyageCost
  };
}

function getFileType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const supported = {
    'pdf': '📄 PDF',
    'docx': '📝 DOCX',
    'txt': '📋 TXT',
    'md': '📋 MD',
    'csv': '📊 CSV'
  };
  const unsupported = {
    'doc': '⚠️  DOC',
    'xlsx': '⚠️  XLSX',
    'pptx': '⚠️  PPTX',
    'zip': '⚠️  ZIP',
    'png': '⚠️  IMG',
    'jpg': '⚠️  IMG',
    'jpeg': '⚠️  IMG'
  };
  return supported[ext] || unsupported[ext] || `❓ .${ext}`;
}

async function analyze() {
  console.log('\n' + '█'.repeat(80));
  console.log(`📂 Analyzing: ${folderPath}`);
  console.log('█'.repeat(80) + '\n');

  const result = await listDropboxFolder(folderPath, true);

  if (!result.success) {
    console.error(`❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const files = result.files;
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  // Supported vs unsupported
  const supported = ['pdf', 'docx', 'txt', 'md', 'csv'];
  const supportedFiles = files.filter(f => {
    const ext = f.name.toLowerCase().split('.').pop();
    return supported.includes(ext);
  });

  // File type breakdown
  const typeCounts = {};
  files.forEach(f => {
    const type = getFileType(f.name);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  const cost = estimateCost(supportedFiles.length);

  console.log(`📊 SUMMARY`);
  console.log('─'.repeat(80));
  console.log(`Total files: ${files.length}`);
  console.log(`Indexable files: ${supportedFiles.length} (${(supportedFiles.length/files.length*100).toFixed(0)}%)`);
  console.log(`Total size: ${formatBytes(totalSize)}`);
  console.log('');

  console.log(`💰 COST ESTIMATE`);
  console.log('─'.repeat(80));
  console.log(`Estimated chunks: ${cost.chunks}`);
  console.log(`Claude (summaries): $${cost.claude.toFixed(3)}`);
  console.log(`Voyage (embeddings): $${cost.voyage.toFixed(3)}`);
  console.log(`Total: $${cost.total.toFixed(2)}`);
  console.log('');

  console.log(`📁 FILE TYPES`);
  console.log('─'.repeat(80));
  Object.entries(typeCounts)
    .sort(([,a], [,b]) => b - a)
    .forEach(([type, count]) => {
      console.log(`${type}: ${count}`);
    });
  console.log('');

  console.log(`📄 SAMPLE FILES (first 10)`);
  console.log('─'.repeat(80));
  files.slice(0, 10).forEach(f => {
    const type = getFileType(f.name);
    console.log(`${type} ${f.name}`);
  });
  if (files.length > 10) {
    console.log(`... and ${files.length - 10} more`);
  }
  console.log('');

  if (supportedFiles.length > 0) {
    console.log(`✅ Ready to index ${supportedFiles.length} files for ~$${cost.total.toFixed(2)}`);
  } else {
    console.log(`⚠️  No indexable files found in this folder`);
  }
  console.log('');
}

analyze();

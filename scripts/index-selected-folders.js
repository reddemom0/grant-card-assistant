/**
 * Index Selected Dropbox Folders to Upstash Vector
 *
 * Indexes specific folders (Sales, HR, Marketing) with year filtering
 * to match our cost analysis: $2.17 + $0.08 + $0.34 = $2.59
 *
 * Usage:
 *   railway run node scripts/index-selected-folders.js
 */

// Load environment variables BEFORE any imports that use them
import 'dotenv/config';

import { readDropboxFile } from '../src/tools/dropbox.js';
import { Index } from '@upstash/vector';
import { VoyageAIClient } from 'voyageai';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

// Dropbox OAuth credentials
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_NAMESPACE_ID = process.env.DROPBOX_NAMESPACE_ID;

// Cache for access token
let cachedAccessToken = null;
let tokenExpiry = 0;

/**
 * Get fresh Dropbox access token
 */
async function getDropboxAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry - 300000) {
    return cachedAccessToken;
  }

  console.log('🔄 Refreshing Dropbox access token...');
  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${await response.text()}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  console.log('✓ Access token refreshed');

  return cachedAccessToken;
}

// Folders to index (matching our cost analysis)
const FOLDERS_TO_INDEX = [
  { path: '/Granted Team Folder/Sales', exclude: '/Grants/', minYear: 2023 },
  { path: '/Granted Team Folder/HR', exclude: null, minYear: 2025 },
  { path: '/Granted Team Folder/MARKETING', exclude: null, minYear: 2025 }
];

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MAX_FILE_SIZE_MB = 50;

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN
});

// Stats
let stats = {
  totalFiles: 0,
  processedFiles: 0,
  skippedFiles: 0,
  totalChunks: 0,
  claudeCost: 0,
  voyageCost: 0,
  errors: []
};

/**
 * Chunk text intelligently
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    if (end < text.length) {
      const periodIndex = text.lastIndexOf('.', end);
      const newlineIndex = text.lastIndexOf('\n', end);
      const breakpoint = Math.max(periodIndex, newlineIndex);

      if (breakpoint > start + CHUNK_SIZE / 2) {
        end = breakpoint + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

/**
 * Generate summary with Claude
 */
async function generateSummary(text, filename) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Summarize this document excerpt from "${filename}" in 2 sentences focusing on key searchable information:\n\n${text.slice(0, 2000)}`
      }]
    });

    const inputCost = (response.usage.input_tokens / 1000000) * 0.25;
    const outputCost = (response.usage.output_tokens / 1000000) * 1.25;
    stats.claudeCost += inputCost + outputCost;

    return response.content[0].text;
  } catch (error) {
    console.error(`❌ Summary failed: ${error.message}`);
    return text.slice(0, 150) + '...';
  }
}

/**
 * Generate embedding with Voyage AI
 */
async function generateEmbedding(text) {
  try {
    const response = await voyage.embed({
      input: text,
      model: 'voyage-3'
    });

    const estimatedTokens = text.split(' ').length / 0.75;
    stats.voyageCost += (estimatedTokens / 1000000) * 0.10;

    return response.data[0].embedding;
  } catch (error) {
    console.error(`❌ Embedding failed: ${error.message}`);
    throw error;
  }
}

/**
 * Process a single file
 */
async function processFile(file, folderName) {
  try {
    console.log(`\n📄 ${file.name}`);

    const fileContent = await readDropboxFile(file.path);

    if (!fileContent.success || !fileContent.content || fileContent.content.length < 100) {
      console.log(`   ⚠️  Skipped: ${fileContent.error || 'too short'}`);
      stats.skippedFiles++;
      return;
    }

    const text = fileContent.content;
    const chunks = chunkText(text);
    console.log(`   📑 ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const summary = await generateSummary(chunk, file.name);
        const embeddingText = `${summary}\n\n${chunk}`;
        const embedding = await generateEmbedding(embeddingText);

        await vectorIndex.upsert({
          id: `${file.path}#${i}`,
          vector: embedding,
          metadata: {
            filePath: file.path,
            fileName: file.name,
            folder: folderName,
            fileSize: file.size,
            modified: file.modified,
            chunkIndex: i,
            totalChunks: chunks.length,
            summary,
            preview: chunk.slice(0, 200)
          }
        });

        stats.totalChunks++;
        process.stdout.write(`   ✓ ${i + 1}/${chunks.length}\r`);

      } catch (error) {
        console.error(`\n   ❌ Chunk ${i} failed: ${error.message}`);
        stats.errors.push({ file: file.path, chunk: i, error: error.message });
      }
    }

    console.log(`\n   ✅ Indexed ${chunks.length} chunks`);
    stats.processedFiles++;

  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    stats.errors.push({ file: file.path, error: error.message });
    stats.skippedFiles++;
  }
}

/**
 * Filter files
 */
function filterFiles(files, excludePattern, minYear) {
  return files.filter(file => {
    if (excludePattern && file.path.includes(excludePattern)) return false;

    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > MAX_FILE_SIZE_MB) return false;

    if (file.modified) {
      const year = new Date(file.modified).getFullYear();
      if (year < minYear) return false;
    }

    const ext = file.name.toLowerCase().split('.').pop();
    return ['pdf', 'docx', 'doc', 'txt', 'md', 'csv'].includes(ext);
  });
}

/**
 * List and filter files with memory-efficient pagination
 * Filters DURING Dropbox API pagination to avoid loading all files into memory
 */
async function listAndFilterFiles(folderPath, excludePattern, minYear) {
  console.log('🔍 Scanning with inline filtering (memory-efficient)...');

  try {
    const token = await getDropboxAccessToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': JSON.stringify({
        ".tag": "namespace_id",
        "namespace_id": DROPBOX_NAMESPACE_ID
      })
    };

    // Initial request
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: folderPath,
        recursive: true,
        limit: 1000,
        include_deleted: false,
        include_mounted_folders: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Dropbox API error: ${error.error_summary || response.statusText}`);
    }

    let data = await response.json();
    let totalScanned = 0;
    let filtered = [];
    let batchNum = 1;

    // Process first batch
    const files1 = data.entries.filter(e => e['.tag'] === 'file').map(f => ({
      id: f.id,
      name: f.name,
      path: f.path_display,
      size: f.size,
      modified: f.server_modified
    }));
    totalScanned += data.entries.length;
    filtered.push(...filterFiles(files1, excludePattern, minYear));
    console.log(`   📦 Batch ${batchNum}: ${totalScanned} scanned, ${filtered.length} kept`);

    // Continue pagination
    while (data.has_more) {
      batchNum++;
      const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cursor: data.cursor })
      });

      if (!continueResponse.ok) {
        const error = await continueResponse.json();
        throw new Error(`Dropbox pagination error: ${error.error_summary || continueResponse.statusText}`);
      }

      data = await continueResponse.json();
      const filesN = data.entries.filter(e => e['.tag'] === 'file').map(f => ({
        id: f.id,
        name: f.name,
        path: f.path_display,
        size: f.size,
        modified: f.server_modified
      }));
      totalScanned += data.entries.length;
      filtered.push(...filterFiles(filesN, excludePattern, minYear));
      console.log(`   📦 Batch ${batchNum}: ${totalScanned} scanned, ${filtered.length} kept`);

      // Allow garbage collection between batches
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return { success: true, totalFiles: totalScanned, files: filtered };
  } catch (error) {
    console.error('List/filter error:', error.message);
    return { success: false, error: error.message, files: [] };
  }
}

/**
 * Main indexing function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 DROPBOX RAG INDEXING - SELECTED FOLDERS');
  console.log('='.repeat(80));
  console.log('\nFolders to index:');
  FOLDERS_TO_INDEX.forEach(f => {
    console.log(`  • ${f.path} (${f.minYear}+${f.exclude ? `, excluding ${f.exclude}` : ''})`);
  });
  console.log('');

  try {
    for (const folder of FOLDERS_TO_INDEX) {
      console.log('\n' + '─'.repeat(80));
      console.log(`📂 ${folder.path.split('/').pop()}`);
      console.log('─'.repeat(80));

      const result = await listAndFilterFiles(folder.path, folder.exclude, folder.minYear);

      if (!result.success) {
        console.error(`❌ Failed to list folder: ${result.error}`);
        continue;
      }

      const filtered = result.files;
      console.log(`✅ Found ${result.totalFiles} files, ${filtered.length} to index\n`);

      stats.totalFiles += filtered.length;

      // Process in batches to avoid memory buildup
      const BATCH_SIZE = 50;
      for (let batchStart = 0; batchStart < filtered.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, filtered.length);
        const batch = filtered.slice(batchStart, batchEnd);

        console.log(`\n🔄 Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(filtered.length / BATCH_SIZE)} (files ${batchStart + 1}-${batchEnd})`);

        for (let i = 0; i < batch.length; i++) {
          const fileIndex = batchStart + i;
          console.log(`\n[${fileIndex + 1}/${filtered.length}] ${Math.round((fileIndex / filtered.length) * 100)}%`);
          await processFile(batch[i], folder.path.split('/').pop());
          await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit pause
        }

        // Force garbage collection between batches
        if (global.gc) {
          global.gc();
          console.log(`   🗑️  Memory cleared after batch`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Pause between batches
      }
    }

    // Print final summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ INDEXING COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n📊 Statistics:`);
    console.log(`   Files processed: ${stats.processedFiles}/${stats.totalFiles}`);
    console.log(`   Files skipped: ${stats.skippedFiles}`);
    console.log(`   Total chunks: ${stats.totalChunks}`);
    console.log(`\n💰 Actual Costs:`);
    console.log(`   Claude Haiku: $${stats.claudeCost.toFixed(4)}`);
    console.log(`   Voyage AI: $${stats.voyageCost.toFixed(4)}`);
    console.log(`   Total: $${(stats.claudeCost + stats.voyageCost).toFixed(2)}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors: ${stats.errors.length}`);
      stats.errors.slice(0, 3).forEach(err => {
        console.log(`   • ${err.file}: ${err.error}`);
      });
    }

    console.log('\n🎉 RAG search ready! Use oracle-search-rag.js to test.\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

/**
 * Queue-Based Streaming Dropbox RAG Indexer
 *
 * Phase 1: Scan Dropbox, write file paths to queue.json (metadata only)
 * Phase 2: Process files one-at-a-time from queue, save progress
 *
 * Resume capability: If it crashes, picks up where it left off
 * Memory safe: Only 1 file in memory at a time
 *
 * Usage:
 *   node --expose-gc --max-old-space-size=4096 scripts/index-dropbox-streaming.js
 */

// Load environment variables BEFORE any imports
import 'dotenv/config';

import { readDropboxFile } from '../src/tools/dropbox.js';
import { Index } from '@upstash/vector';
import { VoyageAIClient } from 'voyageai';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import { existsSync } from 'fs';

// Dropbox OAuth credentials
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_NAMESPACE_ID = process.env.DROPBOX_NAMESPACE_ID;

// Configuration
const FOLDERS_TO_INDEX = [
  { path: '/Granted Team Folder/Sales', exclude: '/Grants/', minYear: 2023 },
  { path: '/Granted Team Folder/HR', exclude: null, minYear: 2025 },
  { path: '/Granted Team Folder/MARKETING', exclude: null, minYear: 2025 }
];

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MAX_FILE_SIZE_MB = 10; // Cap at 10MB to prevent memory explosions

const QUEUE_FILE = '/tmp/dropbox-queue.json';
const PROGRESS_FILE = '/tmp/dropbox-progress.json';

// Initialize clients (lazy-loaded)
let anthropic, voyage, vectorIndex;

function initClients() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
    vectorIndex = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN
    });
  }
}

// Token cache
let cachedAccessToken = null;
let tokenExpiry = 0;

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

/**
 * PHASE 1: Scan Dropbox and build queue (metadata only, no file downloads)
 */
async function buildQueue() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 PHASE 1: BUILDING FILE QUEUE');
  console.log('='.repeat(80));

  const queue = [];
  let totalScanned = 0;

  for (const folder of FOLDERS_TO_INDEX) {
    console.log(`\n📂 Scanning: ${folder.path}`);

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
    let response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: folder.path,
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
    let batchNum = 1;

    // Process batches
    while (true) {
      // Filter files in this batch
      const files = data.entries
        .filter(e => e['.tag'] === 'file')
        .map(f => ({
          path: f.path_display,
          name: f.name,
          size: f.size,
          modified: f.server_modified,
          folder: folder.path.split('/').pop()
        }))
        .filter(file => {
          // Apply filters
          if (folder.exclude && file.path.includes(folder.exclude)) return false;

          const sizeMB = file.size / 1024 / 1024;
          if (sizeMB > MAX_FILE_SIZE_MB) {
            console.log(`   ⚠️  Skipping large file: ${file.name} (${sizeMB.toFixed(1)}MB)`);
            return false;
          }

          if (file.modified) {
            const year = new Date(file.modified).getFullYear();
            if (year < folder.minYear) return false;
          }

          const ext = file.name.toLowerCase().split('.').pop();
          return ['pdf', 'docx', 'doc', 'txt', 'md', 'csv'].includes(ext);
        });

      queue.push(...files);
      totalScanned += data.entries.length;

      console.log(`   📦 Batch ${batchNum}: ${totalScanned} scanned, ${queue.length} queued`);

      if (!data.has_more) break;

      // Continue pagination
      batchNum++;
      response = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cursor: data.cursor })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Dropbox pagination error: ${error.error_summary || response.statusText}`);
      }

      data = await response.json();
    }
  }

  // Save queue to file
  await fs.writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2));
  console.log(`\n✅ Queue saved: ${queue.length} files`);
  console.log(`   📁 ${QUEUE_FILE}`);

  return queue;
}

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
async function generateSummary(text, filename, stats) {
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
async function generateEmbedding(text, stats) {
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
async function processFile(file, stats) {
  try {
    const fileContent = await readDropboxFile(file.path);

    if (!fileContent.success || !fileContent.content || fileContent.content.length < 100) {
      stats.skippedFiles++;
      return { success: false, reason: fileContent.error || 'too short' };
    }

    const text = fileContent.content;
    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const summary = await generateSummary(chunk, file.name, stats);
      const embeddingText = `${summary}\n\n${chunk}`;
      const embedding = await generateEmbedding(embeddingText, stats);

      await vectorIndex.upsert({
        id: `${file.path}#${i}`,
        vector: embedding,
        metadata: {
          filePath: file.path,
          fileName: file.name,
          folder: file.folder,
          fileSize: file.size,
          modified: file.modified,
          chunkIndex: i,
          totalChunks: chunks.length,
          summary,
          preview: chunk.slice(0, 200)
        }
      });

      stats.totalChunks++;
    }

    stats.processedFiles++;
    return { success: true, chunks: chunks.length };

  } catch (error) {
    stats.errors.push({ file: file.path, error: error.message });
    stats.skippedFiles++;
    return { success: false, reason: error.message };
  }
}

/**
 * PHASE 2: Process queue one file at a time
 */
async function processQueue(queue) {
  console.log('\n' + '='.repeat(80));
  console.log('⚙️  PHASE 2: PROCESSING QUEUE');
  console.log('='.repeat(80));

  initClients();

  const stats = {
    totalFiles: queue.length,
    processedFiles: 0,
    skippedFiles: 0,
    totalChunks: 0,
    claudeCost: 0,
    voyageCost: 0,
    errors: []
  };

  // Load progress if exists
  let startIndex = 0;
  if (existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf-8'));
    startIndex = progress.lastProcessedIndex + 1;
    Object.assign(stats, progress.stats);
    console.log(`\n🔄 Resuming from file ${startIndex + 1}/${queue.length}`);
  }

  // Process files one at a time
  for (let i = startIndex; i < queue.length; i++) {
    const file = queue[i];
    const progress = Math.round((i / queue.length) * 100);

    console.log(`\n[${i + 1}/${queue.length}] ${progress}%`);
    console.log(`📄 ${file.name} (${(file.size / 1024).toFixed(1)}KB)`);

    const result = await processFile(file, stats);

    if (result.success) {
      console.log(`   ✅ Indexed ${result.chunks} chunks`);
    } else {
      console.log(`   ⚠️  Skipped: ${result.reason}`);
    }

    // Save progress after each file
    await fs.writeFile(PROGRESS_FILE, JSON.stringify({
      lastProcessedIndex: i,
      stats
    }, null, 2));

    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    // Rate limit pause
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('✅ INDEXING COMPLETE');
  console.log('='.repeat(80));
  console.log(`\n📊 Statistics:`);
  console.log(`   Files processed: ${stats.processedFiles}/${stats.totalFiles}`);
  console.log(`   Files skipped: ${stats.skippedFiles}`);
  console.log(`   Total chunks: ${stats.totalChunks}`);
  console.log(`\n💰 Costs:`);
  console.log(`   Claude Haiku: $${stats.claudeCost.toFixed(4)}`);
  console.log(`   Voyage AI: $${stats.voyageCost.toFixed(4)}`);
  console.log(`   Total: $${(stats.claudeCost + stats.voyageCost).toFixed(2)}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${stats.errors.length}`);
    stats.errors.slice(0, 5).forEach(err => {
      console.log(`   • ${err.file}: ${err.error}`);
    });
  }

  console.log('\n🎉 RAG search ready!\n');

  // Clean up
  await fs.unlink(QUEUE_FILE);
  await fs.unlink(PROGRESS_FILE);
}

/**
 * Main
 */
async function main() {
  try {
    let queue;

    // Check if queue exists
    if (existsSync(QUEUE_FILE)) {
      console.log('📋 Found existing queue, loading...');
      queue = JSON.parse(await fs.readFile(QUEUE_FILE, 'utf-8'));
      console.log(`✓ Loaded ${queue.length} files from queue`);
    } else {
      queue = await buildQueue();
    }

    // Process the queue
    await processQueue(queue);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

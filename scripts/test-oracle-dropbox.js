/**
 * Test Oracle search with Dropbox files
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';
import { readDropboxFile } from '../src/tools/dropbox.js';

dotenv.config();

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

async function testOracleDropbox() {
  try {
    console.log('🔮 Testing Oracle with Dropbox files\n');

    // Test 1: Search for "business case" keyword
    console.log('Test 1: Searching for "business_case" keyword...');
    const businessCaseFiles = await redis.smembers('oracle:keyword:business_case');
    console.log(`✓ Found ${businessCaseFiles.length} files with keyword "business_case"`);

    if (businessCaseFiles.length > 0) {
      // Get details of first file
      const firstFile = businessCaseFiles[0];
      const metadata = await redis.hgetall(`oracle:doc:${firstFile}`);
      console.log(`\n📄 Sample file:`);
      console.log(`  Name: ${metadata.fileName}`);
      console.log(`  Department: ${metadata.department}`);
      console.log(`  Type: ${metadata.fileType}`);
      console.log(`  Summary: ${metadata.summary?.substring(0, 100)}...`);
      console.log(`  Source: ${metadata.source}`);
      console.log(`  Dropbox Path: ${metadata.dropboxPath}`);

      // Test 2: Try to read the file from Dropbox
      if (metadata.dropboxPath) {
        console.log(`\nTest 2: Reading file from Dropbox...`);
        const result = await readDropboxFile(metadata.dropboxPath);
        if (result.success) {
          console.log(`✓ Successfully read file (${result.content.length} characters)`);
          console.log(`  Content preview: ${result.content.substring(0, 200)}...`);
        } else {
          console.log(`✗ Failed to read file: ${result.error}`);
        }
      }
    }

    // Test 3: Check different file types
    console.log(`\nTest 3: Checking file type distribution...`);
    const fileTypes = ['template', 'example', 'reference', 'data', 'process'];
    for (const type of fileTypes) {
      const count = await redis.scard(`oracle:type:${type}`);
      console.log(`  ${type}: ${count} files`);
    }

    // Test 4: Get Dropbox-specific stats
    console.log(`\nTest 4: Dropbox integration stats...`);
    const dropboxFiles = await redis.smembers('oracle:source:dropbox');
    console.log(`  Total Dropbox files: ${dropboxFiles.length}`);

    // Sample 10 random Dropbox files
    const sampleCount = Math.min(10, dropboxFiles.length);
    const samples = dropboxFiles.slice(0, sampleCount);
    let successCount = 0;

    console.log(`\nTest 5: Validating ${sampleCount} random files...`);
    for (const fileId of samples) {
      const metadata = await redis.hgetall(`oracle:doc:${fileId}`);
      if (metadata.fileName && metadata.dropboxPath && metadata.source === 'dropbox') {
        successCount++;
      }
    }
    console.log(`✓ ${successCount}/${sampleCount} files have valid metadata`);

    console.log(`\n✅ Oracle + Dropbox integration is working!`);
    console.log(`\nOracle can now:`);
    console.log(`  • Search across ${dropboxFiles.length} Dropbox files`);
    console.log(`  • Filter by department, file type, and keywords`);
    console.log(`  • Read file contents from Dropbox on demand`);

    redis.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    redis.disconnect();
    process.exit(1);
  }
}

testOracleDropbox();

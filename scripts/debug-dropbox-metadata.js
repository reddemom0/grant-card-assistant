/**
 * Debug Dropbox file metadata in Redis
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

async function debugMetadata() {
  try {
    console.log('Checking Dropbox file metadata...\n');

    // Get 5 random Dropbox files
    const dropboxFiles = await redis.srandmember('oracle:source:dropbox', 5);

    if (!dropboxFiles || dropboxFiles.length === 0) {
      console.log('❌ No files found in oracle:source:dropbox set');
      redis.disconnect();
      return;
    }

    console.log(`Found ${dropboxFiles.length} sample files:\n`);

    for (const fileId of dropboxFiles) {
      console.log(`File ID: ${fileId}`);
      const metadata = await redis.hgetall(`oracle:doc:${fileId}`);
      console.log('Metadata:', JSON.stringify(metadata, null, 2));
      console.log('---\n');
    }

    redis.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    redis.disconnect();
    process.exit(1);
  }
}

debugMetadata();

/**
 * Check Dropbox indexing status in Redis
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

async function checkIndexStatus() {
  try {
    console.log('Checking Dropbox indexing status...\n');

    // Check total Dropbox files indexed
    const dropboxCount = await redis.scard('oracle:source:dropbox');
    console.log(`📦 Total Dropbox files indexed: ${dropboxCount}`);

    // Get a few sample file IDs
    const sampleFiles = await redis.srandmember('oracle:source:dropbox', 5);

    if (sampleFiles && sampleFiles.length > 0) {
      console.log('\n📄 Sample indexed files:');
      for (const fileId of sampleFiles) {
        const fileName = await redis.hget(`oracle:doc:${fileId}`, 'fileName');
        const department = await redis.hget(`oracle:doc:${fileId}`, 'department');
        const fileType = await redis.hget(`oracle:doc:${fileId}`, 'fileType');
        console.log(`  - ${fileName} (${department} / ${fileType})`);
      }
    }

    // Check departments
    const allKeys = await redis.keys('oracle:dept:*');
    console.log(`\n📂 Departments indexed: ${allKeys.length}`);
    for (const key of allKeys.slice(0, 10)) {
      const dept = key.replace('oracle:dept:', '');
      const count = await redis.scard(key);
      console.log(`  - ${dept}: ${count} files`);
    }

    redis.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    redis.disconnect();
    process.exit(1);
  }
}

checkIndexStatus();

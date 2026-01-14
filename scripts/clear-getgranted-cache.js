/**
 * Clear GetGranted Cache
 *
 * Deletes all cached GetGranted search results from Redis
 */

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

async function clearCache() {
  try {
    console.log('🔍 Searching for GetGranted cache keys...');

    // Find all keys matching getgranted:*
    const keys = await redis.keys('getgranted:*');

    if (keys.length === 0) {
      console.log('✅ No cache keys found - cache is already empty');
      process.exit(0);
    }

    console.log(`📋 Found ${keys.length} cache key(s):`);
    keys.forEach(key => console.log(`   - ${key}`));

    // Delete all matching keys
    console.log(`\n🗑️  Deleting ${keys.length} cache key(s)...`);
    const deleted = await redis.del(...keys);

    console.log(`✅ Successfully deleted ${deleted} cache key(s)`);
    console.log('✨ GetGranted cache cleared - next search will use fresh data');

    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

clearCache();

/**
 * Check if marketing@granted.ca exists and has usage data
 */

import { query } from '../src/database/connection.js';

async function checkMarketingUser() {
  try {
    console.log('\n📧 Checking for marketing@granted.ca...\n');

    // Check if user exists
    const userResult = await query(
      'SELECT id, email, name, created_at, is_active FROM users WHERE email = $1',
      ['marketing@granted.ca']
    );

    if (userResult.rows.length === 0) {
      console.log('❌ User marketing@granted.ca NOT FOUND in users table');
      console.log('\n📋 All @granted.ca users:');
      const allUsers = await query(
        "SELECT id, email, name, created_at, is_active FROM users WHERE email LIKE '%@granted.ca' ORDER BY email"
      );
      console.table(allUsers.rows);
      return;
    }

    const user = userResult.rows[0];
    console.log('✅ User found:');
    console.log(user);

    // Check conversation count
    const convCount = await query(
      'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1',
      [user.id]
    );
    console.log(`\n💬 Conversations: ${convCount.rows[0].count}`);

    // Check usage analytics
    const usage = await query(`
      SELECT
        agent_type,
        COUNT(*) as conversation_count,
        COUNT(DISTINCT DATE(created_at)) as active_days,
        MIN(created_at) as first_use,
        MAX(created_at) as last_use
      FROM conversations
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY agent_type
      ORDER BY conversation_count DESC
    `, [user.id]);

    console.log('\n📊 Usage analytics (last 30 days):');
    console.table(usage.rows);

    // Check if user is active
    if (!user.is_active) {
      console.log('\n⚠️  WARNING: User is marked as INACTIVE (is_active = false)');
      console.log('This may prevent them from appearing in analytics!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

checkMarketingUser();

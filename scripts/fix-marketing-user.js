/**
 * Check and fix marketing@granted.ca user account
 * Ensures they are tracked in usage analytics
 */

import { query } from '../src/database/connection.js';

async function fixMarketingUser() {
  try {
    console.log('\n📧 Checking marketing@granted.ca...\n');

    // Check if user exists
    const userResult = await query(
      'SELECT id, email, name, created_at, is_active FROM users WHERE email = $1',
      ['marketing@granted.ca']
    );

    if (userResult.rows.length === 0) {
      console.log('❌ User NOT FOUND - marketing@granted.ca does not exist in users table');
      console.log('ℹ️  This user needs to log in via Google OAuth to create their account');
      process.exit(0);
    }

    const user = userResult.rows[0];
    console.log('✅ User found:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Created: ${user.created_at}`);
    console.log(`   Active: ${user.is_active}`);

    if (!user.is_active) {
      console.log('\n⚠️  User is INACTIVE - this prevents them from appearing in analytics!');
      console.log('🔧 Activating user...');

      await query(
        'UPDATE users SET is_active = true WHERE id = $1',
        [user.id]
      );

      console.log('✅ User activated successfully!');
    } else {
      console.log('\n✅ User is already ACTIVE - should appear in analytics');
    }

    // Check conversation count
    const convCount = await query(
      'SELECT COUNT(*) as count FROM conversations WHERE user_id = $1',
      [user.id]
    );
    console.log(`\n💬 Total conversations: ${convCount.rows[0].count}`);

    // Check recent usage (last 30 days)
    const recentUsage = await query(`
      SELECT
        agent_type,
        COUNT(*) as count,
        MAX(created_at) as last_used
      FROM conversations
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY agent_type
      ORDER BY count DESC
    `, [user.id]);

    if (recentUsage.rows.length > 0) {
      console.log('\n📊 Usage (last 30 days):');
      recentUsage.rows.forEach(row => {
        console.log(`   ${row.agent_type}: ${row.count} conversations (last used: ${row.last_used})`);
      });
    } else {
      console.log('\n📊 No usage in last 30 days');
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

fixMarketingUser();

/**
 * Deactivate a user account
 * Sets is_active = false to hide from usage analytics
 *
 * Usage: node scripts/deactivate-user.js "Brandon Holden"
 * or:    node scripts/deactivate-user.js "brandon.holden@example.com"
 */

import { query } from '../src/database/connection.js';

async function deactivateUser(searchTerm) {
  try {
    console.log(`\n🔍 Searching for user: "${searchTerm}"\n`);

    // Search by name or email
    const searchResult = await query(`
      SELECT id, email, name, is_active, created_at
      FROM users
      WHERE LOWER(name) LIKE LOWER($1)
         OR LOWER(email) LIKE LOWER($1)
      ORDER BY name
    `, [`%${searchTerm}%`]);

    if (searchResult.rows.length === 0) {
      console.log('❌ No users found matching that search term.');
      process.exit(1);
    }

    if (searchResult.rows.length > 1) {
      console.log('⚠️  Multiple users found:\n');
      searchResult.rows.forEach((user, idx) => {
        console.log(`${idx + 1}. ${user.name} (${user.email}) - Active: ${user.is_active}`);
      });
      console.log('\nPlease be more specific with your search term.');
      process.exit(1);
    }

    const user = searchResult.rows[0];
    console.log('✅ Found user:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Currently Active: ${user.is_active}`);
    console.log(`   Created: ${user.created_at}\n`);

    if (!user.is_active) {
      console.log('⚠️  User is already inactive. No changes needed.');
      process.exit(0);
    }

    // Check user's activity
    const activityResult = await query(`
      SELECT
        COUNT(DISTINCT c.id) as total_conversations,
        MAX(c.updated_at) as last_activity,
        COUNT(DISTINCT c.agent_type) as agents_used
      FROM conversations c
      WHERE c.user_id = $1
    `, [user.id]);

    const activity = activityResult.rows[0];
    console.log('📊 User Activity:');
    console.log(`   Total Conversations: ${activity.total_conversations}`);
    console.log(`   Agents Used: ${activity.agents_used}`);
    console.log(`   Last Activity: ${activity.last_activity || 'Never'}\n`);

    // Deactivate the user
    console.log('🔒 Deactivating user...');
    await query(`
      UPDATE users
      SET is_active = false,
          updated_at = NOW()
      WHERE id = $1
    `, [user.id]);

    console.log('✅ User successfully deactivated!');
    console.log('\nThe user will no longer appear in:');
    console.log('  - Usage analytics dashboards');
    console.log('  - Team adoption metrics');
    console.log('  - Active user counts\n');
    console.log('Note: Historical conversation data is preserved for audit purposes.');

    process.exit(0);

  } catch (error) {
    console.error('❌ Error deactivating user:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Get search term from command line
const searchTerm = process.argv[2];

if (!searchTerm) {
  console.log('Usage: node scripts/deactivate-user.js <name or email>');
  console.log('Example: node scripts/deactivate-user.js "Brandon Holden"');
  console.log('Example: node scripts/deactivate-user.js "brandon@example.com"');
  process.exit(1);
}

deactivateUser(searchTerm);

/**
 * Create Admin User Script
 *
 * Promotes a user to admin role
 * Usage: node scripts/create-admin.js user@email.com
 */

import { query } from '../src/database/connection.js';

async function createAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Error: Email address required');
    console.log('Usage: node scripts/create-admin.js user@email.com');
    process.exit(1);
  }

  try {
    console.log(`🔍 Looking for user with email: ${email}`);

    // Check if user exists
    const userResult = await query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      console.error(`❌ User not found: ${email}`);
      console.log('\nNote: User must log in at least once before being promoted to admin');
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`✅ Found user: ${user.name} (${user.email})`);
    console.log(`   Current role: ${user.role || 'user'}`);

    // Update to admin
    if (user.role === 'admin') {
      console.log('⚠️  User is already an admin');
      process.exit(0);
    }

    await query(
      'UPDATE users SET role = $1 WHERE id = $2',
      ['admin', user.id]
    );

    console.log('\n✅ User promoted to admin successfully!');
    console.log(`\n📧 ${user.email} can now access:`);
    console.log('   - Admin dashboard at /admin');
    console.log('   - Admin API endpoints at /api/admin/*');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

createAdmin();

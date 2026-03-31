import pg from 'pg';
import { config } from 'dotenv';

config();

const { Client } = pg;

async function updateCOJG() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Check current status
    console.log('Checking COJG grant status...');
    const checkResult = await client.query(
      `SELECT grant_id, grant_name, currently_accepting, is_active, exclusion_reason
       FROM grants
       WHERE grant_name ILIKE '%COJG%' OR grant_name ILIKE '%Canada Ontario Job Grant%'`
    );

    if (checkResult.rows.length === 0) {
      console.log('❌ No COJG grants found in database');
      return;
    }

    console.log(`\nFound ${checkResult.rows.length} COJG grant(s):\n`);
    checkResult.rows.forEach(row => {
      console.log(`Grant ID: ${row.grant_id}`);
      console.log(`Name: ${row.grant_name}`);
      console.log(`Currently Accepting: ${row.currently_accepting}`);
      console.log(`Is Active: ${row.is_active}`);
      console.log(`Exclusion Reason: ${row.exclusion_reason || 'None'}`);
      console.log('---');
    });

    // Update if currently_accepting is true
    const toUpdate = checkResult.rows.filter(row => row.currently_accepting === true);

    if (toUpdate.length === 0) {
      console.log('\n✅ No COJG grants need updating (already marked as not accepting)');
      return;
    }

    console.log(`\n⚠️  Found ${toUpdate.length} COJG grant(s) marked as currently_accepting = true`);
    console.log('Updating to currently_accepting = false...\n');

    for (const grant of toUpdate) {
      const updateResult = await client.query(
        `UPDATE grants
         SET currently_accepting = false,
             exclusion_reason = $1
         WHERE grant_id = $2
         RETURNING grant_id, grant_name, currently_accepting, exclusion_reason`,
        ['Program paused since June 2025 - do not include in estimates until confirmed active', grant.grant_id]
      );

      console.log(`✅ Updated: ${updateResult.rows[0].grant_name}`);
      console.log(`   Currently Accepting: ${updateResult.rows[0].currently_accepting}`);
      console.log(`   Exclusion Reason: ${updateResult.rows[0].exclusion_reason}\n`);
    }

    console.log('✅ COJG update complete');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

updateCOJG();

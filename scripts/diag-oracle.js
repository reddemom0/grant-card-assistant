import 'dotenv/config';
import { query, getPool } from '../src/database/connection.js';

async function main() {
  const anyOracle = await query(
    `SELECT COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last
     FROM conversations WHERE agent_type = 'internal-oracle'`);
  console.log('internal-oracle conversations total:', anyOracle.rows[0]);

  const recent = await query(
    `SELECT id, agent_type, user_id, created_at
     FROM conversations
     ORDER BY created_at DESC LIMIT 10`);
  console.log('\nMost recent conversations (any agent):');
  for (const r of recent.rows) console.log(`  ${r.created_at?.toISOString()} ${r.agent_type} ${r.id}`);

  const msgRange = await query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS n
     FROM messages
     WHERE created_at >= '2026-04-14' AND created_at < '2026-04-18'
     GROUP BY day ORDER BY day`);
  console.log('\nMessages per day Apr 14–17:');
  for (const r of msgRange.rows) console.log(`  ${r.day.toISOString().slice(0,10)}  ${r.n}`);

  const natalie = await query(
    `SELECT id, email, name FROM users WHERE id = 124 OR email ILIKE '%natalie%' LIMIT 5`);
  console.log('\nNatalie user lookup:');
  for (const r of natalie.rows) console.log(`  id=${r.id} email=${r.email} name=${r.name}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

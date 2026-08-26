import 'dotenv/config';
import { query, getPool } from '../src/database/connection.js';

async function main() {
  // All Oracle conversations in the last 5 days
  const convs = await query(
    `SELECT c.id, c.user_id, c.agent_type, c.title, c.created_at,
            u.email AS user_email, u.name AS user_name,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count,
            (SELECT MIN(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS first_msg,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_msg
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.agent_type = 'internal-oracle'
       AND c.created_at >= '2026-04-11T00:00:00Z'::timestamptz
     ORDER BY c.created_at DESC`);

  console.log(`Oracle conversations since 2026-04-11 UTC: ${convs.rows.length}`);
  for (const r of convs.rows) {
    console.log(`  ${r.created_at?.toISOString?.()}  user=${r.user_id}(${r.user_email || r.user_name})  msgs=${r.msg_count}  first_msg=${r.first_msg?.toISOString?.()}  id=${r.id}  title=${r.title}`);
  }

  // Content search for Natalie across all Oracle convs
  const byContent = await query(
    `SELECT DISTINCT c.id, c.created_at, u.email, c.title,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count
     FROM conversations c
     JOIN messages m ON m.conversation_id = c.id
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.agent_type = 'internal-oracle'
       AND (m.content ILIKE '%Natalie%' OR m.content ILIKE '%Valenzuela%')
     ORDER BY c.created_at DESC
     LIMIT 20`);
  console.log(`\nOracle conversations mentioning Natalie/Valenzuela: ${byContent.rows.length}`);
  for (const r of byContent.rows) {
    console.log(`  ${r.created_at?.toISOString?.()}  user=${r.email}  msgs=${r.msg_count}  id=${r.id}  title=${r.title}`);
  }

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

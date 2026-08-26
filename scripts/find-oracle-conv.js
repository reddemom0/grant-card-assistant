import 'dotenv/config';
import { query } from '../src/database/connection.js';
import { getPool } from '../src/database/connection.js';

const TARGET_ID = '2e180323-6c5e-4caa-9f2b-7a845a5da325';

async function main() {
  const direct = await query(
    `SELECT id, user_id, agent_type, title, created_at, updated_at
     FROM conversations WHERE id = $1`, [TARGET_ID]);
  console.log('Direct lookup rows:', direct.rows.length);
  if (direct.rows.length) console.log(direct.rows[0]);

  const msgDirect = await query(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = $1`, [TARGET_ID]);
  console.log('Messages with that conversation_id:', msgDirect.rows[0].n);

  // Search for internal-oracle conversations by user 124 around April 15-16 2026
  const around = await query(
    `SELECT c.id, c.user_id, c.agent_type, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_msg
     FROM conversations c
     WHERE c.agent_type = 'internal-oracle'
       AND c.created_at BETWEEN '2026-04-14'::timestamptz AND '2026-04-17'::timestamptz
     ORDER BY c.created_at DESC
     LIMIT 20`);
  console.log(`\nOracle conversations Apr 14-17, 2026: ${around.rows.length}`);
  for (const r of around.rows) {
    console.log(`  ${r.id}  user=${r.user_id}  msgs=${r.msg_count}  created=${r.created_at?.toISOString?.() || r.created_at}  last=${r.last_msg?.toISOString?.() || r.last_msg}  title=${r.title}`);
  }

  // Fuzzy match the UUID prefix (first 8)
  const fuzzy = await query(
    `SELECT id, user_id, agent_type, created_at FROM conversations
     WHERE id::text LIKE $1 LIMIT 10`, ['2e180323%']);
  console.log(`\nUUID prefix 2e180323 matches: ${fuzzy.rows.length}`);
  for (const r of fuzzy.rows) console.log(`  ${r.id} ${r.agent_type} ${r.created_at}`);

  // Search messages for Samuel Vincent / Charlotte Langevin text
  const contentHits = await query(
    `SELECT DISTINCT conversation_id FROM messages
     WHERE content ILIKE '%Samuel Vincent%' OR content ILIKE '%Charlotte Langevin%' OR content ILIKE '%Evan Armstrong%'
     LIMIT 10`);
  console.log(`\nConversations mentioning those candidate names: ${contentHits.rows.length}`);
  for (const r of contentHits.rows) console.log(`  ${r.conversation_id}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

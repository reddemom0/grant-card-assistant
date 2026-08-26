import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { query, getPool } from '../src/database/connection.js';
import { getConversationToolTrace, getConversation } from '../src/database/messages.js';

async function main() {
  const recent = await query(
    `SELECT c.id, c.user_id, c.title, c.created_at,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_msg,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count
     FROM conversations c
     WHERE c.agent_type = 'internal-oracle'
       AND c.created_at >= NOW() - INTERVAL '1 hour'
     ORDER BY c.created_at DESC
     LIMIT 10`);

  console.log(`internal-oracle conversations created in last 1h: ${recent.rows.length}`);
  for (const r of recent.rows) {
    console.log(`  ${r.created_at?.toISOString()}  msgs=${r.msg_count}  last=${r.last_msg?.toISOString?.() || r.last_msg}  user=${r.user_id}  id=${r.id}  title=${r.title}`);
  }

  if (!recent.rows.length) {
    console.log('\nNo matching conversations. Exiting.');
    await getPool().end();
    return;
  }

  const target = recent.rows[0];
  const meta = await getConversation(target.id);
  const trace = await getConversationToolTrace(target.id);

  const out = 'scripts/output/oracle-latest-trace.json';
  writeFileSync(out, JSON.stringify({ meta, trace }, null, 2));
  console.log(`\nWrote ${trace.length} entries to ${out}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

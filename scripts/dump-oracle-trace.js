import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getConversationToolTrace, getConversation } from '../src/database/messages.js';
import { getPool } from '../src/database/connection.js';

const CONVERSATION_ID = '2e180323-6c5e-4caa-9f2b-7a845a5da325';

async function main() {
  const meta = await getConversation(CONVERSATION_ID);
  const trace = await getConversationToolTrace(CONVERSATION_ID);

  const outPath = 'scripts/output/oracle-trace.json';
  writeFileSync(outPath, JSON.stringify({ meta, trace }, null, 2));
  console.log(`Wrote ${trace.length} trace entries to ${outPath}`);
  console.log(`Conversation agent: ${meta?.agent_type}, user_id: ${meta?.user_id}, messages: ${meta?.message_count}`);

  await getPool().end();
}

main().catch(e => { console.error(e); process.exit(1); });

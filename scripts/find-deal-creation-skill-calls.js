import 'dotenv/config';
import { query, getPool } from '../src/database/connection.js';

async function main() {
  // Find every message that contains a load_skill call for hubspot
  const rows = (await query(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
            c.agent_type, c.user_id, c.title
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE (m.content LIKE '%"name":"load_skill"%' AND m.content LIKE '%DEAL_CREATION%')
         OR (m.content LIKE '%tool_use_id%' AND m.content LIKE '%DEAL_CREATION%')
      ORDER BY m.created_at ASC`
  )).rows;

  console.log(`Candidate messages: ${rows.length}`);

  const uses = new Map();
  const results = new Map();

  for (const row of rows) {
    let blocks;
    try { blocks = JSON.parse(row.content); } catch { continue; }
    if (!Array.isArray(blocks)) blocks = [blocks];

    for (const b of blocks) {
      if (!b || !b.type) continue;
      if (b.type === 'tool_use' && b.name === 'load_skill'
          && b.input?.skill_name === 'hubspot' && b.input?.sub_skill === 'DEAL_CREATION') {
        uses.set(b.id, {
          conv: row.conversation_id,
          agent: row.agent_type,
          user: row.user_id,
          title: row.title,
          ts: row.created_at
        });
      }
      if (b.type === 'tool_result') {
        let text = '';
        if (typeof b.content === 'string') text = b.content;
        else if (Array.isArray(b.content)) {
          text = b.content.map(x => (x.text || JSON.stringify(x))).join('\n');
        }
        // Only record if this matches a known load_skill use
        results.set(b.tool_use_id, {
          is_error: b.is_error === true,
          preview: text.slice(0, 400),
          ts: row.created_at
        });
      }
    }
  }

  console.log(`\nload_skill(hubspot, DEAL_CREATION) tool_use: ${uses.size}`);
  let ok = 0, err = 0, orphan = 0;
  const byAgent = {};
  const details = [];
  for (const [id, u] of uses.entries()) {
    const r = results.get(id);
    byAgent[u.agent] = (byAgent[u.agent] || 0) + 1;
    if (!r) { orphan++; details.push({ id, status: 'NO_RESULT', ...u }); continue; }
    let parsed = null;
    try { parsed = JSON.parse(r.preview); } catch {}
    const status = r.is_error ? 'ERROR' : (parsed?.success === false ? 'FAILED' : 'OK');
    if (status === 'OK') ok++; else err++;
    details.push({
      status,
      conv: u.conv,
      agent: u.agent,
      user: u.user,
      ts: u.ts?.toISOString?.() || u.ts,
      title: u.title,
      preview: r.preview.replace(/\s+/g, ' ').slice(0, 220)
    });
  }
  console.log(`OK: ${ok}   ERROR/FAILED: ${err}   ORPHAN: ${orphan}`);
  console.log(`By agent:`, byAgent);
  console.log();
  for (const d of details.slice(-12)) {
    console.log(`${d.ts}  [${d.status}]  agent=${d.agent}  user=${d.user}  conv=${d.conv}`);
    console.log(`   title="${d.title}"`);
    console.log(`   -> ${d.preview}`);
  }

  await getPool().end();
}
main().catch(e => { console.error(e); process.exit(1); });

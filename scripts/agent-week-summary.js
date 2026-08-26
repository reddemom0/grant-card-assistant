import 'dotenv/config';
import { query, getPool } from '../src/database/connection.js';

const recent = await query(
  `SELECT MIN(created_at) AS earliest, MAX(created_at) AS latest, COUNT(*) AS total
     FROM conversations`
);
console.log('\n=== conversations table overview ===');
console.log(recent.rows[0]);

const top = await query(
  `SELECT agent_type, COUNT(*) AS n, MAX(created_at) AS last
     FROM conversations
     GROUP BY agent_type
     ORDER BY last DESC NULLS LAST
     LIMIT 25`
);
console.log('\n=== agents by most-recent conversation ===');
top.rows.forEach(x => console.log(`  ${String(x.n).padStart(4)} | last: ${x.last?.toISOString?.() || x.last} | ${x.agent_type}`));

await getPool().end();

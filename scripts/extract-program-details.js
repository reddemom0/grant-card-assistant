import 'dotenv/config';
import { query } from '../src/database/connection.js';

const CONVOS = [
  '8ee0ab72-b132-4017-b10a-2ab6dc355321',
  '67c848ec-2be2-448d-9894-762b02e99730',
  'f7828ac8-b95a-4d37-b40e-4df34ba9176f',
  'd2b10838-91d1-448d-85cb-7f86d4bde83f',
  'cfaf7355-3da6-43db-87e3-76974ebf0bdb',
  'b029fcd1-0124-48f2-ba15-3e2400920535',
  '13e96dce-582e-48a6-85ae-f370cdf47f4e',
  'c1dfdc62-ff55-4877-a873-54c945e1e74e',
  '43b97783-9142-4b20-9216-435e7294b7e5',
  '14bdd950-259c-403f-851d-baa56f0d621f',
  'dd5c7712-9046-47f9-9efb-d3337210a404',
  'a9710164-d56b-4aa2-a8bc-6523610716ec',
  '223e5d03-dcec-4619-a065-cd6cef766801',
  'fbbf8f6d-2d5c-4b88-be7c-0a8bb773cbbf',
  '59ba0da1-7ae5-4f36-bbe3-bdf744ac5a63',
  '1dd576fb-5e42-4033-b22f-2d8cf3404a08',
  'b9150d06-0112-4c9c-aa1b-f991e059a4dd',
  '56d17c5c-4b24-4f4e-b4b8-8c0a9e6214bf',
  '72311ab4-075f-4500-9fb3-0c374ed875ee',
  'a02f92ac-071d-4e80-b580-cbdaae88f1e9',
  '0fc46391-5211-433e-84bb-0997a8dcbeaf',
  '543b1cd6-a843-43d3-9fec-e8e02ef15a4f',
  'da9011a8-0f68-45db-8aa3-b73cdd9dd197',
];

function extractText(content) {
  if (typeof content === 'string') {
    const t = content.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try { return extractText(JSON.parse(t)); } catch { return content; }
    }
    return content;
  }
  if (Array.isArray(content)) {
    // only true text blocks — ignore tool_use/tool_result/thinking/etc.
    return content
      .map(b => {
        if (typeof b === 'string') return b;
        if (b && b.type === 'text') return b.text || '';
        if (b && !b.type && typeof b.text === 'string') return b.text;
        return '';
      })
      .join('\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  return '';
}

// Extract a "Program Details" section from a body of markdown text.
function sliceSection(text, headingRe) {
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  // collect until next top-level heading (## or #) or "Section 6"
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*#{1,3}\s/.test(lines[i]) || /Section\s*6/i.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

const headingRe = /Program Details|Section\s*5/i;

for (const cid of CONVOS) {
  const r = await query(
    `SELECT role, content, created_at FROM messages WHERE conversation_id = $1 AND role = 'assistant' ORDER BY created_at ASC`,
    [cid]
  );
  let found = 0;
  for (const row of r.rows) {
    const text = extractText(row.content);
    if (!headingRe.test(text)) continue;
    const section = sliceSection(text, headingRe);
    if (!section) continue;
    found++;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`CONVO ${cid}  msg#${found}  ${row.created_at?.toISOString?.() || row.created_at}`);
    console.log('='.repeat(80));
    console.log(section.trim());
  }
  if (found === 0) {
    // note convos with no detectable Program Details section
    console.log(`\n[no Program Details section detected in ${cid}]`);
  }
}
process.exit(0);

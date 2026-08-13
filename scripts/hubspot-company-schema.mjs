/**
 * hubspot-company-schema.mjs — report the HubSpot COMPANY properties that
 * carry status and product/service tier, with their allowed values.
 *
 * Step 1 of the live/archived split. Read-only: one GET to
 * /crm/v3/properties/companies. No writes of any kind, to HubSpot or anywhere
 * else. No Dropbox, no Drive.
 *
 * Usage: node scripts/hubspot-company-schema.mjs
 */

import 'dotenv/config';
import fsp from 'node:fs/promises';

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) { console.error('ABORT: HUBSPOT_ACCESS_TOKEN not set'); process.exit(1); }

const OUT = 'dist/inventory/hubspot-company-properties.json';

const res = await fetch('https://api.hubapi.com/crm/v3/properties/companies', {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!res.ok) {
  console.error(`ABORT: HubSpot ${res.status} — ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await res.json();
const props = data.results ?? [];
console.error(`${props.length} company properties`);

await fsp.mkdir('dist/inventory', { recursive: true });
await fsp.writeFile(OUT, JSON.stringify(props, null, 2));

// Candidates worth a human look, by name or label.
const INTEREST = /(status|active|archiv|lifecycle|stage|tier|product|service|package|plan|type|legal|alias|dba|aka|former)/i;
const hits = props
  .filter((p) => INTEREST.test(p.name) || INTEREST.test(p.label ?? ''))
  .map((p) => ({
    name: p.name,
    label: p.label,
    type: `${p.type}/${p.fieldType}`,
    custom: !p.hubspotDefined,
    calculated: !!p.calculated,
    options: (p.options ?? []).map((o) => o.value).filter((v) => v !== ''),
  }));

console.log(JSON.stringify({ total_properties: props.length, candidates: hits }, null, 2));

/**
 * fetch-hubspot-companies.mjs — pull company names from HubSpot for the Step 4
 * cross-check. Read-only (GET only). Writes names to a local JSON file so the
 * 13.8k-row list never has to pass through the model's context.
 */

import 'dotenv/config';
import fsp from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) { console.error('ABORT: HUBSPOT_ACCESS_TOKEN not set'); process.exit(1); }

const OUT = path.join(process.env.CLASSIFY_STATE_DIR || '.', 'hubspot-companies.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const companies = [];
let after = null;
let page = 0;

while (true) {
  const url = new URL('https://api.hubapi.com/crm/v3/objects/companies');
  url.searchParams.set('limit', '100');
  url.searchParams.set('properties', 'name,domain');
  if (after) url.searchParams.set('after', after);

  let res;
  for (let attempt = 1; attempt <= 6; attempt++) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after') || 0) * 1000 || Math.min(1000 * 2 ** attempt, 16000);
      console.error(`  ${res.status}, retry ${attempt} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    break;
  }
  if (!res.ok) {
    console.error(`ABORT: HubSpot ${res.status} — ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const data = await res.json();
  for (const r of data.results ?? []) {
    if (r.properties?.name) {
      companies.push({ id: r.id, name: r.properties.name, domain: r.properties.domain ?? null });
    }
  }
  page += 1;
  if (page % 20 === 0) console.error(`  page ${page}: ${companies.length} companies`);

  after = data.paging?.next?.after;
  if (!after) break;
  await sleep(60);
}

await fsp.writeFile(OUT, JSON.stringify(companies, null, 0));
console.error(`wrote ${OUT} — ${companies.length} companies over ${page} pages`);

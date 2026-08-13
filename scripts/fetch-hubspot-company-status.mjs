/**
 * fetch-hubspot-company-status.mjs — pull every HubSpot company with the
 * status and product-tier fields needed for the live/archived split.
 *
 * Step 2 of the live/archived split. READ-ONLY: the only endpoint touched is
 * GET /crm/v3/objects/companies (paged). No POST, PATCH, PUT or DELETE, to
 * HubSpot or anywhere else. No Dropbox, no Drive.
 *
 * Writes the full result to a local JSON file so the ~13k rows are matched on
 * disk and never pass through the model's context.
 *
 * Usage: node scripts/fetch-hubspot-company-status.mjs
 */

import 'dotenv/config';
import fsp from 'node:fs/promises';

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) { console.error('ABORT: HUBSPOT_ACCESS_TOKEN not set'); process.exit(1); }

const OUT = 'dist/inventory/hubspot-companies-status.json';

// `active`                    — Active (boolean checkbox), the status authority
// `best_fit_product`          — Product Type
// `best_fit_product_company`  — Best Fit Product (near-duplicate; kept to compare fill)
// `extra6`                    — Legal Business Name (alias source for fuzzy matching)
// `lifecyclestage`, `type`    — standard fields, kept for cross-checking status
const PROPS = [
  'name', 'domain', 'active', 'best_fit_product', 'best_fit_product_company',
  'extra6', 'lifecyclestage', 'type', 'createdate', 'hs_lastmodifieddate',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const companies = [];
let after = null;
let page = 0;

while (true) {
  const url = new URL('https://api.hubapi.com/crm/v3/objects/companies');
  url.searchParams.set('limit', '100');
  url.searchParams.set('properties', PROPS.join(','));
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
    const p = r.properties ?? {};
    companies.push({
      id: r.id,
      name: p.name ?? null,
      domain: p.domain ?? null,
      active: p.active ?? null,
      product: p.best_fit_product ?? null,
      product_alt: p.best_fit_product_company ?? null,
      legal_name: p.extra6 ?? null,
      lifecycle: p.lifecyclestage ?? null,
      type: p.type ?? null,
      created: p.createdate ?? null,
    });
  }
  page += 1;
  if (page % 25 === 0) console.error(`  page ${page}: ${companies.length} companies`);

  after = data.paging?.next?.after;
  if (!after) break;
  await sleep(60);
}

await fsp.mkdir('dist/inventory', { recursive: true });
await fsp.writeFile(OUT, JSON.stringify(companies));
console.error(`wrote ${OUT} — ${companies.length} companies over ${page} pages`);

// ------------------------------------------------------------- fill rates
const n = companies.length;
const pct = (c) => `${((c / n) * 100).toFixed(1)}%`;
const filled = (f) => companies.filter((c) => c[f] !== null && c[f] !== '').length;

const dist = (f) => {
  const m = new Map();
  for (const c of companies) m.set(c[f] ?? '(empty)', (m.get(c[f] ?? '(empty)') ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(JSON.stringify({
  companies: n,
  pages: page,
  fill: {
    name: `${filled('name')} (${pct(filled('name'))})`,
    active: `${filled('active')} (${pct(filled('active'))})`,
    best_fit_product: `${filled('product')} (${pct(filled('product'))})`,
    best_fit_product_company: `${filled('product_alt')} (${pct(filled('product_alt'))})`,
    legal_name_extra6: `${filled('legal_name')} (${pct(filled('legal_name'))})`,
    lifecyclestage: `${filled('lifecycle')} (${pct(filled('lifecycle'))})`,
    type: `${filled('type')} (${pct(filled('type'))})`,
    domain: `${filled('domain')} (${pct(filled('domain'))})`,
  },
  active_values: dist('active'),
  product_values: dist('product'),
  product_alt_values: dist('product_alt'),
  lifecycle_values: dist('lifecycle'),
}, null, 2));

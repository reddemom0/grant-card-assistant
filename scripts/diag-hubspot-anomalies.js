/**
 * Read-only HubSpot diagnostics for two anomalies on contact 220002878347:
 *   1. annual_revenue_from_the_last_fiscal_year shows "CAD 1.00" in UI
 *   2. best_fit_product empty even though PATCH log shows it was set
 *
 * Fetches:
 *   - property def: annual_revenue_from_the_last_fiscal_year
 *   - property def: best_fit_product
 *   - all contact properties matching label/name pattern "product_type" / "Product Type"
 *   - contact 220002878347 with the relevant properties
 *   - form schema (JSONP, no auth) for the same form's revenue field options
 *
 * Usage: railway run node scripts/diag-hubspot-anomalies.js
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const FORM_GUID = '1a2b53cb-5a53-43c0-b1d8-5bdb8c8467c0';
const PORTAL_ID = '21088260';
const CONTACT_ID = '220002878347';
const OUT = '/tmp/hubspot-anomaly-diagnosis.json';

if (!TOKEN) {
  console.error('❌ HUBSPOT_ACCESS_TOKEN not set. Run via: railway run node scripts/diag-hubspot-anomalies.js');
  process.exit(1);
}

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  timeout: 20000
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function getPropertyDef(name) {
  try {
    const r = await hs.get(`/crm/v3/properties/contacts/${name}`);
    return { ok: true, data: r.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, error: e.response?.data || e.message };
  }
}

async function searchProductTypeProperties() {
  // No filter endpoint by label, so list all and filter
  const r = await hs.get('/crm/v3/properties/contacts');
  const all = r.data.results || [];
  const matches = all.filter((p) =>
    /product_type/i.test(p.name) ||
    /^product type/i.test(p.label || '') ||
    p.name === 'best_fit_product' ||
    p.name === 'best_fit_product_company'
  );
  return matches.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    description: p.description?.slice(0, 200),
    options: (p.options || []).map((o) => ({ label: o.label, value: o.value })),
    modificationMetadata: p.modificationMetadata
  }));
}

async function getContact() {
  const props = [
    'annual_revenue_from_the_last_fiscal_year',
    'best_fit_product',
    'product_type',
    'product_type__cloned_',
    'firstname',
    'lastname',
    'email',
    'company',
    'submission_source',
    'createdate',
    'lastmodifieddate'
  ].join(',');
  const r = await hs.get(`/crm/v3/objects/contacts/${CONTACT_ID}?properties=${props}&propertiesWithHistory=annual_revenue_from_the_last_fiscal_year,best_fit_product,product_type`);
  return r.data;
}

async function fetchFormSchema() {
  const url = `https://forms.hubspot.com/embed/v3/form/${PORTAL_ID}/${FORM_GUID}?callback=cb&t=${Date.now()}`;
  const res = await axios.get(url, { timeout: 15000, responseType: 'text' });
  const stripped = String(res.data).replace(/^cb\(/, '').replace(/\)$/, '');
  const parsed = JSON.parse(stripped);
  return parsed.form;
}

function extractRevenueFieldFromForm(form) {
  for (const g of form.formFieldGroups || []) {
    for (const f of g.fields || []) {
      if (f.name === 'annual_revenue_from_the_last_fiscal_year') return f;
    }
  }
  return null;
}

// ─── main ──────────────────────────────────────────────────────────────────

(async function main() {
  const out = { generatedAt: new Date().toISOString() };

  console.log('1/4 fetching property def: annual_revenue_from_the_last_fiscal_year');
  out.revenuePropertyDef = await getPropertyDef('annual_revenue_from_the_last_fiscal_year');

  console.log('2/4 fetching property def: best_fit_product + searching product_type variants');
  out.bestFitProductDef = await getPropertyDef('best_fit_product');
  out.productTypePropertyMatches = await searchProductTypeProperties();

  console.log(`3/4 fetching contact ${CONTACT_ID}`);
  try {
    out.contact = await getContact();
  } catch (e) {
    out.contact = { error: e.response?.data || e.message };
  }

  console.log('4/4 fetching form schema (JSONP, no auth)');
  try {
    const form = await fetchFormSchema();
    out.formRevenueField = extractRevenueFieldFromForm(form);
  } catch (e) {
    out.formRevenueField = { error: e.message };
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n✅ Written: ${OUT}\n`);

  // ─── inline summary ────────────────────────────────────────────────────
  console.log('━━━ Quick summary ━━━\n');

  if (out.revenuePropertyDef.ok) {
    const p = out.revenuePropertyDef.data;
    console.log(`revenue property:`);
    console.log(`  type=${p.type}, fieldType=${p.fieldType}`);
    console.log(`  options count: ${(p.options || []).length}`);
    if ((p.options || []).length > 0) {
      console.log(`  first 8 options:`);
      for (const o of p.options.slice(0, 8)) {
        console.log(`    label="${o.label}"  value="${o.value}"`);
      }
    }
    if (p.modificationMetadata) {
      console.log(`  modificationMetadata: ${JSON.stringify(p.modificationMetadata)}`);
    }
  } else {
    console.log(`revenue property: ERROR ${out.revenuePropertyDef.status}: ${JSON.stringify(out.revenuePropertyDef.error).slice(0, 300)}`);
  }
  console.log();

  if (out.bestFitProductDef.ok) {
    const p = out.bestFitProductDef.data;
    console.log(`best_fit_product property:`);
    console.log(`  type=${p.type}, fieldType=${p.fieldType}`);
    console.log(`  options: ${(p.options || []).map((o) => o.value).join(' | ')}`);
  } else {
    console.log(`best_fit_product: ERROR ${out.bestFitProductDef.status}`);
  }
  console.log();

  console.log(`product_type-related properties found: ${out.productTypePropertyMatches.length}`);
  for (const p of out.productTypePropertyMatches) {
    console.log(`  - name="${p.name}" label="${p.label}" type=${p.type}/${p.fieldType}`);
    console.log(`      options: ${p.options.map((o) => o.value).join(' | ') || '(none)'}`);
  }
  console.log();

  if (out.contact && out.contact.properties) {
    console.log(`contact ${CONTACT_ID}:`);
    for (const k of ['annual_revenue_from_the_last_fiscal_year', 'best_fit_product', 'product_type', 'product_type__cloned_', 'submission_source', 'firstname', 'lastname', 'email', 'company', 'createdate', 'lastmodifieddate']) {
      console.log(`  ${k} = ${JSON.stringify(out.contact.properties[k])}`);
    }
    if (out.contact.propertiesWithHistory) {
      console.log(`\n  propertiesWithHistory:`);
      for (const k of Object.keys(out.contact.propertiesWithHistory)) {
        const hist = out.contact.propertiesWithHistory[k] || [];
        console.log(`    ${k}: ${hist.length} entries`);
        for (const h of hist.slice(0, 3)) {
          console.log(`      [${h.timestamp}] value=${JSON.stringify(h.value)} sourceType=${h.sourceType} sourceId=${h.sourceId} updatedByUserId=${h.updatedByUserId}`);
        }
      }
    }
  } else {
    console.log(`contact: ${JSON.stringify(out.contact).slice(0, 400)}`);
  }
  console.log();

  if (out.formRevenueField && !out.formRevenueField.error) {
    const f = out.formRevenueField;
    console.log(`form's revenue field:`);
    console.log(`  fieldType=${f.fieldType} required=${f.required}`);
    console.log(`  options:`);
    for (const o of f.options || []) {
      console.log(`    label="${o.label}"  value="${o.value}"`);
    }
  } else {
    console.log(`form revenue field: ${JSON.stringify(out.formRevenueField)}`);
  }
})().catch((e) => {
  console.error('crashed:', e.message);
  if (e.response) console.error(JSON.stringify(e.response.data, null, 2).slice(0, 2000));
  process.exit(1);
});

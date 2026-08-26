/**
 * Diff HubSpot "Grant Calculator Oct 2025" form schema vs. our buildFormFields output.
 *
 * Read-only. GET the form definition from HubSpot's Marketing Forms API, parse
 * the field schema, compare against the 21 field names buildFormFields produces
 * in src/api/hubspot-form-submission.js, and write the diff to
 * /tmp/form-schema-diff.md.
 *
 * Why: yesterday's Phase 2 form-submission rewrite failed in production with
 * "Required field 'X' is missing" errors for `phone`, `what_do_you_spend_it_on_`,
 * and `would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gran`.
 * Code at hubspot-form-submission.js:143 sends `..._with_gr` (truncated) which
 * suggests at least one mismatch. This script tells us exactly which fields
 * are required by the live form, what their internal names are, whether the
 * names match what we send, and whether any have defaults we could rely on.
 *
 * Usage: node scripts/diff-hubspot-form-schema.js
 */

import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const FORM_GUID = '1a2b53cb-5a53-43c0-b1d8-5bdb8c8467c0';
const PORTAL_ID = '21088260';
const OUTPUT_PATH = '/tmp/form-schema-diff.md';

// Auth-free JSONP endpoint is preferred — Marketing Forms API requires the
// `forms` scope which our private app doesn't currently have. The JSONP embed
// endpoint returns the same field schema. We'll fall back to the authenticated
// API only if JSONP fails for any reason.
const USE_JSONP = true;

// ============================================================================
// CODE-SIDE: the 21 fields buildFormFields() emits in
// src/api/hubspot-form-submission.js (extracted by reading the source).
// Order matches the file. `staticValue` is what we always send when the code
// hits that branch (used for diff display, not for matching).
// ============================================================================

const CODE_FIELDS = [
  { name: 'firstname',                                                                         note: 'split from contact_name' },
  { name: 'lastname',                                                                          note: 'split from contact_name' },
  { name: 'email',                                                                             note: 'from session' },
  { name: 'company',                                                                           note: 'from session' },
  { name: 'website',                                                                           note: 'optional, omitted if null' },
  { name: 'industry_contact',                                                                  note: 'mapped via WIDGET_TO_HUBSPOT_INDUSTRY' },
  { name: 'how_did_you_hear_about_us_',                                                        note: 'static "Other"' },
  { name: 'have_you_applied_for_grants_before_',                                               note: 'computed Yes/No' },
  { name: 'is_your_organization_for_profit_or_non_profit_',                                    note: 'computed yes/no (lowercase)' },
  { name: 'has_your_business_existed_for_a_year_',                                             note: 'computed yes/no (lowercase)' },
  { name: 'annual_revenue_from_the_last_fiscal_year',                                          note: 'mapped via REVENUE_MAP' },
  { name: 'where_is_your_organizations_headquartered_',                                        note: 'province; comma→semicolon' },
  { name: 'numemployees',                                                                      note: 'integer via EMPLOYEE_COUNT_MAP' },
  { name: 'number_of_full_time_positions_',                                                    note: 'integer via HIRING_PLANS_MAP' },
  { name: 'estimated_budget_',                                                                 note: 'integer via BUDGET_RANGE_MAP (training)' },
  { name: 'would_you_spend_more_on_training_your_staff_if_you_had_a_significant___of_cost_reimbursed_with_gr', note: 'static "Yes" — SUSPECT TRUNCATION' },
  { name: 'where_will_you_be_expanding_',                                                      note: 'inferred from growth_plans + planned_activities' },
  { name: 'expansion_budget_',                                                                 note: 'integer via BUDGET_RANGE_MAP (expansion)' },
  { name: 'research_and_development_budget',                                                   note: 'static 0' },
  { name: 'what_do_you_spend_it_on_',                                                          note: 'planned_activities text' },
  { name: 'best_fit_product',                                                                  note: 'computed routing decision' }
];

// ============================================================================
// FETCH form schema from HubSpot Marketing Forms API
// ============================================================================

async function fetchFormSchema() {
  if (USE_JSONP) {
    const url = `https://forms.hubspot.com/embed/v3/form/${PORTAL_ID}/${FORM_GUID}?callback=cb&t=${Date.now()}`;
    console.log(`📡 GET ${url}`);
    const res = await axios.get(url, { timeout: 15000, responseType: 'text' });
    // Strip JSONP wrapper: cb({...})
    const stripped = String(res.data).replace(/^cb\(/, '').replace(/\)$/, '');
    const parsed = JSON.parse(stripped);
    return parsed.form;
  }

  // Authenticated path (currently blocked by missing `forms` scope)
  if (!HUBSPOT_TOKEN) {
    throw new Error('HUBSPOT_ACCESS_TOKEN not set and JSONP disabled');
  }
  const url = `https://api.hubapi.com/marketing/v3/forms/${FORM_GUID}`;
  console.log(`📡 GET ${url}`);
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return res.data;
}

// ============================================================================
// PARSE — Forms v3 returns fields nested under fieldGroups[].fields[]. Each
// field has at least { name, label, fieldType, required, ...optional }.
// Some response shapes use `objectTypeId` and `defaultValue` / `defaultValues`.
// We collect everything into a flat array preserving order.
// ============================================================================

function flattenFields(formDef) {
  const out = [];

  // Newer v3 shape: fieldGroups[].fields[]
  if (Array.isArray(formDef.fieldGroups)) {
    for (const group of formDef.fieldGroups) {
      const fields = group.fields || [];
      for (const f of fields) {
        out.push({
          name: f.name,
          label: f.label || '',
          fieldType: f.fieldType || f.type || '',
          objectTypeId: f.objectTypeId || '',
          required: f.required === true,
          hidden: f.hidden === true,
          defaultValue: f.defaultValue ?? (Array.isArray(f.defaultValues) ? f.defaultValues.join('|') : ''),
          placeholder: f.placeholder || '',
          options: Array.isArray(f.options) ? f.options.map(o => o.value).slice(0, 10) : []
        });
      }
    }
  }

  // Older / legacy shape fallback: top-level `formFieldGroups` (HubSpot
  // sometimes returns this for older form definitions).
  if (out.length === 0 && Array.isArray(formDef.formFieldGroups)) {
    for (const group of formDef.formFieldGroups) {
      const fields = group.fields || [];
      for (const f of fields) {
        out.push({
          name: f.name,
          label: f.label || '',
          fieldType: f.fieldType || '',
          objectTypeId: '',
          required: f.required === true,
          hidden: f.hidden === true,
          defaultValue: f.defaultValue ?? '',
          placeholder: f.placeholder || '',
          options: Array.isArray(f.options) ? f.options.map(o => o.value).slice(0, 10) : []
        });
      }
    }
  }

  return out;
}

// ============================================================================
// DIFF
// ============================================================================

function diff(formFields, codeFields) {
  const formNames = new Set(formFields.map(f => f.name));
  const codeNames = new Set(codeFields.map(f => f.name));

  const requiredFormFields = formFields.filter(f => f.required);

  // Section 1: Required by form, not sent by code (BLOCKERS)
  const blockers = requiredFormFields
    .filter(f => !codeNames.has(f.name))
    .map(f => ({
      formField: f,
      hasDefault: f.defaultValue !== '' && f.defaultValue !== null && f.defaultValue !== undefined
    }));

  // Section 2: Sent by code but no matching form field name (SILENT FAILURES)
  const silentFailures = codeFields
    .filter(c => !formNames.has(c.name))
    .map(c => {
      // Try to find the closest form field name (substring match) so we can
      // suggest the corrected name in the report.
      const candidates = [...formNames].filter(n =>
        n.includes(c.name.slice(0, Math.min(40, c.name.length))) ||
        c.name.includes(n.slice(0, Math.min(40, n.length)))
      );
      return { codeField: c, possibleMatch: candidates[0] || null };
    });

  // Section 3: Full comparison table — union of both sides
  const allNames = [...new Set([...formNames, ...codeNames])].sort();
  const comparison = allNames.map(name => {
    const formField = formFields.find(f => f.name === name);
    const codeField = codeFields.find(c => c.name === name);
    return {
      name,
      inForm: !!formField,
      inCode: !!codeField,
      formRequired: formField?.required || false,
      formType: formField?.fieldType || '',
      formDefault: formField?.defaultValue ?? '',
      codeNote: codeField?.note || ''
    };
  });

  return { blockers, silentFailures, comparison, formFields, codeFields };
}

// ============================================================================
// REPORT
// ============================================================================

function md(d, formMeta) {
  const lines = [];
  const t = (s) => s.replace(/\|/g, '\\|');

  lines.push(`# HubSpot Form Schema Diff`);
  lines.push(``);
  lines.push(`**Form:** ${formMeta.name || '(unnamed)'}`);
  lines.push(`**Form GUID:** \`${FORM_GUID}\``);
  lines.push(`**Portal ID:** \`${PORTAL_ID}\``);
  lines.push(`**Form fields total:** ${d.formFields.length}`);
  lines.push(`**Required fields:** ${d.formFields.filter(f => f.required).length}`);
  lines.push(`**Code-side fields (buildFormFields output):** ${d.codeFields.length}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(``);

  // ─── Section 1: BLOCKERS ─────────────────────────────────────────────
  lines.push(`## 1. Required by form, NOT sent by code (BLOCKERS)`);
  lines.push(``);
  lines.push(`These are the fields HubSpot rejects the submission for. Each row needs either (a) a value sent by the code, (b) the field marked optional in HubSpot, or (c) a default value configured on the field.`);
  lines.push(``);
  if (d.blockers.length === 0) {
    lines.push(`*(none — every required field is being sent)*`);
  } else {
    lines.push(`| Field name (form-side) | Label | Type | Has default? | Default value |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const b of d.blockers) {
      const f = b.formField;
      lines.push(`| \`${t(f.name)}\` | ${t(f.label)} | ${f.fieldType} | ${b.hasDefault ? '✅' : '❌'} | ${t(String(f.defaultValue || ''))} |`);
    }
  }
  lines.push(``);

  // ─── Section 2: SILENT FAILURES ──────────────────────────────────────
  lines.push(`## 2. Sent by code but form has no matching field name (SILENT FAILURES)`);
  lines.push(``);
  lines.push(`HubSpot accepts unknown fields silently — these values are sent but never recorded. Each row is wasted bandwidth at best, or a typo we need to fix.`);
  lines.push(``);
  if (d.silentFailures.length === 0) {
    lines.push(`*(none — every code-side field name has a matching form field)*`);
  } else {
    lines.push(`| Code-side name (we send) | Possible form-side match | Code note |`);
    lines.push(`| --- | --- | --- |`);
    for (const s of d.silentFailures) {
      const match = s.possibleMatch ? `\`${t(s.possibleMatch)}\`` : '*(no obvious match)*';
      lines.push(`| \`${t(s.codeField.name)}\` | ${match} | ${t(s.codeField.note)} |`);
    }
  }
  lines.push(``);

  // ─── Section 3: COMPARISON TABLE ─────────────────────────────────────
  lines.push(`## 3. Field-by-field comparison`);
  lines.push(``);
  lines.push(`Union of all form-side and code-side field names. \`*\` in either column indicates absence.`);
  lines.push(``);
  lines.push(`| Field name | In form? | In code? | Form required? | Form type | Form default | Code note |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const c of d.comparison) {
    const inForm = c.inForm ? '✓' : '*';
    const inCode = c.inCode ? '✓' : '*';
    const flag = (c.inForm && c.inCode) ? '' : ' ⚠️';
    lines.push(`| \`${t(c.name)}\`${flag} | ${inForm} | ${inCode} | ${c.formRequired ? '⚠️ Yes' : '—'} | ${t(c.formType)} | ${t(String(c.formDefault || ''))} | ${t(c.codeNote)} |`);
  }
  lines.push(``);

  // ─── Section 4: ALL form fields (raw) ────────────────────────────────
  lines.push(`## 4. Raw form schema (every field HubSpot returned)`);
  lines.push(``);
  lines.push(`| Name | Label | Type | Required | Hidden | Default | Sample options (first 10) |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const f of d.formFields) {
    const opts = (f.options && f.options.length) ? f.options.join(', ') : '';
    lines.push(`| \`${t(f.name)}\` | ${t(f.label)} | ${f.fieldType} | ${f.required ? '⚠️' : ''} | ${f.hidden ? '🔒' : ''} | ${t(String(f.defaultValue || ''))} | ${t(opts)} |`);
  }
  lines.push(``);

  return lines.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================

(async function main() {
  try {
    const formDef = await fetchFormSchema();
    console.log(`✓ Fetched form schema (${formDef.name || 'unnamed'})`);

    const formFields = flattenFields(formDef);
    console.log(`✓ Parsed ${formFields.length} form fields`);

    if (formFields.length === 0) {
      console.error(`⚠️  Form returned 0 fields — dumping full response for inspection:`);
      console.error(JSON.stringify(formDef, null, 2).slice(0, 3000));
    }

    const result = diff(formFields, CODE_FIELDS);
    console.log(`✓ ${result.blockers.length} blocker(s), ${result.silentFailures.length} silent failure(s)`);

    const report = md(result, formDef);
    fs.writeFileSync(OUTPUT_PATH, report);
    console.log(`\n✅ Written to ${OUTPUT_PATH}`);

    // Also dump raw JSON for follow-up debugging
    const rawPath = OUTPUT_PATH.replace('.md', '.raw.json');
    fs.writeFileSync(rawPath, JSON.stringify({ formDef, formFields, codeFields: CODE_FIELDS, result }, null, 2));
    console.log(`📦 Raw dump: ${rawPath}`);

    // Quick console summary so the user sees the key result without opening the file
    console.log(`\n── BLOCKERS (${result.blockers.length}) ──`);
    for (const b of result.blockers) {
      console.log(`  ⚠️  ${b.formField.name}  (${b.formField.fieldType}${b.hasDefault ? `, default="${b.formField.defaultValue}"` : ', NO DEFAULT'})`);
    }
    console.log(`\n── SILENT FAILURES (${result.silentFailures.length}) ──`);
    for (const s of result.silentFailures) {
      const match = s.possibleMatch ? ` → maybe "${s.possibleMatch}"` : '';
      console.log(`  ⚠️  ${s.codeField.name}${match}`);
    }
  } catch (err) {
    console.error(`\n❌ Failed:`);
    if (err.response) {
      console.error(`  HTTP ${err.response.status}: ${err.response.statusText}`);
      console.error(`  ${JSON.stringify(err.response.data, null, 2).slice(0, 1500)}`);
    } else {
      console.error(`  ${err.message}`);
    }
    process.exit(1);
  }
})();

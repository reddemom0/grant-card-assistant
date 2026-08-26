/**
 * Dump HubSpot Deal Schema
 *
 * Fetches all deal properties and pipelines from the live HubSpot API,
 * writes a raw JSON dump and a human-readable summary.
 *
 * Read-only — both endpoints are GET. No writes.
 *
 * Usage: railway run node scripts/dump-hubspot-schema.js
 */

import axios from 'axios';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env (token may also come from Railway runtime injection)
dotenv.config({ path: join(__dirname, '..', '.env') });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!HUBSPOT_TOKEN) {
  console.error(`❌ HUBSPOT_ACCESS_TOKEN not set.

To fix:
  1. Log in to HubSpot → Settings → Integrations → Private Apps
  2. Open the "Hubspot-Anthropic-connection-for-AI-Hub" app
  3. Auth tab → "Show token" → copy
  4. Paste into .env as: HUBSPOT_ACCESS_TOKEN=pat-na1-...

Or run via Railway to inject it automatically:
  railway run node scripts/dump-hubspot-schema.js`);
  process.exit(1);
}

const client = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

const OUTPUT_DIR = join(__dirname, 'output');

// ============================================================================
// FETCH
// ============================================================================

async function fetchProperties() {
  const resp = await client.get('/crm/v3/properties/deals', {
    params: { archived: false },
  });
  return resp.data;
}

async function fetchPipelines() {
  const resp = await client.get('/crm/v3/pipelines/deals');
  return resp.data;
}

// ============================================================================
// SUMMARY GENERATION
// ============================================================================

function buildSummary(properties, pipelines, fetchedAt) {
  const props = properties.results || [];
  const pipes = pipelines.results || [];

  const customProps = props.filter(p => !p.hubspotDefined);
  const formProps = props.filter(p => p.formField);
  const enumProps = props.filter(p => p.type === 'enumeration');
  const totalStages = pipes.reduce((n, p) => n + (p.stages?.length || 0), 0);

  const lines = [];
  const push = (...args) => lines.push(...args);

  // Header
  push(`# HubSpot Deal Schema Summary`, '', `Fetched: ${fetchedAt}`, '');

  // Totals
  push('## Totals', '');
  push(`- Total deal properties: ${props.length}`);
  push(`- Custom properties (not hubspotDefined): ${customProps.length}`);
  push(`- Properties shown on forms (formField=true): ${formProps.length}`);
  push(`- Enum-type properties: ${enumProps.length}`);
  push(`- Total pipelines: ${pipes.length}`);
  push(`- Total stages across all pipelines: ${totalStages}`, '');

  // Pipelines and stages
  push('## Pipelines and stages', '');
  for (const pipe of pipes) {
    push(`### ${pipe.label} (ID: \`${pipe.id}\`)`, '');
    const stages = [...(pipe.stages || [])].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
    );
    for (const s of stages) {
      push(`- \`${s.label}\` → \`${s.id}\``);
    }
    push('');
  }

  // Enum properties
  push('## Enum properties (dropdowns)', '');
  const sortedEnums = [...enumProps].sort((a, b) =>
    (a.label || '').localeCompare(b.label || '')
  );
  for (const prop of sortedEnums) {
    push(`### ${prop.label} (\`${prop.name}\`)`, '');
    if (!prop.options || prop.options.length === 0) {
      push('_(no options defined)_', '');
      continue;
    }
    for (const opt of prop.options) {
      push(`- \`${opt.label}\` → \`${opt.value}\``);
    }
    push('');
  }

  // Required properties
  push('## Required-at-API-level properties', '');
  const requiredProps = props.filter(p => p.required === true);
  if (requiredProps.length === 0) {
    push(
      'HubSpot does not expose a `required` flag on deal properties via the properties API.',
      'Required fields are enforced at the form/pipeline level, not the property level.',
      'Check pipeline-specific required fields in HubSpot Settings → Deals → Pipelines → Edit stages.',
      ''
    );
  } else {
    for (const p of requiredProps) {
      push(`- **${p.label}** (\`${p.name}\`) — ${p.type}`);
    }
    push('');
  }

  // Specific field lookups
  push('## Fields we specifically need API names for', '');

  const searchTerms = [
    'Hourly Wage',
    'Hours per week',
    'Vacay',
    'Service Fee',
    'Training course name',
    'Quote',
    'Enrol in Claims Emails',
    'Enroll in Claims Emails',
    'Actual Reimbursement',
    'WorkBC Location',
    'Granted Starter - Claim Type',
    'Granted Starter',
    'Application - Granted Starter - Required Docs',
    'Discovery Call Complete',
    'Contract Status',
    'Service Start',
    'Closed lost reason',
    'Amount',
    'Grant Type',
    'Grant Reliant',
    'Candidate - Name, Job Title & Email',
    'Candidate',
    'Deal Type',
  ];

  for (const term of searchTerms) {
    const termLower = term.toLowerCase().replace(/\s+/g, ' ');
    const matches = props.filter(p => {
      const label = (p.label || '').toLowerCase().replace(/\s+/g, ' ');
      return label.includes(termLower);
    });
    if (matches.length === 0) {
      push(`- **${term}**: _not found_`);
    } else {
      for (const m of matches) {
        push(
          `- **${term}** → label: \`${m.label}\`, API name: \`${m.name}\`, type: \`${m.type}\`, fieldType: \`${m.fieldType}\``
        );
      }
    }
  }
  push('');

  // Notable observations
  push('## Notable observations', '');

  // Check for duplicate labels
  const labelCounts = {};
  for (const p of props) {
    const l = (p.label || '').toLowerCase();
    labelCounts[l] = (labelCounts[l] || 0) + 1;
  }
  const dupes = Object.entries(labelCounts).filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    push('**Duplicate labels** (same display name, different API names):');
    for (const [label, count] of dupes) {
      const matching = props.filter(
        p => (p.label || '').toLowerCase() === label
      );
      push(
        `- "${matching[0]?.label}" (×${count}): ${matching.map(m => `\`${m.name}\``).join(', ')}`
      );
    }
    push('');
  }

  // Check for properties with very large option lists
  const bigEnums = enumProps.filter(p => (p.options?.length || 0) > 30);
  if (bigEnums.length > 0) {
    push('**Large enum properties** (>30 options):');
    for (const p of bigEnums) {
      push(`- ${p.label} (\`${p.name}\`): ${p.options.length} options`);
    }
    push('');
  }

  return lines.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const fetchedAt = new Date().toISOString();

  console.log('Fetching deal properties and pipelines from HubSpot...\n');

  let properties, pipelines;
  try {
    [properties, pipelines] = await Promise.all([
      fetchProperties(),
      fetchPipelines(),
    ]);
  } catch (err) {
    const status = err.response?.status || 'unknown';
    const body = err.response?.data || err.message;
    console.error(`❌ HubSpot API request failed (HTTP ${status}):`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const propCount = properties.results?.length || 0;
  const pipeCount = pipelines.results?.length || 0;

  console.log(`Fetched ${propCount} properties and ${pipeCount} pipelines from HubSpot\n`);

  // Ensure output dir
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write raw JSON
  const rawPayload = { fetched_at: fetchedAt, properties, pipelines };
  const rawPath = join(OUTPUT_DIR, 'hubspot-schema-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(rawPayload, null, 2));
  const rawSize = (fs.statSync(rawPath).size / 1024).toFixed(1);
  console.log(`Wrote: ${rawPath} (${rawSize} KB)`);

  // Write summary
  const summary = buildSummary(properties, pipelines, fetchedAt);
  const summaryPath = join(OUTPUT_DIR, 'hubspot-schema-summary.md');
  fs.writeFileSync(summaryPath, summary);
  const summarySize = (fs.statSync(summaryPath).size / 1024).toFixed(1);
  console.log(`Wrote: ${summaryPath} (${summarySize} KB)`);

  console.log('\nDone. Review the summary file. Do not commit.');
}

main();

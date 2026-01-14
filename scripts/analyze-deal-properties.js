/**
 * Analyze Deal Properties for Oracle Search Capabilities
 * Categorize all 966 properties and determine which should be searchable
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = join(__dirname, 'hubspot-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const dealProps = schema.standardObjects.deals;

console.log('================================================================================');
console.log('📋 Deal Properties Analysis for Oracle');
console.log(`Total Properties: ${dealProps.length}`);
console.log('================================================================================\n');

// Categorize properties
const categories = {
  identification: [],
  team: [],
  dates: [],
  financial: [],
  status: [],
  grantSpecific: [],
  canexport: [],
  etg: [],
  bcafe: [],
  company: [],
  contacts: [],
  workflow: [],
  calculated: [],
  system: [],
  other: []
};

dealProps.forEach(prop => {
  const name = prop.name.toLowerCase();
  const label = prop.label.toLowerCase();

  // Skip hidden properties
  if (prop.hidden) return;

  // System/calculated properties
  if (prop.calculated || name.startsWith('hs_') && !name.includes('owner')) {
    categories.system.push(prop);
  }
  // Team members
  else if (name.includes('owner') || name.includes('writer') || name.includes('strategist') ||
           name.includes('claims_specialist') || name.includes('team')) {
    categories.team.push(prop);
  }
  // Dates
  else if (prop.type === 'date' || prop.type === 'datetime' || name.includes('date') || name.includes('_on')) {
    categories.dates.push(prop);
  }
  // Financial
  else if (name.includes('amount') || name.includes('funding') || name.includes('revenue') ||
           name.includes('price') || name.includes('fee') || name.includes('cost') ||
           name.includes('budget') || name.includes('claim')) {
    categories.financial.push(prop);
  }
  // Status/State
  else if (name.includes('status') || name.includes('state') || name.includes('stage') || name === 'dealstage') {
    categories.status.push(prop);
  }
  // CanExport specific
  else if (name.includes('canexport') || name.includes('claim_') || name.includes('target_market') ||
           name.includes('export')) {
    categories.canexport.push(prop);
  }
  // ETG specific
  else if (name.includes('etg') || name.includes('training') || name.includes('tuition') ||
           name.includes('candidate') || name.includes('third_party_payer')) {
    categories.etg.push(prop);
  }
  // BCAFE specific
  else if (name.includes('bcafe') || name.includes('agriculture') || name.includes('agri')) {
    categories.bcafe.push(prop);
  }
  // Grant program info
  else if (name.includes('grant') && !name.includes('grant_type')) {
    categories.grantSpecific.push(prop);
  }
  // Company info
  else if (name.includes('company')) {
    categories.company.push(prop);
  }
  // Contact info
  else if (name.includes('contact')) {
    categories.contacts.push(prop);
  }
  // Workflow/Pipeline
  else if (name.includes('pipeline') || name.includes('workflow')) {
    categories.workflow.push(prop);
  }
  // Identification
  else if (name === 'dealname' || name === 'grant_type' || name === 'deal_currency_code' ||
           prop.hasUniqueValue) {
    categories.identification.push(prop);
  }
  else {
    categories.other.push(prop);
  }
});

// Print categories with searchable recommendations
function printCategory(categoryName, props, searchable = true) {
  if (props.length === 0) return;

  console.log(`\n${searchable ? '🔍' : '📊'} ${categoryName.toUpperCase()} (${props.length} properties)`);
  console.log(searchable ? '   [RECOMMEND FOR SEARCH]' : '   [DISPLAY ONLY]');
  console.log('   ' + '─'.repeat(70));

  props.forEach(prop => {
    const unique = prop.hasUniqueValue ? ' [UNIQUE]' : '';
    const type = `(${prop.type})${unique}`;
    console.log(`   • ${prop.name}: ${prop.label} ${type}`);
  });
}

// Print searchable categories
console.log('\n═══════════════════════════════════════════════════════════════════════════════');
console.log('SEARCHABLE PROPERTIES - Oracle should be able to filter by these');
console.log('═══════════════════════════════════════════════════════════════════════════════');

printCategory('Identification', categories.identification, true);
printCategory('Team Members', categories.team, true);
printCategory('Dates & Timeline', categories.dates, true);
printCategory('Financial & Budget', categories.financial, true);
printCategory('Status & Stage', categories.status, true);
printCategory('Grant Program Info', categories.grantSpecific, true);
printCategory('CanExport Claims', categories.canexport, true);
printCategory('ETG Training', categories.etg, true);
printCategory('BCAFE Agriculture', categories.bcafe, true);
printCategory('Company Info', categories.company, true);
printCategory('Workflow & Pipeline', categories.workflow, true);

// Print display-only categories
console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
console.log('DISPLAY ONLY - Oracle sees these in results but cannot filter by them');
console.log('═══════════════════════════════════════════════════════════════════════════════');

printCategory('System & Calculated', categories.system, false);
printCategory('Contact References', categories.contacts, false);

// Summary
console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
console.log('📊 SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const searchableCount =
  categories.identification.length +
  categories.team.length +
  categories.dates.length +
  categories.financial.length +
  categories.status.length +
  categories.grantSpecific.length +
  categories.canexport.length +
  categories.etg.length +
  categories.bcafe.length +
  categories.company.length +
  categories.workflow.length;

const displayOnlyCount =
  categories.system.length +
  categories.contacts.length +
  categories.other.length;

console.log(`   Searchable Properties: ${searchableCount}`);
console.log(`   Display Only: ${displayOnlyCount}`);
console.log(`   Total Non-Hidden: ${searchableCount + displayOnlyCount}`);
console.log(`   Hidden/Excluded: ${dealProps.filter(p => p.hidden).length}`);

// Generate search tool parameters
console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
console.log('🔧 RECOMMENDED SEARCH TOOL PARAMETERS');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

function generateParam(props, description) {
  props.slice(0, 20).forEach(prop => {  // Show first 20 of each category
    const paramName = prop.name;
    let paramType = prop.type;

    if (prop.type === 'enumeration') {
      console.log(`   ${paramName}: {`);
      console.log(`     type: 'string',`);
      console.log(`     description: '${description}: ${prop.label}'`);
      console.log(`   },`);
    } else if (prop.type === 'date' || prop.type === 'datetime') {
      console.log(`   ${paramName}_after: {`);
      console.log(`     type: 'string',`);
      console.log(`     description: '${prop.label} after this date'`);
      console.log(`   },`);
      console.log(`   ${paramName}_before: {`);
      console.log(`     type: 'string',`);
      console.log(`     description: '${prop.label} before this date'`);
      console.log(`   },`);
    } else if (prop.type === 'number') {
      console.log(`   ${paramName}_min: {`);
      console.log(`     type: 'number',`);
      console.log(`     description: 'Minimum ${prop.label}'`);
      console.log(`   },`);
      console.log(`   ${paramName}_max: {`);
      console.log(`     type: 'number',`);
      console.log(`     description: 'Maximum ${prop.label}'`);
      console.log(`   },`);
    } else {
      console.log(`   ${paramName}: {`);
      console.log(`     type: '${paramType}',`);
      console.log(`     description: '${prop.label}'`);
      console.log(`   },`);
    }
  });

  if (props.length > 20) {
    console.log(`   ... and ${props.length - 20} more ${description} properties`);
  }
}

console.log('// Core filters (always include):');
generateParam(categories.identification.slice(0, 5), 'Identification');
generateParam(categories.team.slice(0, 5), 'Team member');
generateParam(categories.status.slice(0, 5), 'Status');

console.log('\n// Common date filters:');
const commonDates = categories.dates.filter(p =>
  ['closedate', 'createdate', 'approved_on', 'application_submitted_on'].includes(p.name)
);
generateParam(commonDates, 'Date');

console.log('\n// Financial filters:');
const commonFinancial = categories.financial.filter(p =>
  ['amount', 'client_reimbursement', 'claimed_so_far'].includes(p.name)
);
generateParam(commonFinancial, 'Financial');

console.log('\n================================================================================\n');

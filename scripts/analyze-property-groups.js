/**
 * Analyze Deal Property Groups
 * Group properties by their HubSpot groupName
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
console.log('📋 Deal Properties by HubSpot Property Groups');
console.log('================================================================================\n');

// Group properties by groupName
const groups = {};

dealProps.forEach(prop => {
  if (prop.hidden) return;
  if (prop.calculated) return;
  if (prop.name.startsWith('hs_') && !['hubspot_owner_id', 'hubspot_team_id', 'hs_all_collaborator_owner_ids'].includes(prop.name)) {
    return; // Skip most system properties
  }

  const groupName = prop.groupName || 'ungrouped';

  if (!groups[groupName]) {
    groups[groupName] = [];
  }

  groups[groupName].push(prop);
});

// Sort groups by size
const sortedGroups = Object.entries(groups)
  .sort(([, a], [, b]) => b.length - a.length);

console.log(`Total Property Groups: ${sortedGroups.length}\n`);

// Print each group
sortedGroups.forEach(([groupName, props]) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📦 ${groupName.toUpperCase()}`);
  console.log(`   Properties: ${props.length}`);
  console.log('='.repeat(80));

  // Categorize within group
  const byType = {
    string: [],
    number: [],
    date: [],
    datetime: [],
    enumeration: [],
    bool: [],
    other: []
  };

  props.forEach(prop => {
    const type = prop.type || 'other';
    if (!byType[type]) byType[type] = [];
    byType[type].push(prop);
  });

  // Print by type
  Object.entries(byType).forEach(([type, typeProps]) => {
    if (typeProps.length === 0) return;

    console.log(`\n   ${type.toUpperCase()} (${typeProps.length}):`);
    typeProps.forEach(prop => {
      const unique = prop.hasUniqueValue ? ' [UNIQUE]' : '';
      console.log(`      • ${prop.name}: ${prop.label}${unique}`);
    });
  });
});

// Summary of key groups
console.log('\n\n' + '='.repeat(80));
console.log('📊 SUMMARY - Key Property Groups');
console.log('='.repeat(80) + '\n');

const keyGroups = [
  'dealinformation',
  'deal_information',
  'deal_activity',
  'dealactivity',
  'deal_revenue',
  'dealrevenue'
];

sortedGroups.forEach(([groupName, props]) => {
  const normalized = groupName.toLowerCase().replace(/[_\s-]/g, '');
  const isKey = keyGroups.some(k => normalized.includes(k.replace('_', '')));

  if (isKey) {
    console.log(`✅ ${groupName}: ${props.length} properties`);
    console.log(`   Types: ${Object.entries({
      string: props.filter(p => p.type === 'string').length,
      number: props.filter(p => p.type === 'number').length,
      date: props.filter(p => p.type === 'date' || p.type === 'datetime').length,
      enum: props.filter(p => p.type === 'enumeration').length,
      bool: props.filter(p => p.type === 'bool').length
    }).filter(([, count]) => count > 0).map(([type, count]) => `${type}:${count}`).join(', ')}`);
  }
});

console.log('\n');

/**
 * Get Grants custom object properties
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

const headers = {
  'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

async function hubspotGet(endpoint) {
  const url = `https://api.hubapi.com${endpoint}`;
  console.log(`📡 Fetching: ${endpoint}`);

  const response = await fetch(url, { headers });
  console.log(`   Response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const text = await response.text();
    console.log(`   Error: ${text}`);
    return null;
  }

  return await response.json();
}

console.log('🔷 Fetching Grants Custom Object Details\n');

// Get the schema first
const schema = await hubspotGet('/crm/v3/schemas/p21088260_grants');
if (schema) {
  console.log('\n✅ Grants Schema:');
  console.log(`   ID: ${schema.objectTypeId}`);
  console.log(`   Name: ${schema.name}`);
  console.log(`   Full Name: ${schema.fullyQualifiedName}`);
  console.log(`   Primary Display: ${schema.primaryDisplayProperty}`);
  console.log(`   Secondary Display: ${schema.secondaryDisplayProperties?.join(', ')}`);
  console.log(`   Required: ${schema.requiredProperties?.join(', ')}`);
  console.log(`   Searchable: ${schema.searchableProperties?.join(', ')}`);
}

// Get properties using the object type ID
const objectTypeId = '2-12529760';
console.log(`\n📋 Fetching properties for objectTypeId: ${objectTypeId}`);
const props = await hubspotGet(`/crm/v3/properties/${objectTypeId}`);

if (props && props.results) {
  console.log(`\n✅ Found ${props.results.length} properties:\n`);
  props.results.forEach(prop => {
    console.log(`   - ${prop.name}: ${prop.label} (${prop.type})`);
    if (prop.hasUniqueValue) console.log(`     [UNIQUE IDENTIFIER]`);
  });
} else {
  console.log('\n❌ No properties found');
}

// Try searching for some grants
console.log('\n\n🔍 Testing search for Grants records...');
const searchResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectTypeId}/search`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ limit: 5 })
});

if (searchResponse.ok) {
  const searchData = await searchResponse.json();
  console.log(`✅ Found ${searchData.total} total Grants records`);
  if (searchData.results && searchData.results.length > 0) {
    console.log(`\nSample records:`);
    searchData.results.forEach(record => {
      console.log(`\n   Record ID: ${record.id}`);
      console.log(`   Properties:`);
      Object.entries(record.properties || {}).forEach(([key, value]) => {
        if (value) console.log(`      ${key}: ${value}`);
      });
    });
  }
} else {
  console.log(`❌ Search failed: ${searchResponse.status}`);
}

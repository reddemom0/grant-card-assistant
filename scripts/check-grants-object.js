/**
 * Check if Grants custom object exists
 * Try multiple ways to detect it
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
    console.log(`   Error body: ${text}`);
    return null;
  }

  return await response.json();
}

console.log('🔍 Checking for Grants custom object...\n');

// Try 1: Get all schemas
console.log('Method 1: GET /crm/v3/schemas');
const schemas = await hubspotGet('/crm/v3/schemas');
if (schemas) {
  console.log(`   Found ${schemas.results?.length || 0} schemas`);
  if (schemas.results) {
    schemas.results.forEach(s => {
      console.log(`   - ${s.name} (${s.labels?.singular})`);
    });
  }
}

// Try 2: Search for "grants" object directly
console.log('\nMethod 2: GET /crm/v3/schemas/grants');
const grantsSchema = await hubspotGet('/crm/v3/schemas/grants');
if (grantsSchema) {
  console.log('   ✅ Found Grants schema!');
  console.log(JSON.stringify(grantsSchema, null, 2));
}

// Try 3: Check if we can search grants objects
console.log('\nMethod 3: POST /crm/v3/objects/grants/search');
const searchResponse = await fetch('https://api.hubapi.com/crm/v3/objects/grants/search', {
  method: 'POST',
  headers,
  body: JSON.stringify({ limit: 1 })
});

console.log(`   Response: ${searchResponse.status} ${searchResponse.statusText}`);
if (searchResponse.ok) {
  const searchData = await searchResponse.json();
  console.log(`   ✅ Grants object exists! Found ${searchData.total} records`);
} else {
  const errorText = await searchResponse.text();
  console.log(`   Error: ${errorText}`);
}

// Try 4: List all available objects by trying common names
console.log('\nMethod 4: Trying common custom object patterns...');
const possibleNames = ['grants', 'grant', 'p21088260_grants', 'p21088260_grant'];

for (const name of possibleNames) {
  const result = await hubspotGet(`/crm/v3/schemas/${name}`);
  if (result) {
    console.log(`   ✅ Found: ${name}`);
    console.log(`      Full name: ${result.fullyQualifiedName}`);
    console.log(`      Object ID: ${result.objectTypeId}`);
    break;
  }
}

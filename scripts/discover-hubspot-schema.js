/**
 * HubSpot Schema Discovery Script
 *
 * Retrieves the complete data model from HubSpot:
 * - Custom objects
 * - Properties for standard objects (contacts, companies, deals, tickets)
 * - Deal pipelines and stages
 * - Association types
 *
 * Usage: node scripts/discover-hubspot-schema.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!HUBSPOT_TOKEN) {
  console.error('❌ HUBSPOT_ACCESS_TOKEN not found in environment variables');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
  'Content-Type': 'application/json'
};

/**
 * Make GET request to HubSpot API
 */
async function hubspotGet(endpoint) {
  const url = `https://api.hubapi.com${endpoint}`;
  console.log(`📡 Fetching: ${endpoint}`);

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Get all custom objects
 */
async function getCustomObjects() {
  console.log('\n🔷 Retrieving custom objects...');

  try {
    const data = await hubspotGet('/crm/v3/schemas');

    if (!data.results || data.results.length === 0) {
      console.log('   ℹ️  No custom objects found');
      return [];
    }

    console.log(`   ✅ Found ${data.results.length} custom objects`);

    return data.results.map(obj => ({
      id: obj.id,
      name: obj.name,
      fullyQualifiedName: obj.fullyQualifiedName,
      labels: obj.labels,
      primaryDisplayProperty: obj.primaryDisplayProperty,
      secondaryDisplayProperties: obj.secondaryDisplayProperties,
      requiredProperties: obj.requiredProperties,
      searchableProperties: obj.searchableProperties,
      associatedObjects: obj.associations?.map(a => a.toObjectTypeId) || []
    }));
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return [];
  }
}

/**
 * Get properties for an object
 */
async function getObjectProperties(objectType, objectName) {
  console.log(`\n📋 Retrieving properties for ${objectName}...`);

  try {
    const data = await hubspotGet(`/crm/v3/properties/${objectType}`);

    if (!data.results || data.results.length === 0) {
      console.log(`   ℹ️  No properties found`);
      return [];
    }

    console.log(`   ✅ Found ${data.results.length} properties`);

    return data.results.map(prop => ({
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: prop.groupName,
      hasUniqueValue: prop.hasUniqueValue || false,
      hidden: prop.hidden || false,
      calculated: prop.calculated || false,
      options: prop.options || null
    }));
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return [];
  }
}

/**
 * Get deal pipelines and stages
 */
async function getDealPipelines() {
  console.log('\n🔄 Retrieving deal pipelines...');

  try {
    const data = await hubspotGet('/crm/v3/pipelines/deals');

    if (!data.results || data.results.length === 0) {
      console.log('   ℹ️  No pipelines found');
      return [];
    }

    console.log(`   ✅ Found ${data.results.length} pipelines`);

    return data.results.map(pipeline => ({
      id: pipeline.id,
      label: pipeline.label,
      displayOrder: pipeline.displayOrder,
      stages: pipeline.stages.map(stage => ({
        id: stage.id,
        label: stage.label,
        displayOrder: stage.displayOrder,
        metadata: stage.metadata
      }))
    }));
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return [];
  }
}

/**
 * Get association definitions between two object types
 */
async function getAssociationTypes(fromObject, toObject) {
  try {
    const data = await hubspotGet(`/crm/v4/associations/${fromObject}/${toObject}/labels`);
    return data.results || [];
  } catch (error) {
    // Silent fail - not all associations may exist
    return [];
  }
}

/**
 * Get all association types for standard objects
 */
async function getAllAssociations() {
  console.log('\n🔗 Retrieving association types...');

  const standardObjects = ['contacts', 'companies', 'deals', 'tickets'];
  const associations = {};

  for (const fromObj of standardObjects) {
    associations[fromObj] = {};

    for (const toObj of standardObjects) {
      if (fromObj !== toObj) {
        const types = await getAssociationTypes(fromObj, toObj);
        if (types.length > 0) {
          associations[fromObj][toObj] = types.map(t => ({
            id: t.typeId,
            label: t.label,
            category: t.category
          }));
        }
      }
    }
  }

  console.log('   ✅ Association types retrieved');
  return associations;
}

/**
 * Main execution
 */
async function main() {
  console.log('================================================================================');
  console.log('🔍 HubSpot Schema Discovery');
  console.log('================================================================================');

  const schema = {
    discoveredAt: new Date().toISOString(),
    customObjects: [],
    standardObjects: {},
    dealPipelines: [],
    associations: {}
  };

  // Get custom objects
  schema.customObjects = await getCustomObjects();

  // Get properties for standard objects
  const standardObjects = [
    { type: 'contacts', name: 'Contacts' },
    { type: 'companies', name: 'Companies' },
    { type: 'deals', name: 'Deals' },
    { type: 'tickets', name: 'Tickets' }
  ];

  for (const obj of standardObjects) {
    schema.standardObjects[obj.type] = await getObjectProperties(obj.type, obj.name);
  }

  // Get properties for custom objects
  for (const customObj of schema.customObjects) {
    console.log(`\n📋 Retrieving properties for custom object: ${customObj.name}...`);
    customObj.properties = await getObjectProperties(customObj.id, customObj.name);
  }

  // Get deal pipelines
  schema.dealPipelines = await getDealPipelines();

  // Get associations
  schema.associations = await getAllAssociations();

  // Save to file
  const outputPath = join(__dirname, 'hubspot-schema.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));

  console.log('\n================================================================================');
  console.log('✅ Schema discovery complete!');
  console.log(`📄 Results saved to: ${outputPath}`);
  console.log('================================================================================');

  // Print summary
  console.log('\n📊 Summary:');
  console.log(`   Custom Objects: ${schema.customObjects.length}`);
  console.log(`   Contact Properties: ${schema.standardObjects.contacts.length}`);
  console.log(`   Company Properties: ${schema.standardObjects.companies.length}`);
  console.log(`   Deal Properties: ${schema.standardObjects.deals.length}`);
  console.log(`   Ticket Properties: ${schema.standardObjects.tickets.length}`);
  console.log(`   Deal Pipelines: ${schema.dealPipelines.length}`);

  if (schema.customObjects.length > 0) {
    console.log('\n🔷 Custom Objects Found:');
    schema.customObjects.forEach(obj => {
      console.log(`   - ${obj.labels.singular} (${obj.name})`);
      console.log(`     Properties: ${obj.properties?.length || 0}`);
      console.log(`     Associated with: ${obj.associatedObjects.join(', ') || 'none'}`);
    });
  }

  if (schema.dealPipelines.length > 0) {
    console.log('\n🔄 Deal Pipelines:');
    schema.dealPipelines.forEach(pipeline => {
      console.log(`   - ${pipeline.label} (${pipeline.id})`);
      console.log(`     Stages: ${pipeline.stages.map(s => s.label).join(' → ')}`);
    });
  }
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

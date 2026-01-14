/**
 * Summarize HubSpot Schema
 * Extract key properties that Oracle needs to know about
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = join(__dirname, 'hubspot-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

console.log('================================================================================');
console.log('📋 HubSpot Schema Summary - Key Properties for Oracle');
console.log('================================================================================\n');

// Deal Properties - Focus on grant-specific fields
console.log('🎯 DEAL PROPERTIES (Grant Applications)\n');
console.log('Grant Program & Status:');
const dealProps = schema.standardObjects.deals;

const grantFields = [
  'grant_type', 'dealstage', 'pipeline', 'dealname', 'amount',
  'client_reimbursement', 'approved_on', 'application_submitted_on',
  'hubspot_owner_id', 'state', 'closedate', 'createdate',
  // CanExport fields
  'claim_1', 'claim_2', 'claim_3', 'claim_4', 'claimed_so_far',
  // ETG fields
  'tuition_fee', 'training_hours', 'candidate_info', 'third_party_payer',
  // Team fields
  'writer', 'strategist', 'claims_specialist',
  // Other
  'company_name', 'deal_currency_code'
];

grantFields.forEach(fieldName => {
  const prop = dealProps.find(p => p.name === fieldName);
  if (prop) {
    console.log(`  ✓ ${prop.name}: ${prop.label} (${prop.type})`);
    if (prop.options && prop.options.length > 0 && prop.options.length < 50) {
      console.log(`    Options: ${prop.options.map(o => o.value).join(', ')}`);
    }
  }
});

// Contact Properties
console.log('\n\n👤 CONTACT PROPERTIES\n');
console.log('Key Fields:');
const contactProps = schema.standardObjects.contacts;

const keyContactFields = [
  'email', 'firstname', 'lastname', 'phone', 'jobtitle', 'company',
  'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id',
  'createdate', 'lastmodifieddate', 'hs_additional_emails'
];

keyContactFields.forEach(fieldName => {
  const prop = contactProps.find(p => p.name === fieldName);
  if (prop) {
    console.log(`  ✓ ${prop.name}: ${prop.label} (${prop.type})`);
  }
});

// Company Properties
console.log('\n\n🏢 COMPANY PROPERTIES\n');
console.log('Key Fields:');
const companyProps = schema.standardObjects.companies;

const keyCompanyFields = [
  'name', 'domain', 'industry', 'numberofemployees', 'annualrevenue',
  'city', 'state', 'country', 'phone', 'website',
  'lifecyclestage', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate'
];

keyCompanyFields.forEach(fieldName => {
  const prop = companyProps.find(p => p.name === fieldName);
  if (prop) {
    console.log(`  ✓ ${prop.name}: ${prop.label} (${prop.type})`);
  }
});

// Deal Pipelines Summary
console.log('\n\n🔄 DEAL PIPELINES\n');
schema.dealPipelines.forEach(pipeline => {
  console.log(`📊 ${pipeline.label} (ID: ${pipeline.id})`);
  console.log(`   Stages (${pipeline.stages.length}):`);
  pipeline.stages.forEach(stage => {
    console.log(`   - ${stage.label} (${stage.id})`);
  });
  console.log('');
});

// Check for grant-type property details
console.log('\n🎯 GRANT_TYPE PROPERTY DETAILS\n');
const grantTypeProp = dealProps.find(p => p.name === 'grant_type');
if (grantTypeProp && grantTypeProp.options) {
  console.log(`Found ${grantTypeProp.options.length} grant types:`);
  grantTypeProp.options.slice(0, 50).forEach(opt => {
    console.log(`  - ${opt.value}: ${opt.label}`);
  });
  if (grantTypeProp.options.length > 50) {
    console.log(`  ... and ${grantTypeProp.options.length - 50} more`);
  }
}

// Unique identifier properties
console.log('\n\n🔑 UNIQUE IDENTIFIER PROPERTIES\n');
console.log('Contacts:');
contactProps.filter(p => p.hasUniqueValue).forEach(prop => {
  console.log(`  ✓ ${prop.name}: ${prop.label}`);
});

console.log('\nCompanies:');
companyProps.filter(p => p.hasUniqueValue).forEach(prop => {
  console.log(`  ✓ ${prop.name}: ${prop.label}`);
});

console.log('\nDeals:');
dealProps.filter(p => p.hasUniqueValue).forEach(prop => {
  console.log(`  ✓ ${prop.name}: ${prop.label}`);
});

console.log('\n================================================================================');

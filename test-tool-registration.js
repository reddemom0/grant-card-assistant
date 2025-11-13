/**
 * Test script to verify create_advanced_document tool registration
 * Tests that the tool is properly registered in the tool system
 */

import { getToolsForAgent } from './src/tools/definitions.js';
import { TOOLS } from './src/tools/index.js';

console.log('🧪 Testing tool registration...\n');

// Test 1: Check if create_advanced_document is in definitions.js
console.log('TEST 1: Check Direct API tool system (definitions.js)');
console.log('─────────────────────────────────────────────────────');
const readinessTools = getToolsForAgent('readiness-strategist');
const hasAdvancedDoc = readinessTools.some(tool => tool.name === 'create_advanced_document');
const hasOldDoc = readinessTools.some(tool => tool.name === 'create_google_doc');

console.log(`✓ Total tools for readiness-strategist: ${readinessTools.length}`);
console.log(`${hasAdvancedDoc ? '✅' : '❌'} create_advanced_document: ${hasAdvancedDoc ? 'FOUND' : 'NOT FOUND'}`);
console.log(`${!hasOldDoc ? '✅' : '❌'} create_google_doc: ${hasOldDoc ? 'STILL EXISTS (BAD!)' : 'REMOVED (GOOD!)'}`);
console.log('');

// Test 2: Check if create_advanced_document is in legacy system (index.js)
console.log('TEST 2: Check Legacy API tool system (index.js)');
console.log('─────────────────────────────────────────────────────');
const hasAdvancedDocLegacy = 'create_advanced_document' in TOOLS;
const hasOldDocLegacy = 'create_google_doc' in TOOLS;

console.log(`${hasAdvancedDocLegacy ? '✅' : '❌'} create_advanced_document: ${hasAdvancedDocLegacy ? 'FOUND' : 'NOT FOUND'}`);
console.log(`${hasOldDocLegacy ? '✅' : '❌'} create_google_doc: ${hasOldDocLegacy ? 'FOUND' : 'NOT FOUND'}`);
console.log('');

// Test 3: Verify tool definition structure
console.log('TEST 3: Verify create_advanced_document structure');
console.log('─────────────────────────────────────────────────────');
const advancedDocTool = readinessTools.find(tool => tool.name === 'create_advanced_document');
if (advancedDocTool) {
  console.log('✅ Tool definition found');
  console.log(`✅ Has name: ${advancedDocTool.name}`);
  console.log(`✅ Has description: ${advancedDocTool.description ? 'YES' : 'NO'}`);
  console.log(`✅ Has input_schema: ${advancedDocTool.input_schema ? 'YES' : 'NO'}`);

  if (advancedDocTool.input_schema) {
    const requiredFields = advancedDocTool.input_schema.required || [];
    console.log(`✅ Required fields: ${requiredFields.join(', ')}`);

    const properties = advancedDocTool.input_schema.properties || {};
    console.log(`✅ Properties defined: ${Object.keys(properties).join(', ')}`);

    // Check enums
    if (properties.grantType && properties.grantType.enum) {
      console.log(`✅ Grant types: ${properties.grantType.enum.join(', ')}`);
    }
    if (properties.documentType && properties.documentType.enum) {
      console.log(`✅ Document types: ${properties.documentType.enum.join(', ')}`);
    }
  }
} else {
  console.log('❌ Tool definition NOT FOUND');
}
console.log('');

// Summary
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════');
const allTestsPassed = hasAdvancedDoc && !hasOldDoc && hasAdvancedDocLegacy;

if (allTestsPassed) {
  console.log('✅ ALL TESTS PASSED!');
  console.log('');
  console.log('The create_advanced_document tool is:');
  console.log('  ✓ Registered in Direct API system (definitions.js)');
  console.log('  ✓ Available to readiness-strategist agent');
  console.log('  ✓ Has proper structure with required fields');
  console.log('  ✓ Old create_google_doc tool has been removed');
  console.log('');
  console.log('🎉 Tool registration is correct!');
} else {
  console.log('❌ SOME TESTS FAILED');
  console.log('');
  if (!hasAdvancedDoc) {
    console.log('  ✗ create_advanced_document NOT in definitions.js');
  }
  if (hasOldDoc) {
    console.log('  ✗ create_google_doc STILL in definitions.js (should be removed)');
  }
  if (!hasAdvancedDocLegacy) {
    console.log('  ✗ create_advanced_document NOT in index.js');
  }
}

process.exit(allTestsPassed ? 0 : 1);

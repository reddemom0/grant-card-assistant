/**
 * Simple test for tool definitions (no dependencies)
 */

import { getToolsForAgent, GOOGLE_DOCS_TOOLS } from './src/tools/definitions.js';

console.log('🧪 Testing tool definitions...\n');

// Test: Check if create_advanced_document is in GOOGLE_DOCS_TOOLS
console.log('TEST: GOOGLE_DOCS_TOOLS array');
console.log('─────────────────────────────────────────────────────');
const googleDocsTools = GOOGLE_DOCS_TOOLS;
console.log(`Total Google Docs tools: ${googleDocsTools.length}`);

const toolNames = googleDocsTools.map(t => t.name);
console.log(`Tools: ${toolNames.join(', ')}`);
console.log('');

const hasAdvancedDoc = toolNames.includes('create_advanced_document');
const hasOldDoc = toolNames.includes('create_google_doc');

console.log(`${hasAdvancedDoc ? '✅' : '❌'} create_advanced_document: ${hasAdvancedDoc ? 'FOUND' : 'NOT FOUND'}`);
console.log(`${!hasOldDoc ? '✅' : '❌'} create_google_doc: ${hasOldDoc ? 'STILL EXISTS (BAD!)' : 'REMOVED (GOOD!)'}`);
console.log('');

// Test: Check readiness-strategist tools
console.log('TEST: Tools for readiness-strategist');
console.log('─────────────────────────────────────────────────────');
const readinessTools = getToolsForAgent('readiness-strategist');
const readinessToolNames = readinessTools.map(t => t.name);

console.log(`Total tools: ${readinessTools.length}`);
console.log('');

const hasAdvancedDocForAgent = readinessToolNames.includes('create_advanced_document');
const hasOldDocForAgent = readinessToolNames.includes('create_google_doc');

console.log(`${hasAdvancedDocForAgent ? '✅' : '❌'} create_advanced_document available: ${hasAdvancedDocForAgent ? 'YES' : 'NO'}`);
console.log(`${!hasOldDocForAgent ? '✅' : '❌'} create_google_doc removed: ${!hasOldDocForAgent ? 'YES' : 'NO'}`);
console.log('');

// Tool structure verification
if (hasAdvancedDocForAgent) {
  console.log('TEST: create_advanced_document structure');
  console.log('─────────────────────────────────────────────────────');
  const tool = readinessTools.find(t => t.name === 'create_advanced_document');

  console.log(`✅ Name: ${tool.name}`);
  console.log(`✅ Description: ${tool.description.substring(0, 80)}...`);
  console.log(`✅ Required fields: ${tool.input_schema.required.join(', ')}`);
  console.log(`✅ Grant types: ${tool.input_schema.properties.grantType.enum.join(', ')}`);
  console.log(`✅ Document types: ${tool.input_schema.properties.documentType.enum.join(', ')}`);
  console.log('');
}

// Summary
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════');
const passed = hasAdvancedDoc && !hasOldDoc && hasAdvancedDocForAgent && !hasOldDocForAgent;

if (passed) {
  console.log('✅ ALL TESTS PASSED!');
  console.log('');
  console.log('✓ create_advanced_document is in GOOGLE_DOCS_TOOLS');
  console.log('✓ create_advanced_document is available to readiness-strategist');
  console.log('✓ create_google_doc has been removed');
  console.log('');
  console.log('🎉 Tool registration is correct!');
} else {
  console.log('❌ TESTS FAILED');
  if (!hasAdvancedDoc) console.log('  ✗ create_advanced_document NOT in GOOGLE_DOCS_TOOLS');
  if (hasOldDoc) console.log('  ✗ create_google_doc STILL in GOOGLE_DOCS_TOOLS');
  if (!hasAdvancedDocForAgent) console.log('  ✗ create_advanced_document NOT available to agent');
  if (hasOldDocForAgent) console.log('  ✗ create_google_doc STILL available to agent');
}

process.exit(passed ? 0 : 1);

/**
 * Test script for create_advanced_document tool
 * Tests the new Google Docs API v1 template-based document creation
 */

import { createAdvancedDocumentTool } from './src/tools/google-docs-advanced.js';

async function testCreateAdvancedDocument() {
  console.log('🧪 Testing create_advanced_document tool...\n');

  // Test parameters
  const input = {
    title: 'TEST - CanExport Readiness Assessment',
    grantType: 'market-expansion',
    documentType: 'readiness-assessment',
    data: {
      client_name: 'Test Company Inc.',
      program_name: 'CanExport SMEs',
      date: new Date().toLocaleDateString()
    },
    // Optional: add parentFolderId if you want to test folder placement
    // parentFolderId: 'YOUR_FOLDER_ID'
  };

  const context = {
    userId: 1, // User ID from your system
    conversationId: 'test-conversation-123',
    agentType: 'readiness-strategist'
  };

  console.log('📋 Test Parameters:');
  console.log(`   Title: ${input.title}`);
  console.log(`   Grant Type: ${input.grantType}`);
  console.log(`   Document Type: ${input.documentType}`);
  console.log(`   User ID: ${context.userId}`);
  console.log('');

  try {
    console.log('🚀 Creating document...\n');
    const result = await createAdvancedDocumentTool(input, context);

    if (result.success) {
      console.log('✅ SUCCESS!\n');
      console.log('📄 Document Details:');
      console.log(`   Document ID: ${result.documentId}`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Message: ${result.message}`);
      console.log('');
      console.log('🎉 Test passed! The tool is working correctly.');
      console.log('');
      console.log('🔗 Open the document here:');
      console.log(`   ${result.url}`);
    } else {
      console.log('❌ FAILED!\n');
      console.log('Error:', result.error);
      if (result.stack) {
        console.log('\nStack trace:');
        console.log(result.stack);
      }
    }
  } catch (error) {
    console.error('❌ EXCEPTION!\n');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
  }
}

// Run the test
testCreateAdvancedDocument().then(() => {
  console.log('\n✓ Test complete');
  process.exit(0);
}).catch(error => {
  console.error('\n✗ Test failed with exception:', error);
  process.exit(1);
});

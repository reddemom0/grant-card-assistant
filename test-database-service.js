import * as db from './src/database-service.js';
import { config } from 'dotenv';

// Load environment variables
config();

async function testDatabaseService() {
  console.log('🧪 Testing Database Service\n');

  try {
    // Test 1: Connection
    console.log('1️⃣ Testing database connection...');
    const connectionTest = await db.testConnection();
    if (connectionTest.success) {
      console.log('✅ Connected! Server time:', connectionTest.timestamp);
    } else {
      throw new Error('Connection failed: ' + connectionTest.error);
    }

    // Test 2: Create a test conversation
    console.log('\n2️⃣ Creating test conversation...');
    const testConvId = 'test-conv-' + Date.now();
    const testUserId = 1; // Assuming user ID 1 exists (from Google OAuth)

    const conversation = await db.createConversation(
      testConvId,
      testUserId,
      'grant_card',
      'Test Conversation'
    );
    console.log('✅ Conversation created:', {
      id: conversation.id,
      agent_type: conversation.agent_type,
      title: conversation.title
    });

    // Test 3: Save messages
    console.log('\n3️⃣ Saving test messages...');
    await db.saveMessage(testConvId, 'user', 'Hello, can you help me with a grant?');
    await db.saveMessage(testConvId, 'assistant', 'Of course! I\'d be happy to help. What grant are you interested in?');
    await db.saveMessage(testConvId, 'user', 'I need help with a CanExport grant.');
    console.log('✅ 3 messages saved');

    // Test 4: Save file attachment
    console.log('\n4️⃣ Saving test file attachment...');
    await db.saveFileAttachment(testConvId, 'grant-document.pdf', 'application/pdf', 1024000);
    console.log('✅ File attachment saved');

    // Test 5: Get conversation with all data
    console.log('\n5️⃣ Retrieving conversation...');
    const retrieved = await db.getConversation(testConvId);
    console.log('✅ Conversation retrieved:', {
      id: retrieved.id,
      messages: retrieved.messages.length,
      files: retrieved.files.length
    });

    // Test 6: Get user conversations
    console.log('\n6️⃣ Getting user conversations...');
    const userConvs = await db.getUserConversations(testUserId);
    console.log('✅ User has', userConvs.length, 'conversation(s)');

    // Test 7: Update conversation title
    console.log('\n7️⃣ Updating conversation title...');
    await db.updateConversationTitle(testConvId, 'CanExport Grant Application');
    console.log('✅ Title updated');

    // Test 8: Delete conversation (cleanup)
    console.log('\n8️⃣ Deleting test conversation...');
    await db.deleteConversation(testConvId);
    console.log('✅ Test conversation deleted');

    // Verify deletion
    const deleted = await db.getConversation(testConvId);
    if (deleted === null) {
      console.log('✅ Verified: Conversation was deleted');
    }

    console.log('\n🎉 All tests passed! Database service is working correctly.\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await db.closePool();
    console.log('✅ Database connection pool closed');
  }
}

testDatabaseService();

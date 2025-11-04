/**
 * Conversation API Integration Tests
 *
 * Tests the full API endpoints for conversation management:
 * - POST /api/chat (conversation creation and messaging)
 * - GET /api/conversations/:id (load conversation with messages)
 * - GET /api/conversations (list user conversations)
 * - DELETE /api/conversations/:id (delete conversation)
 */

import fetch from 'node-fetch';
import { jest } from '@jest/globals';

// Test configuration
const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000';
const TEST_TIMEOUT = 60000;

// Helper to create mock auth cookie
function createTestAuthCookie() {
  // In real tests, this would be obtained from the auth endpoint
  // For now, we'll use the session cookie from environment or skip if not available
  return process.env.TEST_AUTH_COOKIE || null;
}

describe('Conversation API Integration', () => {
  let authCookie;
  let testConversationId;

  beforeAll(() => {
    authCookie = createTestAuthCookie();

    if (!authCookie) {
      console.warn('⚠️  No TEST_AUTH_COOKIE found - API tests will be skipped');
      console.warn('   To run these tests, set TEST_AUTH_COOKIE environment variable');
    }
  });

  describe('POST /api/chat - Create Conversation', () => {
    test('should create new conversation on first message', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'etg-writer',
          message: 'Test message for conversation creation',
          conversationId: null // No conversation ID = new conversation
        })
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      // Read SSE stream to get conversationId
      const text = await response.text();
      const lines = text.split('\n');

      // Look for connected event with conversationId
      const connectedEvent = lines.find(line => line.includes('"type":"connected"'));
      if (connectedEvent) {
        const data = JSON.parse(connectedEvent.replace('data: ', ''));
        expect(data.conversationId).toBeDefined();
        testConversationId = data.conversationId;
        console.log('✓ Created conversation:', testConversationId);
      }
    }, TEST_TIMEOUT);

    test('should reject request without agentType', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          message: 'Test message'
          // Missing agentType
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('agentType');
    }, TEST_TIMEOUT);

    test('should reject request without message', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'etg-writer'
          // Missing message
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('message');
    }, TEST_TIMEOUT);

    test('should reject invalid agent type', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'invalid-agent-type',
          message: 'Test message'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid agent type');
    }, TEST_TIMEOUT);
  });

  describe('GET /api/conversations/:id - Load Conversation', () => {
    test('should load conversation with messages', async () => {
      if (!authCookie || !testConversationId) {
        console.log('⚠️  Skipping test - no auth cookie or conversation ID');
        return;
      }

      const response = await fetch(`${API_BASE}/api/conversations/${testConversationId}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(response.ok).toBe(true);

      const data = await response.json();

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('agent_type');
      expect(data).toHaveProperty('messages');
      expect(data).toHaveProperty('messageCount');
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messageCount).toBeGreaterThan(0);

      // Check message structure
      data.messages.forEach(msg => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(['user', 'assistant']).toContain(msg.role);
      });

      console.log(`✓ Loaded conversation with ${data.messageCount} messages`);
    }, TEST_TIMEOUT);

    test('should return 404 for non-existent conversation', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const response = await fetch(`${API_BASE}/api/conversations/${fakeId}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(response.status).toBe(404);
    }, TEST_TIMEOUT);

    test('should require authentication', async () => {
      const response = await fetch(`${API_BASE}/api/conversations/${testConversationId || 'test'}`);

      expect(response.status).toBe(401);
    }, TEST_TIMEOUT);
  });

  describe('GET /api/conversations - List Conversations', () => {
    test('should list user conversations', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/conversations`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(response.ok).toBe(true);

      const data = await response.json();

      expect(data).toHaveProperty('count');
      expect(data).toHaveProperty('conversations');
      expect(Array.isArray(data.conversations)).toBe(true);
      expect(data.count).toBe(data.conversations.length);

      if (data.conversations.length > 0) {
        const conv = data.conversations[0];
        expect(conv).toHaveProperty('id');
        expect(conv).toHaveProperty('title');
        expect(conv).toHaveProperty('agentType');
        expect(conv).toHaveProperty('messageCount');
        expect(conv).toHaveProperty('createdAt');
        expect(conv).toHaveProperty('updatedAt');
      }

      console.log(`✓ Found ${data.count} conversations`);
    }, TEST_TIMEOUT);

    test('should filter by agent type', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const agentType = 'etg-writer';
      const response = await fetch(`${API_BASE}/api/conversations?agentType=${agentType}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(response.ok).toBe(true);

      const data = await response.json();

      // All conversations should match the agent type
      data.conversations.forEach(conv => {
        expect(conv.agentType).toBe(agentType);
      });

      console.log(`✓ Found ${data.count} ${agentType} conversations`);
    }, TEST_TIMEOUT);

    test('should require authentication', async () => {
      const response = await fetch(`${API_BASE}/api/conversations`);

      expect(response.status).toBe(401);
    }, TEST_TIMEOUT);

    test('should order by most recent first', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      const response = await fetch(`${API_BASE}/api/conversations`, {
        headers: {
          'Cookie': authCookie
        }
      });

      const data = await response.json();

      if (data.conversations.length > 1) {
        // Check descending order
        for (let i = 0; i < data.conversations.length - 1; i++) {
          const date1 = new Date(data.conversations[i].updatedAt);
          const date2 = new Date(data.conversations[i + 1].updatedAt);
          expect(date1.getTime()).toBeGreaterThanOrEqual(date2.getTime());
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('DELETE /api/conversations/:id - Delete Conversation', () => {
    test('should delete a conversation', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping test - no auth cookie');
        return;
      }

      // Create a conversation to delete
      const createResponse = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'etg-writer',
          message: 'Test message for deletion'
        })
      });

      // Extract conversation ID from SSE stream
      const createText = await createResponse.text();
      const connectedLine = createText.split('\n').find(l => l.includes('"type":"connected"'));
      if (!connectedLine) {
        console.log('⚠️  Could not extract conversation ID, skipping delete test');
        return;
      }

      const connectedData = JSON.parse(connectedLine.replace('data: ', ''));
      const convIdToDelete = connectedData.conversationId;

      // Delete it
      const deleteResponse = await fetch(`${API_BASE}/api/conversations/${convIdToDelete}`, {
        method: 'DELETE',
        headers: {
          'Cookie': authCookie
        }
      });

      expect(deleteResponse.ok).toBe(true);

      const data = await deleteResponse.json();
      expect(data.success).toBe(true);

      // Verify deletion
      const getResponse = await fetch(`${API_BASE}/api/conversations/${convIdToDelete}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(getResponse.status).toBe(404);

      console.log('✓ Conversation deleted successfully');
    }, TEST_TIMEOUT);

    test('should require authentication', async () => {
      const response = await fetch(`${API_BASE}/api/conversations/test-id`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(401);
    }, TEST_TIMEOUT);
  });

  describe('End-to-End Conversation Flow', () => {
    test('should create conversation, add messages, load history, and delete', async () => {
      if (!authCookie) {
        console.log('⚠️  Skipping E2E test - no auth cookie');
        return;
      }

      console.log('\n🔄 Running E2E conversation flow test...\n');

      // 1. Create conversation with first message
      console.log('1️⃣  Creating new conversation...');
      const createResponse = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'etg-writer',
          message: 'What are the eligibility criteria for ETG?'
        })
      });

      expect(createResponse.ok).toBe(true);

      const createText = await createResponse.text();
      const connectedLine = createText.split('\n').find(l => l.includes('"type":"connected"'));
      const connectedData = JSON.parse(connectedLine.replace('data: ', ''));
      const e2eConvId = connectedData.conversationId;

      console.log(`   ✓ Conversation created: ${e2eConvId}`);

      // 2. Wait for response to complete (look for complete event)
      const hasComplete = createText.includes('"type":"complete"');
      expect(hasComplete).toBe(true);

      // 3. Load conversation with messages
      console.log('2️⃣  Loading conversation history...');
      const loadResponse = await fetch(`${API_BASE}/api/conversations/${e2eConvId}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(loadResponse.ok).toBe(true);

      const loadData = await loadResponse.json();
      expect(loadData.messages).toBeDefined();
      expect(loadData.messages.length).toBeGreaterThanOrEqual(2); // User + assistant messages

      console.log(`   ✓ Loaded ${loadData.messages.length} messages`);

      // 4. Add another message to existing conversation
      console.log('3️⃣  Adding follow-up message...');
      const followUpResponse = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          agentType: 'etg-writer',
          message: 'What about the wage subsidy amount?',
          conversationId: e2eConvId // Use existing conversation
        })
      });

      expect(followUpResponse.ok).toBe(true);
      console.log('   ✓ Follow-up message sent');

      // 5. Load updated conversation
      console.log('4️⃣  Loading updated conversation...');
      const reloadResponse = await fetch(`${API_BASE}/api/conversations/${e2eConvId}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      const reloadData = await reloadResponse.json();
      expect(reloadData.messages.length).toBeGreaterThan(loadData.messages.length);

      console.log(`   ✓ Now has ${reloadData.messages.length} messages`);

      // 6. List conversations (should include our new one)
      console.log('5️⃣  Listing all conversations...');
      const listResponse = await fetch(`${API_BASE}/api/conversations?agentType=etg-writer`, {
        headers: {
          'Cookie': authCookie
        }
      });

      const listData = await listResponse.json();
      const foundConv = listData.conversations.find(c => c.id === e2eConvId);
      expect(foundConv).toBeDefined();

      console.log(`   ✓ Found conversation in list of ${listData.count} conversations`);

      // 7. Delete conversation
      console.log('6️⃣  Deleting conversation...');
      const deleteResponse = await fetch(`${API_BASE}/api/conversations/${e2eConvId}`, {
        method: 'DELETE',
        headers: {
          'Cookie': authCookie
        }
      });

      expect(deleteResponse.ok).toBe(true);
      console.log('   ✓ Conversation deleted');

      // 8. Verify deletion
      console.log('7️⃣  Verifying deletion...');
      const verifyResponse = await fetch(`${API_BASE}/api/conversations/${e2eConvId}`, {
        headers: {
          'Cookie': authCookie
        }
      });

      expect(verifyResponse.status).toBe(404);
      console.log('   ✓ Deletion verified\n');

      console.log('✅ E2E conversation flow test completed successfully!\n');
    }, TEST_TIMEOUT * 2);
  });
});

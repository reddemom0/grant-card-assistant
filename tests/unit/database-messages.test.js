/**
 * Database Messages Unit Tests
 *
 * Tests the database operations for conversations and messages
 * with real Postgres connection
 */

import { jest } from '@jest/globals';
import {
  createConversation,
  getConversation,
  saveMessage,
  getConversationMessages,
  listConversations,
  deleteConversation,
  updateConversationTitle
} from '../../src/database/messages.js';

// Test data
const TEST_USER_ID = 999; // Integer user ID
const TEST_AGENT_TYPE = 'etg-writer';
let testConversationId;

describe('Database Messages Operations', () => {
  beforeAll(async () => {
    // Ensure database connection is available
    console.log('📊 Setting up database tests...');
  });

  describe('Conversation Creation', () => {
    test('should create a new conversation', async () => {
      const conversationId = crypto.randomUUID();
      const title = 'Test Conversation';

      const conversation = await createConversation(
        conversationId,
        TEST_USER_ID,
        TEST_AGENT_TYPE,
        title
      );

      expect(conversation).toBeDefined();
      expect(conversation.id).toBe(conversationId);
      expect(conversation.user_id).toBe(TEST_USER_ID);
      expect(conversation.agent_type).toBe(TEST_AGENT_TYPE);
      expect(conversation.title).toBe(title);
      expect(conversation.created_at).toBeDefined();

      testConversationId = conversationId;
    }, 10000);

    test('should create conversation with null userId for anonymous', async () => {
      const conversationId = crypto.randomUUID();

      const conversation = await createConversation(
        conversationId,
        null,
        TEST_AGENT_TYPE,
        'Anonymous Conversation'
      );

      expect(conversation).toBeDefined();
      expect(conversation.user_id).toBeNull();
    }, 10000);

    test('should handle duplicate conversation ID gracefully', async () => {
      const conversationId = crypto.randomUUID();

      // Create first time
      await createConversation(conversationId, TEST_USER_ID, TEST_AGENT_TYPE, 'First');

      // Create again with same ID
      const conversation = await createConversation(
        conversationId,
        TEST_USER_ID,
        TEST_AGENT_TYPE,
        'Second'
      );

      // Should return existing conversation
      expect(conversation).toBeDefined();
      expect(conversation.id).toBe(conversationId);
    }, 10000);
  });

  describe('Message Saving', () => {
    test('should save a user message', async () => {
      const message = await saveMessage(
        testConversationId,
        'user',
        'Hello, this is a test message'
      );

      expect(message).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.conversation_id).toBe(testConversationId);
    }, 10000);

    test('should save an assistant message with content blocks', async () => {
      const content = [
        { type: 'text', text: 'This is my response' }
      ];

      const message = await saveMessage(
        testConversationId,
        'assistant',
        content
      );

      expect(message).toBeDefined();
      expect(message.role).toBe('assistant');
      expect(message.content).toBeDefined();
    }, 10000);

    test('should save message with tool_use content', async () => {
      const content = [
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'memory_store',
          input: { key: 'test', value: 'data' }
        }
      ];

      const message = await saveMessage(
        testConversationId,
        'assistant',
        content
      );

      expect(message).toBeDefined();
    }, 10000);
  });

  describe('Message Retrieval', () => {
    test('should retrieve all messages for a conversation', async () => {
      const messages = await getConversationMessages(testConversationId);

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);

      // Check message structure
      messages.forEach(msg => {
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(['user', 'assistant']).toContain(msg.role);
      });
    }, 10000);

    test('should return empty array for non-existent conversation', async () => {
      const fakeId = crypto.randomUUID();
      const messages = await getConversationMessages(fakeId);

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(0);
    }, 10000);

    test('should filter out thinking blocks when retrieving', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Test');

      // Save message with thinking blocks
      await saveMessage(convId, 'user', 'Test question');
      await saveMessage(convId, 'assistant', [
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Here is my answer' }
      ]);

      const messages = await getConversationMessages(convId);

      // Assistant message should not contain thinking block
      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(Array.isArray(assistantMsg.content)).toBe(true);

      const hasThinking = assistantMsg.content.some(b => b.type === 'thinking');
      expect(hasThinking).toBe(false);
    }, 10000);
  });

  describe('Conversation Retrieval', () => {
    test('should get conversation metadata', async () => {
      const conversation = await getConversation(testConversationId);

      expect(conversation).toBeDefined();
      expect(conversation.id).toBe(testConversationId);
      expect(conversation.agent_type).toBe(TEST_AGENT_TYPE);
      expect(conversation.message_count).toBeDefined();
      expect(parseInt(conversation.message_count)).toBeGreaterThan(0);
    }, 10000);

    test('should return null for non-existent conversation', async () => {
      const fakeId = crypto.randomUUID();
      const conversation = await getConversation(fakeId);

      expect(conversation).toBeNull();
    }, 10000);
  });

  describe('List Conversations', () => {
    test('should list conversations for a user', async () => {
      const conversations = await listConversations(TEST_USER_ID);

      expect(Array.isArray(conversations)).toBe(true);
      expect(conversations.length).toBeGreaterThan(0);

      // Check structure
      conversations.forEach(conv => {
        expect(conv).toHaveProperty('id');
        expect(conv).toHaveProperty('user_id');
        expect(conv).toHaveProperty('agent_type');
        expect(conv).toHaveProperty('message_count');
        expect(conv).toHaveProperty('created_at');
      });
    }, 10000);

    test('should filter conversations by agent type', async () => {
      const conversations = await listConversations(TEST_USER_ID, TEST_AGENT_TYPE);

      expect(Array.isArray(conversations)).toBe(true);

      // All should match agent type
      conversations.forEach(conv => {
        expect(conv.agent_type).toBe(TEST_AGENT_TYPE);
      });
    }, 10000);

    test('should return empty array for user with no conversations', async () => {
      const fakeUserId = 99999;
      const conversations = await listConversations(fakeUserId);

      expect(Array.isArray(conversations)).toBe(true);
      expect(conversations.length).toBe(0);
    }, 10000);

    test('should order conversations by most recent first', async () => {
      const conversations = await listConversations(TEST_USER_ID);

      if (conversations.length > 1) {
        // Check that dates are in descending order
        for (let i = 0; i < conversations.length - 1; i++) {
          const date1 = new Date(conversations[i].last_message_at || conversations[i].created_at);
          const date2 = new Date(conversations[i + 1].last_message_at || conversations[i + 1].created_at);
          expect(date1.getTime()).toBeGreaterThanOrEqual(date2.getTime());
        }
      }
    }, 10000);
  });

  describe('Conversation Updates', () => {
    test('should update conversation title', async () => {
      const newTitle = 'Updated Test Title';

      const updated = await updateConversationTitle(testConversationId, newTitle);

      expect(updated).toBeDefined();
      expect(updated.title).toBe(newTitle);
      expect(updated.updated_at).toBeDefined();
    }, 10000);
  });

  describe('Conversation Deletion', () => {
    test('should delete a conversation', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'To Delete');
      await saveMessage(convId, 'user', 'Test message');

      // Delete
      const result = await deleteConversation(convId, TEST_USER_ID);
      expect(result).toBe(true);

      // Verify deletion
      const conversation = await getConversation(convId);
      expect(conversation).toBeNull();
    }, 10000);

    test('should cascade delete messages when deleting conversation', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Cascade Test');
      await saveMessage(convId, 'user', 'Message 1');
      await saveMessage(convId, 'assistant', 'Message 2');

      // Delete conversation
      await deleteConversation(convId, TEST_USER_ID);

      // Messages should also be deleted
      const messages = await getConversationMessages(convId);
      expect(messages.length).toBe(0);
    }, 10000);

    test('should prevent deletion of another users conversation', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Protected');

      // Try to delete with different user ID
      const wrongUserId = 88888;

      await expect(deleteConversation(convId, wrongUserId)).rejects.toThrow();
    }, 10000);
  });

  describe('Edge Cases', () => {
    test('should handle very long message content', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Long Content');

      const longText = 'A'.repeat(10000); // 10k character message
      const message = await saveMessage(convId, 'user', longText);

      expect(message).toBeDefined();

      const messages = await getConversationMessages(convId);
      expect(messages[0].content.length).toBe(10000);
    }, 10000);

    test('should handle special characters in content', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Special Chars');

      const specialContent = 'Hello "World" & <tag> $100 €50 \n\t 日本語';
      await saveMessage(convId, 'user', specialContent);

      const messages = await getConversationMessages(convId);
      expect(messages[0].content).toBe(specialContent);
    }, 10000);

    test('should handle multiple rapid message saves', async () => {
      const convId = crypto.randomUUID();
      await createConversation(convId, TEST_USER_ID, TEST_AGENT_TYPE, 'Rapid Fire');

      // Save 10 messages rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(saveMessage(convId, 'user', `Message ${i}`));
      }

      const messages = await Promise.all(promises);
      expect(messages.length).toBe(10);

      // Verify all saved
      const retrieved = await getConversationMessages(convId);
      expect(retrieved.length).toBe(10);
    }, 15000);
  });
});

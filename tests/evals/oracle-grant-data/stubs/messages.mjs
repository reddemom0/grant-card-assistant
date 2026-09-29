/**
 * Eval stand-in for src/database/messages.js — nothing reaches the messages table.
 *
 * Saved messages are kept in memory on globalThis.__oracleEval (the runner reads
 * them for the answer and the server-side web tool results). Every question
 * starts with no history, so compaction never runs. Read-only exports pass
 * through to the real module.
 */

export * from '../../../../src/database/messages.js?real';

const log = () => (globalThis.__oracleEval ??= { calls: [], blocked: [], messages: [] });

export async function saveMessage(conversationId, role, content) {
  log().messages.push({ conversationId, role, content });
  return { id: log().messages.length, conversation_id: conversationId, role };
}

export async function createConversation(conversationId, userId, agentType, title = null) {
  return { id: conversationId, user_id: userId, agent_type: agentType, title };
}

export async function getConversationMessages() {
  return [];
}

export async function getCompactionSummary() {
  return null;
}

export async function saveCompactionSummary() {
  return null;
}

export async function deleteOldMessages() {
  return 0;
}

export async function updateConversationTitle() {
  return null;
}

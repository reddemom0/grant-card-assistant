/**
 * Tracked cards — small shared registries with no dependencies
 *
 * - Foundation actions every card type understands (mute / keep / close).
 * - App commands (slash commands): the mechanism only. Commands are registered
 *   here when they are built; none are registered yet.
 * - "The card was the reply": when a tool posts a card during an agent turn,
 *   the Chat adapter must not post the model's text as well.
 */

/** Actions handled by the foundation for any card type. */
export const FOUNDATION_ACTIONS = {
  'card.mute': { personal: true, label: 'muted this card' },
  'card.keep': { personal: false, label: 'kept this card open' },
  'card.close': { personal: false, label: 'closed this card' }
};

// ============================================================================
// APP COMMANDS
// ============================================================================

const appCommands = new Map();

/**
 * Register a handler for a Chat app command (configured in the Cloud console,
 * Chat API → Configuration → Commands).
 * @param {number|string} commandId - 1–1000
 * @param {(evt: Object) => Promise<Object>} handler - returns the synchronous response body
 */
export function registerAppCommand(commandId, handler) {
  appCommands.set(String(commandId), handler);
}

export function findAppCommand(commandId) {
  return appCommands.get(String(commandId)) || null;
}

// ============================================================================
// CARD-AS-REPLY MARKERS
// ============================================================================

const cardReplies = new Set();

/** A card was posted as the answer to this conversation's current turn. */
export function markCardReply(conversationId) {
  if (conversationId) cardReplies.add(conversationId);
}

/** True (once) when this turn's reply was a card. */
export function takeCardReply(conversationId) {
  return cardReplies.delete(conversationId);
}

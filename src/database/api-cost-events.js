/**
 * API cost event storage
 *
 * One row per Anthropic API call. Written fire-and-forget from
 * logAPICost (src/utils/cost-logger.js) — see migration
 * migrations/024_create_api_cost_events.sql for the schema rationale.
 *
 * Errors are NOT caught here. connection.js already logs them, and the caller
 * attaches the .catch() that keeps a failed insert from affecting a user's
 * turn. This matches src/database/user-oauth-tokens.js.
 */

import { query } from './connection.js';

/**
 * Persist one API call's token usage and estimated cost.
 *
 * Every field except source/model may be null — most call sites have no user or
 * conversation context. Token counts default to 0 rather than null so that
 * SUM() over any slice is always a number.
 *
 * @param {Object} params
 * @param {string} params.source - call-site identifier (required)
 * @param {string} params.model - model id (required)
 * @param {string|null} [params.agentType]
 * @param {string|null} [params.conversationId] - conversations.id OR a lead-gen session_id
 * @param {number|null} [params.userId]
 * @param {string|null} [params.userEmail]
 * @param {Object} params.usage - raw usage object from the API response
 * @param {number} params.costUsd - estimated cost from calculateRequestCost
 * @param {Object} [params.metadata]
 * @returns {Promise<void>}
 */
export async function recordCostEvent({
  source,
  model,
  agentType = null,
  conversationId = null,
  userId = null,
  userEmail = null,
  usage = {},
  costUsd = 0,
  metadata = null
}) {
  await query(
    `INSERT INTO api_cost_events (
       source, model, agent_type, conversation_id, user_id, user_email,
       input_tokens, output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens,
       cost_usd, usage_raw, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      source || 'unknown',
      model || 'unknown',
      agentType,
      // Coerce to text: callers pass uuids, lead-gen session ids, and numbers.
      conversationId == null ? null : String(conversationId),
      Number.isInteger(userId) ? userId : null,
      userEmail,
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      usage.cache_creation_input_tokens || 0,
      usage.cache_read_input_tokens || 0,
      costUsd || 0,
      JSON.stringify(usage ?? {}),
      metadata && Object.keys(metadata).length ? JSON.stringify(metadata) : null
    ]
  );
}

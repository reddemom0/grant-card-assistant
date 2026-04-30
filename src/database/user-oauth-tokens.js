/**
 * Per-user OAuth token storage, generic over providers.
 *
 * SECURITY NOTE: Tokens stored plaintext in TEXT columns, mirroring the
 * existing Google OAuth pattern in the users table. Application-level
 * encryption-at-rest is a deliberate deferred decision (see DECISIONS.md).
 *
 * Refresh logic is provider-specific and lives with each provider's
 * integration code, not here.
 */

import { query } from './connection.js';

/**
 * Fetch the stored OAuth token row for a user/provider pair.
 * @param {number} userId
 * @param {string} provider
 * @returns {Promise<Object|null>} Row with access_token, refresh_token,
 *   token_expiry, server_url, scope, created_at, updated_at — or null.
 */
export async function getUserOAuthTokens(userId, provider) {
  const result = await query(
    `SELECT access_token, refresh_token, token_expiry, server_url, scope, created_at, updated_at
     FROM user_oauth_tokens
     WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert OAuth tokens for a user/provider pair.
 *
 * Mirrors the COALESCE pattern from src/api/auth.js:182-195 — a missing
 * refresh_token in the input does NOT clobber a stored one. All other
 * fields are unconditionally overwritten.
 *
 * @param {number} userId
 * @param {string} provider
 * @param {{ access_token: string, refresh_token?: string|null,
 *   token_expiry?: Date|string|null, server_url?: string|null,
 *   scope?: string|null }} tokens
 * @returns {Promise<Object>} The upserted row.
 */
export async function saveUserOAuthTokens(userId, provider, tokens) {
  const result = await query(
    `INSERT INTO user_oauth_tokens
       (user_id, provider, access_token, refresh_token, token_expiry, server_url, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_oauth_tokens.refresh_token),
       token_expiry  = EXCLUDED.token_expiry,
       server_url    = EXCLUDED.server_url,
       scope         = EXCLUDED.scope,
       updated_at    = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      userId,
      provider,
      tokens.access_token,
      tokens.refresh_token ?? null,
      tokens.token_expiry ?? null,
      tokens.server_url ?? null,
      tokens.scope ?? null
    ]
  );
  return result.rows[0];
}

/**
 * Delete the stored OAuth token row for a user/provider pair.
 * @param {number} userId
 * @param {string} provider
 * @returns {Promise<number>} Count of deleted rows (0 or 1).
 */
export async function deleteUserOAuthTokens(userId, provider) {
  const result = await query(
    `DELETE FROM user_oauth_tokens WHERE user_id = $1 AND provider = $2`,
    [userId, provider]
  );
  return result.rowCount ?? 0;
}

/**
 * List the providers a user has connected.
 * @param {number} userId
 * @returns {Promise<string[]>}
 */
export async function listUserConnectedProviders(userId) {
  const result = await query(
    `SELECT provider FROM user_oauth_tokens WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map(r => r.provider);
}

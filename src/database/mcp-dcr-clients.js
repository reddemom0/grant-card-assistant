/**
 * Storage for OAuth Dynamic Client Registration (DCR) credentials,
 * scoped per provider per deployment (NOT per user).
 *
 * When the hub registers itself with a remote MCP server's OAuth
 * authorization server (e.g. Granola), the DCR response gives us a
 * client_id (and possibly client_secret) that all users of this
 * deployment share when authenticating to that provider.
 *
 * SECURITY NOTE: client_secret stored plaintext, mirroring the
 * convention from src/database/user-oauth-tokens.js. Same deferred
 * decision applies (see DECISIONS.md).
 */

import { query } from './connection.js';

/**
 * Fetch the stored DCR client info for a provider.
 * @param {string} provider
 * @returns {Promise<Object|null>} Row with client_id, client_secret,
 *   client_id_issued_at, client_secret_expires_at, registered_at,
 *   created_at, updated_at — or null.
 */
export async function getDCRClient(provider) {
  const result = await query(
    `SELECT provider, client_id, client_secret, client_id_issued_at,
            client_secret_expires_at, registered_at, created_at, updated_at
     FROM mcp_dcr_clients
     WHERE provider = $1`,
    [provider]
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert the DCR client info for a provider.
 *
 * COALESCE on every nullable field (`client_secret`, `client_id_issued_at`,
 * `client_secret_expires_at`) so a partial update doesn't clobber a stored
 * value. `client_id` is required and unconditional.
 *
 * @param {string} provider
 * @param {{ client_id: string, client_secret?: string|null,
 *   client_id_issued_at?: Date|string|null,
 *   client_secret_expires_at?: Date|string|null }} clientInfo
 * @returns {Promise<Object>} The upserted row.
 */
export async function saveDCRClient(provider, clientInfo) {
  const result = await query(
    `INSERT INTO mcp_dcr_clients
       (provider, client_id, client_secret, client_id_issued_at, client_secret_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider)
     DO UPDATE SET
       client_id                = EXCLUDED.client_id,
       client_secret            = COALESCE(EXCLUDED.client_secret, mcp_dcr_clients.client_secret),
       client_id_issued_at      = COALESCE(EXCLUDED.client_id_issued_at, mcp_dcr_clients.client_id_issued_at),
       client_secret_expires_at = COALESCE(EXCLUDED.client_secret_expires_at, mcp_dcr_clients.client_secret_expires_at),
       updated_at               = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      provider,
      clientInfo.client_id,
      clientInfo.client_secret ?? null,
      clientInfo.client_id_issued_at ?? null,
      clientInfo.client_secret_expires_at ?? null
    ]
  );
  return result.rows[0];
}

/**
 * Delete the stored DCR client info for a provider.
 * @param {string} provider
 * @returns {Promise<number>} Count of deleted rows (0 or 1).
 */
export async function deleteDCRClient(provider) {
  const result = await query(
    `DELETE FROM mcp_dcr_clients WHERE provider = $1`,
    [provider]
  );
  return result.rowCount ?? 0;
}

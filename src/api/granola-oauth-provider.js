/**
 * GranolaOAuthClientProvider — implements @modelcontextprotocol/sdk's
 * OAuthClientProvider interface against the hub's storage layers.
 *
 * Storage map:
 *   - DCR client info: mcp_dcr_clients (deployment-scoped, provider='granola')
 *   - User tokens:     user_oauth_tokens (per-user, provider='granola')
 *   - State + PKCE:    Redis with 10-minute TTL (granola-oauth-state.js)
 *
 * The SDK's auth() helper drives the full ceremony — DCR, PKCE generation,
 * token exchange, and refresh — by calling the methods on this class. We
 * never touch the auth/token endpoints directly.
 *
 * `redirectToAuthorization` cannot redirect (no res in scope). Instead it
 * stashes the URL on the instance; the calling route handler reads
 * `provider.redirectUrlValue` after `auth()` returns 'REDIRECT'.
 */

import { getDCRClient, saveDCRClient } from '../database/mcp-dcr-clients.js';
import {
  getUserOAuthTokens,
  saveUserOAuthTokens,
  deleteUserOAuthTokens
} from '../database/user-oauth-tokens.js';
import {
  generateAndStoreState,
  saveCodeVerifier as saveVerifierRedis,
  loadAndConsumeCodeVerifier,
  clearOAuthState
} from '../utils/granola-oauth-state.js';

const PROVIDER = 'granola';
const SERVER_URL = 'https://mcp.granola.ai/mcp';
const SCOPE = 'email offline_access openid profile';

export class GranolaOAuthClientProvider {
  constructor(userId) {
    this.userId = userId;
    this.redirectUrlValue = null;
  }

  get redirectUrl() {
    const base = process.env.PUBLIC_URL;
    if (!base) {
      throw new Error(
        'PUBLIC_URL env var is required for Granola OAuth ' +
        '(e.g. https://your-deployment.up.railway.app)'
      );
    }
    return base.replace(/\/$/, '') + '/api/auth/granola/callback';
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'Granted Hub',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE
    };
  }

  async clientInformation() {
    const row = await getDCRClient(PROVIDER);
    if (!row) return undefined;
    const out = { client_id: row.client_id };
    if (row.client_secret) out.client_secret = row.client_secret;
    if (row.client_id_issued_at) {
      out.client_id_issued_at = Math.floor(new Date(row.client_id_issued_at).getTime() / 1000);
    }
    if (row.client_secret_expires_at) {
      out.client_secret_expires_at = Math.floor(new Date(row.client_secret_expires_at).getTime() / 1000);
    }
    return out;
  }

  async saveClientInformation(info) {
    await saveDCRClient(PROVIDER, {
      client_id: info.client_id,
      client_secret: info.client_secret ?? null,
      client_id_issued_at:
        info.client_id_issued_at != null ? new Date(info.client_id_issued_at * 1000) : null,
      client_secret_expires_at:
        info.client_secret_expires_at != null ? new Date(info.client_secret_expires_at * 1000) : null
    });
  }

  async tokens() {
    const row = await getUserOAuthTokens(this.userId, PROVIDER);
    if (!row) return undefined;
    const out = {
      access_token: row.access_token,
      token_type: 'Bearer'
    };
    if (row.refresh_token) out.refresh_token = row.refresh_token;
    if (row.scope) out.scope = row.scope;
    if (row.token_expiry) {
      const ms = new Date(row.token_expiry).getTime() - Date.now();
      out.expires_in = Math.max(0, Math.floor(ms / 1000));
    }
    return out;
  }

  async saveTokens(tokens) {
    const tokenExpiry = tokens.expires_in != null
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;
    await saveUserOAuthTokens(this.userId, PROVIDER, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry: tokenExpiry,
      server_url: SERVER_URL,
      scope: tokens.scope ?? null
    });
  }

  async state() {
    return generateAndStoreState(this.userId);
  }

  async saveCodeVerifier(verifier) {
    return saveVerifierRedis(this.userId, verifier);
  }

  async codeVerifier() {
    const v = await loadAndConsumeCodeVerifier(this.userId);
    if (!v) throw new Error('Code verifier missing or expired');
    return v;
  }

  redirectToAuthorization(authorizationUrl) {
    this.redirectUrlValue = authorizationUrl.toString();
  }

  async invalidateCredentials(scope) {
    if (scope === 'tokens' || scope === 'all') {
      await deleteUserOAuthTokens(this.userId, PROVIDER);
    }
    if (scope === 'verifier' || scope === 'all') {
      await clearOAuthState(this.userId);
    }
    // 'client' scope is deployment-scoped — do NOT delete on a single
    // user's disconnect. Skip silently.
  }
}

/**
 * Granola OAuth route handlers.
 *
 *   GET  /api/auth/granola            — start the flow (or short-circuit if already authorized)
 *   GET  /api/auth/granola/callback   — finish the flow after the user returns from the AS
 *   GET  /api/auth/granola/status     — { connected: bool, email?: string } for the UI
 *   POST /api/auth/granola/disconnect — drop the user's stored tokens
 *
 * All four require an authenticated hub user (granted_session JWT).
 *
 * /status reports presence of a token row, NOT live validity against Granola's
 * server. Invalid/expired-and-unrefreshable tokens surface during actual tool
 * calls; the user reconnects from there.
 *
 * The MCP SDK's auth() helper does the heavy lifting: discovery of the AS
 * metadata at the .well-known endpoints, Dynamic Client Registration, PKCE
 * generation, and token exchange. We provide a GranolaOAuthClientProvider
 * with our storage hooks; the SDK calls into it.
 *
 * Mounted in server.js as: app.use('/api/auth/granola', granolaAuthRouter)
 */

import { Router } from 'express';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { authenticateUser } from '../middleware/auth.js';
import { GranolaOAuthClientProvider } from './granola-oauth-provider.js';
import { verifyAndConsumeState, clearOAuthState } from '../utils/granola-oauth-state.js';
import { getUserOAuthTokens } from '../database/user-oauth-tokens.js';

const router = Router();
const SERVER_URL = 'https://mcp.granola.ai/mcp';
const SUCCESS_REDIRECT = '/oracle?granola=connected';

router.get('/', authenticateUser, async (req, res) => {
  try {
    const provider = new GranolaOAuthClientProvider(req.user.id);
    const result = await auth(provider, { serverUrl: SERVER_URL });

    if (result === 'REDIRECT') {
      if (!provider.redirectUrlValue) {
        console.error('[granola-auth] init: REDIRECT but no redirectUrlValue stashed');
        return res.status(500).send('OAuth init failed: no redirect URL');
      }
      return res.redirect(provider.redirectUrlValue);
    }

    if (result === 'AUTHORIZED') {
      return res.redirect(SUCCESS_REDIRECT);
    }

    console.error('[granola-auth] init: unexpected auth() result:', result);
    return res.status(500).send('Unexpected OAuth result');
  } catch (err) {
    console.error('[granola-auth] init failed:', err);
    return res.status(500).send('Granola OAuth init failed');
  }
});

router.get('/status', authenticateUser, async (req, res) => {
  try {
    const tokens = await getUserOAuthTokens(req.user.id, 'granola');
    if (!tokens) return res.json({ connected: false });
    return res.json({ connected: true, email: req.user.email });
  } catch (err) {
    console.error('[granola-auth] status failed:', err);
    return res.status(500).json({ connected: false, error: 'Status check failed' });
  }
});

router.get('/callback', authenticateUser, async (req, res) => {
  const { code, state, error } = req.query;
  try {
    if (error) {
      console.error('[granola-auth] callback: provider returned error:', error);
      return res.status(400).send('Granola auth failed: ' + String(error));
    }
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    const stateValid = await verifyAndConsumeState(req.user.id, String(state));
    if (!stateValid) {
      console.error('[granola-auth] callback: invalid state for user', req.user.id);
      return res.status(400).send('Invalid state — possible CSRF');
    }

    const provider = new GranolaOAuthClientProvider(req.user.id);
    const result = await auth(provider, {
      serverUrl: SERVER_URL,
      authorizationCode: String(code)
    });

    if (result === 'AUTHORIZED') {
      return res.redirect(SUCCESS_REDIRECT);
    }

    console.error('[granola-auth] callback: unexpected auth() result:', result);
    return res.status(500).send('Unexpected OAuth result');
  } catch (err) {
    console.error('[granola-auth] callback failed:', err);
    return res.status(500).send('Granola OAuth callback failed');
  } finally {
    // Best-effort cleanup so leftover state/verifier keys don't accumulate
    // when the flow errors before they would naturally be consumed.
    try { await clearOAuthState(req.user.id); } catch { /* ignore */ }
  }
});

router.post('/disconnect', authenticateUser, async (req, res) => {
  try {
    const provider = new GranolaOAuthClientProvider(req.user.id);
    await provider.invalidateCredentials('all');
    return res.json({ success: true });
  } catch (err) {
    console.error('[granola-auth] disconnect failed:', err);
    return res.status(500).json({ success: false, error: 'Disconnect failed' });
  }
});

export default router;

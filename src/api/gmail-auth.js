/**
 * Opt-in Gmail consent — incremental authorization for ONE allowlisted user at
 * a time, never part of the default Hub sign-in (src/api/auth.js is unchanged).
 *
 *   GET /api/auth/gmail           — start: allowlist check, redirect to Google
 *   GET /api/auth/gmail/callback  — finish: verify, store tokens, stamp gmail_connected_at
 *   GET /api/auth/gmail/status    — { eligible, connected, missing }
 *
 * All three require a signed-in Hub user (granted_session JWT). Mounted in
 * server.js as: app.use('/api/auth/gmail', gmailAuthRouter)
 *
 * Requests ONLY gmail.readonly + gmail.compose. include_granted_scopes=true
 * makes Google return one token covering everything this user already granted
 * plus Gmail, so it replaces their stored Google token without losing Drive,
 * Calendar or Chat — and their later ordinary sign-ins keep Gmail.
 *
 * gmail.compose also permits sending; nothing here or in src/tools/gmail.js
 * ever sends (enforced by tests/unit/gmail.test.js). See docs/oracle.md.
 *
 * The callback URL must be registered on the OAuth client in Google Cloud
 * Console (authorized redirect URIs), separately from /api/auth-callback.
 */

import { Router } from 'express';
import { google } from 'googleapis';
import { authenticateUser, requireAuth } from '../middleware/auth.js';
import { query } from '../database/connection.js';
import { issueGmailConsentState, consumeGmailConsentState } from '../utils/gmail-consent-state.js';
import { GMAIL_SCOPES, hasGmailScopes } from '../tools/gmail.js';

const router = Router();
const SUCCESS_REDIRECT = '/oracle?gmail=connected';
const ALLOWED_EMAIL_DOMAIN = 'granted.ca';

/** GMAIL_CONSENT_ALLOWLIST, comma-separated, case-insensitive. Unset = nobody. */
export function gmailConsentAllowlist(env = process.env) {
  return new Set(
    String(env.GMAIL_CONSENT_ALLOWLIST || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isGmailConsentEligible(email, env = process.env) {
  return typeof email === 'string' && gmailConsentAllowlist(env).has(email.trim().toLowerCase());
}

function callbackUri(req) {
  const protocol = req.headers['x-forwarded-proto'] || (req.protocol || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}/api/auth/gmail/callback`;
}

/** The Google consent URL. Exactly the two Gmail scopes; earlier grants carried forward. */
export function buildGmailConsentUrl({ clientId, redirectUri, state, loginHint }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    hd: ALLOWED_EMAIL_DOMAIN,
    state
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function page(res, status, title, message) {
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return res.status(status).setHeader('Content-Type', 'text/html').send(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title></head><body>` +
    `<h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/oracle">Back to Oracle</a></p></body></html>`
  );
}

router.get('/', authenticateUser, requireAuth, async (req, res) => {
  if (!isGmailConsentEligible(req.user.email)) {
    console.warn(`[gmail-auth] start refused: user ${req.user.id} not on GMAIL_CONSENT_ALLOWLIST`);
    return page(res, 403, 'Gmail connection not available', 'Connecting Gmail is not enabled for your account.');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return page(res, 500, 'Gmail connection unavailable', 'Google sign-in is not configured.');

  let state;
  try {
    state = await issueGmailConsentState(req.user.id);
  } catch {
    console.error('[gmail-auth] start failed: state_store_unavailable');
    return page(res, 503, 'Gmail connection unavailable', 'Please try again in a minute.');
  }
  console.log(`[gmail-auth] start: user ${req.user.id}`);
  return res.redirect(buildGmailConsentUrl({
    clientId,
    redirectUri: callbackUri(req),
    state,
    loginHint: req.user.email
  }));
});

router.get('/callback', authenticateUser, requireAuth, async (req, res) => {
  const userId = req.user.id;
  const provided = typeof req.query.state === 'string' ? req.query.state : '';
  let stateOk = false;
  try {
    stateOk = await consumeGmailConsentState(userId, provided);
  } catch {
    console.error('[gmail-auth] callback: state_store_unavailable');
  }
  if (!stateOk) {
    console.warn(`[gmail-auth] callback rejected: state for user ${userId}`);
    return page(res, 400, 'Gmail connection expired', 'That link has expired. Start again from Oracle.');
  }
  if (req.query.error) {
    // Includes the person clicking "Cancel" on Google's screen. Nothing stored.
    console.warn(`[gmail-auth] callback: Google returned ${String(req.query.error)}`);
    return page(res, 400, 'Gmail not connected', 'Google did not grant access, so nothing changed.');
  }
  if (!isGmailConsentEligible(req.user.email)) {
    return page(res, 403, 'Gmail connection not available', 'Connecting Gmail is not enabled for your account.');
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return page(res, 400, 'Gmail not connected', 'No authorization code came back from Google.');

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      callbackUri(req)
    );
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // The Google account must be the signed-in Hub user's own, so a different
    // mailbox can never be attached to this person.
    const { data: info } = await google.oauth2({ version: 'v2', auth: oauth2Client }).userinfo.get();
    if (String(info.email || '').toLowerCase() !== String(req.user.email).toLowerCase()) {
      console.warn(`[gmail-auth] callback rejected: account mismatch for user ${userId}`);
      return page(res, 403, 'Wrong Google account', `Connect the Gmail for ${req.user.email}.`);
    }

    const granted = new Set(String(tokens.scope || '').split(/\s+/).filter(Boolean));
    const missing = GMAIL_SCOPES.filter(s => !granted.has(s));
    if (missing.length > 0) {
      console.warn(`[gmail-auth] callback: user ${userId} declined ${missing.length} Gmail scope(s)`);
      return page(res, 400, 'Gmail not connected', 'Both Gmail permissions are needed (read, and create drafts). Nothing changed.');
    }

    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
    await query(
      `UPDATE users SET
         google_access_token = $1,
         google_refresh_token = COALESCE($2, google_refresh_token),
         google_token_expiry = $3,
         google_granted_scopes = $4,
         gmail_connected_at = NOW(),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [tokens.access_token, tokens.refresh_token || null, expiry, tokens.scope, userId]
    );
    console.log(`[gmail-auth] connected: user ${userId} (refresh token returned: ${!!tokens.refresh_token})`);
    return res.redirect(SUCCESS_REDIRECT);
  } catch (err) {
    console.error(`[gmail-auth] callback failed for user ${userId}: ${err.code || err.name || 'error'}`);
    return page(res, 500, 'Gmail not connected', 'Something went wrong talking to Google. Nothing changed.');
  }
});

router.get('/status', authenticateUser, requireAuth, async (req, res) => {
  const eligible = isGmailConsentEligible(req.user.email);
  try {
    const check = await hasGmailScopes(req.user.id);
    return res.json({ eligible, connected: check.ok, missing: check.missing });
  } catch {
    return res.status(500).json({ error: 'status_unavailable' });
  }
});

export default router;

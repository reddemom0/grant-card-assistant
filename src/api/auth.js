/**
 * Authentication API Endpoints
 *
 * Handles Google OAuth authentication flow:
 * - /api/auth-google: Initiates OAuth flow
 * - /api/auth-callback: Handles OAuth callback and creates JWT session
 * - /api/logout: Clears session
 */

import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection.js';

const router = Router();

// Only Granted staff may sign in. The `hd` parameter on the consent URL is a
// convenience hint only — Google does not enforce it and a user can strip it —
// so the real gate is the server-side domain check in /auth-callback below.
const ALLOWED_EMAIL_DOMAIN = 'granted.ca';

/** Escape untrusted text before interpolating into an HTML response. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Verify a Google profile belongs to the allowed domain.
 *
 * Exported for testing.
 *
 * Requires EXACTLY one '@' and an exact domain match. Both matter:
 *   - `endsWith`/`includes` would admit `evilgranted.ca` and `granted.ca.attacker.com`
 *   - taking the domain after the LAST '@' would admit `attacker@evil.com@granted.ca`
 *
 * @param {Object} userInfo - profile from oauth2.userinfo.get()
 * @returns {{ok: boolean, email: string, reason: string|null}}
 */
export function checkAllowedDomain(userInfo) {
  const email = (userInfo?.email || '').trim().toLowerCase();

  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, email, reason: 'missing or malformed email on Google profile' };
  }

  // Google only asserts ownership of verified addresses.
  if (userInfo.verified_email !== true) {
    return { ok: false, email, reason: 'email not verified by Google' };
  }

  if (parts[1] !== ALLOWED_EMAIL_DOMAIN) {
    return { ok: false, email, reason: `domain '${parts[1]}' is not ${ALLOWED_EMAIL_DOMAIN}` };
  }

  return { ok: true, email, reason: null };
}

/**
 * POST /api/logout
 * Clears the session cookie
 */
router.post('/logout', (req, res) => {
  console.log('🔵 Logout requested');

  // Clear the session cookie
  res.clearCookie('granted_session', {
    path: '/',
    secure: true,
    sameSite: 'lax'
  });

  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth-google
 * Redirects to Google OAuth consent screen
 */
router.get('/auth-google', (req, res) => {
  console.log('🔵 OAuth flow started');
  console.log('🔵 Request URL:', req.url);
  console.log('🔵 Request headers host:', req.headers.host);
  console.log('🔵 Request headers x-forwarded-host:', req.headers['x-forwarded-host']);

  const clientId = process.env.GOOGLE_CLIENT_ID;

  console.log('🔵 GOOGLE_CLIENT_ID present:', !!clientId);
  console.log('🔵 GOOGLE_CLIENT_ID length:', clientId?.length);
  console.log('🔵 GOOGLE_CLIENT_ID first 20 chars:', clientId?.substring(0, 20));

  if (!clientId) {
    console.error('❌ Missing GOOGLE_CLIENT_ID');
    return res.status(500).json({
      error: 'Google OAuth not configured',
      missing: 'GOOGLE_CLIENT_ID environment variable'
    });
  }

  // Dynamically determine redirect URI based on request host
  const protocol = req.headers['x-forwarded-proto'] || (req.protocol || 'https');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${protocol}://${host}/api/auth-callback`;

  console.log('🔵 Detected host:', host);
  console.log('🔵 Protocol:', protocol);

  // Include Google Drive, Docs, and Sheets scopes for document/spreadsheet creation.
  // NOTE: when this list changes, existing connected users must log out and log
  // back in to refresh their granted scopes. prompt=consent (set below) makes
  // that a single round-trip — Google will re-show the consent screen.
  const scopes = [
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  console.log('🔵 OAuth Parameters:');
  console.log('   redirect_uri:', redirectUri);
  console.log('   redirect_uri (encoded):', encodeURIComponent(redirectUri));
  console.log('   response_type:', 'code');
  console.log('   scope:', scopes);
  console.log('   access_type:', 'offline');
  console.log('   prompt:', 'consent'); // Changed to 'consent' to force refresh token
  console.log('   hd:', ALLOWED_EMAIL_DOMAIN);

  // hd pre-filters the account chooser to the Granted domain. It is a UX hint,
  // NOT the security control — /auth-callback re-checks the domain server-side.
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline&` +
    `hd=${encodeURIComponent(ALLOWED_EMAIL_DOMAIN)}&` +
    `prompt=consent`;

  console.log('🔵 Full OAuth URL:', googleAuthUrl);
  console.log('🔵 URL length:', googleAuthUrl.length);
  console.log('🔵 Redirecting to Google...');

  res.redirect(googleAuthUrl);
});

/**
 * GET /api/auth-callback
 * Handles OAuth callback from Google
 */
router.get('/auth-callback', async (req, res) => {
  console.log('🔵 Auth callback started');
  console.log('🔵 Full URL:', req.url);
  console.log('🔵 Query params:', JSON.stringify(req.query, null, 2));
  console.log('🔵 Method:', req.method);

  const { code, error, error_description } = req.query;

  // Check if Google sent an error
  if (error) {
    console.error('❌ Google OAuth error:', error);
    console.error('❌ Error description:', error_description);
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>OAuth Error</title></head>
      <body>
        <h1>Authentication Error</h1>
        <p><strong>Error:</strong> ${error}</p>
        <p><strong>Description:</strong> ${error_description || 'No description provided'}</p>
        <p><a href="/">Return to home</a></p>
      </body>
      </html>
    `);
  }

  const authCode = code;

  if (!authCode) {
    console.error('❌ No authorization code provided');
    console.error('❌ Available query params:', Object.keys(req.query));
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>OAuth Error</title></head>
      <body>
        <h1>Authentication Error</h1>
        <p>No authorization code received from Google</p>
        <p>Query params: ${JSON.stringify(req.query)}</p>
        <p><a href="/">Return to home</a></p>
      </body>
      </html>
    `);
  }

  console.log('✅ Authorization code received (length: ' + authCode.length + ')');

  try {
    console.log('🔵 Setting up OAuth2 client...');

    // Dynamically determine redirect URI based on request host
    const protocol = req.headers['x-forwarded-proto'] || (req.protocol || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/auth-callback`;

    console.log('🔵 Detected host:', host);
    console.log('🔵 Redirect URI:', redirectUri);

    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    // Exchange authorization code for tokens
    console.log('🔵 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(authCode);
    oauth2Client.setCredentials(tokens);
    console.log('✅ Got tokens');

    // Get user info from Google
    console.log('🔵 Getting user info from Google...');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    console.log('✅ Got user info:', { id: userInfo.id, email: userInfo.email, name: userInfo.name });

    // ========================================================================
    // DOMAIN GATE — the real access control for signup.
    // Runs BEFORE the upsert so a rejected account never gets a users row,
    // and therefore never gets a session.
    // ========================================================================
    const domainCheck = checkAllowedDomain(userInfo);
    if (!domainCheck.ok) {
      console.warn(`🚫 Sign-in rejected for '${domainCheck.email || '(unknown)'}': ${domainCheck.reason}`);
      return res.status(403).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>Access Denied</title></head>
      <body>
        <h1>Access Denied</h1>
        <p>The Granted AI Hub is restricted to <strong>@${ALLOWED_EMAIL_DOMAIN}</strong> accounts.</p>
        <p>You signed in as <strong>${escapeHtml(domainCheck.email) || 'an unrecognized account'}</strong>, which is not eligible.</p>
        <p>If you are Granted staff, sign in with your @${ALLOWED_EMAIL_DOMAIN} Google account.</p>
        <p><a href="/api/auth-google">Try a different account</a></p>
      </body>
      </html>
    `);
    }
    console.log(`✅ Domain check passed for ${domainCheck.email}`);

    // Create or update user in database with OAuth tokens
    console.log('🔵 Creating/updating user in database with OAuth tokens...');
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    const userResult = await query(
      `INSERT INTO users (google_id, email, name, picture, google_access_token, google_refresh_token, google_token_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (google_id)
       DO UPDATE SET
         name = $3,
         picture = $4,
         google_access_token = $5,
         google_refresh_token = COALESCE($6, users.google_refresh_token),
         google_token_expiry = $7,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, email, name, picture`,
      [userInfo.id, userInfo.email, userInfo.name, userInfo.picture, tokens.access_token, tokens.refresh_token, tokenExpiry]
    );

    const user = userResult.rows[0];
    console.log('✅ User created/updated:', { id: user.id, email: user.email });
    console.log('✅ Stored OAuth tokens (refresh_token present:', !!tokens.refresh_token, ')');

    // Create JWT token with picture included
    console.log('🔵 Creating JWT token...');
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    console.log('✅ JWT token created');

    // Set cookie WITHOUT HttpOnly so JavaScript can read it
    // Note: HttpOnly would be more secure, but we need JavaScript to check auth on client side
    console.log('🔵 Setting cookie...');
    // Don't set Domain attribute - let it default to current host for proper development/production separation
    const cookieHeader = `granted_session=${token}; Path=/; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
    res.setHeader('Set-Cookie', cookieHeader);
    console.log('✅ Cookie set for host:', host);
    console.log('✅ Cookie header:', cookieHeader);

    // Use HTML redirect instead of server redirect to ensure cookie persists
    const userDataEncoded = encodeURIComponent(JSON.stringify({
      name: user.name,
      email: user.email,
      picture: user.picture
    }));
    console.log('🔵 Sending HTML redirect to Team Oracle...');

    res.status(200).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="refresh" content="0;url=/oracle/new#user=${userDataEncoded}">
        <script>
          // Verify cookie was set
          console.log('Auth callback: Cookies after login:', document.cookie);
          // Immediate redirect as backup
          window.location.href = '/oracle/new#user=${userDataEncoded}';
        </script>
      </head>
      <body>
        <p>Login successful! Redirecting to Team Oracle...</p>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message,
      details: error.response?.data || null
    });
  }
});

export default router;

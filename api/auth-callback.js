// api/auth-callback.js
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;

export default async function handler(req, res) {
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

  const { code: authCode } = req.query;

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

  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  console.log('🔵 Database URL present:', !!dbUrl);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔵 Setting up OAuth2 client...');

    // Dynamically determine redirect URI based on request host
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || req.headers['x-forwarded-host'];
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

    // Connect to database
    console.log('🔵 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // Create or update user in database with OAuth tokens
    console.log('🔵 Creating/updating user in database with OAuth tokens...');
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    const userResult = await client.query(
      `INSERT INTO users (google_id, email, name, picture, google_access_token, google_refresh_token, google_token_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (google_id)
       DO UPDATE SET
         name = $3,
         picture = $4,
         google_access_token = $5,
         google_refresh_token = COALESCE($6, users.google_refresh_token),
         google_token_expiry = $7
       RETURNING id, email, name, picture, role`,
      [userInfo.id, userInfo.email, userInfo.name, userInfo.picture, tokens.access_token, tokens.refresh_token, tokenExpiry]
    );

    console.log('✅ Stored OAuth tokens (refresh_token present:', !!tokens.refresh_token, ')');

    const user = userResult.rows[0];
    console.log('✅ User created/updated:', { id: user.id, email: user.email, role: user.role });

    // Create JWT token with picture and role included
    console.log('🔵 Creating JWT token...');
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role || 'user'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    console.log('✅ JWT token created');

    // Set cookie WITHOUT HttpOnly so JavaScript can read it
    // Note: HttpOnly would be more secure, but we need JavaScript to check auth on client side
    console.log('🔵 Setting cookie...');
    // Use multiple Set-Cookie attributes for better compatibility
    const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
    const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
    const cookieHeader = `granted_session=${token}; Path=/; Expires=${expires}; Max-Age=${maxAge}; SameSite=Lax; Secure`;
    res.setHeader('Set-Cookie', cookieHeader);
    console.log('✅ Cookie set for host:', host);
    console.log('✅ Cookie header:', cookieHeader);
    console.log('✅ Cookie expires:', expires);

    // Use HTML redirect instead of server redirect to ensure cookie persists
    const userDataEncoded = encodeURIComponent(JSON.stringify({
      name: user.name,
      email: user.email,
      picture: user.picture
    }));
    console.log('🔵 Sending HTML redirect to dashboard...');

    res.status(200).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login Successful</title>
        <script>
          console.log('🔵 Auth callback page loaded');
          console.log('🔵 Checking cookies...');
          console.log('🔵 document.cookie:', document.cookie);

          // Wait a moment for cookie to be set, then redirect
          setTimeout(() => {
            console.log('🔵 Cookies after delay:', document.cookie);
            const hasAuthCookie = document.cookie.includes('granted_session=');
            console.log('🔵 Has granted_session cookie:', hasAuthCookie);

            if (hasAuthCookie) {
              console.log('✅ Cookie verified, redirecting to dashboard...');
            } else {
              console.warn('⚠️ Cookie not found, redirecting anyway...');
            }

            window.location.href = '/dashboard#user=${userDataEncoded}';
          }, 500);
        </script>
      </head>
      <body>
        <p>Login successful! Redirecting to dashboard...</p>
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
  } finally {
    await client.end();
  }
}

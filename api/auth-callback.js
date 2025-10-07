// api/auth-callback.js
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;

export default async function handler(req, res) {
  console.log('🔵 Auth callback started');
  console.log('🔵 Query params:', req.query);

  const { code } = req.query;

  if (!code) {
    console.error('❌ No authorization code provided');
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  console.log('🔵 Database URL present:', !!dbUrl);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔵 Setting up OAuth2 client...');
    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://grant-card-assistant.vercel.app/api/auth-callback'
    );

    // Exchange authorization code for tokens
    console.log('🔵 Exchanging code for tokens...');
    const { tokens } = await oauth2Client.getToken(code);
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

    // Create or update user in database
    console.log('🔵 Creating/updating user in database...');
    const userResult = await client.query(
      'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) ON CONFLICT (google_id) DO UPDATE SET name = $3, picture = $4 RETURNING id, email, name, picture',
      [userInfo.id, userInfo.email, userInfo.name, userInfo.picture]
    );

    const user = userResult.rows[0];
    console.log('✅ User created/updated:', { id: user.id, email: user.email });

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

    // Set HTTP-only cookie
    console.log('🔵 Setting cookie...');
    res.setHeader('Set-Cookie',
      `granted_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
    );
    console.log('✅ Cookie set');

    // Redirect to dashboard with user info in URL hash (temporary display only)
    const userDataEncoded = encodeURIComponent(JSON.stringify({
      name: user.name,
      email: user.email,
      picture: user.picture
    }));
    console.log('🔵 Redirecting to dashboard...');
    res.redirect(`/dashboard.html#user=${userDataEncoded}`);

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

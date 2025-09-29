// Create this file: api/auth-callback.js
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Client } = pg;

export default async function handler(req, res) {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  let dbClient;
  
  try {
    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://grant-card-assistant.vercel.app/api/auth-callback'
    );

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Connect to database
    dbClient = new Client({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
    await dbClient.connect();

    // Create or update user in database
    const userResult = await dbClient.query(`
      INSERT INTO users (google_id, email, name, picture, last_login)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (google_id) 
      DO UPDATE SET 
        name = $3,
        picture = $4,
        last_login = NOW()
      RETURNING id, email, name, picture;
    `, [userInfo.id, userInfo.email, userInfo.name, userInfo.picture]);

    const user = userResult.rows[0];

    // Create JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie
    res.setHeader('Set-Cookie', [
      `auth_token=${token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`
    ]);

    // Redirect to dashboard
    res.redirect('/dashboard.html');

  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message,
      details: error.response?.data || null
    });
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
}

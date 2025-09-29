// api/auth-google.js
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  
  if (!clientId) {
    return res.status(500).json({ 
      error: 'Google OAuth not configured',
      missing: 'GOOGLE_CLIENT_ID environment variable'
    });
  }

  const redirectUri = 'https://grant-card-assistant.vercel.app/api/auth-callback';
  
  const googleAuthUrl = `https://accounts.google.com/oauth2/authorize?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=profile email&` +
    `access_type=offline&` +
    `prompt=select_account`;

  res.redirect(googleAuthUrl);
}

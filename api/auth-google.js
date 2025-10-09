// api/auth-google.js
export default function handler(req, res) {
  console.log('🔵 OAuth flow started');
  console.log('🔵 Request URL:', req.url);
  console.log('🔵 Request headers:', JSON.stringify(req.headers, null, 2));

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

  // Use dynamic host to support preview deployments
  const host = req.headers.host || req.headers['x-forwarded-host'];
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${host}/api/auth-callback`;

  console.log('🔵 OAuth Parameters:');
  console.log('   host:', host);
  console.log('   protocol:', protocol);
  console.log('   redirect_uri:', redirectUri);
  console.log('   redirect_uri (encoded):', encodeURIComponent(redirectUri));
  console.log('   response_type:', 'code');
  console.log('   scope:', 'profile email');
  console.log('   access_type:', 'offline');
  console.log('   prompt:', 'select_account');

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('profile email')}&` +
    `access_type=offline&` +
    `prompt=select_account`;

  console.log('🔵 Full OAuth URL:', googleAuthUrl);
  console.log('🔵 URL length:', googleAuthUrl.length);
  console.log('🔵 Redirecting to Google...');

  res.redirect(googleAuthUrl);
}

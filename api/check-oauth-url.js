// Debug endpoint to see the exact OAuth URL being generated
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || req.headers['x-forwarded-host'];
  const redirectUri = `${protocol}://${host}/api/auth-callback`;

  const scopes = [
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline`;

  res.status(200).json({
    message: 'OAuth URL configuration',
    clientId: clientId?.substring(0, 20) + '...',
    redirectUri: redirectUri,
    scopes: scopes.split(' '),
    accessType: 'offline',
    promptParameter: 'none (not set)',
    fullUrl: googleAuthUrl,
    note: 'If you still see consent screens, check Google Cloud Console OAuth settings'
  });
}

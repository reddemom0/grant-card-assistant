/**
 * Google Drive OAuth Token Generator
 *
 * This script helps you get a refresh token for Google Drive API access.
 * Run this once to authorize the app and get your refresh token.
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';

// REPLACE THESE WITH YOUR VALUES FROM GOOGLE CLOUD CONSOLE
const CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

console.log('\n' + '='.repeat(80));
console.log('🔐 Google Drive OAuth Token Generator');
console.log('='.repeat(80) + '\n');

// Validate credentials
if (CLIENT_ID === 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com' ||
    CLIENT_SECRET === 'YOUR_CLIENT_SECRET_HERE') {
  console.error('❌ ERROR: You need to edit this file and add your credentials!');
  console.error('\n📝 Steps:');
  console.error('   1. Open this file: get-google-drive-token.js');
  console.error('   2. Replace CLIENT_ID with your Client ID from Google Cloud');
  console.error('   3. Replace CLIENT_SECRET with your Client Secret');
  console.error('   4. Save the file and run again: node get-google-drive-token.js\n');
  process.exit(1);
}

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Generate authorization URL
const authorizeUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly'
  ],
  prompt: 'consent' // Force consent screen to ensure we get refresh token
});

console.log('📋 Step 1: Visit this URL to authorize the app:\n');
console.log(authorizeUrl);
console.log('\n' + '─'.repeat(80) + '\n');

// Try to open browser automatically
console.log('🌐 Opening browser automatically...\n');
const platform = process.platform;
const command = platform === 'darwin' ? 'open' :
                platform === 'win32' ? 'start' :
                'xdg-open';

exec(`${command} "${authorizeUrl}"`, (error) => {
  if (error) {
    console.log('⚠️  Could not open browser automatically. Please copy the URL above manually.\n');
  }
});

// Create HTTP server to receive callback
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.indexOf('/oauth2callback') > -1) {
      const qs = new URL(req.url, 'http://localhost:3000').searchParams;
      const code = qs.get('code');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Error: No authorization code received</h1>');
        return;
      }

      console.log('✅ Authorization code received!\n');
      console.log('🔄 Exchanging code for tokens...\n');

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      // Send success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head>
            <style>
              body {
                font-family: system-ui, -apple-system, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .success {
                background: #d4edda;
                border: 1px solid #c3e6cb;
                color: #155724;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
              }
              h1 { margin-top: 0; }
              code {
                background: #f8f9fa;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: 'Monaco', 'Menlo', monospace;
              }
            </style>
          </head>
          <body>
            <div class="success">
              <h1>✅ Authorization Successful!</h1>
              <p>You can close this window and return to your terminal.</p>
            </div>
            <p>The credentials have been printed in your terminal. Copy them to Railway.</p>
          </body>
        </html>
      `);

      // Close server
      server.close();

      // Print credentials
      console.log('\n' + '='.repeat(80));
      console.log('✅ SUCCESS! Copy these to Railway environment variables:');
      console.log('='.repeat(80) + '\n');

      console.log('GOOGLE_DRIVE_CLIENT_ID=' + CLIENT_ID);
      console.log('GOOGLE_DRIVE_CLIENT_SECRET=' + CLIENT_SECRET);
      console.log('GOOGLE_DRIVE_REFRESH_TOKEN=' + tokens.refresh_token);

      console.log('\n' + '='.repeat(80));
      console.log('📝 Next Steps:');
      console.log('='.repeat(80) + '\n');
      console.log('1. Go to Railway dashboard: https://railway.app/');
      console.log('2. Select your project: grant-card-assistant-production');
      console.log('3. Click "Variables" tab');
      console.log('4. Add the three variables above');
      console.log('5. Click "Deploy" (Railway will auto-redeploy)');
      console.log('6. Test by asking agent to read a Google Drive file\n');

      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Error: ' + error.message + '</h1>');
    server.close();
    process.exit(1);
  }
});

// Start server
server.listen(3000, () => {
  console.log('📡 Waiting for authorization...');
  console.log('   (Server running on http://localhost:3000)\n');
  console.log('💡 After authorizing in your browser, you\'ll be redirected back here.\n');
});

// Handle timeout
setTimeout(() => {
  console.log('\n⏱️  Timeout: No authorization received after 5 minutes.');
  console.log('   If you need more time, just run the script again.\n');
  server.close();
  process.exit(1);
}, 5 * 60 * 1000); // 5 minutes

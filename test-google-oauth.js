/**
 * Test Google Drive OAuth Credentials
 *
 * This script tests if your OAuth refresh token is valid
 * and can access Google Drive files.
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

console.log('\n' + '='.repeat(80));
console.log('🔍 Testing Google Drive OAuth Credentials');
console.log('='.repeat(80) + '\n');

// Check if credentials are set
if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('❌ ERROR: Missing credentials in .env file');
  console.log('\nRequired environment variables:');
  console.log(`  GOOGLE_DRIVE_CLIENT_ID: ${CLIENT_ID ? '✓ Set' : '✗ Missing'}`);
  console.log(`  GOOGLE_DRIVE_CLIENT_SECRET: ${CLIENT_SECRET ? '✓ Set' : '✗ Missing'}`);
  console.log(`  GOOGLE_DRIVE_REFRESH_TOKEN: ${REFRESH_TOKEN ? '✓ Set' : '✗ Missing'}`);
  process.exit(1);
}

console.log('✓ All credentials present\n');

// Test OAuth2 client
try {
  console.log('🔧 Creating OAuth2 client...');
  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: REFRESH_TOKEN
  });

  console.log('✓ OAuth2 client created\n');

  // Test 1: Get new access token
  console.log('🔄 Test 1: Refreshing access token...');
  const { credentials } = await oauth2Client.refreshAccessToken();
  console.log('✓ Successfully got new access token');
  console.log(`   Token expires in: ${credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'unknown'}\n`);

  // Test 2: Try to access Google Drive
  console.log('🔄 Test 2: Accessing Google Drive API...');
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const response = await drive.files.list({
    pageSize: 5,
    fields: 'files(id, name, mimeType)'
  });

  console.log('✓ Successfully accessed Google Drive');
  console.log(`   Found ${response.data.files.length} files:\n`);

  response.data.files.forEach((file, i) => {
    console.log(`   ${i + 1}. ${file.name} (${file.mimeType})`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ SUCCESS: OAuth credentials are working correctly!');
  console.log('='.repeat(80) + '\n');

  console.log('📝 The credentials in Railway should work for reading Google Drive files.');
  console.log('   Make sure the files you\'re trying to access are:');
  console.log('   1. Shared with the Google account that authorized the app');
  console.log('   2. OR publicly accessible with "Anyone with the link"\n');

} catch (error) {
  console.error('\n' + '='.repeat(80));
  console.error('❌ ERROR: OAuth test failed');
  console.error('='.repeat(80) + '\n');

  console.error('Error type:', error.code || error.message);
  console.error('Details:', error.message);

  if (error.code === 'invalid_grant' || error.message.includes('invalid_grant')) {
    console.error('\n⚠️  DIAGNOSIS: Refresh token is invalid or expired');
    console.error('\n📝 SOLUTION: Generate a new refresh token');
    console.error('   Run: node get-google-drive-token.js');
    console.error('   Then update Railway environment variables with new token\n');
  } else if (error.message.includes('unauthorized_client')) {
    console.error('\n⚠️  DIAGNOSIS: OAuth app not properly configured');
    console.error('\n📝 SOLUTION: Check Google Cloud Console');
    console.error('   1. Go to: https://console.cloud.google.com/apis/credentials');
    console.error('   2. Find your OAuth 2.0 Client ID');
    console.error('   3. Verify redirect URI includes: http://localhost:3000/oauth2callback');
    console.error('   4. Verify scopes include: drive.readonly, documents.readonly\n');
  }

  process.exit(1);
}

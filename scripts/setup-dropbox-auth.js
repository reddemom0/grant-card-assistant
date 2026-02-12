/**
 * Dropbox Authentication Setup Helper
 *
 * Generates the OAuth URL and helps you get refresh tokens for Dropbox API access.
 *
 * Usage:
 *   1. Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET in .env
 *   2. Run: node scripts/setup-dropbox-auth.js
 *   3. Follow instructions to get tokens
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;

console.log('\n' + '█'.repeat(80));
console.log('🔐 Dropbox OAuth Setup');
console.log('█'.repeat(80));
console.log('');

// Check if credentials are set
if (!APP_KEY || !APP_SECRET) {
  console.log('❌ Missing Dropbox credentials in .env file\n');
  console.log('📋 SETUP INSTRUCTIONS:');
  console.log('─'.repeat(80));
  console.log('');
  console.log('1. Go to: https://www.dropbox.com/developers/apps');
  console.log('2. Create a new app (or use existing)');
  console.log('   - API: Scoped access');
  console.log('   - Access type: Full Dropbox (or App folder)');
  console.log('   - Name: Grant Card Assistant Oracle');
  console.log('');
  console.log('3. Go to Permissions tab, enable:');
  console.log('   ✓ files.metadata.read');
  console.log('   ✓ files.content.read');
  console.log('   ✓ sharing.read (if using team folders)');
  console.log('   Click "Submit"');
  console.log('');
  console.log('4. Go to Settings tab, copy:');
  console.log('   - App key');
  console.log('   - App secret');
  console.log('');
  console.log('5. Add to your .env file:');
  console.log('   DROPBOX_APP_KEY=your_app_key_here');
  console.log('   DROPBOX_APP_SECRET=your_app_secret_here');
  console.log('');
  console.log('6. Run this script again');
  console.log('');
  process.exit(1);
}

console.log('✓ App credentials found\n');

// Generate OAuth URL
const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${APP_KEY}&response_type=code&token_access_type=offline`;

console.log('📋 STEP 1: Authorize the app');
console.log('─'.repeat(80));
console.log('');
console.log('1. Open this URL in your browser:');
console.log('');
console.log(authUrl);
console.log('');
console.log('2. Sign in to Dropbox and authorize the app');
console.log('3. You\'ll be redirected to a page with an authorization code');
console.log('4. Copy the entire code (it\'ll look like: aBcDeFgHiJkLmNoPqRsTuVwXyZ123456)');
console.log('');
console.log('─'.repeat(80));
console.log('');
console.log('📋 STEP 2: Exchange code for tokens');
console.log('─'.repeat(80));
console.log('');
console.log('Once you have the code, run:');
console.log('');
console.log('curl -X POST https://api.dropbox.com/oauth2/token \\');
console.log(`  -d grant_type=authorization_code \\`);
console.log(`  -d code=YOUR_AUTH_CODE_HERE \\`);
console.log(`  -d client_id=${APP_KEY} \\`);
console.log(`  -d client_secret=${APP_SECRET}`);
console.log('');
console.log('Or use this simplified version:');
console.log('');
console.log(`node -e "fetch('https://api.dropbox.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: 'YOUR_AUTH_CODE_HERE', client_id: '${APP_KEY}', client_secret: '${APP_SECRET}' }) }).then(r => r.json()).then(console.log)"`);
console.log('');
console.log('─'.repeat(80));
console.log('');
console.log('📋 STEP 3: Save tokens');
console.log('─'.repeat(80));
console.log('');
console.log('From the response, copy access_token and refresh_token to .env:');
console.log('');
console.log('DROPBOX_ACCESS_TOKEN=your_access_token_here');
console.log('DROPBOX_REFRESH_TOKEN=your_refresh_token_here');
console.log('');
console.log('─'.repeat(80));
console.log('');
console.log('📋 STEP 4: Configure folder path');
console.log('─'.repeat(80));
console.log('');
console.log('Add the path to your Oracle KB folder:');
console.log('');
console.log('DROPBOX_ORACLE_KB_PATH=/Oracle KB');
console.log('');
console.log('(Or use / for root if you have a namespace configured)');
console.log('');
console.log('─'.repeat(80));
console.log('');
console.log('✅ Once setup is complete, run:');
console.log('   node scripts/analyze-dropbox-folders.js');
console.log('');

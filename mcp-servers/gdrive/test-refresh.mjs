import { google } from 'googleapis';
import fs from 'fs';

const oauthKeys = JSON.parse(fs.readFileSync('./credentials/gcp-oauth.keys.json', 'utf-8'));
const credentials = JSON.parse(fs.readFileSync('./credentials/.gdrive-server-credentials.json', 'utf-8'));

const { client_id, client_secret, redirect_uris } = oauthKeys.installed;
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oauth2Client.setCredentials(credentials);

console.log('🧪 Testing token refresh...');
console.log('📅 Expiry:', new Date(credentials.expiry_date).toISOString());

const drive = google.drive({ version: 'v3', auth: oauth2Client });

try {
  const res = await drive.files.list({
    pageSize: 10,
    fields: 'files(id, name, mimeType)',
    q: "fullText contains 'ETG' or fullText contains 'training'"
  });
  console.log('\n✅ SUCCESS! Found', res.data.files.length, 'files with ETG/training:');
  res.data.files.forEach(file => {
    console.log('-', file.name, `(${file.mimeType})`);
  });
} catch (err) {
  console.error('\n❌ ERROR:', err.message);
  console.error('Code:', err.code);
  console.error('Details:', err.errors?.[0]?.message || 'No additional details');
}

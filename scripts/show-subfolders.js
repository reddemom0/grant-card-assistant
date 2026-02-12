/**
 * Show subfolders in a Dropbox path
 */

import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

async function refreshAccessToken() {
  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
      client_id: process.env.DROPBOX_APP_KEY,
      client_secret: process.env.DROPBOX_APP_SECRET,
    }),
  });

  const data = await response.json();
  return data.access_token;
}

async function showSubfolders(folderPath) {
  console.log(`\n📂 Subfolders in: ${folderPath}\n`);
  console.log('='.repeat(80));

  try {
    const accessToken = await refreshAccessToken();

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Dropbox-API-Path-Root': `{".tag": "namespace_id", "namespace_id": "${process.env.DROPBOX_NAMESPACE_ID}"}`
    };

    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: folderPath,
        recursive: false,
        include_deleted: false
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Dropbox API error: ${error.error_summary || response.statusText}`);
    }

    const data = await response.json();
    const folders = data.entries.filter(entry => entry['.tag'] === 'folder');
    const files = data.entries.filter(entry => entry['.tag'] === 'file');

    console.log(`\nFound ${folders.length} folders and ${files.length} files\n`);

    if (folders.length > 0) {
      console.log('📁 FOLDERS:');
      console.log('-'.repeat(80));
      folders.forEach(folder => {
        console.log(`   ${folder.name}/`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Done!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

const folderPath = process.argv[2] || '/Granted Team Folder/Sales/Grants';
showSubfolders(folderPath);

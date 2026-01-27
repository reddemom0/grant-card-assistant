/**
 * Test BCAFE Knowledge Base Access
 * Verifies the 2026 program guide is accessible via Google Drive
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

console.log('\n🔍 BCAFE Knowledge Base Access Test\n');
console.log('='.repeat(60));

/**
 * Initialize Google Drive API client
 */
function getDriveClient() {
  const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment');
  }

  const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  return google.drive({ version: 'v3', auth });
}

/**
 * Search for a folder by path
 */
async function findFolderByPath(drive, parentId, folderName) {
  const query = parentId
    ? `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    : `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    pageSize: 10
  });

  return response.data.files?.[0] || null;
}

/**
 * List files in a folder
 */
async function listFilesInFolder(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: 100
  });

  return response.data.files || [];
}

async function testBCAFEAccess() {
  try {
    const drive = getDriveClient();

    // Step 1: Find 'granted-ai-knowledge-base' folder
    console.log('\n📁 Step 1: Finding granted-ai-knowledge-base folder...');
    const kbFolder = await findFolderByPath(drive, null, 'granted-ai-knowledge-base');

    if (!kbFolder) {
      console.error('❌ Error: Could not find "granted-ai-knowledge-base" folder');
      console.log('   Make sure the Service Account has access to this folder');
      return;
    }

    console.log(`✅ Found: ${kbFolder.name} (${kbFolder.id})`);

    // Step 2: Find 'bcafe' subfolder
    console.log('\n📁 Step 2: Finding bcafe subfolder...');
    const bcafeFolder = await findFolderByPath(drive, kbFolder.id, 'bcafe');

    if (!bcafeFolder) {
      console.error('❌ Error: Could not find "bcafe" folder inside granted-ai-knowledge-base');
      return;
    }

    console.log(`✅ Found: ${bcafeFolder.name} (${bcafeFolder.id})`);

    // Step 3: List all files in BCAFE folder
    console.log('\n📄 Step 3: Listing files in BCAFE knowledge base...\n');
    const files = await listFilesInFolder(drive, bcafeFolder.id);

    if (files.length === 0) {
      console.log('⚠️  No files found in BCAFE folder');
      return;
    }

    console.log(`Found ${files.length} file(s):\n`);

    // Track if we found the 2026 program guide
    let found2026Guide = false;

    files.forEach((file, i) => {
      const modifiedDate = new Date(file.modifiedTime).toLocaleDateString();
      const sizeKB = file.size ? `${Math.round(file.size / 1024)} KB` : 'N/A';

      console.log(`${i + 1}. ${file.name}`);
      console.log(`   ID: ${file.id}`);
      console.log(`   Type: ${file.mimeType}`);
      console.log(`   Modified: ${modifiedDate}`);
      console.log(`   Size: ${sizeKB}\n`);

      // Check if this looks like the 2026 program guide
      const fileName = file.name.toLowerCase();
      if (fileName.includes('2026') && fileName.includes('program')) {
        found2026Guide = true;
        console.log(`   ✅ THIS LOOKS LIKE THE 2026 PROGRAM GUIDE!\n`);
      }
    });

    // Summary
    console.log('='.repeat(60));
    console.log('\n📊 Summary:\n');
    console.log(`✅ BCAFE knowledge base is accessible`);
    console.log(`✅ Found ${files.length} documents in the folder`);

    if (found2026Guide) {
      console.log(`✅ Found file(s) that appear to be the 2026 program guide`);
    } else {
      console.log(`⚠️  Did not find any files with "2026" and "program" in the name`);
      console.log(`   Please verify the new program guide has been uploaded`);
    }

    console.log('\n🔧 How agents access these files:');
    console.log(`   - BCAFE agent uses MCP Google Drive tools`);
    console.log(`   - Files are accessed in real-time (no indexing required)`);
    console.log(`   - Agent can use gdrive_search and gdrive_read_file tools`);

    console.log('\n✅ BCAFE Knowledge Base Access Test PASSED!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.code) console.error(`   Error code: ${error.code}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testBCAFEAccess();

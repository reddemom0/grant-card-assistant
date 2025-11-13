/**
 * Upload Granted logo to Google Drive and make it publicly accessible
 * Run with: node upload-logo.js
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGO_PATH = path.join(__dirname, 'public', 'images', 'granted-logo.png');
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

async function uploadLogoToDrive() {
  if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment');
  }

  const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  const drive = google.drive({ version: 'v3', auth });

  // Check if logo already exists
  console.log('Checking for existing logo...');
  const searchResponse = await drive.files.list({
    q: "name='granted-logo.png' and trashed=false",
    fields: 'files(id, name, webViewLink, webContentLink)',
    spaces: 'drive'
  });

  let fileId;

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    console.log('Logo already exists in Google Drive');
    fileId = searchResponse.data.files[0].id;
    console.log('File ID:', fileId);
  } else {
    // Upload the logo
    console.log('Uploading logo to Google Drive...');
    const fileMetadata = {
      name: 'granted-logo.png',
      description: 'Granted Consulting company logo for document headers'
    };

    const media = {
      mimeType: 'image/png',
      body: fs.createReadStream(LOGO_PATH)
    };

    const uploadResponse = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink'
    });

    fileId = uploadResponse.data.id;
    console.log('Logo uploaded successfully!');
    console.log('File ID:', fileId);
  }

  // Make the file publicly accessible
  console.log('Making logo publicly accessible...');
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });

  // Get the file details
  const fileResponse = await drive.files.get({
    fileId: fileId,
    fields: 'id, name, webViewLink, webContentLink, thumbnailLink'
  });

  console.log('\n✅ Logo is ready!');
  console.log('File ID:', fileResponse.data.id);
  console.log('Web View Link:', fileResponse.data.webViewLink);
  console.log('Web Content Link:', fileResponse.data.webContentLink);
  console.log('Thumbnail Link:', fileResponse.data.thumbnailLink);

  // The direct download URL that Google Docs API can use
  const directUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
  console.log('\n📋 Use this URL in your code:');
  console.log(directUrl);

  return {
    fileId,
    directUrl,
    webViewLink: fileResponse.data.webViewLink,
    webContentLink: fileResponse.data.webContentLink
  };
}

// Run the upload
uploadLogoToDrive()
  .then(result => {
    console.log('\n✨ Done! Save this URL for the logo insertion code.');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });

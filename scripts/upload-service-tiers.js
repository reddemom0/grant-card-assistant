/**
 * Upload enhanced service tiers document to Oracle's Dropbox knowledge base
 */

import { uploadFileToDropbox } from '../src/tools/dropbox.js';
import { readFileSync } from 'fs';

// Oracle KB is stored in Dropbox under /Oracle KB folder
// Department folders: Strategy, Writers, Marketing, Sales, etc.
const DROPBOX_KB_PATH = '/Oracle KB/Strategy/Granted-Service-Tiers-Enhanced-for-Qualification.md';
const SOURCE_FILE = '/Users/Chris/Downloads/Granted-Service-Tiers-Enhanced-for-Qualification.md';

async function uploadServiceTiersDocument() {
  try {
    console.log('📄 Reading service tiers document...');
    const content = readFileSync(SOURCE_FILE, 'utf8');
    console.log(`✓ Read ${content.length} characters`);

    console.log('\n📤 Uploading to Oracle knowledge base (Dropbox)...');
    console.log(`   Destination: ${DROPBOX_KB_PATH}`);

    const result = await uploadFileToDropbox(
      DROPBOX_KB_PATH,
      content,
      'overwrite' // Overwrite if exists
    );

    if (result.success) {
      console.log('\n✅ Upload successful!');
      console.log(`   File ID: ${result.file.id}`);
      console.log(`   File Name: ${result.file.name}`);
      console.log(`   File Path: ${result.file.path}`);
      console.log(`   File Size: ${result.file.size} bytes`);
      console.log(`\n🎯 Oracle can now access this document from its knowledge base.`);
      console.log(`\n⚠️  Next step: Run the indexer to make it searchable:`);
      console.log(`   railway run node scripts/index-dropbox-kb.js`);
    } else {
      console.error('\n❌ Upload failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

uploadServiceTiersDocument();

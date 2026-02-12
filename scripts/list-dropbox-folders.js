/**
 * Quick Dropbox Folder Listing
 * Shows folder structure for user to choose what to index
 */

import { listDropboxFolder } from '../src/tools/dropbox.js';

async function listFolders() {
  console.log('\n📂 DROPBOX FOLDER STRUCTURE\n');
  console.log('=' .repeat(80));

  try {
    // List root level folders
    const rootPath = process.env.DROPBOX_ORACLE_KB_PATH || '/';
    console.log(`\nRoot path: ${rootPath}\n`);

    const items = await listDropboxFolder(rootPath, false); // non-recursive

    const folders = items.filter(item => item['.tag'] === 'folder');
    const files = items.filter(item => item['.tag'] === 'file');

    console.log(`Found ${folders.length} folders and ${files.length} files at root level\n`);

    if (folders.length > 0) {
      console.log('📁 FOLDERS:');
      console.log('-'.repeat(80));

      for (const folder of folders) {
        const folderPath = folder.path_display;
        console.log(`\n  ${folder.name}/`);

        // List contents of each top-level folder
        try {
          const subItems = await listDropboxFolder(folderPath, false);
          const subFolders = subItems.filter(item => item['.tag'] === 'folder');
          const subFiles = subItems.filter(item => item['.tag'] === 'file');

          console.log(`    → ${subFolders.length} subfolders, ${subFiles.length} files`);

          // Show subfolder names
          if (subFolders.length > 0 && subFolders.length <= 10) {
            subFolders.forEach(sub => {
              console.log(`      └─ ${sub.name}/`);
            });
          } else if (subFolders.length > 10) {
            subFolders.slice(0, 5).forEach(sub => {
              console.log(`      └─ ${sub.name}/`);
            });
            console.log(`      ... and ${subFolders.length - 5} more`);
          }
        } catch (err) {
          console.log(`    ⚠️  Could not list contents: ${err.message}`);
        }
      }
    }

    if (files.length > 0) {
      console.log('\n📄 FILES AT ROOT:');
      console.log('-'.repeat(80));
      files.forEach(file => {
        const sizeMB = (file.size / 1024 / 1024).toFixed(2);
        console.log(`  ${file.name} (${sizeMB} MB)`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Folder listing complete!');
    console.log('\nNext: Share which folders you want to index for the Oracle KB\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listFolders();

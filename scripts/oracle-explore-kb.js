/**
 * Oracle Knowledge Base Explorer
 *
 * Explores the Oracle KB folder structure and generates a report on:
 * - Department folders and document counts
 * - File types distribution
 * - Total documents to index
 */

import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Oracle KB Folder ID
const ORACLE_FOLDER_ID = '1Dn0bqabKU1Z7NLKrFUOhR18vXxnYhEev';

/**
 * Initialize Google Drive API client using existing auth method
 */
function getDriveClient() {
  // Use Service Account credentials from environment
  const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in environment. Make sure .env is configured.');
  }

  try {
    const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);

    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });

    return google.drive({ version: 'v3', auth });
  } catch (error) {
    throw new Error(`Failed to parse Google Service Account credentials: ${error.message}`);
  }
}

/**
 * List all folders in the Oracle KB
 */
async function listDepartmentFolders(drive) {
  console.log('\n📁 Scanning department folders...\n');

  const response = await drive.files.list({
    q: `'${ORACLE_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name'
  });

  return response.data.files || [];
}

/**
 * Count documents in a folder (including shortcuts)
 */
async function countDocumentsInFolder(drive, folderId, folderName) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name, mimeType, shortcutDetails)',
    pageSize: 1000
  });

  const files = response.data.files || [];

  // Count file types
  const typeCount = {};
  let shortcutCount = 0;

  files.forEach(file => {
    if (file.shortcutDetails) {
      shortcutCount++;
    }

    const mimeType = file.mimeType;
    typeCount[mimeType] = (typeCount[mimeType] || 0) + 1;
  });

  return {
    total: files.length,
    shortcuts: shortcutCount,
    types: typeCount,
    files: files.slice(0, 10) // Sample of first 10 files
  };
}

/**
 * Main exploration function
 */
async function exploreKnowledgeBase() {
  console.log('🔍 Oracle Knowledge Base Explorer');
  console.log('='.repeat(80));

  try {
    const drive = getDriveClient();

    // Get department folders
    const departments = await listDepartmentFolders(drive);

    console.log(`✓ Found ${departments.length} department folders:\n`);

    let grandTotal = 0;
    const departmentStats = [];

    // Analyze each department
    for (const dept of departments) {
      console.log(`📊 Analyzing: ${dept.name}...`);
      const stats = await countDocumentsInFolder(drive, dept.id, dept.name);

      grandTotal += stats.total;
      departmentStats.push({
        name: dept.name,
        id: dept.id,
        ...stats
      });

      console.log(`   ✓ ${stats.total} documents (${stats.shortcuts} shortcuts)`);
    }

    // Print detailed report
    console.log('\n' + '='.repeat(80));
    console.log('📈 KNOWLEDGE BASE REPORT');
    console.log('='.repeat(80) + '\n');

    console.log(`Total Documents: ${grandTotal}\n`);

    // Department breakdown
    console.log('Department Breakdown:');
    console.log('-'.repeat(80));
    departmentStats.forEach(dept => {
      console.log(`\n${dept.name}:`);
      console.log(`  Total: ${dept.total} files`);
      console.log(`  Shortcuts: ${dept.shortcuts}`);
      console.log(`  File Types:`);

      // Sort by count
      const sortedTypes = Object.entries(dept.types)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5); // Top 5 types

      sortedTypes.forEach(([type, count]) => {
        const shortType = type.split('.').pop().split('/').pop();
        console.log(`    - ${shortType}: ${count}`);
      });

      console.log(`  Sample Files:`);
      dept.files.slice(0, 3).forEach(file => {
        const indicator = file.shortcutDetails ? ' [shortcut]' : '';
        console.log(`    - ${file.name}${indicator}`);
      });
    });

    console.log('\n' + '='.repeat(80));
    console.log('💡 Recommendations:');
    console.log('='.repeat(80) + '\n');

    if (grandTotal < 200) {
      console.log('✅ Document count is manageable (<200)');
      console.log('   → Can use simple metadata + keyword search');
      console.log('   → Embeddings optional but would improve accuracy');
    } else if (grandTotal < 500) {
      console.log('⚠️  Document count is moderate (200-500)');
      console.log('   → Recommend metadata + keyword search for MVP');
      console.log('   → Add embeddings in phase 2');
    } else {
      console.log('🚨 Document count is high (500+)');
      console.log('   → Embeddings strongly recommended');
      console.log('   → Consider chunking for large documents');
    }

    console.log('\n📋 Next Steps:');
    console.log('   1. Generate metadata for all documents');
    console.log('   2. Store metadata in Redis');
    console.log('   3. Build search function');
    console.log('   4. Create Oracle agent');

    console.log('\n✅ Exploration complete!\n');

    // Return stats for programmatic use
    return {
      total: grandTotal,
      departments: departmentStats
    };

  } catch (error) {
    console.error('❌ Error exploring knowledge base:', error.message);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exploreKnowledgeBase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

export { exploreKnowledgeBase };

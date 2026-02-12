/**
 * Analyze Dropbox folder with smart filtering
 * Filters out: old files (pre-2021), videos, images, huge files
 */

import { listDropboxFolder } from '../src/tools/dropbox.js';

const FOLDER_PATH = process.argv[2] || '/Granted Team Folder/Sales/Grants';
const MIN_YEAR = 2023; // Only files from 2023 onward (most current)
const MAX_FILE_SIZE_MB = 50; // Skip files larger than 50MB

function isIndexable(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv'].some(e => filename.toLowerCase().endsWith(e));
}

function getFileYear(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.getFullYear();
}

async function analyzeWithFilters(folderPath) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 SMART DROPBOX ANALYSIS (WITH FILTERS)');
  console.log('='.repeat(80));
  console.log(`\n📂 Folder: ${folderPath}`);
  console.log(`📅 Filter: Files from ${MIN_YEAR} onwards`);
  console.log(`📏 Filter: Max file size ${MAX_FILE_SIZE_MB}MB`);
  console.log(`📄 Filter: Only indexable formats (PDF, DOCX, TXT, MD, CSV)\n`);

  try {
    console.log('🔍 Scanning... (this may take 1-2 minutes for large folders)\n');

    const result = await listDropboxFolder(folderPath, true);

    if (!result || !result.files || result.files.length === 0) {
      console.log('❌ No items found');
      return;
    }

    const files = result.files; // Already filtered to files only by listDropboxFolder
    console.log(`✅ Found ${files.length} total files\n`);
    console.log('📊 Applying filters...\n');

    // Categorize files
    const stats = {
      goodToIndex: [],
      tooOld: [],
      tooLarge: [],
      wrongFormat: [],
      noDate: []
    };

    files.forEach(file => {
      const sizeMB = file.size / 1024 / 1024;
      const year = getFileYear(file.modified);

      // Check if indexable format
      if (!isIndexable(file.name)) {
        stats.wrongFormat.push({ ...file, sizeMB, year });
        return;
      }

      // Check file size
      if (sizeMB > MAX_FILE_SIZE_MB) {
        stats.tooLarge.push({ ...file, sizeMB, year });
        return;
      }

      // Check year
      if (!year) {
        stats.noDate.push({ ...file, sizeMB, year: 'unknown' });
        return;
      }

      if (year < MIN_YEAR) {
        stats.tooOld.push({ ...file, sizeMB, year });
        return;
      }

      // Good to index!
      stats.goodToIndex.push({ ...file, sizeMB, year });
    });

    // Display results
    console.log('='.repeat(80));
    console.log('✅ INDEXABLE FILES (2021+, <50MB, good format)');
    console.log('='.repeat(80));
    console.log(`\n📄 Count: ${stats.goodToIndex.length} files`);

    if (stats.goodToIndex.length > 0) {
      const totalSizeMB = stats.goodToIndex.reduce((sum, f) => sum + f.sizeMB, 0);
      console.log(`💾 Total size: ${totalSizeMB.toFixed(2)} MB`);

      // Group by year
      const byYear = {};
      stats.goodToIndex.forEach(f => {
        if (!byYear[f.year]) byYear[f.year] = [];
        byYear[f.year].push(f);
      });

      console.log('\n📅 By year:');
      Object.keys(byYear).sort().reverse().forEach(year => {
        const count = byYear[year].length;
        const size = byYear[year].reduce((sum, f) => sum + f.sizeMB, 0);
        console.log(`   ${year}: ${count} files (${size.toFixed(2)} MB)`);
      });

      // Group by extension
      const byExt = {};
      stats.goodToIndex.forEach(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        if (!byExt[ext]) byExt[ext] = [];
        byExt[ext].push(f);
      });

      console.log('\n📋 By format:');
      Object.entries(byExt).forEach(([ext, files]) => {
        const size = files.reduce((sum, f) => sum + f.sizeMB, 0);
        console.log(`   .${ext}: ${files.length} files (${size.toFixed(2)} MB)`);
      });

      // Show samples
      console.log('\n📝 Sample files:');
      stats.goodToIndex.slice(0, 10).forEach(f => {
        console.log(`   • ${f.name} (${f.year}, ${f.sizeMB.toFixed(2)} MB)`);
      });
      if (stats.goodToIndex.length > 10) {
        console.log(`   ... and ${stats.goodToIndex.length - 10} more`);
      }
    }

    // Show filtered out files
    console.log('\n' + '='.repeat(80));
    console.log('🚫 FILTERED OUT (Will NOT be indexed)');
    console.log('='.repeat(80));

    if (stats.tooOld.length > 0) {
      console.log(`\n⏰ Too old (pre-${MIN_YEAR}): ${stats.tooOld.length} files`);
      console.log(`   Saves: ~$${(stats.tooOld.length * 0.0035).toFixed(2)}`);
    }

    if (stats.tooLarge.length > 0) {
      const totalSize = stats.tooLarge.reduce((sum, f) => sum + f.sizeMB, 0);
      console.log(`\n📦 Too large (>${MAX_FILE_SIZE_MB}MB): ${stats.tooLarge.length} files (${totalSize.toFixed(2)} MB total)`);
      console.log(`   These would be expensive to process`);
      stats.tooLarge.slice(0, 5).forEach(f => {
        console.log(`   • ${f.name} (${f.sizeMB.toFixed(2)} MB)`);
      });
    }

    if (stats.wrongFormat.length > 0) {
      console.log(`\n🎬 Wrong format (not indexable): ${stats.wrongFormat.length} files`);

      // Show breakdown by extension
      const byExt = {};
      stats.wrongFormat.forEach(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        if (!byExt[ext]) byExt[ext] = 0;
        byExt[ext]++;
      });

      console.log(`   Breakdown by extension:`);
      Object.entries(byExt).sort((a, b) => b[1] - a[1]).forEach(([ext, count]) => {
        console.log(`      .${ext}: ${count} files`);
      });
    }

    if (stats.noDate.length > 0) {
      console.log(`\n❓ No date info: ${stats.noDate.length} files`);
    }

    // Cost estimate
    console.log('\n' + '='.repeat(80));
    console.log('💰 COST ESTIMATE');
    console.log('='.repeat(80));

    const indexableCount = stats.goodToIndex.length;
    const estimatedChunks = Math.ceil(indexableCount * 1.2); // Avg 1.2 chunks per file

    const claudeCost = estimatedChunks * 0.0025;
    const voyageCost = estimatedChunks * 0.001;
    const totalCost = claudeCost + voyageCost;

    console.log(`\n📄 Indexable files: ${indexableCount}`);
    console.log(`📑 Estimated chunks: ~${estimatedChunks}`);
    console.log(`\n💵 One-time indexing cost:`);
    console.log(`   Claude Haiku (summaries): $${claudeCost.toFixed(4)}`);
    console.log(`   Voyage AI (embeddings): $${voyageCost.toFixed(4)}`);
    console.log(`   ───────────────────────────`);
    console.log(`   TOTAL: $${totalCost.toFixed(2)}`);

    console.log(`\n📊 Ongoing search cost: ~$0.30 per 1000 queries`);

    // Savings
    const filteredCount = stats.tooOld.length + stats.tooLarge.length + stats.wrongFormat.length;
    const savedCost = filteredCount * 0.0035;
    if (filteredCount > 0) {
      console.log(`\n💡 Filters saved: ~$${savedCost.toFixed(2)} (excluded ${filteredCount} files)`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Analysis complete!');
    console.log('='.repeat(80));
    console.log(`\nNext step: If cost looks good, run the RAG indexer:\n`);
    console.log(`railway run node scripts/index-dropbox-rag.js --path "${folderPath}" --year ${MIN_YEAR}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

analyzeWithFilters(FOLDER_PATH);

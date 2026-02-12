/**
 * Oracle Search Evaluation Framework
 *
 * Measures search quality using Precision, Recall, F1, and MRR
 * Compares keyword search vs RAG search
 */

import { searchOracleKnowledgeBase } from '../src/tools/oracle-search.js';
import { searchOracleHybrid } from '../src/tools/oracle-search-rag.js';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Test dataset
 * Each test has:
 * - query: Search query
 * - correctFileNames: Array of file names that SHOULD be returned
 * - department: Expected department (optional)
 */
const testDataset = [
  {
    query: "ETG business case template for manufacturing",
    correctFileNames: ["ETG Business Case Template.docx", "ETG Manufacturing Example.pdf"],
    department: "Writers"
  },
  {
    query: "How to price grant writing services",
    correctFileNames: ["Pricing Guide 2024.pdf", "Discovery Call Script.docx"],
    department: "Strategy"
  },
  {
    query: "CanExport SME eligibility requirements",
    correctFileNames: ["CanExport SME Program Guide.pdf", "CanExport Eligibility Checklist.xlsx"],
    department: "Writers"
  },
  {
    query: "Marketing content calendar template",
    correctFileNames: ["2024 Content Calendar.xlsx", "Webinar Planning Template.docx"],
    department: "Marketing"
  },
  {
    query: "Brand guidelines and logo usage",
    correctFileNames: ["Granted Brand Guidelines.pdf", "Logo Assets.zip"],
    department: "GCs"
  },
  // Add more test cases as you identify common search patterns
];

/**
 * Calculate precision, recall, F1
 * @param {Array<string>} retrieved - File names retrieved by search
 * @param {Array<string>} correct - File names that should have been retrieved
 */
function calculateMetrics(retrieved, correct) {
  const retrievedSet = new Set(retrieved);
  const correctSet = new Set(correct);

  // True positives: documents that were correctly retrieved
  const truePositives = [...retrievedSet].filter(doc => correctSet.has(doc)).length;

  // Precision: % of retrieved documents that are correct
  const precision = retrieved.length > 0 ? truePositives / retrieved.length : 0;

  // Recall: % of correct documents that were retrieved
  const recall = correct.length > 0 ? truePositives / correct.length : 0;

  // F1: Harmonic mean of precision and recall
  const f1 = (precision + recall) > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;

  return { precision, recall, f1, truePositives };
}

/**
 * Calculate Mean Reciprocal Rank (MRR)
 * @param {Array<string>} retrieved - Ordered list of retrieved file names
 * @param {Array<string>} correct - Correct file names
 */
function calculateMRR(retrieved, correct) {
  const correctSet = new Set(correct);

  // Find rank of first correct result
  for (let i = 0; i < retrieved.length; i++) {
    if (correctSet.has(retrieved[i])) {
      return 1 / (i + 1); // Rank is 1-indexed
    }
  }

  return 0; // No correct results found
}

/**
 * Evaluate a single search method
 * @param {string} method - 'keyword' or 'rag'
 * @param {Function} searchFunc - Search function to test
 */
async function evaluateSearchMethod(method, searchFunc) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Evaluating: ${method.toUpperCase()} Search`);
  console.log('='.repeat(80));

  const results = [];
  let totalPrecision = 0;
  let totalRecall = 0;
  let totalF1 = 0;
  let totalMRR = 0;

  for (const test of testDataset) {
    console.log(`\n🔍 Query: "${test.query}"`);

    try {
      // Execute search
      const searchResults = await searchFunc(test.query, {
        department: test.department,
        limit: 10
      });

      // Extract file names from results
      const retrievedFileNames = searchResults.map(r => r.fileName);

      console.log(`   Retrieved: ${retrievedFileNames.slice(0, 3).join(', ')}${retrievedFileNames.length > 3 ? '...' : ''}`);
      console.log(`   Expected: ${test.correctFileNames.join(', ')}`);

      // Calculate metrics
      const metrics = calculateMetrics(retrievedFileNames, test.correctFileNames);
      const mrr = calculateMRR(retrievedFileNames, test.correctFileNames);

      console.log(`   Precision: ${(metrics.precision * 100).toFixed(1)}%`);
      console.log(`   Recall: ${(metrics.recall * 100).toFixed(1)}%`);
      console.log(`   F1: ${(metrics.f1 * 100).toFixed(1)}%`);
      console.log(`   MRR: ${mrr.toFixed(3)}`);

      totalPrecision += metrics.precision;
      totalRecall += metrics.recall;
      totalF1 += metrics.f1;
      totalMRR += mrr;

      results.push({
        query: test.query,
        ...metrics,
        mrr
      });

    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      results.push({
        query: test.query,
        precision: 0,
        recall: 0,
        f1: 0,
        mrr: 0,
        error: error.message
      });
    }

    // Rate limit pause
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Calculate averages
  const avgPrecision = totalPrecision / testDataset.length;
  const avgRecall = totalRecall / testDataset.length;
  const avgF1 = totalF1 / testDataset.length;
  const avgMRR = totalMRR / testDataset.length;

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📈 ${method.toUpperCase()} AVERAGE METRICS`);
  console.log('─'.repeat(80));
  console.log(`Avg Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`Avg Recall: ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`Avg F1 Score: ${(avgF1 * 100).toFixed(1)}%`);
  console.log(`Avg MRR: ${avgMRR.toFixed(3)}`);

  return {
    method,
    avgPrecision,
    avgRecall,
    avgF1,
    avgMRR,
    results
  };
}

/**
 * Main evaluation function
 */
async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('🔬 Oracle Search Evaluation');
  console.log('█'.repeat(80));
  console.log(`Test queries: ${testDataset.length}\n`);

  try {
    // Check if RAG is available
    const ragEnabled = await redis.hget('oracle:stats', 'ragEnabled');

    if (ragEnabled !== 'true') {
      console.warn('⚠️  RAG not enabled. Run index-dropbox-rag.js first.');
      console.warn('   Evaluating keyword search only.\n');
    }

    // Evaluate keyword search (baseline)
    const keywordResults = await evaluateSearchMethod('keyword', searchOracleKnowledgeBase);

    // Evaluate RAG search (if available)
    let ragResults = null;
    if (ragEnabled === 'true') {
      ragResults = await evaluateSearchMethod('rag', async (query, options) => {
        return await searchOracleHybrid(query, { ...options, dropboxOnly: true });
      });
    }

    // Comparison
    if (ragResults) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('🏆 COMPARISON: Keyword vs RAG');
      console.log('='.repeat(80));
      console.log(`                  Keyword      RAG         Improvement`);
      console.log('─'.repeat(80));

      const precisionDiff = (ragResults.avgPrecision - keywordResults.avgPrecision) * 100;
      const recallDiff = (ragResults.avgRecall - keywordResults.avgRecall) * 100;
      const f1Diff = (ragResults.avgF1 - keywordResults.avgF1) * 100;
      const mrrDiff = ragResults.avgMRR - keywordResults.avgMRR;

      console.log(`Precision:        ${(keywordResults.avgPrecision * 100).toFixed(1)}%       ${(ragResults.avgPrecision * 100).toFixed(1)}%      ${precisionDiff > 0 ? '+' : ''}${precisionDiff.toFixed(1)}%`);
      console.log(`Recall:           ${(keywordResults.avgRecall * 100).toFixed(1)}%       ${(ragResults.avgRecall * 100).toFixed(1)}%      ${recallDiff > 0 ? '+' : ''}${recallDiff.toFixed(1)}%`);
      console.log(`F1 Score:         ${(keywordResults.avgF1 * 100).toFixed(1)}%       ${(ragResults.avgF1 * 100).toFixed(1)}%      ${f1Diff > 0 ? '+' : ''}${f1Diff.toFixed(1)}%`);
      console.log(`MRR:              ${keywordResults.avgMRR.toFixed(3)}      ${ragResults.avgMRR.toFixed(3)}     ${mrrDiff > 0 ? '+' : ''}${mrrDiff.toFixed(3)}`);

      console.log('\n');

      if (ragResults.avgF1 > keywordResults.avgF1) {
        const improvement = ((ragResults.avgF1 / keywordResults.avgF1 - 1) * 100).toFixed(1);
        console.log(`✅ RAG improved F1 score by ${improvement}%`);
      } else {
        console.log(`⚠️  RAG did not outperform keyword search on this dataset`);
      }
    }

    console.log('\n✅ Evaluation complete!\n');

  } catch (error) {
    console.error('\n❌ Evaluation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main()
  .then(() => {
    redis.disconnect();
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    redis.disconnect();
    process.exit(1);
  });

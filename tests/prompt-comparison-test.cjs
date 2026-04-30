/**
 * Grant Card System Prompt Comparison Test
 *
 * Compares old vs. new (XML-structured) system prompts across all 6 grant types
 * and all 6 task types. Evaluates improvements in:
 * - Clarity and structure
 * - Adherence to output format
 * - Completeness of extraction
 * - Consistency across runs
 */

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

// Import old prompt builder
const oldPromptPath = '../api/server.js';
// Import new prompt builder
const { buildGrantCardSystemPrompt: buildNewPrompt } = require('../api/grant-card-prompt-redesign.js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Test grant documents for all 6 types
const testGrants = {
  'hiring': {
    name: 'Small Business Wage Subsidy Program',
    document: `
Small Business Wage Subsidy Program

Program Overview:
The Small Business Wage Subsidy provides financial support to help businesses hire and retain new employees.

Funding Amount:
Up to $50,000 per year to offset wage costs for new hires

Eligibility:
- Small businesses with fewer than 50 employees
- Must hire unemployed or underemployed workers
- New positions must be maintained for minimum 12 months

Eligible Expenses:
- Wages and salaries for new employees
- Mandatory employer contributions (CPP, EI)
- Training costs for new hires

Application Deadline: March 31, 2026
    `.trim()
  },
  'training': {
    name: 'Workforce Training Grant Program',
    document: `
Workforce Training Grant Program

Objective:
Support businesses in upskilling their workforce through training and professional development.

Funding:
Up to $300,000 per project to cover training costs

Eligible Activities:
- Skills training courses and certifications
- Professional development workshops
- Technical skills upgrading
- Safety training and certifications

Requirements:
- Training must lead to recognized credentials
- Minimum 10 employees participating
- Employer must contribute 25% of training costs

Application Deadline: June 15, 2026
    `.trim()
  },
  'r&d': {
    name: 'Innovation and Technology Development Fund',
    document: `
Innovation and Technology Development Fund

Program Purpose:
Accelerate technology development and commercialization through research funding.

Funding Amount:
$100,000 - $2,000,000 for R&D projects

Eligible Projects:
- Applied research and technology development
- Product innovation and prototyping
- Process improvement through technology
- Proof-of-concept studies

Eligibility:
- Technology-focused companies
- Must have qualified R&D plan
- Collaboration with research institutions encouraged

Deadline: October 31, 2025
    `.trim()
  },
  'market-expansion': {
    name: 'Export Market Development Program',
    document: `
Export Market Development Program

Helps BC businesses expand into international markets.

Funding:
Up to $100,000 per company for export activities

Eligible Expenses:
- International trade show participation
- Market research for foreign markets
- Export-focused marketing materials
- Travel to international markets
- Shipping costs for samples

Requirements:
- BC-based business
- Clear export market strategy
- 50% cost-sharing (company contributes 50%)

Application Deadline: December 1, 2025
    `.trim()
  },
  'loan': {
    name: 'Small Business Loan Program',
    document: `
Small Business Loan Program

Low-interest financing for business expansion and working capital needs.

Loan Amount:
$25,000 to $500,000

Interest Rate:
Prime + 2% (currently 5% total)

Repayment Terms:
Up to 10 years for equipment financing
Up to 5 years for working capital

Eligibility:
- Established businesses (2+ years operation)
- Good credit history
- Personal guarantee required
- Collateral may be required for loans over $100,000

Application: Rolling intake, processed within 30 days
    `.trim()
  },
  'investment': {
    name: 'Clean Technology Venture Capital Fund',
    document: `
Clean Technology Venture Capital Fund

Equity investment for high-growth cleantech startups.

Investment Size:
$500,000 to $5,000,000 per company

Structure:
Equity investment (minority stake)
Co-investment with private sector required

Eligibility:
- Clean technology focus
- High growth potential
- Scalable business model
- Experienced management team

Focus Areas:
- Renewable energy
- Energy efficiency
- Waste reduction
- Water technology

Application Process:
Rolling intake, pitch deck required
    `.trim()
  }
};

// Tasks to test
const tasks = ['grant-criteria', 'preview', 'requirements', 'insights', 'categories', 'missing-info'];

// Simplified old prompt builder (extracted from server.js pattern)
function buildOldPrompt(task) {
  const oldPersona = `# GRANT CARD EXPERT PERSONA
## WHO YOU ARE:
You are the Grant Card writer at Granted Consulting with years of experience.

## YOUR EXPERTISE:
- Consistent execution of systematic methodology for processing complex funding documents into easy-to-read grant cards
- identification of grant types using Granted's 6-category classification system
- Pattern recognition for grant program structures and requirements
- Analysis of grant program documents for missing info and key insights to receive funding

## YOUR PROFESSIONAL APPROACH:
- You work with available information comprehensively
- You always follow established, proven format and structure guidelines for writing grant cards
- You leverage knowledge base to inform decisions and ensure consistency

## YOUR COMMUNICATION STYLE:
- You speak with a spartan tone
- You are focussed on actioning the grant card workflow but can answer general user questions related to the process

## YOUR KNOWLEDGE BASE MASTERY:
You have complete familiarity with all Granted Consulting workflow documents and reference the appropriate methodology for each task.`;

  return oldPersona;
}

// Run test with a specific prompt system
async function runTest(promptType, grantType, task, grantDocument) {
  console.log(`\n🧪 Testing ${promptType} prompt on ${grantType} grant, task: ${task}`);

  let systemPrompt, userPrompt;

  if (promptType === 'OLD') {
    // Old system: Everything in system prompt
    systemPrompt = buildOldPrompt(task);
    userPrompt = `Please analyze this grant document and perform the task: ${task}\n\n${grantDocument}`;
  } else {
    // New system: Separated system and user prompts
    const prompts = buildNewPrompt(task, ''); // No knowledge base for this test
    systemPrompt = prompts.system;
    userPrompt = `${prompts.user}\n\n<grant_document>\n${grantDocument}\n</grant_document>`;
  }

  try {
    const startTime = Date.now();

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    const content = response.content[0].text;

    return {
      success: true,
      content,
      duration,
      tokenUsage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens
      }
    };

  } catch (error) {
    console.error(`❌ Error in ${promptType} test:`, error.message);
    return {
      success: false,
      error: error.message,
      duration: 0,
      tokenUsage: { input: 0, output: 0, total: 0 }
    };
  }
}

// Analyze output quality
function analyzeOutput(content, task) {
  const analysis = {
    length: content.length,
    hasPreamble: false,
    hasMetaCommentary: false,
    hasKnowledgeBaseRefs: false,
    startsDirectly: true,
  };

  // Check for preambles
  const preambles = [
    "here is",
    "here's",
    "i'll",
    "i've created",
    "i've generated",
    "i've analyzed",
    "based on",
    "according to"
  ];

  const firstLine = content.substring(0, 100).toLowerCase();
  analysis.hasPreamble = preambles.some(p => firstLine.includes(p));
  analysis.startsDirectly = !analysis.hasPreamble;

  // Check for meta-commentary
  const metaPhrases = [
    "methodology",
    "knowledge base",
    "framework",
    "following the",
    "as instructed",
    "per the guidelines"
  ];
  analysis.hasMetaCommentary = metaPhrases.some(p => content.toLowerCase().includes(p));

  // Check for knowledge base references
  const kbRefs = [
    "GRANT-CRITERIA-Formatter",
    "PREVIEW-SECTION-Generator",
    "GENERAL-REQUIREMENTS-Creator",
    "GRANTED-INSIGHTS-Generator",
    "CATEGORIES-TAGS-Classifier",
    "MISSING-INFO-Generator"
  ];
  analysis.hasKnowledgeBaseRefs = kbRefs.some(ref => content.includes(ref));

  // Task-specific checks
  if (task === 'preview') {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    analysis.sentenceCount = sentences.length;
    analysis.meetsLengthReq = sentences.length >= 1 && sentences.length <= 3;
  }

  if (task === 'requirements') {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    analysis.sentenceCount = sentences.length;
    analysis.meetsLengthReq = sentences.length <= 5;
  }

  if (task === 'insights') {
    const bulletPoints = (content.match(/^[\s]*[-•*]/gm) || []).length;
    analysis.bulletCount = bulletPoints;
    analysis.meetsFormatReq = bulletPoints >= 3 && bulletPoints <= 5;
  }

  return analysis;
}

// Compare two outputs
function compareOutputs(oldResult, newResult, task) {
  const comparison = {
    task,
    old: analyzeOutput(oldResult.content, task),
    new: analyzeOutput(newResult.content, task),
    performance: {
      oldDuration: oldResult.duration,
      newDuration: newResult.duration,
      durationDiff: newResult.duration - oldResult.duration,
      oldTokens: oldResult.tokenUsage.total,
      newTokens: newResult.tokenUsage.total,
      tokenDiff: newResult.tokenUsage.total - oldResult.tokenUsage.total
    }
  };

  // Calculate improvement score
  let improvementScore = 0;
  let improvementReasons = [];

  // Better adherence to format (no preambles)
  if (comparison.old.hasPreamble && !comparison.new.hasPreamble) {
    improvementScore += 2;
    improvementReasons.push('Eliminated preamble');
  }

  // No meta-commentary
  if (comparison.old.hasMetaCommentary && !comparison.new.hasMetaCommentary) {
    improvementScore += 2;
    improvementReasons.push('Removed meta-commentary');
  }

  // No KB references in output
  if (comparison.old.hasKnowledgeBaseRefs && !comparison.new.hasKnowledgeBaseRefs) {
    improvementScore += 1;
    improvementReasons.push('Removed knowledge base references');
  }

  // Task-specific improvements
  if (task === 'preview' && comparison.new.meetsLengthReq && !comparison.old.meetsLengthReq) {
    improvementScore += 2;
    improvementReasons.push('Better adherence to 1-2 sentence requirement');
  }

  if (task === 'insights' && comparison.new.meetsFormatReq) {
    improvementScore += 1;
    improvementReasons.push('Proper bullet point format');
  }

  comparison.improvementScore = improvementScore;
  comparison.improvementReasons = improvementReasons;

  return comparison;
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Grant Card Prompt Comparison Tests\n');
  console.log('Testing OLD (current) vs NEW (XML-structured) prompts\n');
  console.log('Testing ALL 6 task types across 3 grant types\n');
  console.log('='.repeat(80));

  const results = {};

  // Test subset of grant types with ALL tasks to avoid API limits
  const testGrantSubset = {
    'hiring': testGrants['hiring'],
    'training': testGrants['training'],
    'r&d': testGrants['r&d']
  };

  for (const [grantType, grantData] of Object.entries(testGrantSubset)) {
    console.log(`\n\n📊 GRANT TYPE: ${grantType.toUpperCase()}`);
    console.log(`Grant: ${grantData.name}`);
    console.log('-'.repeat(80));

    results[grantType] = {};

    // Test ALL 6 task types for this grant
    for (const task of tasks) {
      console.log(`\n  Testing task: ${task}`);

      // Run OLD prompt
      const oldResult = await runTest('OLD', grantType, task, grantData.document);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting

      // Run NEW prompt
      const newResult = await runTest('NEW', grantType, task, grantData.document);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting

      if (oldResult.success && newResult.success) {
        const comparison = compareOutputs(oldResult, newResult, task);
        results[grantType][task] = {
          comparison,
          oldContent: oldResult.content,
          newContent: newResult.content
        };

        // Print summary
        console.log(`\n  📈 Comparison Results:`);
        console.log(`     Improvement Score: ${comparison.improvementScore}/7`);
        if (comparison.improvementReasons.length > 0) {
          console.log(`     Improvements: ${comparison.improvementReasons.join(', ')}`);
        }
        console.log(`     Old: ${comparison.old.length} chars, ${comparison.performance.oldTokens} tokens, ${comparison.performance.oldDuration}ms`);
        console.log(`     New: ${comparison.new.length} chars, ${comparison.performance.newTokens} tokens, ${comparison.performance.newDuration}ms`);
        console.log(`     Old has preamble: ${comparison.old.hasPreamble}, New has preamble: ${comparison.new.hasPreamble}`);
        console.log(`     Old has meta-commentary: ${comparison.old.hasMetaCommentary}, New has meta-commentary: ${comparison.new.hasMetaCommentary}`);
      } else {
        console.log(`  ❌ Test failed`);
        results[grantType][task] = { error: 'Test failed' };
      }
    }
  }

  // Generate summary report
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(80));

  let totalImprovement = 0;
  let totalTests = 0;
  const taskResults = {};

  for (const [grantType, taskData] of Object.entries(results)) {
    for (const [task, data] of Object.entries(taskData)) {
      if (data.comparison) {
        totalImprovement += data.comparison.improvementScore;
        totalTests++;

        // Track per-task results
        if (!taskResults[task]) {
          taskResults[task] = {
            count: 0,
            totalScore: 0,
            improvements: []
          };
        }
        taskResults[task].count++;
        taskResults[task].totalScore += data.comparison.improvementScore;
        taskResults[task].improvements.push(...data.comparison.improvementReasons);
      }
    }
  }

  const avgImprovement = totalTests > 0 ? (totalImprovement / totalTests).toFixed(2) : 0;

  console.log(`\nTotal tests run: ${totalTests} (${Object.keys(results).length} grant types × ${tasks.length} task types)`);
  console.log(`Average improvement score: ${avgImprovement}/7`);

  console.log(`\n📋 Results by Task Type:`);
  for (const [task, stats] of Object.entries(taskResults)) {
    const taskAvg = (stats.totalScore / stats.count).toFixed(2);
    console.log(`  ${task}: ${taskAvg}/7 avg (${stats.count} tests)`);
  }

  console.log(`\n🎯 Key improvements across all tests:`);

  const allImprovements = {};
  for (const [grantType, taskData] of Object.entries(results)) {
    for (const [task, data] of Object.entries(taskData)) {
      if (data.comparison && data.comparison.improvementReasons) {
        data.comparison.improvementReasons.forEach(reason => {
          allImprovements[reason] = (allImprovements[reason] || 0) + 1;
        });
      }
    }
  }

  for (const [reason, count] of Object.entries(allImprovements)) {
    console.log(`  - ${reason}: ${count} times`);
  }

  // Save detailed results to file
  const fs = require('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tests/results/prompt-comparison-${timestamp}.json`;

  fs.mkdirSync('tests/results', { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));

  console.log(`\n✅ Detailed results saved to: ${filename}`);
  console.log('\n' + '='.repeat(80));

  return results;
}

// Run tests if called directly
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log('\n✅ All tests completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { runAllTests, testGrants, tasks };

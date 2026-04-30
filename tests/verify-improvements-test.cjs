/**
 * Verification Test for Improved Categories and Missing-Info Prompts
 *
 * Compares old vs new (improved) prompts for the two underperforming tasks
 */

const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const { buildGrantCardSystemPrompt: buildNewPrompt } = require('../api/grant-card-prompt-redesign.js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Test grants (same as comprehensive test)
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
  }
};

// Simplified old prompt builder
function buildOldPrompt(task) {
  const oldPersona = `# GRANT CARD EXPERT PERSONA
You are the Grant Card writer at Granted Consulting with years of experience.`;
  return oldPersona;
}

// Run test
async function runTest(promptType, grantType, task, grantDocument) {
  console.log(`🧪 Testing ${promptType} prompt: ${grantType} - ${task}`);

  let systemPrompt, userPrompt;

  if (promptType === 'OLD') {
    systemPrompt = buildOldPrompt(task);
    userPrompt = `Please analyze this grant document and perform the task: ${task}\n\n${grantDocument}`;
  } else {
    const prompts = buildNewPrompt(task, '');
    systemPrompt = prompts.system;
    userPrompt = `${prompts.user}\n\n<grant_document>\n${grantDocument}\n</grant_document>`;
  }

  try {
    const startTime = Date.now();

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const endTime = Date.now();
    const content = response.content[0].text;

    return {
      success: true,
      content,
      duration: endTime - startTime,
      tokenUsage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens
      }
    };

  } catch (error) {
    console.error(`❌ Error:`, error.message);
    return {
      success: false,
      error: error.message,
      duration: 0,
      tokenUsage: { input: 0, output: 0, total: 0 }
    };
  }
}

// Analyze output
function analyzeOutput(content, task) {
  const analysis = {
    length: content.length,
    hasPreamble: false,
    hasMetaCommentary: false,
    startsDirectly: true,
  };

  const preambles = ["here is", "here's", "i'll", "i've created", "based on"];
  const firstLine = content.substring(0, 100).toLowerCase();
  analysis.hasPreamble = preambles.some(p => firstLine.includes(p));
  analysis.startsDirectly = !analysis.hasPreamble;

  if (task === 'categories') {
    // Check for 7-section structure
    analysis.hasStructure = content.includes('PRIMARY GRANT TYPE:') &&
                            content.includes('INDUSTRIES:') &&
                            content.includes('FUNDING FOCUS:');

    // Count sections
    const sections = ['PRIMARY GRANT TYPE:', 'SECONDARY TYPES', 'INDUSTRIES:',
                     'GEOGRAPHY:', 'RECIPIENT TYPE:', 'FUNDING FOCUS:', 'PROGRAM CHARACTERISTICS:'];
    analysis.sectionCount = sections.filter(s => content.includes(s)).length;
    analysis.meetsFormatReq = analysis.sectionCount === 7;
  }

  if (task === 'missing-info') {
    // Check for 3-tier structure
    analysis.hasTiers = content.includes('TIER 1:') &&
                       content.includes('TIER 2:') &&
                       content.includes('TIER 3:');

    // Count bullet points
    const bulletPoints = (content.match(/^[\s]*•/gm) || []).length;
    analysis.bulletCount = bulletPoints;
    analysis.meetsCountReq = bulletPoints >= 8 && bulletPoints <= 12;
  }

  return analysis;
}

// Compare outputs
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

  let improvementScore = 0;
  let improvementReasons = [];

  // Preamble check
  if (comparison.old.hasPreamble && !comparison.new.hasPreamble) {
    improvementScore += 2;
    improvementReasons.push('Eliminated preamble');
  }

  // Task-specific improvements
  if (task === 'categories') {
    if (comparison.new.meetsFormatReq && !comparison.old.meetsFormatReq) {
      improvementScore += 3;
      improvementReasons.push('Follows 7-section structure');
    }
    if (comparison.new.hasStructure && !comparison.old.hasStructure) {
      improvementScore += 2;
      improvementReasons.push('Clear section labels');
    }
  }

  if (task === 'missing-info') {
    if (comparison.new.hasTiers && !comparison.old.hasTiers) {
      improvementScore += 3;
      improvementReasons.push('3-tier priority structure');
    }
    if (comparison.new.meetsCountReq) {
      improvementScore += 2;
      improvementReasons.push('Meets 8-12 item count requirement');
    }
  }

  comparison.improvementScore = improvementScore;
  comparison.improvementReasons = improvementReasons;

  return comparison;
}

// Main test runner
async function runVerificationTests() {
  console.log('🚀 Verification Tests: Categories & Missing-Info Improvements\n');
  console.log('Testing improved prompts vs old prompts\n');
  console.log('='.repeat(80));

  const results = {};
  const tasksToTest = ['categories', 'missing-info'];

  for (const [grantType, grantData] of Object.entries(testGrants)) {
    console.log(`\n\n📊 GRANT TYPE: ${grantType.toUpperCase()}`);
    console.log(`Grant: ${grantData.name}`);
    console.log('-'.repeat(80));

    results[grantType] = {};

    for (const task of tasksToTest) {
      console.log(`\n  Testing task: ${task}`);

      const oldResult = await runTest('OLD', grantType, task, grantData.document);
      await new Promise(resolve => setTimeout(resolve, 1000));

      const newResult = await runTest('NEW', grantType, task, grantData.document);
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (oldResult.success && newResult.success) {
        const comparison = compareOutputs(oldResult, newResult, task);
        results[grantType][task] = {
          comparison,
          oldContent: oldResult.content,
          newContent: newResult.content
        };

        console.log(`\n  📈 Comparison Results:`);
        console.log(`     Improvement Score: ${comparison.improvementScore}/7`);
        if (comparison.improvementReasons.length > 0) {
          console.log(`     Improvements: ${comparison.improvementReasons.join(', ')}`);
        }
        console.log(`     Old: ${comparison.old.length} chars, ${comparison.performance.oldDuration}ms`);
        console.log(`     New: ${comparison.new.length} chars, ${comparison.performance.newDuration}ms`);

        if (task === 'categories') {
          console.log(`     Old sections: ${comparison.old.sectionCount || 0}/7, New sections: ${comparison.new.sectionCount || 0}/7`);
          console.log(`     New meets format: ${comparison.new.meetsFormatReq}`);
        }

        if (task === 'missing-info') {
          console.log(`     Old has tiers: ${comparison.old.hasTiers}, New has tiers: ${comparison.new.hasTiers}`);
          console.log(`     Old bullets: ${comparison.old.bulletCount || 0}, New bullets: ${comparison.new.bulletCount || 0}`);
          console.log(`     New meets count (8-12): ${comparison.new.meetsCountReq}`);
        }
      } else {
        console.log(`  ❌ Test failed`);
        results[grantType][task] = { error: 'Test failed' };
      }
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('='.repeat(80));

  const taskScores = { 'categories': [], 'missing-info': [] };

  for (const [grantType, taskData] of Object.entries(results)) {
    for (const [task, data] of Object.entries(taskData)) {
      if (data.comparison) {
        taskScores[task].push(data.comparison.improvementScore);
      }
    }
  }

  console.log(`\n📋 Average Improvement Scores:`);
  for (const [task, scores] of Object.entries(taskScores)) {
    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;
    const oldAvg = task === 'categories' ? '1.33' : '2.00';
    console.log(`  ${task}: ${avg}/7 (was ${oldAvg}/7)`);
  }

  // Save results
  const fs = require('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tests/results/verification-${timestamp}.json`;

  fs.mkdirSync('tests/results', { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));

  console.log(`\n✅ Results saved to: ${filename}`);
  console.log('='.repeat(80));

  return results;
}

// Run if called directly
if (require.main === module) {
  runVerificationTests()
    .then(() => {
      console.log('\n✅ Verification tests completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { runVerificationTests };

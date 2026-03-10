/**
 * Test eligibility tagging locally with sample grant data
 */

import { tagGrant } from './src/services/grant-tagger.js';

// Test programs:
// 1. CanExport SMEs - should require incorporation + revenue
// 2. Student SWPP program - should require employer status
// 3. Minimal requirements program

const testPrograms = [
  {
    grant_name: 'CanExport SMEs',
    grant_type: 'Market Expansion',
    grant_amount: '$50,000 (up to 75% of eligible expenses)',
    grant_criteria: 'Eligibility: Must be a for-profit Canadian SME with 1-499 employees. Must be incorporated. Must have existing revenue. Covers international marketing, trade shows, and export development activities. Requires matching contribution from the business.',
    program_provider: 'Global Affairs Canada',
    regions: 'All of Canada',
    industries: 'All industries'
  },
  {
    grant_name: 'Venture for Canada Internship - Student Work Placement Program (SWPP)',
    grant_type: 'Hiring',
    grant_amount: '$7,000',
    grant_criteria: 'Eligibility: Canadian employers with existing employees. Provides wage subsidies for hiring post-secondary students or recent graduates. Must be incorporated or registered business. Students must work 12-16 weeks.',
    program_provider: 'Government of Canada',
    regions: 'All of Canada',
    industries: 'All industries'
  },
  {
    grant_name: 'Mitacs Accelerate Entrepreneur',
    grant_type: 'Research & Development',
    grant_amount: '$7,500',
    grant_criteria: 'Eligibility: Canadian entrepreneurs and startups working with university researchers on innovation projects. Open to sole proprietors, partnerships, and incorporated businesses. No minimum revenue or employee requirements. Focuses on applied research and development.',
    program_provider: 'Mitacs',
    regions: 'All of Canada',
    industries: 'All industries'
  }
];

async function testEligibilityTagger() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING ELIGIBILITY TAGGER');
  console.log('='.repeat(80) + '\n');

  for (let i = 0; i < testPrograms.length; i++) {
    const program = testPrograms[i];

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Test ${i + 1}/3: ${program.grant_name}`);
    console.log('─'.repeat(80) + '\n');

    console.log(`Type: ${program.grant_type}`);
    console.log(`Amount: ${program.grant_amount}`);
    console.log(`Provider: ${program.program_provider}\n`);

    console.log('🤖 Running tagger...\n');

    const tags = await tagGrant(program);

    if (!tags) {
      console.log('❌ Tagging failed\n');
      continue;
    }

    console.log('✅ Tags generated:\n');

    // Show eligibility object prominently
    if (tags.eligibility) {
      console.log('📋 ELIGIBILITY FIELDS:');
      console.log('   requires_incorporation:', tags.eligibility.requires_incorporation);
      console.log('   requires_revenue:', tags.eligibility.requires_revenue);
      console.log('   requires_employer_status:', tags.eligibility.requires_employer_status);
      console.log('   min_employees:', tags.eligibility.min_employees);
      console.log('   requires_matching_funds:', tags.eligibility.requires_matching_funds);
      console.log('');
    } else {
      console.log('❌ Missing eligibility object\n');
    }

    // Show full tags for reference
    console.log('Full tags:');
    console.log(JSON.stringify(tags, null, 2));
    console.log('');
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ ELIGIBILITY TAGGER TEST COMPLETE');
  console.log('='.repeat(80) + '\n');

  console.log('📊 Expected Results:\n');
  console.log('1. CanExport SMEs:');
  console.log('   ✓ requires_incorporation: true (explicitly requires incorporated business)');
  console.log('   ✓ requires_revenue: true (existing revenue mentioned)');
  console.log('   ✓ requires_employer_status: true (must have 1-499 employees)');
  console.log('   ✓ min_employees: 1');
  console.log('   ✓ requires_matching_funds: true (matching contribution required)');
  console.log('');
  console.log('2. Venture for Canada SWPP:');
  console.log('   ✓ requires_incorporation: true (incorporated or registered business)');
  console.log('   ✓ requires_revenue: false (not explicitly mentioned)');
  console.log('   ✓ requires_employer_status: true (existing employees required)');
  console.log('   ✓ min_employees: 1');
  console.log('   ✓ requires_matching_funds: false (wage subsidy, no matching)');
  console.log('');
  console.log('3. Mitacs Accelerate:');
  console.log('   ✓ requires_incorporation: false (open to sole proprietors)');
  console.log('   ✓ requires_revenue: false (no minimum revenue)');
  console.log('   ✓ requires_employer_status: false (no employee requirements)');
  console.log('   ✓ min_employees: null');
  console.log('   ✓ requires_matching_funds: false');
  console.log('');
}

testEligibilityTagger();

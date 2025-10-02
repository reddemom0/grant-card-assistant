/**
 * BCAFE Writer - Application Quality Tests
 *
 * Integration test using LLM-as-judge to evaluate the quality of BCAFE
 * application responses. Tests professional writing and merit optimization
 * (Category C - Quality & Strategic Value).
 */

const { sendMessageToAgent } = require('../utils/test-helpers');
const { gradeWithLLM, createGrantWritingRubric } = require('../utils/llm-grader');

describe('BCAFE Writer - Application Quality (LLM-Graded)', () => {

  describe('Complete Application Response Quality', () => {

    test('Generated application response meets professional standards', async () => {
      const message = `
Create BCAFE application responses for:

Applicant: Okanagan Valley Berry Growers (producer cooperative)
Project: Japan Market Entry Initiative
Total Budget: $45,000
Cash Match Available: 50% ($22,500)

Project Description:
Develop export relationships with Japanese importers for premium frozen berries. Activities include market research, product adaptation for Japanese preferences, trade mission to Tokyo, sample shipping, and Japanese-language marketing materials.

Objectives:
1. Establish relationships with 5 Japanese importers
2. Secure first purchase order within 6 months
3. Generate $250,000 in export sales year 1

Target Market:
High-end Japanese food retailers and restaurant suppliers seeking premium BC berries (blueberries, raspberries, blackberries).

Competitive Advantage:
BC's reputation for quality, sustainable farming practices, proximity to Pacific shipping routes, harvest timing fills gap in Japanese market.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Grade application quality
      const grading = await gradeWithLLM({
        task: 'Generate BCAFE application responses for agricultural export project',
        output: response.content,
        rubric: createGrantWritingRubric(),
        context: message
      });

      // Should meet professional quality threshold
      expect(grading).toMeetQualityThreshold(4.0);

      // Key quality dimensions
      expect(grading.scores.clarity_and_coherence_of_writing).toBeGreaterThanOrEqual(4);
      expect(grading.scores.professional_tone_appropriate_for_grant_context).toBeGreaterThanOrEqual(4);

      console.log('\n📊 BCAFE Application Quality:');
      console.log(`   Overall Score: ${grading.overallScore}/5`);
      console.log(`   Feedback: ${grading.feedback}\n`);

    }, 60000);

  });

  describe('Merit Optimization Strategy', () => {

    test('Application addresses all 5 merit evaluation criteria', async () => {
      const message = `
BCAFE application for:

Applicant: Fraser Valley Organic Farms Association
Project: South Korea Organic Produce Export Program
Budget: $35,000 (30% association cash match = $10,500)

Brief project overview:
Export organic vegetables to South Korean health food market. Market research, Korean language packaging, trade show participation, distributor meetings, compliance with Korean organic standards.

Expected outcomes:
3-5 export contracts, $400K sales year 1, ongoing market presence.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      const content = response.content.toLowerCase();

      // Check that application addresses key merit criteria areas
      // Merit criteria: Budget/Timeline (30%), Market Research (20%), Economic Benefit (20%),
      //                 Capacity (15%), Partnerships (15%)

      // Should discuss budget and timeline
      expect(content).toMatch(/budget|timeline|schedule|timeframe|completion/);

      // Should discuss market research or market opportunity
      expect(content).toMatch(/market research|market analysis|market opportunity|demand/);

      // Should discuss economic benefits
      expect(content).toMatch(/economic|sales|revenue|benefit|job|employment/);

      // Should discuss organizational capacity
      expect(content).toMatch(/capacity|experience|expertise|capability|qualified/);

      // Should discuss partnerships or collaborations
      expect(content).toMatch(/partner|collaboration|relationship|distributor|importer/);

      // Grade merit optimization
      const grading = await gradeWithLLM({
        task: 'Evaluate how well the application addresses BCAFE merit evaluation criteria (Budget/Timeline 30%, Market Research 20%, Economic Benefit 20%, Capacity 15%, Partnerships 15%)',
        output: response.content,
        rubric: {
          criteria: [
            'Budget and timeline clearly presented and realistic (30% weight)',
            'Market research and opportunity well documented (20% weight)',
            'Economic benefits quantified and compelling (20% weight)',
            'Organizational capacity demonstrated (15% weight)',
            'Partnerships and collaborations identified (15% weight)',
            'Strategic positioning for high merit score'
          ],
          scale: '1-5 where 5 is excellently optimized for merit scoring'
        },
        context: message
      });

      // Merit optimization should be strong
      expect(grading.overallScore).toBeGreaterThanOrEqual(3.5);

      console.log('\n📊 Merit Optimization Score:');
      console.log(`   Score: ${grading.overallScore}/5`);
      console.log(`   Analysis: ${grading.feedback}\n`);

    }, 60000);

  });

  describe('Export Market Justification', () => {

    test('Application provides compelling export market justification', async () => {
      const message = `
BCAFE application:

Applicant: BC Wine Growers Cooperative (producer)
Project: United Kingdom Premium Wine Export Launch
Budget: $55,000 (50% cash match)

Project: Launch BC VQA wines in UK premium wine market through targeted trade events, wine critic tastings, distributor partnerships, and marketing campaign emphasizing BC terroir and sustainability.

Target: Establish presence in London and Edinburgh premium wine shops, secure 2-3 distribution agreements, generate $500K sales year 1.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Grade export market justification
      const grading = await gradeWithLLM({
        task: 'Evaluate the strength and credibility of export market justification in BCAFE application',
        output: response.content,
        rubric: {
          criteria: [
            'Clear identification of target export market',
            'Evidence of market demand or opportunity',
            'Competitive positioning explained',
            'Realistic market entry strategy',
            'Quantifiable expected outcomes'
          ],
          scale: '1-5 where 5 is highly compelling and credible'
        },
        context: message
      });

      // Market justification should be strong
      expect(grading.overallScore).toBeGreaterThanOrEqual(3.5);

      // Should mention UK market specifically
      expect(response.content.toLowerCase()).toMatch(/united kingdom|uk|british|london|edinburgh/);

      // Should include quantifiable outcomes
      expect(response.content).toMatch(/\$|sales|revenue/);

      console.log('\n📊 Export Market Justification:');
      console.log(`   Score: ${grading.overallScore}/5`);
      console.log(`   Assessment: ${grading.feedback}\n`);

    }, 60000);

  });

  describe('Application Completeness and Structure', () => {

    test('Application response is complete and well-structured', async () => {
      const message = `
Create BCAFE application for seafood processor expanding to European markets.

Applicant: Pacific Coast Seafood Processors
Type: Processor
Budget: $40,000 (50% match)
Project: EU Market Entry for Premium Frozen Salmon
Markets: Germany, France, Netherlands
Timeline: November 2025 - March 2026
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Grade structure and completeness
      const grading = await gradeWithLLM({
        task: 'Evaluate completeness and structure of BCAFE application response',
        output: response.content,
        rubric: {
          criteria: [
            'All required application sections present',
            'Logical flow and organization',
            'Appropriate level of detail (not too brief, not excessive)',
            'Addresses BCAFE program requirements',
            'Submission-ready quality (minimal editing needed)'
          ],
          scale: '1-5 where 5 is complete and excellently structured'
        },
        context: message
      });

      expect(grading.overallScore).toBeGreaterThanOrEqual(4.0);

      // Response should be substantive
      expect(response.content.length).toBeGreaterThan(500);

      // Should mention key project elements
      expect(response.content.toLowerCase()).toMatch(/salmon|seafood/);
      expect(response.content.toLowerCase()).toMatch(/europe|germany|france|netherlands|eu/);
      expect(response.content).toMatch(/\$40,000/);

      console.log('\n📊 Application Completeness:');
      console.log(`   Score: ${grading.overallScore}/5`);
      console.log(`   Structure Assessment: ${grading.feedback}\n`);

    }, 60000);

  });

});

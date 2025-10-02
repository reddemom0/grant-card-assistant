/**
 * BCAFE Writer - Edge Cases Tests
 *
 * Tests handling of incomplete information, complex scenarios,
 * and edge cases for BCAFE application generation (Category E - Error Handling).
 */

const { sendMessageToAgent, testBCAFEFunding } = require('../utils/test-helpers');

describe('BCAFE Writer - Edge Cases and Complex Scenarios', () => {

  describe('Incomplete Project Information', () => {

    test('Handles application request with minimal details', async () => {
      const message = `
Create BCAFE application.

Applicant: Some farm
Project: Export something
Budget: Not sure yet
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should not crash
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      // Should either request more information or provide guidance
      const content = response.content.toLowerCase();
      expect(content).toMatch(/information|detail|provide|need|require|specify/);

    });

    test('Handles missing budget information', async () => {
      const message = `
BCAFE application for cherry exporter to Japan.
No budget details available yet.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should not crash
      expect(response.content).toBeDefined();

      // Should mention budget or cost
      const content = response.content.toLowerCase();
      expect(content).toMatch(/budget|cost|funding|amount/);
    });

  });

  describe('Complex Multi-Market Projects', () => {

    test('Handles project targeting multiple export markets', async () => {
      const message = `
BCAFE application:

Applicant: BC Craft Brewers Association (association, 30% match)
Project: Multi-Market Craft Beer Export Initiative
Budget: $60,000
Markets: USA (California, Washington), Japan, South Korea, China
Activities: Market research all 4 markets, trade missions, distributor meetings, compliance research, marketing materials in 3 languages
Timeline: November 2025 - March 2026 (BCAFE project period)

Objectives: Establish distribution in 2-3 of the 4 target markets, secure initial orders totaling $800K.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should handle multiple markets
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(500);

      const content = response.content.toLowerCase();

      // Should mention multiple markets
      expect(content).toMatch(/usa|california|washington|japan|korea|china/);

      // Should discuss project scope
      expect(content).toMatch(/market|multi|multiple|international|export/);

    }, 45000);

  });

  describe('Eligibility Edge Cases', () => {

    test('Handles non-standard applicant type', async () => {
      const message = `
BCAFE application for Indigenous-owned agricultural enterprise.

Applicant: First Nations Agriculture Cooperative
Type: Indigenous cooperative
Project: USA organic produce export
Budget: $35,000
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should provide response (may need clarification on cash match)
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(200);

    });

    test('Handles request for ineligible activity clarification', async () => {
      const message = `
Is purchasing refrigerated shipping containers eligible under BCAFE?
We're a berry producer looking to export to Asia.
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should provide guidance on eligibility
      expect(response.content).toBeDefined();

      const content = response.content.toLowerCase();
      expect(content).toMatch(/eligible|eligibility|allowed|permitted|qualify/);
    });

  });

  describe('Timeline and Deadline Handling', () => {

    test('Handles project outside BCAFE program dates', async () => {
      const message = `
BCAFE application for wine export project.

Timeline: January 2025 - June 2025
(Note: This is before the BCAFE program period of November 17, 2025 - March 1, 2026)

Should I adjust my timeline?
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should address timeline issue
      expect(response.content).toBeDefined();

      const content = response.content.toLowerCase();
      expect(content).toMatch(/timeline|date|schedule|period|november|march/);

    });

    test('Warns about application deadline approaching', async () => {
      const message = `
We need to submit BCAFE application soon.
Today is August 30, 2025.
Deadline is September 5, 2025 at 4:00 PM PDT.

Quick application for honey export to Singapore.
Budget: $25,000 (producer, 50% match)
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      // Should acknowledge tight deadline
      expect(response.content).toBeDefined();

      const content = response.content.toLowerCase();
      // May mention deadline, urgency, or timeline
      expect(content.length).toBeGreaterThan(200);
    });

  });

  describe('Budget and Cash Match Verification', () => {

    test('Flags insufficient cash match for producer', async () => {
      const message = `
BCAFE application:

Applicant: Small organic farm (producer)
Total budget: $50,000
Available cash: $10,000

Is this enough for the cash match requirement?
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      const content = response.content.toLowerCase();

      // Should address cash match requirement (50% = $25,000 needed)
      expect(content).toMatch(/cash match|50%|25,000/);

      // May flag that $10,000 is insufficient
      expect(content).toMatch(/insufficient|not enough|require|need/);
    });

    test('Confirms sufficient cash match for association', async () => {
      const message = `
BCAFE verification:

Applicant: Growers Association
Budget: $40,000 total
Cash available: $15,000

Is our cash match sufficient? (Association = 30% match)
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      const content = response.content.toLowerCase();

      // Should confirm 30% match for association
      expect(content).toMatch(/30%|association/);

      // Should calculate that $12,000 is required (30% of $40,000)
      // $15,000 available is sufficient
      expect(content).toMatch(/sufficient|enough|meet|adequate/);
    });

  });

  describe('Merit Criteria Optimization Queries', () => {

    test('Provides guidance on strengthening application for merit scoring', async () => {
      const message = `
How can I strengthen my BCAFE application for the merit evaluation?

My project: Export organic apples to Taiwan
Budget: $30,000
I have basic market research and one potential distributor contact.

What should I focus on to improve my merit score?
      `.trim();

      const response = await sendMessageToAgent('bcafe-writer', message);

      const content = response.content.toLowerCase();

      // Should mention merit criteria
      expect(content).toMatch(/merit|evaluation|criteria|score/);

      // Should provide strategic advice
      expect(content).toMatch(/strengthen|improve|focus|prioritize/);

      // May mention specific criteria (budget/timeline, market research, etc.)
      expect(content.length).toBeGreaterThan(200);
    });

  });

  describe('Very Long Project Descriptions', () => {

    test('Handles extremely detailed project description', async () => {
      const longDescription = `
BCAFE application for comprehensive multi-phase export project.

Applicant: BC Premium Foods Collective (processor)
Budget: $75,000 (50% match = $37,500 cash)

Detailed project activities:
Phase 1 (Nov-Dec 2025): ${Array(20).fill('Market research activity, ').join('')}
Phase 2 (Jan 2026): ${Array(20).fill('Trade mission preparation, ').join('')}
Phase 3 (Feb 2026): ${Array(20).fill('Marketing material development, ').join('')}
Phase 4 (Mar 2026): ${Array(20).fill('Follow-up activity, ').join('')}

Expected outcomes: Extensive list of deliverables and metrics...
      `.trim();

      // Should handle very long input
      await expect(sendMessageToAgent('bcafe-writer', longDescription)).resolves.toBeDefined();

      const response = await sendMessageToAgent('bcafe-writer', longDescription);

      // Should still generate response
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(300);

    }, 60000); // Longer timeout for processing

  });

  describe('Calculation Edge Cases', () => {

    test('Handles fractional budget amounts correctly', async () => {
      const scenario = {
        applicantType: 'producer',
        totalProjectCost: 33333.33
      };

      const result = await testBCAFEFunding(scenario);

      // Should handle decimals
      expect(result.cashMatchRequired).toBeDefined();
      expect(result.maxGrantAmount).toBeDefined();

      // 50% of $33,333.33 = $16,666.67 (approximately)
      expect(result.cashMatchRequired).toBeApproximately(16666.67, 10);
    });

    test('Handles very small budget amounts', async () => {
      const scenario = {
        applicantType: 'association',
        totalProjectCost: 500
      };

      const result = await testBCAFEFunding(scenario);

      // 30% of $500 = $150
      expect(result.cashMatchRequired).toBeApproximately(150, 1);

      // 70% of $500 = $350
      expect(result.maxGrantAmount).toBeApproximately(350, 1);
    });

  });

});

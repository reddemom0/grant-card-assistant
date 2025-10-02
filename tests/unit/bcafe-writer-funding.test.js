/**
 * BCAFE Writer - Funding Calculation Tests
 *
 * Tests the accuracy of cash match calculations for different applicant types
 * in the BC Agriculture and Food Export (BCAFE) program.
 * Category B (Accuracy & Compliance).
 */

const { testBCAFEFunding, sendMessageToAgent } = require('../utils/test-helpers');

describe('BCAFE Writer - Cash Match Calculation Accuracy', () => {

  describe('Producer Cash Match (50%)', () => {

    test('Calculates 50% cash match for producer applicant', async () => {
      const scenario = {
        applicantType: 'producer',
        totalProjectCost: 10000
      };

      const result = await testBCAFEFunding(scenario);

      // Producer requires 50% cash match
      expect(result.cashMatchPercent).toBe(50);

      // Cash match required: 50% of $10,000 = $5,000
      expect(result.cashMatchRequired).toBeApproximately(5000, 1);

      // Max grant: 50% of $10,000 = $5,000
      expect(result.maxGrantAmount).toBeApproximately(5000, 1);
    });

    test('Calculates cash match for larger producer project', async () => {
      const scenario = {
        applicantType: 'producer',
        totalProjectCost: 50000
      };

      const result = await testBCAFEFunding(scenario);

      expect(result.cashMatchPercent).toBe(50);
      expect(result.cashMatchRequired).toBeApproximately(25000, 1);
      expect(result.maxGrantAmount).toBeApproximately(25000, 1);
    });

  });

  describe('Processor Cash Match (50%)', () => {

    test('Calculates 50% cash match for processor applicant', async () => {
      const scenario = {
        applicantType: 'processor',
        totalProjectCost: 20000
      };

      const result = await testBCAFEFunding(scenario);

      // Processor also requires 50% cash match
      expect(result.cashMatchPercent).toBe(50);

      // Cash match: 50% of $20,000 = $10,000
      expect(result.cashMatchRequired).toBeApproximately(10000, 1);

      // Grant: 50% of $20,000 = $10,000
      expect(result.maxGrantAmount).toBeApproximately(10000, 1);
    });

  });

  describe('Cooperative Cash Match (50%)', () => {

    test('Calculates 50% cash match for cooperative applicant', async () => {
      const scenario = {
        applicantType: 'cooperative',
        totalProjectCost: 30000
      };

      const result = await testBCAFEFunding(scenario);

      // Cooperative requires 50% cash match (same as producer/processor)
      expect(result.cashMatchPercent).toBe(50);

      // Cash match: 50% of $30,000 = $15,000
      expect(result.cashMatchRequired).toBeApproximately(15000, 1);

      // Grant: 50% of $30,000 = $15,000
      expect(result.maxGrantAmount).toBeApproximately(15000, 1);
    });

  });

  describe('Association Cash Match (30%)', () => {

    test('Calculates 30% cash match for association applicant', async () => {
      const scenario = {
        applicantType: 'association',
        totalProjectCost: 10000
      };

      const result = await testBCAFEFunding(scenario);

      // Association requires only 30% cash match
      expect(result.cashMatchPercent).toBe(30);

      // Cash match: 30% of $10,000 = $3,000
      expect(result.cashMatchRequired).toBeApproximately(3000, 1);

      // Grant: 70% of $10,000 = $7,000
      expect(result.maxGrantAmount).toBeApproximately(7000, 1);
    });

    test('Calculates cash match for larger association project', async () => {
      const scenario = {
        applicantType: 'association',
        totalProjectCost: 50000
      };

      const result = await testBCAFEFunding(scenario);

      expect(result.cashMatchPercent).toBe(30);

      // Cash match: 30% of $50,000 = $15,000
      expect(result.cashMatchRequired).toBeApproximately(15000, 1);

      // Grant: 70% of $50,000 = $35,000
      expect(result.maxGrantAmount).toBeApproximately(35000, 1);
    });

  });

  describe('Comprehensive Calculation Test', () => {

    test('All applicant types calculate correctly', async () => {
      const testCases = [
        {
          type: 'producer',
          cost: 40000,
          expectedMatch: 50,
          expectedCashRequired: 20000,
          expectedGrant: 20000
        },
        {
          type: 'processor',
          cost: 60000,
          expectedMatch: 50,
          expectedCashRequired: 30000,
          expectedGrant: 30000
        },
        {
          type: 'cooperative',
          cost: 80000,
          expectedMatch: 50,
          expectedCashRequired: 40000,
          expectedGrant: 40000
        },
        {
          type: 'association',
          cost: 100000,
          expectedMatch: 30,
          expectedCashRequired: 30000,
          expectedGrant: 70000
        }
      ];

      for (const testCase of testCases) {
        const result = await testBCAFEFunding({
          applicantType: testCase.type,
          totalProjectCost: testCase.cost
        });

        expect(result.cashMatchPercent).toBe(testCase.expectedMatch);
        expect(result.cashMatchRequired).toBeApproximately(testCase.expectedCashRequired, 1);
        expect(result.maxGrantAmount).toBeApproximately(testCase.expectedGrant, 1);
      }

    }, 90000); // Longer timeout for multiple API calls

  });

  describe('Edge Cases and Validation', () => {

    test('Handles small project amounts correctly', async () => {
      const scenario = {
        applicantType: 'producer',
        totalProjectCost: 1000
      };

      const result = await testBCAFEFunding(scenario);

      expect(result.cashMatchPercent).toBe(50);
      expect(result.cashMatchRequired).toBeApproximately(500, 1);
      expect(result.maxGrantAmount).toBeApproximately(500, 1);
    });

    test('Handles large project amounts correctly', async () => {
      const scenario = {
        applicantType: 'association',
        totalProjectCost: 500000
      };

      const result = await testBCAFEFunding(scenario);

      expect(result.cashMatchPercent).toBe(30);
      expect(result.cashMatchRequired).toBeApproximately(150000, 1);
      expect(result.maxGrantAmount).toBeApproximately(350000, 1);
    });

    test('Handles odd amounts with proper rounding', async () => {
      const scenario = {
        applicantType: 'producer',
        totalProjectCost: 15333
      };

      const result = await testBCAFEFunding(scenario);

      expect(result.cashMatchPercent).toBe(50);

      // 50% of $15,333 = $7,666.50 (allow small rounding variance)
      expect(result.cashMatchRequired).toBeApproximately(7666.50, 10);
      expect(result.maxGrantAmount).toBeApproximately(7666.50, 10);
    });

  });

});

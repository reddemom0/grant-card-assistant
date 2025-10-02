/**
 * CanExport Claims - Tax Calculation Tests
 *
 * Tests the accuracy of tax removal calculations for different provinces and tax types.
 * This is a critical accuracy test (Category B) ensuring financial compliance.
 */

const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Tax Calculation Accuracy', () => {

  describe('HST Removal (13% in Ontario)', () => {

    test('Correctly removes HST from expense and calculates reimbursement', async () => {
      const expense = {
        vendor: 'Toronto Print Shop',
        amount: 1130,
        tax: 130,
        taxType: 'HST',
        province: 'ON',
        category: 'B',
        description: 'Trade show marketing banners with company branding'
      };

      const result = await testExpenseAnalysis(expense);

      // Verify tax removal
      expect(result.taxRemoved).toBeApproximately(130, 0.01);

      // Verify eligible amount (total minus tax)
      expect(result.eligibleAmount).toBeApproximately(1000, 0.01);

      // Verify 50% reimbursement calculation
      expect(result.estimatedReimbursement).toBeApproximately(500, 0.01);
    });

  });

  describe('GST Removal (5% federal)', () => {

    test('Correctly removes GST from translation services', async () => {
      const expense = {
        vendor: 'Ottawa Translation Services',
        amount: 525,
        tax: 25,
        taxType: 'GST',
        province: 'ON',
        category: 'C',
        description: 'Website translation to French for Quebec market entry'
      };

      const result = await testExpenseAnalysis(expense);

      // Verify tax removal
      expect(result.taxRemoved).toBeApproximately(25, 0.01);

      // Verify eligible amount
      expect(result.eligibleAmount).toBeApproximately(500, 0.01);

      // Verify 50% reimbursement
      expect(result.estimatedReimbursement).toBeApproximately(250, 0.01);
    });

  });

  describe('Combined PST+GST (12% in BC)', () => {

    test('Correctly removes combined provincial and federal taxes', async () => {
      const expense = {
        vendor: 'Vancouver Marketing Inc',
        amount: 1120,
        tax: 120,
        taxType: 'PST+GST',
        province: 'BC',
        category: 'B',
        description: 'Export-focused promotional materials'
      };

      const result = await testExpenseAnalysis(expense);

      // Verify tax removal
      expect(result.taxRemoved).toBeApproximately(120, 0.01);

      // Verify eligible amount
      expect(result.eligibleAmount).toBeApproximately(1000, 0.01);

      // Verify 50% reimbursement
      expect(result.estimatedReimbursement).toBeApproximately(500, 0.01);
    });

  });

});

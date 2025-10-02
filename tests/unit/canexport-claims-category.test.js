/**
 * CanExport Claims - Category Assignment Tests
 *
 * Tests expense categorization into CanExport categories A-H.
 * Ensures accurate classification for different expense types.
 */

const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Expense Categorization', () => {

  describe('Category A: International Travel', () => {

    test('Airfare to international trade show is categorized correctly', async () => {
      const expense = {
        vendor: 'Air Canada',
        amount: 1500,
        tax: 75,
        taxType: 'GST',
        category: 'A',
        description: 'Return flight Vancouver to London for international trade show',
        invoiceDate: '2025-09-15',
        paymentDate: '2025-09-16'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be approved for Category A
      expect(result.verdict).toBe('APPROVED');

      // Check that compliance analysis mentions Category A
      expect(result.parsed.compliance_analysis).toMatch(/category\s*a/i);

      // Verify proper tax removal
      expect(result.taxRemoved).toBeApproximately(75, 0.01);
      expect(result.eligibleAmount).toBeApproximately(1425, 0.01);
    });

  });

  describe('Category B: Marketing Materials', () => {

    test('Trade show booth materials are approved for Category B', async () => {
      const expense = {
        vendor: 'DisplayPro Marketing',
        amount: 2260,
        tax: 260,
        taxType: 'HST',
        province: 'ON',
        category: 'B',
        description: 'Custom trade show booth display with international branding',
        invoiceDate: '2025-08-20',
        paymentDate: '2025-08-21'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be approved
      expect(result.verdict).toBe('APPROVED');

      // Verify Category B mentioned in analysis
      expect(result.parsed.compliance_analysis).toMatch(/category\s*b/i);

      // Financial accuracy
      expect(result.taxRemoved).toBeApproximately(260, 0.01);
      expect(result.eligibleAmount).toBeApproximately(2000, 0.01);
      expect(result.estimatedReimbursement).toBeApproximately(1000, 0.01);
    });

  });

  describe('Category C: Translation Services', () => {

    test('Document translation for export markets is approved', async () => {
      const expense = {
        vendor: 'Global Language Solutions',
        amount: 840,
        tax: 40,
        taxType: 'GST',
        category: 'C',
        description: 'Technical product documentation translated to Mandarin for China market',
        invoiceDate: '2025-09-01',
        paymentDate: '2025-09-02'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be approved for translation
      expect(result.verdict).toBe('APPROVED');

      // Verify Category C classification
      expect(result.parsed.compliance_analysis).toMatch(/category\s*c/i);

      // Tax and amount checks
      expect(result.taxRemoved).toBeApproximately(40, 0.01);
      expect(result.eligibleAmount).toBeApproximately(800, 0.01);
    });

  });

  describe('Category D: International Shipping', () => {

    test('Product samples shipped internationally are eligible', async () => {
      const expense = {
        vendor: 'FedEx International',
        amount: 315,
        tax: 15,
        taxType: 'GST',
        category: 'D',
        description: 'International courier for product samples to potential distributor in Germany',
        invoiceDate: '2025-09-10',
        paymentDate: '2025-09-10'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be approved for shipping
      expect(result.verdict).toBe('APPROVED');

      // Verify Category D classification
      expect(result.parsed.compliance_analysis).toMatch(/category\s*d/i);

      // Financial checks
      expect(result.taxRemoved).toBeApproximately(15, 0.01);
      expect(result.eligibleAmount).toBeApproximately(300, 0.01);
      expect(result.estimatedReimbursement).toBeApproximately(150, 0.01);
    });

  });

});

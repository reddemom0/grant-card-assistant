/**
 * CanExport Claims - Edge Cases and Error Handling Tests
 *
 * Tests graceful handling of incomplete data, missing information,
 * and rejection patterns. Ensures robust error handling (Category E).
 */

const { testExpenseAnalysis } = require('../utils/test-helpers');

describe('CanExport Claims - Edge Cases and Error Handling', () => {

  describe('Missing Tax Information', () => {

    test('Flags expense with missing tax amount for correction', async () => {
      const expense = {
        vendor: 'Vancouver Marketing Inc',
        amount: 1200,
        tax: null, // Missing tax information
        category: 'B',
        description: 'Marketing materials for export promotion'
      };

      const result = await testExpenseAnalysis(expense);

      // Should not crash, should return conditional verdict
      expect(result.verdict).toBe('CONDITIONAL');

      // Should request tax information in recommendations
      expect(result.parsed.recommendations).toMatch(/tax/i);
    });

  });

  describe('Historical Rejection Patterns', () => {

    test('Rejects Amazon office supplies based on historical pattern', async () => {
      const expense = {
        vendor: 'Amazon.ca',
        amount: 960,
        tax: 110.50,
        taxType: 'HST',
        province: 'ON',
        category: 'Unknown',
        description: 'Office supplies: printer, folders, pens',
        invoiceDate: '2025-09-05',
        paymentDate: '2025-09-06'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be rejected due to historical pattern
      expect(result.verdict).toBe('REJECTED');

      // Should mention Amazon rejection pattern
      expect(result.parsed.compliance_analysis).toMatch(/amazon/i);

      // Should mention re-usable items
      expect(result.parsed.compliance_analysis).toMatch(/re-usable|reusable/i);

      // Eligible amount should be $0 since rejected
      expect(result.eligibleAmount).toBe(0);
      expect(result.estimatedReimbursement).toBe(0);
    });

    test('Rejects general office equipment as re-usable items', async () => {
      const expense = {
        vendor: 'Staples Business Depot',
        amount: 565,
        tax: 65,
        taxType: 'HST',
        category: 'Unknown',
        description: 'Office furniture: desk organizers and filing cabinets',
        invoiceDate: '2025-08-15',
        paymentDate: '2025-08-16'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be rejected
      expect(result.verdict).toBe('REJECTED');

      // Should mention re-usable items or general business operations
      expect(result.parsed.verdict).toMatch(/re-usable|reusable|general business/i);
    });

  });

  describe('Ambiguous or Unclear Categories', () => {

    test('Requests clarification for expense with unclear export connection', async () => {
      const expense = {
        vendor: 'Local Consulting Firm',
        amount: 1050,
        tax: 50,
        taxType: 'GST',
        category: 'Unknown',
        description: 'Business consulting services',
        invoiceDate: '2025-09-01',
        paymentDate: '2025-09-05'
      };

      const result = await testExpenseAnalysis(expense);

      // Should be conditional or rejected (not approved without clarification)
      expect(result.verdict).toMatch(/CONDITIONAL|REJECTED/);

      // Should request more details about export-specific nature
      expect(result.parsed.recommendations || result.parsed.verdict).toMatch(/export|international|specific/i);
    });

  });

  describe('Extremely Large Amounts', () => {

    test('Handles high-value expense without crashing', async () => {
      const expense = {
        vendor: 'International Trade Show Organizer',
        amount: 25000,
        tax: 1250,
        taxType: 'GST',
        category: 'A',
        description: 'Premium exhibition booth space at international trade fair in Dubai',
        invoiceDate: '2025-10-01',
        paymentDate: '2025-10-02'
      };

      // Should not throw error
      await expect(testExpenseAnalysis(expense)).resolves.toBeDefined();

      const result = await testExpenseAnalysis(expense);

      // Should have a verdict (may require additional documentation)
      expect(result.verdict).toMatch(/APPROVED|CONDITIONAL|REJECTED/);

      // Should still calculate amounts correctly
      expect(result.taxRemoved).toBeApproximately(1250, 0.01);
    });

  });

  describe('Missing Invoice or Payment Dates', () => {

    test('Flags expense with missing dates as needing documentation', async () => {
      const expense = {
        vendor: 'Translation Services Pro',
        amount: 630,
        tax: 30,
        taxType: 'GST',
        category: 'C',
        description: 'Marketing brochure translation',
        invoiceDate: null, // Missing
        paymentDate: null  // Missing
      };

      const result = await testExpenseAnalysis(expense);

      // Should be conditional pending documentation
      expect(result.verdict).toBe('CONDITIONAL');

      // Should mention dates or documentation in recommendations
      expect(result.parsed.recommendations).toMatch(/date|invoice|payment|documentation/i);
    });

  });

  describe('Empty or Minimal Description', () => {

    test('Requests detailed description for vague expense', async () => {
      const expense = {
        vendor: 'Some Company',
        amount: 500,
        tax: 25,
        taxType: 'GST',
        category: 'B',
        description: 'Services' // Too vague
      };

      const result = await testExpenseAnalysis(expense);

      // Should be conditional or rejected
      expect(result.verdict).toMatch(/CONDITIONAL|REJECTED/);

      // Should request more details
      expect(result.parsed.recommendations || result.parsed.compliance_analysis).toMatch(/description|detail|clarif/i);
    });

  });

});

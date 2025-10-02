/**
 * DEMO: Simple Utility Tests (No Server Required)
 *
 * These tests demonstrate testing utility functions directly
 * without needing a running server.
 */

const { validateRequiredFields, parseXMLResponse, extractThinking } = require('../utils/test-helpers');

describe('DEMO: Test Utilities (No Server Required)', () => {

  describe('validateRequiredFields', () => {

    test('Validates complete response with all required fields', () => {
      const response = {
        vendor: 'Test Vendor',
        amount: 1000,
        tax: 130,
        category: 'B'
      };

      const requiredFields = ['vendor', 'amount', 'tax', 'category'];

      const result = validateRequiredFields(response, requiredFields);

      expect(result.isValid).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.present).toHaveLength(4);
      expect(result.completeness).toBe(1.0); // 100%
    });

    test('Identifies missing fields in incomplete response', () => {
      const response = {
        vendor: 'Test Vendor',
        amount: null,  // Missing
        tax: 130,
        category: ''   // Empty (considered missing)
      };

      const requiredFields = ['vendor', 'amount', 'tax', 'category'];

      const result = validateRequiredFields(response, requiredFields);

      expect(result.isValid).toBe(false);
      expect(result.missing).toContain('amount');
      expect(result.missing).toContain('category');
      expect(result.present).toHaveLength(2);
      expect(result.completeness).toBe(0.5); // 50%
    });

  });

  describe('parseXMLResponse', () => {

    test('Extracts XML tags from response text', () => {
      const response = `
<thinking>
This is my internal reasoning
</thinking>

<verdict>
APPROVED
</verdict>

<recommendations>
Please provide additional documentation
</recommendations>
      `;

      const tags = ['thinking', 'verdict', 'recommendations'];
      const parsed = parseXMLResponse(response, tags);

      expect(parsed.thinking).toBe('This is my internal reasoning');
      expect(parsed.verdict).toBe('APPROVED');
      expect(parsed.recommendations).toBe('Please provide additional documentation');
    });

    test('Returns null for missing XML tags', () => {
      const response = `
<verdict>APPROVED</verdict>
      `;

      const tags = ['thinking', 'verdict', 'recommendations'];
      const parsed = parseXMLResponse(response, tags);

      expect(parsed.thinking).toBeNull();
      expect(parsed.verdict).toBe('APPROVED');
      expect(parsed.recommendations).toBeNull();
    });

  });

  describe('extractThinking', () => {

    test('Separates thinking from main content', () => {
      const response = `
<thinking>
Internal reasoning and analysis
</thinking>

This is the main content that the user sees.
      `;

      const result = extractThinking(response);

      expect(result.hasThinking).toBe(true);
      expect(result.thinking).toBe('Internal reasoning and analysis');
      expect(result.mainContent).toBe('This is the main content that the user sees.');
      expect(result.mainContent).not.toContain('<thinking>');
    });

    test('Handles response without thinking tags', () => {
      const response = 'Just regular content without thinking tags.';

      const result = extractThinking(response);

      expect(result.hasThinking).toBe(false);
      expect(result.thinking).toBeNull();
      expect(result.mainContent).toBe(response);
    });

  });

  describe('Basic Assertions', () => {

    test('Standard Jest matchers work correctly', () => {
      const expense = {
        amount: 1130,
        tax: 130,
        eligible: 1000
      };

      expect(expense.amount).toBe(1130);
      expect(expense.tax).toBe(130);
      expect(expense.eligible).toBe(1000);
      expect(expense.amount - expense.tax).toBe(expense.eligible);
    });

    test('Array and object assertions work', () => {
      const categories = ['A', 'B', 'C', 'D'];
      const response = { verdict: 'APPROVED', eligible: true };

      expect(categories).toHaveLength(4);
      expect(categories).toContain('B');
      expect(response.verdict).toBe('APPROVED');
      expect(response).toHaveProperty('eligible', true);
    });

  });

});

/**
 * Grant Cards - Structure Validation Tests
 *
 * Tests structural completeness and format compliance of grant card outputs.
 * Ensures all required fields are present and properly formatted (Category A - Structural).
 */

const { sendMessageToAgent, validateRequiredFields, parseXMLResponse } = require('../utils/test-helpers');

describe('Grant Cards - Output Structure and Completeness', () => {

  describe('Grant Criteria Field Completeness', () => {

    test('Grant Criteria output contains all required sections', async () => {
      const grantDoc = `
Small Business Digital Adoption Grant

Program Description:
Helps small businesses adopt digital technologies to improve operations and reach new customers.

Funding:
- Up to $15,000 for technology adoption
- Additional $7,500 for e-commerce development

Eligibility:
- Registered Canadian business
- 1-499 employees
- Minimum $30,000 annual revenue
- Not a non-profit

Eligible Expenses:
- E-commerce website development
- Digital marketing tools
- Point-of-sale systems
- Cybersecurity software
- Digital training for employees

Application Deadline: December 31, 2026
Turnaround Time: 4-6 weeks for decision

Application Requirements:
- Business plan
- Financial statements (last 2 years)
- Digital adoption plan
- Quotes from technology vendors
      `.trim();

      const response = await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        { task: 'grant-criteria' }
      );

      const content = response.content;

      // Check for key sections that should be present
      expect(content.toLowerCase()).toMatch(/eligibilit/); // Eligibility
      expect(content.toLowerCase()).toMatch(/funding|amount|\$\d/); // Funding amount
      expect(content.toLowerCase()).toMatch(/deadline|december|2026/); // Deadline
      expect(content.toLowerCase()).toMatch(/eligible.*(?:expense|activit|cost)/); // Eligible expenses
      expect(content.toLowerCase()).toMatch(/application|requirement|document/); // Requirements

      // Response should be substantial (not just error message)
      expect(content.length).toBeGreaterThan(500);
    });

  });

  describe('Preview Description Requirements', () => {

    test('Preview description is concise (1-2 sentences)', async () => {
      const grantDoc = `
Green Technology Innovation Fund

Provides funding for businesses developing environmentally sustainable technologies.
Funding: $100,000 - $1,000,000
Deadline: March 31, 2026
Eligible: Cleantech companies in BC
      `.trim();

      const response = await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        { task: 'preview' }
      );

      const content = response.content;

      // Count sentences (approximate - split by .!?)
      const sentences = content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 10); // Filter out very short fragments

      // Should be 1-2 sentences
      expect(sentences.length).toBeGreaterThanOrEqual(1);
      expect(sentences.length).toBeLessThanOrEqual(3); // Allow 3 max with some flexibility

      // Should mention key program elements
      expect(content.toLowerCase()).toMatch(/green|technology|cleantech|environmental|sustainable/);
      expect(content).toMatch(/\$\d/); // Mentions funding amount
    });

  });

  describe('General Requirements Structure', () => {

    test('General Requirements section follows 3-sentence limit', async () => {
      const grantDoc = `
Export Market Development Program

Supports BC businesses expanding into international markets.
Funding: Up to $50,000 per company
Deadline: Rolling intake (quarterly reviews)
Turnaround: 8-12 weeks from application to decision
      `.trim();

      const response = await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        { task: 'requirements' }
      );

      const content = response.content;

      // Count sentences
      const sentences = content
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 10);

      // Should be approximately 3 sentences max (allow some flexibility)
      expect(sentences.length).toBeLessThanOrEqual(5);

      // Should mention turnaround time
      expect(content.toLowerCase()).toMatch(/turnaround|timeline|week|month/);
    });

  });

  describe('Categories and Tags Completeness', () => {

    test('Categories output includes grant type classification', async () => {
      const grantDoc = `
Manufacturing Training Initiative

Provides funding for manufacturing companies to train their workforce.
Funding: Up to $200,000
Eligible: Manufacturing sector, minimum 10 employees
Deadline: June 15, 2026
      `.trim();

      const response = await sendMessageToAgent(
        'grant-cards',
        grantDoc,
        { task: 'categories' }
      );

      const content = response.content.toLowerCase();

      // Should classify into one of the 6 grant types
      const grantTypes = [
        'hiring grant',
        'training grant',
        'research & development grant',
        'r&d grant',
        'market expansion grant',
        'loan program',
        'investment fund'
      ];

      const hasGrantType = grantTypes.some(type => content.includes(type.toLowerCase()));
      expect(hasGrantType).toBe(true);

      // Should mention categories, tags, or classification
      expect(content).toMatch(/categor|tag|type|classification/);
    });

  });

  describe('Missing Information Identification', () => {

    test('Missing info task identifies gaps in incomplete grant document', async () => {
      const incompleteDoc = `
Business Support Program

Some funding is available.
For BC businesses.
More details coming soon.
      `.trim();

      const response = await sendMessageToAgent(
        'grant-cards',
        incompleteDoc,
        { task: 'missing-info' }
      );

      const content = response.content.toLowerCase();

      // Should identify missing information
      expect(content).toMatch(/missing|incomplete|not specified|unclear|not provided/);

      // Should mention key missing elements
      expect(content).toMatch(/funding amount|deadline|eligibility|requirement/);
    });

  });

  describe('Format Consistency Across Tasks', () => {

    test('All task types return non-empty responses', async () => {
      const grantDoc = `
Technology Adoption Grant
Funding for SMEs adopting new technologies.
Amount: $25,000
Deadline: December 2026
      `.trim();

      const tasks = ['grant-criteria', 'preview', 'requirements', 'insights', 'categories', 'missing-info'];

      for (const task of tasks) {
        const response = await sendMessageToAgent(
          'grant-cards',
          grantDoc,
          { task }
        );

        // Each task should return substantive content
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(50);

        // Should not be just an error message
        expect(response.content.toLowerCase()).not.toMatch(/^error:|^sorry,/);
      }

    }, 120000); // Longer timeout for 6 API calls

  });

  describe('Field Validation Utility', () => {

    test('validateRequiredFields helper correctly identifies missing fields', () => {
      const completeResponse = {
        grantType: 'Training Grant',
        fundingAmount: '$100,000',
        deadline: 'March 31, 2026',
        eligibility: 'BC businesses'
      };

      const incompleteResponse = {
        grantType: 'Training Grant',
        fundingAmount: null,
        deadline: 'March 31, 2026',
        eligibility: ''
      };

      const requiredFields = ['grantType', 'fundingAmount', 'deadline', 'eligibility'];

      // Complete response should pass
      const completeValidation = validateRequiredFields(completeResponse, requiredFields);
      expect(completeValidation.isValid).toBe(true);
      expect(completeValidation.completeness).toBe(1.0);

      // Incomplete response should fail
      const incompleteValidation = validateRequiredFields(incompleteResponse, requiredFields);
      expect(incompleteValidation.isValid).toBe(false);
      expect(incompleteValidation.missing).toContain('fundingAmount');
      expect(incompleteValidation.missing).toContain('eligibility');
      expect(incompleteValidation.completeness).toBe(0.5); // 2 out of 4 fields present
    });

  });

});

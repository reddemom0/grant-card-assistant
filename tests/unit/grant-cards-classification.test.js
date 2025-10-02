/**
 * Grant Cards - Grant Type Classification Tests
 *
 * Tests the accuracy of grant type classification into the 6 established
 * categories. This is a core accuracy test (Category B) for the grant-cards agent.
 */

const { testGrantCardClassification, sendMessageToAgent } = require('../utils/test-helpers');

describe('Grant Cards - Grant Type Classification Accuracy', () => {

  describe('Hiring Grant Classification', () => {

    test('Correctly identifies wage subsidy program as Hiring Grant', async () => {
      const grantDoc = `
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
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      // Should classify as Hiring Grant
      expect(result.grantType).toBe('Hiring Grant');
    });

    test('Identifies youth employment program as Hiring Grant', async () => {
      const grantDoc = `
Youth Employment and Skills Strategy

Provides wage subsidies to encourage employers to hire youth aged 15-30.
Funding: Up to $7,000 per youth hired
Deadline: Rolling intake
Eligible: Non-profit and for-profit employers
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Hiring Grant');
    });

  });

  describe('Training Grant Classification', () => {

    test('Correctly identifies skills development program as Training Grant', async () => {
      const grantDoc = `
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
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Training Grant');
    });

  });

  describe('Research & Development Grant Classification', () => {

    test('Correctly identifies innovation funding as R&D Grant', async () => {
      const grantDoc = `
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
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Research & Development Grant');
    });

  });

  describe('Market Expansion Grant Classification', () => {

    test('Correctly identifies export development program as Market Expansion Grant', async () => {
      const grantDoc = `
Export Market Development Program

Helps BC businesses expand into international markets.

Funding:
Up to $100,000 per company for export activities

Eligible Expenses:
- International trade show participation
- Market research for foreign markets
- Export-focused marketing materials
- Travel to international markets
- Shipping costs for samples

Requirements:
- BC-based business
- Clear export market strategy
- 50% cost-sharing (company contributes 50%)

Application Deadline: December 1, 2025
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Market Expansion Grant');
    });

    test('Identifies capital equipment funding as Market Expansion Grant', async () => {
      const grantDoc = `
Business Growth Capital Equipment Program

Provides funding for capital equipment purchases to expand business capacity.

Funding: Up to $500,000
Eligible: Manufacturing equipment, production machinery, technology infrastructure
Requirement: Equipment must increase production capacity by 25%+
Deadline: March 15, 2026
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Market Expansion Grant');
    });

  });

  describe('Loan Program Classification', () => {

    test('Correctly identifies financing program as Loan Program', async () => {
      const grantDoc = `
Small Business Loan Program

Low-interest financing for business expansion and working capital needs.

Loan Amount:
$25,000 to $500,000

Interest Rate:
Prime + 2% (currently 5% total)

Repayment Terms:
Up to 10 years for equipment financing
Up to 5 years for working capital

Eligibility:
- Established businesses (2+ years operation)
- Good credit history
- Personal guarantee required
- Collateral may be required for loans over $100,000

Application: Rolling intake, processed within 30 days
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Loan Program');
    });

  });

  describe('Investment Fund Classification', () => {

    test('Correctly identifies venture capital fund as Investment Fund', async () => {
      const grantDoc = `
Clean Technology Venture Capital Fund

Equity investment for high-growth cleantech startups.

Investment Size:
$500,000 to $5,000,000 per company

Structure:
Equity investment (minority stake)
Co-investment with private sector required

Eligibility:
- Clean technology focus
- High growth potential
- Scalable business model
- Experienced management team

Focus Areas:
- Renewable energy
- Energy efficiency
- Waste reduction
- Water technology

Application Process:
Rolling intake, pitch deck required
      `.trim();

      const result = await testGrantCardClassification(grantDoc);

      expect(result.grantType).toBe('Investment Fund');
    });

  });

  describe('Classification Consistency', () => {

    test('Same grant document produces consistent classification across 3 runs', async () => {
      const grantDoc = `
Digital Skills Training Initiative

Funding for employee training in digital technologies.
Amount: Up to $150,000
Eligible: Software training, data analytics courses, cybersecurity certifications
Deadline: July 31, 2026
      `.trim();

      // Run classification 3 times
      const result1 = await testGrantCardClassification(grantDoc);
      const result2 = await testGrantCardClassification(grantDoc);
      const result3 = await testGrantCardClassification(grantDoc);

      // All three should produce same grant type
      expect(result1.grantType).toBe(result2.grantType);
      expect(result2.grantType).toBe(result3.grantType);

      // Should consistently identify as Training Grant
      expect(result1.grantType).toBe('Training Grant');
    }, 90000); // Longer timeout for 3 API calls

  });

});

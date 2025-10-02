/**
 * ETG Writer - Eligibility Checker Tests
 *
 * Tests the ETG eligibility checker's ability to correctly identify
 * eligible and ineligible training programs based on program rules.
 * This tests the built-in checkETGEligibility function (Category B - Accuracy).
 */

const { testETGEligibility } = require('../utils/test-helpers');

describe('ETG Writer - Training Eligibility Checker', () => {

  describe('Eligible Training Programs', () => {

    test('Approves professional certification course', async () => {
      const training = {
        training_title: 'Project Management Professional (PMP) Certification',
        training_type: 'Professional certification course',
        training_provider: 'PMI Training Institute',
        training_content: 'Comprehensive project management training covering PMBOK guide, best practices, and exam preparation',
        training_duration: '35 hours over 5 days'
      };

      const result = await testETGEligibility(training);

      // Should be eligible
      expect(result.eligible).toBe(true);

      // Should not mention ineligible keywords
      expect(result.mentionedKeywords).toHaveLength(0);

      // Response should contain positive eligibility language
      expect(result.rawResponse.toLowerCase()).toMatch(/eligible|approved/);
    });

    test('Approves skills development workshop', async () => {
      const training = {
        training_title: 'Advanced Excel for Business Analytics',
        training_type: 'Skills development workshop',
        training_provider: 'TechSkills Training Center',
        training_content: 'Advanced data analysis, pivot tables, macros, and business intelligence tools',
        training_duration: '24 hours over 3 days'
      };

      const result = await testETGEligibility(training);

      // Should be eligible
      expect(result.eligible).toBe(true);

      // Should not flag ineligible keywords
      expect(result.mentionedKeywords).toHaveLength(0);
    });

    test('Approves certificate program for technical skills', async () => {
      const training = {
        training_title: 'Cybersecurity Fundamentals Certificate',
        training_type: 'Certificate program',
        training_provider: 'BC Institute of Technology',
        training_content: 'Network security, threat detection, security protocols, incident response',
        training_duration: '40 hours (8 weeks, part-time)'
      };

      const result = await testETGEligibility(training);

      // Should be eligible
      expect(result.eligible).toBe(true);
      expect(result.mentionedKeywords).toHaveLength(0);
    });

  });

  describe('Ineligible Training Programs - Keyword Detection', () => {

    test('Rejects seminar (ineligible keyword)', async () => {
      const training = {
        training_title: 'Leadership Excellence Seminar',
        training_type: 'One-day seminar',
        training_provider: 'Executive Training Group',
        training_content: 'Leadership best practices and networking opportunities',
        training_duration: '6 hours'
      };

      const result = await testETGEligibility(training);

      // Should be ineligible
      expect(result.eligible).toBe(false);

      // Should detect 'seminar' keyword
      expect(result.mentionedKeywords).toContain('seminar');

      // Response should explain ineligibility
      expect(result.rawResponse.toLowerCase()).toMatch(/ineligible|not eligible|seminar/);
    });

    test('Rejects conference (ineligible keyword)', async () => {
      const training = {
        training_title: 'Annual Tech Conference 2025',
        training_type: 'Industry conference',
        training_provider: 'Tech Association BC',
        training_content: 'Keynote speakers, networking sessions, technology trends',
        training_duration: '3 days'
      };

      const result = await testETGEligibility(training);

      // Should be ineligible
      expect(result.eligible).toBe(false);

      // Should detect 'conference' keyword
      expect(result.mentionedKeywords).toContain('conference');
    });

    test('Rejects degree program (ineligible keyword)', async () => {
      const training = {
        training_title: 'Master of Business Administration',
        training_type: 'Graduate degree program',
        training_provider: 'University of British Columbia',
        training_content: 'Comprehensive business education covering strategy, finance, operations, marketing',
        training_duration: '2 years full-time'
      };

      const result = await testETGEligibility(training);

      // Should be ineligible
      expect(result.eligible).toBe(false);

      // Should detect degree-related keyword (master, degree)
      expect(result.mentionedKeywords.length).toBeGreaterThan(0);
      expect(result.mentionedKeywords.some(kw => ['master', 'degree'].includes(kw))).toBe(true);
    });

    test('Rejects coaching program (ineligible keyword)', async () => {
      const training = {
        training_title: 'Executive Coaching Program',
        training_type: 'One-on-one coaching',
        training_provider: 'Leadership Coaching Institute',
        training_content: 'Personalized executive coaching and leadership development',
        training_duration: '12 sessions over 6 months'
      };

      const result = await testETGEligibility(training);

      // Should be ineligible
      expect(result.eligible).toBe(false);

      // Should detect 'coaching' keyword
      expect(result.mentionedKeywords).toContain('coaching');
    });

    test('Rejects consulting services (ineligible keyword)', async () => {
      const training = {
        training_title: 'Business Process Consulting',
        training_type: 'Consulting services',
        training_provider: 'Management Consultants Inc',
        training_content: 'Process optimization and business improvement consulting',
        training_duration: 'Ongoing as needed'
      };

      const result = await testETGEligibility(training);

      // Should be ineligible
      expect(result.eligible).toBe(false);

      // Should detect 'consulting' keyword
      expect(result.mentionedKeywords).toContain('consulting');
    });

  });

  describe('Comprehensive Ineligible Keyword Test', () => {

    test('All 5 major ineligible keywords are detected', async () => {
      const ineligibleTypes = [
        {
          title: 'Annual Technology Conference',
          type: 'conference',
          expectedKeyword: 'conference'
        },
        {
          title: 'Executive Leadership Coaching',
          type: 'coaching',
          expectedKeyword: 'coaching'
        },
        {
          title: 'Strategy Consulting Services',
          type: 'consulting',
          expectedKeyword: 'consulting'
        },
        {
          title: 'Marketing Seminar Series',
          type: 'seminar',
          expectedKeyword: 'seminar'
        },
        {
          title: 'Bachelor of Computer Science',
          type: 'degree',
          expectedKeyword: 'bachelor'
        }
      ];

      for (const testCase of ineligibleTypes) {
        const result = await testETGEligibility({
          training_title: testCase.title,
          training_type: testCase.type,
          training_content: 'Various topics',
          training_duration: 'Variable'
        });

        // Each should be ineligible
        expect(result.eligible).toBe(false);

        // Each should detect the expected keyword
        expect(result.mentionedKeywords).toContain(testCase.expectedKeyword);
      }
    });

  });

});

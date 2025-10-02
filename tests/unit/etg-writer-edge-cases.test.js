/**
 * ETG Writer - Edge Cases Tests
 *
 * Tests handling of borderline eligibility cases, incomplete information,
 * and ambiguous training descriptions (Category E - Error Handling).
 */

const { testETGEligibility, sendMessageToAgent } = require('../utils/test-helpers');

describe('ETG Writer - Edge Cases and Borderline Scenarios', () => {

  describe('Borderline Eligibility Cases', () => {

    test('Handles workshop vs seminar distinction', async () => {
      const training = {
        training_title: 'Leadership Skills Workshop',
        training_type: 'Interactive workshop',
        training_provider: 'Professional Development Institute',
        training_content: 'Hands-on leadership exercises, team management strategies, performance coaching techniques',
        training_duration: '16 hours over 2 days'
      };

      const result = await testETGEligibility(training);

      // "Workshop" is eligible, should not be confused with "seminar"
      expect(result.eligible).toBe(true);

      // Should NOT flag 'seminar' as ineligible keyword
      expect(result.mentionedKeywords).not.toContain('seminar');
    });

    test('Handles certificate vs degree distinction', async () => {
      const training = {
        training_title: 'Advanced Certificate in Data Analytics',
        training_type: 'Professional certificate program',
        training_provider: 'Tech Training Center',
        training_content: 'Python programming, statistical analysis, data visualization, machine learning fundamentals',
        training_duration: '60 hours over 10 weeks'
      };

      const result = await testETGEligibility(training);

      // "Certificate" is eligible, should not be confused with "degree"
      expect(result.eligible).toBe(true);

      // Should NOT flag 'degree' as ineligible
      expect(result.mentionedKeywords).not.toContain('degree');
    });

    test('Detects diploma program as ineligible (related to degree)', async () => {
      const training = {
        training_title: 'Business Administration Diploma',
        training_type: 'Two-year diploma program',
        training_provider: 'Community College',
        training_content: 'Comprehensive business education program',
        training_duration: '2 years full-time'
      };

      const result = await testETGEligibility(training);

      // Diploma programs are ineligible (similar to degrees)
      expect(result.eligible).toBe(false);

      // Should detect 'diploma' keyword
      expect(result.mentionedKeywords).toContain('diploma');
    });

  });

  describe('Incomplete Training Information', () => {

    test('Handles training with minimal description', async () => {
      const training = {
        training_title: 'Safety Training',
        training_type: 'Course',
        training_provider: 'Safety Institute',
        training_content: '', // Empty
        training_duration: '8 hours'
      };

      // Should not crash with empty content
      await expect(testETGEligibility(training)).resolves.toBeDefined();

      const result = await testETGEligibility(training);

      // Should still provide eligibility assessment
      expect(result.eligible).toBeDefined();
    });

    test('Handles training with missing duration', async () => {
      const training = {
        training_title: 'Software Development Bootcamp',
        training_type: 'Intensive training program',
        training_provider: 'Code Academy',
        training_content: 'Full-stack web development, databases, APIs, deployment',
        training_duration: '' // Empty duration
      };

      await expect(testETGEligibility(training)).resolves.toBeDefined();

      const result = await testETGEligibility(training);

      // Should still evaluate eligibility
      expect(result.eligible).toBeDefined();
    });

  });

  describe('Ambiguous Training Descriptions', () => {

    test('Handles training with conference-like but eligible characteristics', async () => {
      const training = {
        training_title: 'Technical Skills Development Program',
        training_type: 'Multi-day training course',
        training_provider: 'Industry Training Association',
        training_content: 'Includes networking sessions alongside structured technical training modules with hands-on labs',
        training_duration: '24 hours over 3 days'
      };

      const result = await testETGEligibility(training);

      // Should focus on "training course" rather than "networking" aspect
      // This is a judgment call - may be eligible if structured training
      expect(result.eligible).toBeDefined();

      // Should provide reasoning if uncertain
      expect(result.rawResponse.length).toBeGreaterThan(100);
    });

    test('Handles mixed format training (online + in-person)', async () => {
      const training = {
        training_title: 'Hybrid Project Management Training',
        training_type: 'Blended learning certificate',
        training_provider: 'Professional Training Institute',
        training_content: 'Online modules plus in-person workshops covering project management methodologies',
        training_duration: '40 hours (30 hours online, 10 hours in-person)'
      };

      const result = await testETGEligibility(training);

      // Hybrid/blended formats should be eligible if substantial
      expect(result.eligible).toBe(true);
    });

  });

  describe('Business Case with Incomplete Information', () => {

    test('Requests additional information when business justification is vague', async () => {
      const message = `
Create ETG business case:

Training: Some Management Course
Cost: $2,000
Participants: 2 employees

Better job: They'll get better roles.
      `.trim();

      const response = await sendMessageToAgent('etg-writer', message);

      // Should not crash with minimal information
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      // Should either request more details or work with available info
      // Response should be reasonable (not just error message)
      expect(response.content.length).toBeGreaterThan(200);
    });

    test('Handles business case request with missing participant details', async () => {
      const message = `
Create ETG business case for Advanced Excel training.
Cost: $1,500 per person.
3 participants (details not provided yet).
      `.trim();

      const response = await sendMessageToAgent('etg-writer', message);

      // Should not crash
      expect(response.content).toBeDefined();

      // May request additional information
      const content = response.content.toLowerCase();
      expect(content).toMatch(/participant|detail|inform|provide/);
    });

  });

  describe('Very Long Training Descriptions', () => {

    test('Handles extremely detailed training description', async () => {
      const longContent = 'Comprehensive training covering: ' +
        Array(50).fill('module topic, ').join('') +
        'and final capstone project with practical application.';

      const training = {
        training_title: 'Comprehensive Business Skills Program',
        training_type: 'Extended certificate program',
        training_provider: 'Business Training Institute',
        training_content: longContent, // Very long
        training_duration: '120 hours over 6 months'
      };

      // Should handle long content without timing out
      await expect(testETGEligibility(training)).resolves.toBeDefined();

      const result = await testETGEligibility(training);

      // Should still provide eligibility decision
      expect(result.eligible).toBeDefined();
    }, 45000); // Longer timeout for processing

  });

});

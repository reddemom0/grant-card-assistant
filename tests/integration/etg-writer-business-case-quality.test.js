/**
 * ETG Writer - Business Case Quality Tests
 *
 * Integration test using LLM-as-judge to evaluate the quality of
 * generated ETG business cases. Tests professional writing standards
 * and strategic value (Category C - Quality).
 */

const { sendMessageToAgent } = require('../utils/test-helpers');
const { gradeWithLLM, createGrantWritingRubric } = require('../utils/llm-grader');

describe('ETG Writer - Business Case Quality (LLM-Graded)', () => {

  describe('Complete Business Case Generation', () => {

    test('Generated business case meets professional quality standards', async () => {
      // Provide complete training details for business case
      const message = `
Create an ETG business case for the following training:

Training Title: Advanced Project Management for Construction
Training Provider: BC Construction Institute
Training Type: Professional certification course
Duration: 40 hours over 6 weeks (part-time evening classes)
Cost: $2,500 per participant
Number of Participants: 3 employees

Participant Details:
- John Smith, Construction Supervisor, currently $65,000/year
- Sarah Johnson, Site Manager, currently $70,000/year
- Mike Chen, Project Coordinator, currently $58,000/year

Training Content:
- Advanced scheduling and resource management
- Risk mitigation in construction projects
- Budget control and cost estimation
- Quality assurance and safety protocols
- Construction project software tools (Procore, MS Project)

Business Justification:
Our construction company is expanding into commercial projects requiring advanced project management capabilities. This training will prepare our supervisors to manage larger, more complex projects, reduce cost overruns, and improve project completion times.

Better Job Outcomes:
All three participants will be promoted to Senior Project Manager roles upon completion, with salary increases of $8,000-$12,000 per year. These roles involve managing projects $5M+, leading teams of 10+ workers, and direct client interaction.
      `.trim();

      const response = await sendMessageToAgent('etg-writer', message);

      // Grade the business case quality using LLM
      const grading = await gradeWithLLM({
        task: 'Generate ETG business case for training program',
        output: response.content,
        rubric: createGrantWritingRubric(),
        context: message
      });

      // Should meet professional quality threshold (4.0+ out of 5)
      expect(grading).toMeetQualityThreshold(4.0);

      // Individual quality dimensions should also be strong
      expect(grading.scores.clarity_and_coherence_of_writing).toBeGreaterThanOrEqual(4);
      expect(grading.scores.professional_tone_appropriate_for_grant_context).toBeGreaterThanOrEqual(4);

      // Log grading feedback for review
      console.log('\n📊 Business Case Quality Grading:');
      console.log(`   Overall Score: ${grading.overallScore}/5`);
      console.log(`   Feedback: ${grading.feedback}\n`);

    }, 60000); // 60 second timeout for LLM grading

  });

  describe('Better Job Outcome Justification', () => {

    test('Business case includes clear "better job" outcome definitions', async () => {
      const message = `
Create ETG business case for:

Training: Digital Marketing Analytics Certificate
Provider: BCIT Continuing Education
Duration: 30 hours
Cost: $1,800 per person
Participants: 2 marketing coordinators

Current roles: Marketing Coordinator ($52,000/year)
After training: Digital Marketing Analyst ($62,000/year)

Better job outcomes: New role requires advanced analytics skills, manages larger budgets ($200K+), leads campaigns, reports to senior management.
      `.trim();

      const response = await sendMessageToAgent('etg-writer', message);

      // Response should contain key "better job" elements
      expect(response.content.toLowerCase()).toMatch(/better job|promotion|advancement|increased responsibility/);

      // Should mention salary increase
      expect(response.content).toMatch(/\$62,000|\$10,000/);

      // Should describe increased responsibilities
      expect(response.content.toLowerCase()).toMatch(/lead|manage|responsibilit/);

      // Grade strategic value
      const grading = await gradeWithLLM({
        task: 'Evaluate the clarity and strength of "better job" outcome justification in ETG business case',
        output: response.content,
        rubric: {
          criteria: [
            'Clear definition of current role vs. future role',
            'Quantifiable benefits (salary, budget responsibility)',
            'Explanation of increased responsibility and complexity',
            'Connection between training and job advancement',
            'Compelling case for why training enables promotion'
          ],
          scale: '1-5 where 5 is excellent'
        },
        context: message
      });

      // Better job justification should be strong
      expect(grading.overallScore).toBeGreaterThanOrEqual(3.5);

      console.log('\n📊 Better Job Outcome Quality:');
      console.log(`   Score: ${grading.overallScore}/5`);
      console.log(`   Feedback: ${grading.feedback}\n`);

    }, 60000);

  });

  describe('Compliance with ETG Requirements', () => {

    test('Business case addresses all mandatory ETG elements', async () => {
      const message = `
Create ETG business case:

Training: Supply Chain Management Professional Certificate
Provider: Canadian Supply Chain Institute
Duration: 45 hours
Cost: $3,200
Participants: 1 operations manager

Current: Operations Manager ($68,000)
Future: Senior Supply Chain Manager ($82,000)

Better job: Will oversee entire supply chain (5 warehouses), manage $10M inventory, lead team of 8, implement new WMS system.
      `.trim();

      const response = await sendMessageToAgent('etg-writer', message);

      // Check for mandatory elements
      const content = response.content.toLowerCase();

      // Should include training details
      expect(content).toMatch(/supply chain|training|certificate/);

      // Should include cost/budget information
      expect(content).toMatch(/\$3,200|\$3,200.00|cost/);

      // Should include participant information
      expect(content).toMatch(/operations manager|participant/);

      // Should include better job outcome
      expect(content).toMatch(/better job|promotion|senior supply chain manager/);

      // Should include business justification
      expect(content).toMatch(/justification|need|benefit|improve/);

      // Grade completeness
      const grading = await gradeWithLLM({
        task: 'Evaluate completeness of ETG business case (all required elements present)',
        output: response.content,
        rubric: {
          criteria: [
            'Training program details clearly stated',
            'Cost and budget information included',
            'Participant current role and salary described',
            'Better job outcome clearly defined',
            'Business justification for training provided',
            'Structured and organized presentation'
          ],
          scale: '1-5 where 5 is complete'
        }
      });

      expect(grading.overallScore).toBeGreaterThanOrEqual(4.0);

      console.log('\n📊 Business Case Completeness:');
      console.log(`   Score: ${grading.overallScore}/5`);
      console.log(`   Missing elements (if any): ${grading.feedback}\n`);

    }, 60000);

  });

});

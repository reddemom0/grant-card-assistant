/**
 * Training & Skills Development Evaluation Rubric Template
 * Based on internal scoring rubric for training funding programs
 */

export const EVALUATION_RUBRIC = {
  grantType: 'training',
  documentType: 'evaluation-rubric',

  branding: {
    headerColor: '#0047AB',
    useCleanFormatting: true
  },

  sections: [
    {
      type: 'title',
      text: 'Evaluation Rubric: {{program_name}}',
      style: 'title-branded'
    },
    {
      type: 'paragraph',
      text: 'Client: {{client_name}}',
      style: 'bold'
    },
    {
      type: 'paragraph',
      text: 'Evaluated by: {{evaluator_name}}'
    },
    {
      type: 'paragraph',
      text: 'Date: {{evaluation_date}}'
    },

    {
      type: 'info-box',
      style: 'info-blue',
      text: 'This rubric evaluates training grants across two dimensions: Grant Difficulty (application complexity) and Grant Score (value/attractiveness to clients).'
    },

    // GRANT DIFFICULTY SECTION
    {
      type: 'header',
      level: 1,
      text: 'Grant Difficulty Score',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: 'Measures the complexity of the application process. Higher score = more complex.'
    },

    {
      type: 'scoring-table',
      headers: ['Score', 'Criteria', 'Tips'],
      rows: [
        {
          score: '5.0',
          criteria: 'Must meet at least 6 of the 7 following criteria:\n• Require alternative training providers for comparison purposes\n• Provide written rationale for why training is needed\n• Training provider must be within the province (or provide rationale if not)\n• Need to provide course outline for training\n• Participants need to complete a Participant Information Form (PIF)\n• Training provider must be certified (e.g. PTIB, or submit resume)\n• Need to book a call with the program for vetting',
          tips: 'If there is no requirement for training provider to be within the province, or if training can be online, the grant will not meet this requirement (will drop in difficulty)',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: 'Must meet 5 of the following criteria:\n• Require alternative training providers for comparison purposes\n• Provide written rationale for why training is needed\n• Training provider must be within the province (or provide rationale if not)\n• Need to provide course outline for training\n• Participants need to complete a Participant Information Form (PIF)\n• Training provider must be certified (e.g. PTIB, or submit resume)\n• Need to book a call with the program for vetting',
          tips: '',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: 'Must meet 3-4 of the following criteria:\n• Require alternative training providers for comparison purposes\n• Provide written rationale for why training is needed\n• Training provider must be within the province (or provide rationale if not)\n• Need to provide course outline for training\n• Participants need to complete a Participant Information Form (PIF)\n• Training provider must be certified (e.g. PTIB, or submit resume)\n• Need to book a call with the program for vetting',
          tips: '',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: 'Must meet 2 of the following criteria:\n• Require alternative training providers for comparison purposes\n• Provide written rationale for why training is needed\n• Training provider must be within the province (or provide rationale if not)\n• Need to provide course outline for training\n• Participants need to complete a Participant Information Form (PIF)\n• Training provider must be certified (e.g. PTIB, or submit resume)\n• Need to book a call with the program for vetting',
          tips: '',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: 'Must meet 1 of the following criteria:\n• Require alternative training providers for comparison purposes\n• Provide written rationale for why training is needed\n• Training provider must be within the province (or provide rationale if not)\n• Need to provide course outline for training\n• Participants need to complete a Participant Information Form (PIF)\n• Training provider must be certified (e.g. PTIB, or submit resume)\n• Need to book a call with the program for vetting',
          tips: '',
          style: 'score-1'
        }
      ]
    },

    // GRANT SCORE SECTION
    {
      type: 'header',
      level: 1,
      text: 'Grant Value Score',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: 'Measures how valuable/attractive the grant is to clients. Higher score = better grant opportunity.'
    },

    {
      type: 'scoring-table',
      headers: ['Score', 'Criteria'],
      rows: [
        {
          score: '5.0',
          criteria: 'Must meet at least 4 of the 5 following criteria:\n• Employers of all sectors and sizes are eligible\n• Max grant amount is $10k+\n• Funding contribution must be 50%+\n• Retroactive\n• Allows for group training',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: 'Must meet 3 of the 5 following criteria:\n• Employers of all sectors and sizes are eligible\n• Max grant amount is $10k+\n• Funding contribution must be 50%+\n• Retroactive\n• Allows for group training\n\nExample: Driver Training Grant',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: 'Must meet 2 of the 5 following criteria:\n• Employers of all sectors and sizes are eligible\n• Max grant amount is $10k+\n• Funding contribution must be 50%+\n• Retroactive\n• Allows for group training',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: 'Must meet 1 of the 5 following criteria:\n• Employers of all sectors and sizes are eligible\n• Max grant amount is $10k+\n• Funding contribution must be 50%+\n• Retroactive\n• Allows for group training',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: 'Does not meet any of the following criteria:\n• Employers of all sectors and sizes are eligible\n• Max grant amount is $10k+\n• Funding contribution must be 50%+\n• Retroactive\n• Allows for group training',
          style: 'score-1'
        }
      ]
    },

    // FINAL EVALUATION
    {
      type: 'header',
      level: 1,
      text: 'Final Evaluation',
      style: 'header-branded'
    },

    {
      type: 'evaluation-summary',
      fields: [
        {
          label: 'Grant Difficulty Score',
          value: '{{difficulty_score}}',
          style: 'field-row'
        },
        {
          label: 'Grant Value Score',
          value: '{{value_score}}',
          style: 'field-row'
        },
        {
          label: 'Overall Assessment',
          value: '{{overall_assessment}}',
          style: 'field-row'
        },
        {
          label: 'Client Recommendation',
          value: '{{recommendation}}',
          style: 'field-row-large'
        }
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Priority Rating',
      style: 'header-branded'
    },
    {
      type: 'priority-scale',
      items: [
        { rating: 'A', range: '21 to 30', description: 'High priority - Excellent opportunity' },
        { rating: 'B', range: '11 to 20', description: 'Medium priority - Good opportunity' },
        { rating: 'C', range: '1 to 10', description: 'Low priority - Consider alternatives' }
      ]
    },

    {
      type: 'paragraph',
      text: 'Selected Priority: {{priority_rating}}',
      style: 'bold-large'
    }
  ],

  defaultData: {
    program_name: '[Training Program Name]',
    client_name: '[Client Company Name]',
    evaluator_name: '[Your Name]',
    evaluation_date: '[Date]',
    difficulty_score: '[1.0-5.0]',
    value_score: '[1.0-5.0]',
    overall_assessment: '[Brief assessment summary]',
    recommendation: '[Detailed recommendation for client]',
    priority_rating: '[A/B/C]'
  }
};

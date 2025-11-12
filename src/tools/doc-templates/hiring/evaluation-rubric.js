/**
 * Hiring & Wage Subsidies Evaluation Rubric Template
 * Based on internal scoring rubric for hiring/wage subsidy programs
 */

export const EVALUATION_RUBRIC = {
  grantType: 'hiring',
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
      text: 'This rubric evaluates hiring grants across two dimensions: Grant Difficulty (application complexity) and Grant Score (value/attractiveness to clients).'
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
      headers: ['Score', 'Criteria'],
      rows: [
        {
          score: '5.0',
          criteria: 'Meets at least 5 of the following 6 criteria:\n• Requires training plan\n• Requires candidates to participate in mandatory training\n• Must have screening interview with the program\n• Has a pre-approval step\n• Asks for letters of any kind\n• Requires monthly or bi-weekly reimbursement claims',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: 'Meets 4 of the following 6 criteria:\n• Requires training plan\n• Requires candidates to participate in mandatory training\n• Must have screening interview with the program\n• Has a pre-approval step\n• Asks for letters of any kind\n• Requires monthly or bi-weekly reimbursement claims',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: 'Meets 3 of the following 6 criteria:\n• Requires training plan\n• Requires candidates to participate in mandatory training\n• Must have screening interview with the program\n• Has a pre-approval step\n• Asks for letters of any kind\n• Requires monthly or bi-weekly reimbursement claims',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: 'Meets 2 of the following 6 criteria:\n• Requires training plan\n• Requires candidates to participate in mandatory training\n• Must have screening interview with the program\n• Has a pre-approval step\n• Asks for letters of any kind\n• Requires monthly or bi-weekly reimbursement claims',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: 'Meets 1 of the following 6 criteria:\n• Requires training plan\n• Requires candidates to participate in mandatory training\n• Must have screening interview with the program\n• Has a pre-approval step\n• Asks for letters of any kind\n• Requires monthly or bi-weekly reimbursement claims',
          style: 'score-1'
        }
      ]
    },

    {
      type: 'callout',
      style: 'info-blue',
      text: 'Notes:\n• Training plan = document listing on-the-job training the employer will provide\n• Mandatory training = program-provided training\n• Pre-approval step example: SWPP programs'
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
      headers: ['Score', 'Criteria', 'Tips'],
      rows: [
        {
          score: '5.0',
          criteria: '✓ Must meet ALL of the following:\n• Grant Difficulty score of ≤3.0\n• Turnaround Time of ~7 or fewer business days (e.g. 10 days is okay)\n• Wide employer eligibility (available to all sectors and/or all provinces)\n• Wide participant eligibility (e.g. no age restriction, allows visa holders, current employees)\n• Sizeable program starting budget (over 1000 spots)\n• Must be retroactive\n• Max grant amount must be ~$10k+',
          tips: '• Will need to use discretion for the 2 eligibility criteria\n• To calculate spots: Google program budget ÷ max grant amount\n• Grants requiring Technology Readiness Level tighten eligibility significantly',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: '• Must meet at least 3 of the 4 following criteria:\n   - Grant Difficulty score of ≤3.0\n   - Turnaround Time of ≤7 business days\n   - Wide employer eligibility\n   - Wide participant eligibility\n• Must be retroactive\n• Max grant amount is ~$7k-9k',
          tips: '• If grant meets all criteria but amount is slightly off, weigh other factors more\n• Use best judgment! Some grants won\'t meet all criteria perfectly\n\nFactors from most to least important:\n1. Employer/participant eligibility\n2. Retroactivity\n3. Grant amount\n4. Difficulty/turnaround time\n\n(Retroactivity and grant amount are very close in importance)',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: '• Must meet at least 2 of the 4 following criteria:\n   - Grant Difficulty score of ≤3.0\n   - Turnaround Time of ≤7 business days\n   - Wide employer eligibility\n   - Wide participant eligibility\n• Not retroactive OR limited retroactivity (only within 1st week of start date)\n• Max grant amount is ~$5k-7k',
          tips: '',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: '• Inflexible employer eligibility (only certain municipalities/regions OR niche industry like arts, educational services)\n• Strict participant eligibility (must select from pre-screened pool, must be unemployed, only Indigenous candidates or candidates with disabilities allowed, cannot be previous employee)\n• Not retroactive\n• Max grant amount is ~$4-5k',
          tips: '',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: '• Strict employer eligibility (only certain municipalities/regions AND niche industry)\n• Strict participant eligibility (same restrictions as 2.0)\n• Not retroactive\n• Max grant amount is <$3k',
          tips: '',
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
    program_name: '[Hiring Program Name]',
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

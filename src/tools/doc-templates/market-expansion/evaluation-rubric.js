/**
 * Market Expansion & Export Development Evaluation Rubric Template
 * Adapted for export programs like CanExport, BCAFE, EDC, trade missions
 */

export const EVALUATION_RUBRIC = {
  grantType: 'market-expansion',
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
      text: '**For use by:** Granted Strategy Team',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Client:** {{client_name}}',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Evaluated by:** {{evaluator_name}}',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Date:** {{evaluation_date}}',
      style: 'normal'
    },
    {
      type: 'divider'
    },

    {
      type: 'info-box',
      style: 'info-blue',
      text: 'This rubric evaluates market expansion grants across two dimensions: Grant Difficulty (application complexity) and Grant Score (value/attractiveness to clients).'
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
          criteria: 'Meets at least 5 of the following 6 criteria:\n• Requires detailed market research documentation\n• Multi-stage approval process (EOI + Application)\n• Requires letters of support from distributors/partners\n• Needs export business plan with financial projections\n• Requires claims submission with receipts and proof of activities\n• Must complete pre-approval interview or assessment',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: 'Meets 4 of the following criteria:\n• Requires detailed market research documentation\n• Multi-stage approval process (EOI + Application)\n• Requires letters of support from distributors/partners\n• Needs export business plan with financial projections\n• Requires claims submission with receipts and proof of activities\n• Must complete pre-approval interview or assessment',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: 'Meets 3 of the following criteria:\n• Requires detailed market research documentation\n• Multi-stage approval process (EOI + Application)\n• Requires letters of support from distributors/partners\n• Needs export business plan with financial projections\n• Requires claims submission with receipts and proof of activities\n• Must complete pre-approval interview or assessment',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: 'Meets 2 of the following criteria:\n• Requires detailed market research documentation\n• Multi-stage approval process (EOI + Application)\n• Requires letters of support from distributors/partners\n• Needs export business plan with financial projections\n• Requires claims submission with receipts and proof of activities\n• Must complete pre-approval interview or assessment',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: 'Meets 1 or fewer of the following criteria:\n• Requires detailed market research documentation\n• Multi-stage approval process (EOI + Application)\n• Requires letters of support from distributors/partners\n• Needs export business plan with financial projections\n• Requires claims submission with receipts and proof of activities\n• Must complete pre-approval interview or assessment',
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
          criteria: '✓ Must meet ALL of the following:\n• Grant Difficulty score of ≤3.0\n• Turnaround Time of ≤30 days for decision\n• Wide company eligibility (all sectors, all provinces)\n• Broad eligible activities (trade shows, marketing, travel, consultants, etc.)\n• Max grant amount $50k+\n• Funding contribution 50%+\n• Covers international AND domestic expenses\n• Multiple intakes per year',
          style: 'score-5'
        },
        {
          score: '4.0',
          criteria: 'Must meet at least 5 of the following:\n• Grant Difficulty score of ≤3.0\n• Turnaround Time of ≤45 days\n• Wide company eligibility\n• Broad eligible activities\n• Max grant amount $30k-50k\n• Funding contribution 50%+\n• Covers international AND domestic expenses\n• Multiple intakes per year',
          style: 'score-4'
        },
        {
          score: '3.0',
          criteria: 'Must meet at least 4 of the following:\n• Grant Difficulty score of ≤3.0\n• Turnaround Time of ≤60 days\n• Wide company eligibility\n• Broad eligible activities\n• Max grant amount $15k-30k\n• Funding contribution 40%+\n• Covers international expenses\n• At least 2 intakes per year',
          style: 'score-3'
        },
        {
          score: '2.0',
          criteria: 'Must meet at least 3 of the following:\n• Grant Difficulty score of ≤3.0\n• Turnaround Time of ≤90 days\n• Sector-specific or region-specific eligibility\n• Limited eligible activities\n• Max grant amount $10k-15k\n• Funding contribution 30-40%\n• Limited expense coverage\n• Annual intake only',
          style: 'score-2'
        },
        {
          score: '1.0',
          criteria: 'Meets 2 or fewer favorable criteria:\n• Highly restrictive eligibility (specific sectors AND regions)\n• Very limited eligible activities\n• Max grant amount <$10k\n• Funding contribution <30%\n• Long turnaround time (>90 days)\n• Infrequent intakes',
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
        { rating: 'A', range: '21 to 30', description: 'High priority - Excellent export opportunity' },
        { rating: 'B', range: '11 to 20', description: 'Medium priority - Good export opportunity' },
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
    program_name: 'CanExport Innovation',
    client_name: '[Company Name]',
    evaluator_name: 'Granted Consulting',
    evaluation_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    difficulty_score: '[Score from 1.0 to 5.0]',
    value_score: '[Score from 1.0 to 5.0]',
    overall_assessment: '[Summary of grant fit for this client]',
    recommendation: '[Detailed recommendation: Should client pursue this grant? What are the key considerations?]',
    priority_rating: '[A = High Priority | B = Medium Priority | C = Low Priority]'
  }
};

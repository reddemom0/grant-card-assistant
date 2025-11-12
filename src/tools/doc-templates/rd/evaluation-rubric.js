/**
 * R&D & Innovation Evaluation Rubric Template
 * Based on RTRI weighted multi-criteria scoring system
 */

export const EVALUATION_RUBRIC = {
  grantType: 'rd',
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
      type: 'callout',
      style: 'warning-red',
      text: 'INSTRUCTION: Review proposed project with client and complete rubric below. The weighted score should tally at least 70 in order for us to proceed with an application.'
    },

    {
      type: 'header',
      level: 1,
      text: 'Weighted Multi-Criteria Evaluation',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: 'Score each criterion on a scale of 0-5. The weighted score will be calculated automatically: (Score × Weight) / 5'
    },

    // EVALUATION CRITERIA TABLE
    {
      type: 'weighted-criteria-table',
      headers: ['Evaluation Criterion', 'Indicators / What to Look For', 'Weight (%)', 'Score (0-5)', 'Weighted Score', 'Evaluator Notes'],
      rows: [
        {
          criterion: 'Capacity & Readiness / Timeline Feasibility',
          indicators: '• Has the applicant demonstrated that they can carry out a significant portion of work within the required timeframe?\n• Realistic project plan, milestones, risk mitigation, resource commitment\n• Dedicated personnel for application + execution',
          weight: 7,
          scoreGuidance: '0 = not addressed / unrealistic;\n5 = timeline fully credible, with contingency planning',
          score: '{{score_capacity}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_capacity}}'
        },
        {
          criterion: 'Documentation Availability',
          indicators: '• Business plan, financials, technical documents ready\n• Requires minor modifications only\n• All supporting documents available',
          weight: 7,
          scoreGuidance: '0 = not addressed; 5 = fully met',
          score: '{{score_documentation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_documentation}}'
        },
        {
          criterion: 'Innovation & Technology Readiness',
          indicators: '• What is the TRL (Technology Readiness Level)?\n• Clear innovation beyond existing solutions\n• Technical feasibility demonstrated\n• R&D risk assessment and mitigation plan\n• Willingness to undergo technical review (e.g., NRC-IRAP)',
          weight: 10,
          scoreGuidance: '0 = not addressed; 5 = fully met\nIf tech is core, this is critical',
          score: '{{score_innovation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_innovation}}'
        },
        {
          criterion: 'IP Strategy & Protection',
          indicators: '• IP strategy defined (patents, trademarks, trade secrets)\n• Level of emphasis from program on IP\n• Additional funding available for IP under program?\n• Prior IP engagement (IP professional consulted)\n• Competitive advantage through IP',
          weight: 5,
          scoreGuidance: '0 = no strategy; 5 = comprehensive IP strategy with protection plan',
          score: '{{score_ip}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_ip}}'
        },
        {
          criterion: 'Commercialization Potential / Market Demand',
          indicators: '• Evidence of market demand, customer commitments, sales pipeline\n• Letters of intent, contracts, market research\n• Competitive analysis and positioning\n• Path to commercialization clearly defined\n• Timeline to reach market',
          weight: 10,
          scoreGuidance: '0 = not addressed; 5 = strong evidence with customer commitments',
          score: '{{score_market}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_market}}'
        },
        {
          criterion: 'Financial Capacity & Viability',
          indicators: '• Financial statements, cash flow projections\n• Ability to manage project costs\n• Risk analysis, break-even, contingency planning\n• Financial health and stability\n• Profitability trends\n• Not overly grant-reliant',
          weight: 10,
          scoreGuidance: '0 = poor financial health (red flag); 5 = strong financial position',
          score: '{{score_financial}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_financial}}'
        },
        {
          criterion: 'Management Capability & Team Experience',
          indicators: '• Experience / credentials of management, project team\n• Track record with similar projects\n• Technical expertise within team\n• Project management experience (work packages, milestones, budgeting)\n• Adequate human resources for execution',
          weight: 7,
          scoreGuidance: '0 = inadequate team; 5 = highly qualified team with proven track record',
          score: '{{score_management}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_management}}'
        },
        {
          criterion: 'Implementation Capacity & Resources',
          indicators: '• Physical space adequate for project\n• Equipment and technology assets available or planned\n• Partnerships and collaborations established\n• Resource commitment demonstrated\n• Scalability of infrastructure',
          weight: 5,
          scoreGuidance: '0 = inadequate resources; 5 = all resources secured or clearly planned',
          score: '{{score_resources}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_resources}}'
        },
        {
          criterion: 'Growth Potential / Business Performance',
          indicators: '• Past growth in revenues, profits, customers, jobs\n• Projected future growth\n• Evidence of scalability\n• Company history and trajectory\n• Investment / VC backing (if applicable)',
          weight: 7,
          scoreGuidance: '0 = no growth trajectory; 5 = consistent growth with credible future plan',
          score: '{{score_growth}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_growth}}'
        },
        {
          criterion: 'Economic & Regional Benefit',
          indicators: '• Job creation (direct and indirect)\n• Productivity gains, cost savings\n• Supply chain strengthening\n• Regional economic impact\n• Value for money\n• Located in rural/remote region (bonus)',
          weight: 10,
          scoreGuidance: '0 = minimal impact; 5 = high regional multiplier effects',
          score: '{{score_economic}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_economic}}'
        },
        {
          criterion: 'Sector Fit / Strategic Priority Alignment',
          indicators: '• Alignment with program priorities\n• Strategic sector (clean tech, AI, advanced manufacturing, etc.)\n• Government priority alignment\n• Industry needs addressed',
          weight: 7,
          scoreGuidance: '0 = poor alignment; 5 = perfect alignment with bonus sectors',
          score: '{{score_sector}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_sector}}'
        },
        {
          criterion: 'Leverage / Co-Funding Strength',
          indicators: '• Confirmed non-program contributions above minimum\n• Additional non-government funding\n• Ratio of applicant investment to grant request\n• Other funding sources secured',
          weight: 5,
          scoreGuidance: '0 = minimal co-funding; 5 = strong leverage from multiple sources',
          score: '{{score_leverage}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_leverage}}'
        },
        {
          criterion: 'Sustainability & Environmental Impact',
          indicators: '• GHG reduction targets and timeline\n• Energy efficiency improvements\n• Environmental sustainability initiatives\n• Clean technology integration\n• Regulatory compliance',
          weight: 5,
          scoreGuidance: '0 = not addressed; 5 = significant environmental benefits quantified',
          score: '{{score_sustainability}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_sustainability}}'
        },
        {
          criterion: 'Application Timeline Urgency',
          indicators: '• Ability to meet application deadline\n• Project start date alignment\n• Time-sensitive opportunities',
          weight: 5,
          scoreGuidance: '0 = cannot meet deadline; 5 = ready to submit immediately',
          score: '{{score_timeline}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_timeline}}'
        }
      ]
    },

    // TOTAL SCORE SUMMARY
    {
      type: 'header',
      level: 1,
      text: 'Scoring Summary',
      style: 'header-branded'
    },

    {
      type: 'score-summary-table',
      rows: [
        {
          label: 'Total Raw Score (sum of all scores)',
          value: '{{total_raw_score}}',
          formula: 'SUM(all scores)',
          style: 'summary-row'
        },
        {
          label: 'Total Weighted Score',
          value: '{{total_weighted_score}}',
          formula: 'SUM(all weighted scores)',
          style: 'summary-row-bold'
        },
        {
          label: 'Threshold for Approval',
          value: '70',
          formula: 'Minimum required',
          style: 'threshold-row'
        },
        {
          label: 'Status',
          value: '{{approval_status}}',
          formula: 'PASS if ≥70, FAIL if <70',
          style: 'status-row'
        }
      ]
    },

    {
      type: 'callout',
      style: 'info-blue',
      text: '✓ A weighted score of 70 or higher indicates we should proceed with the application.\n✗ A score below 70 suggests significant gaps that must be addressed before proceeding.'
    },

    // FINAL RECOMMENDATION
    {
      type: 'header',
      level: 1,
      text: 'Final Assessment & Recommendation',
      style: 'header-branded'
    },

    {
      type: 'evaluation-summary',
      fields: [
        {
          label: 'Overall Strengths',
          value: '{{overall_strengths}}',
          style: 'field-row-large'
        },
        {
          label: 'Key Weaknesses / Gaps',
          value: '{{key_weaknesses}}',
          style: 'field-row-large'
        },
        {
          label: 'Recommendation',
          value: '{{recommendation}}',
          style: 'field-row-large'
        },
        {
          label: 'Next Steps',
          value: '{{next_steps}}',
          style: 'field-row-large'
        }
      ]
    }
  ],

  defaultData: {
    program_name: '[R&D Program Name]',
    client_name: '[Client Company Name]',
    evaluator_name: '[Your Name]',
    evaluation_date: '[Date]',

    // Scores (0-5 for each criterion)
    score_capacity: '0',
    score_documentation: '0',
    score_innovation: '0',
    score_ip: '0',
    score_market: '0',
    score_financial: '0',
    score_management: '0',
    score_resources: '0',
    score_growth: '0',
    score_economic: '0',
    score_sector: '0',
    score_leverage: '0',
    score_sustainability: '0',
    score_timeline: '0',

    // Notes for each criterion
    notes_capacity: '',
    notes_documentation: '',
    notes_innovation: '',
    notes_ip: '',
    notes_market: '',
    notes_financial: '',
    notes_management: '',
    notes_resources: '',
    notes_growth: '',
    notes_economic: '',
    notes_sector: '',
    notes_leverage: '',
    notes_sustainability: '',
    notes_timeline: '',

    // Summary
    total_raw_score: '[Auto-calculated]',
    total_weighted_score: '[Auto-calculated]',
    approval_status: '[PASS/FAIL]',

    // Final assessment
    overall_strengths: '[List key strengths]',
    key_weaknesses: '[List gaps to address]',
    recommendation: '[Proceed / Do not proceed / Conditional]',
    next_steps: '[Action items]'
  }
};

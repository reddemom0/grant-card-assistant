/**
 * Loan & Financing Evaluation Rubric Template
 * Based on weighted multi-criteria scoring system for complex financing decisions
 */

export const EVALUATION_RUBRIC = {
  grantType: 'loan',
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
          criterion: 'Financial Capacity & Creditworthiness',
          indicators: '• Strong financial statements (3 years)\n• Credit history clean (no bankruptcies/defaults)\n• Healthy debt-to-equity ratio\n• Positive cash flow\n• Profitability trends\n• Ability to service debt',
          weight: 15,
          scoreGuidance: '0 = poor financial health (red flag); 5 = excellent financial position',
          score: '{{score_financial}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_financial}}'
        },
        {
          criterion: 'Collateral & Security',
          indicators: '• Adequate collateral to secure loan\n• Collateral valuation completed\n• Personal guarantees available\n• Asset quality and liquidity\n• First or second position security',
          weight: 10,
          scoreGuidance: '0 = insufficient collateral; 5 = strong collateral coverage (>150%)',
          score: '{{score_collateral}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_collateral}}'
        },
        {
          criterion: 'Business Viability & Revenue Stability',
          indicators: '• Stable revenue sources\n• Not grant-reliant\n• Diversified customer base\n• Strong market position\n• Recurring revenue model\n• Historical performance',
          weight: 12,
          scoreGuidance: '0 = unstable/grant-dependent; 5 = strong stable revenues',
          score: '{{score_viability}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_viability}}'
        },
        {
          criterion: 'Repayment Capacity & Cash Flow',
          indicators: '• Cash flow projections support repayment\n• Debt service coverage ratio >1.25\n• Contingency plans in place\n• Realistic repayment schedule\n• Buffer for unexpected costs',
          weight: 12,
          scoreGuidance: '0 = cannot support repayment; 5 = strong coverage with buffer',
          score: '{{score_repayment}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_repayment}}'
        },
        {
          criterion: 'Project Feasibility & ROI',
          indicators: '• Clear business case for loan use\n• Realistic timeline and milestones\n• Expected ROI clearly defined\n• Revenue/cost improvement quantified\n• Risk assessment completed',
          weight: 10,
          scoreGuidance: '0 = not feasible; 5 = highly feasible with strong ROI',
          score: '{{score_feasibility}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_feasibility}}'
        },
        {
          criterion: 'Management Capability & Experience',
          indicators: '• Experienced management team\n• Track record with similar projects\n• Financial management competency\n• Project management experience\n• Succession planning',
          weight: 8,
          scoreGuidance: '0 = inadequate team; 5 = highly qualified team with proven track record',
          score: '{{score_management}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_management}}'
        },
        {
          criterion: 'Implementation Capacity & Resources',
          indicators: '• Physical space adequate\n• Equipment/assets in place or planned\n• Human resources sufficient\n• Partnerships established\n• Execution plan credible',
          weight: 6,
          scoreGuidance: '0 = inadequate resources; 5 = all resources secured',
          score: '{{score_capacity}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_capacity}}'
        },
        {
          criterion: 'Documentation Availability',
          indicators: '• Financial statements ready (3 years)\n• Business plan complete\n• All required documents available\n• Minimal modifications needed',
          weight: 5,
          scoreGuidance: '0 = not ready; 5 = all documents complete',
          score: '{{score_documentation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_documentation}}'
        },
        {
          criterion: 'Growth Potential & Business Performance',
          indicators: '• Historical growth trajectory\n• Projected future growth\n• Market opportunities identified\n• Scalability potential\n• Competitive positioning',
          weight: 7,
          scoreGuidance: '0 = declining/stagnant; 5 = strong consistent growth',
          score: '{{score_growth}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_growth}}'
        },
        {
          criterion: 'Economic & Regional Benefit',
          indicators: '• Job creation/retention\n• Regional economic impact\n• Supply chain benefits\n• Community investment\n• Value for money',
          weight: 6,
          scoreGuidance: '0 = minimal impact; 5 = significant regional benefits',
          score: '{{score_economic}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_economic}}'
        },
        {
          criterion: 'Sector Fit & Strategic Alignment',
          indicators: '• Alignment with program priorities\n• Strategic sector\n• Government priority sectors\n• Industry needs addressed',
          weight: 5,
          scoreGuidance: '0 = poor alignment; 5 = perfect alignment',
          score: '{{score_sector}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_sector}}'
        },
        {
          criterion: 'Leverage / Co-Funding',
          indicators: '• Applicant contribution above minimum\n• Other funding sources secured\n• Strong leverage ratio\n• Skin in the game demonstrated',
          weight: 4,
          scoreGuidance: '0 = minimal contribution; 5 = strong leverage',
          score: '{{score_leverage}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_leverage}}'
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
    program_name: '[Loan Program Name]',
    client_name: '[Client Company Name]',
    evaluator_name: '[Your Name]',
    evaluation_date: '[Date]',

    // Scores (0-5 for each criterion)
    score_financial: '0',
    score_collateral: '0',
    score_viability: '0',
    score_repayment: '0',
    score_feasibility: '0',
    score_management: '0',
    score_capacity: '0',
    score_documentation: '0',
    score_growth: '0',
    score_economic: '0',
    score_sector: '0',
    score_leverage: '0',

    // Notes for each criterion
    notes_financial: '',
    notes_collateral: '',
    notes_viability: '',
    notes_repayment: '',
    notes_feasibility: '',
    notes_management: '',
    notes_capacity: '',
    notes_documentation: '',
    notes_growth: '',
    notes_economic: '',
    notes_sector: '',
    notes_leverage: '',

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

/**
 * Investment & Equity Evaluation Rubric Template
 * Based on weighted multi-criteria scoring system for equity investment decisions
 */

export const EVALUATION_RUBRIC = {
  grantType: 'investment',
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
          criterion: 'Market Traction & Validation',
          indicators: '• Revenue, users, customers (quantified)\n• Growth trajectory (MoM, YoY)\n• Customer acquisition and retention rates\n• Product-market fit demonstrated\n• Letters of intent or contracts\n• Market validation evidence',
          weight: 12,
          scoreGuidance: '0 = no traction; 5 = strong traction with validated demand',
          score: '{{score_traction}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_traction}}'
        },
        {
          criterion: 'Growth Potential & Scalability',
          indicators: '• Large addressable market (TAM, SAM, SOM)\n• Scalable business model\n• Path to significant revenue growth\n• 10x potential demonstrated\n• Market timing and opportunity\n• Expansion strategy credible',
          weight: 12,
          scoreGuidance: '0 = limited potential; 5 = exceptional growth potential',
          score: '{{score_growth}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_growth}}'
        },
        {
          criterion: 'Team Quality & Experience',
          indicators: '• Founder/CEO track record\n• Complementary skills in team\n• Domain expertise\n• Previous startup experience\n• Ability to attract talent\n• Coachability and learning agility',
          weight: 15,
          scoreGuidance: '0 = weak team; 5 = exceptional team with proven track record',
          score: '{{score_team}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_team}}'
        },
        {
          criterion: 'Innovation & Competitive Advantage',
          indicators: '• Unique value proposition\n• Technology/IP differentiation\n• Defensible competitive moats\n• Barriers to entry\n• Innovation beyond existing solutions\n• Difficult to replicate',
          weight: 10,
          scoreGuidance: '0 = no differentiation; 5 = strong unique advantages',
          score: '{{score_innovation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_innovation}}'
        },
        {
          criterion: 'Financial Health & Unit Economics',
          indicators: '• Current burn rate and runway\n• Path to profitability clear\n• CAC, LTV, and ratios healthy\n• Gross margins strong (>70% for SaaS)\n• Financial discipline demonstrated\n• Revenue quality (recurring vs one-time)',
          weight: 10,
          scoreGuidance: '0 = poor financials; 5 = strong unit economics and runway',
          score: '{{score_financials}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_financials}}'
        },
        {
          criterion: 'Valuation & Investment Terms',
          indicators: '• Valuation reasonable for stage\n• Comparable to market benchmarks\n• Cap table clean and founder-friendly\n• Investment terms fair\n• Dilution acceptable\n• Alignment of interests',
          weight: 8,
          scoreGuidance: '0 = unreasonable valuation; 5 = attractive valuation and terms',
          score: '{{score_valuation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_valuation}}'
        },
        {
          criterion: 'Traction & Execution Capability',
          indicators: '• Demonstrated ability to execute\n• Milestones achieved on time\n• Product development velocity\n• Sales/marketing execution\n• Resourcefulness\n• Pivoting capability when needed',
          weight: 8,
          scoreGuidance: '0 = poor execution; 5 = exceptional execution track record',
          score: '{{score_execution}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_execution}}'
        },
        {
          criterion: 'IP Strategy & Protection',
          indicators: '• IP strategy defined\n• Patents filed or planned\n• Trade secrets protected\n• Freedom to operate assessed\n• Competitive advantage through IP\n• IP budget allocated',
          weight: 5,
          scoreGuidance: '0 = no IP strategy; 5 = comprehensive IP protection',
          score: '{{score_ip}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_ip}}'
        },
        {
          criterion: 'Existing Investor Quality & Leverage',
          indicators: '• Quality of existing investors\n• Follow-on commitment from current investors\n• Co-investment secured\n• Strong leverage ratio\n• Syndicate strength',
          weight: 5,
          scoreGuidance: '0 = no other investors; 5 = strong investor syndicate',
          score: '{{score_investors}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_investors}}'
        },
        {
          criterion: 'Documentation & Readiness',
          indicators: '• Pitch deck compelling\n• Financial model detailed\n• Data room complete\n• Legal documents ready\n• Due diligence materials available',
          weight: 4,
          scoreGuidance: '0 = not ready; 5 = all documents excellent',
          score: '{{score_documentation}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_documentation}}'
        },
        {
          criterion: 'Economic & Strategic Impact',
          indicators: '• Job creation potential\n• Economic impact (Canada/region)\n• Strategic sector alignment\n• Innovation ecosystem contribution\n• Value for investment',
          weight: 6,
          scoreGuidance: '0 = minimal impact; 5 = significant strategic impact',
          score: '{{score_impact}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_impact}}'
        },
        {
          criterion: 'Exit Potential',
          indicators: '• Clear exit path (IPO, acquisition)\n• Acquirer interest or precedents\n• Market for exits in sector\n• Timeline to exit realistic (5-7 years)\n• Multiple exit scenarios',
          weight: 5,
          scoreGuidance: '0 = no exit path; 5 = clear compelling exit opportunities',
          score: '{{score_exit}}',
          weightedScore: 'FORMULA',
          notes: '{{notes_exit}}'
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
          label: 'Investment Thesis',
          value: '{{investment_thesis}}',
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
    program_name: '[Investment Program Name]',
    client_name: '[Client Company Name]',
    evaluator_name: '[Your Name]',
    evaluation_date: '[Date]',

    // Scores (0-5 for each criterion)
    score_traction: '0',
    score_growth: '0',
    score_team: '0',
    score_innovation: '0',
    score_financials: '0',
    score_valuation: '0',
    score_execution: '0',
    score_ip: '0',
    score_investors: '0',
    score_documentation: '0',
    score_impact: '0',
    score_exit: '0',

    // Notes for each criterion
    notes_traction: '',
    notes_growth: '',
    notes_team: '',
    notes_innovation: '',
    notes_financials: '',
    notes_valuation: '',
    notes_execution: '',
    notes_ip: '',
    notes_investors: '',
    notes_documentation: '',
    notes_impact: '',
    notes_exit: '',

    // Summary
    total_raw_score: '[Auto-calculated]',
    total_weighted_score: '[Auto-calculated]',
    approval_status: '[PASS/FAIL]',

    // Final assessment
    overall_strengths: '[List key strengths]',
    key_weaknesses: '[List gaps to address]',
    investment_thesis: '[Why this is a good investment]',
    recommendation: '[Proceed / Do not proceed / Conditional]',
    next_steps: '[Action items]'
  }
};

/**
 * Loan & Financing Interview Questions Template
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'loan',
  documentType: 'interview-questions',

  branding: {
    headerColor: '#0047AB',
    useCleanFormatting: true
  },

  sections: [
    {
      type: 'title',
      text: 'Interview Questions: {{program_name}}',
      style: 'title-branded'
    },
    {
      type: 'paragraph',
      text: 'Client: {{client_name}}',
      style: 'bold'
    },
    {
      type: 'paragraph',
      text: 'Date: {{interview_date}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Finances & Creditworthiness',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Provide an overview of your current financial status, including annual revenue, profit/loss, and any existing debt',
        'What is your credit history? Any bankruptcies or defaults?',
        'What is your current debt-to-equity ratio?',
        'What collateral can you provide to secure the loan?',
        'What is your projected revenue in the next 1-3 years?',
        'What are your sales projections? (domestic vs international, Year 1-3)',
        'Do you have the necessary financial resources to support loan repayment?',
        'What is your planned repayment schedule and strategy?',
        'Are you grant-reliant?',
        'Do you have a stable source of revenue to support your ongoing operations and loan repayment?',
        'Have you secured any other sources of financing for this project?',
        'What is your cash flow forecast for the loan repayment period?',
        'Has an executive or senior leader reviewed and endorsed this project financially?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Project Details & Use of Funds',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What are the key project activities and milestones?',
        'What costs will you incur to complete these activities?',
        'Please describe the project\'s readiness (i.e. start date and project needs)',
        'How will the loan funds be allocated? (detailed breakdown)',
        'What capital assets will you purchase with the loan? (equipment, machinery, technology)',
        'What is the total cost of capital assets, including installation and training?',
        'What is the expected return on investment from this project?',
        'How will this project improve your revenue or reduce costs?',
        'What is your timeline for project completion and ROI realization?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Feasibility and Risks',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What risks are associated with your project, and how will you manage them?',
        'How do you plan to mitigate or manage these risks?',
        'Do you have contingency plans in place if things do not go as expected?',
        'What specific actions will you take if a significant risk materializes?',
        'What is your backup plan if revenue projections are not met?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Project Management Team',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Who will be involved in the project?',
        'Outline the roles and responsibilities of each member of the project management team',
        'Provide an overview of the project management team\'s experience in successfully delivering projects',
        'Have you or your team successfully managed similar projects in the past? If so, please provide details.'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Resources',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Describe your business premises, including office, manufacturing, or retail space',
        'Do you own or lease your facilities?',
        'What equipment, machinery, or technology assets do you currently possess?',
        'What assets will be acquired with the loan funds?',
        'Are your existing assets adequate to meet the demands of your business?',
        'Have you established partnerships or collaborations with other organizations?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Impact on the Canadian Economy',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Describe any environmental or social sustainability initiatives associated with your project',
        'Describe the direct or indirect job creation your project will foster',
        'How much revenue in the short term (during the project) and long term (post-project) will this project generate?'
      ]
    }
  ],

  defaultData: {
    program_name: '[Loan Program Name]',
    client_name: '[Client Company Name]',
    interview_date: '[Date]'
  }
};

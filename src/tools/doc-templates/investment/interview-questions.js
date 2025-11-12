/**
 * Investment & Equity Interview Questions Template
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'investment',
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
      text: 'Business Model & Growth Potential',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Describe your business model and how you generate revenue',
        'What is your current stage of development? (pre-seed, seed, Series A, etc.)',
        'What is your traction to date? (users, customers, revenue)',
        'What is your market size and growth potential?',
        'What is your competitive advantage and defensibility?',
        'What is your path to profitability?',
        'What is your 3-5 year growth projection?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Finances & Valuation',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Provide an overview of your current financial status, including annual revenue, profit/loss, and any existing debt',
        'What is your current valuation? How was it determined?',
        'What is your projected revenue in the next 1-3 years?',
        'What are your sales projections? (domestic vs international, Year 1-3)',
        'What are your key financial metrics? (CAC, LTV, burn rate, runway)',
        'How much capital are you raising in this round?',
        'What is the planned use of the investment funds?',
        'What capital assets will you purchase? (equipment, technology, infrastructure)',
        'What is your cap table structure? Who are your current investors?',
        'What equity stake are you offering?',
        'Do you have existing debt or convertible notes?',
        'What is your exit strategy? (IPO, acquisition, etc.)',
        'Has an executive or senior leader reviewed and endorsed this fundraising strategy?',
        'What is your cash flow forecast for the next 24 months?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Competitors & Market Position',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What makes you stand apart from the competitors?',
        'What is the market demand for your product/service?',
        'How does your value proposition address the needs or pain points of your target customers?',
        'What strategies have you implemented to create a distinct position in the market?',
        'How do you build and maintain strong relationships with your customers?',
        'Have you conducted market research to identify the competitors in your target market?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Innovation & Technology',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What makes your product/service innovative?',
        'What is your technology stack?',
        'Do you have any proprietary technology or IP?',
        'What is your product roadmap for the next 12-24 months?',
        'Can your solution be scaled up or replicated in other markets?',
        'How will you deploy AI or advanced technology in your operations?',
        'What technical deliverables and milestones are planned?',
        'Do you have capabilities for real-time data extraction and analysis?',
        'What is the Technology Readiness Level (TRL) of your solution?'
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
        'What are the key risks facing your business?',
        'How do you plan to mitigate or manage these risks?',
        'Do you have contingency plans in place if things do not go as expected?',
        'What are your biggest challenges to achieving your growth targets?',
        'What could prevent you from achieving your exit strategy?'
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
        'Who are the founders and key team members?',
        'What relevant experience does the team have?',
        'What gaps exist in your team, and how do you plan to fill them?',
        'What is your team\'s track record with previous ventures?',
        'How diverse is your leadership team?',
        'Do you have an advisory board? Who are the advisors?',
        'What is your company culture and values?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Resources & Infrastructure',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Describe your current operational infrastructure',
        'What technology platforms or systems do you use?',
        'What partnerships or strategic relationships have you established?',
        'Do you have any key customer contracts or letters of intent?',
        'What resources will you need to scale?'
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
        'How many jobs will you create in the next 1-3 years?',
        'What is your impact on the Canadian tech/innovation ecosystem?',
        'How does your company contribute to Canadian economic growth?',
        'Do you plan to keep operations in Canada as you scale?'
      ]
    }
  ],

  defaultData: {
    program_name: '[Investment Program Name]',
    client_name: '[Client Company Name]',
    interview_date: '[Date]'
  }
};

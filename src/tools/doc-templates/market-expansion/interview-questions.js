/**
 * Market Expansion Interview Questions Template
 * Based on Readiness Assessment Question Bank - Post-RA Questions
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'market-expansion',
  documentType: 'interview-questions',

  // Branding configuration
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
      text: 'Export Market & Strategy',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Summarize your business goals and how exporting will contribute to your growth strategy',
        'How long have you been considering exporting your products/services?',
        'What research have you conducted regarding your target export market?',
        'Do you have the necessary production capacity, quality control systems, and distribution channels to support exporting?',
        'What market entry strategies will you employ (e.g. direct sales, distributorship, e-commerce, licensing)?',
        'Have you identified potential partners or distributors in the target markets?',
        'What is your pricing strategy for the export markets?',
        'Have you exported your products/services in the past? If yes, provide details of the countries/markets and outcomes',
        'What are your sales projections for domestic markets? (Year 1, Year 2, Year 3)',
        'What are your sales projections for international markets? (Year 1, Year 2, Year 3)',
        'What percentage of your production will be for export vs domestic consumption?',
        'What specific market expansion strategies will you employ to grow internationally?'
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
        'What specific problem or gap does your project aim to address that has not been effectively tackled before?',
        'What strategies have you implemented to create a distinct position in the market?',
        'How do you build and maintain strong relationships with your customers?',
        'Have you conducted market research to identify the competitors in your target market?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Finances',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Provide an overview of your current financial status, including annual revenue, profit/loss, and any existing debt',
        'What is your projected revenue in the next 1-3 years?',
        'Do you have the necessary financial resources to support your project? If not, how do you plan to obtain additional funding?',
        'Are you grant-reliant?',
        'Do you have a stable source of funding to support your ongoing operations?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Project Details',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What are the key project activities and milestones?',
        'What costs will you incur to complete these activities?',
        'Please describe the project\'s readiness (i.e. start date and project needs)'
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
        'Have you or your team successfully managed similar projects in the past? If so, please provide details.',
        'What lessons learned from previous projects will you apply to ensure the success of this project?',
        'How diverse is the project team, including leadership and decision-makers?',
        'Provide an overview of the project management team\'s experience in successfully delivering projects',
        'Describe the size and complexity of the projects previously managed by the team',
        'Are there any additional team members or external consultants involved in project management or delivery?',
        'How do you handle changes in project scope, requirements, or objectives?',
        'How do you ensure that project changes are properly documented and communicated?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Resources',
      style: 'header-branded'
    },
    {
      type: 'subheader',
      text: 'Physical:',
      style: 'subheader-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Describe your business premises, including office, manufacturing, or retail space',
        'Do you own or lease your facilities? If leasing, provide lease details (duration, costs, etc.)'
      ]
    },
    {
      type: 'subheader',
      text: 'Equipment and Technology:',
      style: 'subheader-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What equipment, machinery, or technology assets do you currently possess?',
        'Are your existing assets adequate to meet the demands of your business, or do you require additional resources?',
        'Do you have a plan for maintaining and upgrading your equipment and technology?',
        'What software, databases, or information systems do you use to manage your business processes?',
        'How do you handle data security and protect sensitive customer or business information?'
      ]
    },
    {
      type: 'subheader',
      text: 'Partnerships and Networks:',
      style: 'subheader-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Have you established partnerships or collaborations with other organizations or industry networks?',
        'How do these partnerships enhance your market opportunities?',
        'Do you participate in any business associations or industry-specific groups?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Creative Industries & Intellectual Property',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Does your business operate in creative industries? (film, TV, animation, interactive media, music, publishing)',
        'Do you own the intellectual property for your products/services?',
        'Are Canadian creators or creative professionals involved in your project?',
        'What percentage of your workforce consists of Canadian creators?',
        'What IP protections do you have in place? (copyrights, trademarks, patents)',
        'How will you protect your IP when entering international markets?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Diversity, Equity & Inclusion',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What DE&I measures has your company implemented?',
        'What is the gender breakdown of your leadership team?',
        'What is the ethnic diversity of your workforce?',
        'How does this project benefit equity-deserving groups?',
        'What barriers to participation have you identified for diverse groups, and how will you address them?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Budget & Financial Planning',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Can you provide a detailed breakdown of your project budget? (please prepare to share screen for 30-minute budget discussion)',
        'What are the major cost categories for this export project? (marketing, travel, trade shows, consultants, etc.)',
        'Do you have matching funds secured for this project?',
        'What is your contingency budget for unexpected costs?'
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
    program_name: 'CanExport Innovation',
    client_name: '[Company Name]',
    interview_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }
};

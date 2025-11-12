/**
 * R&D & Innovation Interview Questions Template
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'rd',
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
      text: 'Innovation & Technology',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What makes your project innovative?',
        'What is the TRL (Technology Readiness Level) of your innovation?',
        'What specific problem or gap does your project aim to address that has not been effectively tackled before?',
        'How does your project offer a new approach to an existing challenge?',
        'How could your project potentially change the field or industry in which it operates?',
        'What long-term impact do you anticipate as a result of your project\'s innovative elements?',
        'Have you conducted any preliminary testing or prototyping to demonstrate the innovation of your project?',
        'Can you provide examples of research, pilot projects, or case studies that support the innovative nature of your project?',
        'Can your innovative solution be scaled up or replicated in other settings?',
        'Are you eligible for SCALE.AI membership? (Canadian incorporated, AI-focused business)',
        'How will you deploy AI technology in your supply chain or operations?',
        'What technical deliverables and work packages are planned for this project?',
        'Do you have capabilities for real-time data extraction and analysis?',
        'What simulation tools or predictive models will you develop or utilize?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Sustainability & Clean Tech',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'How does this project assist your company towards sustainability? (i.e. GHG emissions, energy efficiency, regulatory compliance, reduced resource consumption etc.)',
        'What is your baseline GHG emissions level? (tonnes CO2e per year)',
        'What is your target GHG reduction? (percentage and absolute tonnes)',
        'What is the timeline for achieving carbon emission savings?',
        'How does your technology compare to conventional alternatives? (e.g., electric vs diesel, energy consumption)',
        'What are the measurable indicators of the environmental impact of this project?',
        'What regulatory approvals or certifications are required? (e.g., CSA standards, environmental permits)',
        'How does your solution address energy efficiency or renewable energy integration?'
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
        'What risks are associated with the innovative aspects of your project, and how will you manage them?',
        'How do you plan to mitigate or manage these risks?',
        'Do you have contingency plans in place if things do not go as expected?',
        'What specific actions will you take if a significant risk materializes?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Intellectual Property',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Do you have any IP rights associated with your products, processes, or brand? This may include patents, trademarks, copyrights, or trade secrets',
        'Have you previously engaged with an IP professional?',
        'How do these IP rights contribute to your competitive advantage?'
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
        'Have you conducted market research to identify the competitors in your target market?'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Productivity & Capacity',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What specific productivity or capacity improvements does your project aim to achieve?',
        'How do these improvements align with your organization\'s overall goals and objectives?',
        'What is your current production capacity? (units per hour/day/week)',
        'What is your production capacity target after project completion?',
        'What is the current level of productivity or capacity within your organization?',
        'What strategies or methods will you use to improve productivity or capacity?',
        'What capital assets will you purchase to increase capacity? (equipment, machinery, technology)',
        'How will the new equipment/technology improve efficiency metrics?',
        'How will you measure the increase in productivity or capacity resulting from your project?',
        'What role will technology or innovation play in improving productivity or capacity?'
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
        'Please describe the project\'s readiness (i.e. start date and project needs)',
        'What is the timeline to reach commercialization?'
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
      text: 'Project Management Team',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Who will be involved in the project?',
        'Outline the roles and responsibilities of each member of the project management team',
        'Provide an overview of the project management team\'s experience in successfully delivering projects',
        'Have you or your team successfully managed similar projects in the past? If so, please provide details.',
        'Are there any additional team members or external consultants involved in project management or delivery?',
        'How do you handle changes in project scope, requirements, or objectives?'
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
        'What equipment, machinery, or technology assets do you currently possess?',
        'Are your existing assets adequate to meet the demands of your business, or do you require additional resources?',
        'Do you have a plan for maintaining and upgrading your equipment and technology?',
        'What software, databases, or information systems do you use to manage your business processes?',
        'Have you established partnerships or collaborations with other organizations or industry networks?'
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
    program_name: '[R&D Program Name]',
    client_name: '[Client Company Name]',
    interview_date: '[Date]'
  }
};

/**
 * Hiring & Wage Subsidies Interview Questions Template
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'hiring',
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
      text: 'Hiring Needs & Job Creation',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'How many positions do you plan to fill through this program?',
        'Provide job descriptions for each position (roles, responsibilities, qualifications)',
        'Will these be full-time, part-time, seasonal, or temporary positions?',
        'What is the FTE (Full-Time Equivalent) calculation for each position?',
        'What is the anticipated wage range for each position?',
        'What is the anticipated start date for these positions?',
        'How will these new hires contribute to your business growth?',
        'Do you have a retention plan for these employees beyond the funding period?',
        'What is your current total workforce size?',
        'What is your projected workforce size after hiring?',
        'What onboarding and training will new hires receive?'
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
      text: 'Diversity, Equity, Inclusion',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'How many jobs will this project create? (i.e. full-time vs. part-time vs. seasonal vs. temporary)',
        'How does this project benefit equity-deserving groups?',
        'What DE&I measures has your company implemented?',
        'What is the gender breakdown of your leadership team?',
        'What is the gender breakdown of your overall workforce?',
        'What is the ethnic diversity of your workforce?',
        'How will your project address cultural competency and sensitivity in its implementation?',
        'How will you measure the impact of your project on diversity, equity, and inclusion?',
        'What barriers to participation have you identified for diverse groups, and how will you address them?',
        'Do you have specific recruitment strategies to attract candidates from underrepresented groups?',
        'What workplace accommodations or support systems will you provide?',
        'Do you have mentorship or professional development programs for underrepresented employees?'
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
        'Who will supervise and mentor the new hires?',
        'Have you or your team successfully managed similar projects in the past? If so, please provide details.',
        'How diverse is the project team, including leadership and decision-makers?'
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
        'Do you have adequate workspace for the new employees?',
        'What equipment, machinery, or technology assets do you currently possess?',
        'Are your existing assets adequate to support the new hires?',
        'What onboarding and training resources will you provide to new employees?'
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
    program_name: '[Hiring Program Name]',
    client_name: '[Client Company Name]',
    interview_date: '[Date]'
  }
};

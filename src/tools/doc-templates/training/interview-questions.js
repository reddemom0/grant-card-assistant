/**
 * Training & Skills Development Interview Questions Template
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'training',
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
      text: 'Training Needs & Strategy',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What specific skills gaps have you identified within your organization?',
        'How will this training address current business challenges or opportunities?',
        'Who are the target participants for this training? (roles, experience levels)',
        'Have you identified specific training providers? Please provide details.',
        'What is the proposed training delivery method? (in-person, online, hybrid)',
        'What is the expected duration and schedule of the training program?'
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
      text: 'Productivity & Capacity Improvement',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'What specific productivity or capacity improvements does your project aim to achieve?',
        'How do these improvements align with your organization\'s overall goals and objectives?',
        'What is the current level of productivity or capacity within your organization or targeted area?',
        'What strategies or methods will you use to improve productivity or capacity?',
        'How will you measure the increase in productivity or capacity resulting from your project?',
        'What specific metrics or indicators will you use to track progress?',
        'How will the project optimize the use of resources (e.g., time, money, personnel) to improve productivity or capacity?',
        'Can the productivity or capacity improvements from your project be scaled up or replicated in other areas or departments?'
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
        'Will the training program specifically target or benefit underrepresented groups?'
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
        'What equipment, machinery, or technology assets do you currently possess?',
        'Are your existing assets adequate to meet the demands of your business, or do you require additional resources?',
        'Do you have a plan for maintaining and upgrading your equipment and technology?'
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
    program_name: '[Training Program Name]',
    client_name: '[Client Company Name]',
    interview_date: '[Date]'
  }
};

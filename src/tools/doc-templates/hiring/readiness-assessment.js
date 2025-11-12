/**
 * Hiring & Wage Subsidies Readiness Assessment Template
 * Generic template for hiring grants (Canada Summer Jobs, Youth Employment, etc.)
 */

export const READINESS_ASSESSMENT = {
  grantType: 'hiring',
  documentType: 'readiness-assessment',

  sections: [
    {
      type: 'callout',
      style: 'warning',
      text: 'CREATE A COPY. This is a template so don\'t save over it.'
    },

    {
      type: 'title',
      text: '{{program_name}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Program Overview'
    },
    {
      type: 'paragraph',
      text: 'Funder: {{funder}}'
    },
    {
      type: 'paragraph',
      text: '{{program_description}}'
    },
    {
      type: 'paragraph',
      text: 'Adjudication managed by: {{adjudication_manager}}'
    },
    {
      type: 'paragraph',
      text: '[If available, information on who manages adjudication: i.e. technical experts, PhDs, engineers, etc. Speaks to how technical/in-depth the writing needs to be/]',
      style: 'italic'
    },

    {
      type: 'subheader',
      text: 'Program Purpose:'
    },
    {
      type: 'list',
      items: '{{program_purpose_items}}'
    },

    {
      type: 'subheader',
      text: 'Program objective:'
    },
    {
      type: 'list',
      items: '{{program_objective_items}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Process Overview'
    },
    {
      type: 'table',
      headers: ['Milestone', 'Timeframe', 'Responsibility'],
      rows: [
        ['Template Provided', 'Sent:\nComplete by:', 'Client'],
        ['Creating an account in the portal (link)\n{{portal_timing}}', 'To be completed by:', 'Client'],
        ['Readiness Assessment: send to client and receive back by {{ra_deadline}}', 'RA Sent:\nRA Returned:', 'Granted/Client'],
        ['Budget Review & Interview', 'Date:', 'Granted/Client'],
        ['Book a time to chat with someone at {{stakeholder_contact}} (Email here)', 'Date:', 'Client'],
        ['Transfer to Writing Department', 'Sent to writers:\nInitial draft review\nFinal draft complete:', 'Granted\nClient\nGranted/Client'],
        ['Submit application', 'Before deadline of: {{deadline}}', 'Client']
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Budget'
    },
    {
      type: 'paragraph',
      text: 'Budget for Program for the year: {{total_program_budget}}'
    },
    {
      type: 'paragraph',
      text: 'Average Award amount, if known: {{average_award}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Timeline and Important Dates'
    },
    {
      type: 'paragraph',
      text: 'Application Deadline: {{application_deadline}}'
    },
    {
      type: 'paragraph',
      text: 'Award Decisions by: {{decision_timeline}}'
    },
    {
      type: 'paragraph',
      text: 'Example of previously funded projects, awarded in {{recent_year}}:'
    },
    {
      type: 'paragraph',
      text: 'Link to Past Projects that have secured funding:'
    },
    {
      type: 'paragraph',
      text: '{{funded_projects_link}}'
    },
    {
      type: 'paragraph',
      text: 'Grant Amount: {{grant_amount}} over {{project_duration}} ({{project_type}})'
    },

    {
      type: 'header',
      level: 2,
      text: 'Length of Writeup'
    },
    {
      type: 'paragraph',
      text: '# of characters/words: {{character_limit}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Application Process - Review with Research'
    },

    {
      type: 'header',
      level: 2,
      text: 'Qualifiers/Eligibility Checklist'
    },
    {
      type: 'checklist',
      items: '{{eligibility_items}}'
    },
    {
      type: 'question',
      text: 'I have a project plan in mind with key steps and dates for their completion and timeline.',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No - if so, need to build as required for submission']
      }
    },

    {
      type: 'header',
      level: 2,
      text: 'Documents Required:'
    },
    {
      type: 'subheader',
      text: 'EOI Stage Documents:',
      style: 'bold-blue'
    },
    {
      type: 'list',
      items: '{{eoi_documents}}'
    },
    {
      type: 'subheader',
      text: 'Application Stage Documents:',
      style: 'bold-blue'
    },
    {
      type: 'list',
      items: '{{application_documents}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Financial Resources Timeline:'
    },
    {
      type: 'list',
      items: [
        'Need to pay a fee in advance of receiving funds',
        'Funding is {{funding_type}}',
        'Frequency of claims'
      ]
    },

    {
      type: 'paragraph',
      text: 'Next Steps: We will assess as a team to determine feasibility for the Interview stage.'
    },

    {
      type: 'header',
      level: 2,
      text: 'Terms & Conditions'
    },
    {
      type: 'paragraph',
      text: '[Insert Program Specific terms and conditions which must either be agreed upon prior to submission, or those that will impact grant success, claims or reporting requirements]',
      style: 'italic'
    },
    {
      type: 'paragraph',
      text: '{{terms_and_conditions}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Final Housekeeping'
    },
    {
      type: 'paragraph',
      text: 'At the end of readiness assessment, you should be able to pitch the project to the RA team and your manager to identify potential gaps and ensure there is \'buy-in\' on program alignment.'
    },
    {
      type: 'paragraph',
      text: '{{final_housekeeping}}'
    }
  ],

  // Default placeholders for hiring programs
  defaultData: {
    program_name: '[Grant Name]',
    funder: '[Funder Name]',
    program_description: '[Summary of Funder and Grant/Program].',
    adjudication_manager: '[Name]',
    program_purpose_items: [
      '[Purpose 1: explanation]',
      '[Purpose 2: explanation]',
      '[Purpose 3: explanation]'
    ],
    program_objective_items: [
      '[Objective 1: explanation]',
      '[Objective 2: explanation]',
      '[Objective 3: explanation]'
    ],
    portal_timing: 'Apply at least 30 days in advance of applying',
    ra_deadline: 'May 16',
    stakeholder_contact: '_______________',
    deadline: '______',
    total_program_budget: '[$# CAD]',
    average_award: '[$# CAD]',
    application_deadline: 'Month, DD, YYYY',
    decision_timeline: 'Month, DD, YYYY',
    recent_year: 'YYYY',
    funded_projects_link: '[Insert Link]',
    grant_amount: '$# CAD',
    project_duration: '# years/months',
    project_type: 'Long Term Project/Short Term Project',
    character_limit: '[#]',
    eligibility_items: [
      '[Eligibility criterion 1]',
      '[Eligibility criterion 2]',
      '[Eligibility criterion 3]'
    ],
    eoi_documents: [
      'Brief project summary (1-2 pages)',
      'Certificate of Business Registration',
      'Proof of membership (if applicable)',
      'Basic organizational information'
    ],
    application_documents: [
      'Project Plan Template [Insert Link]',
      'Detailed supporting documentation',
      'Business plan, project plan, marketing strategy, expansion plan (as applicable)',
      'Proof of IP if applicable',
      'Operational certifications, if required',
      'Financial documents (as required by program)'
    ],
    funding_type: 'claim back or paid in advance',
    terms_and_conditions: '',
    final_housekeeping: ''
  }
};

/**
 * Investment & Equity Readiness Assessment Template
 * Generic professional template for investment/equity programs
 * Clean formatting with Granted branding
 */

export const READINESS_ASSESSMENT = {
  grantType: 'investment',
  documentType: 'readiness-assessment',

  // Branding configuration
  branding: {
    headerColor: '#0047AB',  // Granted blue
    useCleanFormatting: true,
    properSpacing: true
  },

  sections: [
    {
      type: 'title',
      text: '{{program_name}}',
      style: 'title-branded'
    },

    {
      type: 'header',
      level: 2,
      text: 'Program Overview',
      style: 'header-branded'
    },
    {
      type: 'field-row',
      label: 'Funder',
      value: '{{funder}}',
      style: 'bold-label'
    },
    {
      type: 'paragraph',
      text: '{{program_description}}'
    },
    {
      type: 'field-row',
      label: 'Adjudication managed by',
      value: '{{adjudication_manager}}'
    },
    {
      type: 'paragraph',
      text: '[If available, information on who manages adjudication: i.e. technical experts, PhDs, engineers, etc. Speaks to how technical/in-depth the writing needs to be/]',
      style: 'italic'
    },

    {
      type: 'subheader',
      text: 'Program Purpose:',
      style: 'subheader-branded'
    },
    {
      type: 'list',
      items: '{{program_purpose_items}}',
      style: 'bulleted-clean'
    },

    {
      type: 'subheader',
      text: 'Program Objective:',
      style: 'subheader-branded'
    },
    {
      type: 'list',
      items: '{{program_objective_items}}',
      style: 'bulleted-clean'
    },

    {
      type: 'header',
      level: 2,
      text: 'Process Overview',
      style: 'header-branded'
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
      ],
      style: 'professional-grid'
    },

    {
      type: 'header',
      level: 2,
      text: 'Budget',
      style: 'header-branded'
    },
    {
      type: 'field-row',
      label: 'Total Budget for Program',
      value: '{{total_program_budget}}'
    },
    {
      type: 'field-row',
      label: 'Average Award amount, if known',
      value: '{{average_award}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Timeline and Important Dates',
      style: 'header-branded'
    },
    {
      type: 'field-row',
      label: 'Application Deadline',
      value: '{{application_deadline}}'
    },
    {
      type: 'field-row',
      label: 'Award Decisions by',
      value: '{{decision_timeline}}'
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
      type: 'field-row',
      label: 'Investment Amount',
      value: '{{grant_amount}} over {{project_duration}} ({{project_type}})'
    },

    {
      type: 'header',
      level: 2,
      text: 'Length of Writeup',
      style: 'header-branded'
    },
    {
      type: 'field-row',
      label: '# of characters/words',
      value: '{{character_limit}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Application Process - Review with Research',
      style: 'header-branded'
    },

    {
      type: 'header',
      level: 2,
      text: 'Qualifiers/Eligibility Checklist',
      style: 'header-branded'
    },
    {
      type: 'checklist',
      items: '{{eligibility_items}}',
      style: 'checkbox-clean'
    },
    {
      type: 'question',
      text: 'I have a project plan in mind with key steps and dates for their completion and timeline.',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No - if so, need to build as required for submission']
      },
      style: 'question-table-clean'
    },

    {
      type: 'header',
      level: 2,
      text: 'Documents Required',
      style: 'header-branded'
    },
    {
      type: 'subheader',
      text: 'EOI Stage Documents:',
      style: 'bold-blue'
    },
    {
      type: 'checklist',
      items: '{{eoi_documents}}',
      style: 'checkbox-clean'
    },
    {
      type: 'subheader',
      text: 'Application Stage Documents:',
      style: 'bold-blue'
    },
    {
      type: 'checklist',
      items: '{{application_documents}}',
      style: 'checkbox-clean'
    },

    {
      type: 'header',
      level: 2,
      text: 'Financial Resources Timeline',
      style: 'header-branded'
    },
    {
      type: 'list',
      items: [
        'Need to pay a fee in advance of receiving funds',
        'Funding is {{funding_type}}',
        'Frequency of claims'
      ],
      style: 'bulleted-clean'
    },

    {
      type: 'paragraph',
      text: '**Next Steps:** We will assess as a team to determine feasibility for the Interview stage.',
      style: 'bold'
    },

    {
      type: 'header',
      level: 2,
      text: 'Terms & Conditions',
      style: 'header-branded'
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
      text: 'Final Housekeeping',
      style: 'header-branded'
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

  // Default placeholders for investment/equity programs
  defaultData: {
    program_name: '[Investment/Equity Program Name]',
    funder: '[Funder Name]',
    program_description: '[Summary of Funder and Investment/Equity Program].',
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
    ra_deadline: '[Date]',
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
      'High-growth potential business',
      'Scalable business model',
      'Strong management team',
      'Market traction or proof of concept',
      'Clear path to profitability',
      'Equity requirements',
      '[Additional eligibility criteria]'
    ],
    eoi_documents: [
      'Executive summary (1-2 pages)',
      'Pitch deck',
      'Certificate of Business Registration',
      'Capitalization table',
      'Key team bios'
    ],
    application_documents: [
      'Completed application form [Insert Link]',
      'Detailed business plan',
      'Financial statements (past 2-3 years)',
      'Financial projections (3-5 years)',
      'Detailed pitch deck',
      'Market analysis and competitive landscape',
      'Technology/IP documentation',
      'Management team profiles',
      'Capitalization table with ownership details',
      'Use of funds breakdown',
      'Exit strategy',
      'Supporting documentation'
    ],
    funding_type: 'equity investment / convertible note / matching funds',
    terms_and_conditions: '',
    final_housekeeping: ''
  }
};

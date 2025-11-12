/**
 * R&D & Innovation Readiness Assessment Template
 * Based on RTRI and Green Shipping Corridor structures
 * Clean, professional formatting with Granted branding
 */

export const READINESS_ASSESSMENT = {
  grantType: 'rd',
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
      type: 'info-box',
      label: 'FOR INTERNAL USE ONLY',
      items: [
        '{{internal_guide_eoi}}',
        '{{internal_guide_full}}'
      ],
      style: 'yellow-highlight'
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
      type: 'subheader',
      text: 'Priorities:',
      style: 'subheader-branded'
    },
    {
      type: 'paragraph',
      text: '{{priority_statement}}'
    },
    {
      type: 'list',
      items: '{{priority_items}}',
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
      label: 'Total Program Budget',
      value: '{{total_program_budget}}'
    },
    {
      type: 'field-row',
      label: 'Maximum Award Amount',
      value: '{{max_award}}'
    },
    {
      type: 'field-row',
      label: 'Average Award',
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
      label: 'Project Start Date',
      value: '{{project_start_date}}'
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
      type: 'field-row',
      label: 'Project Completion Deadline',
      value: '{{project_completion_date}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Length of Writeup',
      style: 'header-branded'
    },
    {
      type: 'field-row',
      label: 'Maximum Length',
      value: '{{character_limit}}'
    },
    {
      type: 'field-row',
      label: 'Format Requirement',
      value: '{{format_requirement}}'
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
      type: 'callout',
      style: 'info-blue',
      text: '{{special_eligibility_note}}'
    },
    {
      type: 'subheader',
      text: 'Core Eligibility Requirements:',
      style: 'subheader-branded'
    },
    {
      type: 'checklist',
      items: '{{core_eligibility_items}}',
      style: 'checkbox-clean'
    },

    {
      type: 'subheader',
      text: 'Preference Given To:',
      style: 'subheader-branded'
    },
    {
      type: 'checklist',
      items: '{{preference_items}}',
      style: 'checkbox-clean'
    },

    {
      type: 'subheader',
      text: 'Eligible Sectors:',
      style: 'subheader-branded'
    },
    {
      type: 'checklist',
      items: '{{eligible_sectors}}',
      style: 'checkbox-clean'
    },

    {
      type: 'question',
      text: 'Do you have a business plan?',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No - if so, need to build as required for submission']
      },
      style: 'question-table-clean'
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
      type: 'callout',
      style: 'warning-red',
      text: '{{disqualifying_criteria}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'RA/Interview Questions',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: '{{ra_interview_questions}}',
      style: 'numbered-clean'
    },

    {
      type: 'header',
      level: 2,
      text: 'Documents Required',
      style: 'header-branded'
    },
    {
      type: 'subheader',
      text: 'Core Application Documents:',
      style: 'bold-blue'
    },
    {
      type: 'checklist',
      items: '{{core_documents}}',
      style: 'checkbox-clean'
    },

    {
      type: 'subheader',
      text: 'Optional Documents (Strengthen Application):',
      style: 'bold-blue'
    },
    {
      type: 'checklist',
      items: '{{optional_documents}}',
      style: 'checkbox-clean'
    },

    {
      type: 'header',
      level: 2,
      text: 'Financial Resources Timeline',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: '{{financial_timeline_info}}'
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

  // Default data for RTRI (can be customized for IRAP, clean tech, etc.)
  defaultData: {
    program_name: 'Regional Tariff Relief Initiative - Prairie Region',
    internal_guide_eoi: 'EOI Help Guide (For EOI application only)',
    internal_guide_full: 'Applicant Guide (For full application)',
    funder: 'PrairiesCan',
    program_description: 'The Regional Tariff Relief Initiative helps businesses and sectors negatively impacted by new tariffs from the U.S., China and/or Canadian counter-tariffs. Businesses applying typically qualify for $500,000 to $5,000,000 per project (non-repayable; only those meeting these criteria).',

    program_purpose_items: [
      'Defend Canadian Jobs from trade and tariff disruptions',
      'Defend Canadian Industries from trade and tariff disruptions',
      'Defend Canadian supply chains from trade and tariff disruptions'
    ],

    program_objective_items: [
      'Boost productivity',
      'Reducing costs',
      'Building more resilient supply chains',
      'Reach new markets and enhance domestic trade'
    ],

    priority_statement: 'Priorities will be given to businesses that:',
    priority_items: [
      'Have higher proportions of Canadian inputs',
      'Demonstrate greater economic benefits for the Prairies',
      'Support local, regional or national supply chains'
    ],

    portal_timing: 'Apply at least 30 days in advance of applying',
    ra_deadline: '________',
    stakeholder_contact: '_______________',
    deadline: 'December 31, 2027, or until all funding is used',

    total_program_budget: '$1 billion across Canada',
    max_award: '$5,000,000',
    average_award: 'Unknown (new program)',

    project_start_date: 'March 21st, 2025',
    application_deadline: 'Apply any time before December 31, 2027, or until all funding is used',
    decision_timeline: 'TBD',
    project_completion_date: 'March 31, 2028',

    character_limit: 'No more than 30 pages',
    format_requirement: 'PDF format required',

    special_eligibility_note: 'Do you want a loan (repayable) as well or are you ONLY interested in a grant (non-repayable)?',

    core_eligibility_items: [
      'Incorporated businesses in Canada with operation facilities in the prairie provinces',
      'You employ at least one full-time equivalent (FTE)',
      'Have you been in operation for a minimum of two years',
      'Have confirmed funding from all other sources including government and non-government',
      'Are you a legal entity capable of entering into legally binding agreements',
      'Generate economic benefits for the local economy or region',
      'Play an important role in supporting the local supply chain'
    ],

    preference_items: [
      'Majority Canadian-owned businesses',
      'Applicants with higher proportions of Canadian inputs',
      'Applicants demonstrating higher leverage of funding from non-PrairiesCan sources',
      'Applicants or industries experiencing a higher severity of tariff impact',
      'Indigenous-owned businesses (Optional, but preferred applicant)'
    ],

    eligible_sectors: [
      'Advanced manufacturing',
      'Clean resources',
      'Clean Tech',
      'Digital industries',
      'Health / Bioscience',
      'Natural resources / valued-added processing',
      'Value added agriculture',
      'Inclusiveness (supporting under represented groups)',
      'Other (e.g., Steel)'
    ],

    disqualifying_criteria: 'Would you move company operations outside of Canada? If so, funding will not be allocated.',

    ra_interview_questions: [
      'Briefly describe your project in plain language. The description should provide a high-level overview of the project and outline the main elements of the project.',
      'Have you already started this project? (retroactive for expenses from March 21, 2025)? If not, when will you start?',
      'What amount of Canadian inputs do you have?',
      'What are the economic benefits for the Prairie Region? Be descriptive and quantify job creation, revenue increase, reduced reliance on the US, investment dollars gained, capacity built, innovation created, etc. achieved by the end of this project.',
      'What part of the project supports local, regional or national supply chains?',
      'Do you have the matching funds for this project? If so, proof is required. Cannot include: forecasted revenues; accounts receivables; commitments to raise equity; commitments to obtain future bank financing; SR&ED credits.',
      'Provide a clear and succinct description of the project to ensure eligibility',
      'Identify any organizations involved or intending to be involved in the project',
      'Describe the existing conditions, background, constraints, or issues that the project is intended to address',
      'Describe any work that has already been completed in relation to this project',
      'Identify any parties that were engaged to date and how they were involved'
    ],

    core_documents: [
      'A completed application form',
      'A completed attestation form, signed (wet) copy required',
      'Articles of incorporation, business registration, or other legal documents confirming the organization\'s status',
      'A business plan or pitch deck outlining company background, target markets, strategy, and expected benefits from the project',
      'Forecasted income statements and cash flow projections covering the entire project period and two years following completion',
      'Externally prepared financial statements (audited or reviewed) for the past two complete fiscal years',
      'Interim financial statements for the current fiscal period',
      'Proof of confirmed funding from both government and non-government sources (e.g., bank letters, funding agreements, or internal cash reserves)',
      'Proof of signing of authority',
      'Proof of project location and operations within eligible provinces',
      'Identification of the authorized signing officer, including name, title, and contact information',
      'Completed cost clarification form (included with the email invitation to complete a full application)'
    ],

    optional_documents: [
      'Capitalization table showing ownership structure and investor contributions',
      'Letters of support or endorsement from key partners, customers, or industry associations',
      'Independent market assessment or third-party feasibility study demonstrating project viability',
      'Evidence of demand such as signed purchase orders, letters of intent, or export contracts',
      'Risk assessment and mitigation plan specific to tariff exposure or supply chain disruption',
      'Productivity or competitiveness analysis showing expected efficiency gains from the project',
      'A detailed project plan describing objectives, timelines, milestones, and activities to address tariff impacts or diversify markets',
      'Documents showing the company\'s exposure to tariffs, such as invoices, customs declarations, or supplier communications reflecting increased input costs',
      'Evidence of reduced sales, cancelled orders, or customer communications demonstrating loss or risk due to tariffs or retaliatory tariffs'
    ],

    financial_timeline_info: 'Recipients will be required to submit along with funding claims, regular progress reports and financial statements to PrairiesCan throughout the project, from implementation through to the repayment period.',

    terms_and_conditions: 'An Attestation form will be required along with submission.',
    final_housekeeping: ''
  }
};

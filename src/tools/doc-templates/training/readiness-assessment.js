/**
 * Training & Skills Development Readiness Assessment Template
 * Based on generic RA structure - applicable to ETG, Canada Job Grant, etc.
 */

export const READINESS_ASSESSMENT = {
  grantType: 'training',
  documentType: 'readiness-assessment',

  sections: [
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
      text: 'Total Budget for Program: {{total_program_budget}}'
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
      text: '{{funded_projects_info}}'
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
      type: 'paragraph',
      text: '{{eligibility_intro}}'
    },
    {
      type: 'checklist',
      items: '{{eligibility_items}}'
    },
    {
      type: 'paragraph',
      text: '{{additional_requirements}}'
    },
    {
      type: 'paragraph',
      text: '{{priority_criteria}}'
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
      text: '{{final_housekeeping}}'
    }
  ],

  // Default placeholders - can be customized per training program
  defaultData: {
    program_name: 'BC Employer Training Grant (ETG)',
    funder: 'Province of British Columbia - Ministry of Post-Secondary Education and Future Skills',
    program_description: 'The Employer Training Grant (ETG) provides up to $10,000 per participant (up to $300,000 per employer annually) to support skills training for employees. The program covers direct training costs including instructors, materials, and required certifications.',
    adjudication_manager: '[Name]',
    program_purpose_items: [
      'Support employers in upskilling their workforce',
      'Address skills gaps and labour shortages',
      'Improve employee productivity and retention',
      'Enhance business competitiveness through training'
    ],
    program_objective_items: [
      'Provide funding for industry-relevant training',
      'Support small and medium-sized businesses',
      'Enable training for both new and existing employees',
      'Drive productivity improvements through skills development'
    ],
    portal_timing: 'Apply at least 30 days in advance of applying',
    ra_deadline: '[Date]',
    stakeholder_contact: '_______________',
    deadline: '______',
    total_program_budget: '[Amount if known]',
    average_award: '$10,000 per participant (ETG), varies by program',
    application_deadline: 'Rolling intake',
    decision_timeline: 'Within 30 business days (ETG)',
    recent_year: '2024',
    funded_projects_info: 'All previously funded projects can be found here [link if available]',
    character_limit: 'Varies by program (ETG: Business Case format, ~5-10 pages)',
    eligibility_intro: 'Are you one of the following?',
    eligibility_items: [
      'Employer operating in BC (ETG)',
      'Employee is Canadian citizen or permanent resident',
      'Training is for current or new employees (within 6 months of hire)',
      'Training costs at least $1,000 per participant',
      'Training provider is on approved list (if applicable)',
      'Organization has valid BC business registration'
    ],
    additional_requirements: 'In addition, eligible applicants must be:\n- Operating legally in the jurisdiction\n- Able to demonstrate financial capacity to complete the project\n- Compliant with employment standards',
    priority_criteria: 'Priority will be given to:\n- Small and Medium enterprises\n- First-time Applicants\n- Training that addresses critical skills gaps',
    eoi_documents: [
      'Brief project summary (1-2 pages)',
      'Certificate of Business Registration',
      'Preliminary training plan outline',
      'Estimated budget range'
    ],
    application_documents: [
      'Business Case or Application Form [Insert Link]',
      'Detailed Training Plan with curriculum and schedule',
      'Training Provider Information (credentials, accreditation)',
      'Participant Information (names, roles, training needs)',
      'Detailed budget breakdown by participant and cost category',
      'Letters of support (if applicable)',
      'Financial statements (if required by program)',
      'Quotes from training providers'
    ],
    funding_type: 'claim back or paid in advance',
    terms_and_conditions: 'Program-specific terms to be inserted here',
    final_housekeeping: 'Additional notes and requirements'
  }
};

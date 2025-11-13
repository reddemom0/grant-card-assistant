/**
 * Market Expansion Readiness Assessment Template
 * Based on CanExport SMEs template structure
 */

export const READINESS_ASSESSMENT = {
  grantType: 'market-expansion',
  documentType: 'readiness-assessment',

  // Branding configuration
  branding: {
    headerColor: '#0047AB',
    useCleanFormatting: true
  },

  sections: [
    // Document Title with Branding
    {
      type: 'title',
      text: '{{program_name}} - Readiness Assessment',
      style: 'title-branded'
    },
    {
      type: 'paragraph',
      text: '**For use by:** Granted Strategy Team',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Client:** {{company_name}}',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Date:** {{assessment_date}}',
      style: 'normal'
    },
    {
      type: 'divider'
    },

    // Program Overview Section
    {
      type: 'header',
      level: 1,
      text: 'Program Overview',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: '{{program_description}}'
    },

    // Process Overview Section
    {
      type: 'header',
      level: 1,
      text: 'Process Overview',
      style: 'header-branded'
    },
    {
      type: 'list',
      items: [
        'Budget review, activities review',
        'Creating an account in the portal',
        'Writing',
        'Connect and Overview for Trade Commissioner',
        'Draft Creation',
        'Review & Submission',
        'Adjudication {{adjudication_days}} days',
        'Approval - start spending money!',
        'Review Outcomes',
        'Reporting',
        'Complete Project'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Target Market Identification',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: 'Have you selected a target market that accounts for the following? (during the last complete tax reporting year (or last 12 months for monthly and quarterly filers)'
    },
    {
      type: 'list',
      items: [
        'Less than {{market_sales_threshold}} in sales',
        '-OR-',
        'Less than {{market_percentage_threshold}}% of international sales (including domestic and total International)'
      ]
    },
    {
      type: 'paragraph',
      text: 'If your project includes multiple markets:'
    },
    {
      type: 'list',
      items: [
        'Each market must be less than {{multi_market_threshold}}% of your company\'s total company revenue'
      ]
    },
    {
      type: 'paragraph',
      text: 'Have you already been approved for a {{program_name}}? How much and when?'
    },
    {
      type: 'paragraph',
      text: 'Does your target market have a free trade agreement?'
    },

    {
      type: 'header',
      level: 2,
      text: 'Target Markets Review',
      style: 'header-branded'
    },
    {
      type: 'callout',
      style: 'warning',
      text: '{{market_warning}}'
    },

    {
      type: 'header',
      level: 2,
      text: 'Target Customer Review',
      style: 'header-branded'
    },
    {
      type: 'table',
      headers: ['Business size', '{{company_size}}'],
      rows: [
        ['Established # of years', '{{years_established}}'],
        ['Number of employees', '{{num_employees}}'],
        ['Industry', '{{industry}}']
      ],
      style: 'two-column'
    },
    {
      type: 'paragraph',
      text: 'B2B'
    },
    {
      type: 'paragraph',
      text: 'B2C - End Consumer: Looking for any person over the age of 18'
    },
    {
      type: 'table',
      headers: ['Age range', '{{age_range}}'],
      rows: [
        ['Education', '{{education}}'],
        ['Profession / location', '{{profession_location}}'],
        ['Preferences / needs', '{{preferences_needs}}']
      ],
      style: 'two-column'
    },

    {
      type: 'header',
      level: 2,
      text: 'Qualifiers',
      style: 'header-branded'
    },
    {
      type: 'subheader',
      text: 'A.'
    },
    {
      type: 'question',
      number: 1,
      text: 'Have you previously received funding from the {{program_name}} program?',
      followup: [
        'If yes, please share when you received funding and how much was received.',
        'If yes, please explain how the new project builds on or makes changes to the previous project.'
      ],
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 2,
      text: 'Do you already have an existing office in the target market?',
      followup: [
        'If so, your target market is ineligible for the program, and you must pick a new one.'
      ],
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 3,
      text: 'Are you a trading house/distributor/export broker?',
      followup: [
        'If so, your company is ineligible for the program.'
      ],
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 4,
      text: 'Is your company woman-owned, operated or controlled?',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 5,
      text: 'Is your company indigenous-owned, operated or controlled?',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 6,
      text: 'Is your company youth-owned, operated or controlled? (under 39yo)',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 7,
      text: 'Is your company visible minority-owned, operated or controlled?',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'question',
      number: 8,
      text: 'Is your company LGBTQ2+-owned, operated or controlled?',
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },

    {
      type: 'subheader',
      text: 'B.'
    },
    {
      type: 'paragraph',
      text: 'Is your product/service of Canadian origin*? If yes, explain. If not, what value is added in Canada? What percentage of the product or service is produced in Canada alone?'
    },
    {
      type: 'paragraph',
      text: '*For tech or service-based companies, please provide a ratio of outsourced (non-Canadian) to local (Canadian) teams.',
      style: 'italic'
    },
    {
      type: 'paragraph',
      text: 'What is the primary rationale for entering your chosen target (e.g. logistics, market size/trends, etc.)? {{follow_up_previous_project}}'
    },
    {
      type: 'paragraph',
      text: '{{us_specific_questions}}'
    },
    {
      type: 'paragraph',
      text: 'How are conditions in the target market favorable for entry of your product/service? {{market_conditions_change}}'
    },
    {
      type: 'paragraph',
      text: 'What risks/challenges do you anticipate? (at least 3)'
    },
    {
      type: 'question',
      text: 'Do you have an updated business plan and/or market entrance strategy in place? (Yes/No/Partial) If yes, please provide a copy.',
      table: {
        type: 'yes-no-partial',
        columns: ['Yes', 'No', 'Partial']
      }
    },
    {
      type: 'paragraph',
      text: 'Which countries have you actively exported to? (for the U.S., China, India, Brazil – please identify the region)?'
    },
    {
      type: 'paragraph',
      text: 'Are you currently in the process of entering any other new foreign markets?'
    },
    {
      type: 'paragraph',
      text: 'Who will be working on this project (name, title of employee)? What will their role be (project manager, onboarding specialist, lead conversion, etc.)?'
    },
    {
      type: 'callout',
      style: 'warning',
      text: '{{program_name}} is highly sensitive to any existing connections in the target market who would be considered an in-market representative. (Connections can be established by online platforms like LinkedIn. If your connection has anything related to your company on their social media, it is considered high risk.)'
    },
    {
      type: 'paragraph',
      text: 'What is your company\'s annual budget range for international expansion activities? (Grant covers {{cost_share}}% if expenses up to {{max_funding}})'
    },
    {
      type: 'question',
      text: 'Have you been in contact with the Trade Commissioner Service or NRC IRAP Advisors responsible for your industry and/or in your target market(s)?',
      followup: [
        'It is ideal to initiate a connection before submission of application. The conversation with TCS does not need to have taken place, but the priority is to have this box ticked as \'Yes\'.'
      ],
      table: {
        type: 'yes-no',
        columns: ['Yes', 'No']
      }
    },
    {
      type: 'paragraph',
      text: 'Do you have an IP strategy for conducting business abroad? If yes, what is it? Have you sought consultation from any government bodies or external agencies? Are you trademarked?'
    },
    {
      type: 'paragraph',
      text: 'If no trademarking or registered IP protection exists, it should be included as an activity in the project budget. If there is no existing IP protection when applying, please explain why..'
    },

    {
      type: 'header',
      level: 2,
      text: 'Competitors',
      style: 'header-branded'
    },
    {
      type: 'table',
      headers: ['Company Name', 'Presence in the Market', 'Your Competitive Advantage'],
      rows: [
        ['{{competitor_1_name}}', '{{competitor_1_presence}}', '{{competitor_1_advantage}}'],
        ['{{competitor_2_name}}', '{{competitor_2_presence}}', '{{competitor_2_advantage}}'],
        ['{{competitor_3_name}}', '{{competitor_3_presence}}', '{{competitor_3_advantage}}'],
        ['{{competitor_4_name}}', '{{competitor_4_presence}}', '{{competitor_4_advantage}}']
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Project Outcomes',
      style: 'header-branded'
    },
    {
      type: 'table',
      headers: ['Expected revenue increase as a result of project by {{outcome_date}}?', '{{expected_revenue}}'],
      rows: [
        ['How many additional leads would you generate by {{outcome_date}}?', '{{expected_leads}}'],
        ['How many jobs will this project help to create within your organization in Canada?', '{{jobs_created}}'],
        ['How much additional investment in Canada would this project garner?', '{{investment_amount}}'],
        ['Increased R&D/Innovation', '{{rd_increase}}'],
        ['Agreements signed', '{{agreements_signed}}'],
        ['Other', '{{other_outcomes}}']
      ],
      style: 'two-column'
    },

    {
      type: 'header',
      level: 2,
      text: 'Project Activities',
      style: 'header-branded'
    },
    {
      type: 'paragraph',
      text: 'Does your project include any of the following activities? (check applicable)'
    },
    {
      type: 'subheader',
      text: 'Marketing and Promotional Material'
    },
    {
      type: 'checklist',
      items: [
        'Flyers, pamphlets, brochures',
        'Translation of marketing material'
      ]
    },
    {
      type: 'callout',
      style: 'info',
      text: 'REMINDER: {{marketing_restrictions}}'
    },
    {
      type: 'subheader',
      text: 'Consultant Services'
    },
    {
      type: 'paragraph',
      text: 'All consultants and contractors must not be internally affiliated with your organization in any way, and all transactions/activities must be completed at arm\'s distance. They must have a specific expertise not otherwise available within your company and cannot be an in-market representative or employee that is conducting business on your behalf.'
    },
    {
      type: 'paragraph',
      text: '{{consultant_requirements}}'
    },
    {
      type: 'checklist',
      items: [
        'Market research',
        'Sales consulting',
        'Other business advice',
        'Lead lists',
        'Legal advice and regulatory issues',
        'Applying for local IP protection (trademark, patent, etc.)',
        'Obtaining certification required for market access',
        'Drafting and legal review/adaptation of contracts signed with local partners',
        'Tax advice',
        'General market advice and market access consulting'
      ]
    },
    {
      type: 'subheader',
      text: 'Trade shows'
    },
    {
      type: 'paragraph',
      text: 'Travel'
    },
    {
      type: 'checklist',
      items: [
        'Registration and booth fees',
        'A/V equipment rentals',
        'Meeting room fees',
        'Shipping fees (booth materials, samples, prototypes)'
      ]
    },

    {
      type: 'header',
      level: 2,
      text: 'Final Housekeeping',
      style: 'header-branded'
    },
    {
      type: 'list',
      items: [
        '{{pricing_structure}}',
        'Ensure Schedule B is signed',
        'You will need to sign up to the online portal and complete Part A of the application (eligibility check) {{portal_url}}',
        'Next step would be to prepare a budget and then we would have an interview phone call with you to gather project details to write the application.',
        'Once the project budget is confirmed we will help you connect with the Trade Commissioner to review the application.',
        'Timing of writeup is {{draft_timing}} business days for a Draft which will have some pieces of info you\'ll need to help fill in or verify during review',
        'All documents will be shared on Google Docs',
        '{{program_name}} New Document Requirements, including {{required_documents}}'
      ]
    }
  ],

  // Default placeholders for CanExport SMEs
  defaultData: {
    program_name: 'CanExport SMEs',
    company_name: '[Company Name]',
    assessment_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    program_description: 'CanExport SMEs provides funding to small and medium-sized Canadian enterprises to help them develop new export opportunities and markets. The program offers up to $50,000 in funding (75% reimbursement for travel and 50% for other eligible expenses) to support international business development activities.',
    adjudication_days: '60',
    market_sales_threshold: '$100,000',
    market_percentage_threshold: '10',
    multi_market_threshold: '10',
    market_warning: 'Please advise: Entrance to the United States is mutually exclusive with other markets. For stronger applications, we suggest a maximum of two target markets per application.',

    // Company information placeholders
    company_size: '[Small/Medium/Large]',
    years_established: '[Number of years]',
    num_employees: '[Number]',
    industry: '[Industry sector]',
    age_range: '[Age range]',
    education: '[Education level]',
    profession_location: '[Profession/Location]',
    preferences_needs: '[Customer preferences]',

    // Competitor placeholders
    competitor_1_name: '[Competitor 1]',
    competitor_1_presence: '[Their market presence]',
    competitor_1_advantage: '[Your advantage over them]',
    competitor_2_name: '[Competitor 2]',
    competitor_2_presence: '[Their market presence]',
    competitor_2_advantage: '[Your advantage over them]',
    competitor_3_name: '[Competitor 3]',
    competitor_3_presence: '[Their market presence]',
    competitor_3_advantage: '[Your advantage over them]',
    competitor_4_name: '[Competitor 4]',
    competitor_4_presence: '[Their market presence]',
    competitor_4_advantage: '[Your advantage over them]',

    // Project outcomes placeholders
    expected_revenue: '[Dollar amount]',
    expected_leads: '[Number of leads]',
    jobs_created: '[Number of jobs]',
    investment_amount: '[Dollar amount]',
    rd_increase: '[Description]',
    agreements_signed: '[Number/Description]',
    other_outcomes: '[Other outcomes]',

    // Program details
    cost_share: '50',
    max_funding: '$50,000',
    outcome_date: 'March 31, 2026',
    marketing_restrictions: 'SEO and all online advertising are now ineligible for CanExport. (Some necessary advertorials for trade events can be accepted.)',
    consultant_requirements: 'All consultants must be based in Canada or one of the target markets unless otherwise justified. Additionally, if costs exceed $10K, a statement of work that specifically indicates the target markets must be obtained from the program.',
    pricing_structure: 'ONE OFF $6000 writing fee - 3000 upfront, 3000 before submission',
    portal_url: 'https://portal-portail.nrc-cnrc.gc.ca/en-CA/CanExport/canexport-sme/',
    draft_timing: '7 to 10',
    required_documents: 'articles of incorporation and GST return',
    us_specific_questions: 'If US, please explain how your rationale is justified over the current and developing political economic climate (i.e. US tariffs)? Are you confident that you can generate revenue in the US in this CanExport?',
    follow_up_previous_project: 'How do you feel the last project impacted your decision to enter the selected markets?',
    market_conditions_change: 'Any changes to the conditions from the last application (if same market)?'
  }
};

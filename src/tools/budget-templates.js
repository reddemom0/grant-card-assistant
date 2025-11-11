/**
 * Budget Template Configurations
 *
 * Pre-built templates for major grant programs (CanExport, RTRI, BCAFE)
 * Each template defines the complete structure needed to create a comprehensive budget
 */

/**
 * CanExport SMEs Budget Template
 * Multi-sheet budget with activity tracking, claims management, and export sales
 */
export const CANEXPORT_TEMPLATE = {
  programName: 'CanExport SMEs',
  sheets: [
    {
      name: 'Instructions',
      type: 'instructions',
      content: {
        title: 'Instructions: Please complete the blue tabs only',
        sections: [
          {
            header: 'A. Export Sales',
            instructions: [
              'This is where you declare your export sales during the company\'s last complete tax reporting year.',
              'In your application, you must disclose export sales for the chosen sub-national market, as well as total export sales for that country.',
              'Please provide export sales in Canadian Dollars',
              'If Annual GST filers, use the sales numbers from your last fiscal year.',
              'If Monthly or Quarterly GST filers, use the sales numbers for the last 12 months.'
            ]
          },
          {
            header: 'B. Budget',
            instructions: [
              'This is where you plan your activities and expenses for the CanExport project.',
              'Only expenses that have NOT been incurred yet AND will only be incurred after your grant is approved will be considered eligible.',
              'Step 1: Enter the start and end date of your project. Note the start date must be at least 60 business days from submission',
              'Step 2: Select the project activities for your project and provide as much detail as possible.',
              'Step 3: Once complete, your consultant will review and provide further instructions'
            ]
          },
          {
            header: 'C. Targets',
            instructions: [
              'This is where you list the types of clients or partners that you will be targeting for this project.',
              'They must be in the selected target market.',
              'Please indicate names of potential clients or partners you are targetting for this project, ideally at least 10.'
            ]
          }
        ]
      }
    },
    {
      name: 'Budget',
      type: 'budget',
      frozenRows: 5,
      frozenColumns: 1,
      columns: [
        { header: 'Category', width: 80 },
        { header: 'Region', width: 150 },
        { header: 'Activity', width: 400 },
        { header: 'Used For', width: 200 },
        { header: 'Start Date', width: 120, format: 'date' },
        { header: 'End Date', width: 120, format: 'date' },
        { header: 'Total Cost', width: 120, format: 'currency' },
        { header: 'Vendor Name', width: 150 },
        { header: 'Details', width: 300 },
        { header: 'Expected Outcomes', width: 300 }
      ],
      categories: [
        {
          code: 'A',
          name: 'Travel for Events or Meetings',
          description: 'Travel For Events or Meetings with Key Contacts (max 2 individuals)',
          includes: 'refundable airfare with seat selection/baggage fees, ground transportation via rental car/ride-share/taxi/bus/subway, mandatory visa fees',
          excludes: 'travel within Canada, expenses for employees in target market, reinstating/refund of reward program points, insurance, use of personal vehicle',
          subcategories: [
            'Per diem - max $400 per day per approved traveller (max 2) - includes: accommodations, meals, and incidentals'
          ]
        },
        {
          code: 'B',
          name: 'Trade Events',
          description: 'Trade Events - non-travel related (max 2 individuals)',
          includes: 'exhibition/registration fees, single-use costs associated with on-site booth design/construction/rental, electrical/WiFi costs, rental of tech, liability insurance, return shipping and handling costs',
          excludes: 'costs for creating/organizing private event/workshop, event sponsorship'
        },
        {
          code: 'C',
          name: 'Marketing Activities',
          description: 'Marketing Activities',
          subcategories: [
            'Adaptation - design of marketing/promotional materials',
            'Translation - Translating new or existing marketing material',
            'Online Advertising Costs & SEO - SEO optimization, social media ads, Google Ads, online magazines',
            'Promotional Material - brochures, pamphlets, banners/posters, sales decks, content writing',
            'Videos - infographics, voiceover, animations, video content, editing, videography'
          ]
        },
        {
          code: 'D',
          name: 'Interpretation Services',
          description: 'Interpretation Services',
          includes: 'paying for an interpreter to facilitate teleconference/videoconference meetings or in person interactions',
          excludes: 'interpreter travel expenses and per diems'
        },
        {
          code: 'E',
          name: 'Contractual Agreements, IP Protection/Certification',
          description: 'Costs paid to regulatory agencies',
          includes: 'adaptation/translation of contractual agreements, product certification application fees, supplier diversity certification fees',
          excludes: 'fees for product testing, examinations, inspections/product development'
        },
        {
          code: 'F',
          name: 'Consultant Expenses',
          description: 'Consultant Expenses (excluding consultant travel fees/per-diems, retainer fees)',
          subcategories: [
            '1. Business Advice on regulatory issues - accounting, legal, or business',
            '2. Compliance consulting and IP legal fees - Legal or Tax Advice relating to compliance and IP',
            '3. Digital and e-commerce marketing - developing digital and/or e-commerce marketing strategy'
          ]
        },
        {
          code: 'G',
          name: 'Market Research & Lead Generation',
          description: 'Market Research and Lead Generation',
          subcategories: [
            '4. Market Research Consultant - feasibility studies, export market research',
            '5. Lead Generation - Sales Consulting & Advising, Identification of key contacts, B2B facilitation'
          ]
        },
        {
          code: 'H',
          name: 'Intellectual Property (IP) Protection',
          description: 'IP Protection, Including Expert/Legal Services for Target Market(s)',
          includes: 'filing patent or industrial design application, application for registration of trademark or copyright, development of international IP strategy'
        }
      ]
    },
    {
      name: 'Export Sales',
      type: 'export_sales',
      frozenRows: 1,
      columns: [
        { header: 'Region/Market', width: 200 },
        { header: 'Sales in previous 12 months (C$)', width: 200, format: 'currency' },
        { header: 'Sales from previous 12 to 24 months (C$)', width: 200, format: 'currency' }
      ]
    },
    {
      name: 'Targets',
      type: 'targets',
      frozenRows: 1,
      columns: [
        { header: '#', width: 50 },
        { header: 'Company Name', width: 200 },
        { header: 'Contact', width: 150 },
        { header: 'Details (what they would buy)', width: 300 },
        { header: 'State / City', width: 150 }
      ],
      rowCount: 30
    },
    {
      name: 'Claims',
      type: 'claims',
      frozenRows: 1,
      columns: [
        { header: '#', width: 50 },
        { header: 'Vendor', width: 150 },
        { header: 'Invoice Number', width: 120 },
        { header: 'Expense Date', width: 120, format: 'date' },
        { header: 'Invoice', width: 200 },
        { header: 'POP', width: 200 },
        { header: 'Invoice USD', width: 120, format: 'currency' },
        { header: 'Invoice CAD', width: 120, format: 'currency' },
        { header: 'Tax in CAD', width: 120, format: 'currency' },
        { header: 'Claim (Net of Tax)', width: 140, format: 'currency' }
      ]
    },
    {
      name: 'Eligible Activities',
      type: 'reference',
      content: 'Lists all eligible expense categories with includes/excludes from categories A-H'
    },
    {
      name: 'Ineligible Activities',
      type: 'reference',
      content: 'Lists all ineligible expenses: costs for preparing/submitting claims, capital costs, overhead, employee salaries, GST/HST recoverable, etc.'
    }
  ]
};

/**
 * RTRI (Regional Technology Readiness and Innovation) Budget Template
 * Focus on technology/research grants with capital and non-capital cost tracking
 */
export const RTRI_TEMPLATE = {
  programName: 'RTRI',
  sheets: [
    {
      name: 'Budget',
      type: 'budget',
      frozenRows: 2,
      columns: [
        { header: 'Activity Type\n(drop down menu)', width: 180 },
        { header: 'Cost type', width: 120 },
        { header: 'Estimated Date of Purchase\n(Month and Year)', width: 150 },
        { header: 'Description', width: 400 },
        { header: 'Cost in CAD', width: 130, format: 'currency' },
        { header: 'RTRI Cost Share\n(%)', width: 120, format: 'percent' },
        { header: 'RTRI\nFunding Request ($)', width: 140, format: 'currency' },
        { header: 'Missing information needed from client', width: 300 }
      ],
      activityTypes: [
        {
          name: 'Cost of Labour',
          costType: 'Non Capital',
          description: 'Personnel (HQP + non-HQP hires) - wages and benefits',
          guidanceQuestions: [
            'Breakdown of HQP and non-HQP hires',
            'Provide cost per hire',
            'Provide general timeframe when each hire would be brought on'
          ]
        },
        {
          name: 'Capital Costs',
          costType: 'Capital',
          description: 'Purchase of machinery, equipment and infrastructure',
          guidanceQuestions: [
            'Is this proprietary or subscription software?',
            'When would expenses be incurred?',
            'How much is towards each component?'
          ]
        },
        {
          name: 'Consulting Fees',
          costType: 'Non Capital',
          description: 'Professional, technical, and consulting services',
          guidanceQuestions: [
            'Who are the consultants?',
            'What specific services are they providing?',
            'How long or at what stage are you engaging their services?'
          ]
        },
        {
          name: 'Expanding or Maintaining Markets',
          costType: 'Non Capital',
          description: 'Marketing & Trade Development',
          guidanceQuestions: [
            'What exactly is the cost incurred here?',
            'When will these expenses occur?'
          ]
        }
      ],
      costShareDefault: 0.5
    },
    {
      name: 'Eligible Costs',
      type: 'reference',
      content: {
        title: 'Eligible costs must be reasonable, incremental, and necessary for carrying out the project.',
        notes: [
          'These costs may be retroactive to up to a 12-month period prior to receipt of signed funding application',
          'Eligible costs incurred between program dates may not be reimbursable BUT could be considered as part of your contribution'
        ],
        eligible: [
          'Cost of labour (e.g., wages and benefits) and of material used',
          'Capital costs: purchase of machinery, equipment and infrastructure',
          'Consultancy fees (e.g. professional, and technical services)',
          'Costs related to expanding or maintaining markets'
        ]
      }
    },
    {
      name: 'Ineligible costs',
      type: 'reference',
      content: {
        ineligible: [
          'Basic and applied research and development (Technology Readiness Level 1-6)',
          'Land and buildings',
          'Entertainment expenses',
          'Salary bonuses and dividend payments',
          'Allowance for interest on invested capital, bonds, debentures, and other debts',
          'Losses on investments, bad debts and associated expenses',
          'Refinancing of existing debts',
          'Amortization or depreciation of assets',
          'Federal and provincial income taxes, GST (recoverable portion)',
          'Provisions for contingencies or commissions',
          'Lobbying activities',
          'Donations, dues and membership fees',
          'Any unreasonable, non-incremental or not directly related project costs'
        ]
      }
    }
  ]
};

/**
 * BCAFE (BC Agriculture and Food Export Program) Budget Template
 * Focus on export marketing with output tracking and quote management
 */
export const BCAFE_TEMPLATE = {
  programName: 'BCAFE',
  sheets: [
    {
      name: 'Instructions',
      type: 'instructions',
      content: {
        title: 'BC Agriculture and Food Export Program Budget Template: 2025',
        instructions: [
          'In the \'Budget Template\' tab, please provide details on the expenses you anticipate incurring over the duration of your project.',
          'Be sure to include quotes on separate tabs.',
          'Please refer to the \'Activity Types & Outputs\' tab for eligible expense items and naming conventions.',
          'Add additional \'Quote\' tabs if more are required (note: quotes are only required for budget items equal to or exceeding $5,000.00)',
          'Once completed, please save a copy of this template and upload it to your application portal.'
        ]
      }
    },
    {
      name: 'Budget',
      type: 'budget',
      frozenRows: 5,
      columns: [
        { header: 'Activity Type\n(drop down menu)', width: 280 },
        { header: 'Output\n(refer to Activity Types & Outputs)', width: 200 },
        { header: 'Units', width: 80, format: 'number' },
        { header: 'Unit Cost/\nPurchase Price', width: 120, format: 'currency' },
        { header: 'Details', width: 300 },
        { header: 'Quote #', width: 80 },
        { header: 'Cost', width: 120, format: 'currency' },
        { header: 'BCAFE Cost-Share\n(%)', width: 120, format: 'percent' },
        { header: 'BCAFE\nFunding Request ($)', width: 140, format: 'currency' }
      ],
      activityTypes: [
        {
          name: 'Export Focused Marketing Collateral and Advertising or Social Media Campaigns',
          outputs: [
            'Digital ads',
            'Mailing ads',
            'TV ads',
            'Radio ads',
            'Print ads',
            'Videos',
            'Brochures / Rack Cards',
            'Posters / Banners',
            'Recipe Cards',
            'Point-of-Sale Signs',
            'Shelf-Talkers',
            'Menu Inserts',
            'Pull Up Banner',
            'Other'
          ],
          outcomes: 'Sector businesses are marketing their products in new or existing export markets'
        },
        {
          name: 'Consumer-Focused Promotional Activities in Export Markets',
          outputs: [
            'In-Store Demos',
            'Brand Ambassadors',
            'In-Store Signage / Promotional Materials',
            'Other'
          ],
          outcomes: 'Increased buyer and consumer awareness in target markets'
        },
        {
          name: 'Export Market Tradeshows, Food Fairs and Sales Exhibitions',
          outputs: [
            'Booth Rentals (tables, chairs, podiums, etc)',
            'Booth accessories and services',
            'Shipping Product Samples',
            'Translators (if event includes non-English speakers)',
            'Other'
          ],
          outcomes: 'Buyers in export markets are exposed to BC products; New business relationships established'
        }
      ],
      costShareDefault: 0.5
    },
    {
      name: 'Activity Types & Outputs',
      type: 'reference',
      content: 'Detailed list of eligible activity types mapped to outputs and KPIs'
    },
    {
      name: 'Quote #1',
      type: 'quote',
      instructions: 'Please paste an image of Quote #1 below.'
    },
    {
      name: 'Quote #2',
      type: 'quote',
      instructions: 'Please paste an image of Quote #2 below.'
    }
  ]
};

/**
 * Get budget template by program name
 * @param {string} programName - Name of the grant program
 * @returns {Object|null} Template configuration or null if no template exists
 */
export function getBudgetTemplate(programName) {
  const normalizedName = programName.toLowerCase().trim();

  // CanExport variants
  if (normalizedName.includes('canexport')) {
    return CANEXPORT_TEMPLATE;
  }

  // RTRI variants
  if (normalizedName.includes('rtri') ||
      normalizedName.includes('regional technology') ||
      normalizedName.includes('technology readiness')) {
    return RTRI_TEMPLATE;
  }

  // BCAFE variants
  if (normalizedName.includes('bcafe') ||
      normalizedName.includes('bc agriculture') ||
      normalizedName.includes('bc ag') ||
      normalizedName.includes('food export')) {
    return BCAFE_TEMPLATE;
  }

  return null;
}

/**
 * List all available budget templates
 * @returns {Array} Array of template names
 */
export function listAvailableTemplates() {
  return [
    CANEXPORT_TEMPLATE.programName,
    RTRI_TEMPLATE.programName,
    BCAFE_TEMPLATE.programName
  ];
}

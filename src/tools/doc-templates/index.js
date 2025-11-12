/**
 * Document Template Registry
 *
 * Templates for 6 grant types × 4 document types = 24 templates
 *
 * Grant Types:
 * - hiring: Wage subsidies, hiring incentives
 * - market-expansion: Export development, market entry (CanExport, BCAFE)
 * - training: Employee training, skills development (ETG)
 * - rd: Research & development, innovation (RTRI, IRAP)
 * - loan: Financing, capital loans
 * - investment: Equity investments, venture capital
 *
 * Document Types:
 * - readiness-assessment (RA): Eligibility check, program overview
 * - interview-questions: Questions for client interview
 * - evaluation-rubric: Scoring framework with tables
 * - budget: Budget template (handled by budget-templates.js)
 */

// Import all templates
import * as hiringTemplates from './hiring/index.js';
import * as marketExpansionTemplates from './market-expansion/index.js';
import * as trainingTemplates from './training/index.js';
import * as rdTemplates from './rd/index.js';
import * as loanTemplates from './loan/index.js';
import * as investmentTemplates from './investment/index.js';

/**
 * Grant type metadata
 */
export const GRANT_TYPES = {
  hiring: {
    name: 'Hiring & Wage Subsidies',
    description: 'Programs that provide wage subsidies or hiring incentives',
    examples: ['Canada Summer Jobs', 'Youth Employment Programs', 'Wage Subsidy Programs']
  },
  'market-expansion': {
    name: 'Market Expansion & Export Development',
    description: 'Programs supporting export activities and international market entry',
    examples: ['CanExport SMEs', 'BCAFE', 'Trade Missions']
  },
  training: {
    name: 'Training & Skills Development',
    description: 'Programs funding employee training and upskilling',
    examples: ['BC Employer Training Grant (ETG)', 'Canada Job Grant', 'Workforce Training']
  },
  rd: {
    name: 'Research & Development',
    description: 'Programs supporting innovation, R&D, and technology development',
    examples: ['RTRI', 'NRC IRAP', 'SR&ED', 'Innovation Grants']
  },
  loan: {
    name: 'Loans & Financing',
    description: 'Non-repayable or repayable loans for business growth',
    examples: ['BDC Loans', 'Regional Loan Programs', 'Growth Financing']
  },
  investment: {
    name: 'Investment & Equity',
    description: 'Equity investments and venture capital programs',
    examples: ['Venture Capital Programs', 'Angel Investment Matching', 'Equity Funding']
  }
};

/**
 * Document type metadata
 */
export const DOCUMENT_TYPES = {
  'readiness-assessment': {
    name: 'Readiness Assessment (RA)',
    description: 'Eligibility check and program overview with 9 sections',
    sections: [
      'Program Overview',
      'Eligibility Requirements',
      'Scope of Work',
      'Budget & Financials',
      'Timeline & Milestones',
      'Supporting Documents',
      'Risk Assessment',
      'Team & Capacity',
      'Strategic Assessment'
    ]
  },
  'interview-questions': {
    name: 'Interview Questions',
    description: 'Questions for strategy team to use during client interviews',
    structure: ['Core Questions (Required)', 'Supplementary Questions (Optional)']
  },
  'evaluation-rubric': {
    name: 'Evaluation Rubric',
    description: 'Scoring framework using 1-10 scale with weighted criteria',
    structure: ['Criteria table with scoring', 'Overall recommendation']
  },
  budget: {
    name: 'Budget Template',
    description: 'Multi-sheet budget with eligible/ineligible expenses',
    note: 'Handled by budget-templates.js'
  }
};

/**
 * Template registry - maps (grantType, docType) to template
 */
export const TEMPLATES = {
  hiring: hiringTemplates,
  'market-expansion': marketExpansionTemplates,
  training: trainingTemplates,
  rd: rdTemplates,
  loan: loanTemplates,
  investment: investmentTemplates
};

/**
 * Get template for specific grant type and document type
 * @param {string} grantType - Grant type (hiring, market-expansion, etc.)
 * @param {string} docType - Document type (readiness-assessment, interview-questions, etc.)
 * @returns {Object|null} Template configuration or null if not found
 */
export function getTemplate(grantType, docType) {
  const normalizedGrantType = grantType.toLowerCase().replace(/[_\s]/g, '-');
  const normalizedDocType = docType.toLowerCase().replace(/[_\s]/g, '-');

  const grantTemplates = TEMPLATES[normalizedGrantType];
  if (!grantTemplates) {
    console.warn(`No templates found for grant type: ${grantType}`);
    return null;
  }

  const template = grantTemplates[normalizedDocType];
  if (!template) {
    console.warn(`No ${docType} template found for grant type: ${grantType}`);
    return null;
  }

  return template;
}

/**
 * Get all templates for a grant type
 * @param {string} grantType - Grant type
 * @returns {Object} All templates for this grant type
 */
export function getGrantTypeTemplates(grantType) {
  const normalizedGrantType = grantType.toLowerCase().replace(/[_\s]/g, '-');
  return TEMPLATES[normalizedGrantType] || null;
}

/**
 * List all available templates
 * @returns {Array} Array of {grantType, docType, name} objects
 */
export function listAllTemplates() {
  const templates = [];

  for (const [grantType, grantTemplates] of Object.entries(TEMPLATES)) {
    for (const [docType] of Object.entries(grantTemplates)) {
      templates.push({
        grantType,
        docType,
        name: `${GRANT_TYPES[grantType].name} - ${DOCUMENT_TYPES[docType].name}`
      });
    }
  }

  return templates;
}

/**
 * Infer grant type from program name
 * @param {string} programName - Grant program name
 * @returns {string} Inferred grant type
 */
export function inferGrantType(programName) {
  const normalized = programName.toLowerCase();

  // Market Expansion
  if (normalized.includes('export') || normalized.includes('canexport') ||
      normalized.includes('bcafe') || normalized.includes('trade') ||
      normalized.includes('market')) {
    return 'market-expansion';
  }

  // Training
  if (normalized.includes('training') || normalized.includes('etg') ||
      normalized.includes('upskill') || normalized.includes('employee training') ||
      normalized.includes('workforce')) {
    return 'training';
  }

  // R&D
  if (normalized.includes('rtri') || normalized.includes('irap') ||
      normalized.includes('research') || normalized.includes('innovation') ||
      normalized.includes('r&d') || normalized.includes('technology')) {
    return 'rd';
  }

  // Hiring
  if (normalized.includes('hire') || normalized.includes('hiring') ||
      normalized.includes('wage') || normalized.includes('summer jobs') ||
      normalized.includes('employment')) {
    return 'hiring';
  }

  // Loan
  if (normalized.includes('loan') || normalized.includes('financing') ||
      normalized.includes('capital') || normalized.includes('bdc')) {
    return 'loan';
  }

  // Investment
  if (normalized.includes('investment') || normalized.includes('equity') ||
      normalized.includes('venture') || normalized.includes('angel')) {
    return 'investment';
  }

  // Default to market-expansion (most common)
  console.warn(`Could not infer grant type for: ${programName}, defaulting to market-expansion`);
  return 'market-expansion';
}

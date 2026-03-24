/**
 * Grant Categorization Engine
 *
 * Deterministic classification using rate tables:
 * - Maps industry to group
 * - Calculates baseline estimate
 * - Determines service tier
 * - Assigns consultant
 * - Prepares focused search parameters
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Smart filter definitions for AI mapping
const SMART_FILTER_DEFINITIONS = {
  "Building Bench of Talent": "Hiring and training programs. Wage subsidies, student placements, apprenticeships, skills training, upskilling employees.",
  "Adopt Software or AI": "Digital transformation. Software/hardware purchases, cloud migration, AI/ML integration, digital marketing tools, technology training.",
  "Buy Equipment or Upgrade Facilities": "Capital investments. Equipment purchases, facility retrofits/expansion, automation hardware, production upgrades.",
  "Build Something New": "R&D and innovation. Prototype development, product development, pilot testing, IP protection, tech development, feasibility studies.",
  "International Growth": "Export and international expansion. Export development, trade shows, market research, foreign certification, international business development.",
  "Domestic Growth": "Canadian market expansion. Domestic trade shows, marketing campaigns, sales growth, expanding to new provinces.",
  "Improve Sustainability": "Environmental initiatives. Decarbonization, electrification, emissions reduction, clean tech, waste reduction, green jobs.",
  "Improve Productivity": "Operations improvement. Process optimization, lean manufacturing, productivity gains, automation for efficiency, advanced manufacturing.",
  "Commercialize or Scale": "Bringing products to market. Commercialization support, scaling production, go-to-market strategy, product validation, demonstration projects.",
  "Planning or Readiness Support": "Advisory and planning. Feasibility studies, readiness assessments, market research, business planning, consulting services, audits.",
  "Grants for Startups": "Early-stage company support. Startup-specific hiring, training, R&D, expansion, advisory, and loan programs for pre-revenue or newly incorporated companies."
};

// Cache loaded data files
let industryGroupsData = null;
let industryGroupMapping = null;
let provinceRates = {};
let federalRates = null;
let tierRules = null;
let consultantRouting = null;
let searchCategoryMapping = null;

/**
 * Load all data files at startup
 */
function loadDataFiles() {
  if (!industryGroupsData) {
    const dataDir = join(__dirname, '../../data/rates');

    industryGroupsData = JSON.parse(readFileSync(join(dataDir, 'industry-groups.json'), 'utf8'));
    industryGroupMapping = JSON.parse(readFileSync(join(dataDir, 'industry-group-mapping.json'), 'utf8'));
    federalRates = JSON.parse(readFileSync(join(dataDir, 'federal-rates.json'), 'utf8'));
    tierRules = JSON.parse(readFileSync(join(dataDir, 'tier-rules.json'), 'utf8'));
    consultantRouting = JSON.parse(readFileSync(join(dataDir, 'consultant-routing.json'), 'utf8'));
    searchCategoryMapping = JSON.parse(readFileSync(join(dataDir, 'search-category-mapping.json'), 'utf8'));

    console.log('✅ Grant categorization data files loaded');
  }
}

/**
 * Load province-specific rates
 */
function loadProvinceRates(province) {
  if (!provinceRates[province]) {
    const dataDir = join(__dirname, '../../data/rates');
    const provinceCode = province.toLowerCase().replace(/\s+/g, '-');
    const filePath = join(dataDir, `${provinceCode}-rates.json`);

    try {
      provinceRates[province] = JSON.parse(readFileSync(filePath, 'utf8'));
      console.log(`✅ Loaded ${province} rate table`);
    } catch (err) {
      console.warn(`⚠️  No rate table for ${province}, using default rates`);
      // Try default-rates.json, fall back to ON rates if that doesn't exist
      try {
        provinceRates[province] = JSON.parse(readFileSync(join(dataDir, 'default-rates.json'), 'utf8'));
        console.log(`✅ Using default rate table for ${province}`);
      } catch (err2) {
        console.warn(`⚠️  No default-rates.json found, using ON rates as ultimate fallback`);
        provinceRates[province] = JSON.parse(readFileSync(join(dataDir, 'on-rates.json'), 'utf8'));
      }
    }
  }
  return provinceRates[province];
}

/**
 * Resolve industry string to standardized industry + group
 *
 * Uses industry-group-mapping.json for comprehensive coverage of all widget dropdown values.
 *
 * @param {string} industryInput - Raw industry string
 * @returns {object} { matched_industry, group, group_label, confidence }
 */
export function resolveIndustry(industryInput) {
  loadDataFiles();

  if (!industryInput) {
    console.warn('⚠️  No industry provided, defaulting to Group 1');
    return {
      matched_industry: 'Other',
      group: 1,
      group_label: industryGroupMapping.groups['1'],
      confidence: 'default'
    };
  }

  const input = industryInput.trim();

  // Try exact match in comprehensive mapping
  if (industryGroupMapping.mapping[input]) {
    const group = industryGroupMapping.mapping[input];
    console.log(`✅ Industry: "${input}" → Group ${group} (${industryGroupMapping.groups[group.toString()]})`);
    return {
      matched_industry: input,
      group,
      group_label: industryGroupMapping.groups[group.toString()],
      confidence: 'exact'
    };
  }

  // Try case-insensitive match
  const inputLower = input.toLowerCase();
  for (const [industry, group] of Object.entries(industryGroupMapping.mapping)) {
    if (industry.toLowerCase() === inputLower) {
      console.log(`✅ Industry: "${input}" → Group ${group} (${industryGroupMapping.groups[group.toString()]}) [case-insensitive]`);
      return {
        matched_industry: industry,
        group,
        group_label: industryGroupMapping.groups[group.toString()],
        confidence: 'case_insensitive'
      };
    }
  }

  // Fallback to old industry-groups.json for legacy support
  // Try exact match
  if (industryGroupsData.industries[input]) {
    const group = industryGroupsData.industries[input];
    console.log(`✅ Industry: "${input}" → Group ${group} (${industryGroupsData.group_labels[group.toString()]}) [legacy exact]`);
    return {
      matched_industry: input,
      group,
      group_label: industryGroupsData.group_labels[group.toString()],
      confidence: 'legacy_exact'
    };
  }

  // Try synonym lookup
  if (industryGroupsData.synonyms[input]) {
    const matched = industryGroupsData.synonyms[input];
    const group = industryGroupsData.industries[matched];
    console.log(`✅ Industry: "${input}" → "${matched}" → Group ${group} (${industryGroupsData.group_labels[group.toString()]}) [synonym]`);
    return {
      matched_industry: matched,
      group,
      group_label: industryGroupsData.group_labels[group.toString()],
      confidence: 'synonym'
    };
  }

  // Default to Group 1
  console.warn(`⚠️  No match for industry "${input}", defaulting to Group 1`);
  return {
    matched_industry: 'Other',
    group: 1,
    group_label: industryGroupMapping.groups['1'],
    confidence: 'default'
  };
}

/**
 * Calculate baseline estimate using group rates
 *
 * @param {object} groupRates - Rate object for the industry group
 * @param {object} prospectData - Prospect inputs
 * @returns {object} Baseline estimates by category
 */
function calculateBaselineEstimate(groupRates, prospectData) {
  const estimate = {
    hiring: { low: 0, high: 0 },
    training: { low: 0, high: 0 },
    market_expansion: { low: 0, high: 0 },
    rd: { low: 0, high: 0 },
    total_low: 0,
    total_high: 0
  };

  // Hiring estimates
  const numHires = prospectData.num_hires || 0;
  const numStudentHires = prospectData.num_student_hires || 0;
  const numRecentGradHires = prospectData.num_recent_grad_hires || 0;

  if (numHires > 0 && groupRates.hiring_base_per_hire > 0) {
    estimate.hiring.low += numHires * groupRates.hiring_base_per_hire * 0.5;
    estimate.hiring.high += numHires * groupRates.hiring_base_per_hire;
  }

  if (numStudentHires > 0 && groupRates.hiring_student_per_hire > 0) {
    estimate.hiring.low += numStudentHires * groupRates.hiring_student_per_hire * 0.7;
    estimate.hiring.high += numStudentHires * groupRates.hiring_student_per_hire;
  }

  if (numRecentGradHires > 0 && groupRates.hiring_recent_grad_per_hire > 0) {
    estimate.hiring.low += numRecentGradHires * groupRates.hiring_recent_grad_per_hire * 0.7;
    estimate.hiring.high += numRecentGradHires * groupRates.hiring_recent_grad_per_hire;
  }

  // Training estimates
  const trainingSpend = prospectData.annual_training_spend || 0;
  if (trainingSpend > 0) {
    const numFtes = prospectData.num_ftes || 0;
    const rate = numFtes < groupRates.training_small_company_threshold_ftes
      ? groupRates.training_small_company_rate
      : groupRates.training_rate;

    estimate.training.low = trainingSpend * rate * 0.5;
    estimate.training.high = trainingSpend * rate;
  }

  // Market expansion estimates
  const internationalSpend = prospectData.international_market_spend || 0;
  if (internationalSpend > 0) {
    const estimatedFunding = Math.min(
      internationalSpend * groupRates.international_expansion_rate,
      groupRates.international_expansion_max
    );
    estimate.market_expansion.low = estimatedFunding * 0.6;
    estimate.market_expansion.high = estimatedFunding;
  }

  // R&D estimates
  const rdSpend = prospectData.rd_spend || 0;
  if (rdSpend > 0) {
    const estimatedFunding = Math.min(
      rdSpend * groupRates.rd_rate,
      groupRates.rd_max
    );
    estimate.rd.low = estimatedFunding * 0.5;
    estimate.rd.high = estimatedFunding;
  }

  // Calculate base totals
  const baseTotalLow = estimate.hiring.low + estimate.training.low + estimate.market_expansion.low + estimate.rd.low;
  const baseTotalHigh = estimate.hiring.high + estimate.training.high + estimate.market_expansion.high + estimate.rd.high;

  // Apply 25% cyclical programs multiplier (accounts for programs that run multiple cycles per year)
  estimate.total_low = Math.round(baseTotalLow * 1.25);
  estimate.total_high = Math.round(baseTotalHigh * 1.25);

  return estimate;
}

/**
 * Determine service tier based on rules
 *
 * @param {object} prospectData - Prospect inputs
 * @param {number} industryGroup - Industry group number
 * @returns {object} { tier, reasoning }
 */
function determineTier(prospectData, industryGroup) {
  loadDataFiles();

  const context = {
    is_nonprofit: prospectData.is_nonprofit || false,
    is_incorporated_1yr: prospectData.is_incorporated_1yr !== false, // Default true
    revenue_tier: prospectData.revenue_tier || 'unknown',
    funds_raised: prospectData.funds_raised || 0,
    industry_group: industryGroup
  };

  // Evaluate rules in order
  for (const rule of tierRules.rules) {
    if (evaluateCondition(rule.condition, context)) {
      return {
        tier: rule.tier,
        reasoning: rule.reason
      };
    }
  }

  // Default fallback
  return {
    tier: 'starter',
    reasoning: 'Default tier (no matching rules)'
  };
}

/**
 * Evaluate a tier rule condition
 * Simple expression evaluator for rule conditions
 */
function evaluateCondition(condition, context) {
  // Handle simple boolean checks
  if (condition === 'is_nonprofit') return context.is_nonprofit;
  if (condition === '!is_incorporated_1yr') return !context.is_incorporated_1yr;

  // Handle equality checks
  if (condition.includes('==')) {
    const [left, right] = condition.split('==').map(s => s.trim());
    const leftVal = context[left];
    const rightVal = right.replace(/'/g, '');
    return leftVal === rightVal;
  }

  // Handle 'in' checks
  if (condition.includes(' in ')) {
    const match = condition.match(/(\w+)\s+in\s+\[(.*?)\]/);
    if (match) {
      const variable = match[1];
      const values = match[2].split(',').map(v => v.trim().replace(/'/g, ''));
      return values.includes(context[variable]);
    }
  }

  // Handle AND conditions
  if (condition.includes(' && ')) {
    const parts = condition.split(' && ');
    return parts.every(part => evaluateCondition(part.trim(), context));
  }

  // Handle comparison operators
  if (condition.includes(' < ')) {
    const [left, right] = condition.split(' < ').map(s => s.trim());
    return context[left] < parseInt(right);
  }
  if (condition.includes(' >= ')) {
    const [left, right] = condition.split(' >= ').map(s => s.trim());
    return context[left] >= parseInt(right);
  }

  return false;
}

/**
 * Assign consultant based on industry
 *
 * @param {string} industry - Standardized industry string
 * @returns {object} { name, booking_link }
 */
function assignConsultant(industry) {
  loadDataFiles();

  for (const [key, consultant] of Object.entries(consultantRouting.consultants)) {
    if (consultant.industries.includes(industry)) {
      return {
        name: consultant.name,
        booking_link: consultant.booking_link
      };
    }
  }

  // Use default consultant
  const defaultKey = consultantRouting.default_consultant;
  const defaultConsultant = consultantRouting.consultants[defaultKey];

  return {
    name: defaultConsultant.name,
    booking_link: defaultConsultant.booking_link
  };
}

/**
 * Map prospect to relevant smart filters using AI
 *
 * @param {object} prospectData - Prospect information
 * @param {string} industry - Resolved industry
 * @returns {Promise<object>} Weighted smart filter mapping
 */
async function mapProspectToSmartFilters(prospectData, industry) {
  try {
    console.log('\n🤖 Mapping prospect to smart filters using Haiku...');

    // Build context from prospect data
    const context = {
      industry: industry || prospectData.industry || 'Unknown',
      company_description: prospectData.company_background?.ai_extracted_description || prospectData.company_description || 'Not provided',
      planned_activities: prospectData.planned_activities || 'Not provided',
      hiring_plans: prospectData.num_hires || 0,
      student_hires: prospectData.num_student_hires || 0,
      training_budget: prospectData.annual_training_spend || 0,
      rd_spend: prospectData.rd_spend || 0,
      international_expansion: prospectData.international_market_spend || 0,
      capital_investment: prospectData.capital_investment || 0,
      revenue_tier: prospectData.revenue_tier || 'unknown',
      num_employees: prospectData.num_ftes || 0
    };

    const prompt = `You are analyzing a Canadian business to determine which grant categories are most relevant.

BUSINESS CONTEXT:
- Industry: ${context.industry}
- Company description: ${context.company_description}
- Planned activities: ${context.planned_activities}
- Hiring plans: ${context.hiring_plans} new hires, ${context.student_hires} student/co-op placements
- Training budget: $${context.training_budget}
- R&D spend: $${context.rd_spend}
- International expansion budget: $${context.international_expansion}
- Capital investment planned: $${context.capital_investment}
- Revenue tier: ${context.revenue_tier}
- Employees: ${context.num_employees}

SMART FILTER DEFINITIONS:
${Object.entries(SMART_FILTER_DEFINITIONS).map(([name, desc]) => `- "${name}": ${desc}`).join('\n')}

TASK:
Determine which of the 11 smart filters are relevant for this business. Assign weights:
- 2 = PRIMARY relevance (this is a core need/activity for the business)
- 1 = SECONDARY relevance (this is a potential or minor need)
- 0 = NOT relevant (do not include in output)

Return ONLY a JSON object with this structure:
{
  "smart_filters": {
    "Filter Name": weight,
    "Another Filter": weight
  }
}

Only include filters with weight 1 or 2. Be selective - most businesses should have 2-4 filters, not all 11.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = response.content[0].text.trim();

    // Extract JSON from response (handles cases where model adds explanation)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️  Haiku response did not contain JSON, using fallback mapping');
      return getFallbackSmartFilterMapping(prospectData);
    }

    const result = JSON.parse(jsonMatch[0]);

    console.log('✅ Smart filter mapping:', JSON.stringify(result.smart_filters, null, 2));
    console.log(`   Cost: ~$${((response.usage.input_tokens / 1000000) * 1.0 + (response.usage.output_tokens / 1000000) * 5.0).toFixed(4)}`);

    return result.smart_filters;

  } catch (error) {
    console.error('❌ Smart filter mapping failed:', error.message);
    console.warn('⚠️  Using fallback smart filter mapping');
    return getFallbackSmartFilterMapping(prospectData);
  }
}

/**
 * Fallback smart filter mapping (deterministic rules)
 */
function getFallbackSmartFilterMapping(prospectData) {
  const filters = {};

  // Hiring/Training
  if ((prospectData.num_hires || 0) > 0 || (prospectData.num_student_hires || 0) > 0 || (prospectData.annual_training_spend || 0) > 0) {
    filters['Building Bench of Talent'] = 2;
  }

  // International expansion
  if ((prospectData.international_market_spend || 0) > 0) {
    filters['International Growth'] = 2;
  }

  // R&D
  if ((prospectData.rd_spend || 0) > 0) {
    filters['Build Something New'] = 2;
  }

  // Capital investment
  if ((prospectData.capital_investment || 0) > 0) {
    filters['Buy Equipment or Upgrade Facilities'] = 2;
  }

  // Startups (pre-revenue or <2 years incorporated)
  if (prospectData.revenue_tier === 'pre_revenue') {
    filters['Grants for Startups'] = 2;
  }

  // If nothing else, add general categories
  if (Object.keys(filters).length === 0) {
    filters['Improve Productivity'] = 1;
    filters['Planning or Readiness Support'] = 1;
  }

  console.log('✅ Fallback smart filter mapping:', filters);
  return filters;
}

/**
 * Main categorization function
 *
 * @param {object} prospectData - Webform + agent-collected data
 * @returns {Promise<object>} Categorization result
 */
export async function categorizeProspect(prospectData) {
  loadDataFiles();

  console.log('\n🏷️  CATEGORIZING PROSPECT');
  console.log('  Input:', JSON.stringify(prospectData, null, 2));

  // Step 1: Resolve industry
  const industryResolution = resolveIndustry(prospectData.industry);
  console.log(`✅ Industry: ${industryResolution.matched_industry} → Group ${industryResolution.group} (${industryResolution.confidence} match)`);

  // Step 2: Load province rates
  const province = prospectData.province || 'ON';
  const provinceRatesData = loadProvinceRates(province);
  const groupRates = provinceRatesData.groups[industryResolution.group.toString()];

  // Step 3: Calculate baseline estimate
  const baselineEstimate = calculateBaselineEstimate(groupRates, prospectData);
  console.log(`✅ Baseline estimate: $${Math.round(baselineEstimate.total_low/1000)}K–$${Math.round(baselineEstimate.total_high/1000)}K`);

  // Step 4: Determine tier
  const tierResult = determineTier(prospectData, industryResolution.group);
  console.log(`✅ Service tier: ${tierResult.tier} (${tierResult.reasoning})`);

  // Step 4.5: Check for high-volume flag (high employee count + significant training budget)
  const highEmployeeCounts = ['50 – 99', '100 – 499', '500+'];
  const significantTrainingBudgets = ['$10K – $25K', '$25K – $50K', '$50K – $100K', '$100K+'];

  const highVolumeFlag =
    highEmployeeCounts.includes(prospectData.employee_count) &&
    significantTrainingBudgets.includes(prospectData.training_budget);

  let highVolumeFlagNote = null;
  if (highVolumeFlag) {
    highVolumeFlagNote = "High employee count with significant training budget — verify if 3 Starter tokens are sufficient before confirming tier.";
    console.log(`⚠️  High-volume flag: ${highVolumeFlagNote}`);
  }

  // Step 5: Assign consultant (if Pro tier)
  let consultantAssignment = null;
  let bookingLink = null;

  if (tierResult.tier === 'pro') {
    consultantAssignment = assignConsultant(industryResolution.matched_industry);
    bookingLink = consultantAssignment.booking_link;
    console.log(`✅ Consultant assigned: ${consultantAssignment.name}`);
  } else {
    // Use tier metadata for booking link
    bookingLink = tierRules.tier_metadata[tierResult.tier]?.booking_link || null;
  }

  // Step 6: Build grant categories to search
  const grantCategories = buildGrantCategories(industryResolution.group, prospectData);
  console.log(`✅ Grant categories: ${grantCategories.join(', ')}`);

  // Step 7: Build search parameters
  const searchParameters = buildSearchParameters(
    industryResolution,
    province,
    grantCategories,
    prospectData
  );

  // Step 8: Map prospect to smart filters using AI
  const smartFilterWeights = await mapProspectToSmartFilters(prospectData, industryResolution.matched_industry);
  console.log(`✅ Smart filters: ${Object.entries(smartFilterWeights).map(([f, w]) => `${f} (${w})`).join(', ')}`);

  console.log('✅ CATEGORIZATION COMPLETE\n');

  return {
    industry_group: industryResolution.group,
    industry_group_label: industryResolution.group_label,
    matched_industry: industryResolution.matched_industry,
    industry_confidence: industryResolution.confidence,
    service_tier: tierResult.tier,
    tier_reasoning: tierResult.reasoning,
    consultant_assignment: consultantAssignment,
    booking_link: bookingLink,
    baseline_estimate: baselineEstimate,
    grant_categories_to_search: grantCategories,
    search_parameters: searchParameters,
    smart_filter_weights: smartFilterWeights,
    province: province,
    high_volume_flag: highVolumeFlag,
    high_volume_flag_note: highVolumeFlagNote
  };
}

/**
 * Build list of grant categories to search
 */
function buildGrantCategories(industryGroup, prospectData) {
  loadDataFiles();

  const categories = new Set();

  // Add base categories for the industry group
  const groupCategories = searchCategoryMapping.group_categories[industryGroup.toString()] || [];
  groupCategories.forEach(cat => categories.add(cat));

  // Add activity-based categories
  if ((prospectData.num_hires || 0) > 0) {
    searchCategoryMapping.activity_categories.has_hires.forEach(cat => categories.add(cat));
  }
  if ((prospectData.num_student_hires || 0) > 0) {
    searchCategoryMapping.activity_categories.has_student_hires.forEach(cat => categories.add(cat));
  }
  if ((prospectData.num_recent_grad_hires || 0) > 0) {
    searchCategoryMapping.activity_categories.has_grad_hires.forEach(cat => categories.add(cat));
  }
  if ((prospectData.annual_training_spend || 0) > 0) {
    searchCategoryMapping.activity_categories.has_training_spend.forEach(cat => categories.add(cat));
  }
  if ((prospectData.international_market_spend || 0) > 0) {
    searchCategoryMapping.activity_categories.has_international_expansion.forEach(cat => categories.add(cat));
  }
  if ((prospectData.rd_spend || 0) > 0) {
    searchCategoryMapping.activity_categories.has_rd_spend.forEach(cat => categories.add(cat));
  }

  return Array.from(categories);
}

/**
 * Map province code to full name for search API
 */
const PROVINCE_FULL_NAMES = {
  'ON': 'Ontario',
  'BC': 'British Columbia',
  'AB': 'Alberta',
  'QC': 'Quebec',
  'MB': 'Manitoba',
  'SK': 'Saskatchewan',
  'NS': 'Nova Scotia',
  'NB': 'New Brunswick',
  'PE': 'Prince Edward Island',
  'NL': 'Newfoundland and Labrador',
  'NT': 'Northwest Territories',
  'YT': 'Yukon',
  'NU': 'Nunavut'
};

/**
 * Build search parameters for focused search
 */
function buildSearchParameters(industryResolution, province, grantCategories, prospectData) {
  loadDataFiles();

  // Build purposes list from categories
  const purposes = new Set();
  grantCategories.forEach(cat => {
    const categoryPurposes = searchCategoryMapping.category_to_purposes[cat] || [];
    categoryPurposes.forEach(p => purposes.add(p));
  });

  // Build keywords from industry + categories
  const keywords = new Set();

  // Use original industry string when matched_industry is "Other" to preserve specificity
  // Original form value (e.g., "Food Service / Hospitality") produces better keyword matches
  // than generic group label (e.g., "Professional Services & Services")
  const industryKeyword = industryResolution.matched_industry === 'Other'
    ? (prospectData.industry || industryResolution.group_label)
    : industryResolution.matched_industry;

  keywords.add(industryKeyword);
  keywords.add(industryResolution.group_label);

  grantCategories.forEach(cat => {
    const catKeywords = searchCategoryMapping.category_keywords[cat] || [];
    catKeywords.forEach(kw => keywords.add(kw));
  });

  // Calculate max grant amount filter (exclude grants >10x annual revenue)
  const revenueMap = {
    'pre_revenue': 0,
    'lt_500k': 500000,
    '500k_2.5mm': 2500000,
    '2.5mm_5mm': 5000000,
    '5mm_plus': 10000000
  };
  const estimatedRevenue = revenueMap[prospectData.revenue_tier] || 1000000;
  const maxGrantAmount = estimatedRevenue * 10;

  // Get full province name for search API (expects "British Columbia" not "BC")
  const provinceFullName = PROVINCE_FULL_NAMES[province] || province;

  return {
    province: province,
    province_full_name: provinceFullName,
    purposes: Array.from(purposes),
    keywords: Array.from(keywords),
    industry_keyword: industryKeyword,
    company_size: prospectData.num_ftes || null,
    exclude_grant_amounts_above: maxGrantAmount
  };
}

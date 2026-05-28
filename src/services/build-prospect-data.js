/**
 * Build prospect_data shape from raw form fields.
 *
 * Shared between `src/tools/executor.js` (search_getgranted handler, post-conversation
 * categorization) and `src/api/lead-gen-init.js` (intake-time categorization).
 *
 * The output is the input format consumed by `categorizeProspect` in
 * `src/services/grant-categorization.js`. Byte-identical to the inline
 * mapping previously in executor.js.
 */

/**
 * Province name to code mapping
 */
const PROVINCE_CODES = {
  'ontario': 'ON', 'british columbia': 'BC', 'alberta': 'AB',
  'quebec': 'QC', 'manitoba': 'MB', 'saskatchewan': 'SK',
  'nova scotia': 'NS', 'new brunswick': 'NB',
  'prince edward island': 'PE', 'newfoundland and labrador': 'NL',
  'northwest territories': 'NT', 'yukon': 'YT', 'nunavut': 'NU',
  // Also handle codes passed directly
  'on': 'ON', 'bc': 'BC', 'ab': 'AB', 'qc': 'QC', 'mb': 'MB', 'sk': 'SK',
  'ns': 'NS', 'nb': 'NB', 'pe': 'PE', 'nl': 'NL', 'nt': 'NT', 'yt': 'YT', 'nu': 'NU'
};

/**
 * Normalize province name to code
 */
function normalizeProvince(province) {
  if (!province) return null;
  return PROVINCE_CODES[province.toLowerCase()] || province;
}

/**
 * Generic parser for webform range strings
 * Handles: "5 – 19", "$10K – $25K", "Under $10K", "$5M+", "1 – 2 people"
 */
function parseWebformRange(value) {
  if (!value || typeof value !== 'string') return 0;

  let s = value.replace(/people|employees|hires/gi, '').trim();

  // Helper to parse a single number token like "$10K" or "2.5M" or "500"
  function parseNumberToken(token) {
    token = token.replace(/[$,]/g, '').trim();
    let multiplier = 1;
    if (/mm/i.test(token)) { multiplier = 1000000; token = token.replace(/mm/i, ''); }
    else if (/m/i.test(token)) { multiplier = 1000000; token = token.replace(/m/i, ''); }
    else if (/k/i.test(token)) { multiplier = 1000; token = token.replace(/k/i, ''); }
    const num = parseFloat(token);
    return isNaN(num) ? 0 : num * multiplier;
  }

  // "Under X" or "Less than X" → use half
  if (/under|less than|<\s*/i.test(s)) {
    const num = parseNumberToken(s.replace(/under|less than|<\s*/i, ''));
    return Math.round(num / 2);
  }

  // "X+" or "X or more" or "Over X" → use the number as-is (or slightly higher for "Over")
  if (/\+|or more|plus/i.test(s)) {
    return parseNumberToken(s.replace(/\+|or more|plus/gi, ''));
  }
  if (/over|>\s*/i.test(s)) {
    return parseNumberToken(s.replace(/over|>\s*/i, ''));
  }

  // Range: "X – Y" or "X to Y" or "X - Y" (various dash types)
  const rangeMatch = s.match(/(.+?)(?:\s*[–\-—]\s*|\s+to\s+)(.+)/i);
  if (rangeMatch) {
    const low = parseNumberToken(rangeMatch[1]);
    const high = parseNumberToken(rangeMatch[2]);
    return Math.round((low + high) / 2);
  }

  // Single number
  return parseNumberToken(s);
}

/**
 * Map revenue range string to tier enum
 */
function mapRevenueTier(revenueRange) {
  if (!revenueRange) return 'unknown';

  const s = revenueRange.toLowerCase().replace(/\s+/g, '');

  // Pre-revenue
  if (s.includes('pre-revenue') || s.includes('prerevenue') || s === '0') return 'pre_revenue';

  // Under $500K or $100K to $500K
  if ((s.includes('under') || s.includes('<')) && s.includes('500k')) return 'lt_500k';
  if ((s.includes('under') || s.includes('<')) && s.includes('100k')) return 'lt_500k';
  if (s.includes('100k') && s.includes('500k')) return 'lt_500k';

  // $500K to $2.5MM (or $2M or $2.5M)
  if (s.includes('500k') && (s.includes('2.5') || s.includes('2m') || s.includes('2mm'))) return '500k_2.5mm';

  // $2.5MM to $5MM (or variations)
  if ((s.includes('2.5') || s.includes('2m')) && (s.includes('5m') || s.includes('5mm'))) return '2.5mm_5mm';

  // Over $5MM
  if ((s.includes('over') || s.includes('>') || s.includes('+')) && (s.includes('5m') || s.includes('5mm'))) return '5mm_plus';

  return 'unknown';
}

/**
 * Parse employee count from range string using generic parser
 */
function parseEmployeeCount(employeeCount) {
  if (!employeeCount) return 0;
  return parseWebformRange(employeeCount);
}

/**
 * Parse hiring plans text to extract hire counts
 */
function parseHiringPlans(hiringPlans) {
  const result = {
    num_hires: 0,
    num_student_hires: 0,
    num_recent_grad_hires: 0
  };

  if (!hiringPlans) return result;

  const text = hiringPlans.toLowerCase();

  // Parse the numeric value (could be range like "1 – 2" or single number)
  const numHires = parseWebformRange(hiringPlans);

  if (numHires > 0) {
    if (text.includes('student') || text.includes('co-op') || text.includes('intern')) {
      result.num_student_hires = numHires;
    } else if (text.includes('recent grad') || text.includes('graduate')) {
      result.num_recent_grad_hires = numHires;
    } else {
      result.num_hires = numHires;
    }
  }

  return result;
}

/**
 * Parse spend amount from range string using generic parser
 */
function parseSpendAmount(spendRange) {
  if (!spendRange) return 0;
  if (/none/i.test(spendRange)) return 0;
  return parseWebformRange(spendRange);
}

/**
 * Build categorization-input shape from raw form fields.
 *
 * @param {Object} prospectData - Raw form fields (the JSONB stored in
 *   lead_gen_conversations.prospect_data). Keys: industry, province,
 *   revenue_range, employee_count, hiring_plans, training_budget,
 *   expansion_budget, planned_activities.
 * @param {Object} [companyBackground] - Optional Haiku-extracted background.
 *   Used only as a fallback for industry when the form didn't provide one.
 * @returns {Object} categorization input
 */
export function buildProspectDataFromForm(prospectData = {}, companyBackground = {}) {
  // DIAGNOSTIC: Log raw form values before parsing
  console.log('  📋 Raw form values from prospect_data:');
  console.log(`     hiring_plans: "${prospectData.hiring_plans}"`);
  console.log(`     training_budget: "${prospectData.training_budget}"`);
  console.log(`     expansion_budget: "${prospectData.expansion_budget}"`);
  console.log(`     planned_activities: "${prospectData.planned_activities}"`);

  const hiringParsed = parseHiringPlans(prospectData.hiring_plans);
  const trainingParsed = parseSpendAmount(prospectData.training_budget);
  const expansionParsed = parseSpendAmount(prospectData.expansion_budget);

  console.log('  🔢 Parsed numeric values:');
  console.log(`     num_hires: ${hiringParsed.num_hires}, num_student_hires: ${hiringParsed.num_student_hires}`);
  console.log(`     annual_training_spend: $${trainingParsed}`);
  console.log(`     international_market_spend: $${expansionParsed}`);

  const data = {
    // Industry (prioritize form dropdown selection over Haiku extraction)
    // Form uses exact grant vocabulary like "Tech - Software/Web Development", "Retail"
    industry: prospectData.industry || companyBackground.industry || null,

    // Province (normalize to code: "British Columbia" → "BC")
    province: normalizeProvince(prospectData.province) || 'ON',

    // Revenue tier mapping
    revenue_tier: mapRevenueTier(prospectData.revenue_range),

    // Employee count (parse from range string)
    num_ftes: parseEmployeeCount(prospectData.employee_count),

    // Hiring plans (parsed values)
    ...hiringParsed,

    // Training budget (parsed value)
    annual_training_spend: trainingParsed,

    // Market expansion (parsed value)
    international_market_spend: expansionParsed,

    // R&D spend (not collected in form yet, default to 0)
    rd_spend: 0,

    // Incorporation status (assume yes if they have revenue)
    is_incorporated_1yr: prospectData.revenue_range !== 'Pre-revenue',

    // Nonprofit status (assume no unless explicitly indicated)
    is_nonprofit: false,

    // Funds raised (not collected in form, default to 0)
    funds_raised: 0,

    // Activity text for keyword boost
    planned_activities: prospectData.planned_activities || null
  };

  console.log('  ✅ Built prospect data from session:', JSON.stringify(data, null, 2));
  return data;
}

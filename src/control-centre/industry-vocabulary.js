/**
 * Control Centre — the matching engine's industry vocabulary, COPIED.
 *
 * Source: gg3-ai-service src/lib/matching/vocabulary.ts @ c3792e3 (2026-10-22):
 *   CANONICAL_INDUSTRIES          → MAIN_INDUSTRIES (the 16 main industries)
 *   GRANT_INDUSTRY_TO_CANONICAL   → TOKEN_TO_MAINS (84 specific tokens → main)
 *   PROFILE_INDUSTRY_ALIASES      → PROFILE_ALIASES
 *   PROFILE_INDUSTRY_EXPANSIONS   → PROFILE_EXPANSIONS
 *
 * The Hub can't read these anywhere else: no table or endpoint holds them, and
 * app `tags` has the 84 tokens but parents only for Agriculture and
 * Manufacturing. Chris chose a checked-in copy (2026-10-19) over a new
 * gg3-ai-service endpoint. tests/unit/control-centre-industry-vocabulary.test.js
 * fails when this copy and the sibling repo's file disagree (skipped when the
 * sibling repo isn't on disk). To refresh: copy the four literals again and
 * update the commit above. Never edit the values by hand.
 *
 * The engine gates industry at the MAIN level (evaluateIndustryMatch compares
 * canonical sets), so specific tokens are a finer display, not a finer gate.
 */

export const MAIN_INDUSTRIES = Object.freeze([
  'Agriculture',
  'Clean Technology',
  'Construction',
  'Digital Media',
  'Education',
  'Energy',
  'Finance',
  'Health',
  'Manufacturing',
  'Professional Services',
  'Retail',
  'Software',
  'Transportation & Logistics',
  'Natural Resources',
  'Hospitality & Tourism',
  'Food & Beverage'
]);

// Specific token → its main(s). [] = a business type or placeholder, not an industry.
// This is the GRANT side; a company's industry also goes through PROFILE_EXPANSIONS.
export const TOKEN_TO_MAINS = Object.freeze({
  'Agriculture': ['Agriculture'],
  'Agriculture - Crop': ['Agriculture'],
  'Agriculture - Livestock': ['Agriculture'],
  'Agriculture - Dairy': ['Agriculture'],
  'Agriculture - Tree Fruit': ['Agriculture'],
  'Agriculture - Vineyard/Wine': ['Agriculture'],
  'Environmental - Green Technologies': ['Clean Technology'],
  'Environmental - Waste Management': ['Clean Technology'],
  'Construction': ['Construction'],
  'Construction - Supplier': ['Construction'],
  'Film/Music/Entertainment': ['Digital Media'],
  'Media - Print/Publishing': ['Digital Media'],
  'Media - Broadcast': ['Digital Media'],
  'Media - Podcast': ['Digital Media'],
  'Tech - Animation': ['Digital Media'],
  'Educational Services': ['Education'],
  'Environmental - Education': ['Education'],
  'Utilities': ['Energy'],
  'Financial': ['Finance'],
  'Insurance': ['Finance'],
  'Healthcare': ['Health'],
  'Healthcare - Technology': ['Health'],
  'Healthcare - Dental': ['Health'],
  'Healthcare - Physio': ['Health'],
  'Wellness': ['Health'],
  'Wellness - Registered Practitioner': ['Health'],
  'Wellness - Fitness/Yoga/Pilates': ['Health'],
  'Wellness - Counselling/Therapy': ['Health'],
  'Alternative Medicine': ['Health'],
  'Veterinary': ['Health'],
  'Manufacturing': ['Manufacturing'],
  'Manufacturing - Industrial': ['Manufacturing'],
  'Manufacturing - Electronic': ['Manufacturing'],
  'Manufacturing - Wood Products': ['Manufacturing'],
  'Manufacturing - Metal': ['Manufacturing'],
  'Manufacturing - Plastics': ['Manufacturing'],
  'Manufacturing - Paper/Print': ['Manufacturing'],
  'Manufacturing - Consumer Goods': ['Manufacturing'],
  'Manufacturing - Apparel/Textiles': ['Manufacturing'],
  'Food Processing': ['Food & Beverage'],
  'Manufacturing - Food & Beverage': ['Food & Beverage'],
  'Fishery': ['Food & Beverage'],
  'Mining & Quarrying': ['Natural Resources'],
  'Critical Minerals': ['Natural Resources'],
  'Oil & Gas Extraction': ['Natural Resources', 'Energy'],
  'Forestry': ['Natural Resources'],
  'Logistics & Trucking': ['Transportation & Logistics'],
  'Warehousing': ['Transportation & Logistics'],
  'Hospitality/Lodging/Tourism': ['Hospitality & Tourism'],
  'Recreation': ['Hospitality & Tourism'],
  'Travel': ['Hospitality & Tourism'],
  'Restaurants & Cafes': ['Hospitality & Tourism'],
  'Consulting - Business': ['Professional Services'],
  'Legal': ['Professional Services'],
  'Accounting': ['Professional Services'],
  'Engineering': ['Professional Services'],
  'Architecture/Design': ['Professional Services'],
  'Advertising/Marketing': ['Professional Services'],
  'Public Relations': ['Professional Services'],
  'Retail': ['Retail'],
  'E-commerce': ['Retail'],
  'Automotive Dealers': ['Retail'],
  'Tech - Software & Web Development': ['Software'],
  'Tech - AI': ['Software'],
  'Tech - Computer Network Security': ['Software'],
  'Healthcare - Manufacturing': ['Health', 'Manufacturing'],
  'Tech - Video Game': ['Software', 'Digital Media'],
  'Tech - Biotechnology': ['Health'],
  'Tech - Technology Hardware': ['Manufacturing'],
  'Aviation & Aerospace': ['Manufacturing'],
  'Ship Building/Repair & Maritime Operations': ['Manufacturing'],
  'Tech - Defense': ['Manufacturing'],
  'Defense': ['Manufacturing'],
  'Arts & Culture': ['Digital Media'],
  'Wholesaling': ['Retail'],
  'Esthetics & Spas': ['Retail'],
  'Auto Repairs & Auto Parts': ['Retail'],
  'Real Estate': ['Professional Services'],
  'Other': [],
  'Charity/Non-profit': [],
  'Association': [],
  'Social Enterprise': [],
  'Auxiliary Services': [],
  'Consumer Services': []
});

export const PROFILE_ALIASES = Object.freeze({
  'software and it': 'Software',
  'healthcare': 'Health',
  'food and beverage': 'Food & Beverage',
  'technology hardware': 'Manufacturing',
  'transportation and logistics': 'Transportation & Logistics',
  'logistics': 'Transportation & Logistics',
  'hospitality and tourism': 'Hospitality & Tourism',
  'hospitality': 'Hospitality & Tourism',
  'tourism': 'Hospitality & Tourism'
});

// A COMPANY in one of these also belongs to the parent main(s); a GRANT with the
// same token means the narrow main only (TOKEN_TO_MAINS). Checked first.
export const PROFILE_EXPANSIONS = Object.freeze({
  'food processing': ['Food & Beverage', 'Manufacturing'],
  'manufacturing - food & beverage': ['Food & Beverage', 'Manufacturing'],
  'forestry': ['Natural Resources', 'Agriculture'],
  'fishery': ['Natural Resources', 'Agriculture', 'Food & Beverage']
});

const TOKEN_INDEX_LC = new Map(Object.entries(TOKEN_TO_MAINS).map(([k, v]) => [k.toLowerCase(), v]));

/** A grant tag token → its main industries (exact, like normalizeIndustries). [] when it maps to none. */
export const tokenMains = (token) => TOKEN_TO_MAINS[String(token ?? '').trim()] ?? [];

/**
 * One profile industry value → its main industries, the engine's
 * normalizeProfileIndustry: expansion, then alias, then a main name, then a
 * token, all case-insensitive. [] when it maps to nothing.
 */
export function profileMains(raw) {
  const lower = String(raw ?? '').trim().toLowerCase();
  if (!lower) return [];
  if (PROFILE_EXPANSIONS[lower]) return [...PROFILE_EXPANSIONS[lower]];
  if (PROFILE_ALIASES[lower]) return [PROFILE_ALIASES[lower]];
  const main = MAIN_INDUSTRIES.find((m) => m.toLowerCase() === lower);
  if (main) return [main];
  return [...(TOKEN_INDEX_LC.get(lower) ?? [])];
}

/** The vocabulary's spelling of a token, case-insensitively; null when it isn't one. */
export function canonicalToken(raw) {
  const lower = String(raw ?? '').trim().toLowerCase();
  return Object.keys(TOKEN_TO_MAINS).find((k) => k.toLowerCase() === lower) ?? null;
}

/** Specific tokens under each main (a token under two mains is listed under both). */
export function specificsByMain() {
  const out = new Map(MAIN_INDUSTRIES.map((m) => [m, []]));
  for (const [token, mains] of Object.entries(TOKEN_TO_MAINS)) {
    for (const m of mains) if (token !== m) out.get(m).push(token);
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b));
  return out;
}

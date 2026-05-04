/**
 * HubSpot Forms API — widget-to-HubSpot value mappings
 *
 * Pure data module. No I/O, no side effects. Used by hubspot-form-submission.js
 * to transform widget enum values into the values the "Grant Calculator Oct 2025"
 * HubSpot form expects.
 *
 * Source for widget side: widget/getgranted-widget.js:58-177 (INDUSTRIES,
 * REVENUE_RANGES, EMPLOYEE_RANGES, HIRING_OPTIONS, BUDGET_OPTIONS).
 *
 * Source for HubSpot side: scripts/hubspot-schema.json (cached property dump).
 * Diff produced in /tmp/industry-enum-diff.md during Phase 1.5.
 */

// ============================================================================
// REVENUE — widget enum → HubSpot form enum
// Widget collapses $5M+ into one bucket; HubSpot has $5–10M and $10M+.
// We map $5M+ to the lower of the two valid HubSpot buckets ($5M–$10M).
// ============================================================================

export const REVENUE_MAP = {
  'Pre-revenue':    'Pre-revenue',
  'Under $500K':    '$0 to $500K',
  '$500K – $2.5M':  '$500K to $2.5 million',
  '$2.5M – $5M':    '$2.5 million to $5 million',
  '$5M+':           '$5 million to $10 million'
};

// ============================================================================
// EMPLOYEES — widget enum → HubSpot integer (numemployees property)
// "Just me" → 1; range buckets → lower bound.
// ============================================================================

export const EMPLOYEE_COUNT_MAP = {
  'Just me':   1,
  '1 – 4':     2,
  '5 – 19':    5,
  '20 – 49':   20,
  '50 – 99':   50,
  '100 – 499': 100,
  '500+':      500
};

// ============================================================================
// HIRING PLANS — widget enum → HubSpot integer (number_of_full_time_positions_)
// ============================================================================

export const HIRING_PLANS_MAP = {
  'Not hiring right now': 0,
  '1 – 2 people':         2,
  '3 – 5 people':         3,
  '6 – 10 people':        6,
  '10+':                  10
};

// ============================================================================
// BUDGET RANGES — widget enum → HubSpot integer (lower bound)
// Used for both training_budget → estimated_budget_ AND
// expansion_budget → expansion_budget_.
// ============================================================================

export const BUDGET_RANGE_MAP = {
  'None planned':  0,
  'Under $10K':    5000,
  '$10K – $25K':   10000,
  '$25K – $50K':   25000,
  '$50K – $100K':  50000,
  '$100K+':        100000
};

// ============================================================================
// INDUSTRY — widget label → HubSpot industry_contact internal value
//
// 80 of 81 widget values map to a non-OTHER HubSpot value (full diff at
// /tmp/industry-enum-diff.md). The lone "Food Processing" widget value has
// no exact HubSpot equivalent — overridden to MANUFACTURING_FOOD_BEVERAGE
// per Phase 1.5 decision (semantically closest; preserves food-industry
// reporting signal vs. losing it to OTHER).
//
// WELLNESS_COUSELLING_THERAPY is intentionally misspelled in the value (HubSpot
// owns the property; "COUSELLING" instead of "COUNSELLING" — flagged but kept
// as-is per Phase 1.5 decision).
// ============================================================================

export const WIDGET_TO_HUBSPOT_INDUSTRY = {
  // Exact label matches (59 entries)
  'Accounting':                              'ACCOUNTING',
  'Advertising/Marketing':                   'ADVERTISING_MARKETING',
  'Alternative Medicine':                    'ALTERNATIVE_MEDICINE',
  'Arts & Culture':                          'ARTS_CULTURE',
  'Association':                             'ASSOCIATION',
  'Auto Repairs & Auto Parts':               'AUTO_REPAIRS_AUTO_PARTS',
  'Automotive Dealers':                      'AUTOMOTIVE_DEALERS',
  'Auxiliary Services':                      'AUXILIARY_SERVICES',
  'Charity/Non-Profit':                      'CHARITY_NON_PROFIT',
  'Consulting - Business':                   'CONSULTING_BUSINESS',
  'Consumer Services':                       'CONSUMER_SERVICES',
  'Educational Services':                    'EDUCATIONAL_SERVICES',
  'Esthetics & Spas':                        'ESTHETICS_SPAS',
  'Film/Music/Entertainment':                'FILM_MUSIC_ENTERTAINMENT',
  'Financial':                               'FINANCIAL',
  'Healthcare':                              'HEALTHCARE',
  'Healthcare - Dental':                     'HEALTHCARE_DENTAL',
  'Healthcare - Physio':                     'HEALTHCARE_PHYSIO',
  'Hospitality/Lodging/Tourism':             'HOSPITALITY_LODGING_TOURISM',
  'Insurance':                               'INSURANCE',
  'Legal':                                   'LEGAL',
  'Media - Broadcast':                       'MEDIA_BROADCAST',
  'Media - Podcast':                         'MEDIA_PODCAST',
  'Media - Print/Publishing':                'MEDIA_PRINT_PUBLISHING',
  'Public Relations':                        'PUBLIC_RELATIONS',
  'Real Estate':                             'REAL_ESTATE',
  'Recreation':                              'RECREATION',
  'Retail':                                  'RETAIL',
  'Social Enterprise':                       'SOCIAL_ENTERPRISE',
  'Travel':                                  'TRAVEL',
  'Utilities':                               'UTILITIES',
  'Veterinary':                              'VETERINARY',
  'Warehousing':                             'WAREHOUSING',
  'Wellness':                                'WELLNESS',
  'Wellness - Counselling/Therapy':          'WELLNESS_COUSELLING_THERAPY', // sic — HubSpot's value is misspelled "COUSELLING"; do not "fix"
  'Wellness - Registered Practitioner':      'WELLNESS_REGISTERED_PRACTITIONER',
  'Wholesaling':                             'WHOLESALING',
  'Agriculture - Crop':                      'AGRICULTURE_CROP',
  'Agriculture - Dairy':                     'AGRICULTURE_DAIRY',
  'Agriculture - Livestock':                 'AGRICULTURE_LIVESTOCK',
  'Agriculture - Tree Fruit':                'AGRICULTURE_TREE_FRUIT',
  'Agriculture - Vineyard/Wine':             'AGRICULTURE_VINEYARD_WINE',
  'Architecture/Design':                     'ARCHITECTURE_DESIGN',
  'Construction':                            'CONSTRUCTION',
  'Engineering':                             'ENGINEERING',
  'Manufacturing':                           'MANUFACTURING',
  'Healthcare - Manufacturing':              'HEALTHCARE_MANUFACTURING',
  'Environmental - Education':               'ENVIRONMENTAL_EDUCATION',
  'Environmental - Green Technologies':      'ENVIRONMENTAL_GREEN_TECHNOLOGIES',
  'Environmental - Waste Management':        'ENVIRONMENTAL_WASTE_MANAGEMENT',
  'Fishery':                                 'FISHERY',
  'Forestry':                                'FORESTRY',
  'Oil & Gas Extraction':                    'OIL_GAS_EXTRACTION',
  'Aviation & Aerospace':                    'AVIATION_AEROSPACE',
  'E-Commerce':                              'E_COMMERCE',
  'Healthcare - Technology':                 'HEALTHCARE_TECHNOLOGY',
  'Tech - AI':                               'TECH_AI',
  'Technology':                              'TECHNOLOGY',
  'Other':                                   'OTHER',

  // Renamed / semantic map (21 entries — same meaning, different label)
  'Construction Supplier':                   'CONSTRUCTION_SUPPLIER',                      // HS label: "Construction - Supplier"
  'Logistics/Trucking':                      'LOGISTICS_TRUCKING',                         // HS label: "Logistics & Trucking"
  'Apparel/Textiles (Manufacturing)':        'MANUFACTURING_APPAREL_TEXTILES',             // HS label: "Manufacturing - Apparel/Textiles"
  'Consumer Goods (Manufacturing)':          'MANUFACTURING_CONSUMER_GOODS',
  'Electronic (Manufacturing)':              'MANUFACTURING_ELECTRONIC',
  'Food/Beverage (Manufacturing)':           'MANUFACTURING_FOOD_BEVERAGE',
  'Industrial (Manufacturing)':              'MANUFACTURING_INDUSTRIAL',
  'Metal (Manufacturing)':                   'MANUFACTURING_METAL',
  'Paper/Print (Manufacturing)':             'MANUFACTURING_PAPER_PRINT',
  'Plastics (Manufacturing)':                'MANUFACTURING_PLASTICS',
  'Wood Products (Manufacturing)':           'MANUFACTURING_WOOD_PRODUCTS',
  'Mining/Quarrying':                        'MINING_QUARRYING',                           // HS label: "Mining & Quarrying"
  'Restaurants/Cafes':                       'RESTAURANTS_CAFES',                          // HS label: "Restaurants & Cafes"
  'Wellness - Fitness':                      'WELLNESS_FITNESS',                           // HS label: "Wellness - Fitness/Yoga/Pilates"
  'Ship Building & Repair/Maritime Operations': 'SHIP_BUILDING_REPAIR_MARITIME_OPERATIONS', // HS label: "Ship Building/Repair & Maritime Operations"
  'Animation':                               'ANIMATION',                                  // HS label: "Tech - Animation"
  'Biotechnology':                           'BIOTECHNOLOGY',                              // HS label: "Tech - Biotechnology"
  'Computer/Network Security':               'TECH_COMPUTER_NETWORK_SECURITY',             // HS label: "Tech - Computer Network Security"
  'Tech - Hardware':                         'TECH_TECHNOLOGY_HARDWARE',                   // HS label: "Tech - Technology Hardware"
  'Tech - Software/Web Development':         'TECH_SOFTWARE_WEB_DEVELOPMENT',              // HS label: "Tech - Software & Web Development"
  'Video Games':                             'TECH_VIDEO_GAME',                            // HS label: "Tech - Video Game"

  // Override (Phase 1.5 decision): no exact HS match for "Food Processing" —
  // route to closest semantic neighbor instead of falling through to OTHER.
  'Food Processing':                         'MANUFACTURING_FOOD_BEVERAGE'
};

// ============================================================================
// EXPANSION DESTINATION — keyword-based inference
//
// The widget collects an expansion BUDGET (amount enum) but no destination.
// We infer destination from free-text growth_plans + planned_activities.
// Returns one of the four HubSpot enum values for `where_will_you_be_expanding_`.
// ============================================================================

export function inferExpansionDestination(growthPlans, plannedActivities) {
  const text = `${growthPlans || ''} ${plannedActivities || ''}`.toLowerCase();

  if (/international|export|abroad|overseas|us market|usa|united states|europe|asia|global/.test(text)) {
    return 'internationally';
  }
  if (/canada|cross[-\s]?canada|other province|new province/.test(text)) {
    return 'in Canada';
  }
  if (/expand|new location|grow|new market/.test(text)) {
    return 'in the same province';
  }
  return 'no plans to expand';
}

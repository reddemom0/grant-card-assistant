/**
 * GetGranted Search Tool for Oracle
 *
 * Allows Oracle to search Granted Consulting's GetGranted database
 * for grant opportunities matching client criteria.
 *
 * Uses database API endpoint (synced weekly from GetGranted).
 */

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

const SEARCH_ENDPOINT_URL = process.env.RAILWAY_STATIC_URL
  ? `https://${process.env.RAILWAY_STATIC_URL}/search-grants`
  : 'https://grant-card-assistant-production.up.railway.app/search-grants';
const CACHE_TTL = 3600; // Cache results for 1 hour

/**
 * Search GetGranted database
 *
 * @param {Object} input - Search parameters
 * @param {string} input.query - Text search query (searches grant names, criteria, descriptions)
 * @param {string[]} input.purposes - Grant purposes (Hiring, Training, Market Expansion, etc.)
 * @param {string[]} input.regions - Canadian provinces/territories
 * @param {string[]} input.industries - Industry sectors
 * @param {string} input.business_type - Business structure (Incorporated, Non-Profit, etc.)
 * @param {string[]} input.owner_demographics - Female, Indigenous, Newcomers, etc.
 * @param {number} input.company_size_min - Minimum company size (employees)
 * @param {number} input.company_size_max - Maximum company size
 * @param {boolean} input.active_only - Only show active grants (default true)
 * @param {boolean} input.open_intakes_only - Only show grants with open intakes
 * @param {number} input.limit - Max results to return (default 10, max 50)
 * @param {boolean} input.fetch_full_details - Fetch full grant card details (slower)
 * @returns {Promise<Object>} Search results
 */
export async function searchGetGranted(input) {
  try {
    const {
      query = '',              // Text search query
      purposes = [],
      regions = [],
      industries = [],
      business_type = null,
      owner_demographics = [],
      company_size_min = null,
      company_size_max = null,
      active_only = true,
      open_intakes_only = false,
      limit = 10,
      fetch_full_details = false
    } = input;

    console.log(`🔍 Searching GetGranted database:`, {
      query,
      purposes,
      regions,
      industries,
      business_type,
      company_size_min,
      company_size_max,
      active_only,
      limit
    });

    // Check cache first (unless bypassed)
    const bypassCache = input.bypass_cache || false;
    const cacheKey = `getgranted:search:${JSON.stringify(input)}`;

    if (!bypassCache) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`   ✅ Cache hit - returning cached results`);
        return JSON.parse(cached);
      }
    } else {
      console.log(`   🔄 Cache bypassed - forcing fresh search`);
    }

    // Build query parameters for search endpoint
    const params = new URLSearchParams();

    // Map purposes to grant types
    if (purposes.length > 0) {
      params.append('grantTypes', purposes.join(','));
    }

    // Add regions
    if (regions.length > 0) {
      params.append('regions', regions.join(','));
    }

    // Add industries
    if (industries.length > 0) {
      params.append('industries', industries.join(','));
    }

    // Include inactive grants if active_only is false
    if (!active_only) {
      params.append('includeInactive', 'true');
    }

    // Set max results
    params.append('maxResults', limit.toString());

    // Build keywords from query and additional filters
    const keywords = [];

    // Add main search query (split into individual words for better matching)
    if (query && query.trim()) {
      // Keep the full query as one keyword for phrase matching
      keywords.push(query.trim());
    }

    // Add additional keyword filters
    if (business_type) {
      keywords.push(business_type);
    }
    if (owner_demographics.length > 0) {
      keywords.push(...owner_demographics);
    }

    if (keywords.length > 0) {
      params.append('keywords', keywords.join(','));
    }

    // Call database search endpoint
    console.log(`   🌐 Fetching from database: ${SEARCH_ENDPOINT_URL}?${params.toString()}`);
    const response = await fetch(`${SEARCH_ENDPOINT_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Database search failed: ${response.status} ${response.statusText}`);
    }

    const searchResults = await response.json();
    console.log(`   ✅ Found ${searchResults.total} grants in database`);

    // Format results to match expected output structure
    const grants = searchResults.grants.map(grant => ({
      grant_id: grant.grant_id,
      grant_name: grant.grant_name,
      grant_type: grant.grant_type,
      grant_amount: grant.grant_amount,
      url: grant.url,
      regions: grant.regions,
      industries: grant.industries,
      program_provider: grant.program_provider,
      deadline: grant.deadline,
      max_spend: grant.max_spend,
      contribution_percentage: grant.contribution_percentage,
      difficulty: grant.difficulty,
      grant_criteria: fetch_full_details ? grant.grant_criteria : undefined,
      best_practices: fetch_full_details ? grant.best_practices : undefined,
      full_page_text: fetch_full_details ? grant.full_page_text : undefined,
      last_updated: grant.last_updated,
      is_active: grant.is_active
    }));

    // Build result
    const result = {
      success: true,
      count: grants.length,
      filters_applied: {
        purposes: purposes.length > 0 ? purposes : 'all',
        regions: regions.length > 0 ? regions : 'all',
        industries: industries.length > 0 ? industries : 'all',
        active_only,
        open_intakes_only
      },
      grants,
      data_source: 'database',
      last_synced: 'Weekly on Sundays at 2 AM UTC'
    };

    // Cache results
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

    return result;

  } catch (error) {
    console.error('❌ GetGranted search error:', error);
    return {
      success: false,
      error: error.message,
      grants: []
    };
  }
}


/**
 * Tool definition for Claude agent
 */
export const getGrantedSearchTool = {
  name: 'search_getgranted',
  description: `Search Granted Consulting's GetGranted database for grant opportunities matching client criteria.

Use this to:
- Search grants by name or keywords (e.g., "BuyBC", "hiring grant", "export funding")
- Find grants for specific clients based on their industry, location, and needs
- Discover hiring, training, export, R&D, or capital grants
- Filter by region, company size, owner demographics
- Get quick summaries or full grant card details

This tool searches the internal GetGranted database (598 Canadian grants, synced weekly) and returns matching opportunities with eligibility, funding details, and deadlines.

**Search Strategy:**
1. Start with 'query' parameter for text-based search (searches grant names, criteria, descriptions)
2. Add filters (purposes, regions, industries) to narrow results
3. Use 'fetch_full_details' to get complete grant card information

**Common use cases:**
- "Find the BuyBC grant" → query: "BuyBC"
- "Find hiring grants for a BC tech company" → query: "hiring", regions: ["British Columbia"], industries: ["Technology"]
- "Show market expansion grants for Indigenous-owned businesses" → purposes: ["Market Expansion"], owner_demographics: ["Indigenous"]
- "Search for R&D grants in Ontario with open intakes" → query: "R&D", regions: ["Ontario"], open_intakes_only: true`,

  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text search query to match against grant names, descriptions, criteria, and other text fields. Use this for searching specific grant names or keywords (e.g., "BuyBC", "export", "training"). Leave empty to browse all grants with filters only.'
      },
      purposes: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'Hiring',
            'Training',
            'Market Expansion',
            'Capital Costs',
            'Business Assessments, Planning & Coaching',
            'Systems & Processes',
            'Loan',
            'Contests & Prizes',
            'Investment',
            'Research & Development',
            'Rebates'
          ]
        },
        description: 'Grant purposes/types to search for. Leave empty for all types.'
      },
      regions: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'British Columbia',
            'Ontario',
            'Alberta',
            'Manitoba',
            'New Brunswick',
            'Newfoundland and Labrador',
            'Northwest Territories',
            'Nova Scotia',
            'Nunavut',
            'Prince Edward Island',
            'Quebec',
            'Saskatchewan',
            'Yukon'
          ]
        },
        description: 'Canadian provinces/territories. Leave empty for all regions.'
      },
      industries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Industry sectors (e.g., "Technology", "Manufacturing", "Agriculture"). Leave empty for all industries.'
      },
      business_type: {
        type: 'string',
        enum: ['Incorporated', 'Sole Proprietorship', 'General Partnership', 'Non-Profit', 'Charity'],
        description: 'Business structure type. Leave empty for any business type.'
      },
      owner_demographics: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['Female', 'Indigenous', 'Newcomers', 'People with disabilities', 'Rural Entrepreneur', 'Youth']
        },
        description: 'Owner demographics for targeted grants. Leave empty if not applicable.'
      },
      company_size_min: {
        type: 'number',
        description: 'Minimum company size (number of employees). Leave empty for no minimum.'
      },
      company_size_max: {
        type: 'number',
        description: 'Maximum company size (number of employees). Leave empty for no maximum.'
      },
      active_only: {
        type: 'boolean',
        description: 'Only show active grants (default true).',
        default: true
      },
      open_intakes_only: {
        type: 'boolean',
        description: 'Only show grants with open intake periods (default false).',
        default: false
      },
      limit: {
        type: 'number',
        description: 'Maximum number of grants to return (default 10, max 50).',
        minimum: 1,
        maximum: 50,
        default: 10
      },
      fetch_full_details: {
        type: 'boolean',
        description: 'Fetch full grant card details including eligibility criteria and best practices (slower, default false).',
        default: false
      }
    },
    required: []
  },

  handler: searchGetGranted
};

export default getGrantedSearchTool;

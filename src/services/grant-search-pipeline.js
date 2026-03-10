/**
 * Grant Search Pipeline
 *
 * Wraps the existing search_getgranted tool with categorization-driven targeting.
 * Runs focused searches based on categorization output, then merges with baseline estimates.
 */

import { categorizeProspect } from './grant-categorization.js';

// Map search categories to expected smart_tags intents and genres
const CATEGORY_TAG_MAP = {
  'Hiring Programs': {
    intents: ['Talent'],
    genres: ['Wage Subsidy', 'Student/Co-op Hire', 'Youth Hire', 'Apprenticeship', 'Internship', 'General Hiring']
  },
  'Training Programs': {
    intents: ['Talent', 'Operations'],
    genres: ['Skills Training', 'Technical Training', 'Leadership Development', 'Health & Safety Certification', 'Digital Literacy']
  },
  'Market Expansion Programs': {
    intents: ['Markets', 'Markets_Domestic', 'Growth'],
    genres: ['Export', 'Trade Show', 'Market Research', 'International Marketing', 'Foreign Certification', 'Commercialization', 'Scale-up']
  },
  'R&D Programs': {
    intents: ['Innovation'],
    genres: ['R&D', 'Prototype Development', 'Product Testing', 'IP Protection', 'Pilot Projects', 'Feasibility Studies']
  },
  'General Industry Programs': {
    intents: [],  // no intent boost for general
    genres: []
  }
};

/**
 * Intent hierarchy for program prioritization
 * Higher values = rarer, higher ceiling, more valuable programs
 */
const INTENT_HIERARCHY = {
  'Innovation': 6,      // Rare, highest ceiling ($50K-$500K+), hardest to find
  'Markets': 5,         // Uncommon, high value (CanExport $50K)
  'Markets_Domestic': 5,
  'Technology': 4,      // Moderate availability, good value
  'Sustainability': 4,
  'Talent': 0,          // Default — will be overridden below for training-specific
  'Foundational': 2,
  'Operations': 2,
  'Growth': 2,
  'Startups': 1,
  'Capital': 1
};

/**
 * Tokenize activity text into keywords
 * Remove stopwords, lowercase, deduplicate
 */
function tokenizeActivityText(text) {
  if (!text || typeof text !== 'string') return [];

  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'can', 'could', 'may', 'might', 'must', 'shall',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'our',
    'this', 'that', 'these', 'those'
  ]);

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2) // Min 3 chars
    .filter(word => !stopwords.has(word));

  return [...new Set(tokens)]; // Deduplicate
}

/**
 * Detect program family from grant name
 */
function detectProgramFamily(grantName) {
  if (!grantName) return null;

  const name = grantName.toLowerCase();

  if (name.includes('swpp') || name.includes('student work placement')) {
    return 'SWPP';
  }

  if (name.includes('canexport')) {
    return 'CanExport';
  }

  if (name.includes('irap') || name.includes('industrial research assistance')) {
    return 'IRAP';
  }

  if (name.includes('mitacs')) {
    return 'Mitacs';
  }

  if (name.includes('alberta jobs now')) {
    return 'Alberta Jobs Now';
  }

  return null;
}

/**
 * Apply diversity cap to prevent program family flooding
 */
function applyDiversityCap(scoredPrograms, maxPerFamily = 3, topN = 10) {
  const familyCounts = {};
  const diverseTop10 = [];
  const overflow = [];

  for (const program of scoredPrograms) {
    const family = detectProgramFamily(program.grant_name || program.name);

    // If no family, always include (until we hit topN)
    if (!family) {
      if (diverseTop10.length < topN) {
        diverseTop10.push(program);
      } else {
        overflow.push(program);
      }
      continue;
    }

    // Track family count
    familyCounts[family] = familyCounts[family] || 0;

    // Include if under cap and still have room in top 10
    if (familyCounts[family] < maxPerFamily && diverseTop10.length < topN) {
      diverseTop10.push(program);
      familyCounts[family]++;
    } else {
      overflow.push(program);
      if (familyCounts[family] >= maxPerFamily) {
        console.log(`      🚫 Diversity cap: "${program.grant_name}" pushed to #${diverseTop10.length + overflow.length} (${family} family limit reached)`);
      }
    }
  }

  return diverseTop10.concat(overflow);
}

/**
 * Run focused search based on categorization
 *
 * @param {Object} categorization - Output from categorizeProspect()
 * @param {Function} searchFunction - Callback that calls search_getgranted tool
 * @param {string} conversationId - For logging context
 * @param {Object} prospectData - Prospect profile data for eligibility scoring
 * @returns {Object} Structured search results with programs organized by category
 */
export async function runFocusedSearch(categorization, searchFunction, conversationId, prospectData = null) {
  console.log('\n🔍 RUNNING FOCUSED SEARCH');
  console.log(`  Conversation: ${conversationId}`);
  console.log(`  Categories to search: ${categorization.grant_categories_to_search.join(', ')}`);

  const searchParams = categorization.search_parameters;
  const allPrograms = [];
  const searchCalls = [];

  try {
    // Construct SHORT, targeted search calls (2-5 word queries work best)
    const categories = categorization.grant_categories_to_search;
    const provinceFullName = searchParams.province_full_name || searchParams.province;
    const industryKeyword = searchParams.industry_keyword || categorization.industry_group_label.split(' ')[0];

    // Search 1: Hiring programs (if applicable)
    const hasHiring = categories.some(cat => cat.includes('hiring') || cat.includes('student') || cat.includes('youth'));

    if (hasHiring) {
      searchCalls.push({
        name: 'Hiring Programs',
        categories: categories.filter(cat => cat.includes('hiring') || cat.includes('student') || cat.includes('youth')),
        query: `hiring ${industryKeyword}`,
        province: provinceFullName,
        purposes: ['Hiring']
      });
    }

    // Search 2: Training programs (if applicable)
    const hasTraining = categories.some(cat => cat.includes('training'));

    if (hasTraining) {
      searchCalls.push({
        name: 'Training Programs',
        categories: categories.filter(cat => cat.includes('training')),
        query: `training ${industryKeyword}`,
        province: provinceFullName,
        purposes: ['Training']
      });
    }

    // Search 3: Market Expansion programs (if applicable)
    const hasExpansion = categories.some(cat => cat.includes('export') || cat.includes('international') || cat.includes('market'));

    if (hasExpansion) {
      searchCalls.push({
        name: 'Market Expansion Programs',
        categories: categories.filter(cat => cat.includes('export') || cat.includes('international') || cat.includes('market')),
        query: `export ${industryKeyword}`,
        province: provinceFullName,
        purposes: ['Market Expansion']
      });
    }

    // Search 4: R&D programs (if applicable)
    const hasRD = categories.some(cat => cat.includes('rd') || cat.includes('research') || cat.includes('irap') || cat.includes('sred'));

    if (hasRD) {
      searchCalls.push({
        name: 'R&D Programs',
        categories: categories.filter(cat => cat.includes('rd') || cat.includes('research') || cat.includes('irap') || cat.includes('sred')),
        query: `innovation ${industryKeyword}`,
        province: provinceFullName,
        purposes: ['Research & Development']
      });
    }

    // Search 5: Broad industry sweep (catch-all for other programs)
    // Only run if we have fewer than 3 specific searches, or always as a safety net
    if (searchCalls.length < 3) {
      searchCalls.push({
        name: 'General Industry Programs',
        categories: categories,
        query: industryKeyword,
        province: provinceFullName,
        purposes: [] // Empty = all purposes
      });
    }

    // Execute all search calls
    console.log(`  Executing ${searchCalls.length} targeted searches...`);

    for (const searchCall of searchCalls) {
      console.log(`    → ${searchCall.name}: "${searchCall.query}"`);

      try {
        const results = await searchFunction({
          query: searchCall.query,
          province: searchCall.province,
          purposes: searchCall.purposes,
          limit: 15
        });

        // Diagnostic logging to debug response shape
        console.log(`      📦 Response type: ${typeof results}, keys: ${results ? Object.keys(results).join(', ') : 'null'}`);

        if (results && results.grants && results.grants.length > 0) {
          console.log(`      ✅ Found ${results.grants.length} grants`);

          // Tag each program with the purposes from this search query
          // This ensures proper categorization even if database grant_type field is empty
          const taggedGrants = results.grants.map(grant => ({
            ...grant,
            purposes: searchCall.purposes.length > 0 ? searchCall.purposes : (grant.purposes || []),
            search_origin: searchCall.name  // Track which search returned this program
          }));

          allPrograms.push(...taggedGrants);
        } else if (results && results.programs && results.programs.length > 0) {
          // Fallback: check if response uses 'programs' key instead
          console.log(`      ✅ Found ${results.programs.length} programs (via programs key)`);

          // Tag each program with the purposes from this search query
          const taggedPrograms = results.programs.map(program => ({
            ...program,
            purposes: searchCall.purposes.length > 0 ? searchCall.purposes : (program.purposes || []),
            search_origin: searchCall.name
          }));

          allPrograms.push(...taggedPrograms);
        } else {
          console.log(`      ⚠️  No grants found in response`);
          if (results && results.count !== undefined) {
            console.log(`      📦 Response claims count=${results.count} but grants array is ${results.grants ? 'empty' : 'missing'}`);
          }
        }
      } catch (error) {
        console.error(`      ❌ Search failed: ${error.message}`);
      }
    }

    // Deduplicate programs by ID, merging purposes for programs returned by multiple searches
    const programsById = new Map();

    for (const program of allPrograms) {
      const programId = program.grant_id || program.id;

      if (programsById.has(programId)) {
        // Program already seen - merge purposes
        const existing = programsById.get(programId);
        const existingPurposes = new Set(existing.purposes || []);
        const newPurposes = program.purposes || [];

        // Add new purposes to the set
        newPurposes.forEach(p => existingPurposes.add(p));

        // Update the existing program with merged purposes
        existing.purposes = Array.from(existingPurposes);
        existing.search_origin = `${existing.search_origin}, ${program.search_origin}`;
      } else {
        // First time seeing this program
        programsById.set(programId, program);
      }
    }

    const uniquePrograms = Array.from(programsById.values());

    console.log(`  📊 Total unique programs: ${uniquePrograms.length}`);

    // Filter by grant amount (exclude grants > max_grant_amount threshold)
    const maxGrantAmount = searchParams.exclude_grant_amounts_above;
    const filteredPrograms = uniquePrograms.filter(program => {
      const grantAmount = program.max_grant_amount || program.grant_amount || 0;
      const programName = program.grant_name || program.name || 'Unknown';
      if (grantAmount > maxGrantAmount) {
        console.log(`  🚫 Filtered out "${programName}" (${grantAmount} > ${maxGrantAmount})`);
        return false;
      }
      return true;
    });

    console.log(`  ✅ After amount filtering: ${filteredPrograms.length} programs`);

    // DEBUG: Check if smart_tags exist in first program
    console.log(`🔍 DEBUG: First program smart_tags:`, filteredPrograms[0]?.smart_tags ? 'EXISTS' : 'NULL');
    console.log(`🔍 DEBUG: First program grant_name:`, filteredPrograms[0]?.grant_name);
    console.log(`🔍 DEBUG: First program search_origin:`, filteredPrograms[0]?.search_origin);

    // Score programs by relevance
    const scoredPrograms = filteredPrograms.map(program => {
      let score = 0;

      // ── EXISTING SCORING ──────────────────────────────────────────────────────

      // +3 if program category matches one of our target categories
      const programCategories = program.categories || [];
      const hasMatchingCategory = categorization.grant_categories_to_search.some(cat =>
        programCategories.some(pcat =>
          pcat.toLowerCase().includes(cat.toLowerCase()) ||
          cat.toLowerCase().includes(pcat.toLowerCase())
        )
      );
      if (hasMatchingCategory) score += 3;

      // +2 if currently accepting applications
      if (program.status === 'open' || program.accepting_applications) {
        score += 2;
      }

      // +1 if company size is a fit
      const companySize = searchParams.company_size || 0;
      if (program.min_employees && program.max_employees) {
        if (companySize >= program.min_employees && companySize <= program.max_employees) {
          score += 1;
        }
      } else {
        // No size restriction, assume it's a fit
        score += 1;
      }

      // ── SMART TAGS SCORING ────────────────────────────────────────────────────

      const tags = program.smart_tags;
      const searchOrigin = program.search_origin || 'General Industry Programs';
      const expectedTags = CATEGORY_TAG_MAP[searchOrigin] || CATEGORY_TAG_MAP['General Industry Programs'];
      let tagBoost = 0;

      if (tags) {
        // +5 for primary intent match
        if (expectedTags.intents.length > 0 && tags.primary_intents) {
          const intentMatch = tags.primary_intents.some(i => expectedTags.intents.includes(i));
          if (intentMatch) {
            tagBoost += 5;
          }
        }

        // +2 per genre match, up to +6
        if (expectedTags.genres.length > 0 && tags.genres) {
          const genreMatches = tags.genres.filter(g => expectedTags.genres.includes(g)).length;
          const genreBoost = Math.min(genreMatches * 2, 6);
          tagBoost += genreBoost;
        }

        // +2-4 for max_funding_numeric (logarithmic boost — $50K scores higher than $5K)
        if (tags.max_funding_numeric && tags.max_funding_numeric > 0) {
          const fundingBoost = Math.min(Math.floor(Math.log10(tags.max_funding_numeric)), 4);
          tagBoost += fundingBoost;
        }

        if (tagBoost > 0) {
          score += tagBoost;
          const intentMatch = tags.primary_intents && expectedTags.intents.some(i => tags.primary_intents.includes(i));
          const genreMatches = tags.genres ? tags.genres.filter(g => expectedTags.genres.includes(g)).length : 0;
          console.log(`      Smart tag boost: +${tagBoost} for "${program.grant_name}" (intents: ${intentMatch}, genres: ${genreMatches})`);
        }
      }

      // ── INTENT HIERARCHY BONUS ────────────────────────────────────────────────

      if (tags && tags.primary_intents && Array.isArray(tags.primary_intents)) {
        let intentBonus = 0;
        let topIntent = null;

        for (const intent of tags.primary_intents) {
          let bonus = INTENT_HIERARCHY[intent] || 0;

          // Special case for Talent intent: check genres
          if (intent === 'Talent' && tags.genres && Array.isArray(tags.genres)) {
            const trainingGenres = ['Skills Training', 'Technical Training', 'Leadership Development', 'Health & Safety Certification', 'Digital Literacy'];
            const hasTrainingGenre = tags.genres.some(g => trainingGenres.includes(g));

            if (hasTrainingGenre) {
              bonus = 3; // Training programs get +3
            } else {
              bonus = 0; // Pure hiring programs get +0
            }
          }

          if (bonus > intentBonus) {
            intentBonus = bonus;
            topIntent = intent;
          }
        }

        if (intentBonus > 0) {
          score += intentBonus;
          console.log(`      🏆 Intent hierarchy: +${intentBonus} for "${program.grant_name}" (intent: ${topIntent})`);
        }
      }

      // ── ACTIVITY TEXT KEYWORD BOOST ───────────────────────────────────────────

      if (prospectData && prospectData.planned_activities) {
        const activityKeywords = tokenizeActivityText(prospectData.planned_activities);

        if (activityKeywords.length > 0) {
          const programName = (program.grant_name || program.name || '').toLowerCase();
          const programCriteria = (program.grant_criteria || '').toLowerCase();
          const combinedText = `${programName} ${programCriteria}`;

          const matchedKeywords = activityKeywords.filter(keyword =>
            combinedText.includes(keyword)
          );

          if (matchedKeywords.length > 0) {
            const activityBoost = Math.min(matchedKeywords.length * 2, 6);
            score += activityBoost;
            console.log(`      💬 Activity boost: +${activityBoost} for "${program.grant_name}" (matched: ${matchedKeywords.join(', ')})`);
          }
        }
      }

      // ── ELIGIBILITY PENALTY SCORING ───────────────────────────────────────────

      const eligibility = tags?.eligibility;
      let eligibilityPenalty = 0;

      if (eligibility && prospectData) {
        // Extract prospect profile from prospectData
        const revenue_tier = prospectData.revenue_tier || 'unknown';
        const num_ftes = prospectData.num_ftes || 0;
        const is_incorporated = prospectData.is_incorporated_1yr === true || prospectData.is_incorporated_1yr === 'true';
        const annual_training_spend = prospectData.annual_training_spend || 0;
        const international_market_spend = prospectData.international_market_spend || 0;

        // Penalty 1: Pre-revenue company + program requires revenue
        if (revenue_tier === 'pre_revenue' && eligibility.requires_revenue === true) {
          eligibilityPenalty += 10;
          console.log(`      ❌ Eligibility penalty: -10 for "${program.grant_name}" (pre-revenue + requires_revenue)`);
        }

        // Penalty 2: Not incorporated + program requires incorporation
        if (!is_incorporated && eligibility.requires_incorporation === true) {
          eligibilityPenalty += 10;
          console.log(`      ❌ Eligibility penalty: -10 for "${program.grant_name}" (not incorporated + requires_incorporation)`);
        }

        // Penalty 3: Zero employees + program requires employer status
        if (num_ftes === 0 && eligibility.requires_employer_status === true) {
          eligibilityPenalty += 8;
          console.log(`      ❌ Eligibility penalty: -8 for "${program.grant_name}" (0 employees + requires_employer_status)`);
        }

        // Penalty 4: Below minimum employees
        if (eligibility.min_employees && num_ftes < eligibility.min_employees) {
          eligibilityPenalty += 5;
          console.log(`      ❌ Eligibility penalty: -5 for "${program.grant_name}" (${num_ftes} < min ${eligibility.min_employees} employees)`);
        }

        // Penalty 5: Training program + zero training budget
        const isTrainingProgram = tags.genres && tags.genres.some(g =>
          ['Skills Training', 'Technical Training', 'Leadership Development', 'Health & Safety Certification', 'Digital Literacy'].includes(g)
        );
        if (isTrainingProgram && annual_training_spend === 0) {
          eligibilityPenalty += 3;
          console.log(`      ❌ Eligibility penalty: -3 for "${program.grant_name}" (training program + $0 training budget)`);
        }

        // Penalty 6: Export/market expansion program + zero international spend
        const isExportProgram = tags.genres && tags.genres.some(g =>
          ['Export', 'Trade Show', 'Market Research', 'International Marketing', 'Foreign Certification'].includes(g)
        );
        if (isExportProgram && international_market_spend === 0) {
          eligibilityPenalty += 3;
          console.log(`      ❌ Eligibility penalty: -3 for "${program.grant_name}" (export program + $0 international spend)`);
        }

        // Apply penalty to score
        if (eligibilityPenalty > 0) {
          score -= eligibilityPenalty;
        }
      }

      return { ...program, relevance_score: score };
    });

    // Sort by relevance score (highest first)
    scoredPrograms.sort((a, b) => b.relevance_score - a.relevance_score);

    // Apply diversity cap to prevent program family flooding
    console.log('\n  🎯 Applying diversity cap (max 3 per family in top 10)...');
    const diversifiedPrograms = applyDiversityCap(scoredPrograms, 3, 10);

    // Organize programs by category
    const byCategory = {
      hiring: [],
      training: [],
      market_expansion: [],
      rd: [],
      other: []
    };

    for (const program of diversifiedPrograms) {
      const purposes = program.purposes || [];
      const categories = program.categories || [];

      let categorized = false;

      // Hiring
      if (purposes.includes('Hiring') || categories.some(c => c.toLowerCase().includes('hiring') || c.toLowerCase().includes('wage'))) {
        byCategory.hiring.push(program);
        categorized = true;
      }

      // Training
      if (purposes.includes('Training') || categories.some(c => c.toLowerCase().includes('training') || c.toLowerCase().includes('skill'))) {
        byCategory.training.push(program);
        categorized = true;
      }

      // Market Expansion
      if (purposes.includes('Market Expansion') || categories.some(c => c.toLowerCase().includes('export') || c.toLowerCase().includes('market') || c.toLowerCase().includes('international'))) {
        byCategory.market_expansion.push(program);
        categorized = true;
      }

      // R&D
      if (purposes.includes('Research & Development') || categories.some(c => c.toLowerCase().includes('research') || c.toLowerCase().includes('development') || c.toLowerCase().includes('innovation'))) {
        byCategory.rd.push(program);
        categorized = true;
      }

      // Other
      if (!categorized) {
        byCategory.other.push(program);
      }
    }

    // Keep top 10 overall (now diversified)
    const top10Programs = diversifiedPrograms.slice(0, 10);

    // Calculate totals by category (from top 10)
    const totals = {
      hiring: byCategory.hiring.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      training: byCategory.training.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      market_expansion: byCategory.market_expansion.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      rd: byCategory.rd.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0)
    };

    console.log('✅ FOCUSED SEARCH COMPLETE');
    console.log(`  Top programs: ${top10Programs.map(p => p.grant_name || p.name).join(', ')}`);
    console.log(`  By category: Hiring (${byCategory.hiring.length}), Training (${byCategory.training.length}), Market Expansion (${byCategory.market_expansion.length}), R&D (${byCategory.rd.length}), Other (${byCategory.other.length})`);

    // Diagnostic: show a few examples of categorization
    if (byCategory.hiring.length > 0) {
      const example = byCategory.hiring[0];
      console.log(`    Example Hiring program: "${example.grant_name || example.name}" (purposes: [${(example.purposes || []).join(', ')}])`);
    }
    if (byCategory.training.length > 0) {
      const example = byCategory.training[0];
      console.log(`    Example Training program: "${example.grant_name || example.name}" (purposes: [${(example.purposes || []).join(', ')}])`);
    }

    return {
      programs_found: top10Programs,
      by_category: {
        hiring: byCategory.hiring.filter(p => top10Programs.includes(p)),
        training: byCategory.training.filter(p => top10Programs.includes(p)),
        market_expansion: byCategory.market_expansion.filter(p => top10Programs.includes(p)),
        rd: byCategory.rd.filter(p => top10Programs.includes(p)),
        other: byCategory.other.filter(p => top10Programs.includes(p))
      },
      totals: totals,
      all_program_names: top10Programs.map(p => p.grant_name || p.name)
    };

  } catch (error) {
    console.error('❌ FOCUSED SEARCH FAILED:', error.message);
    throw error;
  }
}

/**
 * Merge baseline estimate with search results
 *
 * @param {Object} categorization - Output from categorizeProspect()
 * @param {Object} searchResults - Output from runFocusedSearch()
 * @returns {Object} Merged estimate with confidence, tier, talking points, programs
 */
export function mergeEstimate(categorization, searchResults) {
  console.log('\n🔀 MERGING BASELINE + SEARCH RESULTS');

  const baseline = categorization.baseline_estimate;
  const searchTotals = searchResults.totals;

  // Compare baseline vs search for each category
  const merged = {
    hiring: { low: 0, high: 0 },
    training: { low: 0, high: 0 },
    market_expansion: { low: 0, high: 0 },
    rd: { low: 0, high: 0 },
    total_low: 0,
    total_high: 0
  };

  const talkingPoints = [];
  let confidenceLevel = 'high'; // Start optimistic

  // Hiring
  if (baseline.hiring.high > 0 || searchTotals.hiring > 0) {
    if (baseline.hiring.high > 0 && searchTotals.hiring > 0) {
      // Both exist - use baseline range and refine upward if search found more
      merged.hiring.low = baseline.hiring.low;
      merged.hiring.high = Math.max(baseline.hiring.high, searchTotals.hiring);

      const programs = searchResults.by_category.hiring.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Hiring: ${Math.round(merged.hiring.low / 1000)}K–${Math.round(merged.hiring.high / 1000)}K across programs like ${programs}`);
    } else if (baseline.hiring.high > 0) {
      // Only baseline - use it but lower confidence
      merged.hiring.low = baseline.hiring.low * 0.7;
      merged.hiring.high = baseline.hiring.high * 0.7;
      confidenceLevel = 'medium';
      talkingPoints.push(`Hiring: ~${Math.round(merged.hiring.high / 1000)}K (based on historical patterns, currently researching active programs)`);
    } else {
      // Only search - use search total as high estimate
      merged.hiring.low = searchTotals.hiring * 0.5;
      merged.hiring.high = searchTotals.hiring;

      const programs = searchResults.by_category.hiring.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Hiring: up to ${Math.round(merged.hiring.high / 1000)}K from programs like ${programs}`);
    }
  }

  // Training
  if (baseline.training.high > 0 || searchTotals.training > 0) {
    if (baseline.training.high > 0 && searchTotals.training > 0) {
      merged.training.low = baseline.training.low;
      merged.training.high = Math.max(baseline.training.high, searchTotals.training);

      const programs = searchResults.by_category.training.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Training: ${Math.round(merged.training.low / 1000)}K–${Math.round(merged.training.high / 1000)}K through programs like ${programs}`);
    } else if (baseline.training.high > 0) {
      merged.training.low = baseline.training.low * 0.7;
      merged.training.high = baseline.training.high * 0.7;
      confidenceLevel = 'medium';
      talkingPoints.push(`Training: ~${Math.round(merged.training.high / 1000)}K (historical estimate, validating current options)`);
    } else {
      merged.training.low = searchTotals.training * 0.5;
      merged.training.high = searchTotals.training;

      const programs = searchResults.by_category.training.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Training: up to ${Math.round(merged.training.high / 1000)}K from ${programs}`);
    }
  }

  // Market Expansion
  if (baseline.market_expansion.high > 0 || searchTotals.market_expansion > 0) {
    if (baseline.market_expansion.high > 0 && searchTotals.market_expansion > 0) {
      merged.market_expansion.low = baseline.market_expansion.low;
      merged.market_expansion.high = Math.max(baseline.market_expansion.high, searchTotals.market_expansion);

      const programs = searchResults.by_category.market_expansion.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Market Expansion: ${Math.round(merged.market_expansion.low / 1000)}K–${Math.round(merged.market_expansion.high / 1000)}K via programs like ${programs}`);
    } else if (baseline.market_expansion.high > 0) {
      merged.market_expansion.low = baseline.market_expansion.low * 0.7;
      merged.market_expansion.high = baseline.market_expansion.high * 0.7;
      confidenceLevel = 'medium';
      talkingPoints.push(`Market Expansion: ~${Math.round(merged.market_expansion.high / 1000)}K (estimate based on typical funding, checking live programs)`);
    } else {
      merged.market_expansion.low = searchTotals.market_expansion * 0.5;
      merged.market_expansion.high = searchTotals.market_expansion;

      const programs = searchResults.by_category.market_expansion.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`Market Expansion: up to ${Math.round(merged.market_expansion.high / 1000)}K from ${programs}`);
    }
  }

  // R&D
  if (baseline.rd.high > 0 || searchTotals.rd > 0) {
    if (baseline.rd.high > 0 && searchTotals.rd > 0) {
      merged.rd.low = baseline.rd.low;
      merged.rd.high = Math.max(baseline.rd.high, searchTotals.rd);

      const programs = searchResults.by_category.rd.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`R&D: ${Math.round(merged.rd.low / 1000)}K–${Math.round(merged.rd.high / 1000)}K through programs like ${programs}`);
    } else if (baseline.rd.high > 0) {
      merged.rd.low = baseline.rd.low * 0.7;
      merged.rd.high = baseline.rd.high * 0.7;
      confidenceLevel = 'medium';
      talkingPoints.push(`R&D: ~${Math.round(merged.rd.high / 1000)}K (historical funding patterns)`);
    } else {
      merged.rd.low = searchTotals.rd * 0.5;
      merged.rd.high = searchTotals.rd;

      const programs = searchResults.by_category.rd.slice(0, 2).map(p => p.name).join(', ');
      talkingPoints.push(`R&D: up to ${Math.round(merged.rd.high / 1000)}K from ${programs}`);
    }
  }

  // Calculate totals
  merged.total_low = merged.hiring.low + merged.training.low + merged.market_expansion.low + merged.rd.low;
  merged.total_high = merged.hiring.high + merged.training.high + merged.market_expansion.high + merged.rd.high;

  // Adjust confidence based on coverage
  if (confidenceLevel === 'medium') {
    // Already medium
  } else if (searchResults.programs_found.length < 3) {
    confidenceLevel = 'low';
  } else if (searchResults.programs_found.length >= 8) {
    confidenceLevel = 'high';
  } else {
    confidenceLevel = 'medium';
  }

  console.log('✅ MERGE COMPLETE');
  console.log(`  Total estimate: ${Math.round(merged.total_low / 1000)}K–${Math.round(merged.total_high / 1000)}K`);
  console.log(`  Confidence: ${confidenceLevel}`);
  console.log(`  Talking points: ${talkingPoints.length}`);

  return {
    estimate: merged,
    confidence_level: confidenceLevel,
    service_tier: categorization.service_tier,
    tier_reasoning: categorization.tier_reasoning,
    consultant_assignment: categorization.consultant_assignment,
    booking_link: categorization.booking_link,
    agent_talking_points: talkingPoints,
    programs_for_hubspot: searchResults.all_program_names,
    matched_programs_detail: searchResults.programs_found
  };
}

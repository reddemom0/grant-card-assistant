/**
 * Grant Search Pipeline
 *
 * Wraps the existing search_getgranted tool with categorization-driven targeting.
 * Runs focused searches based on categorization output, then merges with baseline estimates.
 */

import { categorizeProspect } from './grant-categorization.js';

/**
 * Run focused search based on categorization
 *
 * @param {Object} categorization - Output from categorizeProspect()
 * @param {Function} searchFunction - Callback that calls search_getgranted tool
 * @param {string} conversationId - For logging context
 * @returns {Object} Structured search results with programs organized by category
 */
export async function runFocusedSearch(categorization, searchFunction, conversationId) {
  console.log('\n🔍 RUNNING FOCUSED SEARCH');
  console.log(`  Conversation: ${conversationId}`);
  console.log(`  Categories to search: ${categorization.grant_categories_to_search.join(', ')}`);

  const searchParams = categorization.search_parameters;
  const allPrograms = [];
  const searchCalls = [];

  try {
    // Construct 2-3 targeted search calls based on categories
    const categories = categorization.grant_categories_to_search;

    // Search 1: Hiring + Training (if applicable)
    const hiringTrainingCategories = categories.filter(cat =>
      cat.includes('hiring') || cat.includes('training') || cat.includes('student') || cat.includes('youth')
    );

    if (hiringTrainingCategories.length > 0) {
      const keywords = hiringTrainingCategories.map(cat => {
        if (cat.includes('student')) return 'student co-op intern';
        if (cat.includes('youth') || cat.includes('grad')) return 'youth recent graduate';
        if (cat.includes('training')) return 'training upskilling workforce development';
        if (cat.includes('apprentice')) return 'apprentice skilled trades';
        return 'hiring wage subsidy employment';
      }).join(' ');

      searchCalls.push({
        name: 'Hiring & Training',
        categories: hiringTrainingCategories,
        query: `${keywords} ${categorization.industry_group_label} ${searchParams.province}`,
        province: searchParams.province,
        purposes: ['Hiring', 'Training']
      });
    }

    // Search 2: Market Expansion + R&D (if applicable)
    const expansionRdCategories = categories.filter(cat =>
      cat.includes('export') || cat.includes('international') || cat.includes('market') ||
      cat.includes('rd') || cat.includes('research') || cat.includes('irap') || cat.includes('sred')
    );

    if (expansionRdCategories.length > 0) {
      const keywords = expansionRdCategories.map(cat => {
        if (cat.includes('export') || cat.includes('canexport')) return 'export international market expansion';
        if (cat.includes('irap')) return 'IRAP research development innovation';
        if (cat.includes('sred')) return 'SR&ED SRED tax credit R&D';
        return 'research development innovation';
      }).join(' ');

      searchCalls.push({
        name: 'Market Expansion & R&D',
        categories: expansionRdCategories,
        query: `${keywords} ${categorization.industry_group_label}`,
        province: searchParams.province,
        purposes: ['Market Expansion', 'Research & Development']
      });
    }

    // Search 3: Industry-specific (if not covered by above)
    const industryCategories = categories.filter(cat =>
      cat.includes('agriculture') || cat.includes('manufacturing') || cat.includes('technology') ||
      cat.includes('green') || cat.includes('clean') || cat.includes('biotalent') ||
      cat.includes('trades') || cat.includes('digital')
    );

    if (industryCategories.length > 0) {
      const keywords = industryCategories.map(cat => {
        if (cat.includes('agriculture')) return 'agriculture farming agri';
        if (cat.includes('manufacturing')) return 'manufacturing production';
        if (cat.includes('technology') || cat.includes('digital')) return 'technology digital innovation';
        if (cat.includes('green') || cat.includes('clean')) return 'clean technology renewable environmental';
        if (cat.includes('biotalent')) return 'bio life sciences';
        if (cat.includes('trades')) return 'skilled trades construction apprentice';
        return categorization.industry_group_label;
      }).join(' ');

      searchCalls.push({
        name: 'Industry-Specific',
        categories: industryCategories,
        query: `${keywords} ${searchParams.province}`,
        province: searchParams.province,
        purposes: searchParams.purposes
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
          purposes: searchCall.purposes.join(','),
          limit: 15
        });

        if (results && results.programs && results.programs.length > 0) {
          console.log(`      ✅ Found ${results.programs.length} programs`);
          allPrograms.push(...results.programs);
        } else {
          console.log(`      ⚠️  No programs found`);
        }
      } catch (error) {
        console.error(`      ❌ Search failed: ${error.message}`);
      }
    }

    // Deduplicate programs by ID
    const uniquePrograms = [];
    const seenIds = new Set();

    for (const program of allPrograms) {
      if (!seenIds.has(program.id)) {
        seenIds.add(program.id);
        uniquePrograms.push(program);
      }
    }

    console.log(`  📊 Total unique programs: ${uniquePrograms.length}`);

    // Filter by grant amount (exclude grants > max_grant_amount threshold)
    const maxGrantAmount = searchParams.exclude_grant_amounts_above;
    const filteredPrograms = uniquePrograms.filter(program => {
      const grantAmount = program.max_grant_amount || program.grant_amount || 0;
      if (grantAmount > maxGrantAmount) {
        console.log(`  🚫 Filtered out "${program.name}" (${grantAmount} > ${maxGrantAmount})`);
        return false;
      }
      return true;
    });

    console.log(`  ✅ After amount filtering: ${filteredPrograms.length} programs`);

    // Score programs by relevance
    const scoredPrograms = filteredPrograms.map(program => {
      let score = 0;

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

      return { ...program, relevance_score: score };
    });

    // Sort by relevance score (highest first)
    scoredPrograms.sort((a, b) => b.relevance_score - a.relevance_score);

    // Organize programs by category
    const byCategory = {
      hiring: [],
      training: [],
      market_expansion: [],
      rd: [],
      other: []
    };

    for (const program of scoredPrograms) {
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

    // Keep top 10 overall (by score)
    const top10Programs = scoredPrograms.slice(0, 10);

    // Calculate totals by category (from top 10)
    const totals = {
      hiring: byCategory.hiring.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      training: byCategory.training.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      market_expansion: byCategory.market_expansion.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0),
      rd: byCategory.rd.filter(p => top10Programs.includes(p)).reduce((sum, p) => sum + (p.max_grant_amount || p.grant_amount || 0), 0)
    };

    console.log('✅ FOCUSED SEARCH COMPLETE');
    console.log(`  Top programs: ${top10Programs.map(p => p.name).join(', ')}`);
    console.log(`  By category: Hiring (${byCategory.hiring.length}), Training (${byCategory.training.length}), Market Expansion (${byCategory.market_expansion.length}), R&D (${byCategory.rd.length}), Other (${byCategory.other.length})`);

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
      all_program_names: top10Programs.map(p => p.name)
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
      // Both exist - use baseline range but cap high at search max
      merged.hiring.low = baseline.hiring.low;
      merged.hiring.high = Math.min(baseline.hiring.high, searchTotals.hiring);

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
      merged.training.high = Math.min(baseline.training.high, searchTotals.training);

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
      merged.market_expansion.high = Math.min(baseline.market_expansion.high, searchTotals.market_expansion);

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
      merged.rd.high = Math.min(baseline.rd.high, searchTotals.rd);

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

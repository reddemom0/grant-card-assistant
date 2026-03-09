/**
 * Grant Tagger Service
 * Uses Claude Haiku to generate structured tags for grant programs
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Controlled vocabularies for validation
const ALLOWED_PRIMARY_INTENTS = [
  "Talent", "Technology", "Capital", "Innovation", "Markets",
  "Markets_Domestic", "Sustainability", "Operations", "Growth",
  "Foundational", "Startups"
];

const ALLOWED_GENRES = [
  "Wage Subsidy", "Student/Co-op Hire", "Youth Hire", "Apprenticeship",
  "Internship", "General Hiring", "Skills Training", "Technical Training",
  "Leadership Development", "Health & Safety Certification", "Digital Literacy",
  "Export", "Trade Show", "Market Research", "International Marketing",
  "Foreign Certification", "R&D", "Prototype Development", "Product Testing",
  "IP Protection", "Pilot Projects", "Feasibility Studies", "Equipment Purchase",
  "Machinery Upgrades", "Facility Renovation", "Building Retrofits",
  "Software/ERP/CRM", "AI/ML Integration", "Automation", "Cybersecurity",
  "E-commerce", "Cloud Migration", "Decarbonization", "Clean Tech",
  "Energy Efficiency", "GHG Reduction", "Electric Vehicles",
  "Business Assessment", "Coaching", "Advisory", "Market Analysis",
  "Commercialization", "Scale-up"
];

const ALLOWED_TARGET_POPULATIONS = [
  "Youth", "Students", "Indigenous", "Women", "Newcomers",
  "Persons with Disabilities", "Francophone", "Veterans", "Rural", "Black-owned"
];

/**
 * Fuzzy match a value to the closest allowed value
 */
function fuzzyMatch(value, allowedValues) {
  if (!value) return null;

  const valueLower = value.toLowerCase().trim();

  // Exact match (case-insensitive)
  const exactMatch = allowedValues.find(v => v.toLowerCase() === valueLower);
  if (exactMatch) return exactMatch;

  // Fuzzy matching rules
  const fuzzyRules = {
    // Genres
    'export marketing': 'Export',
    'export': 'Export',
    'trade mission': 'Trade Show',
    'trade mission support': 'Trade Show',
    'trade show': 'Trade Show',
    'market research support': 'Market Research',
    'market research': 'Market Research',
    'international expansion': 'International Marketing',
    'international marketing': 'International Marketing',
    'wage subsidy': 'Wage Subsidy',
    'training subsidy': 'Skills Training',
    'training reimbursement': 'Skills Training',
    'apprenticeship support': 'Apprenticeship',
    'co-op support': 'Student/Co-op Hire',
    'student wage subsidy': 'Student/Co-op Hire',
    'r&d tax credit': 'R&D',
    'r&d grant': 'R&D',
    'innovation funding': 'R&D',
    'equipment purchase': 'Equipment Purchase',
    'technology adoption': 'Software/ERP/CRM',
    'certification support': 'Foreign Certification',
    'process improvement': 'Advisory',
    'capital investment': 'Equipment Purchase',
    'working capital': 'Capital',
    'startup grant': 'Foundational',
    'seed funding': 'Foundational',
    'growth capital': 'Scale-up',
    'facility expansion': 'Facility Renovation',
    'energy efficiency': 'Energy Efficiency',
    'emissions reduction': 'GHG Reduction',
    'sustainable practices': 'Clean Tech',
    'advisory services': 'Advisory',
    'business planning': 'Business Assessment',
    'mentorship': 'Coaching',
    'incorporation support': 'Foundational',

    // Primary intents
    'hiring': 'Talent',
    'training': 'Talent',
    'export': 'Markets',

    // Target populations
    'youth': 'Youth',
    'students': 'Students',
    'indigenous': 'Indigenous',
    'women': 'Women',
    'newcomers': 'Newcomers',
    'persons with disabilities': 'Persons with Disabilities',
    'francophone': 'Francophone',
    'veterans': 'Veterans',
    'rural': 'Rural',
    'black-owned': 'Black-owned'
  };

  const fuzzyResult = fuzzyRules[valueLower];
  if (fuzzyResult && allowedValues.includes(fuzzyResult)) {
    return fuzzyResult;
  }

  // Partial match - find allowed value that contains or is contained by input
  const partialMatch = allowedValues.find(v =>
    v.toLowerCase().includes(valueLower) || valueLower.includes(v.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  return null;
}

/**
 * Generate structured tags for a grant program
 * @param {Object} program - Grant program object from database
 * @returns {Promise<Object|null>} Structured tags object or null on error
 */
async function tagGrant(program) {
  try {
    const prompt = `You are a grant categorization specialist. Analyze this grant program and return ONLY a JSON object with structured tags.

CRITICAL: You MUST select values ONLY from the provided lists below. Do not create new values. Do not rephrase. Copy exact strings from the lists below.

Grant Program:
Name: ${program.grant_name}
Type: ${program.grant_type || 'N/A'}
Amount: ${program.grant_amount || 'N/A'}
Criteria: ${program.grant_criteria || 'N/A'}
Provider: ${program.program_provider || 'N/A'}
Regions: ${program.regions || 'N/A'}
Industries: ${program.industries || 'N/A'}

Return a JSON object with these fields:

{
  "primary_intents": [array of 1-3 strings - ONLY from this exact list: "Talent", "Technology", "Capital", "Innovation", "Markets", "Markets_Domestic", "Sustainability", "Operations", "Growth", "Foundational", "Startups". Note: "Markets" covers export/international expansion. "Markets_Domestic" covers domestic market expansion. Copy the EXACT string as shown.],

  "genres": [array of 1-3 strings - Output the EXACT string as shown. Do not add words, do not rephrase, do not lowercase. For example, output "Export" not "export marketing". Output "Trade Show" not "trade mission support". ONLY from this numbered list:
1. Wage Subsidy
2. Student/Co-op Hire
3. Youth Hire
4. Apprenticeship
5. Internship
6. General Hiring
7. Skills Training
8. Technical Training
9. Leadership Development
10. Health & Safety Certification
11. Digital Literacy
12. Export
13. Trade Show
14. Market Research
15. International Marketing
16. Foreign Certification
17. R&D
18. Prototype Development
19. Product Testing
20. IP Protection
21. Pilot Projects
22. Feasibility Studies
23. Equipment Purchase
24. Machinery Upgrades
25. Facility Renovation
26. Building Retrofits
27. Software/ERP/CRM
28. AI/ML Integration
29. Automation
30. Cybersecurity
31. E-commerce
32. Cloud Migration
33. Decarbonization
34. Clean Tech
35. Energy Efficiency
36. GHG Reduction
37. Electric Vehicles
38. Business Assessment
39. Coaching
40. Advisory
41. Market Analysis
42. Commercialization
43. Scale-up],

  "max_funding_numeric": number (extract the maximum dollar amount available, e.g., 10000 for "$10,000", use 0 if percentage-based or unclear),

  "specificity": string (ONLY one of: "broad", "targeted", "niche"),

  "complexity": string (ONLY one of: "simple", "moderate", "complex"),

  "target_populations": [array of strings - ONLY from this exact list: "Youth", "Students", "Indigenous", "Women", "Newcomers", "Persons with Disabilities", "Francophone", "Veterans", "Rural", "Black-owned". Use empty array [] if the program is open to all businesses without specific priority populations. Note: "SMEs" is NOT a population - it's a business size, do not include it. Copy the EXACT string as shown.],

  "funding_model": string (ONLY one of: "reimbursement", "wage_subsidy", "grant", "tax_credit", "loan", "mixed")
}

Example output:
{
  "primary_intents": ["Talent", "Growth"],
  "genres": ["Wage Subsidy", "Skills Training"],
  "max_funding_numeric": 10000,
  "specificity": "broad",
  "complexity": "moderate",
  "target_populations": ["Youth"],
  "funding_model": "wage_subsidy"
}

Return ONLY the JSON object. No explanation, no markdown code blocks.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text from response
    const responseText = message.content[0].text.trim();

    // Parse JSON (handle potential markdown code blocks)
    let jsonText = responseText;
    if (responseText.startsWith('```')) {
      // Remove markdown code block markers
      jsonText = responseText
        .replace(/^```json?\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    }

    const tags = JSON.parse(jsonText);

    // Validate and correct primary_intents
    if (Array.isArray(tags.primary_intents)) {
      tags.primary_intents = tags.primary_intents.map(intent => {
        const matched = fuzzyMatch(intent, ALLOWED_PRIMARY_INTENTS);
        if (matched !== intent) {
          console.warn(`[${program.grant_name}] Fuzzy matched primary_intent: "${intent}" → "${matched}"`);
        }
        return matched;
      }).filter(Boolean);
    }

    // Validate and correct genres
    if (Array.isArray(tags.genres)) {
      tags.genres = tags.genres.map(genre => {
        const matched = fuzzyMatch(genre, ALLOWED_GENRES);
        if (matched !== genre) {
          console.warn(`[${program.grant_name}] Fuzzy matched genre: "${genre}" → "${matched}"`);
        }
        return matched;
      }).filter(Boolean);
    }

    // Validate and correct target_populations
    if (Array.isArray(tags.target_populations)) {
      tags.target_populations = tags.target_populations.map(pop => {
        const matched = fuzzyMatch(pop, ALLOWED_TARGET_POPULATIONS);
        if (matched !== pop) {
          console.warn(`[${program.grant_name}] Fuzzy matched target_population: "${pop}" → "${matched}"`);
        }
        return matched;
      }).filter(Boolean);
    }

    // Validate required fields
    const requiredFields = [
      'primary_intents',
      'genres',
      'max_funding_numeric',
      'specificity',
      'complexity',
      'target_populations',
      'funding_model',
    ];

    for (const field of requiredFields) {
      if (!(field in tags)) {
        console.error(`Missing required field: ${field}`);
        return null;
      }
    }

    return tags;
  } catch (error) {
    console.error(`Error tagging grant ${program.grant_name}:`, error.message);
    return null;
  }
}

export { tagGrant };

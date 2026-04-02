/**
 * Genre Tagger - Incremental (Daily Cron)
 *
 * Scores grants where genre_scores IS NULL (new grants from daily sync).
 * Runs daily at 3 AM Pacific (after 2 AM database sync from GetGranted).
 * Uses Haiku for cost efficiency, same taxonomy as batch tagger.
 */

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import 'dotenv/config';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const { Pool } = pg;

// All smart filter genre definitions (same as batch tagger)
const SMART_FILTERS = {
  'Building Bench of Talent': {
    intent: 'Talent',
    genres: {
      hiring: {
        name: 'Hiring',
        definition: 'Funding supports hiring a new employee or intern',
        when_to_use: 'Tag when the grant requires creating a new position or placement'
      },
      wage_subsidy: {
        name: 'Wage subsidy',
        definition: "Program reimburses part of the employee's wages",
        when_to_use: 'Tag when funding is based on a percentage or fixed amount of salary'
      },
      student_coop: {
        name: 'Student/Co-op Intern',
        definition: 'Placement must be filled by a student or co-op participant',
        when_to_use: 'Tag when eligibility requires the candidate to be an active student'
      },
      training: {
        name: 'Training',
        definition: 'Funding supports skills development, courses, or workforce training',
        when_to_use: 'Tag when funding covers training costs, certification, or skill development'
      },
      apprenticeship: {
        name: 'Apprenticeship',
        definition: 'Funding supports apprenticeship training in skilled trades',
        when_to_use: 'Tag when the program targets registered apprentices'
      },
      youth_hire: {
        name: 'Youth Hire (<29)',
        definition: 'Position must be filled by a young worker below the age limit',
        when_to_use: 'Tag when eligibility requires the candidate to be under 29 or 30'
      },
      remote_hire: {
        name: 'Remote Hire',
        definition: 'Funded position can be performed remotely',
        when_to_use: 'Tag when the program explicitly allows remote placements'
      },
      barriered_youth: {
        name: 'Barriered youth',
        definition: 'Program targets youth facing employment barriers',
        when_to_use: 'Tag when the program prioritizes disadvantaged groups'
      }
    }
  },
  'Adopt Software or AI': {
    intent: 'Technology',
    genres: {
      hardware: {
        name: 'Hardware',
        definition: 'Funding supports purchase or upgrade of physical technology equipment',
        when_to_use: 'Tag when eligible costs include computers, machines, sensors, devices'
      },
      softwares: {
        name: 'Softwares',
        definition: 'Funding supports purchase, subscription, or implementation of software tools',
        when_to_use: 'Tag when eligible costs include business software, platforms, or digital systems'
      },
      digital_marketing: {
        name: 'Digital Marketing',
        definition: 'Funding supports digital marketing activities',
        when_to_use: 'Tag when eligible costs include online advertising, digital campaigns, or social media'
      },
      technology_training: {
        name: 'Technology training',
        definition: 'Funding supports training related to technology adoption',
        when_to_use: 'Tag when training involves learning to use new software, digital tools, or tech systems'
      },
      assessment: {
        name: 'Assessment',
        definition: 'Funding supports technology or digital readiness assessments',
        when_to_use: 'Tag when the project includes evaluating current tech capabilities or digital maturity'
      },
      ai: {
        name: 'AI',
        definition: 'Funding supports AI adoption or integration',
        when_to_use: 'Tag when the project involves implementing AI tools, machine learning, or intelligent automation'
      },
      technology_tech: {
        name: 'Technology/Tech',
        definition: 'General technology-related funding',
        when_to_use: 'Tag when the grant broadly supports technology adoption without fitting a more specific genre'
      }
    }
  },
  'Buy Equipment or Upgrade Facilities': {
    intent: 'Capital',
    genres: {
      equipment: {
        name: 'Equipment',
        definition: 'Funding supports purchase of new machinery, tools, or operational equipment',
        when_to_use: 'Tag when eligible costs include buying equipment used in production or operations'
      },
      retrofits: {
        name: 'Retrofits',
        definition: 'Funding supports upgrades or modifications to existing equipment or facilities',
        when_to_use: 'Tag when projects improve energy efficiency, performance, or safety of existing assets'
      },
      automation: {
        name: 'Automation',
        definition: 'Funding supports implementing automated systems or machinery',
        when_to_use: 'Tag when projects replace manual processes with automated equipment'
      },
      facility_expansion: {
        name: 'Facility Expansion',
        definition: 'Funding supports building, expanding, or upgrading physical facilities',
        when_to_use: 'Tag when eligible costs include construction, leasehold improvements, or space expansion'
      },
      production_upgrade: {
        name: 'Production upgrade',
        definition: 'Funding supports upgrading production lines or manufacturing processes',
        when_to_use: 'Tag when the goal is to increase output quality or volume through equipment changes'
      }
    }
  },
  'Build Something New': {
    intent: 'Innovation',
    genres: {
      rd: {
        name: 'R&D',
        definition: 'Funding supports research and development',
        when_to_use: 'Tag when the project involves experimentation, technical research, or early-stage development'
      },
      prototype_development: {
        name: 'Prototype development',
        definition: 'Funding supports building an early version of a new product or technology',
        when_to_use: 'Tag when the project involves designing and testing a first working version'
      },
      product_development: {
        name: 'Product development',
        definition: 'Funding supports developing a product from concept to market-ready state',
        when_to_use: 'Tag when the project involves iterating, refining, or completing a product for commercial use'
      },
      pilot_testing: {
        name: 'Pilot Testing',
        definition: 'Funding supports testing a product or technology in a real-world or controlled setting',
        when_to_use: 'Tag when the project includes trials, beta testing, or field validation'
      },
      tech_development: {
        name: 'Tech development',
        definition: 'Funding supports developing new technology or technical systems',
        when_to_use: 'Tag when the project involves building software, platforms, or tech infrastructure'
      },
      intellectual_property: {
        name: 'Intellectual Property',
        definition: 'Funding supports protecting or commercializing IP',
        when_to_use: 'Tag when eligible costs include patents, trademarks, licensing, or IP strategy'
      }
    }
  },
  'International Growth': {
    intent: 'Markets',
    genres: {
      export: {
        name: 'Export',
        definition: 'Funding supports selling products or services to foreign markets',
        when_to_use: 'Tag when programs support export development or international sales'
      },
      international_business_development: {
        name: 'International Business Development',
        definition: 'Funding supports building business relationships, partnerships, or distribution networks abroad',
        when_to_use: 'Tag when projects involve meetings, trade missions, or partnership building overseas'
      },
      international_market_expansion: {
        name: 'International Market Expansion',
        definition: 'Funding supports expanding into new international markets',
        when_to_use: 'Tag when projects grow presence in markets the business has already entered'
      },
      international_new_markets: {
        name: 'International New Markets',
        definition: 'Funding supports entering international markets for the first time',
        when_to_use: 'Tag when projects involve launching in a new country or region'
      },
      international_expansion: {
        name: 'International Expansion',
        definition: 'General international growth support',
        when_to_use: 'Tag when the grant broadly supports international activity without fitting a more specific genre'
      },
      international_tradeshow: {
        name: 'International Trade Show/Exhibition',
        definition: 'Funding supports participation in trade shows or exhibitions abroad',
        when_to_use: 'Tag when eligible costs include booth fees, travel, or materials for international events'
      }
    }
  },
  'Domestic Growth': {
    intent: 'Markets_Domestic',
    genres: {
      domestic_tradeshows: {
        name: 'Domestic Tradeshows/Exhibition',
        definition: 'Funding supports participation in trade shows within Canada',
        when_to_use: 'Tag when grants reimburse costs for attending or exhibiting at domestic events'
      },
      domestic_marketing: {
        name: 'Domestic Marketing',
        definition: 'Funding supports marketing targeting Canadian customers',
        when_to_use: 'Tag when programs fund advertising, branding, or promotional campaigns within Canada'
      },
      domestic_expansion: {
        name: 'Domestic Expansion',
        definition: 'Funding supports expanding operations within Canada',
        when_to_use: 'Tag when projects involve entering new Canadian provinces or regions'
      },
      domestic_sales_growth: {
        name: 'Domestic Sales Growth',
        definition: 'Funding supports growing sales revenue within the Canadian market',
        when_to_use: 'Tag when programs support sales enablement, CRM tools, or domestic sales strategy'
      }
    }
  },
  'Improve Sustainability': {
    intent: 'Sustainability',
    genres: {
      decarbonization: {
        name: 'Decarbonization',
        definition: 'Funding supports projects reducing carbon emissions',
        when_to_use: 'Tag when the project lowers carbon intensity through cleaner processes, fuels, or technologies'
      },
      electrification: {
        name: 'Electrification',
        definition: 'Funding supports replacing fossil-fuel equipment with electric alternatives',
        when_to_use: 'Tag when projects switch equipment from gas/diesel/oil to electric'
      },
      emissions_ghg_reduction: {
        name: 'Emissions/GHG reduction',
        definition: 'Funding supports measuring or reducing greenhouse gas emissions',
        when_to_use: 'Tag when projects involve emissions tracking, reporting, or reduction targets'
      },
      cleantech: {
        name: 'Cleantech',
        definition: 'Funding supports development or adoption of clean technology',
        when_to_use: 'Tag when projects involve clean energy, green tech, or environmentally beneficial innovation'
      },
      waste_to_value: {
        name: 'Waste-to-Value',
        definition: 'Funding supports turning waste materials into usable products or energy',
        when_to_use: 'Tag when projects convert by-products, organic waste, or industrial waste into value'
      },
      upcycling: {
        name: 'Upcycling',
        definition: 'Funding supports reprocessing materials into higher-value products',
        when_to_use: 'Tag when projects transform used or waste materials'
      },
      green_jobs_hire: {
        name: 'Green Jobs Hire',
        definition: 'Funding supports hiring for green or sustainability-focused positions',
        when_to_use: 'Tag when programs subsidize wages for roles in clean economy sectors'
      }
    }
  },
  'Improve Productivity': {
    intent: 'Operations',
    genres: {
      process_improvement: {
        name: 'Process improvement',
        definition: 'Funding supports improving business processes',
        when_to_use: 'Tag when projects streamline workflows, reduce bottlenecks, or improve procedures'
      },
      productivity: {
        name: 'Productivity',
        definition: 'Funding supports increasing output or efficiency',
        when_to_use: "Tag when the program's goal is to help businesses produce more with same or fewer resources"
      },
      optimization: {
        name: 'Optimization',
        definition: 'Funding supports optimizing operations, supply chains, or resource use',
        when_to_use: 'Tag when projects use data, technology, or redesign to improve performance'
      },
      automation_ops: {
        name: 'Automation',
        definition: 'Funding supports automating manual or repetitive processes',
        when_to_use: 'Tag when projects introduce software, robotics, or systems to reduce manual work'
      },
      advanced_manufacturing: {
        name: 'Advanced Manufacturing',
        definition: 'Funding supports modernizing manufacturing',
        when_to_use: 'Tag when projects involve Industry 4.0, smart manufacturing, or digital transformation in production'
      }
    }
  },
  'Commercialize or Scale': {
    intent: 'Growth',
    genres: {
      commercialization: {
        name: 'Commercialization',
        definition: 'Funding supports bringing a new product to market',
        when_to_use: 'Tag when projects focus on launching or selling a new solution'
      },
      scale_up: {
        name: 'Scale-up',
        definition: 'Funding supports expanding production, operations, or market reach',
        when_to_use: 'Tag when projects increase capacity, expand facilities, or grow sales'
      },
      go_to_market: {
        name: 'Go-to-market',
        definition: 'Funding supports marketing, distribution, or launch plans for a new product',
        when_to_use: 'Tag when projects involve go-to-market strategy'
      },
      scale_production: {
        name: 'Scale production',
        definition: 'Funding supports increasing production volume or capacity',
        when_to_use: 'Tag when projects scale manufacturing or operations'
      },
      product_validation: {
        name: 'Product Validation',
        definition: 'Funding supports testing a product with real users or customers',
        when_to_use: 'Tag when projects confirm demand or usability before full launch'
      },
      demonstration_project: {
        name: 'Demonstration Project',
        definition: 'Funding supports showcasing a product or technology in real-world conditions',
        when_to_use: 'Tag when projects demonstrate viability to customers or stakeholders'
      },
      market_ready_solution: {
        name: 'Market-ready Solution',
        definition: 'Funding supports preparing a product for commercial sale',
        when_to_use: 'Tag when projects finalize a product for market readiness'
      }
    }
  },
  'Planning or Readiness Support': {
    intent: 'Foundational',
    genres: {
      feasibility_study: {
        name: 'Feasibility study',
        definition: 'Funding supports studies evaluating whether a project is viable',
        when_to_use: 'Tag when the project assesses practicality, costs, or risks'
      },
      advisory: {
        name: 'Advisory',
        definition: 'Funding supports expert advice or professional guidance',
        when_to_use: 'Tag when grants cover consulting, expert advisors, or strategic guidance'
      },
      readiness_assessment: {
        name: 'Readiness assessment',
        definition: 'Funding supports evaluating business readiness for a new initiative',
        when_to_use: 'Tag when projects assess organizational capability or preparedness'
      },
      audits: {
        name: 'Audits',
        definition: 'Funding supports formal audits or compliance reviews',
        when_to_use: 'Tag when grants cover financial, environmental, or operational audits'
      },
      market_research_analysis: {
        name: 'Market Research/Analysis',
        definition: 'Funding supports gathering market intelligence',
        when_to_use: 'Tag when projects involve surveys, competitive analysis, or demand studies'
      },
      planning: {
        name: 'Planning',
        definition: 'Funding supports business or project planning',
        when_to_use: 'Tag when grants fund strategic plans, implementation roadmaps, or project planning'
      },
      consulting_services: {
        name: 'Consulting services',
        definition: 'Funding supports hiring external consultants',
        when_to_use: 'Tag when eligible costs include consulting fees or professional services'
      },
      business_plan: {
        name: 'Business Plan',
        definition: 'Funding supports creating or updating a business plan',
        when_to_use: 'Tag when grants cover business plan development for startups or expansion'
      }
    }
  },
  'Grants for Startups': {
    intent: 'Startups',
    genres: {
      startup_hiring: {
        name: 'Start-Up Hiring',
        definition: 'Funding supports start-ups hiring employees or interns',
        when_to_use: 'Tag when the program provides wage support specifically for start-ups'
      },
      startup_training: {
        name: 'Start-Up Training',
        definition: 'Funding supports training for founders or start-up teams',
        when_to_use: 'Tag when programs fund courses, mentorship, or training for early-stage companies'
      },
      startup_expansion: {
        name: 'Start-Up Expansion',
        definition: 'Funding supports start-ups entering new markets or scaling',
        when_to_use: 'Tag when programs help early-stage businesses grow beyond initial operations'
      },
      startup_rd: {
        name: 'Start-Up R&D',
        definition: 'Funding supports start-up research and development',
        when_to_use: 'Tag when programs fund innovation, prototyping, or technical development for start-ups'
      },
      startup_advisory_systems: {
        name: 'Start-Up Advisory/Systems',
        definition: 'Funding supports start-ups accessing advisory services or business systems',
        when_to_use: 'Tag when programs fund mentorship, coaching, or operational tools for start-ups'
      },
      startup_loans: {
        name: 'Start-Up Loans',
        definition: 'Funding supports start-ups through loans, credit, or financial instruments',
        when_to_use: 'Tag when the program provides lending rather than grants'
      }
    }
  }
};

// Build system prompt with all smart filters
function buildSystemPrompt() {
  let prompt = `You are a grant classification expert. Score the provided grant program against ALL smart filter genres.

IMPORTANT: You must score ALL genres across ALL smart filters in a single response.

`;

  // Add each smart filter section
  Object.entries(SMART_FILTERS).forEach(([filterName, filterData]) => {
    prompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SMART FILTER: ${filterName} (Intent: ${filterData.intent})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    Object.entries(filterData.genres).forEach(([key, genre]) => {
      prompt += `- ${genre.name}:
  Definition: ${genre.definition}
  When to use: ${genre.when_to_use}

`;
    });
    prompt += '\n';
  });

  prompt += `SCORING SCALE (0-3):
- 0 = No association (program doesn't involve this at all)
- 1 = Weak/indirect association (tangentially related or possible but not emphasized)
- 2 = Moderate/secondary association (clearly involves this but not the primary focus)
- 3 = Strong/primary association (this is a core component of the program)

IMPORTANT NOTES:
- A single grant may score across MULTIPLE smart filters
- Score based on what the program text actually says, not assumptions
- A grant can have high scores in multiple filters (e.g., hiring + training, or R&D + commercialization)

NEW GENRE PROPOSALS:
If the grant covers an activity that doesn't fit any existing genre, propose a new genre and specify which smart filter it belongs to.

Return ONLY valid JSON in this exact format:
{
  "scores": {
    "Building Bench of Talent": {
      "hiring": 0-3,
      "wage_subsidy": 0-3,
      "student_coop": 0-3,
      "training": 0-3,
      "apprenticeship": 0-3,
      "youth_hire": 0-3,
      "remote_hire": 0-3,
      "barriered_youth": 0-3
    },
    "Adopt Software or AI": {
      "hardware": 0-3,
      "softwares": 0-3,
      "digital_marketing": 0-3,
      "technology_training": 0-3,
      "assessment": 0-3,
      "ai": 0-3,
      "technology_tech": 0-3
    },
    "Buy Equipment or Upgrade Facilities": {
      "equipment": 0-3,
      "retrofits": 0-3,
      "automation": 0-3,
      "facility_expansion": 0-3,
      "production_upgrade": 0-3
    },
    "Build Something New": {
      "rd": 0-3,
      "prototype_development": 0-3,
      "product_development": 0-3,
      "pilot_testing": 0-3,
      "tech_development": 0-3,
      "intellectual_property": 0-3
    },
    "International Growth": {
      "export": 0-3,
      "international_business_development": 0-3,
      "international_market_expansion": 0-3,
      "international_new_markets": 0-3,
      "international_expansion": 0-3,
      "international_tradeshow": 0-3
    },
    "Domestic Growth": {
      "domestic_tradeshows": 0-3,
      "domestic_marketing": 0-3,
      "domestic_expansion": 0-3,
      "domestic_sales_growth": 0-3
    },
    "Improve Sustainability": {
      "decarbonization": 0-3,
      "electrification": 0-3,
      "emissions_ghg_reduction": 0-3,
      "cleantech": 0-3,
      "waste_to_value": 0-3,
      "upcycling": 0-3,
      "green_jobs_hire": 0-3
    },
    "Improve Productivity": {
      "process_improvement": 0-3,
      "productivity": 0-3,
      "optimization": 0-3,
      "automation_ops": 0-3,
      "advanced_manufacturing": 0-3
    },
    "Commercialize or Scale": {
      "commercialization": 0-3,
      "scale_up": 0-3,
      "go_to_market": 0-3,
      "scale_production": 0-3,
      "product_validation": 0-3,
      "demonstration_project": 0-3,
      "market_ready_solution": 0-3
    },
    "Planning or Readiness Support": {
      "feasibility_study": 0-3,
      "advisory": 0-3,
      "readiness_assessment": 0-3,
      "audits": 0-3,
      "market_research_analysis": 0-3,
      "planning": 0-3,
      "consulting_services": 0-3,
      "business_plan": 0-3
    },
    "Grants for Startups": {
      "startup_hiring": 0-3,
      "startup_training": 0-3,
      "startup_expansion": 0-3,
      "startup_rd": 0-3,
      "startup_advisory_systems": 0-3,
      "startup_loans": 0-3
    }
  },
  "proposed_genres": [
    {
      "smart_filter": "string (which filter this belongs to)",
      "name": "string",
      "definition": "one sentence",
      "when_to_use": "one sentence",
      "why_existing_dont_fit": "explanation"
    }
  ]
}`;

  return prompt;
}

const SYSTEM_PROMPT = buildSystemPrompt();

async function scoreGrantGenres(grantCriteria, grantName) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Grant Name: ${grantName}\n\nGrant Criteria:\n${grantCriteria}`
    }]
  });

  let text = response.content[0].text.trim();

  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\s*/, '');
    text = text.replace(/\s*```\s*$/, '');
    text = text.trim();
  }

  // Extract JSON object
  const startIndex = text.indexOf('{');
  if (startIndex === -1) {
    throw new Error('No JSON object found in response');
  }

  let braceCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') braceCount++;
    if (text[i] === '}') braceCount--;
    if (braceCount === 0) {
      endIndex = i + 1;
      break;
    }
  }

  const jsonText = text.substring(startIndex, endIndex);

  try {
    const result = JSON.parse(jsonText);

    return {
      scores: result.scores,
      proposed_genres: result.proposed_genres || [],
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens
    };
  } catch (parseError) {
    console.error('\n❌ JSON Parse Error:');
    console.error('Raw response:', text);
    console.error('Extracted JSON:', jsonText);
    throw parseError;
  }
}

function calculateAssociationScores(scores) {
  const perFilter = {};

  Object.entries(SMART_FILTERS).forEach(([filterName, filterData]) => {
    const filterScores = scores[filterName] || {};
    const genreKeys = Object.keys(filterData.genres);
    const total = genreKeys.reduce((sum, key) => sum + (filterScores[key] || 0), 0);
    const maxPossible = genreKeys.length * 3;

    perFilter[filterName] = {
      total_score: total,
      association_pct: Math.round((total / maxPossible) * 100)
    };
  });

  return perFilter;
}

async function ensureGenreScoresColumn(client) {
  try {
    await client.query(`
      ALTER TABLE grants
      ADD COLUMN IF NOT EXISTS genre_scores JSONB
    `);
  } catch (error) {
    console.error('❌ Failed to create genre_scores column:', error);
    throw error;
  }
}

async function incrementalScoreGenres() {
  console.log('🏷️  Genre Tagger - Incremental (Daily Cron)\n');
  console.log(`⏰ Started at: ${new Date().toISOString()}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await ensureGenreScoresColumn(client);

    // Get grants where genre_scores IS NULL (new grants from daily sync)
    const grantsResult = await client.query(`
      SELECT grant_id, grant_name, grant_criteria
      FROM grants
      WHERE genre_scores IS NULL
      ORDER BY grant_id
    `);

    const grants = grantsResult.rows;

    if (grants.length === 0) {
      console.log('✅ No unscored grants found — all grants are up to date\n');
      return;
    }

    console.log(`📊 Found ${grants.length} unscored grant(s) to process\n`);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let scored = 0;
    let failed = 0;

    for (const grant of grants) {
      try {
        const { scores, proposed_genres, input_tokens, output_tokens } =
          await scoreGrantGenres(grant.grant_criteria, grant.grant_name);

        const associationScores = calculateAssociationScores(scores);

        const result = {
          grant_id: grant.grant_id,
          grant_name: grant.grant_name,
          scores,
          association_scores: associationScores,
          scored_at: new Date().toISOString()
        };

        // Update database
        await client.query(
          'UPDATE grants SET genre_scores = $1 WHERE grant_id = $2',
          [JSON.stringify(result), grant.grant_id]
        );

        totalInputTokens += input_tokens;
        totalOutputTokens += output_tokens;
        scored++;

        const topFilter = Object.entries(associationScores)
          .sort((a, b) => b[1].association_pct - a[1].association_pct)[0];

        console.log(`   ✅ [${scored}/${grants.length}] ${grant.grant_name}`);
        console.log(`      Top filter: ${topFilter[0]} (${topFilter[1].association_pct}%)`);

        if (proposed_genres && proposed_genres.length > 0) {
          console.log(`      💡 Proposed ${proposed_genres.length} new genre(s)`);
        }

      } catch (error) {
        console.error(`   ⚠️  Failed to score grant ${grant.grant_id}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\n✅ Scoring complete: ${scored} scored, ${failed} failed\n`);

    // Calculate cost
    const inputCost = (totalInputTokens / 1_000_000) * 1.00;
    const outputCost = (totalOutputTokens / 1_000_000) * 5.00;
    const totalCost = inputCost + outputCost;

    console.log('💰 Cost Estimate:');
    console.log(`   Input tokens: ${totalInputTokens.toLocaleString()} ($${inputCost.toFixed(4)})`);
    console.log(`   Output tokens: ${totalOutputTokens.toLocaleString()} ($${outputCost.toFixed(4)})`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}\n`);

    console.log('🎉 Incremental scoring complete!\n');

  } finally {
    client.release();
    await pool.end();
  }
}

incrementalScoreGenres().catch(console.error);

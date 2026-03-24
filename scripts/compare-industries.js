import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// All 83 form dropdown values from widget/getgranted-widget.js
const FORM_INDUSTRIES = [
  // Professional Services & Services (41)
  "Accounting",
  "Advertising/Marketing",
  "Alternative Medicine",
  "Arts & Culture",
  "Association",
  "Auto Repairs & Auto Parts",
  "Automotive Dealers",
  "Auxiliary Services",
  "Charity/Non-Profit",
  "Consulting - Business",
  "Consumer Services",
  "Educational Services",
  "Esthetics & Spas",
  "Film/Music/Entertainment",
  "Financial",
  "Healthcare",
  "Healthcare - Dental",
  "Healthcare - Physio",
  "Hospitality/Lodging/Tourism",
  "Insurance",
  "Legal",
  "Media - Broadcast",
  "Media - Podcast",
  "Media - Print/Publishing",
  "Public Relations",
  "Real Estate",
  "Recreation",
  "Restaurants/Cafes",
  "Retail",
  "Social Enterprise",
  "Travel",
  "Utilities",
  "Veterinary",
  "Warehousing",
  "Wellness",
  "Wellness - Counselling/Therapy",
  "Wellness - Fitness",
  "Wellness - Registered Practitioner",
  "Wholesaling",

  // Agriculture (5)
  "Agriculture - Crop",
  "Agriculture - Dairy",
  "Agriculture - Livestock",
  "Agriculture - Tree Fruit",
  "Agriculture - Vineyard/Wine",

  // Construction & Supply Chain (5)
  "Architecture/Design",
  "Construction",
  "Construction Supplier",
  "Engineering",
  "Logistics/Trucking",

  // Manufacturing (12)
  "Apparel/Textiles (Manufacturing)",
  "Consumer Goods (Manufacturing)",
  "Electronic (Manufacturing)",
  "Food Processing",
  "Food/Beverage (Manufacturing)",
  "Healthcare - Manufacturing",
  "Industrial (Manufacturing)",
  "Manufacturing",
  "Metal (Manufacturing)",
  "Paper/Print (Manufacturing)",
  "Plastics (Manufacturing)",
  "Wood Products (Manufacturing)",

  // Natural Resources / CleanTech (8)
  "Environmental - Education",
  "Environmental - Green Technologies",
  "Environmental - Waste Management",
  "Fishery",
  "Forestry",
  "Mining/Quarrying",
  "Oil & Gas Extraction",
  "Ship Building & Repair/Maritime Operations",

  // Technology (11)
  "Animation",
  "Aviation & Aerospace",
  "Biotechnology",
  "Computer/Network Security",
  "E-Commerce",
  "Healthcare - Technology",
  "Tech - AI",
  "Tech - Hardware",
  "Tech - Software/Web Development",
  "Technology",
  "Video Games",

  // Other (1)
  "Other"
];

async function compareIndustries() {
  try {
    const result = await pool.query(`
      SELECT DISTINCT
        trim(unnest(string_to_array(REPLACE(industries, E'Industries\\n      ', ''), ','))) as industry
      FROM grants
      WHERE industries IS NOT NULL
        AND industries != ''
        AND industries != 'null'
      ORDER BY industry
    `);

    const dbIndustries = result.rows.map(r => r.industry);

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║         COMPREHENSIVE INDUSTRY COMPARISON REPORT              ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    console.log(`📊 Form Dropdown Values: ${FORM_INDUSTRIES.length}`);
    console.log(`📊 Database Values (cleaned): ${dbIndustries.length}\n`);

    // Category 1: Exact Matches
    const exactMatches = [];
    const formNotInDb = [];
    const dbNotInForm = [];
    const nonMatches = [];

    // Check each form value
    for (const formValue of FORM_INDUSTRIES) {
      if (dbIndustries.includes(formValue)) {
        exactMatches.push(formValue);
      } else {
        // Check if there's a close match (case-insensitive or formatting difference)
        const closeMatch = dbIndustries.find(db =>
          db.toLowerCase() === formValue.toLowerCase() ||
          db.replace(/[\/\-\s&]/g, '') === formValue.replace(/[\/\-\s&]/g, '')
        );

        if (closeMatch) {
          nonMatches.push({ form: formValue, db: closeMatch });
        } else {
          formNotInDb.push(formValue);
        }
      }
    }

    // Check each database value
    for (const dbValue of dbIndustries) {
      if (!FORM_INDUSTRIES.includes(dbValue)) {
        // Check if it's already in nonMatches
        const alreadyMapped = nonMatches.find(nm => nm.db === dbValue);
        if (!alreadyMapped) {
          dbNotInForm.push(dbValue);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 1. EXACT MATCHES
    // ═══════════════════════════════════════════════════════════════
    console.log('\n┌───────────────────────────────────────────────────────────────┐');
    console.log('│ 1. ✅ EXACT MATCHES (Form == Database)                       │');
    console.log('└───────────────────────────────────────────────────────────────┘\n');
    console.log(`Total: ${exactMatches.length}\n`);
    exactMatches.forEach((value, i) => {
      console.log(`${i + 1}. "${value}"`);
    });

    // ═══════════════════════════════════════════════════════════════
    // 2. NON-MATCHES (Require Mapping)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n\n┌───────────────────────────────────────────────────────────────┐');
    console.log('│ 2. ⚠️  NON-MATCHES (Require Mapping)                         │');
    console.log('└───────────────────────────────────────────────────────────────┘\n');
    console.log(`Total: ${nonMatches.length}\n`);
    console.log('Form Value → Database Value\n');
    nonMatches.forEach((match, i) => {
      console.log(`${i + 1}. "${match.form}"`);
      console.log(`   → "${match.db}"\n`);
    });

    // ═══════════════════════════════════════════════════════════════
    // 3. IN FORM BUT NOT IN DATABASE
    // ═══════════════════════════════════════════════════════════════
    console.log('\n┌───────────────────────────────────────────────────────────────┐');
    console.log('│ 3. 🔵 IN FORM BUT NOT IN DATABASE                            │');
    console.log('└───────────────────────────────────────────────────────────────┘\n');
    console.log(`Total: ${formNotInDb.length}\n`);
    formNotInDb.forEach((value, i) => {
      console.log(`${i + 1}. "${value}"`);
    });

    // ═══════════════════════════════════════════════════════════════
    // 4. IN DATABASE BUT NOT IN FORM (Orphaned)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n\n┌───────────────────────────────────────────────────────────────┐');
    console.log('│ 4. 🟡 IN DATABASE BUT NOT IN FORM (Orphaned)                 │');
    console.log('└───────────────────────────────────────────────────────────────┘\n');
    console.log(`Total: ${dbNotInForm.length}\n`);
    dbNotInForm.forEach((value, i) => {
      console.log(`${i + 1}. "${value}"`);
    });

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                           SUMMARY                             ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    console.log(`✅ Exact Matches:              ${exactMatches.length}`);
    console.log(`⚠️  Non-Matches (need mapping): ${nonMatches.length}`);
    console.log(`🔵 In Form but not in DB:      ${formNotInDb.length}`);
    console.log(`🟡 In DB but not in Form:      ${dbNotInForm.length}`);
    console.log(`\n📊 Total Form Values:          ${FORM_INDUSTRIES.length}`);
    console.log(`📊 Total DB Values:            ${dbIndustries.length}`);
    console.log(`\n✅ Coverage: ${exactMatches.length + nonMatches.length}/${FORM_INDUSTRIES.length} form values can be mapped (${Math.round((exactMatches.length + nonMatches.length) / FORM_INDUSTRIES.length * 100)}%)\n`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

compareIndustries();

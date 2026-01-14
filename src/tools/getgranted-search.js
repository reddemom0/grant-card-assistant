/**
 * GetGranted Search Tool for Oracle
 *
 * Allows Oracle to search Granted Consulting's GetGranted database
 * for grant opportunities matching client criteria.
 *
 * Uses Playwright for browser automation since GetGranted has no public API.
 */

import { chromium } from 'playwright';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_PUBLIC_URL || process.env.REDIS_URL || 'redis://localhost:6379');

const GETGRANTED_URL = 'https://app.getgranted.ca';
const CACHE_TTL = 3600; // Cache results for 1 hour

/**
 * Search GetGranted database
 *
 * @param {Object} input - Search parameters
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

    console.log(`🔍 Searching GetGranted with filters:`, {
      purposes,
      regions,
      industries,
      business_type,
      company_size_min,
      company_size_max,
      active_only,
      limit
    });

    // Check cache first
    const cacheKey = `getgranted:search:${JSON.stringify(input)}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`   ✅ Cache hit - returning cached results`);
      return JSON.parse(cached);
    }

    // Launch browser in headless mode
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to login page
      console.log(`   📍 Navigating to GetGranted login...`);
      await page.goto(`${GETGRANTED_URL}/users/sign_in`, { waitUntil: 'domcontentloaded' });

      // Login
      console.log(`   🔐 Logging in...`);
      await login(page);

      // Navigate to grants page
      console.log(`   📍 Navigating to grants page...`);
      await page.goto(`${GETGRANTED_URL}/grants`, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for grants page to load - look for multiple possible indicators
      console.log(`   ⏳ Waiting for grants page to load...`);
      try {
        await page.waitForSelector('text=/Showing \\d+ of \\d+ grants|Grant Genie|Active Grants/', { timeout: 15000 });
        console.log(`   ✓ Grants page loaded`);
      } catch (error) {
        console.warn(`   ⚠️  Could not find expected page elements, continuing anyway...`);
        // Take screenshot for debugging
        await page.screenshot({ path: '/tmp/getgranted-page-load.png', fullPage: true });
      }

      // Apply filters (if possible)
      console.log(`   🎯 Applying filters...`);
      try {
        await applyFilters(page, {
          purposes,
          regions,
          industries,
          business_type,
          owner_demographics,
          company_size_min,
          company_size_max,
          active_only,
          open_intakes_only
        });
        console.log(`   ✓ Filters applied successfully`);
      } catch (filterError) {
        console.warn(`   ⚠️  Could not apply all filters: ${filterError.message}`);
        console.warn(`   ℹ️  Continuing with default/partial filtering...`);
        // Take screenshot for debugging
        await page.screenshot({ path: '/tmp/getgranted-filter-error.png', fullPage: true });
      }

      // Wait for results to update
      await page.waitForTimeout(2000);

      // Extract grant list
      console.log(`   📋 Extracting grant results...`);

      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/getgranted-results.png', fullPage: true });
      console.log(`   📸 Screenshot saved to /tmp/getgranted-results.png`);

      const grants = await extractGrantList(page, limit);

      console.log(`   ✅ Found ${grants.length} grants`);

      // Optionally fetch full details for each grant
      if (fetch_full_details && grants.length > 0) {
        console.log(`   📄 Fetching full details for ${grants.length} grants...`);
        for (const grant of grants) {
          try {
            await page.goto(`${GETGRANTED_URL}/grants/${grant.grant_id}`, { waitUntil: 'networkidle' });
            const details = await extractGrantDetails(page);
            Object.assign(grant, details);
            await page.waitForTimeout(500); // Polite delay
          } catch (error) {
            console.warn(`   ⚠️  Failed to fetch details for grant ${grant.grant_id}: ${error.message}`);
          }
        }
      }

      await browser.close();

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
        grants
      };

      // Cache results
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

      return result;

    } finally {
      await browser.close();
    }

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
 * Login to GetGranted
 */
async function login(page) {
  const email = process.env.GETGRANTED_EMAIL;
  const password = process.env.GETGRANTED_PASSWORD;

  if (!email || !password) {
    throw new Error('GETGRANTED_EMAIL and GETGRANTED_PASSWORD environment variables required');
  }

  try {
    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Try multiple selector strategies for email field
    let emailField = page.locator('input[type="email"]').first();
    let emailFieldExists = await emailField.count() > 0;

    if (!emailFieldExists) {
      emailField = page.locator('input[name="user[email]"]').first();
      emailFieldExists = await emailField.count() > 0;
    }

    if (!emailFieldExists) {
      emailField = page.locator('input[placeholder*="Email" i]').first();
      emailFieldExists = await emailField.count() > 0;
    }

    if (!emailFieldExists) {
      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/getgranted-login-error.png', fullPage: true });
      throw new Error('Could not find email input field on login page');
    }

    // Fill email
    await emailField.fill(email);
    console.log(`   ✓ Email filled`);

    // Try multiple selector strategies for password field
    let passwordField = page.locator('input[type="password"]').first();
    let passwordFieldExists = await passwordField.count() > 0;

    if (!passwordFieldExists) {
      passwordField = page.locator('input[name="user[password]"]').first();
      passwordFieldExists = await passwordField.count() > 0;
    }

    if (!passwordFieldExists) {
      await page.screenshot({ path: '/tmp/getgranted-login-error.png', fullPage: true });
      throw new Error('Could not find password input field on login page');
    }

    // Fill password
    await passwordField.fill(password);
    console.log(`   ✓ Password filled`);

    // Find and click submit button
    let submitButton = page.locator('button[type="submit"]').first();
    let submitExists = await submitButton.count() > 0;

    if (!submitExists) {
      submitButton = page.locator('input[type="submit"]').first();
      submitExists = await submitButton.count() > 0;
    }

    if (!submitExists) {
      submitButton = page.locator('button:has-text("Log in"), button:has-text("Sign in")').first();
      submitExists = await submitButton.count() > 0;
    }

    if (!submitExists) {
      await page.screenshot({ path: '/tmp/getgranted-login-error.png', fullPage: true });
      throw new Error('Could not find submit button on login page');
    }

    // Click submit
    await submitButton.click();
    console.log(`   ✓ Submit clicked`);

    // Wait for navigation to complete
    await page.waitForURL(/\/(grants|dashboard)/, { timeout: 15000 });

    console.log(`   ✅ Logged in successfully`);

  } catch (error) {
    console.error(`   ❌ Login failed: ${error.message}`);
    // Try to capture page content for debugging
    const pageContent = await page.content().catch(() => 'Unable to capture page content');
    console.error(`   Page HTML preview: ${pageContent.substring(0, 500)}...`);
    throw error;
  }
}

/**
 * Apply search filters
 */
async function applyFilters(page, filters) {
  const {
    purposes,
    regions,
    industries,
    business_type,
    owner_demographics,
    company_size_min,
    company_size_max,
    active_only,
    open_intakes_only
  } = filters;

  // Active grants filter
  if (active_only) {
    const activeCheckbox = page.locator('text=Show Active Grants').locator('..').locator('input[type="checkbox"]');
    const isChecked = await activeCheckbox.isChecked();
    if (!isChecked) {
      await activeCheckbox.check();
    }
  }

  // Open intakes filter
  if (open_intakes_only) {
    // Check at least one "Intakes Currently Open" option
    const openIntakeCheckboxes = page.locator('text=Intakes Currently Open').locator('..').locator('..').locator('input[type="checkbox"]');
    const count = await openIntakeCheckboxes.count();
    if (count > 0) {
      await openIntakeCheckboxes.first().check();
    }
  }

  // Purposes (grant types)
  if (purposes.length > 0) {
    // First uncheck "Check All" if checked
    const checkAllButton = page.locator('text=Uncheck All');
    const isVisible = await checkAllButton.isVisible().catch(() => false);
    if (isVisible) {
      await checkAllButton.click();
      await page.waitForTimeout(500);
    }

    // Check specific purposes
    for (const purpose of purposes) {
      const checkbox = page.locator(`text=${purpose}`).locator('..').locator('input[type="checkbox"]').first();
      const exists = await checkbox.count() > 0;
      if (exists) {
        await checkbox.check();
      }
    }
  }

  // Regions
  if (regions.length > 0) {
    // Uncheck "Any Region in Canada" first
    const anyRegionCheckbox = page.locator('text=Any Region in Canada').locator('..').locator('input[type="checkbox"]');
    const isChecked = await anyRegionCheckbox.isChecked();
    if (isChecked) {
      await anyRegionCheckbox.uncheck();
    }

    // Check specific regions
    for (const region of regions) {
      const checkbox = page.locator(`text=${region}`).first().locator('..').locator('input[type="checkbox"]').first();
      const exists = await checkbox.count() > 0;
      if (exists) {
        await checkbox.check();
      }
    }
  }

  // Industries
  if (industries.length > 0) {
    const industryInput = page.locator('input[placeholder*="Add Industries"]');
    await industryInput.fill(industries.join(', '));
  }

  // Business type
  if (business_type) {
    // Uncheck "Any Business Type"
    const anyBusinessCheckbox = page.locator('text=Any Business Type').locator('..').locator('input[type="checkbox"]');
    const isChecked = await anyBusinessCheckbox.isChecked();
    if (isChecked) {
      await anyBusinessCheckbox.uncheck();
    }

    // Check specific type
    const checkbox = page.locator(`text=${business_type}`).locator('..').locator('input[type="checkbox"]').first();
    const exists = await checkbox.count() > 0;
    if (exists) {
      await checkbox.check();
    }
  }

  // Owner demographics
  if (owner_demographics.length > 0) {
    for (const demographic of owner_demographics) {
      const checkbox = page.locator(`text=${demographic}`).locator('..').locator('input[type="checkbox"]').first();
      const exists = await checkbox.count() > 0;
      if (exists) {
        await checkbox.check();
      }
    }
  }

  // Company size
  if (company_size_min) {
    const minInput = page.locator('input[placeholder*="Any Min"]');
    await minInput.fill(String(company_size_min));
  }

  if (company_size_max) {
    const maxInput = page.locator('input[placeholder*="Any Max"]');
    await maxInput.fill(String(company_size_max));
  }

  // Click Filter button (if it exists - some GetGranted UI versions auto-update)
  try {
    const filterButton = page.locator('button:has-text("Filter")');
    const buttonExists = await filterButton.count() > 0;

    if (buttonExists) {
      console.log(`   ✓ Found Filter button, clicking...`);
      await filterButton.click({ timeout: 5000 });
    } else {
      console.log(`   ℹ️  No Filter button found - filters may apply automatically`);
    }
  } catch (error) {
    console.log(`   ℹ️  Could not click Filter button (may not be needed): ${error.message}`);
  }

  // Wait for results to update
  await page.waitForTimeout(3000);
}

/**
 * Extract grant list from search results
 */
async function extractGrantList(page, limit = 10) {
  const grants = [];

  // Scroll to bottom to trigger lazy loading of grant cards
  console.log(`   📜 Scrolling to load all grants...`);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
  await page.evaluate(() => window.scrollTo(0, 0)); // Scroll back to top
  await page.waitForTimeout(1000);

  // Try multiple selector strategies to find grant cards
  console.log(`   🔍 Looking for grant cards with different selectors...`);

  // Strategy 1: Look for elements with grant-related classes
  let grantItems = page.locator('.grant-card');
  let count = await grantItems.count();
  console.log(`   Strategy 1 (.grant-card): ${count} items`);

  // Strategy 2: Look for data-testid
  if (count === 0) {
    grantItems = page.locator('[data-testid="grant-item"]');
    count = await grantItems.count();
    console.log(`   Strategy 2 ([data-testid="grant-item"]): ${count} items`);
  }

  // Strategy 3: Look for any element with "Grant" in class name
  if (count === 0) {
    grantItems = page.locator('[class*="rant"], [class*="Grant"]');
    count = await grantItems.count();
    console.log(`   Strategy 3 ([class*="Grant"]): ${count} items`);
  }

  // Strategy 4: Look for divs with links to /grants/
  if (count === 0) {
    grantItems = page.locator('a[href*="/grants/"]').locator('..');
    count = await grantItems.count();
    console.log(`   Strategy 4 (links to /grants/): ${count} items`);
  }

  // Strategy 5: Look for card-like structures with grant info
  if (count === 0) {
    grantItems = page.locator('div').filter({ hasText: /ID:\s*\d+/ });
    count = await grantItems.count();
    console.log(`   Strategy 5 (divs with ID pattern): ${count} items`);
  }

  console.log(`   ✓ Found ${count} grant card(s) on page using active strategy`);

  // Limit to requested amount
  const itemsToExtract = Math.min(count, limit);

  for (let i = 0; i < itemsToExtract; i++) {
    const item = grantItems.nth(i);
    console.log(`   📝 Extracting grant ${i + 1}/${itemsToExtract}...`);

    try {
      // Extract grant name and ID with timeout
      const nameElement = item.locator('a, h2, h3').first();
      const grantName = await nameElement.textContent({ timeout: 3000 }).catch(() => 'Unknown Grant');

      // Extract grant ID from text or href
      const idText = await item.locator('text=/ID: \\d+/').textContent({ timeout: 2000 }).catch(() => '');
      const grantId = idText.match(/\d+/)?.[0] || String(i + 1);

      // Extract grant type with timeout
      const grantType = await item.locator('text=/MARKET EXPANSION|HIRING|TRAINING|CAPITAL COSTS|INVESTMENT|R&D/i')
        .textContent({ timeout: 2000 })
        .catch(() => 'Unknown');

      // Extract regions with timeout
      const regionsText = await item.locator('text=/ALL OF CANADA|BRITISH COLUMBIA|ONTARIO/i')
        .textContent({ timeout: 2000 })
        .catch(() => '');

      // Extract max spend with timeout
      const maxSpendText = await item.locator('text=/\\$[\\d,]+/')
        .textContent({ timeout: 2000 })
        .catch(() => '');
      const maxSpend = maxSpendText.replace(/[^\d]/g, '');

      // Extract program contribution % with timeout
      const contributionText = await item.locator('text=/\\d+%/')
        .textContent({ timeout: 2000 })
        .catch(() => '');
      const contributionPercent = contributionText.replace('%', '');

      // Extract difficulty (count of bars) with timeout
      const difficultyBars = await item.locator('[class*="difficulty"] div, [class*="bar"]')
        .count()
        .catch(() => 0);

      // Extract deadline status if visible with timeout
      const deadlineText = await item.locator('text=/Open until|CLOSED|deadline/i')
        .textContent({ timeout: 2000 })
        .catch(() => '');

      grants.push({
        grant_id: grantId,
        grant_name: grantName.trim(),
        grant_type: grantType.trim(),
        regions: regionsText.trim(),
        max_spend: maxSpend ? parseInt(maxSpend) : null,
        contribution_percentage: contributionPercent ? parseInt(contributionPercent) : null,
        difficulty: difficultyBars,
        deadline_status: deadlineText.trim() || 'Unknown',
        url: `${GETGRANTED_URL}/grants/${grantId}`
      });

      console.log(`   ✓ Extracted: ${grantName.trim().substring(0, 50)}...`);

    } catch (error) {
      console.warn(`   ⚠️  Failed to extract grant at index ${i}: ${error.message}`);
      // Add a minimal grant entry so we don't lose track
      grants.push({
        grant_id: String(i + 1),
        grant_name: 'Extraction Failed',
        grant_type: 'Unknown',
        regions: '',
        max_spend: null,
        contribution_percentage: null,
        difficulty: 0,
        deadline_status: 'Unknown',
        url: ''
      });
    }
  }

  return grants;
}

/**
 * Extract full grant details from grant card page
 */
async function extractGrantDetails(page) {
  const details = {};

  try {
    // Grant Criteria (overview)
    details.grant_criteria = await page.locator('text=Grant Criteria').locator('..').locator('p, div').first().textContent().catch(() => '');

    // Grant Value
    const grantValueSection = page.locator('text=Grant Value:').locator('..').locator('ul');
    details.grant_value = await grantValueSection.allTextContents().catch(() => []);

    // Turnaround Time
    details.turnaround_time = await page.locator('text=Turnaround Time:').locator('..').textContent().catch(() => '');

    // Eligible Applicants
    const eligibleSection = page.locator('text=Eligible Applicants:').locator('..').locator('ul');
    details.eligible_applicants = await eligibleSection.allTextContents().catch(() => []);

    // Ineligible Applicants
    const ineligibleSection = page.locator('text=Ineligible Applicants:').locator('..').locator('ul');
    details.ineligible_applicants = await ineligibleSection.allTextContents().catch(() => []);

    // Eligible Expenses
    const expensesSection = page.locator('text=Eligible Expenses:').locator('..').locator('ul');
    details.eligible_expenses = await expensesSection.allTextContents().catch(() => []);

    // Program Details
    const programSection = page.locator('text=Program Details:').locator('..').locator('ul');
    details.program_details = await programSection.allTextContents().catch(() => []);

    // Best Practices
    const bestPracticesSection = page.locator('text=Best Practices').locator('..').locator('ul');
    details.best_practices = await bestPracticesSection.allTextContents().catch(() => []);

    // Forms/Links
    const formsSection = page.locator('text=Forms:').locator('..').locator('a');
    const formsCount = await formsSection.count();
    details.forms = [];
    for (let i = 0; i < formsCount; i++) {
      const link = formsSection.nth(i);
      details.forms.push({
        text: await link.textContent(),
        url: await link.getAttribute('href')
      });
    }

    // Last updated
    details.last_updated = await page.locator('text=/UPDATED ON/i').textContent().catch(() => '');

  } catch (error) {
    console.warn(`   ⚠️  Failed to extract some grant details: ${error.message}`);
  }

  return details;
}

/**
 * Tool definition for Claude agent
 */
export const getGrantedSearchTool = {
  name: 'search_getgranted',
  description: `Search Granted Consulting's GetGranted database for grant opportunities matching client criteria.

Use this to:
- Find grants for specific clients based on their industry, location, and needs
- Discover hiring, training, export, R&D, or capital grants
- Filter by region, company size, owner demographics
- Get quick summaries or full grant card details

This tool searches the internal GetGranted database (188+ Canadian grants) and returns matching opportunities with eligibility, funding details, and deadlines.

**Common use cases:**
- "Find hiring grants for a BC tech company with 25 employees"
- "Show market expansion grants for Indigenous-owned businesses"
- "Search for R&D grants in Ontario with open intakes"
- "Find all grants for female-owned manufacturing companies"`,

  input_schema: {
    type: 'object',
    properties: {
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

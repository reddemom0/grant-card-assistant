# Scraper Changes for Intake Cycle Extraction

## Changes to `export-getgranted-all-grants.js`

### 1. Update `extractGrantDetails` function

**BEFORE (line 93):**
```javascript
async function extractGrantDetails(page, grantId) {
  await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
  await page.waitForTimeout(1500);
```

**AFTER:**
```javascript
async function extractGrantDetails(page, grantId) {
  // First, visit the public grant page for main details
  await page.goto(`${GETGRANTED_URL}/grants/${grantId}`, { timeout: 10000 });
  await page.waitForTimeout(1500);
```

### 2. Add intake cycle extraction (insert BEFORE line 172 `return details;`)

**ADD THIS CODE BLOCK before `return details;`:**

```javascript
  // Extract intake cycle fields from admin edit page
  // These fields are only available on the admin edit page, not the public page
  try {
    await page.goto(`${GETGRANTED_URL}/admin/grants/${grantId}/edit`, { timeout: 10000 });
    await page.waitForTimeout(1500);

    // Extract intake_cycle (funding_period)
    const fundingPeriodCheckboxes = await page.locator('input[name="grant[funding_period][]"]:checked').all();
    const fundingPeriods = [];
    for (const checkbox of fundingPeriodCheckboxes) {
      const value = await checkbox.getAttribute('value');
      if (value) fundingPeriods.push(value);
    }
    details.intake_cycle = fundingPeriods.join(', ');

    // Extract intakes_currently_open
    const currentlyOpenCheckboxes = await page.locator('input[name="grant[intakes_currently_open][]"]:checked').all();
    const currentlyOpen = [];
    for (const checkbox of currentlyOpenCheckboxes) {
      const value = await checkbox.getAttribute('value');
      if (value) currentlyOpen.push(value);
    }
    details.intakes_currently_open = currentlyOpen.join(', ');

    console.log(`      Intake Cycle: ${details.intake_cycle || '(none)'}`);
    console.log(`      Currently Open: ${details.intakes_currently_open || '(none)'}`);

  } catch (error) {
    console.warn(`      Warning: Failed to extract intake cycle: ${error.message}`);
    details.intake_cycle = null;
    details.intakes_currently_open = null;
  }

  return details;
```

### Expected Output Examples

**Grant 1 (Career Launcher - Clean Tech):**
```
intake_cycle: "Summer, Fall"
intakes_currently_open: "Summer, Fall"
```

**Grant 85 (Northern Industries Innovation Fund):**
```
intake_cycle: "Year Round"
intakes_currently_open: "" or "Year Round"
```

**Grant with no intake cycle set:**
```
intake_cycle: ""
intakes_currently_open: ""
```

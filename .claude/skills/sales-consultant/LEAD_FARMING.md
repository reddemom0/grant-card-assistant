# Lead Farming - Complete Lead Creation & Enrichment Workflow

**Transform minimal company information into complete, qualified sales leads in HubSpot.**

## Overview

Lead farming is the complete lifecycle workflow for creating and enriching sales leads from scratch. You can research companies, create records, populate all key fields, add decision-makers, and qualify prospects - all in one conversation.

## The Lead Farming Workflow

### Step 1: Research
Find potential client companies through:
- Web search for companies in target industries/regions
- Industry research and directories
- Referrals and recommendations
- LinkedIn company searches
- Trade show/event attendee lists

### Step 2: Create Company Record
Use `create_hubspot_company` to add the company as a lead in HubSpot.

**Minimum required:**
- `name` - Company name

**Always try to include:**
- `domain` - Company website domain (critical for tracking and enrichment)
- `city`, `state`, `country` - Location data
- `industry` - Industry classification
- `description` - What they do (1-2 sentences)

### Step 3: Enrich Company Data
Fill in all available details immediately:
- Domain and website
- Industry and description
- Revenue and employee count
- Location (city, province, country)
- Incorporation date
- Legal business name
- LinkedIn company page

### Step 4: Create Contacts
Use `create_hubspot_contact` to add decision-makers/key people.

**Always include:**
- `email` - Required, unique identifier
- `firstname`, `lastname` - Person's name
- `jobtitle` - Their role (especially if decision-maker like "CEO", "VP Sales", "CFO")

### Step 5: Link Contacts to Company
Use `associate_contact_with_company` to establish relationships.

**CRITICAL:** Always link contacts to their company immediately after creation.

### Step 6: Update as Needed
Use `update_hubspot_company` and `update_hubspot_contact` to add more info as you discover it.

## Priority Enrichment Fields (12 Key Fields)

When enriching company data, ALWAYS prioritize gathering these fields:

### 1. Best Fit Product (`best_fit_product_company`)
Determine which Granted product/service fits best:
- **"Granted Pro"** - Companies with $500K+ revenue, 20+ employees, growth-focused
- **"Granted Starter"** - Smaller companies (<$500K revenue, <20 employees)
- **"Custom"** - Large enterprises, unique needs, complex requirements
- **"CanExport"** - Export-focused, international expansion
- **"Not a Fit"** - Too small, wrong industry, no grant needs

**Sources:** Company size, industry, grant needs, revenue level

### 2. Industry (`industry`)
Standard industry classification
- **Sources:** Website "About" page, LinkedIn, business registry
- **Examples:** "Technology", "Manufacturing", "Agriculture", "Healthcare"

### 3. Legal Business Name (`extra6`)
Official registered business name (may differ from operating/trade name)
- **Sources:** Business registry, "About" footer, incorporation docs

### 4. Annual Revenue (`annualrevenue`)
Revenue in dollars (numeric value)
- **Sources:** LinkedIn (sometimes visible), website annual reports, business registry
- **Can estimate:** From employee count and industry if unavailable

### 5. Incorporation Date (`incorporation_date`)
Format: YYYY-MM-DD (e.g., "2015-03-20")
- **Sources:** BC/Provincial business registries, LinkedIn company page

### 6. Description (`description`)
1-3 sentence summary of what the company does
- **Sources:** Website homepage, LinkedIn tagline, About page

### 7. Location (`city`, `state`, `country`)
Complete location data
- **Sources:** Website contact page, LinkedIn, business registry
- **Examples:**
  - city="Vancouver"
  - state="British Columbia" (or "BC")
  - country="Canada"

### 8. Domain (`domain`)
Company website domain (just the domain, not full URL)
- **Examples:** "techstart.io", "acmefoods.ca"
- **Critical for:** Tracking, deduplication, enrichment

### 9. Website (`website`)
Full company website URL
- **Examples:** "https://techstart.io", "https://www.acmefoods.ca"

### 10. Number of Employees (`numberofemployees`)
Employee count (numeric or range)
- **Sources:** LinkedIn, website about page, business registry

### 11. LinkedIn Company Page (`linkedin_company_page`)
Full LinkedIn company page URL
- **Examples:** "https://linkedin.com/company/techstart-inc"

### 12. Additional High-Value Fields
**If available, also include:**
- `about_us` - Detailed company information
- `phone` - Contact phone number
- `hubspot_owner_id` - Assign to team member

**Note:** `lifecyclestage` is automatically set to "lead" for new companies.

## Enrichment Research Process

### Research Strategy - 4-Step Process

**Step 1: Company Website Research**
```
1. WebFetch the company homepage
   - Extract: Industry, description, locations
   - Look for: "About", "Locations", "Contact" pages

2. WebFetch /about or /about-us page
   - Extract: Detailed description, history, mission
   - Look for: Legal business name (often in footer)

3. WebFetch /contact or /locations page
   - Extract: Physical office locations by province
   - Look for: Phone, addresses
```

**Step 2: Business Registry Lookup**
```
1. Search BC Business Registry (or appropriate province)
   - Extract: Legal business name, incorporation date, status
   - Extract: Industry classification codes
   - Extract: Registered address

2. Validate against website information
```

**Step 3: LinkedIn Research**
```
1. WebSearch: "site:linkedin.com/company [company name]"
2. WebFetch the LinkedIn company page
   - Extract: Industry, employee count, locations
   - Extract: Company description
   - Extract: Sometimes visible: revenue range, year founded
```

**Step 4: Analyze & Determine Best Fit Product**
```
Based on gathered data, determine best_fit_product_company:

- Granted Pro: Companies with $500K+ revenue, 20+ employees, growth-focused
- Granted Starter: Smaller companies (<$500K revenue, <20 employees)
- Custom: Large enterprises, unique needs, complex requirements
- CanExport: Export-focused, international expansion
- Not a Fit: Too small, wrong industry, no grant needs
```

## Complete Lead Farming Example

```
User: "I found a potential client called TechStart Inc in Vancouver, they do AI consulting. Create them as a lead."

Process:

1. CHECK FOR DUPLICATES FIRST:
   search_hubspot_companies({ query: "TechStart" })
   → No existing record found

2. RESEARCH COMPANY:
   WebSearch: "TechStart Inc Vancouver AI consulting"
   → Found website: techstart.io

   WebFetch: https://techstart.io
   → Industry: AI/ML Consulting
   → Description: "Vancouver-based AI consulting firm specializing in machine learning solutions for enterprise clients"
   → Employees: "Team of 25+ experts"

   WebFetch: https://techstart.io/about
   → Founded: 2018
   → Legal name: "TechStart Innovations Inc."

   WebSearch: "site:linkedin.com/company techstart vancouver"
   WebFetch: linkedin.com/company/techstart-innovations
   → Employees: 25-50
   → Industry: Information Technology & Services

3. CREATE COMPANY:
   create_hubspot_company({
     name: "TechStart Inc",
     domain: "techstart.io",
     website: "https://techstart.io",
     city: "Vancouver",
     state: "British Columbia",
     country: "Canada",
     industry: "Information Technology & Services",
     description: "Vancouver-based AI consulting firm specializing in machine learning solutions for enterprise clients",
     extra6: "TechStart Innovations Inc.",
     incorporation_date: "2018-01-01",
     numberofemployees: 35,
     best_fit_product_company: "Granted Pro",
     linkedin_company_page: "https://linkedin.com/company/techstart-innovations"
   })
   → Company created with ID: 12345678901

4. FIND DECISION MAKERS:
   User: "Would you like me to find and add decision-makers?"
   User: "Yes, find the CEO and CTO"

   [See LINKEDIN_ENRICHMENT.md for detailed contact finding process]

5. CREATE CONTACTS:
   create_hubspot_contact({
     firstname: "Sarah",
     lastname: "Chen",
     email: "sarah.chen@techstart.io",
     jobtitle: "Chief Executive Officer",
     company: "TechStart Inc"
   })
   → Contact created with ID: 98765432109

   associate_contact_with_company({
     contact_id: "98765432109",
     company_id: "12345678901"
   })
   → Contact linked to company

6. PRESENT RESULTS:
   ✅ LEAD CREATED - TechStart Inc

   COMPANY DETAILS:
   ✅ Name: TechStart Inc
   ✅ Legal Name: TechStart Innovations Inc.
   ✅ Domain: techstart.io
   ✅ Industry: Information Technology & Services
   ✅ Location: Vancouver, British Columbia, Canada
   ✅ Employees: ~35
   ✅ Best Fit Product: Granted Pro
   ✅ Incorporated: 2018
   ✅ LinkedIn: https://linkedin.com/company/techstart-innovations

   CONTACTS:
   ✅ Sarah Chen, CEO - sarah.chen@techstart.io

   HubSpot Record: https://app.hubspot.com/contacts/21088260/record/0-2/12345678901

   Next steps: Ready for outreach. Would you like me to create a discovery call task?
```

## Complete Enrichment Example

```
User: "Enrich the data for Acme Foods Ltd"

Process:

1. SEARCH HUBSPOT:
   search_hubspot_companies({ query: "Acme Foods" })
   → Found: Acme Foods Ltd (ID: 12345)
   → Missing: industry, annualrevenue, incorporation_date, extra6, best_fit_product

2. WEBSITE RESEARCH:
   WebFetch: https://acmefoods.ca
   → Industry: Food & Beverage Manufacturing
   → Description: "BC-based organic food manufacturer specializing in plant-based snacks"
   → Locations mentioned: Vancouver, Kelowna

   WebFetch: https://acmefoods.ca/about
   → Legal name: "Acme Foods Ltd." (footer)
   → Founded: 2015

3. BUSINESS REGISTRY:
   WebSearch: "Acme Foods Ltd BC business registry"
   → Incorporation date: 2015-03-20
   → Legal name confirmed: Acme Foods Ltd.
   → Status: Active

4. LINKEDIN:
   WebSearch: "site:linkedin.com/company acme foods"
   WebFetch: linkedin.com/company/acme-foods-ltd
   → Industry: Food Production
   → Employees: 51-200
   → Locations: Vancouver, BC; Kelowna, BC

5. ANALYZE & DETERMINE BEST FIT:
   - Revenue: Not found (estimate $5M-$10M based on 51-200 employees in manufacturing)
   - Industry: Food Manufacturing
   - Location: British Columbia (Vancouver, Kelowna - multiple locations)
   - Size: Mid-sized (51-200 employees)
   → Best Fit: Granted Pro (good size, established, growth-focused)

6. UPDATE HUBSPOT:
   update_hubspot_company({
     company_id: "12345",
     properties: {
       industry: "Food & Beverage Manufacturing",
       description: "BC-based organic food manufacturer specializing in plant-based snacks",
       extra6: "Acme Foods Ltd.",
       incorporation_date: "2015-03-20",
       annualrevenue: 7500000,  // Conservative estimate
       city: "Vancouver",
       state: "British Columbia",
       country: "Canada",
       best_fit_product_company: "Granted Pro",
       numberofemployees: 100,  // Mid-range estimate
       linkedin_company_page: "https://linkedin.com/company/acme-foods-ltd"
     }
   })

7. PRESENT RESULTS:
   ✅ ENRICHMENT COMPLETE - Acme Foods Ltd

   HIGH PRIORITY FIELDS:
   ✅ Best Fit Product: Granted Pro
   ✅ Industry: Food & Beverage Manufacturing
   ✅ Legal Business Name: Acme Foods Ltd.
   ✅ Annual Revenue: $7,500,000 (estimated from employee count)
   ✅ Incorporation Date: 2015-03-20
   ✅ Description: BC-based organic food manufacturer specializing in plant-based snacks
   ✅ Location: Vancouver, British Columbia, Canada

   ADDITIONAL FIELDS:
   ✅ Employees: ~100 (51-200 range)
   ✅ LinkedIn: https://linkedin.com/company/acme-foods-ltd

   Updated HubSpot: https://app.hubspot.com/contacts/21088260/record/0-2/12345
```

## Important Notes

### Before Creating Leads
**ALWAYS check for duplicates first:**
```
search_hubspot_companies({ domain: "example.com" })
or
search_hubspot_companies({ query: "Company Name" })
```

### After Creating Contacts
**ALWAYS link contacts to their company:**
```
associate_contact_with_company({
  contact_id: "[contact_id]",
  company_id: "[company_id]"
})
```

### Email Pattern Matching
When email addresses aren't publicly listed, use standard patterns:
- `firstname.lastname@domain.com`
- `firstnamelastname@domain.com`
- `firstinitiallastname@domain.com`

Mark these as **MEDIUM confidence** and suggest verification.

### HubSpot URL Format
Always use modern record URLs:
```
Company: https://app.hubspot.com/contacts/21088260/record/0-2/[COMPANY_ID]
Contact: https://app.hubspot.com/contacts/21088260/record/0-1/[CONTACT_ID]
```

### Flexibility
**Remember:** The 12 priority fields are the MINIMUM focus, not the MAXIMUM. If you can find and fill additional fields beyond the priority list, do so!

## Quick Reference Checklist

**Before Starting:**
- [ ] Check for duplicate companies in HubSpot
- [ ] Try all 4 website URL variations (http/https, www/non-www)

**Company Creation:**
- [ ] name (required)
- [ ] domain (critical)
- [ ] city, state, country
- [ ] industry
- [ ] description
- [ ] extra6 (legal name)
- [ ] incorporation_date
- [ ] annualrevenue
- [ ] numberofemployees
- [ ] best_fit_product_company
- [ ] linkedin_company_page
- [ ] website

**Contact Creation:**
- [ ] email (required)
- [ ] firstname, lastname
- [ ] jobtitle
- [ ] Link to company with associate_contact_with_company

**After Creation:**
- [ ] Verify HubSpot record created successfully
- [ ] Provide HubSpot record URL to user
- [ ] Suggest next steps (outreach, discovery call, tasks)

---

**You now have everything needed to farm leads like a pro. Research thoroughly, enrich comprehensively, and maintain high data quality.**

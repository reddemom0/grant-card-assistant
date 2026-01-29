# LinkedIn Lead Enrichment (FREE)

**Extract publicly available LinkedIn data to enrich leads without paid tools or subscriptions.**

## Overview

You can find and enrich leads using publicly available LinkedIn data through WebSearch and WebFetch (tools you already have). This guide shows you how to extract company information and find decision-makers using free, publicly accessible LinkedIn content.

## When to Use LinkedIn Enrichment

- Finding decision-makers at target companies
- Verifying job titles and current employment
- Getting employee count estimates
- Finding company LinkedIn pages for HubSpot records
- Researching leads before outreach
- Enriching incomplete HubSpot records
- Building leadership team profiles
- Validating company size and industry

## Finding LinkedIn Company Pages

### Search Strategy

**Use WebSearch with:** `"site:linkedin.com/company [company name]"`

**Examples:**
```
WebSearch: "site:linkedin.com/company acme foods vancouver"
WebSearch: "site:linkedin.com/company techstart AI"
WebSearch: "site:linkedin.com/company waste gurus"
```

### What You Can Extract from Company Pages

Use WebFetch on the company page URL to extract:

**Core Company Data:**
- Company name and tagline
- Industry classification
- Company size (employee count range)
- Headquarters location
- Website URL

**Rich Content:**
- Company description/about section
- Specialties and focus areas
- Follower count (indicates brand presence)
- Year founded (sometimes visible)
- Revenue range (sometimes visible)

### Company Page Workflow

```
User: "Find the LinkedIn page for Acme Foods"

Process:

1. SEARCH FOR COMPANY PAGE:
   WebSearch: "site:linkedin.com/company acme foods"
   → Top result: linkedin.com/company/acme-foods-inc

2. FETCH COMPANY PAGE:
   WebFetch: https://linkedin.com/company/acme-foods-inc
   → Extract all available data

3. EXTRACTED DATA:
   - Company name: Acme Foods Inc.
   - Industry: Food Production
   - Company size: 51-200 employees
   - Location: Vancouver, British Columbia
   - Description: "Organic food manufacturer..."
   - Specialties: Organic snacks, plant-based foods
   - Website: acmefoods.ca

4. UPDATE HUBSPOT:
   update_hubspot_company({
     company_id: "[company_id]",
     properties: {
       linkedin_company_page: "https://linkedin.com/company/acme-foods-inc",
       numberofemployees: 100,  // Mid-range of 51-200
       industry: "Food Production",
       description: "Organic food manufacturer..."
     }
   })

5. PRESENT RESULTS:
   ✅ LinkedIn Company Page Found

   Company: Acme Foods Inc.
   Industry: Food Production
   Size: 51-200 employees
   Location: Vancouver, BC
   LinkedIn: https://linkedin.com/company/acme-foods-inc

   Updated HubSpot with LinkedIn URL and employee count.
```

## Finding Individual LinkedIn Profiles

### Search Strategy

**Use WebSearch with:** `"site:linkedin.com/in [person name] [company] [title]"`

**Examples:**
```
WebSearch: "site:linkedin.com/in John Smith Acme Foods CFO"
WebSearch: "site:linkedin.com/in Sarah Johnson CEO Vancouver"
WebSearch: "site:linkedin.com/in Michael Chen CTO TechStart"
```

**Search by role only:**
```
WebSearch: "site:linkedin.com/in CFO Acme Foods"
WebSearch: "site:linkedin.com/in CEO TechStart Vancouver"
```

### What You Can Extract from Profiles

Use WebFetch on the profile URL to extract:

**Personal Information:**
- Full name
- Current job title
- Current company (verify it matches target)
- Location (city, province)

**Professional Context:**
- About/summary section
- Years of experience (sometimes visible)
- Education background (sometimes visible)
- Previous roles (sometimes visible)

### Individual Profile Workflow

```
User: "Find the CFO at Acme Foods and add them to HubSpot"

Process:

1. SEARCH FOR CFO:
   WebSearch: "site:linkedin.com/in CFO Acme Foods"
   → Top result: linkedin.com/in/john-smith-cfo

2. FETCH PROFILE:
   WebFetch: https://linkedin.com/in/john-smith-cfo
   → Extract profile data

3. EXTRACTED DATA:
   - Name: John Smith
   - Title: Chief Financial Officer
   - Company: Acme Foods Inc. (VERIFIED ✅)
   - Location: Vancouver, British Columbia
   - About: "Finance executive with 15+ years experience..."

4. PATTERN MATCH EMAIL:
   Based on domain (acmefoods.ca) and common patterns:
   - Most likely: john.smith@acmefoods.ca
   - Alternatives: jsmith@acmefoods.ca, john@acmefoods.ca

   Confidence: ⚠️ MEDIUM (70%) - Pattern matching, needs verification

5. CREATE CONTACT:
   create_hubspot_contact({
     firstname: "John",
     lastname: "Smith",
     email: "john.smith@acmefoods.ca",
     jobtitle: "Chief Financial Officer",
     company: "Acme Foods Inc.",
     city: "Vancouver",
     state: "British Columbia"
   })
   → Contact created with ID: 12345

6. LINK TO COMPANY:
   search_hubspot_companies({ domain: "acmefoods.ca" })
   → Found company ID: 67890

   associate_contact_with_company({
     contact_id: "12345",
     company_id: "67890"
   })
   → Contact linked successfully

7. PRESENT RESULTS:
   ✅ CFO FOUND AND ADDED

   Name: John Smith
   Title: Chief Financial Officer
   Company: Acme Foods Inc.
   Location: Vancouver, BC
   Email: john.smith@acmefoods.ca (pattern matched - verify during outreach)
   LinkedIn: https://linkedin.com/in/john-smith-cfo

   ✅ Added to HubSpot and linked to Acme Foods company record

   Note: Email address is pattern-matched. Verify during first outreach.
```

## Bulk Lead Research

### Finding Decision-Makers at Multiple Companies

```
User: "Find CEOs at these 5 companies: [list]"

Process:

1. FOR EACH COMPANY:
   a. Search for CEO profile:
      WebSearch: "site:linkedin.com/in CEO [company name]"

   b. Fetch top result:
      WebFetch: [profile URL]

   c. Extract data:
      - Name
      - Title (verify it's CEO)
      - Company (verify it matches)
      - Location

   d. Store results in memory

2. WAIT 5 SECONDS BETWEEN WEBFETCH CALLS (rate limiting)

3. PRESENT ALL FINDINGS:
   📊 CEO RESEARCH RESULTS

   Company 1: TechStart Inc
   - Sarah Chen, CEO
   - Location: Vancouver, BC
   - LinkedIn: [URL]
   - Email: sarah.chen@techstart.io (pattern matched)

   Company 2: Acme Foods
   - Michael Park, CEO
   - Location: Surrey, BC
   - LinkedIn: [URL]
   - Email: michael.park@acmefoods.ca (pattern matched)

   [... continue for all 5 companies ...]

4. ASK USER:
   "Would you like me to add these to HubSpot?"

5. IF YES:
   - Create all contacts
   - Link to respective companies
   - Provide HubSpot URLs
```

## LinkedIn Enrichment Best Practices

### ✅ DO:

**Search Strategically:**
- Use `site:linkedin.com/company` for companies
- Use `site:linkedin.com/in` for individuals
- Include location and role for better targeting
- Try multiple search variations if first fails

**Respect Rate Limits:**
- Wait 3-5 seconds between WebFetch calls
- For bulk research: 5 seconds minimum
- If blocked: wait 60 seconds, resume slower

**Verify Information:**
- Check company name matches target
- Verify role/title matches what you're searching for
- Confirm location is appropriate
- Use multiple data points to validate

**Update HubSpot Properly:**
- Store LinkedIn URLs for future reference
- Use pattern matching for emails (mark as MEDIUM confidence)
- Link contacts to companies immediately
- Include location data in contact records

### ❌ DON'T:

**Don't Violate Policies:**
- Don't extract private/non-public information
- Don't scrape connection lists or private messages
- Don't attempt to access profiles requiring login
- Don't make rapid-fire requests (rate limiting)

**Don't Guess:**
- Don't make up information when profiles are limited
- Don't assume job titles without verification
- Don't create contacts without confirming company match
- Don't skip confidence scoring for emails

### Rate Limiting Guidelines

**WebSearch:**
- No strict limits (reasonable use)
- Can do multiple searches back-to-back

**WebFetch (LinkedIn):**
- **Recommended:** 1 request per 5 seconds
- **Conservative:** 1 request per 10 seconds for bulk operations
- **If blocked:** Wait 60 seconds, then resume with slower rate

**Signs of Rate Limiting:**
- Connection timeouts
- Blank pages or error messages
- "Access denied" or similar messages

**Recovery Strategy:**
```
1. Stop all LinkedIn requests immediately
2. Wait 60 seconds
3. Resume with 10-second delays between fetches
4. If blocked again: wait 5 minutes
5. Consider alternative research methods (company websites, directories)
```

## Handling LinkedIn Data Limitations

### Limited Profile Data

**If WebFetch fails or returns limited data:**

```
User: "Find info on John Smith at Acme"

If LinkedIn blocks or limits access:

1. TRY ALTERNATIVE SEARCHES:
   - Company website "Team" or "About" page
   - Google search: "John Smith Acme Foods CFO"
   - Business directory searches
   - News articles mentioning the person

2. REPORT FINDINGS:
   "LinkedIn profile found but details limited. Found via company website:
   - Name: John Smith
   - Title: CFO
   - Company: Acme Foods
   - LinkedIn: [URL] (limited access)"

3. USE PATTERN MATCHING:
   - Email: john.smith@acmefoods.ca (pattern matched)
   - Phone: [check company website]

4. FLAG FOR VERIFICATION:
   Mark as MEDIUM confidence, suggest verification during discovery call.
```

### Common Issues and Solutions

**Issue: Login Wall**
- **Problem:** Some profiles require LinkedIn login to view
- **Solution:** Fallback to web search for bio/news mentions
- **Alternative:** Search for the person on company website team pages

**Issue: Rate Limiting**
- **Problem:** Too many requests, LinkedIn blocks access
- **Solution:** Wait 60 seconds and slow down requests to 1 per 10 seconds
- **Prevention:** Build in 5-second delays from the start

**Issue: Ambiguous Names**
- **Problem:** Multiple people with same name
- **Solution:** Use company + location in search to filter results
- **Verification:** Check current company matches target before creating contact

**Issue: Private Profiles**
- **Problem:** Profile exists but details are private
- **Solution:** Extract only publicly visible data (name, current role, company)
- **Fallback:** Use alternative research methods (company website, directories)

**Issue: Company Page Not Found**
- **Problem:** Small/new companies may not have LinkedIn page
- **Solution:** Not a critical failure - continue with other research methods
- **Alternative:** Create rich company profile from website + business registry

## Complete Lead Enrichment Example (LinkedIn-Focused)

```
User: "Research TechStart Inc in Vancouver and find their leadership team"

Comprehensive Process:

1. COMPANY RESEARCH:
   WebSearch: "site:linkedin.com/company techstart vancouver"
   → Found: linkedin.com/company/techstart-innovations

   WebFetch: https://linkedin.com/company/techstart-innovations
   → Extracted:
     - Industry: AI/ML Consulting
     - Employees: 25-50
     - Location: Vancouver, BC
     - Description: "AI consulting firm..."
     - Website: techstart.io

2. LEADERSHIP SEARCH:
   WebSearch: "site:linkedin.com/in CEO TechStart Vancouver"
   → Wait 5 seconds
   WebFetch: [CEO profile URL]
   → Sarah Chen, CEO

   WebSearch: "site:linkedin.com/in CTO TechStart Vancouver"
   → Wait 5 seconds
   WebFetch: [CTO profile URL]
   → Michael Park, CTO

   WebSearch: "site:linkedin.com/in CFO TechStart Vancouver"
   → Wait 5 seconds
   WebFetch: [CFO profile URL]
   → Jennifer Wu, CFO

3. CREATE IN HUBSPOT:
   create_hubspot_company({ ... all company details ... })
   → Company ID: 12345

   create_hubspot_contact({ ... Sarah Chen ... })
   → Contact ID: 67890
   associate_contact_with_company(67890, 12345)

   create_hubspot_contact({ ... Michael Park ... })
   → Contact ID: 67891
   associate_contact_with_company(67891, 12345)

   create_hubspot_contact({ ... Jennifer Wu ... })
   → Contact ID: 67892
   associate_contact_with_company(67892, 12345)

4. PRESENT RESULTS:
   📊 TechStart Inc - Leadership Team Research Complete

   COMPANY:
   - Industry: AI/ML Consulting
   - Size: 25-50 employees
   - Location: Vancouver, BC
   - Website: techstart.io
   - LinkedIn: https://linkedin.com/company/techstart-innovations

   LEADERSHIP TEAM:
   ✅ Sarah Chen, CEO
      Email: sarah.chen@techstart.io (pattern matched)
      LinkedIn: [profile URL]
      Location: Vancouver, BC

   ✅ Michael Park, CTO
      Email: michael.park@techstart.io (pattern matched)
      LinkedIn: [profile URL]
      Location: Vancouver, BC

   ✅ Jennifer Wu, CFO
      Email: jennifer.wu@techstart.io (pattern matched)
      LinkedIn: [profile URL]
      Location: Vancouver, BC

   ✅ All records created in HubSpot
   ✅ All contacts linked to company record

   HubSpot Company: https://app.hubspot.com/contacts/21088260/record/0-2/12345

   Next steps: Ready for outreach. Would you like me to draft introduction emails for each executive?
```

## Email Pattern Matching

### Common Email Patterns

When email addresses aren't publicly listed, use these standard patterns:

**Pattern 1: Dot Separator (Most Common)**
- `firstname.lastname@domain.com`
- Example: `john.smith@acmefoods.ca`

**Pattern 2: No Separator**
- `firstnamelastname@domain.com`
- Example: `johnsmith@acmefoods.ca`

**Pattern 3: First Initial + Last Name**
- `firstinitiallastname@domain.com`
- Example: `jsmith@acmefoods.ca`

**Pattern 4: First Name Only (Small Companies)**
- `firstname@domain.com`
- Example: `john@acmefoods.ca`

### Email Confidence Scoring

**Always mark pattern-matched emails as:**
- ⚠️ **MEDIUM confidence (70%)**
- Source: "Pattern matched from name and domain"
- Action: Suggest verification during outreach

**Include in notes:**
```
"Email address is pattern-matched based on common formats.
Verify during first outreach. Alternative formats to try:
- john.smith@acmefoods.ca
- jsmith@acmefoods.ca
- john@acmefoods.ca"
```

## LinkedIn + Other Sources = Complete Profile

### Multi-Source Research Strategy

Don't rely on LinkedIn alone. Combine with:

**1. Company Website**
- Team/About pages for names and titles
- Contact pages for email addresses
- News/Press releases for recent hires

**2. Business Registries**
- Legal business names
- Incorporation dates
- Registered addresses

**3. News Articles**
- Executive appointments
- Company milestones
- Industry recognition

**4. Industry Directories**
- Trade association listings
- Chamber of commerce members
- Professional organization directories

### Triangulation for Confidence

Use multiple sources to increase confidence:

```
Finding: John Smith is CFO at Acme Foods

Sources:
✅ LinkedIn profile shows "CFO at Acme Foods" (80% confidence)
✅ Company website lists "John Smith, Chief Financial Officer" (90% confidence)
✅ News article from 2023: "Acme Foods appoints John Smith as CFO" (85% confidence)

Combined Confidence: ✅ HIGH (95%)
Action: Populate HubSpot immediately with all details
```

## Quick Reference Checklist

**Finding Company Pages:**
- [ ] WebSearch: "site:linkedin.com/company [company name]"
- [ ] WebFetch top result
- [ ] Extract: industry, size, location, description
- [ ] Update HubSpot with LinkedIn URL

**Finding Individual Profiles:**
- [ ] WebSearch: "site:linkedin.com/in [role] [company]"
- [ ] WebFetch profile URL
- [ ] Verify company matches target
- [ ] Extract name, title, location
- [ ] Pattern match email (mark MEDIUM confidence)
- [ ] Create contact in HubSpot
- [ ] Link contact to company

**Rate Limiting:**
- [ ] Wait 5 seconds between LinkedIn WebFetch calls
- [ ] If blocked: wait 60 seconds, slow down to 10-second intervals
- [ ] For bulk operations: use conservative 10-second delays

**Data Quality:**
- [ ] Verify all extracted data matches target company
- [ ] Mark pattern-matched emails as MEDIUM confidence
- [ ] Cross-reference with other sources when possible
- [ ] Include LinkedIn URLs in all HubSpot records

---

**LinkedIn is a goldmine for lead research - use it strategically, respect rate limits, and always verify information across sources.**

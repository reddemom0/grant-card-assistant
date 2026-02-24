# Pre-Chat Form Gate - Implementation Summary

## Overview

Complete implementation of a pre-chat form gate for the lead-gen agent that collects contact and company information before allowing access to the chat, with background web scraping and AI extraction to enrich the conversation context.

## Components Created

### 1. **Form Component** (`lead-gen-with-form.html`)

**Features:**
- Modal overlay that appears on page load (cannot be dismissed)
- Four required fields:
  - Your Name (text)
  - Email (validated format)
  - Company Name (text)
  - Company Website (URL - normalizes with/without https://)
- "I don't have a website yet" checkbox:
  - Shows educational message with link to getgranted.io
  - Blocks form submission (no chat access without website)
- Clean, minimal design matching Granted branding (dark green #1B6B4A, white)
- No close button, no click-outside-to-close
- Submit button: "Get My Grant Estimate"

**Form Validation:**
- Email regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- URL normalization: Adds `https://` if missing, validates format
- Visual error states with red borders and error messages

**Flow:**
1. Form appears on page load (chat hidden)
2. User fills form and submits
3. Loading state: "Starting your session..."
4. POST to `/api/lead-gen/init` creates session
5. Form hides, chat appears
6. Auto-init: sends silent "hello" to get opening message

### 2. **Database Migration** (`migrations/015_add_prechat_form_fields.sql`)

Adds three columns to `lead_gen_conversations`:
- `company_name` TEXT
- `company_website` TEXT
- `company_background` JSONB (default `{}`)

**Indexes:**
- `idx_lead_gen_company_name` for company lookups

### 3. **Form Submission Endpoint** (`src/api/lead-gen-init.js`)

**POST `/api/lead-gen/init`**

**Request:**
```json
{
  "contact_name": "Sarah Chen",
  "email": "sarah@laterallabs.ca",
  "company_name": "Lateral Labs",
  "company_website": "https://laterallabs.ca"
}
```

**Response:**
```json
{
  "success": true,
  "session_id": "uuid-here"
}
```

**Process:**
1. Validates input (required fields, email format)
2. Rate limiting: Max 50 sessions per IP per hour
3. Creates lead-gen session with form data in database
4. **Background (non-blocking):** Fetches company website and extracts info via Haiku
5. Returns session ID immediately (doesn't wait for extraction)

**Background Web Fetch + Extraction:**
- Fetches company website with 5-second timeout
- Strips HTML tags, scripts, styles
- Limits to 8K characters for Haiku
- Calls Claude 3.5 Haiku to extract:
  - `description`: 1-2 sentence summary
  - `industry`: Best guess (e.g., Technology, Manufacturing)
  - `location`: City, province if found
  - `estimated_team_size`: Number or range (e.g., "5-10", "20+")
  - `products_services`: Brief list of offerings
- Saves to `company_background` JSONB field
- Fully non-blocking: Chat never waits for this

### 4. **Context Injection** (`src/utils/lead-gen-context.js`)

**Helper function:** `getLeadGenFormContext(conversationId)`

**Returns formatted context string:**
```
<lead_info>
Name: Sarah Chen
Email: sarah@laterallabs.ca
Company: Lateral Labs
Website: https://laterallabs.ca
</lead_info>

<company_background>
Description: Digital product studio specializing in custom web and mobile app development
Industry: Software / Technology Services
Location: Vancouver, BC
Estimated Team Size: 12-15
Products/Services: Custom web apps, mobile development, UX design
</company_background>
```

**If extraction failed or timed out:**
```
<company_background>
Could not extract company information from website. Proceed with standard discovery.
</company_background>
```

**Integration point:** `src/claude/client.js`
- Import: `import { getLeadGenFormContext } from '../utils/lead-gen-context.js';`
- Load after line 115 (after learning memory)
- Inject into system blocks after line 379 (NOT CACHED - conversation-specific)

See `patches/client-js-lead-gen-context-injection.md` for exact code changes.

### 5. **HubSpot Integration** (Existing - No Changes Needed)

The existing finalization code already uses:
- `session.contact_name` (splits into firstname/lastname)
- `session.contact_email` (creates/updates contact)
- `prospectData.company_name` (creates/updates company)

**Enhancement to add:** `company_website` field to HubSpot company creation (optional)

```javascript
// In lead-gen-finalization.js, line 387:
const companyData = {
  name: prospectData.company_name,
  lifecyclestage: 'lead',
  country: 'Canada',
  website: session.company_website  // ADD THIS LINE
};
```

## Agent Behavior

**What the agent sees:**
- Lead name, email, company, website at start of conversation
- Extracted company background (if available)

**What the agent does:**
- Uses this information to ask smarter questions
- Skips basic discovery that's already known
- **NEVER references the website or form directly** (per system prompt instructions)
- Proceeds with existing conversation flow (discovery → estimate → CTA)

## Deployment Steps

### 1. Run migration on Railway
```bash
# Add migration to server.js startup (auto-migration pattern)
# OR run manually:
railway run node scripts/run-migration.js migrations/015_add_prechat_form_fields.sql
```

### 2. Add endpoint to server.js
```javascript
// Import
import { handleLeadGenInit } from './src/api/lead-gen-init.js';

// Route (add after line 245, before /api/lead-gen/chat)
app.post('/api/lead-gen/init', handleLeadGenInit);
```

### 3. Apply client.js patches
Follow instructions in `patches/client-js-lead-gen-context-injection.md`:
- Add import at top
- Load context after learning memory (after line 115)
- Inject into system blocks (after line 379)

### 4. Replace lead-gen.html
```bash
mv lead-gen.html lead-gen-old.html
mv lead-gen-with-form.html lead-gen.html
```

### 5. (Optional) Add website to HubSpot company
In `src/api/lead-gen-finalization.js` line 387, add:
```javascript
website: session.company_website
```

### 6. Deploy to Railway
```bash
git add .
git commit -m "Add pre-chat form gate with background company extraction"
git push origin railway-migration
```

## Testing Checklist

- [ ] Form appears on page load, chat hidden
- [ ] Form validation works (email, URL)
- [ ] "No website" checkbox blocks submission with message
- [ ] Form submits and creates session
- [ ] Chat appears after form submission
- [ ] Background extraction runs (check logs for Haiku call)
- [ ] Context injected into agent system prompt (check logs)
- [ ] Agent uses context naturally in conversation
- [ ] Agent never mentions website or form explicitly
- [ ] HubSpot lead creation includes form data (name, email, company, website)

## Files Created/Modified

**New Files:**
- `lead-gen-with-form.html` - Form component
- `migrations/015_add_prechat_form_fields.sql` - Database migration
- `src/api/lead-gen-init.js` - Form submission endpoint
- `src/utils/lead-gen-context.js` - Context injection helper
- `patches/client-js-lead-gen-context-injection.md` - Integration guide

**Files to Modify:**
- `server.js` - Add endpoint route
- `src/claude/client.js` - Add context injection (3 changes, see patch file)
- `src/api/lead-gen-finalization.js` - (Optional) Add website to HubSpot company

## Key Design Decisions

1. **Form is required, not optional** - No way to bypass it
2. **No website = no chat** - Enforces business eligibility requirement
3. **Background extraction is non-blocking** - Chat starts immediately, extraction happens async
4. **5-second timeout** - Chat never waits more than 5s for extraction
5. **Context is NOT cached** - It's conversation-specific and injected fresh each turn
6. **Agent never references form** - Context is used naturally, not explicitly mentioned
7. **HubSpot sync unchanged** - Existing contact/company creation already uses form fields
8. **Haiku for extraction** - Fast, cheap ($0.25/MTok), good enough for basic info extraction
9. **Rate limiting enforced** - Max 50 sessions per IP per hour (same as before)

## Cost Impact

**Haiku extraction:**
- ~8K characters website content → ~2K tokens
- Haiku cost: $0.25/MTok input + $1.25/MTok output
- Per extraction: ~$0.0005 input + $0.0006 output = **~$0.0011 per lead**

**Negligible cost increase** (lead quality improvement far outweighs cost)

## Next Steps

Ready for your approval to:
1. Run migration on Railway
2. Apply changes to server.js and client.js
3. Replace lead-gen.html with form version
4. Deploy and test

Let me know if you'd like me to proceed or if you want to review any component first!

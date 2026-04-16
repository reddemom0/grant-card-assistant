# Skill Conventions for Grant-Card-Assistant

**Purpose:** This document provides the conventions for building and integrating skills into the Oracle (internal-oracle agent) and other agent systems. Use this as a reference when creating a new skill like `granted-marketing` invoked via `/marketing`.

---

## 1. File Structure & Naming

### Location
- All skills live in: `.claude/skills/{skill-name}/`
- No skills exist outside this directory

### Single vs. Multi-File
Skills can be either:

**Single-file skills:**
- One focused domain with lightweight guidance
- Example: `.claude/skills/bcafe-writer/FINAL_REPORT.md` (just one file for one task)

**Multi-file skills (the standard):**
- Multiple `.md` files with clear hierarchy
- One overview/entry file (`SKILL.md`)
- Specialized sub-skill files (e.g., `ELIGIBILITY.md`, `MATCHING.md`, `VALIDATION.md`)
- Example structure:
  ```
  .claude/skills/sales-consultant/
    SKILL.md                 # Entry point with decision tree
    LEAD_FARMING.md          # Sub-skill #1
    LINKEDIN_ENRICHMENT.md   # Sub-skill #2
    DATA_QUALITY.md          # Sub-skill #3
    ICP_ANALYSIS.md          # Sub-skill #4
    scripts/
      README.md              # Supporting tooling reference
  ```

### Naming Convention
- Directory name: lowercase with hyphens (`granted-marketing`, `sales-consultant`, `canexport-writer`)
- File names: UPPERCASE with underscores or UPPERCASE_CASE (`SKILL.md`, `STAGE_1_READINESS.md`, `DEAL_CREATION.md`)
- API references: lowercase with underscores (`lead_farming`, `data_quality`, `granted_marketing`)

---

## 2. Frontmatter & Metadata

### Optional: YAML Frontmatter (seen in `sales-consultant/SKILL.md`)

Some skills include YAML frontmatter at the top for machine-readable metadata:

```yaml
---
name: sales-consultant
description: Sales & Lead Generation Expert - Create, enrich, and qualify sales leads using HubSpot, LinkedIn research, and data quality best practices
triggers:
  - lead generation
  - lead farming
  - linkedin enrichment
  - sales research
  - create leads
  - enrich company
  - find decision makers
  - data quality
  - deduplicate
category: sales
---
```

**Fields observed:**
- `name` — skill identifier (matches directory name)
- `description` — one-liner explaining the skill's purpose
- `triggers` — list of natural language phrases that suggest when to load this skill
- `category` — domain category (e.g., `sales`, `grants`, `writing`)

**Note:** This frontmatter is **optional**. Not all skills use it. The HubSpot skill (`DEAL_CREATION.md`) does not include frontmatter.

### Invocation Declaration

Invocation is declared **in the agent's system prompt** (e.g., `internal-oracle.md`), not in the skill file itself. The agent explicitly lists which skills are available and which `load_skill()` triggers load them.

Example from `internal-oracle.md`:
```
**HubSpot (`skill_name="hubspot"`):**
- `sub_skill="DEAL_CREATION"` - Full deal creation workflow
```

---

## 3. Tool Declaration & Invocation

### Tool Registration Pattern

Tools are **not registered in skill files**. Instead:

1. **Tool definitions live in:** `src/tools/{tool-name}.js`
   - Example: `src/tools/hubspot.js`, `src/tools/load-skill.js`

2. **Tool loading registry:** `src/tools/load-skill.js`
   - Maps skill names to file paths
   - Central registry for all loadable skills

```javascript
const SKILL_PATHS = {
  sales: {
    lead_farming: '.claude/skills/sales-consultant/LEAD_FARMING.md',
    linkedin_enrichment: '.claude/skills/sales-consultant/LINKEDIN_ENRICHMENT.md',
    data_quality: '.claude/skills/sales-consultant/DATA_QUALITY.md',
    icp_analysis: '.claude/skills/sales-consultant/ICP_ANALYSIS.md'
  },
  hubspot: {
    DEAL_CREATION: '.claude/skills/hubspot/DEAL_CREATION.md'
  }
  // New skills added here
};
```

### Tool Invocation in Skills

Skills **reference existing tools** but don't define them. Tools are invoked by the agent that loads the skill.

**HubSpot Skill Example:**
The `DEAL_CREATION.md` skill tells you *which tools to use* and *when*:

```markdown
### 4.1 Company association (REQUIRED)

1. Use `search_hubspot_companies` to look up the company by name.
2. If exactly one match is found → use that company's ID.
3. If multiple matches are found → show the team member the list and ask which one. Do NOT guess.
4. If no match is found → ask the team member whether to create the company. If yes, use `create_hubspot_company`...
```

The skill **prescribes the workflow** (search first, then create if needed). The agent **executes the tool calls**.

### Validation Layer (Guardrails)

The HubSpot skill demonstrates a **two-phase validation pattern** to prevent hallucination:

**Phase 1 — Payload assembly (no tool calls yet)**
- Gather information from the user
- Ask clarifying questions
- Build the full payload object
- **Show the payload to the user for explicit approval**

**Phase 2 — Tool execution (only after approval)**
- User says "yes, create it"
- Only *then* call `create_hubspot_deal` with the approved payload
- Return the actual result to the user

This prevents the skill from:
- Claiming a tool was called when it wasn't
- Returning a fake link or fake deal ID
- Simulating success without actual tool execution

**Critical rule from Section 0.1 of DEAL_CREATION.md:**

```
Never simulate a tool call

If you are about to write "Deal created successfully" or "I've created the deal" or any 
equivalent confirmation, you MUST have just called the `create_hubspot_deal` tool in the 
same turn and received its return value. There is no other path that produces a real deal.

If you respond with a success message without calling the tool:
- The deal does NOT exist in HubSpot.
- You have lied to the user.
```

---

## 4. Guardrails Against Hallucination

### What the Problem Was

In early testing of the HubSpot skill, the AI:
- Said "I've created the deal" without calling `create_hubspot_deal`
- Generated a fake HubSpot link
- Left the user discovering the failure later

### Structural Changes (Commits v1.2.1 → v1.3)

**Commit 5277eb1 ("v1.2.1 post-acceptance-test fixes"):**

Added **explicit auditability requirements** for batch mode:

```markdown
§8.2.1: Auditability requirement. For every Excel-serial date Oracle normalizes, 
narrate the full arithmetic in the dry-run preview.

Example: "Start Date: 2026-06-01 (normalized from Excel serial 46174: 
1899-12-30 + 46174 days = 2026-06-01)"

This lets the team member catch off-by-N errors before they commit.
```

Also added **narration rules for ambiguous enum values:**

```markdown
§6.1: When Oracle references one of the three trailing-whitespace `grant_type`s 
in a dry-run preview, the narration must be unambiguous about preservation.

Correct narration: "Grant Type: `Eco-Canada - Science/Tech ` 
(preserved exactly, including the trailing whitespace that HubSpot's enum stores)"

The "mapped from X to Y" narration format is reserved for genuine label→internal-value 
mismatches (e.g., "Bio Talent SWPP" → `Bio Talent`).
```

**Commit e9b2e0b ("v1.3 live-test fixes"):**

Introduced **human-readable prose previews** (not JSON):

```markdown
§9.0: Dry-run preview format — human-readable prose, not JSON.

Write the preview the way a colleague would describe the deal at a team stand-up: 
short sentences, real names and dates spelled out, dollar amounts with currency symbols, 
grant programs referred to by their friendly names.

Do NOT:
- Paste raw JSON
- Show property API names (`participant_name`, `grant_coordinator`, `dealstage`)
- Show internal IDs (pipeline IDs, stage IDs, owner IDs)

The team member is confirming a deal, not reviewing a payload — your job is to make 
the intent unambiguous in their language.
```

Removed `amount` from required fields on Hiring/Training pipelines:

```markdown
§0.2: On `amount` specifically: do not set this field on Hiring or Training deal 
creation — HubSpot's workflow populates it automatically (see §5.4). 
You do not need to ask for it, and you do not need to derive it.
```

This prevents the AI from **inventing numbers** and passing them to the CRM.

### The Core Prevention Pattern

**All writable skills follow this flow:**

1. **Never fabricate user-providable data** (§0.2 of DEAL_CREATION)
   - If a numeric field is required and the user hasn't provided it, **ask**
   - Do not compute, estimate, or pull from memory
   - Exception: derivations are allowed *only if shown in the preview with full formula visible*

2. **Preview before committing** (§6 of DEAL_CREATION batch mode)
   - Assemble the full payload
   - Show it to the user in human-readable prose
   - Get explicit confirmation ("yes, create it")
   - Only *then* call the write tool

3. **Never claim success without the tool call** (§0.1 of DEAL_CREATION)
   - Success message ⟺ tool result received in same turn
   - No exceptions, no matter how the conversation flows

---

## 5. Input Handling & Clarifying Questions

### Pattern: Establish Context First

From HubSpot `DEAL_CREATION.md` Section 0.3:

```
Service tier is Step 0 of every deal-creation conversation.

Before you ask any other question, before you search for the company, 
before you load any field requirements — establish whether the client 
is on the Granted Starter service tier or the main Granted Consulting tier.

If the user does not state the service tier in their initial request, 
your first response must be a clarifying question: 
"Is [Company] a Granted Starter client or a main-tier client?"
```

### Pattern: Always-Ask vs. Default Fields

The HubSpot skill defines three buckets:

**Bucket 1 — Always apply default:**
- Defaults are safe because they're policy-defined (never user-dependent)
- Example: `grant_reliant = "Yes"` for most Hiring deals (HubSpot policy)
- Reason: No ambiguity, safe to apply without asking

**Bucket 2 — Always ask:**
- These fields have no safe default
- Missing from input → ask the user
- Example: `client_reimbursement` (amount approved by grant program)
- Reason: User-dependent; only they know the approved funding

**Bucket 3 — Derive or override:**
- User can provide a value *or* the system can derive it
- Example: `dealname` can be auto-constructed from parts if template is known
- Reason: Known formula with clear pattern

---

## 6. Invocation & Loading

### How the Oracle Knows About Skills

Skills are registered in the **agent system prompt** (e.g., `internal-oracle.md`):

```markdown
## Specialized Skills

For **specialized analysis or creation tasks** → Load relevant skill first using the `load_skill` tool

### Available Skills

**Sales (`skill_name="sales"`):**
- `sub_skill="lead_farming"` - Complete lead creation & enrichment workflow
- `sub_skill="linkedin_enrichment"` - LinkedIn research strategies

**Grants (`skill_name="grants"`):**
- `sub_skill="eligibility"` - Eligibility analysis framework
- `sub_skill="matching"` - Client-to-program matching methodology

**HubSpot (`skill_name="hubspot"`):**
- `sub_skill="DEAL_CREATION"` - Full deal creation workflow
```

### Mandatory Skill Loading Pattern

For deal creation specifically (from `internal-oracle.md`):

```markdown
The moment a user's message mentions creating a deal (single or batch), 
your **very first tool call** must be `load_skill(skill_name="hubspot", sub_skill="DEAL_CREATION")`.

Not after the first text response. Not after gathering context. 
Not after parsing the spreadsheet. First thing.

Triggers that require an immediate skill load:
- "create a deal," "add a deal," "set up a deal"
- User uploads a spreadsheet of hiring/training/grant data
```

### Skill Loading via `load_skill` Tool

Implemented in `src/tools/load-skill.js`:

```javascript
export async function loadSkill({ skill_name, sub_skill }) {
  // Validates skill exists
  // Reads the markdown file from filesystem
  // Returns { success, skill_name, sub_skill, file_path, content, token_estimate }
}
```

Example agent invocation:
```
load_skill(skill_name="grants", sub_skill="eligibility")
```

Returns the full markdown content of `.claude/skills/grants-consultant/ELIGIBILITY.md`.

### Registration Checklist for a New Skill

To add `granted-marketing` skill:

1. **Create directory:**
   ```
   .claude/skills/granted-marketing/
   ```

2. **Create entry point file:**
   ```
   .claude/skills/granted-marketing/SKILL.md
   ```

3. **Create sub-skill files (optional but recommended):**
   ```
   .claude/skills/granted-marketing/CAMPAIGN_STRATEGY.md
   .claude/skills/granted-marketing/CONTENT_CREATION.md
   .claude/skills/granted-marketing/MESSAGING.md
   ```

4. **Register in `src/tools/load-skill.js`:**
   ```javascript
   const SKILL_PATHS = {
     // ... existing skills
     'granted-marketing': {
       overview: '.claude/skills/granted-marketing/SKILL.md',
       CAMPAIGN_STRATEGY: '.claude/skills/granted-marketing/CAMPAIGN_STRATEGY.md',
       CONTENT_CREATION: '.claude/skills/granted-marketing/CONTENT_CREATION.md',
       MESSAGING: '.claude/skills/granted-marketing/MESSAGING.md'
     }
   };
   ```

5. **Document in agent's system prompt** (e.g., `internal-oracle.md`):
   ```markdown
   **Marketing (`skill_name="granted-marketing"`):**
   - `sub_skill="overview"` - Marketing strategy and capability overview
   - `sub_skill="CAMPAIGN_STRATEGY"` - Campaign planning and execution
   - `sub_skill="CONTENT_CREATION"` - Content development best practices
   - `sub_skill="MESSAGING"` - Brand messaging and positioning
   ```

6. **Update agent prompt to trigger the skill** (if immediate loading is needed):
   ```markdown
   When asked to: "Create a marketing campaign" or "Draft marketing content"
   → `load_skill(skill_name="granted-marketing", sub_skill="overview")`
   ```

---

## 7. Naming Conventions

### Slash Commands
- Format: `/lowercase-with-hyphens` or `/lowercase_with_underscores`
- Observed examples: `/marketing`, `/hubspot`
- Not enforced in skills; invocation is agent-dependent

### Skill Directory Names
- Format: `lowercase-with-hyphens`
- Examples: `sales-consultant`, `canexport-writer`, `granted-marketing`
- Must match in `load-skill.js` registry

### Skill Names (in `load_skill()` calls)
- Format: `lowercase-with-hyphens` or `lowercase_with_underscores`
- Example: `load_skill(skill_name="granted-marketing", ...)`
- Matches directory name

### Sub-Skill Names
- Format: `lowercase_with_underscores` or `UPPERCASE_WITH_UNDERSCORES`
- Examples: `lead_farming`, `DEAL_CREATION`, `CAMPAIGN_STRATEGY`
- Can mix cases; used as-is in `load_skill()` calls

### Reserved Names
- Avoid: `system`, `prompt`, `config` (likely reserved in future)
- Avoid: names matching agent names (`internal-oracle`, `canexport-writer`)
- Avoid: generic names without context (`writing`, `strategy` — use `granted-marketing-strategy` instead)

---

## 8. Examples & Reference Content

### Approach: Inline, Worked Examples

Skills include worked examples **inline**, not in separate files. The skill file IS the reference.

**From HubSpot DEAL_CREATION.md, Section 9.1 (Worked Example):**

```markdown
### 9.1 Worked Example: Batch Mode with LVS Template

Team member uploads a spreadsheet with:
- 5 new WorkBC hires from last month
- Multiple date formats (Excel serial, DD/MM/YYYY, ISO)
- All with the same company (TechCorp) but different candidates
- Missing one grant_coordinator assignment

Oracle's response:

Step 1 — validate batch structure
[Oracle checks header row, data range, column names]

Step 2 — validate row-level syntax
[Oracle checks each row for type validity]

Step 3 — resolve company associations
[Oracle finds TechCorp in HubSpot, gets company ID]

Step 4 — resolve missing fields
"Step 4 — Unresolved fields: grant_coordinator is blank in rows 1, 3, and 5. 
Which coordinator should I assign to these rows?"

[Team member responds: "All three are with Sarah Chen"]

Step 5 — ask for blocking issues
[Oracle applies grant_coordinator = "Sarah Chen ID" to rows 1, 3, 5]

Step 6 — dry-run preview
✅ Ready to create: 5 rows
Row 1: WorkBC hire - Alice Johnson starts 2026-05-15, TechCorp, Hiring grant, $45K client reimbursement
Row 2: WorkBC hire - Bob Smith starts 2026-05-22, TechCorp, Hiring grant, $48K client reimbursement
...

All ready? Respond "yes" to create all 5 deals.

[Team member responds: "Go ahead"]

Step 7 — execute batch create
[Oracle calls create_hubspot_deal for each row]

✅ Created 5 deals:
Deal 1: https://app.hubspot.com/contacts/21088260/record/0-3/[deal-id-1]
Deal 2: https://app.hubspot.com/contacts/21088260/record/0-3/[deal-id-2]
...
```

### Approach: No Separate Template Files

Skills do NOT include template files. Reasons:
1. Templates live in HubSpot, Google Drive, or Dropbox (source of truth)
2. Skill files stay focused on methodology, not data
3. Keeps skill files concise

---

## 9. Inconsistencies & Observed Patterns

### Known Variations

**1. Frontmatter usage:**
- `sales-consultant/SKILL.md` includes YAML frontmatter
- `hubspot/DEAL_CREATION.md` does NOT
- **Recommendation:** Optional; use if skill needs machine-readable metadata (triggers, category)

**2. Entry point naming:**
- Most multi-file skills use `SKILL.md` as the overview
- HubSpot skill uses the skill directly (`DEAL_CREATION.md` with no separate overview)
- **Recommendation:** Use `SKILL.md` for overview + decision tree, especially for skills with 3+ sub-files

**3. Sub-skill naming:**
- Grants skill uses lowercase with underscores (`eligibility`, `matching`, `validation`)
- CanExport skill uses UPPERCASE with underscores (`STAGE_1_READINESS`, `STAGE_2_DRAFTING`)
- HubSpot skill uses mixed (`DEAL_CREATION`)
- **Recommendation:** Adopt one convention. Suggest lowercase for simple concepts, UPPERCASE for formal/stage-based workflows

**4. Skill loading triggers:**
- Some agents check the user's message and decide whether to load
- HubSpot skill loading is *mandatory* on any deal-creation mention (per `internal-oracle.md`)
- **Recommendation:** For writable operations, make loading mandatory. For read-only analysis, make it optional

**5. Tool invocation pattern:**
- HubSpot skill prescribes *which* tools to call and *when*
- Grants skill prescribes *methodology*, not specific tools
- Sales skill mixes both (some tools prescribed, some left to agent judgment)
- **Recommendation:** Prescribe tools for critical operations (writes, data mutations); use methodology for analysis

### Potential Improvements

**Inconsistency 1: No unified sub-skill naming**
- Recommendation: Agree on one convention (lowercase or UPPERCASE) and enforce in `load-skill.js` validation

**Inconsistency 2: No metadata standardization**
- Recommendation: Decide if frontmatter is always required, never used, or optional; document the choice

**Inconsistency 3: Skill loading is agent-specific**
- Currently: Each agent decides which skills to load
- Better: Define a central "trigger registry" that maps skill names to natural language triggers
- This would let new agents inherit the same skill-loading logic

---

## 10. Concrete Recommendation: `granted-marketing` Skill

Based on observed patterns, here's the exact structure for the new skill:

### Directory Structure

```
.claude/skills/granted-marketing/
  SKILL.md                    # Entry point, decision tree, overview
  CAMPAIGN_STRATEGY.md        # Campaign planning & execution
  CONTENT_CREATION.md         # Content development best practices
  MESSAGING.md                # Brand messaging & positioning guidelines
  scripts/                    # (Optional) Supporting scripts or reference materials
    README.md
```

### SKILL.md Frontmatter

```yaml
---
name: granted-marketing
description: Marketing strategy, campaign planning, and content creation for Granted Consulting
triggers:
  - marketing campaign
  - marketing strategy
  - content creation
  - messaging
  - brand positioning
  - marketing content
category: marketing
---
```

### Entry Point Content Structure

`SKILL.md` should include:

1. **Quick capabilities overview** (what this skill does)
2. **Decision tree** (which sub-skill for which task)
3. **Links to detailed sub-skills** (load only what's needed)
4. **Available tools** (marketing research tools, HubSpot contact data, Google Drive access)
5. **Integration patterns** (with HubSpot, with internal documentation)

### Registration in `src/tools/load-skill.js`

```javascript
const SKILL_PATHS = {
  // ... existing skills
  'granted-marketing': {
    overview: '.claude/skills/granted-marketing/SKILL.md',
    CAMPAIGN_STRATEGY: '.claude/skills/granted-marketing/CAMPAIGN_STRATEGY.md',
    CONTENT_CREATION: '.claude/skills/granted-marketing/CONTENT_CREATION.md',
    MESSAGING: '.claude/skills/granted-marketing/MESSAGING.md'
  }
};
```

### Agent Integration in `internal-oracle.md`

Add to the **Available Skills** section:

```markdown
**Marketing (`skill_name="granted-marketing"`):**
- `sub_skill="overview"` - Marketing strategy, campaign planning, content creation overview
- `sub_skill="CAMPAIGN_STRATEGY"` - Campaign execution workflows and best practices
- `sub_skill="CONTENT_CREATION"` - Content development methodology and quality standards
- `sub_skill="MESSAGING"` - Brand messaging, positioning, and communication guidelines
```

Add to the **When to Load Skills** section:

```markdown
**Specialized tasks (Load skill first):**
- "Create a marketing campaign for [prospect]" → `load_skill(skill_name="granted-marketing", sub_skill="overview")`
- "Draft marketing content for CanExport" → `load_skill(skill_name="granted-marketing", sub_skill="CONTENT_CREATION")`
- "What's our messaging around Hiring grants?" → `load_skill(skill_name="granted-marketing", sub_skill="MESSAGING")`
```

### Invocation Pattern

Users invoke via the Oracle agent:
```
"Can you create a marketing campaign targeting BC tech companies for our Hiring grants?"
```

Oracle's response:
1. Recognizes "marketing campaign"
2. Calls `load_skill(skill_name="granted-marketing", sub_skill="overview")`
3. Loads the skill markdown
4. Guides the user through campaign creation (discovery → strategy → content → confirmation)

---

## 11. Questions for Chris

- **Slash command registration:** Are new skill slash commands auto-discovered or do they need to be registered somewhere?
- **Frontmatter:** Should all skills include YAML frontmatter, or is it truly optional?
- **Sub-skill naming:** Should we standardize on lowercase (lead_farming) or UPPERCASE (STAGE_1_READINESS)?
- **Tool creation:** Should new skills ever define new tools (with their own .js files), or do they always reference existing tools?
- **Skill loading triggers:** Should skill loading be automatic (if user says "marketing"), or always explicit (user must request)?
- **HubSpot deal-creation exceptions:** Should other skills that write to external systems (like granted-marketing writing social posts) follow the same validation pattern as DEAL_CREATION?

---

**End of Skill Conventions Document**

Generated for the grant-card-assistant codebase.
Last updated: 2026-04-16.

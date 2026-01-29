# CanExport Writer Skills Overview

You have access to specialized skills for different stages of the CanExport application lifecycle. Load only the skills you need for the current task to optimize performance.

## Available Skills

### Program Knowledge Skills
- `PROGRAM_DETAILS` - Full CanExport SME program details, eligibility requirements, expense categories, and compliance rules
- `APPLICATION_STRUCTURE` - Detailed breakdown of all 8 application sections with character limits and requirements
- `KNOWLEDGE_BASE_INDEX` - Index of available Google Drive knowledge base documents

### Stage 1: Readiness & Strategy Skills
- `STAGE_1_READINESS` - Preparedness assessment methodology using the 5-phase scoring rubric
- `STAGE_1_BUDGET_GUIDE` - Comprehensive guide for creating Budget Building Guides for clients
- `STAGE_1_INTERVIEW_QUESTIONS` - Template and methodology for generating Budget Review Interview Questions

### Stage 2: Drafting Skills
- `STAGE_2_DRAFTING` - Section-by-section application drafting guidance with character limits and best practices

### Stage 3: Review Skills
- `STAGE_3_REVIEW` - Application review and optimization methodology using program-specific criteria

## Decision Tree: Which Skills to Load?

### Initial Context Gathering (Always Start Here)
**No skills needed yet** - First clarify:
1. What's the client company name? (check HubSpot)
2. Where is project at? (readiness/drafting/review)
3. What deliverable is needed today?
4. What's today's date and submission deadline?

After understanding context, load appropriate skills:

### If Team Member Asks About Program Rules/Eligibility
→ Load: `PROGRAM_DETAILS`

### If Team Member Asks: "What documents do we have in the knowledge base?"
→ Load: `KNOWLEDGE_BASE_INDEX`

### If Task is: Assess Client Readiness
→ Load: `STAGE_1_READINESS`
→ Also consider: `PROGRAM_DETAILS` (for eligibility validation)

### If Task is: Create Budget Building Guide
→ Load: `STAGE_1_BUDGET_GUIDE`
→ Also need: Budget Template, completed RA, transcript (from Drive)

### If Task is: Generate Budget Review Interview Questions
→ Load: `STAGE_1_INTERVIEW_QUESTIONS`
→ Also need: Client's completed budget spreadsheet (from Drive)

### If Task is: Draft Application Section(s)
→ Load: `STAGE_2_DRAFTING`
→ Also load: `APPLICATION_STRUCTURE` (for character limits reference)
→ Also need: Budget, RA, Interview responses (from Drive or conversation history)

### If Task is: Review/Optimize Draft Application
→ Load: `STAGE_3_REVIEW`
→ Also load: `APPLICATION_STRUCTURE` (for section requirements)

### If Task Spans Multiple Stages
Load skills as you progress through stages (don't load everything at once):
1. Start with readiness → Load `STAGE_1_READINESS`
2. When moving to drafting → Load `STAGE_2_DRAFTING`
3. When reviewing → Load `STAGE_3_REVIEW`

## Skill Loading Syntax

Use the `load_skill` tool with these exact skill names:

```
load_skill("canexport-writer:PROGRAM_DETAILS")
load_skill("canexport-writer:STAGE_1_READINESS")
load_skill("canexport-writer:STAGE_1_BUDGET_GUIDE")
load_skill("canexport-writer:STAGE_1_INTERVIEW_QUESTIONS")
load_skill("canexport-writer:STAGE_2_DRAFTING")
load_skill("canexport-writer:STAGE_3_REVIEW")
load_skill("canexport-writer:APPLICATION_STRUCTURE")
load_skill("canexport-writer:KNOWLEDGE_BASE_INDEX")
```

## When NOT to Load Skills

- During initial context gathering (clarifying project details)
- When answering simple yes/no questions
- When just confirming next steps
- When team member is still deciding what they need

**Load skills just-in-time** when you're about to perform the actual work that requires that expertise.

# Program Card Generation Guide

This guide explains how to use the card generation pipeline to create structured program cards from raw Dropbox documentation.

## What It Does

The card generator reads all files in a program's Dropbox folder (PDFs, Word docs, spreadsheets, text files) and uses Claude AI to:

1. Extract program information (eligibility, application steps, forms, claims, etc.)
2. Anonymize client-specific details
3. Structure everything into a standardized program card format
4. Output a draft markdown file ready for review

## Prerequisites

- Node.js installed
- `ANTHROPIC_API_KEY` set in `.env` file
- Program documentation folder ready (PDFs, DOCX, XLSX, TXT, etc.)
- Example cards available in `programs/` folder (used as references)

## Usage

### Basic Command

```bash
node scripts/generate-program-card.js \
  --program "Program Name" \
  --folder /path/to/program/documentation
```

### Examples

**Generate a WorkBC card from Dropbox folder:**
```bash
node scripts/generate-program-card.js \
  --program "WorkBC Wage Subsidy" \
  --folder /Users/Chris/Dropbox/WorkBC
```

**Generate ETG card with custom output path:**
```bash
node scripts/generate-program-card.js \
  --program "Employee Training Grant" \
  --folder /Users/Chris/Dropbox/ETG \
  --output /Users/Chris/Downloads/etg-draft.md
```

### Command Options

| Option | Required | Description |
|--------|----------|-------------|
| `--program` | ✅ Yes | Program name (e.g., "Digital WIL", "Canada Summer Jobs") |
| `--folder` | ✅ Yes | Path to folder containing program documentation |
| `--output` | ❌ No | Custom output path (defaults to `programs/generated/[program-id].md`) |

## Supported File Types

The script automatically reads:

- **PDF** (`.pdf`) - Application forms, guides, manuals
- **Word** (`.docx`, `.doc`) - Templates, instructions, examples
- **Excel/CSV** (`.xlsx`, `.xls`, `.csv`) - Checklists, calculations, data tables
- **Text** (`.txt`, `.md`) - Notes, plain text documentation

Files are read recursively from all subfolders. Hidden files (starting with `.` or `~$`) are skipped.

## What Gets Extracted

The generator looks for:

### Core Information
- **Program Overview** - What the program does, who it's for
- **Eligibility** - Employer and candidate requirements
- **Red Flags** - Common rejection reasons
- **Stacking Rules** - Can this be combined with other funding?

### Process Documentation
- **Vetting Questions** - Pre-application fit assessment
- **Document Checklist** - What's needed and when
- **Application Process** - Step-by-step instructions for Strategy + GCs
- **Post-Approval** - What happens after approval
- **Claims** - What's included/excluded, submission process

### Expert Knowledge
- **Financial Calculations** - MERCs, conversions, program-specific formulas
- **Program-Specific Rules** - Quirks, gotchas, special requirements
- **Best Practices** - Tips from experienced GCs, common mistakes
- **Pay Stub Verification** - What to check when reviewing claims

### Client-Facing Guidance
- **Form Walkthroughs** - Field-by-field instructions
- **Document Explanations** - What clients need to know about agreements, timesheets, etc.
- **Registration Instructions** - How to set up accounts, submit applications

## Anonymization

The script automatically anonymizes client-specific details:

- **Company names** → `[Company]` or generic descriptions
- **Dollar amounts** → Ranges (e.g., `$45,000` → `$40,000-$50,000`)
- **Contact info** → Removed (names, phone, email)
- **Business details** → Generalized (specific products → "manufacturing company")

## Output

### Default Location
`programs/generated/[program-id].md`

Example: `--program "WorkBC Wage Subsidy"` → `programs/generated/workbc-wage-subsidy.md`

### Draft Card Structure

The generated card follows this template:

1. Program metadata (ID, type, province, status, portal)
2. Program Overview
3. Eligibility (employer, candidate, red flags, stacking)
4. Vetting Questions
5. Document Checklist (pre/post/claims)
6. Application Process (Strategy + GC steps)
7. Post-Approval
8. Claims (included/excluded, process)
9. Financial Calculations
10. Application Content Templates
11. Program-Specific Rules & Quirks
12. Best Practices & Warnings
13. Pay Stub Verification Checklist
14. Form & Document Guidance (client-facing)

## Review Process

After generation:

1. **Read the draft** - Check for completeness and accuracy
2. **Verify anonymization** - Ensure no client-specific details remain
3. **Fill gaps** - Add missing information from your knowledge
4. **Add quirks** - Include program-specific gotchas not in the docs
5. **Test readability** - Would a GC or client understand this?
6. **Move to final location** - `programs/hiring/` or `programs/training/`

## Examples Used as Reference

The generator uses these 5 enriched cards as quality examples:

- `programs/hiring/workbc-wage-subsidy.md` (most comprehensive)
- `programs/hiring/digital-wil.md`
- `programs/hiring/venture-for-canada.md`
- `programs/hiring/unac-green-corps.md`
- `programs/hiring/welcoming-newcomers.md`

These cards include detailed "Form & Document Guidance" sections showing the quality bar for client-facing content.

## Troubleshooting

### "No readable files found in folder"
- Check folder path is correct
- Ensure files aren't all hidden (`.` prefix)
- Verify folder contains supported file types

### "Error reading PDF/DOCX"
- File may be corrupted
- Try opening file manually to verify it's readable
- Check file permissions

### Generated card missing sections
- Not enough information in source docs
- Add missing details manually after generation
- Consider adding more source documents to folder

### Card has client-specific details
- Anonymization may have missed some patterns
- Review and manually replace before finalizing
- Report patterns to improve anonymization logic

## Cost Estimate

Each card generation uses:
- **Model:** Claude Sonnet 4.5
- **Input:** ~50K-100K tokens (template + examples + docs)
- **Output:** ~10K-15K tokens (generated card)
- **Thinking:** ~5K-10K tokens (analysis)
- **Cost:** ~$2-4 per card

For 35 program cards: **~$70-140 total**

## Workflow for Scaling

To create cards for all 35 programs:

1. **Organize Dropbox folders** - One folder per program with all documentation
2. **Run generator for each program** - Use batch script if needed
3. **Review all drafts** - Quality check each generated card
4. **Finalize and move** - Move reviewed cards to `programs/hiring/` or `programs/training/`
5. **Update program registry** - Track which cards are complete

## Batch Processing Script

To generate multiple cards at once, create `scripts/batch-generate-cards.sh`:

```bash
#!/bin/bash

# WorkBC
node scripts/generate-program-card.js --program "WorkBC Wage Subsidy" --folder /path/to/WorkBC

# Digital WIL
node scripts/generate-program-card.js --program "Digital WIL" --folder /path/to/DigitalWIL

# Canada Summer Jobs
node scripts/generate-program-card.js --program "Canada Summer Jobs" --folder /path/to/CSJ

# ... etc for all 35 programs
```

## Next Steps

After generating program cards, they can be:

1. **Loaded by GetGranted 2.0 AI agent** - Dynamic knowledge retrieval
2. **Used for training** - Fine-tuning agent on program expertise
3. **Shared with team** - Reference guides for GCs and Strategy
4. **Updated over time** - Re-run generator when program rules change

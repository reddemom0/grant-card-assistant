# Sales Consultant HubSpot Scripts

This directory contains Python scripts for HubSpot operations that were removed from the Oracle's core toolset to reduce context usage.

The Sales Consultant Skill can execute these scripts via bash without loading them into context, allowing the Oracle to have full HubSpot functionality at zero token cost for script execution.

## Available Scripts

### Data Quality & Verification
- `verify_company_website.py` - Check if company website is still active
- `find_duplicate_companies.py` - Find duplicate company records
- `find_duplicate_contacts.py` - Find duplicate contact records
- `merge_duplicate_companies.py` - Merge duplicate company records
- `merge_duplicate_contacts.py` - Merge duplicate contact records

### Direct Lookups (Performance)
- `get_contact_by_email.py` - Fast contact lookup by email
- `get_company_by_domain.py` - Fast company lookup by domain
- `get_company_by_id.py` - Get company by HubSpot ID

### Team Management
- `list_hubspot_owners.py` - List all HubSpot team members/owners

### File Operations
- `get_deal_files.py` - Get files attached to deals
- `get_contact_files.py` - Get files attached to contacts
- `read_hubspot_file.py` - Read content of HubSpot file

### Email & Communication
- `get_project_email_history.py` - Get email history for project
- `search_project_emails.py` - Search emails by criteria
- `get_email_details.py` - Get detailed email information
- `get_email_attachments.py` - Get attachments from emails

### Grant Applications
- `search_grant_applications.py` - Search for grant application records
- `get_grant_application.py` - Get detailed grant application info

### Advanced Operations
- `load_company_context.py` - Load comprehensive company context
- `find_and_read_funding_agreement.py` - Find and retrieve funding agreements

## Usage

All scripts are designed to be called via bash from the Sales Consultant Skill:

```bash
# Example: Find duplicate companies
python3 .claude/skills/sales-consultant/scripts/find_duplicate_companies.py --domain "techstart.io"

# Example: Verify website
python3 .claude/skills/sales-consultant/scripts/verify_company_website.py --domain "acmefoods.ca"

# Example: List team owners
python3 .claude/skills/sales-consultant/scripts/list_hubspot_owners.py
```

## Environment Variables Required

All scripts require:
- `HUBSPOT_API_KEY` - HubSpot Private App API key

These should be set in your Railway environment or local `.env` file.

## Implementation Status

⚠️ **PLACEHOLDER SCRIPTS** ⚠️

These scripts are currently placeholders demonstrating the intended API structure. Full implementations will:

1. **Connect to HubSpot API** - Using the official HubSpot Python SDK or requests library
2. **Handle authentication** - Using environment variables for API keys
3. **Parse arguments** - Using argparse for command-line parameters
4. **Return JSON** - Structured output for easy parsing by the Oracle
5. **Handle errors gracefully** - Proper error messages and exit codes

## Integration with Sales Consultant Skill

When the Oracle needs to use these operations:

1. **Load Skill**: Oracle loads SKILL.md (~100 tokens)
2. **Load Guide**: Oracle loads relevant guide (DATA_QUALITY.md, etc.)
3. **Execute Script**: Oracle runs script via bash (0 context tokens)
4. **Parse Result**: Oracle processes JSON output and continues conversation

This pattern allows unlimited HubSpot operations without context bloat.

## Future Enhancements

- Full script implementations with HubSpot API integration
- Batch operation scripts for bulk updates
- Advanced filtering and search capabilities
- Integration with other CRM systems (Salesforce, Pipedrive)
- Caching layer for frequently accessed data
- Rate limiting and retry logic
- Comprehensive error handling and logging

## Contributing

When implementing new scripts:

1. Follow the naming convention: `operation_entity.py`
2. Use argparse for command-line arguments
3. Return JSON to stdout for easy parsing
4. Print errors to stderr
5. Use appropriate exit codes (0 = success, 1 = error)
6. Include --help documentation
7. Handle environment variables gracefully
8. Add to this README with usage examples

## Example Script Template

```python
#!/usr/bin/env python3
"""
Script Name: operation_entity.py
Description: Brief description of what this script does
"""

import os
import sys
import json
import argparse
from typing import Dict, Any

def main():
    parser = argparse.ArgumentParser(description="Description")
    parser.add_argument("--param", required=True, help="Parameter description")
    args = parser.parse_args()

    # Get API key from environment
    api_key = os.getenv("HUBSPOT_API_KEY")
    if not api_key:
        print(json.dumps({"error": "HUBSPOT_API_KEY not set"}), file=sys.stderr)
        sys.exit(1)

    try:
        # Perform operation
        result = perform_operation(api_key, args.param)
        print(json.dumps(result, indent=2))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

def perform_operation(api_key: str, param: str) -> Dict[str, Any]:
    """Perform the HubSpot operation"""
    # Implementation here
    pass

if __name__ == "__main__":
    main()
```

---

**Note:** These scripts enable the Sales Consultant Skill to provide full HubSpot functionality without consuming context tokens. As scripts are executed via bash, they don't need to be loaded into the Oracle's context window.

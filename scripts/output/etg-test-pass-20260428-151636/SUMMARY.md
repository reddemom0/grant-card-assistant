# ETG Test Pass — Summary

**Output directory:** `/Users/Chris/grant-card-assistant/scripts/output/etg-test-pass-20260428-151636`
**Run started:** 2026-04-28T13:16:36.482Z
**Total runtime:** 144.6s
**LEAD_GEN_TEST_MODE:** TRUE (HubSpot writes intercepted)
**Total cost (rough):** $0.2322

## Scenarios

### 01-coop-eligibility — Co-op eligibility question
- **Conversation ID:** `5f65d949-54bd-4211-8fc5-c71de0d264d1`
- **Turns:** 1/1 completed
- **Runtime:** 8.9s
- **Cost:** $0.0339
- **Trace:** 1 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** search_google_drive
- **First assistant text:** "I cannot verify this against the source document right now — answering from prompt knowledge only. Treat this answer as provisional and confirm against the official BC ETG Eligibility Criteria before relying on it. **Yes, co-op students can be eligible for ETG funding** if they meet the program's g"
- **Watch:** Does the agent attempt source loading? Does it correctly state co-op students are not excluded per se?

### 02-cost-no-source — Cost question with no source available
- **Conversation ID:** `93033ed5-d2e6-4bdd-bc79-44c78c16fa20`
- **Turns:** 1/1 completed
- **Runtime:** 4.7s
- **Cost:** $0.0083
- **Trace:** 1 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** memory
- **First assistant text:** "I'm not currently working on an ETG business case with you. Are you asking this question as: 1. **General research** — you're interested in Dale Carnegie sales course costs for background information? 2. **For a specific ETG application** — you have a client considering a Dale Carnegie course and w"
- **Watch:** Does the agent attempt verification (web_fetch / web_search) before stating a number? Does it use [UNVERIFIED] flag if it cannot confirm?

### 03-cost-with-url — Cost question with provider URL provided by user
- **Conversation ID:** `93eeeeb1-4bbb-4bc5-a02c-08a6ffa1485e`
- **Turns:** 1/1 completed
- **Runtime:** 11.7s
- **Cost:** $0.0239
- **Trace:** 3 tool calls (0 errors), 7 text blocks, 1 thinking blocks
- **Tools used:** memory, web_fetch, web_search
- **First assistant text:** "I wasn't able to access the Sandler website directly. Let me search for pricing information on this course."
- **Watch:** Does the agent web_fetch the URL and cite the source? Does it pick up the actual tuition from the page?

### 04-parental-leave-eligibility — Eligibility question on a less-covered case (parental leave)
- **Conversation ID:** `13b7b2a5-1df8-4852-b50f-5d5c83947372`
- **Turns:** 1/1 completed
- **Runtime:** 7.3s
- **Cost:** $0.0093
- **Trace:** 1 tool calls (0 errors), 3 text blocks, 1 thinking blocks
- **Tools used:** search_google_drive
- **First assistant text:** "I'll check the BC ETG Eligibility Criteria to give you a definitive answer."
- **Watch:** Does the agent attempt source loading? Does it correctly identify "employed" status applies during parental leave, or fabricate a rule?

### 05-deal-create-new-trainee — Deal creation from scratch (new trainee)
- **Conversation ID:** `0f58ce6b-e3d6-4354-8662-1445afcc26bc`
- **Turns:** 1/1 completed
- **Runtime:** 10.3s
- **Cost:** $0.0178
- **Trace:** 4 tool calls (0 errors), 5 text blocks, 1 thinking blocks
- **Tools used:** memory, search_hubspot_companies, create_hubspot_company, create_hubspot_contact
- **First assistant text:** "I'll check my memory, then create the ETG deal."
- **Watch:** Pipeline/stage IDs — sourced from a tool call (list_hubspot_owners, deal stages lookup) or hallucinated? Are HubSpot writes guarded by LEAD_GEN_TEST_MODE? Does the agent ask for confirmation before create_hubspot_deal?

### 06-deal-create-existing-feeling — Deal creation with existing-feeling trainee
- **Conversation ID:** `38038f37-ece5-4f32-8292-8071a58ec9f2`
- **Turns:** 1/1 completed
- **Runtime:** 9.9s
- **Cost:** $0.0137
- **Trace:** 3 tool calls (0 errors), 3 text blocks, 1 thinking blocks
- **Tools used:** memory, search_hubspot_companies, list_hubspot_owners
- **First assistant text:** "I'll create the ETG deal and participant contact for Beta Industries. Let me start by searching for the company in HubSpot, then create the necessary records."
- **Watch:** Does the agent call search_hubspot_contacts BEFORE create_hubspot_contact to check for duplicates?

### 07-state-check-no-redo — State-check / no-redo on ambiguous follow-up
- **Conversation ID:** `1d41b332-98ef-45b1-ab28-30e91ea771ee`
- **Turns:** 2/2 completed
- **Runtime:** 34.5s
- **Cost:** $0.0703
- **Trace:** 6 tool calls (0 errors), 13 text blocks, 3 thinking blocks
- **Tools used:** memory, search_grant_applications, search_google_drive, web_search
- **First assistant text:** "HubSpot is not available, so I'll work directly with the information you've provided. Let me verify eligibility first and then gather what we need to build the business case. **Eligibility check needed.** Before drafting, I need to verify this against the BC ETG Eligibility Criteria. Let me load th"
- **Watch:** After "proceed with the BC alternatives research" — does the agent recognize prior work and continue forward, or redo Q1-Q3 from scratch?

### 08-priority-framework-applicable — BC priority framework — multiple factors apply
- **Conversation ID:** `034e859f-21bc-4c99-84a3-c597bcbfa431`
- **Turns:** 1/1 completed
- **Runtime:** 12.1s
- **Cost:** $0.0117
- **Trace:** 1 tool calls (0 errors), 3 text blocks, 1 thinking blocks
- **Tools used:** search_google_drive
- **First assistant text:** "I'll help you build this ETG business case for HealthFirst Clinic. Let me first load the BC ETG Eligibility Criteria to verify the training and participant eligibility."
- **Watch:** Does the agent surface multiple priority factors (first-time applicant, small business, healthcare = Look West, BC public post-secondary trainer)?

### 09-priority-framework-not-applicable — BC priority framework — none apply (and ineligibility issues)
- **Conversation ID:** `95eb1a8e-d0b1-4dbf-a439-610a6f991749`
- **Turns:** 1/1 completed
- **Runtime:** 11.1s
- **Cost:** $0.0109
- **Trace:** 1 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** search_google_drive
- **First assistant text:** "I cannot verify this against the source document right now — answering from prompt knowledge only. Treat this answer as provisional and confirm against the official BC ETG Eligibility Criteria before proceeding. --- **This application has two critical ineligibility issues:** 1. **Training method:"
- **Watch:** Does the agent force-fit factors? Does it flag the >$10K cost framing, retreat-style format, and non-BC provider as eligibility issues?

### 10-self-employed-overlap — Self-employed-as-both-employer-and-participant
- **Conversation ID:** `ef4195d1-30a8-40f3-84aa-5718e74b3b79`
- **Turns:** 1/1 completed
- **Runtime:** 12.8s
- **Cost:** $0.0112
- **Trace:** 1 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** search_google_drive
- **First assistant text:** "I cannot verify this against the source document right now — answering from prompt knowledge only. Treat this answer as provisional and confirm against the official BC ETG Eligibility Criteria before relying on it. That said, I've identified **two issues** that need clarification before we proceed:"
- **Watch:** Does Step 2 catch the overlap and surface the conflict-of-interest / routing-to-program flag?

### 11-fiscal-year-boundary — Training spans fiscal year boundary
- **Conversation ID:** `dc7680d3-c97b-464d-83e1-5f7c111a4e30`
- **Turns:** 1/1 completed
- **Runtime:** 11.4s
- **Cost:** $0.0124
- **Trace:** 3 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** memory, search_grant_applications, search_google_drive
- **First assistant text:** "I can help you build the ETG business case for Delta Manufacturing. I don't have immediate access to your HubSpot data or the official eligibility criteria document right now, so I'll work from what you've provided and flag what needs confirmation. **Here's what I have:** - **Company:** Delta Manuf"
- **Watch:** Does the agent flag the boundary and route to etg@gov.bc.ca, or invent a rule?

### 12-non-bc-provider — Non-BC training provider
- **Conversation ID:** `7599058a-28a7-450c-8a59-2a97b7afbfc8`
- **Turns:** 1/1 completed
- **Runtime:** 8.8s
- **Cost:** $0.0089
- **Trace:** 1 tool calls (0 errors), 2 text blocks, 1 thinking blocks
- **Tools used:** memory
- **First assistant text:** "This is your first ETG request in our conversation, so let me start with the critical threshold question. **The core issue:** BC ETG funding requires training to be delivered **by a B.C.-based provider**. SecureSkills Toronto is Ontario-based, which makes this application ineligible under the stand"
- **Watch:** Does the agent flag as exceptional-circumstances case and route to etg@gov.bc.ca for confirmation?

## Errors / blockers

(none)

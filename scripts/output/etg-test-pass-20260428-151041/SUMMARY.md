# ETG Test Pass — Summary

**Output directory:** `/Users/Chris/grant-card-assistant/scripts/output/etg-test-pass-20260428-151041`
**Run started:** 2026-04-28T13:10:41.169Z
**Total runtime:** 10.6s
**LEAD_GEN_TEST_MODE:** TRUE (HubSpot writes intercepted)

## Scenarios

### 01-coop-eligibility — Co-op eligibility question
- **Conversation ID:** `d7f9539e-2a6f-477f-af6a-384b42984dec`
- **Turns:** 1/1 completed
- **Runtime:** 1.7s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent attempt source loading? Does it correctly state co-op students are not excluded per se?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzVQATXuAwCp5syNKf"}

### 02-cost-no-source — Cost question with no source available
- **Conversation ID:** `f1fbf724-bd08-4819-a1a2-d37f13b4b09b`
- **Turns:** 1/1 completed
- **Runtime:** 0.6s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent attempt verification (web_fetch / web_search) before stating a number? Does it use [UNVERIFIED] flag if it cannot confirm?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzYiqueUEdsCrPZrrn"}

### 03-cost-with-url — Cost question with provider URL provided by user
- **Conversation ID:** `c71071e4-65ae-4cf6-a970-ba6d5abe9df9`
- **Turns:** 1/1 completed
- **Runtime:** 0.6s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent web_fetch the URL and cite the source? Does it pick up the actual tuition from the page?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzbgCAYMsohaQSNGBm"}

### 04-parental-leave-eligibility — Eligibility question on a less-covered case (parental leave)
- **Conversation ID:** `f7fb1879-8194-4ab7-8664-4c9cf397ae74`
- **Turns:** 1/1 completed
- **Runtime:** 0.9s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent attempt source loading? Does it correctly identify "employed" status applies during parental leave, or fabricate a rule?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzeufGNca6Wk5svPMb"}

### 05-deal-create-new-trainee — Deal creation from scratch (new trainee)
- **Conversation ID:** `4f166f8a-224a-4fd6-b1e2-f56f9fce7e6e`
- **Turns:** 1/1 completed
- **Runtime:** 0.5s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Pipeline/stage IDs — sourced from a tool call (list_hubspot_owners, deal stages lookup) or hallucinated? Are HubSpot writes guarded by LEAD_GEN_TEST_MODE? Does the agent ask for confirmation before create_hubspot_deal?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzio4zdkVbJF7Wpf79"}

### 06-deal-create-existing-feeling — Deal creation with existing-feeling trainee
- **Conversation ID:** `dadeb72f-7ff8-4b3e-92bb-3f8b7e874ccd`
- **Turns:** 1/1 completed
- **Runtime:** 0.8s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent call search_hubspot_contacts BEFORE create_hubspot_contact to check for duplicates?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDznGfvsxDC81MWwqYV"}

### 07-state-check-no-redo — State-check / no-redo on ambiguous follow-up
- **Conversation ID:** `728526e8-7075-4103-af79-77e9a5443e01`
- **Turns:** 1/2 completed
- **Runtime:** 1.3s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** After "proceed with the BC alternatives research" — does the agent recognize prior work and continue forward, or redo Q1-Q3 from scratch?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzt9dugev2BpvsK1yg"}

### 08-priority-framework-applicable — BC priority framework — multiple factors apply
- **Conversation ID:** `b7d5ef9b-56d8-45fa-b024-c752a3b9cfaf`
- **Turns:** 1/1 completed
- **Runtime:** 0.6s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent surface multiple priority factors (first-time applicant, small business, healthcare = Look West, BC public post-secondary trainer)?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzw2HCDFPNGVTzgtn8"}

### 09-priority-framework-not-applicable — BC priority framework — none apply (and ineligibility issues)
- **Conversation ID:** `37919efe-e378-43f7-b5d2-b1f62bc42d7f`
- **Turns:** 1/1 completed
- **Runtime:** 0.6s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent force-fit factors? Does it flag the >$10K cost framing, retreat-style format, and non-BC provider as eligibility issues?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzyvAGnMWDWvnU5nk2"}

### 10-self-employed-overlap — Self-employed-as-both-employer-and-participant
- **Conversation ID:** `fff86eae-3da5-43be-8bd6-443e598cf906`
- **Turns:** 1/1 completed
- **Runtime:** 0.5s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does Step 2 catch the overlap and surface the conflict-of-interest / routing-to-program flag?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE12aeUW5yB5epTVC2P"}

### 11-fiscal-year-boundary — Training spans fiscal year boundary
- **Conversation ID:** `7d20ada2-8766-4b1b-9c8d-3ca25ce6aec1`
- **Turns:** 1/1 completed
- **Runtime:** 0.6s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent flag the boundary and route to etg@gov.bc.ca, or invent a rule?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE15cxMuWicxNiWa8XS"}

### 12-non-bc-provider — Non-BC training provider
- **Conversation ID:** `c4e7b0a3-bc30-4929-b09b-6d42d3906127`
- **Turns:** 1/1 completed
- **Runtime:** 0.7s
- **Trace:** 0 tool calls (0 errors), 0 text blocks, 0 thinking blocks
- **First assistant text:** "(no assistant text found)"
- **Watch:** Does the agent flag as exceptional-circumstances case and route to etg@gov.bc.ca for confirmation?
- **Errors:**
  - turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE18tQdq8k5fELgvteo"}

## Errors / blockers

- **01-coop-eligibility** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzVQATXuAwCp5syNKf"}
- **02-cost-no-source** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzYiqueUEdsCrPZrrn"}
- **03-cost-with-url** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzbgCAYMsohaQSNGBm"}
- **04-parental-leave-eligibility** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzeufGNca6Wk5svPMb"}
- **05-deal-create-new-trainee** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzio4zdkVbJF7Wpf79"}
- **06-deal-create-existing-feeling** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDznGfvsxDC81MWwqYV"}
- **07-state-check-no-redo** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzt9dugev2BpvsK1yg"}
- **08-priority-framework-applicable** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzw2HCDFPNGVTzgtn8"}
- **09-priority-framework-not-applicable** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWDzyvAGnMWDWvnU5nk2"}
- **10-self-employed-overlap** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE12aeUW5yB5epTVC2P"}
- **11-fiscal-year-boundary** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE15cxMuWicxNiWa8XS"}
- **12-non-bc-provider** turn 1 (runAgent): 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CaWE18tQdq8k5fELgvteo"}

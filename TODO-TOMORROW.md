# Tomorrow's Tasks: CanExport Claims Agent HubSpot Optimization

## 1. Test Agent-Specific Field Configuration
- [ ] Test CanExport Claims agent with new field configuration
- [ ] Verify it receives only CanExport-specific fields (claim_1-4, project fields)
- [ ] Confirm ETG fields are NOT appearing in CanExport agent responses
- [ ] Check console logs for field count confirmation

## 2. Refine CanExport Claims Field Selection
- [ ] Review which fields the Claims agent actually needs vs. what it's getting
- [ ] Add/remove fields from `CANEXPORT_FIELDS` array based on Claims agent workflow
- [ ] Consider separating CanExport Claims from CanExport Writer field needs

## 3. Update CanExport Claims Agent Prompt
- [ ] Review `.claude/agents/canexport-claims.md` prompt
- [ ] Update to reference available HubSpot fields explicitly
- [ ] Add guidance on how to interpret claim tracking fields (claim_1-4)
- [ ] Ensure agent knows how to use claimed_so_far, final_report_submitted

## 4. Test Real-World Claims Scenarios
- [ ] Test with Spring Activator (multiple claims)
- [ ] Test with other active CanExport applications
- [ ] Verify funding amounts are accurate (client_reimbursement)
- [ ] Check claim timeline interpretation

## 5. Future: Email & Document Integration (If Time)
- [ ] Research HubSpot email API endpoints
- [ ] Explore attachment retrieval options
- [ ] Plan integration approach

---

**Current Status:** Agent-specific field configuration implemented and deployed
**Branch:** railway-migration
**Last Commit:** 648a2aa - feat: Implement agent-specific HubSpot field configuration

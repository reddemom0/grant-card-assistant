# Lead-Gen Tracking: Data Quality Issues

Audit date: 2026-04-15
Dataset: 242 sessions in `lead_gen_conversations`, 675 events in `lead_gen_events`

---

## 1. Lead Scoring: Uncalibrated and Sparse

**Problem**: 63% of sessions (152/242) have no `lead_score` at all. Of the 37% that are scored, the distribution is:

| Score | Count | % of Scored |
|-------|-------|-------------|
| hot   | 43    | 47.8%       |
| warm  | 45    | 50.0%       |
| cool  | 2     | 2.2%        |

98% of scored sessions land in hot or warm. This is a calibration problem — the scoring logic (in the AI agent's `save_lead_data` tool) is too generous, making the tier field useless for prioritization.

**Root cause**: Scoring only runs when `save_lead_data` fires (contact capture path). Sessions that don't reach that point get no score. The thresholds inside the scoring prompt likely need tightening.

**Fix needed**:
- Ensure all finalized sessions get scored (not just contact-captured ones)
- Recalibrate thresholds so cool is a meaningful bucket
- Consider moving scoring to finalization (cron or contact_captured) rather than the tool call

---

## 2. CTA Inference: Agent Guesses Don't Match Widget Reality

**Problem**: `cta_selected` in `lead_gen_conversations` is set by the AI agent during `save_lead_data` — it's the agent's inference of user intent, not an observed user action. Meanwhile, `lead_gen_events` tracks actual widget `cta_clicked` events.

Correlation between the two:

| Agent CTA       | Widget CTA      | Count |
|-----------------|-----------------|-------|
| email_summary   | (none)          | 41    |
| none            | (none)          | 30    |
| book_call       | (none)          | 10    |
| email_summary   | email_summary   | 3     |
| email_summary   | service_page    | 2     |
| book_call       | book_call       | 1     |
| none            | email_summary   | 1     |

Only **4 of 87 agent-inferred CTAs** correspond to an actual widget click. The agent says "email_summary" 45 times, but only 3 of those have a matching real click event.

**Root cause**: The agent infers CTA from conversation context (e.g., user expressing interest in email). This is a classification of stated intent, not observed behavior. Most users who the agent tags as "email_summary" never actually click the email CTA button in the widget.

**Fix needed**:
- Stop treating `cta_selected` as ground truth for conversion metrics
- Use `lead_gen_events.cta_clicked` for real conversion tracking
- Consider renaming `cta_selected` to `cta_inferred` to avoid confusion
- Or: wire the widget's actual click event back to update the conversation record

---

## 3. Conversation-Table Funnel Metrics Are Inflated

**Problem**: The original admin dashboard computed funnel stats from `lead_gen_conversations`:
- "CTA Taken" = `COUNT(cta_selected != 'none')` = 56
- "Calls Booked" = `COUNT(cta_selected = 'book_call')` = 11
- "Emails Sent" = `COUNT(cta_selected = 'email_summary')` = 45

The real numbers from `lead_gen_events`:
- Widget opens: 459
- Estimates delivered: 41
- CTA actually clicked: 11 (total, all types)
- Email summary clicked: 4

The conversation table inflates "Emails Sent" by **11x** (45 vs 4) because it counts agent inference, not real clicks.

**Fix applied**: The admin dashboard (`/admin/conversations`) now sources stats from `lead_gen_events` instead of `lead_gen_conversations`. This shows lower but accurate numbers.

**Remaining work**:
- Ensure all widget events are consistently tracked (some sessions may not fire events)
- Consider adding server-side email-sent confirmation events to close the loop

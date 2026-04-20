# Oracle Test Prompt Battery

**Purpose**: Evaluate Oracle's strategic intelligence capabilities with realistic queries that demonstrate value to the strategy team.

**Test Guidelines**:
- Run each prompt through Oracle and capture full response
- Note response time, accuracy, and usefulness (1-10 scale)
- Identify any gaps, errors, or areas for improvement
- Compare to how you would answer this manually (time and effort saved)

---

## Category 1: Lead Generation & Prospecting

### Test 1A: Signal-Based Lead Identification

**Prompt**:
```
Find BC-based manufacturing companies that could be good prospects for the IRAP program. Use HubSpot to see if we've contacted them before, then do web research to identify companies we've never reached out to. Prioritize companies showing signs of R&D activity (hiring engineers, patents filed, innovation announcements). Give me a top 20 list with rationale for each.
```

**What This Tests**:
- HubSpot search and filtering
- Web research integration
- Lead scoring logic
- Competitive intelligence (finding new prospects)
- Output formatting (actionable list)

**Expected Outcome**: Prioritized list of 20 companies with mix of existing contacts and new prospects, each with specific rationale based on R&D signals.

---

### Test 1B: Opportunity Matching

**Prompt**:
```
A new grant program just launched: "BC Clean Technology Innovation Fund" - $250K for companies developing environmental tech. Search our HubSpot database and tell me which existing clients or past prospects would be perfect for this. For each match, explain why they're a good fit based on their company profile, past grant history, and any notes from discovery calls. Also tell me if they're currently in our pipeline and what stage.
```

**What This Tests**:
- HubSpot company search with complex filters
- Context awareness (past interactions, deal history)
- Relevance matching
- Deal pipeline awareness
- Synthesis of multiple data points

**Expected Outcome**: List of 5-10 matched clients with specific reasons why each is a good fit, current relationship status, and recommended next steps.

---

### Test 1C: Market Research for Outreach

**Prompt**:
```
We want to target agricultural technology companies for the AgriInnovation Program. First, check our knowledge base to see what we know about this program. Then search HubSpot for any agricultural clients we've worked with. Finally, do web research to find 10 agtech companies in Western Canada we should reach out to. For each prospect, give me: company name, location, what they do, why they'd be interested in grants, and suggested talking points for the first email.
```

**What This Tests**:
- Multi-source research workflow (Knowledge Base → HubSpot → Web)
- Industry-specific targeting
- Prospecting beyond existing network
- Personalization at scale
- Outreach strategy development

**Expected Outcome**: Comprehensive brief on AgriInnovation Program + analysis of existing ag clients + 10 new prospects with personalized talking points for each.

---

## Category 2: Deal Closing & Sales Support

### Test 2A: Proposal Generation

**Prompt**:
```
I need to create a proposal for GreenTech Solutions (look them up in HubSpot) for an IRAP application. Load their company information, find our pricing for IRAP services from the knowledge base, and generate a professional proposal. Include: executive summary personalized to their business, our service scope, timeline, pricing, 2-3 relevant case studies of similar clients, and ROI projection showing potential grant funding vs. our fees. Create this as a Google Doc.
```

**What This Tests**:
- HubSpot company context loading
- Knowledge base document retrieval (pricing, case studies)
- Content generation with multiple data sources
- Professional document formatting
- Google Drive creation
- ROI calculation

**Expected Outcome**: Complete proposal document in Google Drive, properly formatted, with all sections personalized to GreenTech based on their HubSpot profile.

---

### Test 2B: Objection Handling

**Prompt**:
```
A prospect said: "Your price of $12,000 for an IRAP application seems high. We found another consultant offering it for $7,000." Search our knowledge base for information about our pricing strategy and value proposition. Also check HubSpot for similar past objections and how we've handled them. Give me talking points to respond to this objection, including data on success rates, case studies demonstrating ROI, and how to position our premium service.
```

**What This Tests**:
- Price objection handling
- Knowledge base synthesis (pricing rationale, value props)
- HubSpot historical analysis (past objections)
- Competitive positioning
- Evidence-based persuasion

**Expected Outcome**: Structured response with 3-5 key talking points, supporting evidence from case studies, and recommended positioning strategy.

---

### Test 2C: Deal Risk Analysis

**Prompt**:
```
Look up the deal for "InnovateCorp - Strategic Innovation Fund" in HubSpot. It's been in "Proposal Sent" stage for over 3 weeks. Analyze the deal: review the email history, check when they last engaged with us, compare this timeline to our average sales cycle for similar deals. Tell me: what's the win probability, what are the risk factors, and what should be my next action to save this deal?
```

**What This Tests**:
- HubSpot deal analysis
- Email history review
- Pattern recognition (comparing to similar deals)
- Risk assessment
- Next-best-action recommendations
- Deal rescue strategies

**Expected Outcome**: Comprehensive deal health assessment with win probability score, identified risk factors, comparison to similar deals, and specific recommended next steps with draft communication.

---

## Category 3: Market Intelligence & Research

### Test 3A: Program Comparison

**Prompt**:
```
A client is trying to decide between applying for NRC IRAP or the BC Manufacturing Innovation Program (BCIP) for their R&D project. Search our knowledge base and do web research to compare these two programs across: eligibility requirements, funding amounts, application process, timelines, success rates, and restrictions. Create a comparison table that helps the client make a decision.
```

**What This Tests**:
- Multi-program research
- Knowledge base + web research synthesis
- Comparative analysis
- Structured output (table format)
- Decision support

**Expected Outcome**: Detailed comparison table with recommendations based on the differences, helping client choose the best-fit program.

---

### Test 3B: Eligibility Deep Dive

**Prompt**:
```
Check our knowledge base for Strategic Innovation Fund (SIF) eligibility criteria. Then look up "Quantum Dynamics Inc" in HubSpot to get their company details. Based on SIF requirements and Quantum's profile (industry, size, revenue, project type from discovery notes), determine if they're eligible. Walk me through each eligibility criterion and whether they meet it. If they're not eligible, suggest alternative programs they should consider.
```

**What This Tests**:
- Detailed eligibility analysis
- Knowledge base document parsing
- HubSpot company profile analysis
- Complex rule application
- Alternative recommendation logic

**Expected Outcome**: Point-by-point eligibility assessment with clear yes/no for each criterion, overall eligibility determination, and alternative program suggestions if not eligible.

---

### Test 3C: Competitive Intelligence

**Prompt**:
```
We're competing against "Elite Grant Consultants" for a large IRAP deal. Search our knowledge base and HubSpot for any information we have about this competitor - past deals where they were involved, their pricing (if known), what clients have said about them. Also do web research on their company: services offered, team size, public success stories, positioning. Give me a competitive battlecard: their strengths, weaknesses, how we differentiate, and talking points to use.
```

**What This Tests**:
- Competitive intelligence gathering
- Multi-source synthesis (internal knowledge + web)
- Pattern detection across past deals
- Strategic positioning
- Battlecard creation

**Expected Outcome**: Comprehensive competitive battlecard with strengths/weaknesses analysis, differentiation strategy, and specific talking points for the sales conversation.

---

## Category 4: Knowledge Synthesis & Analysis

### Test 4A: Process Documentation

**Prompt**:
```
I'm new to the team and need to understand our complete process for taking a client from first contact through to submitting their grant application. Search the knowledge base for all relevant process documents across departments (Strategy intake, Research eligibility checks, Writers application development, GCs submission procedures). Synthesize this into a step-by-step guide with approximate timelines for each phase.
```

**What This Tests**:
- Cross-departmental knowledge synthesis
- Process documentation retrieval
- Workflow mapping
- Onboarding support
- Clear explanatory output

**Expected Outcome**: Comprehensive process guide covering all phases from intake to submission, with timelines, responsibilities, and key deliverables for each step.

---

### Test 4B: Success Pattern Analysis

**Prompt**:
```
Search HubSpot for all IRAP applications we've completed in the past 2 years. Filter for ones that were approved (won). Analyze these successful applications to identify patterns: what industries are most successful, what size companies, what types of R&D projects, average grant amounts, any common characteristics in the application approach. Use our knowledge base if needed to cross-reference project descriptions or approaches. Give me insights we can use to improve our IRAP win rate.
```

**What This Tests**:
- Historical data analysis
- Pattern recognition
- HubSpot filtering and aggregation
- Knowledge base cross-referencing
- Actionable insight generation

**Expected Outcome**: Data-driven analysis of successful IRAP applications with identified patterns, success factors, and recommendations for improving future applications.

---

### Test 4C: Pricing Consistency Audit

**Prompt**:
```
Audit our pricing across all grant programs. Search the knowledge base for all pricing documents, then check HubSpot for actual deal values from the past 6 months. Compare documented pricing to actual deals - are we consistent? Are there programs where we're discounting heavily? Are there opportunities to raise prices? Give me a pricing analysis with recommendations.
```

**What This Tests**:
- Multi-document analysis
- Pricing data extraction
- HubSpot deal analysis
- Consistency checking
- Strategic pricing recommendations

**Expected Outcome**: Comprehensive pricing audit showing documented vs. actual pricing by program, inconsistencies identified, discount patterns, and strategic pricing recommendations.

---

## Category 5: Content Creation

### Test 5A: Discovery Call Recap

**Prompt**:
```
I just finished a discovery call with "Pacific Manufacturing Ltd" (find them in HubSpot). Based on their company profile and the contact notes I added, generate a discovery call recap document. Include: company background, their goals and challenges discussed, grant programs that seem like good fits (reference our knowledge base for program details), recommended next steps, and timeline. Create this as a Google Doc that I can send to the client.
```

**What This Tests**:
- HubSpot note retrieval
- Context-aware document generation
- Program recommendation logic
- Professional formatting
- Google Doc creation

**Expected Outcome**: Professional discovery call recap document in Google Drive, personalized to Pacific Manufacturing, with relevant program recommendations and clear next steps.

---

### Test 5B: Client Email Draft

**Prompt**:
```
Draft a follow-up email for "TechVentures Corp" (look up in HubSpot). They went through discovery 2 weeks ago and we sent them a proposal for BCIP funding 5 days ago but haven't heard back. Check their engagement history - did they open the email? Any other interactions? Write a friendly follow-up email that references specific points from our discovery call (check the notes), reiterates the value proposition, and includes a soft call to action. Keep it under 150 words.
```

**What This Tests**:
- HubSpot engagement tracking
- Note retrieval and context
- Personalized email generation
- Tone and length constraints
- Follow-up timing strategy

**Expected Outcome**: Concise, personalized follow-up email that feels authentic, references specific discovery points, and has appropriate tone for the situation.

---

### Test 5C: Case Study Creation

**Prompt**:
```
Create a customer success story for marketing based on "Advanced Robotics Inc" (find in HubSpot). Look up their grant application details - which program, how much funding, what the project was about. Search our knowledge base for the customer story template. Generate a case study following the template: client background, challenge they faced, how we helped, results achieved (grant won, amount, impact). Make it compelling for marketing use.
```

**What This Tests**:
- HubSpot application data retrieval
- Template loading and application
- Story crafting from data
- Marketing content generation
- Brand voice consistency

**Expected Outcome**: Complete case study following company template, compelling narrative, specific results, ready for marketing team to use.

---

## Category 6: Operational Efficiency

### Test 6A: Quick Reference

**Prompt**:
```
What's the maximum funding amount for NGen projects? And what's their typical approval timeline?
```

**What This Tests**:
- Fast fact retrieval
- Knowledge base search accuracy
- Concise answering

**Expected Outcome**: Quick, accurate answer with source citation (which document the information came from).

---

### Test 6B: Template Location

**Prompt**:
```
I need the budget template for BCAFE applications. Find it in the knowledge base and send me the link.
```

**What This Tests**:
- Specific document retrieval
- File type filtering (template)
- Direct link provision

**Expected Outcome**: Google Drive link to the correct BCAFE budget template with confirmation of what it contains.

---

### Test 6C: SOPNavigation

**Prompt**:
```
Walk me through the process for submitting an IRAP claim. What documents do I need, where do I submit, what's the timeline, and are there any common mistakes to avoid?
```

**What This Tests**:
- Process document retrieval
- Step-by-step guidance
- Practical tips inclusion
- Mistake prevention

**Expected Outcome**: Clear step-by-step guide for IRAP claim submission with checklist, timeline, and proactive tips about common pitfalls.

---

## Category 7: Proactive Intelligence (Advanced)

### Test 7A: Account Health Check

**Prompt**:
```
Review all our active IRAP deals in HubSpot (any deal in "Proposal Sent", "In Negotiation", or "Application in Progress" stages). For each one, check: when was the last activity, is it on track based on typical timelines, are there any red flags? Give me a prioritized list of deals that need immediate attention with recommended actions for each.
```

**What This Tests**:
- Pipeline analysis
- Risk detection across multiple deals
- Prioritization logic
- Proactive monitoring
- Action recommendation

**Expected Outcome**: Deal health dashboard showing all active IRAP deals, health status for each, priority ranking, and specific recommended actions for at-risk deals.

---

### Test 7B: Cross-Sell Opportunity Detection

**Prompt**:
```
Find all clients in HubSpot who have successfully completed an IRAP application with us in the past 12 months but haven't engaged with us for any other programs. For each one, based on their industry and company profile, suggest other grant programs they might be eligible for. This could be a cross-sell opportunity. Prioritize by potential grant value and likelihood of interest.
```

**What This Tests**:
- Historical client analysis
- Opportunity detection
- Program matching logic
- Cross-sell strategy
- Prioritization by value

**Expected Outcome**: List of 10-15 past IRAP clients with cross-sell potential, recommended programs for each, rationale for the match, and suggested outreach approach.

---

### Test 7C: Strategic Planning Support

**Prompt**:
```
We're planning Q2 2026 marketing and want to focus on programs with the best ROI for our business. Analyze HubSpot deal data from the past year: which grant programs have the highest close rates, shortest sales cycles, and best revenue per deal? Also consider which programs have upcoming deadlines in Q2 (search knowledge base and do web research). Give me a strategic recommendation: which 3 programs should we focus our marketing efforts on and why?
```

**What This Tests**:
- Multi-metric deal analysis
- ROI calculation across programs
- Deadline awareness
- Strategic synthesis
- Prioritized recommendations with rationale

**Expected Outcome**: Data-driven analysis of all programs by close rate, sales cycle, and revenue, combined with Q2 deadline calendar, resulting in top 3 recommended focus programs with specific rationale for each.

---

## Evaluation Rubric

For each test prompt, rate Oracle's response on:

### Accuracy (1-10)
- 10: All information correct and well-sourced
- 7-9: Mostly correct with minor errors
- 4-6: Some correct info but significant gaps
- 1-3: Largely incorrect or irrelevant

### Completeness (1-10)
- 10: Fully addresses all aspects of prompt
- 7-9: Addresses most points, minor gaps
- 4-6: Misses significant parts of request
- 1-3: Only partially addresses prompt

### Usefulness (1-10)
- 10: Immediately actionable, saves significant time
- 7-9: Useful with minor refinement needed
- 4-6: Some value but requires substantial work
- 1-3: Not useful, easier to do manually

### Time Saved (estimate)
- How long would this take you manually?
- How long did Oracle take?
- Net time saved (minutes)

### Overall Rating (1-10)
- Would you use Oracle for this task again?
- Would you recommend Oracle to colleagues for this task?

---

## Testing Protocol

**Phase 1: Basic Capabilities** (Tests 6A, 6B, 6C)
- Start with simple retrieval tasks
- Verify knowledge base search is working
- Ensure response formatting is clear
- **Success Criteria**: 8+ average score across all three metrics

**Phase 2: Single-Source Analysis** (Tests 1A, 3A, 3B, 4A)
- Test deeper analysis within one data source
- Verify synthesis and reasoning
- Check citation accuracy
- **Success Criteria**: 7+ average score, saves 30+ minutes per task

**Phase 3: Multi-Source Integration** (Tests 1B, 1C, 2A, 5A)
- Test HubSpot + Knowledge Base + Web combinations
- Verify data is correctly synthesized
- Check for contradictions or errors
- **Success Criteria**: 7+ average score, demonstrates value of integration

**Phase 4: Advanced Strategic Tasks** (Tests 2B, 2C, 4B, 7A, 7B, 7C)
- Test complex workflows requiring multiple steps
- Verify proactive intelligence capabilities
- Check strategic recommendation quality
- **Success Criteria**: 6+ average score (these are hardest), clear time savings

**Phase 5: Content Generation** (Tests 5A, 5B, 5C)
- Test document creation and writing quality
- Verify brand voice consistency
- Check for proper formatting
- **Success Criteria**: 7+ average score, content requires minimal editing

---

## Feedback Collection

After running all tests, gather structured feedback:

### What Worked Well
- Which capabilities were most impressive?
- Which tasks would you definitely use Oracle for?
- What exceeded your expectations?

### What Needs Improvement
- Where did Oracle fall short?
- What errors or hallucinations occurred?
- What additional capabilities are needed?

### Priority Rankings
- Rank the 7 categories by importance to your work (1=most important)
- Which specific tasks would provide the most value if perfected?
- What new capabilities should be added to Oracle?

### Implementation Feedback
- How should Oracle fit into your daily workflow?
- What integrations would make it more useful?
- What training or documentation do you need?

---

## Next Steps After Testing

1. **Compile Results**: Create summary document with scores, feedback, examples
2. **Identify Gaps**: List specific areas where Oracle underperformed
3. **Prioritize Improvements**: Focus on highest-value, most-used capabilities
4. **System Prompt Refinement**: Update Oracle's instructions based on findings
5. **Iteration**: Re-test improved version on failed/weak test cases
6. **Rollout Planning**: If tests are successful (7+ average), plan team training and rollout

---

**Testing Timeline**: 2-3 days
**Testers**: 3-5 strategy team members
**Goal**: Validate Oracle's value and identify improvements before full rollout

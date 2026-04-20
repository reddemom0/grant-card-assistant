# Oracle: Comprehensive Capability Scope

**Last Updated**: January 13, 2026
**Status**: Design Phase - Pending Implementation & Testing

---

## Executive Summary

Oracle is Granted Consulting's strategic intelligence assistant - a multi-modal AI system that combines internal knowledge (515+ indexed documents), CRM data (HubSpot), external research (web search), and real-time monitoring (VisualPing) to provide proactive support across all business functions.

**Primary Use Cases**:
1. **Knowledge Retrieval** - Find company documents, processes, templates, examples
2. **Strategic Analysis** - Synthesize information from multiple sources to inform decisions
3. **Content Generation** - Create client-ready documents using company templates
4. **Lead Generation** - Identify prospects and build outreach strategies
5. **Deal Support** - Accelerate sales cycles with proposal generation and objection handling
6. **Market Intelligence** - Monitor grant programs and competitive landscape
7. **Operational Efficiency** - Answer team questions and automate repetitive research

---

## Core Architecture

### Knowledge Base (515 Documents)

**Departments**:
- **Writers** (~200 docs): Application templates, writing guides, program documentation (CanExport, ETG, BCAFE, etc.)
- **Strategy** (~100 docs): Pricing guides, discovery scripts, client intake processes, readiness assessment tools
- **Research** (~150 docs): Grant program databases, eligibility rubrics, grading criteria, research procedures
- **Marketing** (~40 docs): Content calendars, webinar topics, customer story templates, partnership materials
- **GCs** (~25 docs): Branding guidelines, hiring processes, claim procedures, submission protocols

**Storage**: Redis with AI-generated metadata (summary, keywords, fileType)
**Indexing**: Claude 4.5 Haiku analyzes each document for searchable metadata
**Update Frequency**: On-demand reindexing (incremental or full)

### Data Sources

1. **Google Drive** (via Service Account):
   - Search across entire knowledge base
   - Read full document content
   - Create new documents (Docs, Sheets, Folders)
   - Access shared files with service account permissions

2. **HubSpot CRM**:
   - Company profiles (industry, size, revenue, location)
   - Contact information and engagement history
   - Grant applications and deal pipeline
   - Email history and attachments
   - Project files and documentation
   - Funding agreements and contracts

3. **Web Research**:
   - Real-time search for grant programs, eligibility, deadlines
   - Fetch specific URLs for deep analysis
   - Competitive intelligence gathering
   - Industry trend monitoring

4. **VisualPing** (Website Monitoring):
   - Automated detection of government grant page changes
   - Webhook alerts for new programs, deadline changes, eligibility updates
   - AI-generated summaries of page changes
   - Screenshot comparisons and diff analysis

### AI Models

- **Primary**: Claude Sonnet 4.5 (conversations, complex analysis, content generation)
- **Indexing**: Claude Haiku 4.5 (fast, cost-effective metadata generation)
- **Context Window**: 200K tokens (~150K words)
- **Capabilities**: Multi-document analysis, structured output, tool use, long-form generation

---

## Three Core Response Modes

### Mode 1: Retrieval (Find & Cite)

**Purpose**: Find and return specific documents or information from knowledge base

**How It Works**:
1. User asks for specific document or information
2. Oracle searches Redis metadata indexes (keywords, departments, file types)
3. Returns top matches with summaries and links
4. Can load full content if needed

**Example Queries**:
- "Find the CanExport application template"
- "Show me all discovery call scripts"
- "What's our pricing guide say about readiness assessments?"
- "Find examples of successful IRAP applications"

**Tools Used**:
- `search_oracle_kb` - Search indexed metadata
- `read_google_drive_file` - Load full document content
- `search_google_drive` - Direct Drive API search if needed

**Output Format**:
- List of relevant documents with metadata
- Summaries and key excerpts
- Direct links to view/edit in Google Drive
- File type indicators (template, example, process, reference, data)

---

### Mode 2: Synthesis (Connect & Analyze)

**Purpose**: Analyze and synthesize information from multiple sources to answer complex questions

**How It Works**:
1. User asks analytical question or requests research
2. Oracle identifies relevant sources (knowledge base, HubSpot, web)
3. Retrieves and analyzes information from multiple documents/sources
4. Synthesizes findings into coherent answer with citations
5. Provides insights and recommendations

**Example Queries**:
- "Compare our pricing across all grant programs - are we consistent?"
- "Analyze trends in successful IRAP applications from our files"
- "What do our discovery scripts say about qualifying export-ready companies?"
- "How do federal vs. provincial grant programs differ in eligibility?"

**Tools Used**:
- `search_oracle_kb` + `read_google_drive_file` (internal knowledge)
- `search_hubspot_companies` + `get_grant_application` (CRM data)
- `WebSearch` + `WebFetch` (external research)
- `Memory` (maintain context across conversation)

**Output Format**:
- Structured analysis with clear sections
- Citations for all claims (document names, page numbers, URLs)
- Comparative tables or lists when relevant
- Key insights and patterns identified
- Recommendations based on findings

---

### Mode 3: Creation (Generate Content)

**Purpose**: Create new documents, proposals, emails, and other content using company templates and knowledge

**How It Works**:
1. User requests content creation (email, proposal, document)
2. Oracle identifies relevant templates from knowledge base
3. Gathers context from HubSpot (client info, past applications, deal history)
4. Generates content following company standards and brand voice
5. Can create directly in Google Drive or return formatted text

**Example Queries**:
- "Draft a discovery call recap for [Client Name]"
- "Create an intake form for a new manufacturing client interested in IRAP"
- "Generate a proposal for CanExport SME services at our standard pricing"
- "Write a follow-up email for a client who went silent after our quote"

**Tools Used**:
- `search_oracle_kb` (find templates)
- `read_google_drive_file` (load template content)
- `load_company_context` / `get_hubspot_contact` (client information)
- `create_google_doc` / `create_google_sheet` (output to Drive)

**Output Format**:
- Formatted document following company templates
- Personalized with client-specific details from HubSpot
- Includes all necessary sections (branding, disclaimers, next steps)
- Can be created directly in Google Drive or returned as text for review

---

## Strategic Intelligence Capabilities

### 1. Lead Generation & Prospecting

**Objective**: Identify potential clients and build targeted outreach strategies

**Capabilities**:

**A. Signal-Based Prospecting**
- Monitor trigger events: funding rounds, hiring spikes, expansion announcements
- Detect intent signals: website visits, resource downloads, webinar attendance
- Track industry changes: new regulations, trade agreements, market disruptions
- VisualPing integration: Alert when target companies' websites change

**B. Lead Scoring & Qualification**
- Analyze fit: company size, industry, location, grant readiness
- Assess engagement: past interactions, email opens, content downloads
- Predict conversion likelihood based on similar past clients
- Prioritize outreach based on opportunity value and conversion probability

**C. Account Research**
- Build comprehensive company profiles from web research + HubSpot data
- Identify key decision makers and their backgrounds
- Map organizational structure and buying committee
- Analyze past grant applications (if public) to assess sophistication level

**D. Campaign Strategy**
- Design multi-touch outreach sequences (email, LinkedIn, phone)
- Personalize messaging based on company's specific situation
- Recommend best programs/services for each prospect
- Suggest optimal timing and approach based on past success patterns

**Example Workflows**:

**Workflow: "Find manufacturing companies in BC who could use IRAP"**
1. Search HubSpot for manufacturing companies in BC
2. Filter by size (< 500 employees, now that IRAP expanded eligibility)
3. Cross-reference with web research on R&D activity indicators
4. Identify companies not yet in our CRM (new prospects)
5. Build target list with prioritization (score 1-10)
6. Generate personalized outreach templates for top 20

**Workflow: "Who should we contact about the new Export Tech Innovation Grant?"** (VisualPing alert received)
1. Oracle receives VisualPing alert: New $75K grant for BC tech exporters
2. Searches HubSpot for: Tech companies, BC-based, with export interests
3. Filters by: Previous grant applications, deal stage, last contact date
4. Identifies 8 highly relevant clients + 12 prospects not in CRM
5. Generates personalized alert emails for each
6. Creates tasks in HubSpot for account owners
7. Suggests follow-up strategy for each contact

---

### 2. Deal Closing Support

**Objective**: Accelerate sales cycles and increase win rates through AI-assisted selling

**Capabilities**:

**A. Proposal Generation** (76% faster)
- Load client context from HubSpot (discovery notes, pain points, goals)
- Select appropriate services and pricing from internal guides
- Generate custom proposal using company templates
- Include case studies of similar successful clients
- Auto-populate client-specific ROI projections
- Create directly in Google Docs with proper branding

**B. Objection Handling**
- Analyze common objections from past deals (won/lost analysis)
- Provide evidence-based responses with citations
- Suggest alternative positioning or pricing structures
- Recommend case studies that address specific concerns
- Generate talking points for follow-up calls

**C. Win Probability Scoring** (81% accuracy)
- Analyze deal characteristics against historical win/loss data
- Factors: client size, industry, budget, timeline, competition, engagement level
- Predict likelihood of closing with confidence score
- Identify key risk factors and suggest mitigation strategies
- Recommend next-best-actions to move deal forward

**D. Next-Best-Action Recommendations**
- Analyze deal stage and last activity
- Suggest optimal next step based on similar successful deals
- Draft follow-up communications automatically
- Recommend resources to share (case studies, templates, pricing)
- Flag deals at risk of stalling

**E. Competitive Intelligence**
- Monitor competitor websites and pricing (via VisualPing + web research)
- Analyze competitive positioning from lost deals
- Build battlecards for common competitors
- Suggest differentiation strategies for specific competitions
- Track competitor grant wins (via public databases)

**F. Deal Health Monitoring**
- Track engagement metrics: email opens, response times, meeting attendance
- Identify warning signs: ghosting, delayed decisions, price concerns
- Alert account owners when deals show risk factors
- Recommend re-engagement strategies for stalled deals

**G. ROI Calculators**
- Generate client-specific ROI projections for grant services
- Calculate expected grant funding vs. service fees
- Build business cases for clients to get internal buy-in
- Create data-driven justifications for our pricing

**H. Closing Tactics**
- Suggest urgency-creating strategies (deadline-based, program-based)
- Draft closing emails with social proof and scarcity
- Recommend discount structures that maintain margins
- Provide scripts for closing calls

**Example Workflows**:

**Workflow: "Generate a proposal for TechCorp's CanExport application"**
1. Load TechCorp context from HubSpot (industry, size, export goals)
2. Retrieve discovery call notes and pain points
3. Search knowledge base for CanExport pricing and service description
4. Find 2-3 similar case studies (tech companies, export grants, similar size)
5. Calculate ROI: $75K potential grant vs. $8K service fee = 9.4x return
6. Generate proposal in Google Docs with:
   - Executive summary personalized to TechCorp
   - Service scope (strategy, writing, review, submission)
   - Timeline aligned with CanExport deadline
   - Pricing with payment terms
   - Case studies of similar successes
   - Next steps and call-to-action
7. Return link to document for review

**Workflow: "Why did we lose the deal with InnovateSoft?"**
1. Load deal history from HubSpot
2. Analyze email exchanges and meeting notes
3. Identify stated objections: "Too expensive", "Can do ourselves"
4. Cross-reference with similar lost deals
5. Provide analysis:
   - Primary objection: Price (mentioned 3 times)
   - Secondary: Lack of confidence in ROI
   - Missing: Didn't share case study of similar successful client
   - Timing: Competitor (XYZ Consulting) was cheaper by 30%
6. Recommendations for future:
   - Lead with ROI calculator earlier in sales process
   - Share case study during discovery call, not after proposal
   - Consider tiered pricing (DIY support vs. full service)
   - Battle card against XYZ Consulting (quality vs. price positioning)

---

### 3. Market Intelligence

**Objective**: Monitor grant landscape and industry trends to inform strategy

**Capabilities**:

**A. Grant Program Monitoring** (via VisualPing)
- 24/7 automated monitoring of 20-30 key government grant pages
- Real-time alerts for: new programs, deadline changes, eligibility updates, funding changes
- AI-generated summaries of what changed and why it matters
- Automatic cross-referencing with client base to identify opportunities

**B. Trend Analysis**
- Track patterns in grant program changes over time
- Identify seasonality in program launches and deadline
- Analyze funding trends (increasing/decreasing by sector/program)
- Predict upcoming opportunities based on historical patterns

**C. Competitive Landscape**
- Monitor competitor websites and service offerings (via VisualPing)
- Track public grant wins (via web research + databases)
- Analyze competitor positioning and messaging
- Identify market gaps and opportunities

**D. Industry Intelligence**
- Research sector-specific trends (tech, manufacturing, agriculture, clean tech)
- Monitor trade policy changes affecting grant programs
- Track government budget announcements and implications
- Analyze economic indicators relevant to grant funding

**E. Client Intelligence**
- Research target companies before outreach
- Monitor client news (acquisitions, expansions, funding rounds)
- Track client industry developments that create grant opportunities
- Alert when clients announce changes that indicate grant readiness

**Example Workflows**:

**Workflow: "What's happening in the BC grant landscape?"**
1. Query knowledge base for recent grant program documents
2. Web search for recent BC government announcements
3. Check VisualPing alerts from past 30 days
4. Synthesize findings:
   - 2 new programs launched (Export Tech Innovation, Clean Manufacturing)
   - 1 deadline extension (Regional Innovation - +44 days)
   - 3 eligibility expansions (IRAP employee limit, BCAFE sector additions)
   - Trend: Increased focus on tech + climate intersection
5. Implications for Granted:
   - New client opportunities in clean tech sector
   - Existing clients may be newly eligible for expanded programs
   - Should update marketing content to reflect new opportunities
6. Recommended actions with priority levels

**Workflow: "Monitor the CanExport SME program page"** (VisualPing automation)
1. VisualPing checks page every 6 hours
2. Detects 12% content change
3. Sends webhook to Oracle with AI summary + added/removed text
4. Oracle analyzes: Funding per project increased from $75K to $99K
5. Searches HubSpot for active CanExport deals
6. Finds 4 clients in application draft stage
7. Generates alert: "CanExport funding increased - notify 4 active clients"
8. Creates tasks in HubSpot for account owners
9. Drafts notification emails mentioning increased funding potential

---

### 4. Operational Efficiency

**Objective**: Answer team questions and automate repetitive research tasks

**Capabilities**:

**A. Instant Answers**
- "What's our pricing for IRAP applications?"
- "Where's the ETG business case template?"
- "What are BCAFE eligibility requirements?"
- "Who handles claims for CanExport?"

**B. Onboarding Support**
- New team members can ask Oracle instead of interrupting colleagues
- "How do I start a discovery call?"
- "What's our process for intake?"
- "Where are the branding guidelines?"

**C. Process Guidance**
- Walk through company SOPs step-by-step
- "How do I submit a CanExport claim?"
- "What's the grant research process?"
- "How do we grade applications?"

**D. Template Location**
- Quickly find and load any company template
- "Get me the customer story template"
- "Where's the webinar planning doc?"
- "Find the budget spreadsheet for ETG"

**E. Cross-Department Knowledge Sharing**
- Writers can access Strategy pricing guides
- Strategy can see Research eligibility criteria
- Marketing can find successful case studies from Writers
- Everyone has access to full company knowledge

---

## Tool Inventory

### HubSpot CRM Tools

**Company & Contact Management**:
- `search_hubspot_companies` - Find companies by filters (industry, location, size, custom properties)
- `get_hubspot_contact` - Get full contact details and engagement history
- `load_company_context` - Load comprehensive company profile with associated contacts, deals, notes

**Grant Applications & Deals**:
- `search_grant_applications` - Find grant applications by client, program, status, date range
- `get_grant_application` - Get full application details including all custom fields
- `get_hubspot_deals` - List deals by stage, owner, date range (if this tool exists)
- `get_deal_details` - Get comprehensive deal information (if this tool exists)

**Email & Communication**:
- `get_project_email_history` - Get all emails for a specific project/deal
- `search_project_emails` - Search emails by keywords, date, participants
- `get_email_details` - Get full email content and metadata

**Files & Documents**:
- `get_deal_files` - List all files attached to a deal
- `read_hubspot_file` - Read content of file stored in HubSpot
- `find_and_read_funding_agreement` - Specialized tool for funding agreements

### Google Drive Tools

**Search & Read**:
- `search_google_drive` - Search Drive by keywords, file types, folders
- `read_google_drive_file` - Read full content of Google Doc, Sheet, PDF, etc.
- `search_oracle_kb` - Search indexed knowledge base metadata (faster than Drive search)

**Create**:
- `create_google_drive_folder` - Create new folders with permissions
- `create_google_doc` - Create formatted Google Docs
- `create_google_sheet` - Create Google Sheets with data and formulas

### Research Tools

**Web Research**:
- `WebSearch` - Real-time search engine access
- `WebFetch` - Fetch and parse specific URLs

**Memory**:
- `Memory` - Maintain context across conversation, store key information

### VisualPing Integration (Planned)

**Website Monitoring**:
- Webhook receiver for page change alerts
- Automated processing of change notifications
- Client matching and alert generation

---

## Department-Specific Use Cases

### Writers Department

**Primary Needs**:
- Application templates (CanExport, ETG, BCAFE, IRAP, etc.)
- Program-specific guidelines and rubrics
- Examples of successful past applications
- Writing best practices and style guides

**Example Queries**:
- "Show me successful IRAP project descriptions from past applications"
- "What are the evaluation criteria for ETG business cases?"
- "Find the CanExport SME budget template"
- "Generate a draft project description for [Client]'s innovation project"
- "What's the max word count for BCAFE market analysis section?"

**Workflows**:
1. **Start New Application**:
   - "I'm starting a CanExport application for TechCorp"
   - Oracle loads: Template, guidelines, client context from HubSpot, similar examples
   - Returns: Document structure, key requirements, client background, past success examples

2. **Quality Check**:
   - "Review this project description against IRAP criteria"
   - Oracle analyzes against rubric, identifies gaps, suggests improvements

3. **Find Precedent**:
   - "Find applications where we described cybersecurity R&D"
   - Returns examples with specific language that worked

---

### Strategy Department

**Primary Needs**:
- Discovery call scripts and intake processes
- Pricing guides for all services
- Readiness assessment tools
- Proposal generation and client communications

**Example Queries**:
- "Generate a proposal for a mid-size manufacturer interested in IRAP"
- "What questions should I ask during an export readiness discovery call?"
- "Find all companies in HubSpot that we've marked as 'Not Ready' - why?"
- "Build a lead list of BC tech companies that could use the new Export Tech Grant"
- "Draft a follow-up email for a prospect who said we're too expensive"

**Workflows**:
1. **Pre-Discovery Research**:
   - "Research [Company Name] before tomorrow's discovery call"
   - Oracle: Web research, checks HubSpot, finds industry insights, suggests questions

2. **Proposal Generation**:
   - "Create a proposal for [Client] - IRAP + ETG combo"
   - Oracle: Loads client context, calculates pricing, finds case studies, generates proposal

3. **Deal Risk Analysis**:
   - "Why is the [Client] deal stalled?"
   - Oracle: Analyzes email history, identifies last touchpoint, suggests next steps

4. **Lead Generation**:
   - "Find 20 prospects for the new Clean Manufacturing grant"
   - Oracle: Searches web + HubSpot, builds list, suggests outreach strategy

---

### Research Department

**Primary Needs**:
- Grant program databases and eligibility criteria
- Rubrics and grading systems
- Research methodologies and SOPs
- Competitive grant intelligence

**Example Queries**:
- "What are the current eligibility requirements for NRC IRAP?"
- "Compare federal vs. BC export grant programs"
- "Find all grant programs that support agriculture + technology"
- "Has IRAP's innovation definition changed in the past year?"
- "What's our process for grading grant applications?"

**Workflows**:
1. **Eligibility Research**:
   - "Is [Client] eligible for Strategic Innovation Fund?"
   - Oracle: Loads SIF criteria, analyzes client profile from HubSpot, provides yes/no with reasoning

2. **Program Comparison**:
   - "Compare IRAP vs. BCIP for a manufacturing R&D project"
   - Oracle: Synthesizes program guidelines, creates comparison table

3. **Competitive Intelligence**:
   - "Who else is applying to this grant? What's their approach?"
   - Oracle: Searches public databases, analyzes competitor success patterns

---

### Marketing Department

**Primary Needs**:
- Content calendars and campaign plans
- Customer story templates
- Webinar topics and partnership materials
- Success metrics and case study data

**Example Queries**:
- "Find successful CanExport case studies I can use for the blog"
- "What are our top 5 grant programs by revenue? Should we promote them more?"
- "Generate a customer success story for [Client]'s IRAP project"
- "What webinar topics would resonate with manufacturing companies?"
- "Find all clients who've won grants over $100K - potential testimonials"

**Workflows**:
1. **Content Creation**:
   - "Write a blog post about the new Export Tech Innovation Grant"
   - Oracle: Researches program, finds relevant client examples, drafts post

2. **Campaign Planning**:
   - "Build a Q2 campaign targeting clean tech companies"
   - Oracle: Identifies relevant programs, builds target list, suggests content

3. **Performance Analysis**:
   - "Which grant programs generate the most leads?"
   - Oracle: Analyzes HubSpot data, identifies trends, recommends focus areas

---

### GCs (General Counsel / Operations)

**Primary Needs**:
- Branding and compliance guidelines
- Hiring processes and templates
- Claim submission procedures
- Contract templates and legal resources

**Example Queries**:
- "What's the process for submitting a CanExport claim?"
- "Find the brand color codes and logo usage guidelines"
- "Where's the hiring checklist for new writers?"
- "What's required to file an ETG claim?"

**Workflows**:
1. **Claims Processing**:
   - "Walk me through submitting an IRAP claim"
   - Oracle: Loads SOP, provides checklist, finds templates, answers questions

2. **Compliance Check**:
   - "Does this marketing material follow our brand guidelines?"
   - Oracle: Reviews against guidelines, identifies issues, suggests fixes

---

## Example Conversation Flows

### Example 1: Comprehensive Lead Generation

**User**: "Find me potential clients for the new BC Clean Manufacturing grant"

**Oracle**:
1. **Researches the program** (WebSearch + VisualPing alert if available)
   - Funding: Up to $500K
   - Eligibility: BC manufacturers implementing clean tech
   - Deadline: June 30, 2026

2. **Searches HubSpot**:
   - Finds 23 manufacturing companies in BC
   - Filters for those with < 500 employees (grant cap)
   - Prioritizes those with past grant interest

3. **Enhances with web research**:
   - Checks company websites for sustainability initiatives
   - Identifies those with recent expansions or equipment upgrades
   - Finds 8 high-potential prospects not in CRM

4. **Returns prioritized list**:
   ```
   HIGH PRIORITY (8 clients):
   1. GreenTech Manufacturing (HubSpot) - Past IRAP client, expressed interest in clean tech
   2. SustainableFab Inc. (HubSpot) - Currently in discovery for ETG, perfect fit
   3. [...]

   MEDIUM PRIORITY (15 clients):
   [...]

   NEW PROSPECTS (8 companies):
   1. CleanProduction Systems - Not in CRM, found via web research
      - 150 employees, BC-based, recent clean tech certifications
      - LinkedIn shows hiring for sustainability role
      - Recommend: Cold outreach via LinkedIn + email
   [...]
   ```

5. **Suggests next steps**:
   - Draft outreach emails for top 10 (would you like me to generate these?)
   - Add new prospects to HubSpot with source tracking
   - Create campaign in HubSpot: "Clean Manufacturing Grant Q1 2026"
   - Schedule follow-up tasks for account owners

---

### Example 2: Deal Acceleration

**User**: "The TechCorp CanExport deal has been sitting in 'Proposal Sent' for 3 weeks. What should I do?"

**Oracle**:
1. **Loads deal context** from HubSpot:
   - Proposal sent: Dec 20, 2025
   - Last activity: Dec 22 (they opened email twice)
   - Contact: Sarah Chen, CEO
   - Proposal amount: $8,500
   - No responses to 2 follow-up emails

2. **Analyzes situation**:
   - **Win Probability**: 35% (below average for this stage)
   - **Risk Factors**:
     - Longer than average silence (avg: 8 days, current: 21 days)
     - Multiple follow-ups with no response (ghosting pattern)
     - No questions asked (may indicate lack of understanding or interest)
   - **Similar Deal Pattern**: 60% of deals with this pattern end up "Lost - No Response"

3. **Researches company** (WebSearch + HubSpot history):
   - TechCorp just announced Series A funding round ($2M) last week
   - LinkedIn shows they hired a new COO
   - Past discovery notes mentioned "need board approval for external consultants"

4. **Provides recommendations**:
   ```
   LIKELY ISSUE: Internal changes (funding round + new COO) = decision-making delays

   NEXT-BEST-ACTIONS:
   1. [HIGH PRIORITY] Re-engage with different angle:
      - Reference their funding round in congratulations email
      - Tie CanExport to their new growth phase
      - Offer to present to board (address approval requirement from discovery)

   2. [MEDIUM] Offer value-add to restart conversation:
      - Send free resource: "Export Readiness Checklist for Series A Companies"
      - Shows expertise without asking for decision

   3. [LOW] Adjust proposal:
      - Consider payment plan (split into milestones)
      - Reduces risk for company in transition

   DRAFT EMAIL: Would you like me to generate a re-engagement email using approach #1?
   ```

5. **User**: "Yes, write the email"

6. **Oracle generates**:
   ```
   Subject: Congratulations on TechCorp's Series A! 🎉

   Hi Sarah,

   I saw the exciting news about TechCorp's $2M Series A round - congratulations! This is a huge milestone.

   I wanted to reconnect about the CanExport opportunity we discussed. With your new growth capital and international expansion plans, the timing might be even better now. The grant could offset your export development costs by up to $75,000.

   I remember you mentioned needing board approval for external consultants. Happy to jump on a 15-minute call with you and your new COO to answer any questions and show how CanExport fits into your expansion strategy.

   Are you available for a brief chat next week?

   Best,
   [Your Name]
   ```

---

### Example 3: Knowledge Synthesis

**User**: "How do our pricing strategies differ between federal and provincial grant programs?"

**Oracle**:
1. **Searches knowledge base**:
   - Finds: "Strategy Pricing Guide 2025.docx"
   - Finds: "Federal Programs Pricing Structure.pdf"
   - Finds: "BC Provincial Grants - Service Rates.xlsx"

2. **Reads and analyzes** 3 documents

3. **Searches HubSpot** for actual deal data to validate pricing docs

4. **Synthesizes findings**:
   ```
   FEDERAL VS. PROVINCIAL PRICING STRATEGIES

   **Federal Programs (IRAP, SIF, CanExport SME)**:
   - Pricing: Primarily flat-fee based on service tier
   - Range: $6,500 - $15,000 depending on complexity
   - Rationale: Programs have stricter requirements, higher stakes, longer timelines
   - Success Fee: Rare (only for SIF projects > $500K)

   **Provincial Programs (BCAFE, ETG, BCIP)**:
   - Pricing: Mix of flat-fee and percentage-based
   - Range: $3,500 - $8,000 base + optional 5% success fee on grants < $50K
   - Rationale: Faster turnaround, simpler requirements, more competitive market
   - Success Fee: More common (30% of BC clients opt for success fee pricing)

   **KEY DIFFERENCES**:
   1. Federal programs priced 40-50% higher on average
   2. Provincial programs more likely to use success fees
   3. Federal clients less price-sensitive (larger grant amounts justify higher fees)
   4. Provincial market more competitive (need flexible pricing)

   **CONSISTENCY ISSUES FOUND**:
   - ⚠️ ETG pricing varies between $4,500-$6,500 across documents (Strategy Guide vs. Pricing Sheet)
   - ⚠️ CanExport success fee mentioned in 2023 pricing doc but not current guide (still offered?)

   **ACTUAL DEALS (from HubSpot, last 6 months)**:
   - Federal average: $9,200 (n=42)
   - Provincial average: $5,400 (n=67)
   - Confirms pricing strategy is consistently applied

   **RECOMMENDATION**:
   Update ETG pricing documentation to reflect consistent rate ($5,500 standard based on most recent deals).
   ```

---

## Implementation Priorities

### Phase 1: Foundation (Current State)
- ✅ Knowledge base indexing (515 documents)
- ✅ Basic search and retrieval
- ✅ HubSpot integration (some tools)
- ✅ Web search and research
- ✅ Google Drive read/write
- ⏸️ System prompt updates for strategic capabilities

### Phase 2: Strategic Intelligence (Next 2-4 Weeks)
- [ ] Update system prompt with lead generation workflows
- [ ] Update system prompt with deal closing workflows
- [ ] Add all HubSpot tools to Oracle's capabilities
- [ ] Create test prompt battery
- [ ] Run pilot testing with strategy team
- [ ] Gather feedback and refine

### Phase 3: Automation (4-8 Weeks)
- [ ] Implement VisualPing webhook endpoint
- [ ] Build automated alert processing workflow
- [ ] Add Slack integration for proactive notifications
- [ ] Create automated lead scoring system
- [ ] Develop win probability prediction model

### Phase 4: Advanced Features (2-3 Months)
- [ ] Predictive analytics for deal forecasting
- [ ] Automated proposal generation pipeline
- [ ] Competitive intelligence dashboard
- [ ] Historical trend analysis and reporting
- [ ] Custom team member workflows and preferences

---

## Success Metrics

### Knowledge Management
- **Response Time**: < 30 seconds for document retrieval
- **Accuracy**: 95%+ relevant results for searches
- **Coverage**: 100% of departments have docs indexed
- **Freshness**: Reindex cycle < 2 weeks for active departments

### Lead Generation
- **Leads Identified**: 50+ qualified leads per month
- **Match Accuracy**: 80%+ of identified leads confirmed relevant by team
- **Conversion Rate**: Track Oracle-sourced leads through pipeline
- **Time Saved**: Reduce research time from 2 hours → 15 minutes per lead

### Deal Closing
- **Proposal Speed**: Generate proposals in 15 minutes vs. 2 hours
- **Win Rate**: Increase from baseline (track Oracle-assisted vs. non-assisted deals)
- **Deal Velocity**: Reduce average sales cycle by 20%
- **Deal Value**: Increase average deal size through upselling and cross-selling recommendations

### Market Intelligence
- **Alert Response Time**: < 1 hour from grant page change to team notification
- **Opportunity Capture**: Zero missed grant programs or deadline extensions
- **Competitive Wins**: Track deals won against known competitors
- **Proactive Outreach**: 10+ proactive client alerts per month for relevant changes

### Team Adoption
- **Usage Rate**: 80%+ of team uses Oracle weekly
- **Query Volume**: 100+ queries per week
- **Satisfaction**: Net Promoter Score > 8/10
- **Time Saved**: 10+ hours per team member per month

---

## Next Steps

1. **Immediate** (This Week):
   - [ ] Review this scope document with leadership
   - [ ] Prioritize Phase 2 features based on business needs
   - [ ] Get strategy team input on most valuable capabilities
   - [ ] Decide on VisualPing subscription tier

2. **Short-Term** (Next 2 Weeks):
   - [ ] Update Oracle system prompt (`.claude/agents/internal-oracle.md`)
   - [ ] Add missing HubSpot tools to agent configuration
   - [ ] Create and run test prompt battery
   - [ ] Gather initial feedback from 3-5 team members

3. **Medium-Term** (Next Month):
   - [ ] Implement VisualPing integration
   - [ ] Build Slack notification system
   - [ ] Develop automated lead scoring logic
   - [ ] Create Oracle user guide for team

4. **Long-Term** (Next Quarter):
   - [ ] Launch full team rollout with training
   - [ ] Build analytics dashboard for Oracle usage
   - [ ] Develop advanced prediction models
   - [ ] Integrate with additional data sources (LinkedIn Sales Navigator, etc.)

---

## Appendix: System Prompt Outline

**What needs to be added to** `.claude/agents/internal-oracle.md`:

### Response Mode Instructions
- When to use each mode (Retrieval vs. Synthesis vs. Creation)
- How to format output for each mode
- Citation requirements

### Strategic Intelligence Workflows
- Lead generation procedures
- Deal closing support procedures
- Market intelligence analysis procedures
- VisualPing alert processing

### HubSpot Integration Guidelines
- When to load company context
- How to cross-reference data sources
- Privacy and sensitivity considerations

### Tool Usage Patterns
- Orchestration examples (multiple tools in sequence)
- Context layering (internal + external research)
- Proactive vs. reactive behavior

### Output Standards
- Formatting conventions
- Citation style
- Recommendation structure
- Priority level definitions

---

**Document Version**: 1.0
**Last Updated**: January 13, 2026
**Next Review**: After Phase 2 pilot testing

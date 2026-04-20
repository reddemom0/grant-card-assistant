# GetGranted AI Assistant - Product Strategy Document

## Executive Summary

This document outlines the strategic vision, business model, technical approach, and implementation roadmap for transforming Granted Consulting's internal AI agent system into a client-facing product integrated with GetGranted 2.0.

**Core Concept**: Embedded AI specialist within GetGranted 2.0 - like "HubSpot's AI for grants"

**Target Market**: Small-to-medium Canadian businesses seeking grant funding

**Revenue Model**: Subscription-based SaaS with tiered pricing and program-specific agent add-ons

**Timeline**: 6-month MVP build, 12-month market validation, 24-month category leadership

---

## 1. Product Vision & Value Proposition

### The Opportunity

GetGranted 2.0 currently helps businesses:
- Discover relevant grants
- Track applications and deadlines
- Store documents
- Monitor funding secured

**The Missing Piece**: Actually writing compelling, winning grant applications.

### Product Positioning

**GetGranted 2.0** = The operating system for grant management (CRM, project management, database)

**AI Assistant** = The expert employee who does the hard work (writing, strategy, coaching)

Think:
- Salesforce + Einstein AI
- HubSpot + ChatSpot
- Notion + Notion AI

### Value Proposition by User Need

| User Need | GetGranted 2.0 Solution | AI Assistant Enhancement |
|-----------|------------------------|--------------------------|
| Finding grants | Smart recommendations, filters | Oracle explains eligibility, compares programs |
| Understanding eligibility | Program criteria displayed | Deep-dive Q&A: "Do I qualify if I already export?" |
| Assessing readiness | Watchlists, notifications | Readiness check: "Are you prepared to apply?" |
| Writing applications | Document storage | Program-specific writers draft full applications |
| Strategy & prioritization | Tracking dashboard | "You have 3 deadlines - which should you prioritize?" |
| Supporting documents | File storage | Draft letters of support, project plans |
| Learning the platform | Knowledge base articles | Interactive help: "How do I set up notifications?" |

**Tagline**: *"GetGranted finds the right grants. AI Assistant helps you win them."*

---

## 2. Product Architecture

### Agent Suite

**Oracle (Core Product)**
- Central AI assistant for general grant questions
- Basic readiness assessments across all programs
- Strategic recommendations based on user profile
- GetGranted platform help and onboarding
- Acts as "front door" that triages users to specialized agents
- **Included with base subscription**

**Program-Specific Writers (Premium Add-ons)**
- CanExport SME Writer
- BuyBC Partnership Program Writer
- ETG (Employee Training Grant) Writer
- BCAFE (BC Agriculture & Food Export) Writer
- Additional programs added as demand requires

Each program writer includes:
- Deep program-specific readiness assessment
- Step-by-step application guidance
- Section-by-section drafting assistance
- Full application generation
- Draft critique and improvement suggestions
- Budget justification help

### User Experience

**Two Access Points:**

1. **Oracle Popout Widget**
   - Persistent chat window available anywhere on GetGranted 2.0
   - Quick questions while browsing grants
   - Like Intercom/Drift chat bubbles

2. **AI Hub Page**
   - Dedicated full-screen workspace
   - Agent switcher in sidebar (Oracle + purchased program agents)
   - Conversation history (ChatGPT-style)
   - Usage dashboard (credits remaining, apps drafted)
   - Account settings and upgrade marketplace
   - Progress tracking for applications in draft

---

## 3. Pricing Models

### Model 1: "Base + Add-Ons"
*Simple, modular approach*

**AI Assistant Base** - $99/month
- Oracle (unlimited conversations)
- 100 AI credits/month (1 credit ≈ 1 message)
- GetGranted 2.0 integration

**Program Writer Add-Ons** - $79/month each
- Unlock individual program agents
- Includes program-specific readiness
- Uses credits from base plan

**Credits Top-Up**: $29 for 50 extra credits

*Example*: Company needs CanExport + BuyBC = $99 + $79 + $79 = **$257/month**

---

### Model 2: "Tiered Bundles" ⭐ RECOMMENDED
*Good/Better/Best structure*

**AI Essentials** - $99/month
- Oracle (unlimited)
- 100 credits/month
- Choose **1 program writer**

**AI Professional** - $199/month
- Oracle (unlimited)
- 250 credits/month
- Choose **any 3 program writers**
- Priority support

**AI Enterprise** - $349/month
- Oracle (unlimited)
- 500 credits/month
- **All program writers** (unlimited)
- Dedicated account manager
- API access (future)

**Why Recommended:**
- Easy to understand for customers
- Predictable revenue
- Natural upsell path (Essentials → Professional → Enterprise)
- Mirrors GetGranted's existing Lite/Standard/Plus structure
- Credit limits + program caps prevent arbitrage

---

### Model 3: "Credit-Centric"
*Maximum flexibility like ChatGPT Plus*

**AI Assistant** - $149/month
- Oracle (unlimited)
- 200 credits/month
- Unlock program writers à la carte ($49/month each)

**Credit Economics:**
- Basic Oracle question: 1-2 credits
- Readiness assessment: 10 credits
- Section draft: 20 credits
- Full application draft: 80-100 credits

**Credits Top-Up**: $49 for 100 credits, $99 for 250 credits

---

### Model 4: "Hybrid Consumption"
*Pay-as-you-grow model*

**AI Starter** - $79/month
- Oracle (unlimited)
- 50 credits/month

**Program Writers:**
- One-time unlock: $199/program (lifetime access)
- OR Monthly rental: $59/program

**Credit Packages:**
- 100 credits: $39
- 250 credits: $89
- 500 credits: $149

*Example*: Pay $199 once for CanExport, then $79/month base + credits as needed
- Year 1 cost: $79 × 12 + $199 = $1,147 vs. Model 1 at $2,136

---

## 4. Protecting Against Competitive Arbitrage

### The Risk

Competing consultants could purchase access and resell AI-generated applications to businesses that could have been direct customers, undercutting Granted's consulting business.

### Protection Strategy (3-Layer Defense)

#### Layer 1: Pricing Strategy (Economic Deterrent)
- **Price at 50-70% of consulting fees** for equivalent service
  - If CanExport consulting = $3-5K, annual AI access = $1.5-2.5K
- Makes arbitrage economically unviable (thin margins after software cost + labor)
- Annual contracts preferred over monthly (harder to flip for one-off projects)

#### Layer 2: Terms of Service & Legal
```
Prohibited Uses:
- Commercial resale of AI-generated content
- Use by grant consulting businesses or intermediaries
- Sharing account access with third parties
- White-labeling or rebranding outputs

Violation = Immediate termination + legal action
```

Provides legal recourse and deters risk-averse bad actors.

#### Layer 3: Behavioral Monitoring & Anomaly Detection
**Flag suspicious patterns:**
- Multiple applications for different company industries
- Rapid-fire drafting (consultant behavior vs. business owner)
- Login from multiple IPs/locations
- Copy-paste heavy usage (templating at scale)

**Progressive enforcement:**
1. Warning notification
2. Account restriction (manual review required)
3. Termination + refund denial

**Implementation**: Automated monitoring with manual review queue for suspicious accounts.

---

## 5. Technical Architecture

### Integration Options

#### Option 1: "Embedded Integration"
AI lives inside GetGranted 2.0's codebase as a native feature.

**How it works:**
- GetGranted handles all auth, billing, user management
- AI endpoints added to GetGranted's backend
- Shared database (Postgres) for user data + conversations
- AI Hub is just another page in GetGranted

**Pros:** Seamless UX, shared data, single login
**Cons:** Tightly coupled, requires GetGranted team coordination
**Best for:** If GetGranted 2.0 is already built and has dev team available

---

#### Option 2: "Microservice Integration" ⭐ RECOMMENDED
AI Assistant is separate service that talks to GetGranted via API.

**How it works:**
- AI runs independently (current Railway setup)
- GetGranted embeds AI via iframe or API calls
- GetGranted passes auth token → AI knows user identity
- AI writes data back to GetGranted via API
- Separate databases, connected via APIs

**Pros:**
- Clean separation of concerns
- Faster to build (leverage existing agent codebase)
- Can iterate independently
- Easier scaling

**Cons:**
- Requires GetGranted API (may need to be built)
- Slightly more complexity

**Best for:** Parallel development, maintains flexibility

---

#### Option 3: "Widget/Plugin Model"
Completely standalone product that plugs into GetGranted.

**How it works:**
- Separate app with own auth and billing
- Users "Connect AI Assistant" via OAuth
- AI pulls data from GetGranted via API
- Can work with or without GetGranted

**Pros:** Maximum flexibility, can sell to other platforms
**Cons:** More friction (separate login/billing), feels less integrated
**Best for:** If planning to eventually sell beyond GetGranted

---

### Data Integration (Bi-directional)

**AI Reads from GetGranted 2.0:**
- Company profile (industry, size, revenue, location)
- Eligibility matches (which programs they qualify for)
- Program details (deadlines, funding amounts, criteria)
- Application status/history
- User preferences and settings

**AI Writes to GetGranted 2.0:**
- Save application drafts to user workspace
- Update application status ("Draft in Progress", "Ready to Submit")
- Track which programs used AI assistance
- Log conversation summaries for compliance
- Usage metrics (credits consumed, features used)

**Authentication Flow:**
- User logs into GetGranted 2.0 (existing auth)
- GetGranted generates session token
- Passes token to AI Assistant
- AI validates token and loads user context
- Single sign-on experience

---

### Technology Stack

**Current Components to Retain:**
- ✅ Railway deployment
- ✅ Node.js backend (Express/serverless functions)
- ✅ Upstash Redis (conversation state)
- ✅ Claude API (Anthropic)
- ✅ JWT authentication

**Components to Modify:**
- 📝 Knowledge base: Google Drive → Distilled agent knowledge + RAG
- 📝 Remove: HubSpot integration (internal CRM, not client-facing)
- 📝 Remove: Dropbox integration (replaced by GetGranted storage)

**New Components to Add:**
- ➕ GetGranted 2.0 API integration
- ➕ Credit/usage tracking system
- ➕ Subscription management (Stripe)
- ➕ Vector database for RAG (Upstash Vector, Pinecone, or Weaviate)
- ➕ Analytics pipeline (user behavior tracking)

---

## 6. Knowledge Base Strategy

### Hybrid Approach: Static + RAG

#### Static Baked-In Knowledge (Core Methodology)
**For each program agent:**
- Pre-processed expertise distilled directly into system prompts
- Your 30+ years of grant methodology embedded
- Writing patterns, prioritization rules, red flags
- Updated quarterly or when program guidelines change

**Why:** Fast, predictable, no external dependencies

**Process:**
- Team spends time researching/designing each agent for current program year
- Becomes your IP product (how you draft, what you prioritize, what to avoid)
- Final version goes into agent system prompt (like current skills architecture)

---

#### RAG (Retrieval Augmented Generation) for Examples
**Dynamic retrieval of historical applications**

**Challenge:** Need to use examples without revealing client confidentiality

**Solution: Anonymized RAG Pipeline**

**Step 1: Document Sanitization (before indexing)**
Strip all PII from historical applications:
- Company names → `[Food & Beverage Company A]` or `[Client Company]`
- Specific dollar amounts → Ranges: `$75K-$100K` or remove
- Dates/locations → Generalize: `Q2 2024`, `U.S. West Coast markets`
- Contact info, names → Remove entirely
- Proprietary business details → Redact or generalize

**Step 2: Preserve What Matters**
- ✅ Writing style, narrative structure, argumentation
- ✅ Market research positioning, competitive advantage framing
- ✅ Project description frameworks, budget justification logic
- ✅ Success patterns (mark approved applications as high-quality)

**Step 3: Metadata Tagging**
Index with searchable metadata:
```json
{
  "program": "CanExport",
  "industry": "Food & Beverage",
  "project_type": "Market expansion",
  "target_market": "United States",
  "approval_status": "Approved",
  "year": "2024",
  "funding_range": "75k-100k"
}
```

**Step 4: System Prompt Safeguards**
```
CONFIDENTIALITY RULES:
- NEVER mention specific client company names
- NEVER cite exact dollar amounts from examples
- NEVER reference identifiable business details
- When using examples, say "A similar company in your industry..."
- Focus on approach/methodology, not client specifics
```

**Step 5: Retrieval Logic**
When user asks: "How do I write a CanExport for my food company?"
1. Agent queries RAG: `program=CanExport, industry=Food & Beverage`
2. Retrieves 3-5 anonymized examples
3. Uses them to inform writing style/structure
4. Generates response: *"For food & beverage companies, successful applications typically emphasize..."*

**Example:**

**Original Document (never shown)**
> "Fine Choice Foods Inc. seeks $85,000 to expand organic sauce distribution to California, Oregon, and Washington. CEO Sarah Johnson has 15 years..."

**Anonymized in RAG**
> "[Food & Beverage Company] seeks funding to expand [product category] distribution to [U.S. West Coast markets]. Leadership has [10+ years] experience..."

**AI Response**
> "For food & beverage companies targeting U.S. West Coast markets, I recommend emphasizing your leadership's deep sector experience and specific distribution channels..."

---

### Maintenance Strategy

**Quarterly updates:**
- Review program guideline changes
- Add newly approved applications (anonymized) to RAG
- Update system prompts for policy changes
- Remove outdated examples

**Annual agent rebuild:**
- Major refresh for each program's new cycle
- Team dedicates time to research and update methodology
- Version control for agent configurations

---

## 7. Data Collection & Analytics

### User Behavior Tracking

**Engagement Metrics:**
- Which agents used most frequently
- Average conversation length per agent
- Drop-off points (where users abandon)
- Time to complete application draft
- Common questions/prompts
- Feature usage (export, save, critique)

**Conversion Funnel:**
- Oracle usage → Readiness assessment → Program writer purchase
- Free tier → Paid tier upgrades
- Single program → Multiple programs

---

### AI Performance Metrics

**Technical:**
- Token usage per conversation
- Response time/latency
- Error rates (failed API calls, context overflows)
- Cache hit rates

**Quality:**
- User satisfaction (thumbs up/down on responses)
- Edit patterns (how much users change AI drafts)
- Conversation restart rate (user dissatisfaction signal)
- Feature discovery (% users who find advanced features)

---

### Business Intelligence

**Revenue Metrics:**
- MRR (Monthly Recurring Revenue)
- Credits consumed per agent
- ROI per customer (usage vs. subscription price)
- Churn indicators (decreased usage before cancellation)
- LTV (Lifetime Value) by tier

**Success Tracking:**
- Application submission rate (% of drafts actually submitted)
- Grant win rate for AI-assisted applications (tracked via GetGranted outcomes)
- Funding secured per user
- Repeat usage (apply to multiple programs)

---

### Quality Improvement Data

- Full conversation logs (anonymized for privacy)
- Successful applications flagged for training data
- User feedback/corrections to improve prompts
- A/B test results for different system prompts
- Common failure patterns

**Storage:** Postgres + Redis, analyzed via dashboard or piped to Mixpanel/Amplitude

---

## 8. Success Metrics & KPIs

### Month 1-3 (Beta Phase)
- ✅ 20+ pilot users actively using Oracle
- ✅ 70%+ users have 3+ conversations
- ✅ Net Promoter Score (NPS) > 40
- ✅ <5% bug/error rate

### Month 6 (Launch)
- ✅ 100+ paying subscribers
- ✅ $10K+ MRR
- ✅ 5+ applications drafted per week
- ✅ 60%+ user satisfaction rating

### Month 12 (Year 1)
- ✅ 300+ subscribers
- ✅ $30K+ MRR
- ✅ 4 program agents launched
- ✅ 50%+ of program agent users submit applications
- ✅ 60%+ win rate for AI-assisted applications

### Month 24 (Year 2)
- ✅ 500-1000+ subscribers
- ✅ $50K-$150K MRR
- ✅ 7+ program agents covering major Canadian programs
- ✅ Market leadership position in Canadian AI grant assistance

---

## 9. Competitive Analysis

### Current Landscape

**Direct Competitors (Canada):** Essentially none.
- No AI-specific grant writing tools focused on Canadian market
- Traditional consulting firms (Granted already competes here)

**Adjacent Competitors:**
- **Generic AI tools** (ChatGPT, Claude) - users try DIY but lack grant expertise and context
- **US-focused AI grant tools** (GrantAI, Grantable) - don't understand Canadian programs or eligibility
- **Traditional consultants** - expensive, slow turnaround, limited capacity

---

### Competitive Moats

1. **30+ years Canadian grant expertise** baked into agent methodology
2. **Integration with GetGranted 2.0** - data advantage (user profile, eligibility, history)
3. **Program-specific specialization** - not generic writing tool
4. **Anonymized historical applications** - proprietary training data from real wins
5. **First-mover advantage** in Canadian AI grant assistance market
6. **Trusted brand** - Granted Consulting's reputation and relationships with grantors

---

### Positioning Statement

*"The only AI grant assistant built specifically for Canadian businesses by Canada's leading grant experts."*

**Key differentiators:**
- ✅ Canadian program expertise (not generic US tool)
- ✅ Proven methodology from 1000+ successful applications
- ✅ Integrated with grant management platform (seamless workflow)
- ✅ Built by grant consultants who actually win grants

---

## 10. Risk Analysis & Mitigation

### Technical Risks

**Risk:** GetGranted 2.0 API doesn't exist or isn't robust enough
- **Impact:** Delays integration, limits functionality
- **Mitigation:** Assess API status immediately; budget 2-3 months for API development if needed
- **Fallback:** Launch standalone initially, integrate later

**Risk:** RAG system leaks confidential client information
- **Impact:** Legal liability, trust damage, competitive harm
- **Mitigation:** Comprehensive anonymization pipeline, regular audits, separate client/internal databases
- **Testing:** Extensive testing with red-team approach before launch

**Risk:** Claude API changes pricing or terms
- **Impact:** Margin compression, need to raise prices
- **Mitigation:** Build margin buffer into pricing, monitor usage closely, have alternate LLM providers researched

---

### Market Risks

**Risk:** Users don't trust AI for high-stakes applications
- **Impact:** Low adoption, high churn
- **Mitigation:**
  - Position as "assistant" not "replacement"
  - Offer hybrid tier with consultant review
  - Showcase success stories and win rates
  - Free trial to prove value

**Risk:** Low adoption from GetGranted user base
- **Impact:** Failed launch, wasted development
- **Mitigation:**
  - Beta program with early adopters
  - Free trial period (first month)
  - In-app prompts and education
  - Compelling onboarding (show value immediately)

**Risk:** Grant application volume too low (seasonal)
- **Impact:** Inconsistent revenue, high churn
- **Mitigation:**
  - Oracle provides year-round value (strategy, readiness)
  - Program agents align with grant cycles
  - Annual plans for committed funding seekers
  - Content/education keeps users engaged between applications

---

### Business Risks

**Risk:** Cannibalizes consulting revenue
- **Impact:** Net negative for Granted Consulting
- **Mitigation:**
  - Position AI as volume/DIY tier, consulting as premium
  - Hybrid model: AI drafts, consultants review (higher margins)
  - Consulting becomes more strategic (less execution work)
  - Track net revenue impact closely

**Risk:** Competitors copy once launched
- **Impact:** Loss of first-mover advantage
- **Mitigation:**
  - Speed to market (launch fast, iterate)
  - Data moat (historical applications, user data)
  - Brand and trust (Granted's reputation)
  - Continuous improvement (stay ahead on quality)

**Risk:** Pricing wrong (too high = no adoption, too low = unprofitable)
- **Impact:** Revenue targets missed
- **Mitigation:**
  - Beta testing with multiple price points
  - Monitor unit economics closely
  - Willingness to adjust in first 6 months
  - Survey users on perceived value

---

### Regulatory Risks

**Risk:** Grant programs prohibit AI-assisted applications
- **Impact:** Product becomes unusable for certain programs
- **Mitigation:**
  - Currently no rules against AI assistance
  - Monitor policy changes proactively
  - Position as "tool" not "ghost writer"
  - Users ultimately responsible for content
  - Legal review of terms and positioning

---

## 11. Go-to-Market Strategy

### Pre-Launch (Months 4-5)

**Beta Program**
- Recruit 20 GetGranted users for 3-month free pilot
- Target mix: repeat grant applicants, new seekers, different industries
- Weekly check-ins for feedback
- Gather testimonials and case studies
- Refine product based on real usage

**Early Adopter Incentives**
- Lifetime discount (20% off) for beta participants
- First access to new program agents
- Direct line to product team

---

### Launch Week (Month 6)

**Announcement Campaign**
- Email blast to all GetGranted users: "Meet Oracle: Your AI Grant Strategist"
- Webinar: "How AI Can Double Your Grant Success Rate"
  - Live demo of Oracle + CanExport writer
  - Q&A with Granted experts
  - Special launch offer for attendees

**Launch Offer**
- First month free, or
- 50% off first 3 months, or
- Free Oracle forever + discounted program agents

**PR Push**
- Press release: "Canadian grant leader launches AI assistant"
- Pitch to Canadian business media (BetaKit, BC Business)
- LinkedIn content from Granted leadership
- Success stories from beta users

---

### Post-Launch (Months 7-12)

**Content Marketing**
- Blog series: "AI for Grant Writing", "Grant Strategy Tips"
- LinkedIn thought leadership from Granted team
- Video tutorials: "How to use Oracle", "CanExport deep dive"
- Success case studies: "How [Company X] secured $150K"

**In-App Growth Tactics**
- Contextual prompts: When viewing grants, "Ask Oracle if you qualify"
- Usage nudges: "You haven't talked to Oracle in 2 weeks - need help?"
- Feature discovery: "Did you know Oracle can compare multiple grants?"
- Upgrade prompts: "Unlock CanExport Writer to draft this application"

**Referral Program**
- Give $25 credit, Get $25 credit
- Leaderboard for top referrers
- Bonus for companies that get 3+ referrals

**Partnership Outreach**
- Chambers of Commerce (co-marketing)
- Industry associations (guest webinars)
- Business accelerators (offer discounts to cohorts)
- Accounting firms (refer clients needing grants)

---

### Program Agent Launch Strategy

**Timed to Grant Cycles**
- "CanExport just opened for applications - our AI can help!"
- Targeted emails to eligible companies (based on GetGranted data)
- Industry-specific campaigns: Email food/beverage companies when BCAFE launches

**Launch Webinars**
- "Mastering CanExport with AI" (live walkthrough)
- "BuyBC Application Clinic" (draft in real-time)
- "ETG Strategies for Manufacturers"

**Urgency Messaging**
- "Deadline in 30 days - let AI help you apply"
- "Limited spots: Join our CanExport cohort"

---

### Channels

**Primary (Owned):**
- GetGranted 2.0 user base (warm audience)
- Granted Consulting email list
- Granted website and blog

**Secondary (Earned/Paid):**
- LinkedIn (B2B decision-makers)
- Google Ads (grant-related searches)
- Facebook/LinkedIn groups (business owners, grant seekers)
- Podcast sponsorships (Canadian business shows)

**Partnerships:**
- Business associations
- Industry groups
- Accelerators and incubators
- Government small business services

---

## 12. Implementation Roadmap

### 6-Month Timeline (Oracle MVP)

#### **Month 1-2: Foundation (8-10 weeks)**
- **Week 1-2:** Requirements finalization, architecture design
- **Week 3-4:** GetGranted 2.0 API integration (or API development if needed)
- **Week 5-6:** Oracle agent development (system prompt, conversation logic)
- **Week 7-8:** Credit tracking system backend
- **Week 9-10:** Payment integration (Stripe setup)

**Deliverables:**
- Functional Oracle agent
- GetGranted API integration complete
- Credit system working
- Payment processing configured

---

#### **Month 3-4: Intelligence & Interface (8-10 weeks)**
- **Week 11-12:** RAG system architecture and vector database setup
- **Week 13-14:** Document anonymization pipeline
- **Week 14-16:** Knowledge base preparation (distill existing docs)
- **Week 17-18:** AI Hub page (chat interface, conversation history)
- **Week 19-20:** Oracle popout widget for GetGranted

**Deliverables:**
- RAG system operational with anonymized data
- Full AI Hub UI
- Popout widget integrated
- Knowledge base indexed

---

#### **Month 5: Polish & Protection (4-6 weeks)**
- **Week 21-22:** Usage analytics dashboard
- **Week 23:** Behavioral monitoring (anomaly detection)
- **Week 24:** Security hardening, rate limiting
- **Week 25-26:** Terms of Service enforcement, compliance review

**Deliverables:**
- Analytics tracking functional
- Security measures in place
- Legal/compliance cleared
- Bug fixes and optimizations

---

#### **Month 6: Testing & Launch Prep (4 weeks)**
- **Week 27-28:** Beta testing with 10-20 pilot companies
- **Week 29:** Bug fixes based on beta feedback
- **Week 30:** Documentation, onboarding flows, help content
- **Week 31:** Launch marketing materials, webinar prep
- **Week 32:** PUBLIC LAUNCH

**Deliverables:**
- Polished product ready for public use
- Marketing campaign live
- Support documentation complete
- Beta testimonials and case studies

---

### 12-Month Roadmap

#### **Q1 (Months 1-3): Foundation**
- Finalize business model and pricing
- Confirm GetGranted 2.0 API capabilities
- Begin Oracle development
- Design AI Hub UI/UX
- Set up infrastructure

#### **Q2 (Months 4-6): Oracle Launch**
- Complete Oracle MVP
- Beta test with 10-15 pilot companies
- Public launch to GetGranted users
- Marketing campaign
- Monitor, iterate, improve

#### **Q3 (Months 7-9): First Program Agents**
- Build 2 priority program writers (likely CanExport + one other)
- Launch Program Writer marketplace
- Develop anonymized RAG for agents
- Add export/save functionality
- Gather usage data to prioritize next agents

#### **Q4 (Months 10-12): Expansion**
- Launch 2 more program writers (total: 4 agents)
- Build internal analytics dashboard
- Add advanced features:
  - Document upload/analysis
  - Draft critique mode
  - Application progress tracking
- Year-end push for 2026 grant planning

**End of Year 1:**
- Oracle + 4 program writers live
- 100-300 paying customers
- $15K-$45K MRR
- Proven product-market fit

---

### 2-Year Outlook

#### **Year 2, Q1 (Months 13-15): Maturity**
- Launch 3 more program writers (total: 7+ agents)
- Collaboration features (share drafts, team access)
- Mobile-responsive optimization
- A/B testing infrastructure for prompt improvement

#### **Year 2, Q2 (Months 16-18): Intelligence**
- Predictive analytics ("85% chance of winning this grant")
- Success tracking (did AI-drafted apps win?)
- Learning loop (use wins to improve quality)
- Application Scorecard (AI scores draft quality)

#### **Year 2, Q3 (Months 19-21): Scale**
- Provincial expansion (ON, QC-specific agents)
- API access for partners
- White-label option for other consultants
- Enterprise tier (multi-user, custom agents)

#### **Year 2, Q4 (Months 22-24): Innovation**
- Autonomous application mode (minimal user input)
- Proactive grant matching over 12-24 month timeline
- Integration marketplace (accounting, CRM connections)
- Mobile app (iOS/Android)
- Voice interface experimentation

**End of Year 2:**
- 10+ specialized program agents
- 500-1000+ paying customers
- $50K-$150K MRR
- Market leader in AI grant assistance in Canada

---

### Key Milestones

| Timeline | Milestone | Success Criteria |
|----------|-----------|------------------|
| **6 Months** | Oracle Launch | 100+ users, $10K MRR, 70%+ satisfaction |
| **12 Months** | Program Suite | 4 agents live, 300+ users, $30K MRR, proven ROI |
| **18 Months** | Market Leader | Full program coverage, 60%+ win rate proven, expansion opportunities |
| **24 Months** | Scale Phase | 1000+ users, $150K MRR, acquisition interest or funding opportunity |

---

## 13. Strategic Decision Points

### At 6 Months (Post-Oracle Launch)
**Questions to answer:**
- Is adoption meeting targets? (100+ users, $10K MRR)
- Which program agents should we prioritize? (based on Oracle conversations)
- Do we continue self-funded or seek external investment?
- Should we hire additional developers or continue lean?

### At 12 Months (4 Agents Live)
**Questions to answer:**
- Expand geographically (other provinces, US)?
- Offer white-label to other consultancies?
- Build mobile app?
- Scale marketing spend aggressively?

### At 18 Months (Market Traction)
**Questions to answer:**
- Pursue acquisition offers?
- Raise capital to scale faster?
- Stay Canada-focused or go international?
- Launch adjacent products (compliance, claims, reporting)?

---

## Appendix A: Integration with GetGranted 2.0 Pricing

### Current GetGranted Tiers

| Tier | Price | Users | Key Features |
|------|-------|-------|--------------|
| **Lite** | $55/mo | 1 | 3 Watchlists, 3 Smart Filters, Basic chat & knowledge |
| **Standard** | $99/mo | 2 | 10 Watchlists, 10 Smart Filters, Quarterly office hours |
| **Plus** | $149/mo | 3 | Unlimited watchlists/filters, Monthly office hours, Strategy session (annual) |

### Integration Strategy Options

**Option A: Add-On to Any Tier**
- AI Assistant available as $99-149/mo add-on to Lite/Standard/Plus
- Keeps existing pricing simple
- Users pay $154-298/mo total (base + AI)

**Option B: Exclusive to Plus+**
- Bundle AI only with Plus tier or above
- Raises Plus value dramatically
- Creates new "Plus AI" tier at $249-299/mo

**Option C: New Top Tier**
- Create "GetGranted AI" tier at $299/mo
- Includes everything in Plus + full AI suite
- Positions as premium offering for serious applicants

**Option D: Separate Product Line**
- AI Assistant priced independently
- Can be purchased with or without GetGranted subscription
- Maximum flexibility but more complex messaging

---

## Appendix B: Team & Resource Requirements

### Minimum Viable Team (6-Month Build)

**If outsourcing:**
- 1 Full-stack developer (API, backend, frontend)
- 1 AI/ML engineer (Claude integration, RAG, prompts)
- 1 Product designer (UI/UX)
- 1 Grant expert/PM (define logic, QA)
- **Budget**: $150K-$250K for 6 months

**If building with existing team + AI tools (Claude Code):**
- 1 Technical product lead (you)
- Optional: 1 UI/UX designer ($5-10K contract)
- Consultant support: GetGranted team for API integration
- **Budget**: $10K-$15K (infrastructure + design)
- **Time**: 3-4 months full-time, or 6 months part-time

### Ongoing Costs (Post-Launch)

**Infrastructure:**
- Railway hosting: $50-200/mo (scales with usage)
- Upstash Redis: $20-100/mo
- Claude API: $500-2000/mo (varies with usage)
- Vector database: $50-150/mo
- Total: $620-2,450/mo

**Support:**
- Customer support (as usage grows)
- Quarterly knowledge base updates
- Bug fixes and maintenance
- New program agent development (ongoing)

---

## Appendix C: Technical Terms Glossary

**RAG (Retrieval Augmented Generation)**: AI technique where the system searches a knowledge base for relevant information before generating responses. Allows AI to reference specific documents without having them all in memory.

**Vector Database**: Specialized database for storing and searching text by meaning rather than exact keywords. Enables semantic search for RAG systems.

**API (Application Programming Interface)**: Way for two software systems to talk to each other. GetGranted API would let AI Assistant read user data and write back results.

**Microservice**: Independent software component that handles one specific function. Allows parts of a system to be developed and scaled separately.

**Token**: Unit of text processed by AI (roughly 1 token = 4 characters). Claude charges per token, so monitoring token usage controls costs.

**System Prompt**: Instructions given to AI that define its personality, knowledge, and behavior. Different agents have different system prompts.

**Anonymization**: Process of removing identifying information from data. Critical for using client examples without revealing confidentiality.

**JWT (JSON Web Token)**: Secure way to pass authentication information between systems. Used for single sign-on.

**MRR (Monthly Recurring Revenue)**: Predictable monthly revenue from subscriptions. Key SaaS metric.

**NPS (Net Promoter Score)**: Customer satisfaction metric. "How likely are you to recommend this?" Scale of 0-10.

**LTV (Lifetime Value)**: Total revenue expected from a customer over their entire relationship with your product.

---

## Next Steps

1. **Review and refine** this strategy with key stakeholders
2. **Validate assumptions** about GetGranted 2.0 API capabilities
3. **Select pricing model** (recommend: Tiered Bundles)
4. **Choose architecture** (recommend: Microservice Integration)
5. **Secure resources** and budget approval
6. **Create detailed project plan** with weekly milestones
7. **Begin development** with Month 1 foundation work
8. **Recruit beta users** for testing in Month 5-6

---

*Document prepared: February 2026*
*For: Granted Consulting Leadership*
*Prepared by: Chris (AI Product Lead)*

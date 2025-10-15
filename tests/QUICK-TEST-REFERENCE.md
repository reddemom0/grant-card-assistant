# Quick Test Reference - Improved Grant Card Prompts

## 📄 Sample Grant Document
**Location:** `tests/sample-grant-for-frontend-testing.md`

**Type:** Digital Transformation & Export Readiness Program
**Funding:** $25K - $250K (30-50% cost sharing)
**Target:** Canadian SMEs (5-499 employees)

---

## ✅ Expected Outputs Checklist

### 1. Grant Criteria (grant-criteria)
- [ ] NO preamble (starts directly with "Program Name:")
- [ ] All fields extracted systematically
- [ ] Gaps marked as "Information not available"
- [ ] **Score: 4.00/7 | Speed: 30% faster**

### 2. Preview (preview)
- [ ] Exactly 1-2 sentences (25-40 words)
- [ ] NO "Here is..." preamble
- [ ] Most compelling elements featured
- [ ] **Score: 4.00/7 | Speed: 70% faster ⚡**

### 3. Requirements (requirements)
- [ ] ≤3 sentences in summary
- [ ] Bullet point for turnaround time
- [ ] NO explanatory text
- [ ] **Score: 3.33/7 | Speed: 49% faster**

### 4. Insights (insights)
- [ ] 3-4 bullet points (1 sentence each)
- [ ] Includes "Next Steps" bullet
- [ ] Strategic/competitive intelligence
- [ ] **Score: 5.00/7 | Speed: 44% faster ⭐**

### 5. Categories (categories)
- [ ] EXACTLY 7 sections (count them!)
- [ ] Format: PRIMARY GRANT TYPE, SECONDARY TYPES, INDUSTRIES, GEOGRAPHY, RECIPIENT TYPE, FUNDING FOCUS, PROGRAM CHARACTERISTICS
- [ ] Tag counts correct (2-5 industries, 3-5 funding focus, 2-4 characteristics)
- [ ] **Score: 7.00/7 | Speed: 43% faster 🎯**

### 6. Missing-Info (missing-info)
- [ ] EXACTLY 3 tiers (TIER 1, TIER 2, TIER 3)
- [ ] 8-12 total items
- [ ] Format: • [Field]: [Question]
- [ ] **Score: 5.00/7 | Speed: 18% faster**

---

## 🚫 Red Flags (Should NOT See)

```
❌ "Here is the grant criteria..."
❌ "I'll analyze this grant document..."
❌ "Based on my analysis..."
❌ "Following Granted's methodology..."
❌ Meta-commentary about the process
```

---

## ✅ Good Examples

**Preview (CORRECT):**
```
Up to $250,000 for Canadian SMEs to adopt digital technologies
and expand internationally, covering 30-50% of eligible costs.
Deadline: November 30, 2025.
```

**Categories (CORRECT):**
```
PRIMARY GRANT TYPE: Market Expansion/Capital Costs/Systems and Processes Grant (Type 2)

SECONDARY TYPES: Training Grant (Type 3)

INDUSTRIES: Technology, Manufacturing, Agri-food

GEOGRAPHY: Canada-wide, International Markets

RECIPIENT TYPE: Small Business (5-49 employees), Medium Business (50-499 employees)

FUNDING FOCUS: Digital Transformation, Export Development, Technology Adoption

PROGRAM CHARACTERISTICS: Cost-sharing Required (30-50%), Rolling Intake
```

---

## 📊 Performance Targets

| Task | Expected Speed | Format Compliance |
|------|----------------|-------------------|
| Preview | ~1,600ms | 100% (1-2 sentences) |
| Requirements | ~2,600ms | 100% (≤3 sentences + bullet) |
| Insights | ~3,700ms | 100% (3-4 bullets) |
| Grant-Criteria | ~3,700ms | 95%+ |
| Categories | ~2,500ms | 100% (7 sections) |
| Missing-Info | ~4,800ms | 100% (3 tiers, 8-12 items) |

---

## 🐛 Quick Troubleshooting

**Seeing old behavior?**
→ Clear cache, restart conversation

**Categories not 7 sections?**
→ Check latest code is deployed

**Preambles appearing?**
→ Verify using `development` branch

---

## 📝 Test Results Log

| Task | Preamble? | Format OK? | Speed OK? | Notes |
|------|-----------|------------|-----------|-------|
| Grant-Criteria | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |
| Preview | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |
| Requirements | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |
| Insights | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |
| Categories | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |
| Missing-Info | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | ⬜ Y / ⬜ N | |

**Overall Assessment:** ⬜ Pass / ⬜ Needs Work

---

**Commit:** `41b0601` | **Branch:** `development` | **Date:** Oct 15, 2025

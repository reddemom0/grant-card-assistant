# Rate Limiting & Abuse Prevention Audit

## Executive Summary

**Status**: Basic protections in place, but **significant gaps** in cost controls and bot detection.

- ✅ **IP-based rate limiting** on chat and form endpoints
- ✅ **Message length validation** and per-session message caps
- ✅ **Input sanitization** in widget (XSS protection)
- ⚠️ **Cost monitoring** exists but only logs warnings (no enforcement)
- ❌ **No bot detection** (no CAPTCHA, honeypot, or behavioral analysis)
- ❌ **No per-session or per-day hard cost caps** (only warnings)
- ❌ **No IP blacklisting** or abuse pattern detection
- ❌ **No distributed rate limiting** (in-memory only, resets on deploy)

---

## 1. Rate Limiting on Chat Endpoint (/api/lead-gen/chat)

### ✅ IMPLEMENTED

**File**: `src/api/lead-gen.js:22-24`

```javascript
const MAX_SESSIONS_PER_IP_PER_HOUR = 50;
const MAX_MESSAGES_PER_SESSION = 20;
const MAX_MESSAGE_LENGTH = 500;
```

**Enforcement**:
- **New session check** (line 323-330): Blocks if IP has created >= 50 sessions in last hour
- **Message count check** (line 345-350): Blocks if session has >= 20 messages
- **Message length check** (line 308-312): Blocks if message > 500 chars

**Storage**: PostgreSQL `lead_gen_conversations` table (persistent across deploys)

**Response Codes**:
- `429` - Rate limit exceeded
- User-friendly messages ("You've started several chats recently...")

**Concerns**:
- ⚠️ **50 sessions/hour is VERY high** - Allows rapid session creation before blocking
- ⚠️ **20 messages/session** - Allows significant API usage per session
- ⚠️ **No distributed rate limiting** - Only enforced via DB queries

---

## 2. Rate Limiting on Form Submission (/api/lead-gen/init)

### ✅ IMPLEMENTED

**File**: `src/api/lead-gen-init.js:297-306`

```javascript
const recentCount = await countRecentSessionsForIp(ipAddress);
if (recentCount >= 50) {
  console.warn(`⚠️  Rate limit hit for IP ${ipAddress}: ${recentCount} sessions in last hour`);
  return res.status(429).json({
    error: "You've started several chats recently. Please wait a bit before starting a new one."
  });
}
```

**Enforcement**:
- Same 50 sessions/hour limit as chat endpoint
- Validates required fields (email, province, revenue, employee_count, hiring_plans)
- Basic email regex validation

**Concerns**:
- ⚠️ **Same high 50/hour limit**
- ❌ **No bot detection** - No CAPTCHA or honeypot fields
- ❌ **No duplicate submission prevention** (same email/company multiple times)

---

## 3. Rate Limiting on Event Tracking (/api/lead-gen/event)

### ✅ IMPLEMENTED (In-Memory)

**File**: `src/api/lead-gen-event.js:14-53`

```javascript
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_EVENTS_PER_MINUTE = 100; // Per IP
```

**Enforcement**:
- In-memory Map storing IP → { count, resetAt }
- Cleanup every 5 minutes to prevent memory bloat
- Returns `429` if limit exceeded

**Concerns**:
- ⚠️ **In-memory storage** - Resets on server restart/deploy
- ⚠️ **100 events/minute is HIGH** - Allows event spam
- ⚠️ **Not shared across instances** - Railway could scale horizontally

---

## 4. Maximum Messages Per Session

### ✅ IMPLEMENTED

**File**: `src/api/lead-gen.js:346-350`

```javascript
// Rate limit: max 20 messages per session
if (session.message_count >= MAX_MESSAGES_PER_SESSION) {
  return res.status(429).json({
    error: "You've reached the message limit for this conversation..."
  });
}
```

**Cap**: 20 messages per session

**Concerns**:
- ⚠️ **20 messages is generous** - At ~4K tokens/message, could be 80K+ tokens/session
- ⚠️ **No cost-based cutoff** - Pure message count, doesn't account for token usage

---

## 5. Maximum Sessions Per IP Per Day

### ❌ NOT IMPLEMENTED

**Current**: Only 50 sessions per IP per **hour** (not day)

**Problem**:
- User could create 50 sessions, wait 1 hour, create 50 more
- **Potential**: 1,200 sessions/IP/day (50 × 24 hours)
- **Cost exposure**: ~$20-40/IP/day if all sessions max out

**Recommendation**: Add daily limit (e.g., 10 sessions/IP/day for legitimate use)

---

## 6. Input Validation

### ✅ IMPLEMENTED

#### Message Validation (`src/api/lead-gen.js:300-312`)
```javascript
// Type check
if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
  return res.status(400).json({ error: 'Please include a message...' });
}

// Length check
const message = rawMessage.trim();
if (message.length > MAX_MESSAGE_LENGTH) {
  return res.status(400).json({ error: `Your message is too long...` });
}
```

#### XSS Protection (`widget/getgranted-widget.js:242-263`)
```javascript
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHtml(html) {
  // Remove all script tags
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // ... additional sanitization
}
```

**Coverage**:
- ✅ Message length enforcement
- ✅ HTML escaping in widget UI
- ✅ Script tag removal
- ✅ Email format validation (regex)

**Concerns**:
- ❌ **No SQL injection protection** (using parameterized queries correctly, but not explicitly documented)
- ❌ **No content scanning** for spam patterns, profanity, or malicious payloads

---

## 7. Cost Caps

### ⚠️ MONITORING ONLY (No Enforcement)

**File**: `src/config/cost-settings.js:44-53`

```javascript
monitoring: {
  warnThreshold: 0.50,        // $0.50 per request (log warning)
  hourlyAlertThreshold: 10.00, // $10/hour (NOT IMPLEMENTED)
  dailyAlertThreshold: 50.00   // $50/day (NOT IMPLEMENTED)
}
```

**What Exists**:
- ✅ Per-request cost calculation (Anthropic API usage)
- ✅ Warning logs if single request > $0.50
- ✅ Token usage logging (input, output, cache hits)

**What's Missing**:
- ❌ **No per-session cost cap** - Session could rack up $5-10+ if user maxes out 20 messages
- ❌ **No per-IP cost cap** - Malicious user could create 50 sessions at $5 each = $250/hour
- ❌ **No hourly/daily cost enforcement** - Only logs warnings, doesn't block
- ❌ **No cost tracking in database** - Can't query "total cost for session X" or "cost today"

**Exposure**:
- **Per session**: 20 messages × $0.50/message = **$10 max**
- **Per IP/hour**: 50 sessions × $10/session = **$500 max**
- **Per day**: 1,200 sessions × $10/session = **$12,000 max** (theoretical)

---

## 8. Bot/Spam Detection

### ❌ NOT IMPLEMENTED

**No protection against**:
- Automated form submissions
- Headless browser scrapers
- Rapid-fire API calls from scripts

**What's Missing**:
1. **CAPTCHA** (reCAPTCHA, hCaptcha, Cloudflare Turnstile)
2. **Honeypot fields** (hidden form fields to trap bots)
3. **Behavioral analysis** (mouse movement, timing patterns)
4. **User-Agent filtering** (block known bot signatures)
5. **Fingerprinting** (browser fingerprint tracking)

**Current State**:
- ✅ IP tracking (but easily bypassed with VPNs/proxies)
- ❌ No CAPTCHA challenge
- ❌ No honeypot fields in form
- ❌ No timing analysis (e.g., form submitted in <1 second)

---

## 9. Middleware & Dependencies

### ✅ IMPLEMENTED (Minimal)

**File**: `server.js:28, 118-122`

```javascript
import cors from 'cors';

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
```

**Middleware**:
- ✅ CORS (configured for widget embedding on granted.ca)
- ✅ JSON body parser (50MB limit for file uploads)
- ✅ Request logging middleware

**Missing Middleware**:
- ❌ **express-rate-limit** - Industry standard for rate limiting
- ❌ **helmet** - Security headers (CSP, XSS protection, etc.)
- ❌ **express-validator** - Schema validation
- ❌ **express-slow-down** - Progressive delay on repeated requests

**Dependencies** (`package.json`):
- ✅ `cors` - CORS handling
- ❌ No `helmet`
- ❌ No `express-rate-limit`
- ❌ No `express-validator`

---

## 10. Summary of Gaps

### Critical Gaps (High Risk)

1. **No per-session/per-IP cost caps** - Unbounded API spending possible
   - **Risk**: $500+/hour from single malicious IP
   - **Fix**: Track cumulative cost in DB, block at thresholds

2. **No bot detection** - Trivial to automate abuse
   - **Risk**: Automated scrapers, form spam, session flooding
   - **Fix**: Add CAPTCHA + honeypot fields + timing analysis

3. **No daily IP limits** - Only hourly limits
   - **Risk**: 1,200 sessions/day/IP possible
   - **Fix**: Add daily session limit (10-20/day per IP)

4. **In-memory rate limiting for events** - Resets on deploy
   - **Risk**: Event spam after deployments
   - **Fix**: Move to Redis or PostgreSQL

### Medium Gaps (Moderate Risk)

5. **High rate limits** - 50 sessions/hour is very generous
   - **Risk**: Allows significant abuse before blocking
   - **Fix**: Reduce to 10-20 sessions/hour for production

6. **No IP blacklisting** - Can't permanently block abusers
   - **Risk**: Repeat offenders can keep attacking
   - **Fix**: Add IP blacklist table + admin UI

7. **No duplicate submission detection** - Same email/company can submit multiple times
   - **Risk**: Spam, data pollution
   - **Fix**: Check for existing sessions with same email

8. **No distributed rate limiting** - Doesn't scale horizontally
   - **Risk**: Rate limits bypassed if Railway scales to multiple instances
   - **Fix**: Use Redis for shared rate limiting state

### Low Gaps (Nice to Have)

9. **No security middleware** (helmet, express-rate-limit)
   - **Fix**: Add `helmet` for security headers

10. **No content scanning** - No spam/profanity filtering
    - **Fix**: Add basic pattern matching for spam keywords

---

## Recommendations (Priority Order)

### Immediate (Week 1)

1. **Reduce rate limits**:
   - `MAX_SESSIONS_PER_IP_PER_HOUR`: 50 → 10
   - `MAX_MESSAGES_PER_SESSION`: 20 → 15

2. **Add daily session limit**:
   - `MAX_SESSIONS_PER_IP_PER_DAY`: 20 (new)

3. **Add per-session cost cap**:
   - Track cumulative cost in `lead_gen_conversations`
   - Block at $5/session threshold

### Short-term (Week 2-3)

4. **Implement CAPTCHA**:
   - Add Cloudflare Turnstile or hCaptcha to form
   - Optional: Challenge on 3rd+ session from same IP

5. **Add honeypot field** to form (invisible to humans, visible to bots)

6. **Add helmet middleware** for security headers

### Medium-term (Month 1)

7. **Implement per-IP cost tracking**:
   - Track daily/hourly spend per IP
   - Hard block at $50/day

8. **Add IP blacklist system**:
   - Database table for blocked IPs
   - Admin UI to manage blacklist

9. **Move event rate limiting to PostgreSQL** (or Redis if available)

### Long-term (Month 2+)

10. **Implement behavioral analysis**:
    - Form submission timing
    - Mouse movement patterns
    - Browser fingerprinting

11. **Add admin dashboard** for abuse monitoring:
    - Top IPs by session count
    - Top IPs by cost
    - Recent blocks/warnings

---

## Cost Exposure Analysis

### Current State (No Hard Caps)

| Timeframe | Legitimate Use | Malicious Use | Max Cost |
|-----------|----------------|---------------|----------|
| Per Session | 5-10 messages | 20 messages | $10 |
| Per IP/Hour | 1-2 sessions | 50 sessions | $500 |
| Per IP/Day | 2-5 sessions | 1,200 sessions | $12,000 |
| Per Month | — | — | $360,000 |

### With Recommended Caps

| Timeframe | Limit | Max Cost |
|-----------|-------|----------|
| Per Session | $5 cap | $5 |
| Per IP/Hour | 10 sessions | $50 |
| Per IP/Day | 20 sessions | $100 |
| Per Month | — | ~$3,000* |

*Assumes 30-50 unique IPs/day hitting limits

---

## Implementation Priority Matrix

```
High Impact, Low Effort:
- Reduce rate limit constants (5 min)
- Add daily session limit (30 min)
- Add helmet middleware (10 min)

High Impact, Medium Effort:
- Per-session cost tracking (2-4 hours)
- CAPTCHA integration (2-3 hours)
- Honeypot field (1 hour)

High Impact, High Effort:
- Per-IP cost tracking + enforcement (1-2 days)
- IP blacklist system (2-3 days)
- Behavioral analysis (1 week)

Low Impact, Any Effort:
- Content scanning
- Browser fingerprinting
```

---

## Conclusion

The codebase has **basic IP-based rate limiting** and **input validation**, which prevents casual abuse. However, it lacks:

1. **Hard cost caps** - Biggest risk, could lead to runaway spending
2. **Bot detection** - Easy to bypass with automation
3. **Distributed rate limiting** - Doesn't scale horizontally

**Recommended immediate action**: Reduce rate limits and add per-session cost caps to prevent runaway API costs.

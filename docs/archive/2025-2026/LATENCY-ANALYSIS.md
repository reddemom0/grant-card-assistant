# Latency Analysis - CanExport Claims Agent

**Query:** "Has Seagate Mass Timber CanEx been approved yet?"
**Total Time:** 62.4 seconds (09:10:01 → 09:11:00)

## Time Breakdown

### 🐌 **Primary Bottleneck: Claude API Calls** (89% of total time)

The agent made **12 Claude API calls**, totaling **~55.5 seconds**:

| Iteration | Duration | Input Tokens | Output Tokens | Cache | Action |
|-----------|----------|--------------|---------------|-------|--------|
| 1 | 1.6s | 333 | 155 | CREATE 16438 | Memory tool (failed) |
| 2 | 2.9s | 526 | 93 | READ 16438 | Memory tool (failed again) |
| 3 | 3.5s | 657 | 120 | READ 16438 | Search "Seagate Mass Timber" + "CanExport" |
| 4 | 3.4s | 808 | 125 | READ 16438 | Search "Seagate" + "CanExport" |
| 5 | 3.0s | 964 | 101 | READ 16438 | Search companies for "Seagate Mass Timber" |
| 6 | 3.1s | 1217 | 121 | READ 16438 | Search all CanExport (no company filter) |
| 7 | 3.6s | 1369 | 81 | READ 16438 | Search CanExport with empty input |
| 8 | 4.8s | 12487 | 156 | READ 16438 | Search CanExport (broader query) |
| 9 | 4.1s | 12673 | 172 | READ 16438 | Search "Seagate Mass Timber Inc" |
| 10 | 7.3s | 18063 | 259 | READ 16438 | Get specific application details |
| 11 | 9.1s | 18954 | 384 | READ 16438 | Store memory |
| 12 | 9.1s | 19501 | 342 | READ 16438 | Final response |

**Total: 55.5s**

### 🔍 **HubSpot API Calls** (6% of total time)

- 6 search operations: ~3.0s
- 1 get_grant_application: ~0.6s

**Total: 3.6s**

### ⚙️ **System Overhead** (5% of total time)

- Database operations, conversation setup, memory operations

**Total: 3.3s**

---

## 🚨 Critical Issues

### 1. **Excessive Agentic Loops** (12 iterations)

The agent made **12 round-trips to Claude** for a simple status check query. This is caused by:

- **Inefficient search strategy**: Trying multiple variations of the company name
  - "Seagate Mass Timber" (failed)
  - "Seagate" (failed)
  - "Seagate Mass Timber Inc" (succeeded)

- **Poor planning**: Not getting all necessary data in one query

- **Redundant tool calls**: Memory tool called twice with same error

### 2. **Memory Tool Errors**

```
"error": "EISDIR: illegal operation on a directory, read"
```

The agent tried to use the memory tool twice at the start (iterations 1-2), both failed, wasting **~4.5 seconds**.

### 3. **Token Count Explosion**

Input tokens grew from **333 → 19,501** (59x increase) as conversation history accumulated:

- Each iteration adds the full conversation history
- Tool results (especially large HubSpot responses) bloat the context
- By iteration 10, a HubSpot query returned 50 applications, massively increasing tokens

### 4. **Search Strategy Inefficiency**

The agent made **7 search queries** before finding the right data:

1. Search "Seagate Mass Timber" + CanExport filter → 0 results
2. Search "Seagate" + CanExport filter → 0 results
3. Search companies "Seagate Mass Timber" → Found company
4. Search all CanExport (no company) → 0 results (wrong filter)
5. Search all applications (empty input) → 50 results (too broad)
6. Search CanExport only → 0 results
7. Search "Seagate Mass Timber Inc" → **22 results ✓**

Only the 7th attempt succeeded because it used the exact company name from HubSpot.

### 5. **Claude API Response Time Degradation**

As input tokens increased, response times got worse:

- Early calls (300-1000 tokens): **1.6-3.5s**
- Mid calls (12k-18k tokens): **4.8-7.3s**
- Late calls (18k-19k tokens): **9.1s**

This is likely due to:
- More context to process
- Larger conversation history to reason over
- Cache read overhead with large contexts

---

## 💡 Optimization Opportunities

### **Quick Wins:**

1. **Fix Memory Tool Error** (save 4.5s)
   - The `EISDIR` error suggests the tool is trying to read a directory instead of a file
   - Fix at: `src/tools/memory.js` or wherever memory tool is implemented
   - Could save iterations 1-2 entirely

2. **Smarter HubSpot Search** (save 5-6 iterations)
   - The agent should search HubSpot companies FIRST to get exact company name
   - Then use that exact name to search grant applications
   - This would collapse 7 searches into 2

3. **Reduce Tool Result Verbosity** (reduce token growth)
   - When returning 50 applications in iteration 8, only return summary data
   - Don't include full application objects in results
   - Truncate large results to top 10-20 items

### **Medium-term Improvements:**

4. **Implement Tool Result Summarization**
   - After each tool call, summarize results before adding to conversation
   - Prevents token explosion from large HubSpot responses

5. **Add Search Hints to System Prompt**
   - Tell the agent to search companies first, then use exact company name
   - Reduce trial-and-error searching

6. **Optimize Prompt Caching**
   - The 16,438 token cache is working well
   - But consider splitting prompt into static (cached) and dynamic (not cached) parts

### **Long-term Improvements:**

7. **Implement Multi-Query Tool Calling**
   - Allow agent to request multiple tools in one iteration
   - Example: search_companies AND search_applications in same turn
   - Would reduce 12 iterations to 4-5

8. **Add Fuzzy Matching**
   - HubSpot search should handle "Seagate Mass Timber" vs "Seagate Mass Timber Inc."
   - Reduce failed searches

9. **Implement Result Caching**
   - Cache HubSpot results for 5-10 minutes
   - Avoid repeated API calls for same query

---

## 📊 Expected Improvements

If we implement the quick wins:

**Current:**
- 12 iterations × ~4.6s avg = 55.5s
- 7 HubSpot searches = 3.6s
- **Total: ~59s**

**Optimized:**
- 4 iterations × ~4s avg = 16s (fix memory + smart search)
- 2 HubSpot searches = 1s
- **Total: ~17s**

**Improvement: 70% faster (59s → 17s)**

---

## 🔧 Priority Actions

1. **HIGH**: Fix memory tool `EISDIR` error (src/tools/memory.js)
2. **HIGH**: Add company search strategy to agent prompt
3. **MEDIUM**: Truncate large tool results to prevent token explosion
4. **MEDIUM**: Add fuzzy matching to HubSpot company search
5. **LOW**: Implement multi-query tool calling support

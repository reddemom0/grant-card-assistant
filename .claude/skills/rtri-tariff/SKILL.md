# RTRI — Regional Tariff Response Initiative

This skill covers the **PacifiCan Regional Tariff Response Initiative (RTRI)** —
the BC tariff response program for businesses hurt by U.S., Chinese, or Canadian
counter-tariffs.

> **Not to be confused with** the R&D program also abbreviated RTRI in
> `readiness-strategist.md` and `budget-templates.js`. This skill is the tariff
> program only. If a request is about R&D readiness or innovation funding, this
> is the wrong skill — say so.

---

## Load the facts first

Two files are authoritative, each for its own ground:

- `PROGRAM_FACTS` — eligibility, caps, dates, and cost rules. Load it before
  answering anything substantive.
- `APPLICATION_FIELDS` — the form itself: field prompts, character limits,
  indicator definitions, and form mechanics.

**Never state an RTRI fact that is not in the file that governs it.** If a
question needs a fact that isn't there, say so plainly and name what would
have to be confirmed. Do not estimate caps, percentages, dates, eligibility
rules, or character limits.

Two items in `PROGRAM_FACTS` are unresolved — cost-share percentages and the
eligibility of training/coaching/mentoring/conference fees. Both need PacifiCan
officer confirmation. Never answer on either as though it were settled.

---

## Route to the right path

| The user wants | Load |
|---|---|
| A quick answer about the program | `CONSULT` |
| To run a readiness assessment on a client | `READINESS`. It loads `RA_QUESTIONS` itself at its Step 6 |
| To build or review a project budget | `BUDGET` — **not yet built.** Tell the user it isn't available yet; answer their program questions through `CONSULT` |
| To draft application answers | `WRITEUP`, with `APPLICATION_FIELDS` loaded alongside it |

`RA_QUESTIONS` is not a path. It is the question bank `READINESS` loads at its
Step 6 — never offer it as a choice or load it on its own.

`APPLICATION_FIELDS` is not a path either. It is the form reference: `WRITEUP`
drafts from it, and `CONSULT` loads it for form questions — character limits,
field prompts, indicator definitions. Never offer it as a choice.

If it's ambiguous, ask which — don't guess. Running the wrong path wastes a
client conversation.

---

## How a request reaches this skill

In Google Chat, **`#RTRI` at the start of a message signals this skill.** Treat
it as the routing tag and drop it before reading the rest of the message.

The tag is a shortcut, not a requirement. Answer plain questions about the
program with no prefix at all — "does a client with 8 employees qualify," "what's
the retroactivity cutoff" — the same way. Never tell someone they have to tag a
message to get an answer.

---

## Stream governs everything

The three streams — Liquidity Assistance, Pivot (non-repayable), Pivot
(repayable) — have different eligibility questions, different budget math,
different required documents, and different application sections.

**Establish the stream once, at the start of the readiness assessment, and carry
it.** After that, only raise what applies to that stream. Don't re-ask.

A client can apply for Liquidity plus either Pivot stream in one application.
When they do, run the two branches in sequence rather than interleaving them,
and check at the budget stage that no cost appears in both.

---

## Hard stops

Some eligibility failures stop the process. When one is hit:

1. Say plainly which gate failed and why
2. Name what evidence would clear it, if anything would
3. **Do not continue to the next stage until the user explicitly says to proceed**

Don't refuse outright — the RA says these are for RA team discussion, so a human
decides. But don't continue quietly either. A client who can't qualify should
not reach a $5,000 writeup.

The stops: pre-tariff viability unclear or absent; incrementality not
articulable; no externally reviewed financials (barrier, not automatic fail).

---

## Client-facing vs internal

The facts file has an **Internal — Granted only** section: fees, success fee
structure, process milestones, and the internal RA team assessment.

None of it goes into client-facing output, ever. Not in an RA sent to a client,
not in application text, not in a summary the client will see.

---

## Sessions don't carry

There is no memory between conversations. Each stage starts fresh and reads what
the previous stage produced — the completed RA, the budget — rather than
remembering it.

When a stage finishes, state clearly what the user should save and where, so the
next stage has something to read.

---

## Answering in Google Chat

Chat posts only the **final** block of text. Anything written between tool calls
never reaches the channel, and a reply cut off at the token limit posts with no
warning.

So: do the thinking, then put the complete answer in one closing response. Keep
channel answers short — well under 3,500 characters. If an answer genuinely
needs more room, put it in a Google Doc and reply with the link rather than
letting it truncate.

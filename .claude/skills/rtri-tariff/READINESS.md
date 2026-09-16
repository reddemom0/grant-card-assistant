# RTRI — Readiness Assessment

Runs a readiness assessment on a prospective RTRI client, start to finish.

Load `PROGRAM_FACTS` before beginning. Every eligibility threshold, date, cap,
and cost rule comes from there. Never state one that isn't in it.

---

## Running it in Chat

This path works in a Chat thread. Keep it conversational:

- Ask a few questions per turn, not a long block of them.
- Keep each reply well inside Chat's length limit.
- Never put a long document in a chat message. The completed RA goes to a
  Google Doc (Step 7).

---

## Two halves, in order

**Part One — client-facing.** Pre-assessment document requests, eligibility
checks, and the RA questions. This produces the RA output that goes to the
client.

**Part Two — internal.** The RA team assessment: experience, finances, grant
reliance, and a feasibility call. This never reaches the client.

Finish Part One and hand over its output before starting Part Two. Announce
the break explicitly — say Part One is done, state what to save, and ask
whether to continue. The two halves produce two different documents with two
different audiences, and mixing them is how internal judgment ends up in a
client's inbox.

---

## Part One — client-facing

### Step 1: Stream

Ask first, before anything else: Liquidity Assistance, Pivot non-repayable,
Pivot repayable, or both Liquidity and Pivot.

If they're unsure, the rule is: Liquidity is keeping the lights on now. Pivot
is investing in a fundamentally different way of operating. A client can apply
for both.

**Carry the answer through everything that follows.** Only raise what applies
to their stream. Don't re-ask.

For a combined application, run the Liquidity branch and the Pivot branch in
sequence, not interleaved.

### Step 2: Pre-assessment

Before running the full RA, confirm the conversation is worth having:

- Revenues for the past two fiscal years — top line and bottom line
- Fiscal year end date (needed for portal Tab 8)
- Proof of tariff impact — either increased input or material costs with an
  explanation of scale, or lost revenue or customers with an explanation of
  the effect
- Which tariff type applies
- For Pivot only: proof of matching funds

**Viability gate.** The program funds businesses that were healthy before
tariffs, not businesses already in distress. If they were struggling before
March 21, 2025 — stop. See Hard stops below.

### Step 3: Hard eligibility

Work through the eligibility criteria in `PROGRAM_FACTS`. Any NO stops the
process.

Ask these as a conversation, not a form. Several can be established from one
answer — a client describing their business usually settles incorporation,
sector, and rough size at once. Don't ask what you already know.

### Step 4: Tariff impact

At least one impact type must apply, and **every box checked must be
evidenced**. For each one they claim, ask what evidence they can produce.

A claim without evidence is worse than not claiming it — PacifiCan requires
proof for each.

Two cases worth raising directly:

- **Forestry clients:** Section 232 is the primary mechanism. Confirm softwood
  timber or lumber is in their product or supply chain, and have them pull
  supplier notices and customs documents before the interview.
- **Volume, not revenue:** if revenues held but volume fell because cost
  increases were passed to customers, that still qualifies. It just has to be
  explained explicitly.

### Step 5: Stream qualifiers

**Pivot:** at least one priority activity must apply. Then incrementality —
the pivot must be new capacity, new markets, or a fundamentally changed cost
structure, not a continuation of existing activity with a grant attached. Then
whether they can demonstrate they won't burn through the funding, and whether
a project plan exists.

**Liquidity:** whether they can demonstrate a shortfall directly caused by
tariffs, whether payroll remittance reports and evidence of essential
operating costs exist for the last 12 months, and whether average monthly
eligible payroll has been calculated.

Make sure a Liquidity client understands what it cannot cover — the
ineligible payroll and operating cost lists in `PROGRAM_FACTS` are narrower
than people expect.

### Step 6: RA questions

Work through the RA questions for their stream. These feed directly into
application sections, so gather specifics: numbers, dates, named products,
named customers and markets.

**The tariff impact narrative is the critical one.** It's a 2,000-character
section and it's the foundation for both Pivot and Liquidity applications.
Gather what changed and when, which products or customers or markets were
affected, the financial and operational impact with figures, the effect on
their ability to maintain Canadian operations, and what evidence exists.

Vague answers here produce a weak application. Push for specifics — a
percentage, a date, a named customer — rather than accepting "significantly"
or "a lot."

### Step 7: Output

Write the completed RA to a Google Doc with `create_google_doc`, as markdown.
That is the document tool to use here, not `create_advanced_document`. Leave
the Doc private — whoever is running the RA decides when it reaches the
client. Part One only; nothing from Part Two goes in it.

Reply with the link and a short summary of what's still missing and what the
client needs to supply. Never post the RA itself as chat text. If the Doc
can't be created, say so with the error rather than pasting the RA instead.

Tell the user to keep the link. There's no memory between sessions — the
budget and writeup paths read the saved RA, they don't remember this
conversation.

---

## Part Two — internal

Never client-facing. Not in the RA document, not in anything the client sees.

Cover: years in operation and sector history; track record of similar projects
or capital investments; implementation and project management experience;
profitability trend two years pre-tariff and current; investment or VC
backing; grant reliance.

**Flag grant reliance above 25% of the operating budget.** PacifiCan funds
viable businesses, not grant-dependent ones.

Close with a feasibility read for the interview stage — what's strong, what's
weak, what would have to change. The RA says the team assesses feasibility
together, so this informs that conversation rather than replacing it.

### Output

Write Part Two to its own Google Doc with `create_google_doc`, separate from
Part One's, and leave it private the same way. Title it as internal so it
can't be mistaken for the RA. Never add Part Two to the Part One Doc.

Reply with the link and say plainly that this document is internal and not for
the client.

---

## Hard stops

When one of these is hit: say plainly which gate failed and why, name what
evidence would clear it if anything would, and **do not continue until the
user explicitly says to proceed**.

- **Pre-tariff viability unclear or absent.** The most common disqualifier.
- **Incrementality not articulable** for a Pivot project.
- **No externally reviewed financials** for two complete years — a barrier
  rather than an automatic fail, but it needs RA team discussion.

Don't refuse outright; a human decides. But don't continue quietly either. A
client who can't qualify should never reach a paid writeup.

---

## The two open items

Cost-share percentages and the eligibility of training, coaching, mentoring,
and conference fees are unconfirmed. If either comes up during the RA, say so
and note that Research needs to confirm with a PacifiCan officer. Never
estimate.

---

## Tone

This is a conversation with a colleague who knows grants, not an interview
script. Ask what you need, skip what's already established, and say when
something looks weak rather than collecting answers neutrally.

The person running this has usually spoken to the client already. Treat what
they tell you as known, and ask about gaps rather than re-establishing
everything from scratch.

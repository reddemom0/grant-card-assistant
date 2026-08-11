# Colon / Slash Triage

**Generated:** 2026-08-11T20:31:06.340Z
**Input:** `dist/inventory/clients-final.csv`, `dist/inventory/resolved-final.csv`
**Method:** mechanical. Grouping uses the colon's position and the shape of the surrounding words only — **no judgement about company identity was made.** Nothing was rewritten and no folder was split.

## Why this list exists

macOS stores a `/` typed into a folder name as `:` at the POSIX layer, so a colon in a Dropbox folder name is usually a forward slash the user typed. Before anything moves to Google Drive, each of these needs a decision — and the decisions are not all the same kind:

- Some are **one name that happens to contain a slash** (a date range, a brand with a slash in it). Those need a naming decision.
- Some look like **two companies joined by a slash**. Those need a client-identity decision, because the folder may hold files for two clients.

**23 raw folder names, 777 files.**

| Group | Meaning | Names | Files |
|---|---|---|---|
| **A** | Contains a year or date fragment | 2 | 69 |
| **B** | Both sides are written like company names | 20 | 692 |
| **C** | Everything else | 1 | 16 |

Of the 20 group-B names, **11 have at least one side that matches a different company already in the list** — the strongest available signal that the folder covers two clients rather than one. Details in the group B section.

### How to fill this in

Write one of these in the **Decision** cell, or anything else that's clearer:

- `keep` — the colon is part of the real name, leave it
- `slash` — it is a typed `/`; recreate the name with a slash
- `split` — the folder holds two clients; needs splitting before migration
- `?` — needs a look at the folder contents

---

## Group A — contains a year or date fragment (2)

The colon sits next to a year, a year range, or a month. These are almost certainly a typed `/` inside a single name, not two entities.

| Raw folder name | Reads as | Files | Programs | Current company | Shares canonical | Decision |
|---|---|---|---|---|---|---|
| `Widerfunnel 2017:18` | `Widerfunnel 2017 / 18` | 47 | 1 | WiderFunnel | yes (4 raw names) |  |
| `Widerfunnel 2018:2019` | `Widerfunnel 2018 / 2019` | 22 | 1 | WiderFunnel | yes (4 raw names) |  |

---

## Group B — both sides written like company names (20)

Both sides pass the shape test for a company name. **This is the group where the folder may hold two clients.**

| Raw folder name | Reads as | Files | Programs | Current company | Shares canonical | Decision |
|---|---|---|---|---|---|---|
| `New:Mode` | `New / Mode` | 164 | 7 | New:Mode | no |  |
| `Capital City News:Overstory Media` | `Capital City News / Overstory Media` | 156 | 1 | Capital City News / Overstory Media | no |  |
| `DH1:Our Town Cafe` | `DH1 / Our Town Cafe` | 59 | 1 | Our Town Cafe | no |  |
| `Birds Nest : ACD Realty` | `Birds Nest / ACD Realty` | 40 | 1 | Birds Nest / ACD Realty | no |  |
| `Girl Gang:Rolla Skate Club` | `Girl Gang / Rolla Skate Club` | 34 | 1 | Girl Gang / Rolla Skate Club | no |  |
| `Nourish - Cook:Trainer` | `Nourish - Cook / Trainer` | 27 | 1 | Nourish | yes (2 raw names) |  |
| `Acorn : Abror` | `Acorn / Abror` | 25 | 1 | Acorn / Abror | no |  |
| `Cocoon Home Office:SommEvents` | `Cocoon Home Office / SommEvents` | 24 | 1 | Cocoon Home Office / SommEvents | no |  |
| `Healthy Hooch:Functional Beverage Group` | `Healthy Hooch / Functional Beverage Group` | 24 | 1 | Healthy Hooch / Functional Beverage Group | no |  |
| `Hippie Snacks : Left Coast Naturals` | `Hippie Snacks / Left Coast Naturals` | 21 | 1 | Hippie Snacks / Left Coast Naturals | no |  |
| `Taimuri:Capstone` | `Taimuri / Capstone` | 21 | 1 | Taimuri / Capstone | no |  |
| `Admin Slayer:Spring Planning` | `Admin Slayer / Spring Planning` | 20 | 1 | Admin Slayer | yes (2 raw names) |  |
| `E2+ : Streetscape` | `E2+ / Streetscape` | 17 | 1 | Streetscape | yes (2 raw names) |  |
| `Madison Builders:E2 + Associates` | `Madison Builders / E2 + Associates` | 16 | 1 | Madison Builders / E2 + Associates | no |  |
| `Vegpro: Salad Etc` | `Vegpro / Salad Etc` | 14 | 1 | Vegpro | yes (4 raw names) |  |
| `New:Mode Consulting` | `New / Mode Consulting` | 13 | 1 | New:Mode Consulting | no |  |
| `Blume : Ellebox` | `Blume / Ellebox` | 10 | 1 | Blume / Ellebox | no |  |
| `Pure+:Nineteen02 Kombucha` | `Pure+ / Nineteen02 Kombucha` | 4 | 1 | Pure+:Nineteen02 Kombucha | no |  |
| `Capital City:Overstory` | `Capital City / Overstory` | 2 | 1 | Capital City Overstory | no |  |
| `Premium Fence:Concept House:Kurt` | `Premium Fence / Concept House / Kurt` | 1 | 1 | Premium Fence | yes (3 raw names) |  |

### Side matches against the rest of the client list

For each group-B name, whether either side matches a **different** company already in the list — by canonical name or by one of its raw folder names. A match means that company exists independently, which is evidence the colon joins two real clients.

| Raw folder name | Side | Matches company | Matched via | That company's files | Programs |
|---|---|---|---|---|---|
| `Capital City News:Overstory Media` | `Capital City News` | **Capital City News** | canonical name | 64 | 4 |
| `Capital City News:Overstory Media` | `Overstory Media` | **Overstory Media Group** | raw folder name | 273 | 4 |
| `Girl Gang:Rolla Skate Club` | `Girl Gang` | **Girl Gang** | canonical name | 3 | 1 |
| `Girl Gang:Rolla Skate Club` | `Rolla Skate Club` | **Rolla Skate Club** | canonical name | 1 | 1 |
| `Acorn : Abror` | `Acorn` | **Acorn** | canonical name | 113 | 3 |
| `Hippie Snacks : Left Coast Naturals` | `Hippie Snacks` | **Hippie Snacks** | canonical name | 36 | 3 |
| `Hippie Snacks : Left Coast Naturals` | `Left Coast Naturals` | **Left Coast Naturals** | canonical name | 724 | 5 |
| `Taimuri:Capstone` | `Capstone` | **Capstone** | canonical name | 35 | 4 |
| `Admin Slayer:Spring Planning` | `Spring Planning` | **Spring Planning** | canonical name | 12 | 3 |
| `Madison Builders:E2 + Associates` | `Madison Builders` | **Madison Builders** | canonical name | 12 | 1 |
| `Blume : Ellebox` | `Blume` | **Blume** | canonical name | 309 | 13 |
| `Pure+:Nineteen02 Kombucha` | `Pure+` | **Pure+** | canonical name | 11 | 2 |
| `Capital City:Overstory` | `Capital City` | **Capital City** | canonical name | 1 | 1 |
| `Capital City:Overstory` | `Overstory` | **Overstory** | canonical name | 25 | 1 |
| `Premium Fence:Concept House:Kurt` | `Concept House` | **Concept House** | canonical name | 8 | 1 |

The remaining 9 group-B names had no side matching another company: `New:Mode`, `DH1:Our Town Cafe`, `Birds Nest : ACD Realty`, `Nourish - Cook:Trainer`, `Cocoon Home Office:SommEvents`, `Healthy Hooch:Functional Beverage Group`, `E2+ : Streetscape`, `Vegpro: Salad Etc`, `New:Mode Consulting`. That is weaker evidence either way — the second party may simply never have had its own folder.

---

## Group C — everything else (1)

One or both sides is not company-shaped — a person's name, a role, a status, a document word. Most are probably a typed `/` inside one name, but they do not fit either pattern above cleanly.

| Raw folder name | Reads as | Files | Programs | Current company | Shares canonical | Decision |
|---|---|---|---|---|---|---|
| `Victory Square : Draft Label` | `Victory Square / Draft Label` | 16 | 1 | Victory Square | no |  |

---

## Notes

- **Three canonical company names still carry a colon:** `New:Mode`, `New:Mode Consulting`, `Pure+:Nineteen02 Kombucha`. Whatever is decided for the raw names should be applied to these too.
- **Two of these names are inside already-corrected merges** (`Vegpro: Salad Etc` under Vegpro, `Admin Slayer:Spring Planning` under Admin Slayer), so a `split` decision there would partly undo a hand-reviewed merge.
- Nothing here has been changed. This document is the input to the decision, not the result of one.

## Reproducing

```bash
node <scratchpad>/colon-triage.mjs
```

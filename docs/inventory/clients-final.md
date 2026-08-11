# Final Client List

**Generated:** 2026-08-11T20:29:52.979Z
**Inputs:** `dist/inventory/resolved-final.csv`, `scripts/client-corrections.json`
**Output:** `dist/inventory/clients-final.csv` (gitignored — regenerable)
**Method:** mechanical. No API call of any kind. The six corrections are hand-review decisions applied as data.

This is the list the pilot runs against.

## Totals

| | |
|---|---|
| **Canonical companies** | **1,847** |
| Raw client folder names behind them | 1,962 |
| Files under client names | 70,725 (93.1% of the tree) |
| Companies with >1 raw folder name | 88 |
| Live | 1,063 companies, 57,866 files |
| Archive-only | 760 companies, 12,859 files |

---

## The six corrections

Recorded in `scripts/client-corrections.json` (version-controlled) so they survive any re-run of the pipeline. Each is matched on the normalized folder-name key, so they keep applying even if file counts shift.

Canonical company count: **1,855 → 1,847** (−8; the six corrections collapsed 14 model-assigned canonicals into 6).

| # | Canonical after correction | Raw folder names merged | Files | Was |
|---|---|---|---|---|
| 1 | **Level Ground Trading** | `Level Ground` (394)<br>`Level Ground Trading` (258)<br>`Level Ground - Sales Admin` (42)<br>`Level Ground Trading - submitted` (7)<br>`Level Ground Coffee` (5) | **706** | `Level Ground`, `Level Ground Trading` |
| 2 | **Office of McFarlane Biggar Architects + Designers** | `Office of McFarlane` (82)<br>`Office of Mcfarlane Biggar Architects + Designers` (13)<br>`office of mcfarlane biggar architects designers` (10)<br>`Office of Mcfarlane (OMB)` (6) | **111** | `Office of McFarlane`, `Office of McFarlane Biggar Architects + Designers` |
| 3 | **Vegpro** | `Vegpro` (25)<br>`Vegpro: Salad Etc` (14)<br>`Salad Etc! (Vegpro)` (7)<br>`Salad Etc!` (2) | **48** | `Vegpro`, `Salad Etc!` |
| 4 | **Clarus** | `Clarus Electric` (277)<br>`Clarus` (193)<br>`Clarus Electrical` (49)<br>`Clarus Electric Corp` (26)<br>`Clarus Electronic` (8)<br>`Clarus Eletrical` (2)<br>`Clarus - oneoff` (1) | **556** | `Clarus`, `Clarus Electrical`, `Clarus Electric`, `Clarus Electric Corp`, `Clarus Electronic` |
| 5 | **TEC** | `TEC (One-Off)` (143)<br>`TEC` (68)<br>`Stenberg (TEC)` (26)<br>`TEC - Stenberg College` (20) | **257** | `TEC`, `Stenberg College` |
| 6 | **Pearl** | `Pearl` (366)<br>`Superprem Industries Ltd (DBA Pearl)` (1) | **367** | `Superprem Industries Ltd` |

All 23 raw folder names resolved cleanly; every one was already labelled `client`. No correction was partially applied.

Note on #6 (Pearl): the canonical was deliberately flipped away from the registered entity name. 366 of 367 files sit under the folder `Pearl`, and that is the name the GCs use. `Superprem Industries Ltd` is recorded in the corrections file as the legal entity behind it.

---

## Colon audit

macOS stores a `/` typed into a folder name as `:` at the POSIX layer. A colon in a Dropbox folder name is therefore usually **a forward slash the user typed**, not a literal colon — `Widerfunnel 2017:18` is almost certainly `Widerfunnel 2017/18`.

This matters for the migration: Google Drive accepts `/` in folder names but Dropbox's API returns the `:` form, so a naive copy would create folders whose names differ from what the user originally typed.

| Measure | Count |
|---|---|
| Raw folder names containing `:` | **23** |
| Files under them | **777** |
| Canonical company names containing `:` | 3 |

By label:

| Label | Names |
|---|---|
| `client` | 23 |

Every affected raw name:

| Raw folder name | Label | Files | Reads as |
|---|---|---|---|
| `New:Mode` | client | 164 | `New/Mode` |
| `Capital City News:Overstory Media` | client | 156 | `Capital City News/Overstory Media` |
| `DH1:Our Town Cafe` | client | 59 | `DH1/Our Town Cafe` |
| `Widerfunnel 2017:18` | client | 47 | `Widerfunnel 2017/18` |
| `Birds Nest : ACD Realty` | client | 40 | `Birds Nest / ACD Realty` |
| `Girl Gang:Rolla Skate Club` | client | 34 | `Girl Gang/Rolla Skate Club` |
| `Nourish - Cook:Trainer` | client | 27 | `Nourish - Cook/Trainer` |
| `Acorn : Abror` | client | 25 | `Acorn / Abror` |
| `Cocoon Home Office:SommEvents` | client | 24 | `Cocoon Home Office/SommEvents` |
| `Healthy Hooch:Functional Beverage Group` | client | 24 | `Healthy Hooch/Functional Beverage Group` |
| `Widerfunnel 2018:2019` | client | 22 | `Widerfunnel 2018/2019` |
| `Hippie Snacks : Left Coast Naturals` | client | 21 | `Hippie Snacks / Left Coast Naturals` |
| `Taimuri:Capstone` | client | 21 | `Taimuri/Capstone` |
| `Admin Slayer:Spring Planning` | client | 20 | `Admin Slayer/Spring Planning` |
| `E2+ : Streetscape` | client | 17 | `E2+ / Streetscape` |
| `Madison Builders:E2 + Associates` | client | 16 | `Madison Builders/E2 + Associates` |
| `Victory Square : Draft Label` | client | 16 | `Victory Square / Draft Label` |
| `Vegpro: Salad Etc` | client | 14 | `Vegpro/ Salad Etc` |
| `New:Mode Consulting` | client | 13 | `New/Mode Consulting` |
| `Blume : Ellebox` | client | 10 | `Blume / Ellebox` |
| `Pure+:Nineteen02 Kombucha` | client | 4 | `Pure+/Nineteen02 Kombucha` |
| `Capital City:Overstory` | client | 2 | `Capital City/Overstory` |
| `Premium Fence:Concept House:Kurt` | client | 1 | `Premium Fence/Concept House/Kurt` |

Canonical names still carrying a colon:

- `New:Mode`
- `New:Mode Consulting`
- `Pure+:Nineteen02 Kombucha`

**Not rewritten.** This is an audit only — Google Drive folder naming needs a decision first.

---

## Carried forward (not resolved here)

| Item | Count | Notes |
|---|---|---|
| Files unattributed to any name | 986 | Program folders with no subfolder structure, plus files orphaned by batch descent |
| Names never judged | 36 (750 files) | Surfaced by the final resolution round; ~$0.03 to classify |
| Names judged non-client | 129 (3,510 files) | `doctype` / `internal` / `unclear` — not migration destinations |

Both the unattributed files and the unjudged names go to the review sheet. Neither is in scope here.

---

## Live vs archive-only (`client_modified`, 2020-08-11 cutoff)

`server_modified` is **not** used: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports nearly everything as recent regardless of real content age.

| Group | Companies | % | Files | % of client files |
|---|---|---|---|---|
| **Live** (a file within 6 years) | 1,063 | 57.6% | 57,866 | 81.8% |
| **Archive-only** | 760 | 41.1% | 12,859 | 18.2% |
| No dated files | 24 | 1.3% | 0 | 0% |

41.1% of companies are archive-only but hold only 18.2% of the files — the tail is old and light.

---

## Largest 40 companies by file count

| Canonical company | Raw names | Programs | Files | Retention |
|---|---|---|---|---|
| Kirmac | 1 | 5 | 1,299 | live |
| Caliber | 3 | 9 | 1,185 | live |
| Keystone | 1 | 22 | 900 | live |
| Spare Labs | 2 | 19 | 802 | live |
| Horizon | 2 | 7 | 780 | live |
| Left Coast Naturals | 2 | 5 | 724 | live |
| Level Ground Trading ✎ | 5 | 13 | 706 | live |
| Trotman | 1 | 3 | 664 | live |
| SAAM Towage | 1 | 9 | 651 | live |
| Musora | 1 | 12 | 631 | live |
| Ledcor | 1 | 3 | 621 | live |
| Fresh Prep | 1 | 14 | 590 | live |
| Clarus ✎ | 7 | 8 | 556 | live |
| Native Shoes | 1 | 16 | 521 | live |
| Bittered Sling | 2 | 1 | 507 | archive_only |
| ProCogia | 1 | 24 | 502 | live |
| ClearDent | 1 | 15 | 501 | live |
| Clir | 1 | 16 | 485 | live |
| Houston Landscapes | 1 | 6 | 463 | live |
| Creator Co | 1 | 20 | 443 | live |
| Norland | 1 | 7 | 428 | live |
| Intercity Packers | 1 | 1 | 421 | archive_only |
| Twin Lions | 2 | 5 | 393 | live |
| Pearl ✎ | 2 | 13 | 367 | live |
| Taymor | 2 | 7 | 348 | live |
| ICMS | 1 | 10 | 337 | live |
| Nightingale Electrical | 1 | 7 | 328 | live |
| Strategex | 1 | 8 | 325 | live |
| Gunn Consultants | 2 | 14 | 324 | live |
| Herschel Supply Co. | 1 | 1 | 312 | archive_only |
| Blume | 2 | 13 | 309 | live |
| Primex | 1 | 4 | 308 | live |
| Major Tom | 1 | 14 | 304 | live |
| Nightingale | 1 | 4 | 291 | live |
| Coastal Church | 1 | 5 | 288 | live |
| Coast Spas | 1 | 7 | 285 | live |
| Solaris | 1 | 12 | 275 | live |
| TQ Construction | 2 | 3 | 275 | live |
| Overstory Media Group | 4 | 4 | 273 | live |
| Carmanah Technologies | 1 | 1 | 272 | archive_only |

✎ = hand-corrected. Full list in `dist/inventory/clients-final.csv`.

---

## Reproducing

```bash
node <scratchpad>/build-final-clients.mjs
```

Reads `dist/inventory/resolved-final.csv` and `scripts/client-corrections.json`, writes two files, makes no network call. To change a merge decision, edit the JSON and re-run — nothing needs re-classifying.

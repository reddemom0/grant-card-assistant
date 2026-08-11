/**
 * colon-triage.mjs — sort the colon/slash folder names into decidable groups.
 *
 * Grouping uses the character's POSITION and the SHAPE of the surrounding words
 * only. It does not judge company identity — that is the decision this document
 * is asking for.
 *
 * NO network of any kind. No name is rewritten and no folder is split.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, classifyCached, normalizeName } from './grants-lib.mjs';

const CLIENTS = 'dist/inventory/clients-final.csv';
const MD_OUT = 'docs/inventory/colon-triage.md';

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- load
const companies = [];
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    companies.push({
      canonical: r[0],
      raws: r[1] ? r[1].split(' | ') : [],
      rawCount: Number(r[2] || 0),
      programs: Number(r[3] || 0),
      files: Number(r[4] || 0),
      cmax: r[7] || null,
      retention: r[8] || '',
      corrected: r[9] === 'yes',
    });
  }
}
log(`${companies.length} companies`);

// Index: raw name -> company; canonical key -> company
const byRaw = new Map();
const byCanon = new Map();
for (const c of companies) {
  byCanon.set(normalizeName(c.canonical), c);
  for (const r of c.raws) byRaw.set(normalizeName(r), c);
}

// Per-raw file counts aren't in the company CSV, so pull them from the resolved list.
const rawFiles = new Map();
const rawPrograms = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile('dist/inventory/resolved-final.csv', 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    rawFiles.set(r[1], Number(r[9] || 0));
    rawPrograms.set(r[1], Number(r[8] || 0));
  }
}

// ---------------------------------------------------------------- collect
const colonNames = [];
for (const c of companies) {
  for (const raw of c.raws) {
    if (raw.includes(':')) colonNames.push({ raw, company: c });
  }
}
log(`${colonNames.length} raw names containing a colon`);

// ---------------------------------------------------------------- classify into groups
const YEAR = /\b(19|20)\d{2}\b/;
const SHORT_YEAR = /^\d{2}$/;
const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const DATEISH = /\b\d{1,2}[-/.]\d{1,2}\b/;

const sidesOf = (s) => s.split(':').map((x) => x.trim()).filter(Boolean);

function hasDateFragment(name) {
  const sides = sidesOf(name);
  if (sides.some((s) => YEAR.test(s) || MONTH.test(s) || DATEISH.test(s))) return true;
  // "2017:18" — a bare 2-digit side next to a side carrying a year.
  for (let i = 0; i < sides.length; i++) {
    if (SHORT_YEAR.test(sides[i]) && sides.some((s, j) => j !== i && YEAR.test(s))) return true;
  }
  return false;
}

/** Shape test only — is this side written like a company name? */
function companyShaped(side) {
  if (!side) return false;
  if (YEAR.test(side) || MONTH.test(side) || SHORT_YEAR.test(side)) return false;
  if (classifyCached(side) !== 'client') return false;
  const words = side.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 6;
}

for (const e of colonNames) {
  e.sides = sidesOf(e.raw);
  e.files = rawFiles.get(normalizeName(e.raw)) ?? 0;
  e.programs = rawPrograms.get(normalizeName(e.raw)) ?? 0;
  e.sharesCanonical = e.company.rawCount > 1;

  if (hasDateFragment(e.raw)) e.group = 'A';
  else if (e.sides.length >= 2 && e.sides.every(companyShaped)) e.group = 'B';
  else e.group = 'C';
}

// ---------------------------------------------------------------- Step 4: side matching (group B)
for (const e of colonNames) {
  if (e.group !== 'B') continue;
  e.sideMatches = [];
  for (const side of e.sides) {
    const k = normalizeName(side);
    const canonHit = byCanon.get(k);
    const rawHit = byRaw.get(k);
    const hit = canonHit ?? rawHit;
    // Ignore a self-match: the colon name's own company.
    if (hit && hit !== e.company) {
      e.sideMatches.push({
        side,
        matched: hit.canonical,
        via: canonHit ? 'canonical name' : 'raw folder name',
        files: hit.files,
        programs: hit.programs,
      });
    } else if (hit && hit === e.company) {
      e.sideMatches.push({ side, matched: hit.canonical, via: 'own company (self)', files: hit.files, programs: hit.programs, self: true });
    }
  }
  e.externalMatches = e.sideMatches.filter((m) => !m.self);
}

const groups = { A: [], B: [], C: [] };
for (const e of colonNames) groups[e.group].push(e);
for (const g of Object.values(groups)) g.sort((a, b) => b.files - a.files);

const bWithMatch = groups.B.filter((e) => e.externalMatches && e.externalMatches.length > 0);

// ---------------------------------------------------------------- write
const esc = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
const push = (s = '') => L.push(s);
const slash = (s) => s.replace(/\s*:\s*/g, ' / ');

push('# Colon / Slash Triage');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push('**Input:** `dist/inventory/clients-final.csv`, `dist/inventory/resolved-final.csv`');
push('**Method:** mechanical. Grouping uses the colon\'s position and the shape of the surrounding words only — **no judgement about company identity was made.** Nothing was rewritten and no folder was split.');
push();
push('## Why this list exists');
push();
push('macOS stores a `/` typed into a folder name as `:` at the POSIX layer, so a colon in a Dropbox folder name is usually a forward slash the user typed. Before anything moves to Google Drive, each of these needs a decision — and the decisions are not all the same kind:');
push();
push('- Some are **one name that happens to contain a slash** (a date range, a brand with a slash in it). Those need a naming decision.');
push('- Some look like **two companies joined by a slash**. Those need a client-identity decision, because the folder may hold files for two clients.');
push();
push(`**${colonNames.length} raw folder names, ${colonNames.reduce((s, e) => s + e.files, 0).toLocaleString()} files.**`);
push();
push('| Group | Meaning | Names | Files |');
push('|---|---|---|---|');
push(`| **A** | Contains a year or date fragment | ${groups.A.length} | ${groups.A.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push(`| **B** | Both sides are written like company names | ${groups.B.length} | ${groups.B.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push(`| **C** | Everything else | ${groups.C.length} | ${groups.C.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push();
push(`Of the ${groups.B.length} group-B names, **${bWithMatch.length} have at least one side that matches a different company already in the list** — the strongest available signal that the folder covers two clients rather than one. Details in the group B section.`);
push();
push('### How to fill this in');
push();
push('Write one of these in the **Decision** cell, or anything else that\'s clearer:');
push();
push('- `keep` — the colon is part of the real name, leave it');
push('- `slash` — it is a typed `/`; recreate the name with a slash');
push('- `split` — the folder holds two clients; needs splitting before migration');
push('- `?` — needs a look at the folder contents');
push();

function table(list, opts = {}) {
  push('| Raw folder name | Reads as | Files | Programs | Current company | Shares canonical | Decision |');
  push('|---|---|---|---|---|---|---|');
  for (const e of list) {
    push(`| \`${esc(e.raw)}\` | \`${esc(slash(e.raw))}\` | ${e.files.toLocaleString()} | ${e.programs} | ${esc(e.company.canonical)} | ${e.sharesCanonical ? `yes (${e.company.rawCount} raw names)` : 'no'} |  |`);
  }
  push();
}

push('---');
push();
push(`## Group A — contains a year or date fragment (${groups.A.length})`);
push();
push('The colon sits next to a year, a year range, or a month. These are almost certainly a typed `/` inside a single name, not two entities.');
push();
table(groups.A);

push('---');
push();
push(`## Group B — both sides written like company names (${groups.B.length})`);
push();
push('Both sides pass the shape test for a company name. **This is the group where the folder may hold two clients.**');
push();
table(groups.B);

if (bWithMatch.length) {
  push('### Side matches against the rest of the client list');
  push();
  push('For each group-B name, whether either side matches a **different** company already in the list — by canonical name or by one of its raw folder names. A match means that company exists independently, which is evidence the colon joins two real clients.');
  push();
  push('| Raw folder name | Side | Matches company | Matched via | That company\'s files | Programs |');
  push('|---|---|---|---|---|---|');
  for (const e of bWithMatch) {
    for (const m of e.externalMatches) {
      push(`| \`${esc(e.raw)}\` | \`${esc(m.side)}\` | **${esc(m.matched)}** | ${m.via} | ${m.files.toLocaleString()} | ${m.programs} |`);
    }
  }
  push();
  const noMatch = groups.B.filter((e) => !e.externalMatches || e.externalMatches.length === 0);
  if (noMatch.length) {
    push(`The remaining ${noMatch.length} group-B name${noMatch.length === 1 ? '' : 's'} had no side matching another company: ${noMatch.map((e) => `\`${esc(e.raw)}\``).join(', ')}. That is weaker evidence either way — the second party may simply never have had its own folder.`);
    push();
  }
}

push('---');
push();
push(`## Group C — everything else (${groups.C.length})`);
push();
push('One or both sides is not company-shaped — a person\'s name, a role, a status, a document word. Most are probably a typed `/` inside one name, but they do not fit either pattern above cleanly.');
push();
table(groups.C);

push('---');
push();
push('## Notes');
push();
push('- **Three canonical company names still carry a colon:** ' +
  [...new Set(colonNames.filter((e) => e.company.canonical.includes(':')).map((e) => e.company.canonical))].map((c) => `\`${esc(c)}\``).join(', ') +
  '. Whatever is decided for the raw names should be applied to these too.');
push('- **Two of these names are inside already-corrected merges** (`Vegpro: Salad Etc` under Vegpro, `Admin Slayer:Spring Planning` under Admin Slayer), so a `split` decision there would partly undo a hand-reviewed merge.');
push('- Nothing here has been changed. This document is the input to the decision, not the result of one.');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/colon-triage.mjs');
push('```');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  total: colonNames.length,
  files: colonNames.reduce((s, e) => s + e.files, 0),
  A: groups.A.length, B: groups.B.length, C: groups.C.length,
  B_with_external_side_match: bWithMatch.length,
  colon_canonicals: [...new Set(colonNames.filter((e) => e.company.canonical.includes(':')).map((e) => e.company.canonical))],
}, null, 2));

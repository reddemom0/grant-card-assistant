/**
 * mapping-lib.mjs — the destination-mapping rules, extracted so CanExport and
 * the full-corpus pass cannot drift apart.
 *
 * Lifted VERBATIM out of scripts/canexport-mapping.mjs. The CanExport mapping
 * regenerates byte-identical against this library; that equivalence is the
 * test, and it is checked on every full-corpus run.
 *
 * Pure string and lookup logic. No network, no filesystem, no API.
 *
 * The four routes:
 *   sort     Clients/[Client]/[Program]/[Year]/<substructure>/filename
 *   program  Programs/[Program]/<substructure>/filename
 *   archive  Archive/<Dropbox path mirrored>/filename
 *   review   no committed destination — a human decides
 */

import path from 'node:path';
import { isBatchName, normalizeName } from './grants-lib.mjs';

/** Year taken from the FIRST sub-path segment when it carries one. */
export const FIRST_SEG_YEAR = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;

/**
 * Plausible grant-cycle window. A four-digit number outside this range in a
 * folder name below the client is a course code or a product name, not a year.
 */
export const YEAR_MIN = 2013;
export const YEAR_MAX = 2027;

/**
 * Never use server_modified: 40,390 files share a single bulk-event date of
 * 2024-07-23, which would date most of the corpus to the same wrong day.
 */
export const yearOf = (f) => (f.cm ? f.cm.slice(0, 4) : null);

/** Conservative filename cleanup. NOT applied — phase 3 input only. */
export function cleanFilename(name) {
  const ext = path.extname(name);
  let base = ext ? name.slice(0, -ext.length) : name;
  base = base
    .replace(/:/g, ' - ')          // colon is a typed '/' on macOS; ' - ' is safe in Drive
    .replace(/[\\|<>"?*]/g, '-')   // characters awkward across filesystems
    .replace(/^[\s*_-]+/, '')      // leading decoration (*, _, -)
    .replace(/\s+/g, ' ')
    .replace(/[\s.]+$/, '')        // trailing dots/spaces
    .trim();
  if (!base) base = 'untitled';
  return base + ext.toLowerCase();
}

/**
 * Descend through batch folders (year groupings, "Clients", "2018 Q4"…) to
 * find the level that actually names a client. MAX_SKIP bounds the descent so
 * a pathological tree cannot run away.
 */
export function makeResolveNodes(childrenByParent, MAX_SKIP = 8) {
  return function resolveNodes(programKey) {
    const out = [];
    const stack = (childrenByParent.get(programKey) ?? []).map((c) => ({ ...c, skips: 0 }));
    while (stack.length) {
      const node = stack.pop();
      if (isBatchName(node.name) && node.skips < MAX_SKIP) {
        for (const c of childrenByParent.get(node.key) ?? []) stack.push({ ...c, skips: node.skips + 1 });
      } else {
        out.push({ name: node.name, key: node.key });
      }
    }
    return out;
  };
}

/**
 * Map a set of files to destinations.
 *
 * Returns the rows plus every counter the reports need. `folderRenames` is
 * per-call rather than module-level so two passes cannot pollute each other.
 */
export function mapFiles({
  files, nodeByKey, nameStatus, rawToCanon,
  joint = new Map(), cutoffIso, clientsRoot = 'Clients', archiveRoot = 'Archive',
}) {
  const folderRenames = new Map(); // old -> new

  /**
   * Sanitize a FOLDER path segment for Drive. Filenames are never passed
   * through this — only directory segments. The colon is the macOS encoding of
   * a typed '/', so ' - ' preserves the visual break without creating a path
   * separator.
   */
  function sanitizeSegment(seg) {
    const clean = seg.replace(/\s*:\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    if (clean !== seg) folderRenames.set(seg, clean);
    return clean;
  }
  const sanitizePath = (segs) => segs.map(sanitizeSegment).join('/');

  const out = [];
  const stats = {
    sort: { files: 0, bytes: 0 }, program: { files: 0, bytes: 0 },
    archive: { files: 0, bytes: 0 }, review: { files: 0, bytes: 0 },
  };
  const reviewReasons = new Map();
  const programTops = new Map();
  const noYear = [];
  const audit = [];          // per-file year provenance
  let dualFiled = 0;
  let yearCollapsed = 0;
  let yearMoved = 0, yearRecovered = 0, yearConfirmed = 0;
  let batchUsed = 0, batchCompeting = 0, batchMoved = 0, batchRecovered = 0;
  let subSegImplausible = 0, subSegContradicts = 0;

  for (const f of files) {
    const folderSegs = f.segs.slice(0, -1);
    let node = null;
    let nodeDepth = 0;
    for (let k = 1; k <= folderSegs.length; k++) {
      const hit = nodeByKey.get(folderSegs.slice(0, k).join('/'));
      if (hit) { node = hit; nodeDepth = k; break; }
    }
    const cmYear = yearOf(f);

    // Everything BELOW the client folder carries over unchanged; everything
    // above it is discarded. This is the reorganization.
    let subSegs = node ? folderSegs.slice(nodeDepth) : [];
    // The audit works off the ORIGINAL sub-path, before the year collapse, so
    // agreement between folder-year and client_modified is measured honestly.
    audit.push({
      path: f.path,
      program: f.program,
      derivedYear: cmYear,
      nodeName: node ? node.name : null,
      subOrig: subSegs.slice(),
      belowProgram: folderSegs.slice(1),
    });

    /**
     * Year, in precedence order:
     *   1. the FIRST segment of the client's sub-path, if it carries a year
     *   2. a year on a level DISCARDED between the program and the client
     *   3. client_modified
     *
     * (2) was added 2026-08-13. resolveNodes() skips cohort folders like
     * "2021 CSJ - Applications" and "Client Files - 2022:2023 Fiscal" to reach
     * the client beneath, and that skipped level is frequently the grant cycle
     * itself. Discarding it sent the year to client_modified — the last time a
     * byte moved, not the cycle — which collapsed two cycles of one client
     * onto a single destination and produced 288 collisions.
     *
     * A folder year records the cycle; client_modified records file movement.
     * Where batch levels nest and disagree, the INNERMOST wins: it is the most
     * specific statement about this file.
     *
     * Only levels STRICTLY between the program and the client count. The
     * client node itself is never read for a year, so a client folder that
     * happens to contain a date is not mistaken for a cycle.
     */
    const betweenSegs = node ? folderSegs.slice(1, nodeDepth - 1) : [];
    let batchYear = null;
    const batchYears = [];
    for (const seg of betweenSegs) {
      const m = seg.match(FIRST_SEG_YEAR);
      if (m) { batchYear = m[1]; batchYears.push(m[1]); }   // last = innermost
    }
    if (new Set(batchYears).size > 1) batchCompeting += 1;

    let year = cmYear;
    let yearSource = cmYear ? 'client_modified' : 'none';
    if (batchYear) {
      if (cmYear && batchYear !== cmYear) batchMoved += 1;
      else if (!cmYear) batchRecovered += 1;
      year = batchYear;
      yearSource = 'batch';
      batchUsed += 1;
    }
    /**
     * The first sub-path segment still outranks a batch level — it sits below
     * the client and is the more specific statement — but only if it survives
     * two tests, added 2026-08-17 after the ETG sample copy.
     *
     * FIRST_SEG_YEAR matches any four digits that look like a year, and folder
     * names below a client are full of numbers that are not years: product
     * names ("Advanced NMEA 2000 Installer"), course codes ("BLDT 2031",
     * "ACAP 2003"), and dates inside a cycle ("ERP implementation part 2
     * (January 2023)" filed under the 2022 intake). Each of those was being
     * read as the grant year.
     *
     *   1. PLAUSIBLE — inside 2013-2027. Granted has no grant cycles outside
     *      that window, so 1970, 2000, 2003 and 2031 are certainly not years.
     *   2. DOES NOT CONTRADICT — if a cohort folder above the client already
     *      states a year, a different year below the client loses. The cohort
     *      folder names the intake; a subfolder names a course.
     *
     * Fail either test and the segment is ignored: the batch year stands, or
     * client_modified if there is none. The folder itself is untouched and
     * stays in the substructure either way.
     */
    if (subSegs.length) {
      const m = subSegs[0].match(FIRST_SEG_YEAR);
      if (m) {
        const y = Number(m[1]);
        const plausible = y >= YEAR_MIN && y <= YEAR_MAX;
        const contradicts = Boolean(batchYear) && m[1] !== batchYear;
        if (plausible && !contradicts) {
          if (batchYear) batchUsed -= 1;
          year = m[1];
          yearSource = 'folder';
          if (cmYear && m[1] !== cmYear) yearMoved += 1;
          else if (!cmYear) yearRecovered += 1;
          else yearConfirmed += 1;
        } else {
          if (!plausible) subSegImplausible += 1;
          if (contradicts) subSegContradicts += 1;
        }
      }
    }

    // Collapse a leading sub-path segment that is EXACTLY the year, so
    // Client/Program/2023/2023/X/ becomes Client/Program/2023/X/. Exact string
    // match only — '2023-24', '2023 Application' and the like are left alone.
    if (year && subSegs.length && subSegs[0] === year) {
      subSegs = subSegs.slice(1);
      yearCollapsed += 1;
    }
    const sub = subSegs.length ? sanitizePath(subSegs) : '';
    if (!year) noYear.push(f);
    const proposed = cleanFilename(f.name);
    const src = f.path;

    // --- no attributed client ---------------------------------------------
    if (!node) {
      out.push({
        src, client: '', program: f.program, year: year ?? '',
        dest: `Review/${sanitizePath(folderSegs)}${folderSegs.length ? '/' : ''}${f.name}`,
        proposed, route: 'review', confidence: 'low', yearSource,
        reason: 'no client folder above this file',
      });
      reviewReasons.set('no attributed client', (reviewReasons.get('no attributed client') ?? 0) + 1);
      continue;
    }

    const nkey = normalizeName(node.name);
    const status = nameStatus.get(nkey);
    const canon = rawToCanon.get(nkey);
    const jointHit = joint.get(nkey);

    // --- joint-client folder: dual-file, one row per client ----------------
    if (jointHit) {
      dualFiled += 1;
      for (const who of jointHit) {
        out.push({
          src, client: who, program: f.program, year: year ?? '',
          dest: `Review/${sanitizeSegment(who)}/${sanitizeSegment(f.program)}/${year ?? 'unknown-year'}${sub ? '/' + sub : ''}/${f.name}`,
          proposed, route: 'review', confidence: 'low', yearSource,
          reason: `joint-client folder "${node.name}" — dual-filed pending split decision`,
        });
      }
      reviewReasons.set('joint-client folder (dual-filed)', (reviewReasons.get('joint-client folder (dual-filed)') ?? 0) + 1);
      continue;
    }

    // --- never judged -------------------------------------------------------
    if (!status || status.status === 'UNCLASSIFIED') {
      out.push({
        src, client: node.name, program: f.program, year: year ?? '',
        dest: `Review/${sanitizePath(folderSegs)}/${f.name}`, proposed, route: 'review', confidence: 'low', yearSource,
        reason: `folder "${node.name}" was never classified`,
      });
      reviewReasons.set('unjudged folder name', (reviewReasons.get('unjudged folder name') ?? 0) + 1);
      continue;
    }

    // --- program-level material --------------------------------------------
    // The top folder under the program is labelled internal or doctype, so
    // this belongs to the grant program itself rather than to any client. The
    // label comes from the classification, not from a hardcoded folder list.
    if (status.label === 'internal' || status.label === 'doctype') {
      const belowProgram = folderSegs.slice(1);
      out.push({
        src, client: '', program: f.program, year: year ?? '',
        dest: `Programs/${sanitizeSegment(f.program)}${belowProgram.length ? '/' + sanitizePath(belowProgram) : ''}/${f.name}`,
        proposed, route: 'program', yearSource,
        confidence: status.confidence === 'high' ? 'high' : 'medium',
        reason: `program-level material — top folder "${node.name}" is labelled ${status.label}`,
      });
      programTops.set(node.name, (programTops.get(node.name) ?? 0) + 1);
      continue;
    }

    // --- judged, but not a client ------------------------------------------
    if (status.label !== 'client' || !canon) {
      out.push({
        src, client: '', program: f.program, year: year ?? '',
        dest: `Review/${sanitizePath(folderSegs)}/${f.name}`, proposed, route: 'review', confidence: 'low', yearSource,
        reason: `folder "${node.name}" is labelled ${status.label}, not a client`,
      });
      reviewReasons.set(`non-client folder (${status.label})`, (reviewReasons.get(`non-client folder (${status.label})`) ?? 0) + 1);
      continue;
    }

    // --- archive-only client: mirror the Dropbox path exactly ---------------
    if (canon.retention === 'archive_only') {
      out.push({
        src, client: canon.canonical, program: f.program, year: year ?? '',
        dest: `${archiveRoot}/${sanitizePath(folderSegs)}/${f.name}`, proposed, route: 'archive', yearSource,
        confidence: status.confidence === 'high' ? 'high' : 'medium',
        reason: `client has no file newer than ${cutoffIso.slice(0, 10)} — mirrored, not reorganized`,
      });
      continue;
    }

    // --- sort ---------------------------------------------------------------
    const conf = !year ? 'medium' : (status.confidence === 'high' ? 'high' : 'medium');
    out.push({
      src, client: canon.canonical, program: f.program, year: year ?? '',
      // Clients/ prefix added 2026-08-13 to match the completed Drive
      // restructure, which moved all 90 client folders under a Clients/ root.
      // Programs/ and Archive/ deliberately stay at the Shared Drive root —
      // the restructure left them there.
      dest: `${clientsRoot}/${sanitizeSegment(canon.canonical)}/${sanitizeSegment(f.program)}/${year ?? 'unknown-year'}${sub ? '/' + sub : ''}/${f.name}`,
      proposed, route: 'sort', confidence: conf, yearSource,
      reason: !year ? 'no client_modified date; year unresolved'
        : (status.confidence === 'high' ? 'client match high confidence' : `client match ${status.confidence} confidence`),
    });
  }

  return {
    out, stats, reviewReasons, programTops, noYear, audit, folderRenames,
    sanitizeSegment, sanitizePath,
    counters: {
      dualFiled, yearCollapsed, yearMoved, yearRecovered, yearConfirmed,
      batchUsed, batchCompeting, batchMoved, batchRecovered,
      subSegImplausible, subSegContradicts,
    },
  };
}

/**
 * Case-fold destination FOLDER paths so that two Dropbox folders differing
 * only in capitalization map to ONE destination folder.
 *
 * Why: Drive's `name =` folder query is case-insensitive, so at copy time the
 * copier merges case-variant folders — whichever spelling is created first
 * wins and every later variant lands inside it. The 2026-08-17/18 ETG copy
 * created 15 such merges (157 files whose Drive path differs from the mapping
 * only in case). Rather than fight Drive, the mapping adopts its behavior:
 *
 *   RULE — first-created wins. Where a folder already exists in Drive, its
 *   spelling is canonical (pass Drive's folder list in `driveFolders`,
 *   shallow-first). Where it does not yet exist, the spelling of the first
 *   mapping row that references the folder is canonical — which is exactly
 *   the spelling the copier will create when it reaches that row.
 *
 * Filenames are NOT folded: Drive stores same-name files side by side, and
 * two files differing only in name case are distinct files. Only directory
 * segments fold. Rows routed `review` have no destination and are skipped.
 *
 * Folding runs BEFORE collision detection, so two same-named files from two
 * case-variant folders become an exact destination collision and take the
 * standard suffix rule.
 */
export function foldDestinationCase(rows, driveFolders = []) {
  const canon = new Map();   // lowercased folder path -> canonical spelling
  const register = (folderPath) => {
    const segs = folderPath.split('/');
    let low = '', can = '';
    for (const seg of segs) {
      low = low ? `${low}/${seg.toLowerCase()}` : seg.toLowerCase();
      if (!canon.has(low)) canon.set(low, can ? `${can}/${seg}` : seg);
      can = canon.get(low);
    }
    return can;
  };
  for (const p of driveFolders) register(p);   // Drive spellings are the reference

  let changed = 0;
  const changes = [];
  const variantGroups = new Set();
  for (const r of rows) {
    if (r.route === 'review') continue;
    const segs = r.dest.split('/');
    const fname = segs.pop();
    if (!segs.length) continue;
    const folded = register(segs.join('/'));
    if (folded !== segs.join('/')) {
      variantGroups.add(segs.join('/').toLowerCase());
      changes.push({ src: r.src, from: r.dest, to: `${folded}/${fname}` });
      r.dest = `${folded}/${fname}`;
      changed += 1;
    }
  }
  return { changed, changes, variantGroups: variantGroups.size };
}

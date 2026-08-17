/**
 * Google Docs EDITING tools
 *
 * Three operations on a document that already exists: read its outline, insert
 * into it, replace a section under a heading.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * DOCS API ONLY. Every call here is documents.get or documents.batchUpdate,
 * which the granted `documents` scope covers for any document the user can
 * open — including one a colleague shared. Do NOT add Drive calls (files.get,
 * files.update, permissions.*): the only Drive scope this app holds is
 * drive.file, which reaches app-created files only, so a Drive call would
 * fail on exactly the shared documents this module exists to support.
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * Every write sends writeControl.requiredRevisionId. Indices are computed from
 * a documents.get; if anyone edits the document in between, those indices
 * describe a document that no longer exists and a delete would land on the
 * wrong span. requiredRevisionId turns that silent corruption into a clean
 * 400. targetRevisionId is deliberately NOT used — its merge semantics would
 * apply our delete against shifted content, which is the case we are avoiding.
 *
 * ── UTF-16 ──────────────────────────────────────────────────────────────────
 * Docs indices count UTF-16 code units. JavaScript's String.length counts the
 * same units, so `.length` is already correct and needs no conversion — an
 * emoji is 2 in both systems. The hazard is the opposite: [...str].length,
 * Array.from(str).length and for…of iterate CODE POINTS, would count that
 * emoji as 1, and would desynchronise every subsequent index. This module uses
 * .length and index arithmetic only. Do not "fix" it with spread.
 */

import { google } from 'googleapis';
import { getUserOAuth2Client } from './google-docs.js';
import { markdownToGrantedDocsRequests } from './google-docs-advanced.js';

/** Heading levels we treat as structure. */
const HEADING_RE = /^HEADING_([1-6])$/;

/** Characters of section body to show as a preview in the outline. */
const PREVIEW_CHARS = 120;

async function getDocsClient(userId) {
  if (!userId) {
    throw new Error('userId is required — Docs editing runs as the signed-in user.');
  }
  const auth = await getUserOAuth2Client(userId);
  return google.docs({ version: 'v1', auth });
}

/**
 * Reject content the converter cannot represent safely.
 *
 * Pipe tables are not a recognised branch in markdownToGrantedDocsRequests, so
 * they would be inserted as literal '| a | b |' text — silent degradation
 * inside somebody's real document. [TABLE:…] markers are the converter's own
 * dialect and render as preformatted text, which is not what the model means
 * when it writes a table. Refusing is the honest outcome for both.
 *
 * @returns {string|null} refusal reason, or null when the content is fine
 */
export function tableRejectionReason(content) {
  const lines = String(content || '').split('\n');

  for (const line of lines) {
    const t = line.trim();
    // A markdown table row: starts and ends with a pipe and has an inner one.
    if (t.startsWith('|') && t.endsWith('|') && t.slice(1, -1).includes('|')) {
      return 'content contains a markdown pipe table';
    }
    // A separator row like |---|---| even when the row above was not matched.
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t)) {
      return 'content contains a markdown table separator row';
    }
    if (t.startsWith('[TABLE:')) {
      return 'content contains a [TABLE:...] marker';
    }
  }
  return null;
}

/** Plain text of one structural element's paragraph. */
function paragraphText(element) {
  const els = element?.paragraph?.elements || [];
  return els.map(e => e?.textRun?.content || '').join('');
}

/**
 * Walk body.content and return every real heading, in document order.
 *
 * "Real" means ParagraphStyle.namedStyleType is HEADING_1..HEADING_6. A bold
 * line is not a heading. Documents created before the creation path started
 * emitting namedStyleType will therefore return an empty list — that is
 * accurate, not a bug, and the callers below say so explicitly rather than
 * guessing at structure.
 */
export function extractHeadings(doc) {
  const content = doc?.body?.content || [];
  const headings = [];

  content.forEach((element, position) => {
    const named = element?.paragraph?.paragraphStyle?.namedStyleType;
    const m = named && HEADING_RE.exec(named);
    if (!m) return;

    headings.push({
      text: paragraphText(element).replace(/\n$/, '').trim(),
      level: Number(m[1]),
      startIndex: element.startIndex,
      endIndex: element.endIndex,
      position
    });
  });

  return headings;
}

/**
 * The body range a heading owns: from the end of the heading paragraph to the
 * start of the next heading at the SAME OR HIGHER level (lower number), or the
 * end of the body.
 *
 * Consequence worth being explicit about: a '##' section therefore contains its
 * '###' subsections, so replacing it replaces them too. That is the coherent
 * reading of "replace this section" — the alternative (stop at the next heading
 * of any level) would leave those subsections stranded after the new content.
 * The outline surfaces sectionLength so the extent is visible before anyone
 * acts on it.
 */
export function sectionBodyRange(doc, headings, i) {
  const heading = headings[i];
  const content = doc?.body?.content || [];

  const next = headings.find((h, j) => j > i && h.level <= heading.level);
  const start = heading.endIndex;

  if (next) return { startIndex: start, endIndex: next.startIndex };

  // To the end of the body. The final structural element ends with the
  // document's trailing newline, which cannot be deleted — hence the -1.
  const last = content[content.length - 1];
  return { startIndex: start, endIndex: Math.max(start, (last?.endIndex ?? start + 1) - 1) };
}

/**
 * Locate a heading by text. Case-insensitive, whitespace-normalised.
 * Returns every match — callers refuse on ambiguity rather than picking one.
 */
export function findHeadings(headings, headingText) {
  const want = String(headingText || '').trim().toLowerCase();
  return headings
    .map((h, i) => ({ ...h, i }))
    .filter(h => h.text.trim().toLowerCase() === want);
}

/**
 * Force inserted content to body style unless it asks to be a heading.
 *
 * WHY: Docs gives inserted text the paragraph style of the paragraph it lands
 * in. Every insertion point these tools use sits against a heading — a replace
 * inserts at heading.endIndex, and insert's three positions are all adjacent to
 * one — so raw converter output inherits HEADING_2/3 and the whole new section
 * renders as a heading. Observed in production: replacing a section under a
 * Heading 2 produced body text styled as Heading 2.
 *
 * The converter never sets NORMAL_TEXT explicitly (it only styles the lines it
 * recognises as headings), so nothing was resetting the inherited style.
 *
 * HOW: insert everything, blanket the inserted span with NORMAL_TEXT, then
 * re-apply the converter's own heading and bullet styling on top. Ordering
 * matters — batchUpdate applies requests in sequence, so the blanket must land
 * after the text exists and before the styles that override it.
 *
 * `fields: 'namedStyleType'` is deliberately narrow: it resets the named style
 * and nothing else, leaving spacing, alignment and list membership alone.
 *
 * @param {Array} requests - output of markdownToGrantedDocsRequests
 * @param {number} startIndex - index the content was rendered from
 * @returns {Array} reordered requests, safe to send as one batch
 */
export function withBodyStyleReset(requests, startIndex) {
  // UTF-16 code units, matching Docs — see the module header on why .length is
  // correct here and spread/Array.from would not be.
  const insertedLength = requests.reduce(
    (n, r) => n + (r.insertText?.text?.length || 0), 0
  );
  if (insertedLength === 0) return requests;

  // Styles that must survive the reset, so they are re-applied after it.
  const isHeadingStyle = (r) => Boolean(r.updateParagraphStyle?.paragraphStyle?.namedStyleType);
  const isBullets = (r) => Boolean(r.createParagraphBullets);

  const base = requests.filter(r => !isHeadingStyle(r) && !isBullets(r));
  const deferred = requests.filter(r => isHeadingStyle(r) || isBullets(r));

  const reset = {
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + insertedLength },
      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
      fields: 'namedStyleType'
    }
  };

  return [...base, reset, ...deferred];
}

function ambiguityError(matches, headingText) {
  return {
    success: false,
    error: `"${headingText}" matches ${matches.length} headings — it is ambiguous, so nothing was changed. Ask which one, or use a heading whose text is unique.`,
    candidates: matches.map(m => ({ text: m.text, level: m.level, startIndex: m.startIndex }))
  };
}

/** Shared translation of a failed batchUpdate into something Oracle can act on. */
function writeError(err) {
  const msg = err?.message || String(err);
  const stale = err?.code === 400 && /revision/i.test(msg);
  if (stale) {
    return {
      success: false,
      stale_revision: true,
      error: 'The document changed since you read it, so nothing was written. Call read_google_doc_outline again to get a fresh revision_id, then retry the edit.'
    };
  }
  if (err?.code === 403 || err?.code === 404) {
    return {
      success: false,
      error: `Cannot access that document (${err.code}). Check the document ID, and that the signed-in user can open it.`
    };
  }
  return { success: false, error: `Docs API error: ${msg}` };
}

/**
 * Read a document's heading structure.
 *
 * Deliberately does NOT return body text — read_google_drive_file already does
 * that, and returning a whole document here would swamp the context for what is
 * meant to be a positioning aid.
 */
export async function readGoogleDocOutline({ document_id }, userId) {
  if (!document_id) return { success: false, error: 'document_id is required.' };

  let doc;
  try {
    const docs = await getDocsClient(userId);
    const res = await docs.documents.get({ documentId: document_id });
    doc = res.data;
  } catch (err) {
    return writeError(err);
  }

  const headings = extractHeadings(doc);

  return {
    success: true,
    documentId: document_id,
    title: doc.title,
    revision_id: doc.revisionId,
    heading_count: headings.length,
    headings: headings.map((h, i) => {
      const range = sectionBodyRange(doc, headings, i);
      const body = (doc.body.content || [])
        .filter(e => e.startIndex >= range.startIndex && e.endIndex <= range.endIndex)
        .map(paragraphText).join('').trim();
      return {
        text: h.text,
        level: h.level,
        startIndex: h.startIndex,
        endIndex: h.endIndex,
        // How much replace_google_doc_section would remove. Surfaced so the
        // extent of a destructive edit is visible before it is requested.
        section_length: Math.max(0, range.endIndex - range.startIndex),
        preview: body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body
      };
    }),
    note: headings.length === 0
      ? 'This document has no structural headings, so its sections cannot be addressed by name. It was most likely created before headings were emitted. Insert at the end, or ask the person to add real headings in Google Docs.'
      : undefined
  };
}

/**
 * Insert markdown content at the end, or relative to a heading.
 * Additive — never removes anything.
 */
export async function insertIntoGoogleDoc(
  { document_id, content, position = 'end', heading_text, revision_id },
  userId
) {
  if (!document_id) return { success: false, error: 'document_id is required.' };
  if (!content || !String(content).trim()) return { success: false, error: 'content is required.' };
  if (!revision_id) {
    return { success: false, error: 'revision_id is required — call read_google_doc_outline first so the edit can be checked against the document you actually read.' };
  }

  const tableReason = tableRejectionReason(content);
  if (tableReason) {
    return { success: false, error: `Refused: ${tableReason}. Tables cannot be inserted into an existing document — rewrite that part as short paragraphs or a bulleted list.` };
  }

  const positional = position === 'before_heading' || position === 'after_heading';
  if (positional && !heading_text) {
    return { success: false, error: `position "${position}" requires heading_text.` };
  }
  if (!['end', 'before_heading', 'after_heading'].includes(position)) {
    return { success: false, error: `Unknown position "${position}". Use end, before_heading, or after_heading.` };
  }

  let doc, docs;
  try {
    docs = await getDocsClient(userId);
    doc = (await docs.documents.get({ documentId: document_id })).data;
  } catch (err) {
    return writeError(err);
  }

  let insertAt;
  if (position === 'end') {
    const content_ = doc.body.content || [];
    const last = content_[content_.length - 1];
    insertAt = Math.max(1, (last?.endIndex ?? 2) - 1);
  } else {
    const headings = extractHeadings(doc);
    const matches = findHeadings(headings, heading_text);
    if (matches.length === 0) {
      return {
        success: false,
        error: `No heading matches "${heading_text}", so nothing was inserted.`,
        available_headings: headings.map(h => h.text)
      };
    }
    if (matches.length > 1) return ambiguityError(matches, heading_text);

    const h = matches[0];
    insertAt = position === 'before_heading' ? h.startIndex : h.endIndex;
  }

  // Same inherited-heading-style problem as replace: every position here is
  // adjacent to a heading paragraph.
  const requests = withBodyStyleReset(
    markdownToGrantedDocsRequests(String(content), insertAt),
    insertAt
  );
  if (requests.length === 0) return { success: false, error: 'content produced no document changes.' };

  try {
    const res = await docs.documents.batchUpdate({
      documentId: document_id,
      requestBody: { requests, writeControl: { requiredRevisionId: revision_id } }
    });
    return {
      success: true,
      documentId: document_id,
      insertedAtIndex: insertAt,
      new_revision_id: res.data.writeControl?.requiredRevisionId || null,
      message: `Inserted ${String(content).length} characters at index ${insertAt}.`
    };
  } catch (err) {
    return writeError(err);
  }
}

/**
 * Replace the body beneath a heading. The heading itself is kept.
 *
 * The delete and the insert go in ONE batchUpdate so the document can never be
 * left with the old section gone and the new one missing.
 */
export async function replaceGoogleDocSection(
  { document_id, heading_text, content, revision_id },
  userId
) {
  if (!document_id) return { success: false, error: 'document_id is required.' };
  if (!heading_text) return { success: false, error: 'heading_text is required.' };
  if (!content || !String(content).trim()) return { success: false, error: 'content is required.' };
  if (!revision_id) {
    return { success: false, error: 'revision_id is required — call read_google_doc_outline first so the edit can be checked against the document you actually read.' };
  }

  const tableReason = tableRejectionReason(content);
  if (tableReason) {
    return { success: false, error: `Refused: ${tableReason}. Tables cannot be written into an existing document — rewrite that part as short paragraphs or a bulleted list.` };
  }

  let doc, docs;
  try {
    docs = await getDocsClient(userId);
    doc = (await docs.documents.get({ documentId: document_id })).data;
  } catch (err) {
    return writeError(err);
  }

  const headings = extractHeadings(doc);
  const matches = findHeadings(headings, heading_text);

  // Never fall back to appending — a replace that silently becomes an append
  // leaves the stale section in place and duplicates the content.
  if (matches.length === 0) {
    return {
      success: false,
      error: `No heading matches "${heading_text}", so nothing was changed. This tool only replaces an existing section; it will not append.`,
      available_headings: headings.map(h => h.text)
    };
  }
  if (matches.length > 1) return ambiguityError(matches, heading_text);

  const range = sectionBodyRange(doc, headings, matches[0].i);
  const removing = Math.max(0, range.endIndex - range.startIndex);

  // Delete first, then insert at the freed position. Both in one batch: Docs
  // applies requests in order, so the insert index is the range start once the
  // old body is gone.
  const requests = [];
  if (removing > 0) {
    requests.push({
      deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } }
    });
  }
  // The inserted body must be reset to NORMAL_TEXT: it lands immediately after
  // the heading paragraph and would otherwise inherit HEADING_2/3.
  requests.push(...withBodyStyleReset(
    markdownToGrantedDocsRequests(String(content), range.startIndex),
    range.startIndex
  ));

  try {
    const res = await docs.documents.batchUpdate({
      documentId: document_id,
      requestBody: { requests, writeControl: { requiredRevisionId: revision_id } }
    });
    return {
      success: true,
      documentId: document_id,
      heading: matches[0].text,
      replacedRange: range,
      charactersRemoved: removing,
      new_revision_id: res.data.writeControl?.requiredRevisionId || null,
      message: `Replaced the "${matches[0].text}" section — removed ${removing} characters, inserted ${String(content).length}.`
    };
  } catch (err) {
    return writeError(err);
  }
}

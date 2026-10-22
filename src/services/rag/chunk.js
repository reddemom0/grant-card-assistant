/**
 * Granted Files RAG — chunking
 *
 * About 500 tokens (≈2,000 characters) per chunk with 10% overlap, cut at a
 * paragraph, line, sentence or word boundary. src/utils/document-chunker.js is
 * not reused: it splits by headings into sections of up to 5k characters, has
 * no overlap and no page or tab locators.
 *
 * Text segments (PDF pages, a document body) are chunked as one stream, so a
 * chunk may span pages ("pp. 3–4"). Sheet segments (they carry a `header`) are
 * chunked one tab at a time and every chunk starts with that tab's header rows,
 * so numbers keep their column meaning.
 */

import { estimateTokens } from './extract.js';

const CHARS_PER_TOKEN = 4;

/**
 * Split text into overlapping windows at natural boundaries.
 * @param {string} text
 * @param {number} size - target characters per chunk
 * @param {number} overlap - characters repeated from the previous chunk
 * @returns {{start: number, end: number}[]} spans into text
 */
export function windows(text, size, overlap) {
  const spans = [];
  const len = text.length;
  let start = 0;
  while (start < len) {
    let end = Math.min(start + size, len);
    if (end < len) end = breakPoint(text, start + Math.floor(size * 0.6), end);
    spans.push({ start, end });
    if (end >= len) break;
    // Step back by the overlap, then forward to the start of a word.
    let next = Math.max(end - overlap, start + 1);
    while (next < end && !/\s/.test(text[next - 1])) next++;
    start = next;
  }
  return spans;
}

// The last good boundary between lo and hi: blank line, newline, sentence end, space.
function breakPoint(text, lo, hi) {
  const slice = text.slice(lo, hi);
  for (const re of [/\n\n/g, /\n/g, /[.!?]["')\]]?\s/g, /\s/g]) {
    let last = -1;
    for (const m of slice.matchAll(re)) last = m.index + m[0].length;
    if (last > 0) return lo + last;
  }
  return hi;
}

function pageLocator(locators) {
  const pages = locators.filter(Boolean);
  if (!pages.length) return null;
  if (pages.length === 1 || pages[0] === pages.at(-1)) return pages[0];
  const first = pages[0].replace(/^p\. /, '');
  const last = pages.at(-1).replace(/^p\. /, '');
  return `pp. ${first}–${last}`;
}

/**
 * @param {{locator: string|null, text: string, header?: string}[]} segments - redacted
 * @param {{targetTokens?: number, overlap?: number}} [opts]
 * @returns {{chunk_no: number, locator: string|null, text: string, token_count: number}[]}
 */
export function chunkSegments(segments, { targetTokens = 500, overlap = 0.1 } = {}) {
  const size = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.floor(size * overlap);
  const chunks = [];
  const push = (locator, text) => {
    const t = text.trim();
    if (t) chunks.push({ chunk_no: chunks.length, locator, text: t, token_count: estimateTokens(t) });
  };

  const sheets = segments.filter(s => s.header !== undefined);
  const flow = segments.filter(s => s.header === undefined);

  if (flow.length) {
    // One stream; remember where each segment starts so a span maps back to its pages.
    let text = '';
    const starts = [];
    for (const seg of flow) {
      if (text) text += '\n\n';
      starts.push({ at: text.length, locator: seg.locator });
      text += seg.text;
    }
    for (const { start, end } of windows(text, size, overlapChars)) {
      const covered = starts.filter((s, i) => s.at < end && (starts[i + 1]?.at ?? Infinity) > start);
      push(pageLocator(covered.map(s => s.locator)), text.slice(start, end));
    }
  }

  for (const seg of sheets) {
    const header = seg.header || '';
    const bodySize = Math.max(size - header.length - 1, Math.floor(size / 4));
    if (!seg.text) { push(seg.locator, header); continue; }
    for (const { start, end } of windows(seg.text, bodySize, Math.floor(bodySize * overlap))) {
      push(seg.locator, header ? `${header}\n${seg.text.slice(start, end)}` : seg.text.slice(start, end));
    }
  }

  return chunks;
}

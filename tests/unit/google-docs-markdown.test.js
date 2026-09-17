/**
 * create_google_doc markdown conversion
 *
 * Replays the requests markdownToDocsRequests produces into a plain string, the
 * way the Docs API would apply them, and checks that each bold/italic range
 * covers exactly the words it should. A **bold** pair used to be mistaken for an
 * italic too, which shifted every later style range onto the wrong characters —
 * "**Date:** September 17" came out as "Dat" bold and "026" italic.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/google-docs-markdown.test.js
 */

import { jest } from '@jest/globals';

// google-docs.js loads .env on import; keep this test independent of it.
jest.unstable_mockModule('dotenv', () => ({ config: () => ({}), default: { config: () => ({}) } }));

const { markdownToDocsRequests } = await import('../../src/tools/google-docs.js');

/** Apply insertText requests (Docs indexes start at 1) and collect styled text. */
function render(markdown) {
  let body = '';
  const styled = { bold: [], italic: [] };
  const styleRanges = [];

  for (const request of markdownToDocsRequests(markdown)) {
    if (request.insertText) {
      const at = request.insertText.location.index - 1;
      body = body.slice(0, at) + request.insertText.text + body.slice(at);
    } else if (request.updateTextStyle) {
      styleRanges.push(request.updateTextStyle);
    }
  }

  for (const { range, textStyle, fields } of styleRanges) {
    const text = body.slice(range.startIndex - 1, range.endIndex - 1);
    // Heading styling sets several fields at once; only inline styles are checked here.
    if (fields === 'bold' && textStyle.bold) styled.bold.push(text);
    if (fields === 'italic' && textStyle.italic) styled.italic.push(text);
  }
  return { body, ...styled };
}

describe('inline bold and italic land on the right characters', () => {
  test('a bold label at the start of a paragraph', () => {
    const r = render('**Date:** September 17, 2026');
    expect(r.body).toBe('Date: September 17, 2026\n');
    expect(r.bold).toEqual(['Date:']);
    expect(r.italic).toEqual([]);
  });

  test('a bold label in a bullet — the Test Metalworks line', () => {
    const r = render('- **Legal Name:** Test Metalworks Ltd.');
    expect(r.body).toBe('Legal Name: Test Metalworks Ltd.\n');
    expect(r.bold).toEqual(['Legal Name:']);
    expect(r.italic).toEqual([]);
  });

  test('several bold and italic spans on one line', () => {
    const r = render('Revenue **$6.2M** in *FY2024* and **$5.1M** in *FY2025*.');
    expect(r.body).toBe('Revenue $6.2M in FY2024 and $5.1M in FY2025.\n');
    expect(r.bold).toEqual(['$6.2M', '$5.1M']);
    expect(r.italic).toEqual(['FY2024', 'FY2025']);
  });

  test('italic before bold', () => {
    const r = render('An *important* note on **eligibility** here');
    expect(r.italic).toEqual(['important']);
    expect(r.bold).toEqual(['eligibility']);
  });

  test('a checkbox line with a bold label', () => {
    const r = render('☐ **Revenue ≥ $1M:** financials not yet received');
    expect(r.body).toBe('☐  Revenue ≥ $1M: financials not yet received\n');
    expect(r.bold).toEqual(['Revenue ≥ $1M:']);
    expect(r.italic).toEqual([]);
  });

  test('plain italic on its own still works', () => {
    const r = render('- an *exceptional* basis only');
    expect(r.italic).toEqual(['exceptional']);
    expect(r.bold).toEqual([]);
  });

  test('styles never spill into the next line', () => {
    const r = render([
      '- **Employees:** 40',
      '## **Company Overview**',
      '**Fiscal Year End:** December 31',
      '- plain bullet'
    ].join('\n'));

    expect(r.body).toBe('Employees: 40\nCompany Overview\nFiscal Year End: December 31\nplain bullet\n');
    expect(r.bold).toEqual(['Employees:', 'Fiscal Year End:']);
    expect(r.italic).toEqual([]);
  });

  test('a line with no markup gets no inline styles', () => {
    const r = render('Legal name: Test Metalworks Ltd.');
    expect(r.bold).toEqual([]);
    expect(r.italic).toEqual([]);
  });
});

describe('what the converter does not handle (documented, not changed)', () => {
  test('# headings and --- dividers are inserted as literal text', () => {
    const r = render('# RTRI Readiness Assessment\n---');
    expect(r.body).toBe('# RTRI Readiness Assessment\n---\n');
  });

  test('numbered lists are literal text, and "- [ ]" is a bullet, not a checkbox', () => {
    const r = render('1. First\n- [ ] item');
    expect(r.body).toBe('1. First\n[ ] item\n');
  });
});

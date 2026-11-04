/**
 * Lead-gen booking links stay out of the model's context, and the chat safety
 * net removes a stray link cleanly.
 *
 * - src/utils/booking-urls.js: host detection, redactBookingUrls, omitBookingLinks
 * - src/tools/memory.js: lead-gen reads strip booking URLs (prompt injection,
 *   memory_list, memory_recall); other agents see stored values unchanged
 * - src/api/booking-link-routing.js: substituteBookingLink catches non-HubSpot
 *   hosts and, on no-call tiers in chat, drops the sentence that held the link
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-booking-links.test.js
 */

import { jest } from '@jest/globals';

const NATALIE = 'https://meetings.hubspot.com/natalie392/15min-intro-to-granted';
const RUK = 'https://meetings.hubspot.com/rukshaar-ali';
const CALENDLY = 'https://calendly.com/someone/30min';

let memoryRows = [];
const mockPoolQuery = jest.fn(async (sql, params) => {
  if (/AND key = \$2/.test(sql)) {
    const row = memoryRows.find(r => r.key === params[1]);
    return { rows: row ? [{ value: row.value, created_at: 't' }] : [] };
  }
  return { rows: memoryRows.map(r => ({ ...r, created_at: 't' })) };
});

jest.unstable_mockModule('pg', () => ({
  default: { Pool: jest.fn(() => ({ query: mockPoolQuery, on: jest.fn() })) }
}));

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test/test';

const { redactBookingUrls, omitBookingLinks, bookingUrlRegex } = await import('../../src/utils/booking-urls.js');
const { loadConversationMemories, listMemories, recallMemory } = await import('../../src/tools/memory.js');
const { substituteBookingLink, BookingLinkRoutingError } = await import('../../src/api/booking-link-routing.js');

const STORED_CATEGORIZATION = JSON.stringify({
  service_tier: 'pro',
  consultant_assignment: { name: 'Rukshaar Ali', booking_link: RUK },
  booking_link: RUK
});
const STORED_ESTIMATE = JSON.stringify({ service_tier: 'starter', booking_link: NATALIE });

beforeEach(() => {
  mockPoolQuery.mockClear();
  memoryRows = [
    { key: 'categorization', value: STORED_CATEGORIZATION },
    { key: 'merged_estimate', value: STORED_ESTIMATE },
    { key: 'note', value: `They mentioned ${CALENDLY} and https://granted.ca/granted-starter/` }
  ];
});

const STARTER = { best_fit_product: 'Granted Starter' };
const PRO = { best_fit_product: 'Granted Pro', industry: 'Manufacturing' };
const chat = (text, routing) => substituteBookingLink(text, routing, { mode: 'chat' });

describe('booking URL detection', () => {
  test('catches HubSpot, Calendly, cal.com and Google appointment links', () => {
    for (const url of [NATALIE, CALENDLY, 'https://www.calendly.com/x', 'https://cal.com/team/intro',
      'https://app.cal.com/x', 'https://calendar.app.google/abc123']) {
      expect(bookingUrlRegex().test(url)).toBe(true);
    }
  });
  test('leaves other links alone, including lookalike hosts', () => {
    for (const url of ['https://granted.ca/granted-starter/', 'https://local.com/x',
      'https://notcalendly.com/x', 'https://app.getgranted.ca']) {
      expect(bookingUrlRegex().test(url)).toBe(false);
    }
  });
  test('redactBookingUrls keeps stored JSON parseable', () => {
    const out = JSON.parse(redactBookingUrls(STORED_CATEGORIZATION));
    expect(out.booking_link).toBe('');
    expect(out.consultant_assignment).toEqual({ name: 'Rukshaar Ali', booking_link: '' });
  });
});

describe('omitBookingLinks (memory writes)', () => {
  test('drops booking_link and consultant_assignment.booking_link, keeps the name', () => {
    const input = { service_tier: 'pro', booking_link: RUK, consultant_assignment: { name: 'Rukshaar Ali', booking_link: RUK } };
    const out = omitBookingLinks(input);
    expect(out).toEqual({ service_tier: 'pro', consultant_assignment: { name: 'Rukshaar Ali' } });
    expect(JSON.stringify(out)).not.toMatch(/meetings\.hubspot\.com/);
  });
  test('does not mutate the input, and passes null consultant through', () => {
    const input = { booking_link: NATALIE, consultant_assignment: null };
    omitBookingLinks(input);
    expect(input.booking_link).toBe(NATALIE);
    expect(omitBookingLinks(input)).toEqual({ consultant_assignment: null });
  });
});

describe('memory reads', () => {
  test('lead-gen prompt injection never contains a booking URL', async () => {
    const block = await loadConversationMemories('s1', { redactBookingUrls: true });
    expect(bookingUrlRegex().test(block)).toBe(false);
    expect(block).toContain('https://granted.ca/granted-starter/');
    expect(block).toContain('Rukshaar Ali');
  });
  test('without the option (other agents) values are unchanged', async () => {
    const block = await loadConversationMemories('s1');
    expect(block).toContain(RUK);
    expect(block).toContain(CALENDLY);
  });
  test('memory_list and memory_recall are redacted under the option', async () => {
    const listed = await listMemories('s1', { redactBookingUrls: true });
    expect(bookingUrlRegex().test(JSON.stringify(listed.memories))).toBe(false);
    const recalled = await recallMemory('s1', 'merged_estimate', { redactBookingUrls: true });
    expect(recalled.found).toBe(true);
    expect(JSON.parse(recalled.value).booking_link).toBe('');
    expect((await recallMemory('s1', 'merged_estimate')).value).toBe(STORED_ESTIMATE);
  });
});

describe('chat safety net on no-call tiers', () => {
  test('the sentence that introduced the link goes with it', () => {
    expect(chat('Great question. You can pick a time here: {{BOOKING_LINK}}. Talk soon!', STARTER))
      .toBe('Great question. Talk soon!');
  });
  test('a raw URL sentence is removed, not left as "book a call here:"', () => {
    const out = chat(`Thanks for the details. Book a call here: ${NATALIE}`, STARTER);
    expect(out).toBe('Thanks for the details.');
    expect(out).not.toMatch(/here:/);
  });
  test('a bullet holding a markdown link is removed; the list intro and other bullets stay', () => {
    expect(chat('Your options:\n- [Book a call]({{BOOKING_LINK}})\n- Get the summary email', STARTER))
      .toBe('Your options:\n- Get the summary email');
  });
  test('a link on its own line also removes the "…here:" line above it', () => {
    expect(chat('Book a call here:\n\n{{BOOKING_LINK}}\n\nThanks!', STARTER)).toBe('Thanks!');
  });
  test('an <a href> link is removed with its sentence', () => {
    expect(chat(`Line one.\nBook <a href="${CALENDLY}">here</a> anytime. Done.`, STARTER))
      .toBe('Line one.\nDone.');
  });
  test('text without a link is returned unchanged', () => {
    const text = 'No link here. See https://granted.ca/granted-starter/.\n\nThanks!';
    expect(chat(text, STARTER)).toBe(text);
  });
});

describe('other booking hosts', () => {
  test('a Calendly link on Pro is rewritten to the routed link', () => {
    expect(chat(`Pick a time: ${CALENDLY}`, PRO)).toBe(`Pick a time: ${RUK}`);
  });
  test('a cal.com link on Starter is stripped in chat', () => {
    expect(chat('All set. Book at https://cal.com/someone today.', STARTER)).toBe('All set.');
  });
  test('a Calendly paragraph on Starter is stripped in email', () => {
    expect(substituteBookingLink(`<p>Hi.</p><p>Book: <a href="${CALENDLY}">here</a></p><p>Bye.</p>`, STARTER, { mode: 'email' }))
      .toBe('<p>Hi.</p><p>Bye.</p>');
  });
});

describe('unchanged behaviour', () => {
  test('Pro sentinel is substituted with the routed link', () => {
    expect(chat('Book here: {{BOOKING_LINK}}', PRO)).toBe(`Book here: ${RUK}`);
  });
  test('sentinel on Pro with no industry still throws', () => {
    expect(() => chat('{{BOOKING_LINK}}', { best_fit_product: 'Granted Pro' })).toThrow(BookingLinkRoutingError);
  });
  test('sentinel with no product still throws', () => {
    expect(() => chat('{{BOOKING_LINK}}', {})).toThrow(BookingLinkRoutingError);
  });
});

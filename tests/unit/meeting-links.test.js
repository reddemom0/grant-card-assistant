/**
 * Meeting links by user + length (src/services/meeting-links.js), read from
 * data/rates/consultant-routing.json.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/meeting-links.test.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { getMeetingLink, listMeetingLinks } = await import('../../src/services/meeting-links.js');

const routing = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../data/rates/consultant-routing.json'), 'utf8'));

test.each([
  [15, 'https://meetings.hubspot.com/stephsang/15min-granted-fit-check'],
  [20, 'https://meetings.hubspot.com/stephsang/quarterly'],
  [30, 'https://meetings.hubspot.com/ssang1'],
  [40, 'https://meetings.hubspot.com/stephsang/grantchat']
])('Steph %i min → %s', (minutes, url) => {
  expect(getMeetingLink('ssang@granted.ca', minutes)).toBe(url);
});

test('length as a string, email in any case', () => {
  expect(getMeetingLink('SSang@Granted.ca', '15')).toBe('https://meetings.hubspot.com/stephsang/15min-granted-fit-check');
});

test('no rounding: an unlisted length is null', () => {
  expect(getMeetingLink('ssang@granted.ca', 25)).toBeNull();
  expect(getMeetingLink('ssang@granted.ca', 15.5)).toBeNull();
  expect(getMeetingLink('ssang@granted.ca', 'soon')).toBeNull();
});

test('unknown or empty user → null / {}', () => {
  expect(getMeetingLink('nobody@granted.ca', 30)).toBeNull();
  expect(getMeetingLink(undefined, 30)).toBeNull();
  expect(listMeetingLinks('nobody@granted.ca')).toEqual({});
});

test('listMeetingLinks returns all four keyed by number', () => {
  expect(Object.keys(listMeetingLinks('ssang@granted.ca')).map(Number).sort((a, b) => a - b)).toEqual([15, 20, 30, 40]);
});

test('lead-gen routing fields are unchanged', () => {
  expect(routing.consultants.stephanie.booking_link).toBe('https://meetings.hubspot.com/ssang1');
  expect(routing.consultants.rukshaar.booking_link).toBe('https://meetings.hubspot.com/rukshaar-ali');
  expect(routing.default_consultant).toBe('stephanie');
});

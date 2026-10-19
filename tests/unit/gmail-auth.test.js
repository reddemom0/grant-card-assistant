/**
 * Opt-in Gmail consent (src/api/gmail-auth.js): the consent URL asks for
 * exactly the two Gmail scopes and carries earlier grants forward; the
 * allowlist admits only listed users; and Steph's style guide is gated the
 * same way (src/services/style-guides.js).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gmail-auth.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({ query: jest.fn(async () => ({ rows: [] })) }));
jest.unstable_mockModule('../../src/utils/gmail-consent-state.js', () => ({
  issueGmailConsentState: jest.fn(async () => 'a'.repeat(64)),
  consumeGmailConsentState: jest.fn(async () => true)
}));

const A = await import('../../src/api/gmail-auth.js');
const { loadStyleGuide } = await import('../../src/services/style-guides.js');
const { readFileSync } = await import('fs');

describe('buildGmailConsentUrl', () => {
  const url = new URL(A.buildGmailConsentUrl({
    clientId: 'cid', redirectUri: 'https://hub.example/api/auth/gmail/callback', state: 'st', loginHint: 'ssang@granted.ca'
  }));
  const p = url.searchParams;

  test('requests exactly gmail.readonly + gmail.compose', () => {
    expect(p.get('scope').split(' ').sort()).toEqual([
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly'
    ]);
  });
  test('incremental: include_granted_scopes, offline, consent', () => {
    expect(p.get('include_granted_scopes')).toBe('true');
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent');
  });
  test('its own callback, state, account hint, domain hint', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(p.get('redirect_uri')).toBe('https://hub.example/api/auth/gmail/callback');
    expect(p.get('state')).toBe('st');
    expect(p.get('login_hint')).toBe('ssang@granted.ca');
    expect(p.get('hd')).toBe('granted.ca');
  });
});

describe('allowlist', () => {
  test('unset or blank → nobody', () => {
    expect(A.isGmailConsentEligible('ssang@granted.ca', {})).toBe(false);
    expect(A.isGmailConsentEligible('ssang@granted.ca', { GMAIL_CONSENT_ALLOWLIST: ' , ' })).toBe(false);
  });
  test('listed user, any case, with spaces', () => {
    const env = { GMAIL_CONSENT_ALLOWLIST: ' SSang@granted.ca , other@granted.ca' };
    expect(A.isGmailConsentEligible('ssang@granted.ca', env)).toBe(true);
    expect(A.isGmailConsentEligible('Other@Granted.ca', env)).toBe(true);
  });
  test('unlisted user, or a non-string', () => {
    const env = { GMAIL_CONSENT_ALLOWLIST: 'ssang@granted.ca' };
    expect(A.isGmailConsentEligible('chris@granted.ca', env)).toBe(false);
    expect(A.isGmailConsentEligible(undefined, env)).toBe(false);
  });
});

describe('default sign-in is untouched', () => {
  test('src/api/auth.js requests no Gmail scope', () => {
    const src = readFileSync(new URL('../../src/api/auth.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/auth\/gmail/);
  });
});

describe('style guide gating', () => {
  test("Steph's guide loads only for her", () => {
    expect(loadStyleGuide('ssang@granted.ca')).toMatch(/^# Steph's writing voice/);
    expect(loadStyleGuide('SSANG@granted.ca')).toMatch(/Steph's writing voice/);
    expect(loadStyleGuide('chris@granted.ca')).toBeNull();
    expect(loadStyleGuide(undefined)).toBeNull();
  });
  test('it is not reachable through load_skill', () => {
    const loadSkill = readFileSync(new URL('../../src/tools/load-skill.js', import.meta.url), 'utf8');
    const defs = readFileSync(new URL('../../src/tools/definitions.js', import.meta.url), 'utf8');
    expect(loadSkill).not.toMatch(/steph-writing-voice/);
    expect(defs).not.toMatch(/steph-writing-voice/);
  });
  test('the guide carries the never-promise rules', () => {
    const g = loadStyleGuide('ssang@granted.ca');
    expect(g).toMatch(/Prices or fees/);
    expect(g).toMatch(/Approval or funding outcomes/);
    expect(g).toMatch(/Timelines Granted would be held to/);
  });
});

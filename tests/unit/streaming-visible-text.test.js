/**
 * hasVisibleText — would a lead-gen reply show the visitor anything?
 *
 * A final step that is only the <!--suggestions:[...]--> comment rendered as an
 * empty bubble (Nat, 2026-10-30): the widget strips the comment and nothing is
 * left. streamToSSE holds such a step back and runAgent pairs it with the text
 * written alongside the earlier tool call.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/streaming-visible-text.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));

const { hasVisibleText } = await import('../../src/claude/streaming.js');

describe('hasVisibleText', () => {
  test.each([
    ['<!--suggestions:["How do I start?","What qualifies?"]-->'],
    ['\n  <!--suggestions: ["a"] -->\n'],
    ['<p> </p><br>'],
    ['&nbsp;'],
    [''],
    [null]
  ])('nothing visible: %p', (text) => {
    expect(hasVisibleText(text)).toBe(false);
  });

  test.each([
    ['Your estimate is $14K–$28K.<!--suggestions:["a"]-->'],
    ['<strong>$5K</strong>']
  ])('visible: %p', (text) => {
    expect(hasVisibleText(text)).toBe(true);
  });
});

/**
 * Granted Files RAG — ID-number stripping (src/services/rag/redact.js)
 *
 * True positives for each rule, and the numeric-spreadsheet false positives that
 * must survive. Test numbers are synthetic: 046 454 286 is the CRA sample SIN,
 * 4111… and 3782… are the standard test card numbers.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-redact.test.js
 */

import { redact, luhn, addCounts } from '../../src/services/rag/redact.js';

const r = (text) => redact(text);

describe('luhn', () => {
  test('valid and invalid', () => {
    expect(luhn('046454286')).toBe(true);
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('123456789')).toBe(false);
  });
});

describe('SIN', () => {
  test.each([
    ['SIN: 046 454 286', 'SIN: [REDACTED-SIN]'],
    ['S.I.N. 046-454-286', 'S.I.N. [REDACTED-SIN]'],
    ['Social Insurance Number: 046454286', 'Social Insurance Number: [REDACTED-SIN]'],
    ['SIN,046 454 286', 'SIN,[REDACTED-SIN]']
  ])('labelled: %s', (input, expected) => {
    expect(r(input)).toEqual({ text: expected, counts: { sin: 1, card: 0, bank: 0 } });
  });

  test('a labelled SIN is redacted even when it fails Luhn', () => {
    expect(r('SIN# 123-456-789').text).toBe('SIN# [REDACTED-SIN]');
  });

  test.each([
    ['Employee 046454286 started', 'Employee [REDACTED-SIN] started'],
    ['046 454 286', '[REDACTED-SIN]'],
    ['046-454-286', '[REDACTED-SIN]'],
    ['Name,046454286,Manager', 'Name,[REDACTED-SIN],Manager']
  ])('bare, Luhn-valid: %s', (input, expected) => {
    expect(r(input)).toEqual({ text: expected, counts: { sin: 1, card: 0, bank: 0 } });
  });

  test.each([
    'nine digits 123456789 that fail Luhn',
    'BN 046454286 RT0001',
    '046454286RT0001',
    '046454286 RC0001',
    'Business Number: 046454286',
    'CRA Business No. 046454286',
    'mixed separators 046-454 286'
  ])('not a SIN: %s', (input) => {
    expect(r(input)).toEqual({ text: input, counts: { sin: 0, card: 0, bank: 0 } });
  });
});

describe('cards', () => {
  test.each([
    ['4111 1111 1111 1111', '[REDACTED-CARD]'],
    ['4111-1111-1111-1111', '[REDACTED-CARD]'],
    ['Amex 3782 822463 10005', 'Amex [REDACTED-CARD]'],
    ['Card #: 4111-1111-1111-1111', 'Card #: [REDACTED-CARD]'],
    ['Visa ending 4111111111111111', 'Visa ending [REDACTED-CARD]'],
    ['Credit card number 4111 1111 1111 1111', 'Credit card number [REDACTED-CARD]']
  ])('%s', (input, expected) => {
    expect(r(input)).toEqual({ text: expected, counts: { sin: 0, card: 1, bank: 0 } });
  });

  test.each([
    '4111111111111111',                 // ungrouped, unlabelled: a numeric ID in a sheet
    'Order,4111111111111111,2026',
    '4111 1111 1111 1112',              // grouped but fails Luhn
    '4111 1111-1111 1111'               // inconsistent separators
  ])('not a card: %s', (input) => {
    expect(r(input).counts.card).toBe(0);
    expect(r(input).text).toBe(input);
  });
});

describe('bank', () => {
  test('transit, institution and account, labelled', () => {
    expect(r('Transit: 12345 Institution 003 Account # 1234567')).toEqual({
      text: 'Transit: [REDACTED-BANK] Institution [REDACTED-BANK] Account # [REDACTED-BANK]',
      counts: { sin: 0, card: 0, bank: 3 }
    });
  });

  test.each([
    ['Bank account: 00123-4567', 'Bank account: [REDACTED-BANK]'],
    ['Acct. No. 98765432', 'Acct. No. [REDACTED-BANK]'],
    ['Transit,12345', 'Transit,[REDACTED-BANK]'],
    ['Account Number,1234567', 'Account Number,[REDACTED-BANK]']
  ])('%s', (input, expected) => {
    expect(r(input).text).toBe(expected);
    expect(r(input).counts.bank).toBe(1);
  });

  test.each([
    'Account 4000 - Revenue',           // GL code, no label word
    'Account # 4000',                   // 4 digits: GL code
    'Account Number,Amount',            // a header with no value
    'Transit 1234',                     // wrong length
    '12345-003-1234567'                 // unlabelled void-cheque layout stays (labelled only)
  ])('not bank: %s', (input) => {
    expect(r(input)).toEqual({ text: input, counts: { sin: 0, card: 0, bank: 0 } });
  });
});

describe('numeric spreadsheet false positives survive', () => {
  const sheet = [
    'Item,Qty,Unit cost,Total,Ref',
    'Laptop,3,1234.56,3703.68,20260115',
    'Grant total,,,"123,456,789",',
    'Rate,046454286.50,,,',
    'Phone,604-555-1234,(604) 555 1234,+1 604 555 1234,',
    'Postal,V6B 1A1,,,',
    'Big IDs,0464542861,12345678901234,4111111111111111,',
    'Budget,"$1,234,567",$987654321,-123456789,1-123456789',
    'Year,2024,2025,2026,2027'
  ].join('\n');

  test('nothing in a numeric budget sheet is redacted', () => {
    expect(r(sheet)).toEqual({ text: sheet, counts: { sin: 0, card: 0, bank: 0 } });
  });
});

describe('mixed text', () => {
  test('names, roles and amounts stay; counts are exact', () => {
    const input = 'Jane Doe, Payroll Manager, salary $85,000. SIN: 046 454 286. Paid to Transit 12345, Account # 7654321 with Visa 4111 1111 1111 1111.';
    const out = r(input);
    expect(out.counts).toEqual({ sin: 1, card: 1, bank: 2 });
    expect(out.text).toContain('Jane Doe, Payroll Manager, salary $85,000.');
    expect(out.text).not.toMatch(/046|12345|7654321|4111/);
  });

  test('empty input', () => {
    expect(r('')).toEqual({ text: '', counts: { sin: 0, card: 0, bank: 0 } });
    expect(r(null)).toEqual({ text: '', counts: { sin: 0, card: 0, bank: 0 } });
  });

  test('addCounts', () => {
    expect(addCounts({ sin: 1, card: 0, bank: 2 }, { sin: 1, card: 3, bank: 0 })).toEqual({ sin: 2, card: 3, bank: 2 });
  });
});

/**
 * Lead-gen tier rule
 *
 * best_fit_product is recomputed at finalization, where the estimated_funding
 * column is often empty (only save_lead_data writes it). These tests pin the
 * fallback to the intake estimate, the rule that a missing estimate does not
 * block the GrantedPro Fit gate, and the parser that turns agent-written
 * estimate strings into dollars.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-helpers.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));

const { query } = await import('../../src/database/connection.js');
const {
  computeBestFitProduct,
  parseFundingEstimate,
  isTierPendingFirstEstimate,
  lockBestFitProduct,
  describeRecommendedProduct
} = await import('../../src/api/lead-gen-helpers.js');

// Clears the gate on rule (a).
const PRO_SHAPED = { revenue_range: '$5M+', employee_count: '50 – 99', industry: 'Retail' };
// Fails the gate on headcount, so the estimate decides.
const BELOW_GATE = { revenue_range: '$5M+', employee_count: '1 – 4', industry: 'Retail' };

// Shape of a cron-finalized session: column NULL, agentInput null.
const finalized = (prospect_data) => ({ estimated_funding: null, prospect_data });

describe('computeBestFitProduct — estimate column empty, intake estimate present', () => {
  test('the intake estimate is read: below the gate, $18K → Starter', () => {
    const session = finalized({ ...BELOW_GATE, service_tier: 'starter', estimated_funding: '$18K-$30K' });
    expect(computeBestFitProduct(session, null)).toBe('Granted Starter');
  });

  test('Enersolv shape: $5M+ / 100 – 499 / Construction → Pro', () => {
    const session = finalized({
      industry: 'Construction', revenue_range: '$5M+', employee_count: '100 – 499',
      service_tier: 'pro', estimated_funding: '$100K-$188K'
    });
    expect(computeBestFitProduct(session, null)).toBe('Granted Pro');
  });

  test('the column wins over the intake estimate', () => {
    const session = { estimated_funding: '$8K-$12K', prospect_data: { ...BELOW_GATE, estimated_funding: '$40K-$60K' } };
    expect(computeBestFitProduct(session, null)).toBe('Get Granted');
  });

  test('agent input wins over the intake estimate', () => {
    const session = finalized({ ...BELOW_GATE, estimated_funding: '$8K-$12K' });
    expect(computeBestFitProduct(session, { estimated_funding: '$20K-$30K' })).toBe('Granted Starter');
  });
});

describe('computeBestFitProduct — no estimate anywhere', () => {
  test('$5M+ revenue that clears the gate → Pro', () => {
    expect(computeBestFitProduct(finalized({ ...PRO_SHAPED }), null)).toBe('Granted Pro');
  });

  test('$5M+ revenue that fails the gate → Get Granted', () => {
    expect(computeBestFitProduct(finalized({ ...BELOW_GATE }), null)).toBe('Get Granted');
  });

  test('an unreadable estimate behaves like a missing one', () => {
    const session = finalized({ ...PRO_SHAPED, estimated_funding: 'Not applicable yet — pre-revenue' });
    expect(computeBestFitProduct(session, null)).toBe('Granted Pro');
  });
});

describe('computeBestFitProduct — earlier short-circuits still win', () => {
  test('an explicit $0 estimate beats the gate', () => {
    expect(computeBestFitProduct({ ...finalized(PRO_SHAPED), estimated_funding: '$0K-$0K' }, null)).toBe('Get Granted');
  });

  test('an intake estimate of $0 beats the gate', () => {
    expect(computeBestFitProduct(finalized({ ...PRO_SHAPED, estimated_funding: '$0K-$0K' }), null)).toBe('Get Granted');
  });

  test('not_a_fit beats the gate with no estimate', () => {
    expect(computeBestFitProduct(finalized({ ...PRO_SHAPED, service_tier: 'not_a_fit' }), null)).toBe('Get Granted');
  });

  test('Nonprofit beats everything with no estimate', () => {
    expect(computeBestFitProduct(finalized({ ...PRO_SHAPED, industry: 'Charity/Non-Profit' }), null)).toBe('Nonprofit');
  });
});

describe('computeBestFitProduct — estimate size below the gate', () => {
  test('"$1.5M–$3M+" → Starter (read as 1 before, which was Get Granted)', () => {
    expect(computeBestFitProduct({ ...finalized(BELOW_GATE), estimated_funding: '$1.5M–$3M+' }, null)).toBe('Granted Starter');
  });

  test('"$15,000–$30,000" sits exactly on the Starter threshold', () => {
    expect(computeBestFitProduct({ ...finalized(BELOW_GATE), estimated_funding: '$15,000–$30,000' }, null)).toBe('Granted Starter');
  });

  test('"$9,000–$12,000" → Get Granted (read as 9,000 thousand before)', () => {
    expect(computeBestFitProduct({ ...finalized(BELOW_GATE), estimated_funding: '$9,000–$12,000' }, null)).toBe('Get Granted');
  });

  test('"$12-14K" borrows the K → Get Granted', () => {
    expect(computeBestFitProduct({ ...finalized(BELOW_GATE), estimated_funding: '$12-14K over 12 months' }, null)).toBe('Get Granted');
  });
});

describe('parseFundingEstimate — whole dollars, low end of a range', () => {
  test.each([
    ['$1.5M–$3M+', 1_500_000],
    ['$500K', 500_000],
    ['$2M', 2_000_000],
    ['$5MM+', 5_000_000],
    ['$5 million', 5_000_000],
    ['$25K-$60K', 25_000],
    ['$14.4K–$28.1K over 12 months', 14_400],
    ['$20K to $40K', 20_000],
    ['up to $40K pending eligibility', 40_000]
  ])('suffixed: %s → %d', (input, expected) => {
    expect(parseFundingEstimate(input)).toBe(expected);
  });

  test.each([
    ['$17-49K over 12 months', 17_000],
    ['$145–260K over 12 months', 145_000],
    ['$20 to $40K', 20_000]
  ])('unsuffixed low end borrows the upper suffix: %s → %d', (input, expected) => {
    expect(parseFundingEstimate(input)).toBe(expected);
  });

  test.each([
    ['$15,000–$30,000', 15_000],
    ['$21,000 – $39,000', 21_000],
    ['$15,000 over 12 months', 15_000],
    ['$15,000-60K', 15_000]
  ])('no suffix to use means plain dollars: %s → %d', (input, expected) => {
    expect(parseFundingEstimate(input)).toBe(expected);
  });

  test('reads the first dollar amount, not the first digit', () => {
    expect(parseFundingEstimate('12-month estimate: $22K–$53K; Available now: $19K–$50K')).toBe(22_000);
  });

  test('a string with no "$" falls back to its first number', () => {
    expect(parseFundingEstimate('25K-60K')).toBe(25_000);
  });

  test.each([
    ['$0K-$0K', 0],
    ['Currently $0 (pre-revenue gate). Once revenue established ($500K+)', 0]
  ])('zero: %s → %d', (input, expected) => {
    expect(parseFundingEstimate(input)).toBe(expected);
  });

  test.each([
    ['Not applicable yet — pre-revenue'],
    [''],
    [null],
    [undefined]
  ])('no amount: %p → null', (input) => {
    expect(parseFundingEstimate(input)).toBeNull();
  });
});

// ============================================================================
// The locked tier — decided once, then only read
// ============================================================================

describe('isTierPendingFirstEstimate — a $0 baseline does not lock at intake', () => {
  const zero = { service_tier: 'starter', baseline_estimate: { total_low: 0, total_high: 0 } };

  test('$0 baseline, Get Granted only because of the $0 → pending', () => {
    expect(isTierPendingFirstEstimate(zero, 'Get Granted')).toBe(true);
  });
  test('not_a_fit locks at intake even on a $0 baseline', () => {
    expect(isTierPendingFirstEstimate({ ...zero, service_tier: 'not_a_fit' }, 'Get Granted')).toBe(false);
  });
  test('Nonprofit locks at intake even on a $0 baseline', () => {
    expect(isTierPendingFirstEstimate(zero, 'Nonprofit')).toBe(false);
  });
  test('a non-zero baseline locks at intake', () => {
    const c = { service_tier: 'starter', baseline_estimate: { total_low: 9000, total_high: 12000 } };
    expect(isTierPendingFirstEstimate(c, 'Get Granted')).toBe(false);
  });
});

describe('lockBestFitProduct', () => {
  beforeEach(() => query.mockReset());

  test('a stored value wins over a later, different estimate — no recompute, no write', async () => {
    const session = { estimated_funding: '$40K-$80K', prospect_data: { ...BELOW_GATE, best_fit_product: 'Get Granted' } };
    await expect(lockBestFitProduct('s1', session, { estimated_funding: '$40K-$80K' })).resolves.toBe('Get Granted');
    expect(query).not.toHaveBeenCalled();
  });

  test('pending ($0 baseline): locks from the first estimate and persists it', async () => {
    query.mockResolvedValueOnce({ rows: [{ bfp: 'Get Granted' }] });
    const session = { estimated_funding: '$14,063–$28,125', prospect_data: { ...BELOW_GATE, estimated_funding: '$0K-$0K' } };
    // Low end $14,063 is under $15K → Get Granted; the model's range decides, not the $0 baseline.
    const r = await lockBestFitProduct('s2', session, null);
    expect(r).toBe('Get Granted');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/NOT \(COALESCE\(prospect_data, '\{\}'::jsonb\) \? 'best_fit_product'\)/);
    expect(JSON.parse(params[0])).toEqual({ best_fit_product: 'Get Granted' });
  });

  test('pending: a first estimate of $15K+ locks Starter', async () => {
    query.mockResolvedValueOnce({ rows: [{ bfp: 'Granted Starter' }] });
    const session = { estimated_funding: '$18K-$30K', prospect_data: { ...BELOW_GATE, estimated_funding: '$0K-$0K' } };
    await expect(lockBestFitProduct('s3', session, null)).resolves.toBe('Granted Starter');
  });

  test('lost the race: returns the value the other caller locked', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ bfp: 'Granted Starter' }] });
    const session = { estimated_funding: '$5K-$8K', prospect_data: { ...BELOW_GATE } };
    await expect(lockBestFitProduct('s4', session, null)).resolves.toBe('Granted Starter');
  });

  test('DB error: still returns a product (non-blocking)', async () => {
    query.mockRejectedValueOnce(new Error('down'));
    const session = { estimated_funding: '$18K-$30K', prospect_data: { ...BELOW_GATE } };
    await expect(lockBestFitProduct('s5', session, null)).resolves.toBe('Granted Starter');
  });
});

describe('describeRecommendedProduct — the line the model sees', () => {
  test('locked: names the product', () => {
    expect(describeRecommendedProduct({ best_fit_product: 'Granted Starter' }))
      .toMatch(/^Recommended product: Granted Starter \(set by the system/);
  });
  test('pending, below the gate: states the $15,000 low-end rule', () => {
    expect(describeRecommendedProduct({ ...BELOW_GATE })).toMatch(/not set yet.*LOW end.*\$15,000.*Granted Starter.*Get Granted/);
  });
  test('pending, Pro-shaped: any dollar estimate is Pro', () => {
    expect(describeRecommendedProduct({ ...PRO_SHAPED })).toMatch(/not set yet.*Granted Pro/);
  });
});

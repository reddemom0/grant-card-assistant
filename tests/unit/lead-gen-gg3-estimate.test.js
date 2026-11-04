/**
 * Lead-gen gg3 matcher (src/services/lead-gen-gg3-estimate.js): widget → goal
 * mapping, the match-lead request, the stored estimate, the <lead_info> block,
 * the email figure check, and the gg3 intake tier (computeGg3BestFitProduct).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-gg3-estimate.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));

const {
  currentLeadGenMatcher,
  isGg3Session,
  mapWidgetToGoals,
  buildMatchLeadInput,
  formatEstimateRange,
  estimatedFundingFromGg3,
  fetchLeadGenEstimate,
  describeGg3Estimate,
  extractDollarFigures,
  findForeignFigures,
  pinFundingToGg3,
  LEAD_GEN_MATCH_LEAD_TIMEOUT_MS
} = await import('../../src/services/lead-gen-gg3-estimate.js');
const { computeGg3BestFitProduct } = await import('../../src/api/lead-gen-helpers.js');

const OK_EST = {
  status: 'ok', low: 50000, high: 150000,
  per_goal: [
    { goal: 'Hire or Train People', low: 50000, high: 100000, match_count: 3 },
    { goal: 'International Growth', low: 50000, high: 50000, match_count: 1 }
  ],
  matches_used: 7, revenue_band_used: '500k_5m', notes: []
};

describe('matcher switch', () => {
  test('only "gg3" (any case, trimmed) is gg3; unset and anything else is legacy', () => {
    expect(currentLeadGenMatcher({})).toBe('legacy');
    expect(currentLeadGenMatcher({ LEAD_GEN_MATCHER: 'legacy' })).toBe('legacy');
    expect(currentLeadGenMatcher({ LEAD_GEN_MATCHER: ' GG3 ' })).toBe('gg3');
    expect(currentLeadGenMatcher({ LEAD_GEN_MATCHER: 'gg' })).toBe('legacy');
  });
  test('the session flag decides, not the env', () => {
    expect(isGg3Session({ lead_gen_matcher: 'gg3' })).toBe(true);
    expect(isGg3Session({})).toBe(false);
    expect(isGg3Session(null)).toBe(false);
  });
});

describe('mapWidgetToGoals', () => {
  test('a training budget → Hire or Train People; an expansion budget → International Growth', () => {
    expect(mapWidgetToGoals({ training_budget: 'Under $10K', expansion_budget: '$25K – $50K' }))
      .toEqual(['Hire or Train People', 'International Growth']);
  });
  test('"None planned" and blank budgets add nothing', () => {
    expect(mapWidgetToGoals({ training_budget: 'None planned', expansion_budget: '' })).toEqual([]);
    expect(mapWidgetToGoals({})).toEqual([]);
  });
  test('the hiring dropdown is never a goal source', () => {
    expect(mapWidgetToGoals({ hiring_plans: 'Not hiring right now' })).toEqual([]);
    expect(mapWidgetToGoals({ hiring_plans: '3 – 5 people' })).toEqual([]);
  });
  test('free text passes through as-is for gg3 to map', () => {
    expect(mapWidgetToGoals({ planned_activities: '  buy new equipment  ' })).toEqual(['buy new equipment']);
  });
});

describe('buildMatchLeadInput', () => {
  test('splits the widget\'s comma-joined provinces and keeps the buckets as sent', () => {
    expect(buildMatchLeadInput({
      province: 'British Columbia, Alberta', industry: 'Food Processing',
      employee_count: '20 – 49', revenue_range: '$2.5M – $5M', training_budget: '$10K – $25K'
    })).toEqual({
      province: ['British Columbia', 'Alberta'], industry: 'Food Processing',
      business_goals: ['Hire or Train People'], employee_count: '20 – 49', annual_revenue: '$2.5M – $5M',
      training_budget: '$10K – $25K', expansion_budget: null, hiring_plans: null
    });
  });
  test('"Just me" → 1, since gg3 cannot read it', () => {
    expect(buildMatchLeadInput({ province: 'Ontario', industry: 'Retail', employee_count: 'Just me' }).employee_count).toBe(1);
  });
  test('budgets and hiring plans go to gg3 as the raw widget strings, en dashes intact', () => {
    const input = buildMatchLeadInput({
      province: 'Manitoba', industry: 'Food Processing',
      training_budget: 'Under $10K', expansion_budget: '$25K – $50K', hiring_plans: 'Not hiring right now'
    });
    expect(input).toMatchObject({
      training_budget: 'Under $10K', expansion_budget: '$25K – $50K', hiring_plans: 'Not hiring right now'
    });
    expect(input.expansion_budget).toContain('–');
  });
  test('optional profile fields are left out; unset budgets and hiring plans are sent as null', () => {
    expect(buildMatchLeadInput({ province: 'Ontario' })).toEqual({
      province: ['Ontario'], business_goals: [], training_budget: null, expansion_budget: null, hiring_plans: null
    });
  });
});

describe('formatEstimateRange', () => {
  test('full dollars with commas and an en dash', () => {
    expect(formatEstimateRange({ low: 14500, high: 150000 })).toBe('$14,500–$150,000');
  });
  test('equal ends → one figure; a missing end → null', () => {
    expect(formatEstimateRange({ low: 50000, high: 50000 })).toBe('$50,000');
    expect(formatEstimateRange({ low: null, high: 5 })).toBeNull();
  });
  test('estimated_funding only for status ok', () => {
    expect(estimatedFundingFromGg3(OK_EST)).toBe('$50,000–$150,000');
    expect(estimatedFundingFromGg3({ status: 'confirm_needed', low: null, high: null })).toBeNull();
    expect(estimatedFundingFromGg3({ status: 'unavailable' })).toBeNull();
  });
});

describe('fetchLeadGenEstimate', () => {
  const pd = { province: 'Ontario', industry: 'Construction', training_budget: 'Under $10K' };

  test('no_matches is kept as its own status, with no figure', async () => {
    const matchLead = jest.fn(async () => ({
      ok: true, status: 'ok', grants: [], inputs_used: {}, dropped: [],
      estimate: { status: 'no_matches', low: null, high: null, per_goal: [], matches_used: 0, notes: ['nothing to estimate from'] }
    }));
    const r = await fetchLeadGenEstimate(pd, { matchLead, env: {} });
    expect(r).toMatchObject({ status: 'no_matches', low: null, high: null, matches_used: 0, notes: ['nothing to estimate from'] });
    expect(estimatedFundingFromGg3(r)).toBeNull();
  });

  test('an estimate status gg3 might add later still reads as unavailable', async () => {
    const matchLead = jest.fn(async () => ({ ok: true, status: 'ok', grants: [], estimate: { status: 'something_new', low: 1, high: 2 } }));
    const r = await fetchLeadGenEstimate(pd, { matchLead, env: {} });
    expect(r).toMatchObject({ status: 'unavailable', low: null, high: null });
  });

  test('passes the estimate through, with the lead-gen timeout', async () => {
    const matchLead = jest.fn(async () => ({
      ok: true, status: 'ok', estimate: OK_EST,
      grants: [{ name: 'Some Program', provider: 'Gov' }],
      inputs_used: { business_goals: ['Hire or Train People'] }, dropped: []
    }));
    const r = await fetchLeadGenEstimate(pd, { matchLead, env: {} });
    expect(matchLead.mock.calls[0][0]).toEqual(buildMatchLeadInput(pd));
    expect(matchLead.mock.calls[0][1].timeoutMs).toBe(LEAD_GEN_MATCH_LEAD_TIMEOUT_MS);
    expect(r).toMatchObject({ status: 'ok', low: 50000, high: 150000, per_goal: OK_EST.per_goal, matches_used: 7, cards: [{ name: 'Some Program', provider: 'Gov' }] });
  });

  test('confirm_needed keeps no figures', async () => {
    const matchLead = async () => ({ ok: true, status: 'ok', grants: [], estimate: { status: 'confirm_needed', low: null, high: null, per_goal: [] } });
    expect(await fetchLeadGenEstimate(pd, { matchLead })).toMatchObject({ status: 'confirm_needed', low: null, high: null });
  });

  test('service failure / timeout → unavailable with the reason, never throws', async () => {
    expect(await fetchLeadGenEstimate(pd, { matchLead: async () => ({ ok: false, reason: 'the matching service did not answer' }) }))
      .toMatchObject({ status: 'unavailable', reason: 'the matching service did not answer', low: null });
    expect(await fetchLeadGenEstimate(pd, { matchLead: async () => { throw new Error('boom'); } }))
      .toMatchObject({ status: 'unavailable', reason: 'boom' });
  });

  test('an ok answer without an estimate block (old gg3 deploy) → unavailable', async () => {
    const r = await fetchLeadGenEstimate(pd, { matchLead: async () => ({ ok: true, status: 'ok', grants: [], estimate: null }) });
    expect(r.status).toBe('unavailable');
  });

  test('insufficient_profile passes through', async () => {
    const r = await fetchLeadGenEstimate({}, { matchLead: async () => ({ ok: true, status: 'insufficient_profile', missing: ['province', 'industry'], grants: [] }) });
    expect(r).toMatchObject({ status: 'insufficient_profile', missing: ['province', 'industry'] });
  });
});

describe('describeGg3Estimate — what the model sees', () => {
  test('ok: the exact formatted total and per-goal ranges', () => {
    const text = describeGg3Estimate(OK_EST);
    expect(text).toContain('Total, next 12 months: $50,000–$150,000');
    expect(text).toContain('- Hire or Train People: $50,000–$100,000');
    expect(text).toContain('- International Growth: $50,000');
    expect(text).toMatch(/never calculate/);
    expect(text).toMatch(/Never name programs/);
  });
  test('no_matches, Granted Pro: no strong fit, a consultant will review', () => {
    const text = describeGg3Estimate({ status: 'no_matches' }, { bestFitProduct: 'Granted Pro' });
    expect(text).toMatch(/couldn't find a strong fit from what they've shared/);
    expect(text).toMatch(/say a consultant will review their profile/);
    expect(text).not.toMatch(/There are programs that match/);
    expect(extractDollarFigures(text)).toEqual([]);
  });
  test.each(['Get Granted', 'Granted Starter', 'Nonprofit', 'Not a Fit', undefined])(
    'no_matches, %s: no strong fit yet, and no review promise', (bestFitProduct) => {
      const text = describeGg3Estimate({ status: 'no_matches' }, { bestFitProduct });
      expect(text).toMatch(/couldn't find a strong fit from what they've shared yet/);
      expect(text).not.toMatch(/say a consultant will review/);
      expect(text).toMatch(/Do not promise that anyone will review their profile/);
      expect(text).not.toMatch(/There are programs that match/);
      expect(extractDollarFigures(text)).toEqual([]);
    });
  test('confirm_needed: matching programs exist, no figure', () => {
    const text = describeGg3Estimate({ status: 'confirm_needed' });
    expect(text).toMatch(/programs that match their profile/);
    expect(extractDollarFigures(text)).toEqual([]);
  });
  test('unavailable: no figure and no claim of matches', () => {
    const text = describeGg3Estimate({ status: 'unavailable' });
    expect(text).toMatch(/don't claim specific matches/);
    expect(extractDollarFigures(text)).toEqual([]);
  });
});

describe('email figure check', () => {
  const pd = { revenue_range: '$500K – $2.5M', training_budget: '$10K – $25K' };

  test('reads K/M suffixes and borrowed suffixes as whole dollars', () => {
    expect(extractDollarFigures('about $50K–$150K, or $1.2M, or $17–49K, or $150,000 to $200,000'))
      .toEqual([150000, 50000, 1200000, 49000, 17000, 200000, 150000]);
  });
  test('the stored figures in any spelling pass', () => {
    expect(findForeignFigures('<p>An estimated <strong>$50K–$150K</strong>; hiring $50,000–$100,000.</p>', OK_EST, pd)).toEqual([]);
  });
  test('the form\'s own bucket figures pass', () => {
    expect(findForeignFigures('With revenue of $500K – $2.5M and a $10K – $25K training budget…', OK_EST, pd)).toEqual([]);
  });
  test('a figure the model worked out is caught', () => {
    expect(findForeignFigures('You could see $60K–$150K.', OK_EST, pd)).toEqual([60000]);
  });
  test('confirm_needed: any estimate-like figure is foreign', () => {
    expect(findForeignFigures('roughly $20K', { status: 'confirm_needed' }, pd)).toEqual([20000]);
  });
});

describe('pinFundingToGg3', () => {
  test('replaces model-written funding fields with the stored estimate', () => {
    const t = { estimated_funding: '$20-34K', available_now_funding: '$10K', programs_matched_count: '4' };
    const changed = pinFundingToGg3(t, OK_EST);
    expect(t).toEqual({ estimated_funding: '$50,000–$150,000', available_now_funding: null, programs_matched_count: null });
    expect(changed.map((c) => c.field)).toEqual(['estimated_funding', 'available_now_funding', 'programs_matched_count']);
  });
  test('no figure stored → estimated_funding is cleared', () => {
    const t = { estimated_funding: '$20-34K' };
    pinFundingToGg3(t, { status: 'confirm_needed' });
    expect(t.estimated_funding).toBeNull();
  });
});

describe('computeGg3BestFitProduct — the gg3 intake tier', () => {
  const NOT_PRO = { revenue_range: '$500K – $2.5M', employee_count: '1 – 4', industry: 'Retail' };
  const PRO = { revenue_range: '$2.5M – $5M', employee_count: '20 – 49', industry: 'Retail' };

  test('status ok: the threshold reads estimate.low exactly', () => {
    expect(computeGg3BestFitProduct(NOT_PRO, formatEstimateRange({ low: 15000, high: 90000 }))).toBe('Granted Starter');
    expect(computeGg3BestFitProduct(NOT_PRO, formatEstimateRange({ low: 14999, high: 90000 }))).toBe('Get Granted');
    expect(computeGg3BestFitProduct(PRO, formatEstimateRange({ low: 5000, high: 9000 }))).toBe('Granted Pro');
  });
  test('no figure (confirm_needed / unavailable / timeout) → size rule alone', () => {
    expect(computeGg3BestFitProduct(PRO, null)).toBe('Granted Pro');
    expect(computeGg3BestFitProduct(NOT_PRO, null)).toBe('Get Granted');
  });
  test('a stale intake estimate on prospect_data is ignored', () => {
    expect(computeGg3BestFitProduct({ ...NOT_PRO, estimated_funding: '$40K-$90K' }, null)).toBe('Get Granted');
  });
  test('Nonprofit and not_a_fit still win', () => {
    expect(computeGg3BestFitProduct({ ...PRO, industry: 'Charity/Non-Profit' }, '$50,000–$150,000')).toBe('Nonprofit');
    expect(computeGg3BestFitProduct({ ...PRO, service_tier: 'not_a_fit' }, '$50,000–$150,000')).toBe('Get Granted');
  });
});

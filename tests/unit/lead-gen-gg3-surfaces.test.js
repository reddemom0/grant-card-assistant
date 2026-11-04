/**
 * Lead-gen gg3 matcher across the surfaces: intake (estimate stored, tier
 * locked), <lead_info>, the tool loadout, and the summary email body. Each
 * one also checks that a legacy session is unchanged.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-gg3-surfaces.test.js
 */

import { jest } from '@jest/globals';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));
jest.unstable_mockModule('../../src/services/grant-categorization.js', () => ({
  categorizeProspect: jest.fn(),
  assignConsultant: jest.fn(() => null),
  resolveIndustry: jest.fn()
}));
jest.unstable_mockModule('../../src/services/match-lead-client.js', () => ({
  matchLead: jest.fn(),
  MATCH_LEAD_TIMEOUT_MS: 15000,
  defaultMatchLeadDeps: {}
}));

const { query } = await import('../../src/database/connection.js');
const { categorizeProspect, assignConsultant } = await import('../../src/services/grant-categorization.js');
const { matchLead } = await import('../../src/services/match-lead-client.js');
const { runIntakeCategorization } = await import('../../src/api/lead-gen-init.js');
const { getLeadGenFormContext } = await import('../../src/utils/lead-gen-context.js');
const { composeLeadGenEmailBody, buildNoteBodyComprehensive } = await import('../../src/api/lead-gen-finalization.js');
const { getToolsForAgent } = await import('../../src/tools/definitions.js');

const OK_EST = {
  status: 'ok', low: 50000, high: 150000,
  per_goal: [{ goal: 'Hire or Train People', low: 50000, high: 150000, match_count: 3 }],
  matches_used: 6, revenue_band_used: '500k_5m', notes: []
};
const CATEGORIZATION = {
  service_tier: 'starter', tier_reasoning: 'r', consultant_assignment: null, booking_link: null,
  baseline_estimate: { total_low: 20000, total_high: 40000 }
};
const FORM = {
  contact_name: 'Pat Lee', email: 'pat@acme.ca', company_name: 'Acme', province: 'Ontario',
  industry: 'Retail', revenue_range: '$500K – $2.5M', employee_count: '1 – 4', training_budget: 'Under $10K'
};

/** The JSON merged into prospect_data by the intake's final UPDATE. */
function intakePatch() {
  const call = query.mock.calls.find(([sql]) => /UPDATE lead_gen_conversations/.test(sql));
  return call ? JSON.parse(call[1][0]) : null;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  categorizeProspect.mockReset();
  matchLead.mockReset();
});

describe('intake', () => {
  test('gg3: stores the estimate and locks the tier on estimate.low', async () => {
    categorizeProspect.mockResolvedValue(CATEGORIZATION);
    matchLead.mockResolvedValue({ ok: true, status: 'ok', estimate: OK_EST, grants: [], inputs_used: {}, dropped: [] });
    await runIntakeCategorization('s1', { ...FORM, lead_gen_matcher: 'gg3' });
    const patch = intakePatch();
    expect(patch).toMatchObject({ best_fit_product: 'Granted Starter', estimated_funding: '$50,000–$150,000', service_tier: 'starter' });
    expect(patch.gg3_estimate).toMatchObject({ status: 'ok', low: 50000, high: 150000 });
    // The rate-table baseline is never the estimate in gg3 mode.
    expect(JSON.stringify(patch)).not.toMatch(/\$20K|\$40K/);
  });

  test('gg3: match-lead fails → size rule, no figure, still locked', async () => {
    categorizeProspect.mockResolvedValue(CATEGORIZATION);
    matchLead.mockResolvedValue({ ok: false, reason: 'the matching service did not answer' });
    await runIntakeCategorization('s2', { ...FORM, lead_gen_matcher: 'gg3' });
    const patch = intakePatch();
    expect(patch.best_fit_product).toBe('Get Granted');
    expect(patch.estimated_funding).toBeUndefined();
    expect(patch.gg3_estimate.status).toBe('unavailable');
  });

  test('gg3: confirm_needed on a Pro-shaped lead → Granted Pro by size', async () => {
    categorizeProspect.mockResolvedValue(CATEGORIZATION);
    matchLead.mockResolvedValue({ ok: true, status: 'ok', estimate: { status: 'confirm_needed', low: null, high: null, per_goal: [] }, grants: [] });
    await runIntakeCategorization('s3', { ...FORM, lead_gen_matcher: 'gg3', revenue_range: '$2.5M – $5M', employee_count: '20 – 49' });
    expect(intakePatch().best_fit_product).toBe('Granted Pro');
  });

  test('gg3: categorization throws → the tier still locks', async () => {
    categorizeProspect.mockRejectedValue(new Error('no rate table'));
    matchLead.mockResolvedValue({ ok: true, status: 'ok', estimate: OK_EST, grants: [] });
    await runIntakeCategorization('s4', { ...FORM, lead_gen_matcher: 'gg3' });
    expect(intakePatch()).toMatchObject({ best_fit_product: 'Granted Starter', estimated_funding: '$50,000–$150,000' });
  });

  describe('gg3: no_matches', () => {
    const NO_MATCHES = { status: 'no_matches', low: null, high: null, per_goal: [], matches_used: 0, notes: ['no high or medium match with region tags; nothing to estimate from'] };
    const run = async (id, form) => {
      categorizeProspect.mockResolvedValue(CATEGORIZATION);
      matchLead.mockResolvedValue({ ok: true, status: 'ok', estimate: NO_MATCHES, grants: [], inputs_used: {}, dropped: [] });
      await runIntakeCategorization(id, { ...FORM, lead_gen_matcher: 'gg3', ...form });
      return intakePatch();
    };

    test('stored as no_matches with no figure, size rule → Get Granted, no FAIL log', async () => {
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const patch = await run('s6', {});
      const failLogged = err.mock.calls.some((c) => String(c[0]).includes('[LEAD-GEN-GG3-ESTIMATE-FAIL]'));
      err.mockRestore();
      expect(patch.gg3_estimate).toMatchObject({ status: 'no_matches', low: null, high: null, matches_used: 0 });
      expect(patch.estimated_funding).toBeUndefined();
      expect(patch.best_fit_product).toBe('Get Granted');
      expect(failLogged).toBe(false);
    });
    test('a Pro-shaped lead → Granted Pro by size', async () => {
      expect((await run('s7', { revenue_range: '$2.5M – $5M', employee_count: '20 – 49' })).best_fit_product).toBe('Granted Pro');
    });
    test('a non-profit stays Nonprofit', async () => {
      expect((await run('s8', { industry: 'Charity/Non-Profit' })).best_fit_product).toBe('Nonprofit');
    });
  });

  test('legacy: no match-lead call, the rate-table estimate as before', async () => {
    categorizeProspect.mockResolvedValue(CATEGORIZATION);
    await runIntakeCategorization('s5', { ...FORM });
    expect(matchLead).not.toHaveBeenCalled();
    expect(intakePatch()).toEqual({ service_tier: 'starter', best_fit_product: 'Granted Starter', estimated_funding: '$20K-$40K' });
  });
});

describe('<lead_info>', () => {
  const row = (pd) => ({ rows: [{ contact_name: 'Pat Lee', contact_email: 'pat@acme.ca', company_name: 'Acme', company_website: null, company_background: null, prospect_data: pd }] });

  test('gg3: the stored figures, exactly', async () => {
    query.mockResolvedValueOnce(row({ ...FORM, lead_gen_matcher: 'gg3', best_fit_product: 'Granted Starter', gg3_estimate: OK_EST }));
    const ctx = await getLeadGenFormContext('s1');
    expect(ctx).toContain('Total, next 12 months: $50,000–$150,000');
    expect(ctx).toContain('- Hire or Train People: $50,000–$150,000');
    expect(ctx).toContain('there is no program search to run');
    expect(ctx).not.toContain('search_getgranted');
  });

  test.each([
    ['Granted Pro', true],
    ['Get Granted', false],
    ['Granted Starter', false],
    ['Nonprofit', false],
    ['Not a Fit', false]
  ])('gg3 no_matches, %s: honest wording, review promised only to Pro', async (tier, promised) => {
    query.mockResolvedValueOnce(row({ ...FORM, lead_gen_matcher: 'gg3', best_fit_product: tier,
      gg3_estimate: { status: 'no_matches', low: null, high: null, per_goal: [], matches_used: 0 } }));
    const ctx = await getLeadGenFormContext('s1');
    expect(ctx).toContain("We couldn't find a strong fit from what they've shared");
    if (promised) expect(ctx).toContain('say a consultant will review their profile');
    else {
      expect(ctx).not.toContain('say a consultant will review');
      expect(ctx).toContain('Do not promise that anyone will review their profile');
    }
    expect(ctx).not.toContain('There are programs that match');
    expect(ctx).not.toMatch(/Total, next 12 months/);
  });

  test('legacy: no estimate block', async () => {
    query.mockResolvedValueOnce(row({ ...FORM, best_fit_product: 'Granted Starter' }));
    const ctx = await getLeadGenFormContext('s1');
    expect(ctx).not.toMatch(/Funding estimate/);
    expect(ctx).toContain('Recommended product: Granted Starter');
  });
});

describe('tool loadout', () => {
  const names = () => getToolsForAgent('lead-gen').map((t) => t.name);
  afterEach(() => { delete process.env.LEAD_GEN_MATCHER; });

  test('the session matcher, when given, decides over the env', () => {
    process.env.LEAD_GEN_MATCHER = 'gg3';
    expect(getToolsForAgent('lead-gen', { leadGenMatcher: 'legacy' }).map((t) => t.name)).toContain('search_getgranted');
    delete process.env.LEAD_GEN_MATCHER;
    expect(getToolsForAgent('lead-gen', { leadGenMatcher: 'gg3' }).map((t) => t.name)).not.toContain('search_getgranted');
  });

  test('gg3 drops search_getgranted and nothing else', () => {
    const legacy = names();
    process.env.LEAD_GEN_MATCHER = 'gg3';
    const gg3 = names();
    expect(legacy).toContain('search_getgranted');
    expect(gg3).not.toContain('search_getgranted');
    expect(gg3).toEqual(legacy.filter((n) => n !== 'search_getgranted'));
  });
});

describe('summary email body', () => {
  const session = { session_id: 's1', estimated_funding: null };
  const base = { ...FORM, best_fit_product: 'Granted Starter', service_tier: 'starter' };

  test('gg3: a body with only the stored figures is kept', async () => {
    const pd = { ...base, lead_gen_matcher: 'gg3', gg3_estimate: OK_EST, email_summary_body: '<p>About <strong>$50K–$150K</strong>.</p>' };
    const r = await composeLeadGenEmailBody('s1', session, pd, 'Pat');
    expect(r).toEqual({ html: '<p>About <strong>$50K–$150K</strong>.</p>', kind: 'agent' });
  });

  test('gg3: a body with a figure of its own → the template, from the stored estimate', async () => {
    query.mockResolvedValue({ rows: [{ session_id: 's1', prospect_data: {} }] });
    const pd = { ...base, lead_gen_matcher: 'gg3', gg3_estimate: OK_EST, email_summary_body: '<p>About $60K–$150K.</p>' };
    const r = await composeLeadGenEmailBody('s1', session, pd, 'Pat');
    expect(r.kind).toBe('gg3_template');
    expect(r.html).toContain('<strong>$50,000–$150,000</strong>');
    expect(r.html).toContain('<strong>Hire or Train People:</strong> $50,000–$150,000');
    expect(r.html).not.toContain('$60K');
  });

  test('gg3: no body and confirm_needed → template with no figure', async () => {
    query.mockResolvedValue({ rows: [{ session_id: 's1', prospect_data: {} }] });
    const pd = { ...base, lead_gen_matcher: 'gg3', gg3_estimate: { status: 'confirm_needed', low: null, high: null, per_goal: [] } };
    const r = await composeLeadGenEmailBody('s1', session, pd, 'Pat');
    expect(r.kind).toBe('fallback');
    expect(r.html).toMatch(/programs that match your profile/);
    expect(r.html).not.toMatch(/\$\d/);
  });

  test.each([
    ['Granted Pro', "Based on what you've shared, we couldn't find a strong fit yet. A consultant will review your profile."],
    ['Get Granted', "We couldn't find a strong fit from what you've shared yet."],
    ['Granted Starter', "We couldn't find a strong fit from what you've shared yet."],
    // Nonprofit and Not a Fit get the not-yet-ready email, which never has an
    // estimate paragraph: no sentence, and no review promise either.
    ['Nonprofit', null],
    ['Not a Fit', null]
  ])('gg3: no body and no_matches, %s → template, no figure, review promised only to Pro', async (tier, sentence) => {
    query.mockResolvedValue({ rows: [{ session_id: 's1', prospect_data: {} }] });
    // Pro routes a consultant link; the module mock returns none by default.
    if (tier === 'Granted Pro') assignConsultant.mockReturnValueOnce({ name: 'A Consultant', booking_link: 'https://meetings.hubspot.com/test-consultant' });
    const pd = { ...base, best_fit_product: tier, lead_gen_matcher: 'gg3', gg3_estimate: { status: 'no_matches', low: null, high: null, per_goal: [] } };
    const r = await composeLeadGenEmailBody('s1', session, pd, 'Pat');
    expect(r.kind).toBe('fallback');
    if (sentence) expect(r.html).toContain(sentence);
    else expect(r.html).not.toMatch(/strong fit/);
    if (tier !== 'Granted Pro') expect(r.html).not.toMatch(/consultant will review/);
    expect(r.html).not.toMatch(/programs that match your profile/);
    expect(r.html).not.toMatch(/\$\d/);
  });

  test('legacy: the agent body is kept whatever its figures', async () => {
    const pd = { ...base, email_summary_body: '<p>About $60K–$150K.</p>' };
    const r = await composeLeadGenEmailBody('s1', session, pd, 'Pat');
    expect(r).toEqual({ html: '<p>About $60K–$150K.</p>', kind: 'agent' });
  });
});

describe('HubSpot note', () => {
  const note = (gg3_estimate) => buildNoteBodyComprehensive({
    prospect_data: { ...FORM, lead_gen_matcher: 'gg3', best_fit_product: 'Get Granted', gg3_estimate },
    message_count: 4
  }, 'contact_captured');

  test('no_matches: says gg3 found nothing to estimate from, not "no estimate block"', () => {
    const body = note({ status: 'no_matches', low: null, high: null, per_goal: [], matches_used: 0, notes: [] });
    expect(body).toContain('No figure given — gg3 found nothing to estimate from (no_matches).');
    expect(body).not.toContain('no estimate block');
  });
  test('confirm_needed and unavailable lines unchanged', () => {
    expect(note({ status: 'confirm_needed', low: null, high: null, per_goal: [] })).toContain('No figure given — matching programs exist, amounts to be confirmed.');
    expect(note({ status: 'unavailable', reason: 'the matching service did not answer' })).toContain('No figure given — estimate unavailable (the matching service did not answer).');
  });
});

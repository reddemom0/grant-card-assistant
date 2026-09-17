/**
 * Lead triage — reading a lead out of a message, and the funnel rules
 *
 * Pure functions: no database, no Chat, no model. The funnel cases are the ones
 * from the brief, so a change to the tiers has to change this file too.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/lead-parse.test.js
 */

import {
  leadIntent, extractLead, phoneDigits, typedLeadCommand, OUTCOMES, outcomeFromText,
  hardStop, revenueAmount, estimateAmount, funnelTier, TIER_WORDS
} from '../../src/cards/lead-parse.js';

describe('leadIntent', () => {
  test('contact details and a lead cue make a lead', () => {
    expect(leadIntent('Sarah called in — 604-555-1212, wants training grants')).toBe('lead');
    expect(leadIntent('New lead from the site: sam@acmefoods.ca')).toBe('lead');
    expect(leadIntent('Voicemail from Bob Lee, bob@lee.ca')).toBe('lead');
  });

  test('details or a cue on their own are only a maybe', () => {
    expect(leadIntent('Forward this to sam@acmefoods.ca')).toBe('maybe');
    expect(leadIntent('Someone reached out about hiring grants')).toBe('maybe');
  });

  test('a question stays a question, and ordinary chat is nothing', () => {
    expect(leadIntent('Can you check sam@acmefoods.ca in HubSpot?')).toBeNull();
    expect(leadIntent('Who is covering the RTRI deadline?')).toBeNull();
    expect(leadIntent('')).toBeNull();
    expect(leadIntent(null)).toBeNull();
  });

  test('being asked outright is a lead, details or not — they may be in the message before', () => {
    expect(leadIntent('triage this lead')).toBe('lead');
    expect(leadIntent('triage this')).toBe('lead');
    expect(leadIntent('can you look at this lead')).toBe('lead');
    // Still not a question about a lead we already have.
    expect(leadIntent('what did we decide about that lead?')).toBeNull();
  });

  test('a question with details and a cue is still a lead', () => {
    // "called in" plus a number is a lead even when the sentence ends in "?".
    expect(leadIntent('Sarah called in on 604-555-1212 — can someone call her back?')).toBe('lead');
  });
});

describe('extractLead', () => {
  test('labelled fields win, in any order, after a colon', () => {
    const lead = extractLead('form: name: Bob Lee; company: Lee Metalworks; email: bob@leemetal.ca; phone: (604) 555-9000');
    expect(lead).toEqual({
      name: 'Bob Lee',
      company: 'Lee Metalworks',
      email: 'bob@leemetal.ca',
      phone: '(604) 555-9000'
    });
  });

  test('falls back to the patterns, a name beside a cue and a company after "at"', () => {
    const lead = extractLead('Sarah Chen called from Acme Foods Inc. Reach her at 778.555.0101 or sarah@acmefoods.ca');
    expect(lead.name).toBe('Sarah Chen');
    expect(lead.email).toBe('sarah@acmefoods.ca');
    expect(lead.phone).toBe('778.555.0101');
    expect(lead.company).toBe('Acme Foods Inc');
  });

  test('nothing there is null, not an empty string', () => {
    expect(extractLead('someone rang')).toEqual({ name: null, email: null, phone: null, company: null });
  });
});

describe('phoneDigits', () => {
  test('keeps the last ten digits of any shape', () => {
    expect(phoneDigits('+1 (604) 555-1212')).toBe('6045551212');
    expect(phoneDigits('604.555.1212')).toBe('6045551212');
  });

  test('too few digits is null', () => {
    expect(phoneDigits('555-1212')).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });
});

describe('typedLeadCommand', () => {
  test('the four typed stand-ins', () => {
    // "assign" carries no text: the person comes from the message's @mention.
    expect(typedLeadCommand('assign @Nat Sentinel')).toEqual({ kind: 'assign' });
    expect(typedLeadCommand('called: no answer, left a voicemail')).toEqual({ kind: 'called', text: 'no answer, left a voicemail' });
    expect(typedLeadCommand('outcome: booked discovery')).toEqual({ kind: 'outcome', text: 'booked discovery' });
    expect(typedLeadCommand('I’ll call back')).toEqual({ kind: 'callback' });
  });

  test('"called:" with nothing after it is not a command', () => {
    expect(typedLeadCommand('called:')).toBeNull();
    expect(typedLeadCommand('outcome:   ')).toBeNull();
  });

  test('ordinary messages are not commands', () => {
    expect(typedLeadCommand('who called them?')).toBeNull();
    expect(typedLeadCommand('')).toBeNull();
  });
});

describe('outcomeFromText', () => {
  test('each outcome from the words someone would type', () => {
    expect(outcomeFromText('booked discovery for Tuesday')).toBe(OUTCOMES.booked);
    expect(outcomeFromText('sent them the calculator')).toBe(OUTCOMES.calculator);
    expect(outcomeFromText('not a fit — sole prop')).toBe(OUTCOMES.not_a_fit);
    expect(outcomeFromText('no answer, left a vm')).toBe(OUTCOMES.no_answer);
  });

  test('unrecognised wording is null', () => {
    expect(outcomeFromText('will try again tomorrow')).toBeNull();
  });
});

describe('hardStop', () => {
  test('the four stops from the brief', () => {
    expect(hardStop('he is a sole proprietor')).toMatchObject({ key: 'sole_proprietor', reason: 'sole proprietor' });
    expect(hardStop('they are pre-revenue right now')).toMatchObject({ key: 'pre_revenue' });
    expect(hardStop('it is a non-profit society')).toMatchObject({ key: 'non_profit' });
    expect(hardStop('they just incorporated')).toMatchObject({ key: 'too_new' });
  });

  test('"startup" alone is not a stop — plenty of clients call themselves that', () => {
    expect(hardStop('a startup in Vancouver doing hardware')).toBeNull();
    expect(hardStop('')).toBeNull();
  });
});

describe('revenueAmount and estimateAmount', () => {
  test('HubSpot bands are read by their lower bound', () => {
    expect(revenueAmount('Pre-revenue')).toBe(0);
    // The zero in "$0 to $500K" is ignored on purpose: a company in that band
    // is not pre-revenue, and a 0 here would disqualify it.
    expect(revenueAmount('$0 to $500K')).toBe(500_000);
    expect(revenueAmount('$500K to $2.5 million')).toBe(500_000);
    expect(revenueAmount('$2.5 million to $5 million')).toBe(2_500_000);
    expect(revenueAmount('$5 million to $10 million')).toBe(5_000_000);
  });

  test('numbers and plain amounts', () => {
    expect(revenueAmount(3_200_000)).toBe(3_200_000);
    expect(revenueAmount('$1,800,000')).toBe(1_800_000);
    expect(revenueAmount(null)).toBeNull();
  });

  test('estimates', () => {
    expect(estimateAmount('$18,000')).toBe(18_000);
    expect(estimateAmount('18k')).toBe(18_000);
    expect(estimateAmount(42_000)).toBe(42_000);
    expect(estimateAmount('')).toBeNull();
    expect(estimateAmount(null)).toBeNull();
    expect(estimateAmount('unknown')).toBeNull();
  });
});

describe('funnelTier', () => {
  test('$5M+ revenue is Pro, estimate or not', () => {
    expect(funnelTier({ revenue: '$5 million to $10 million' })).toMatchObject({ tier: 'pro' });
    expect(funnelTier({ revenue: 7_000_000, estimate: 1_000 })).toMatchObject({ tier: 'pro' });
  });

  test('$2.5M–$5M splits on the estimate', () => {
    expect(funnelTier({ revenue: '$2.5 million to $5 million', estimate: 30_000 })).toMatchObject({ tier: 'pro' });
    expect(funnelTier({ revenue: '$2.5 million to $5 million', estimate: 20_000 })).toMatchObject({ tier: 'starter' });
    expect(funnelTier({ revenue: '$2.5 million to $5 million', estimate: 9_000 })).toMatchObject({ tier: 'getgranted' });
  });

  test('below $2.5M splits at $15K', () => {
    expect(funnelTier({ revenue: '$500K to $2.5 million', estimate: 15_000 })).toMatchObject({ tier: 'starter' });
    expect(funnelTier({ revenue: '$500K to $2.5 million', estimate: 14_999 })).toMatchObject({ tier: 'getgranted' });
    expect(funnelTier({ revenue: '$0 to $500K', estimate: 40_000 })).toMatchObject({ tier: 'starter' });
  });

  test('the disqualifiers come first', () => {
    expect(funnelTier({ revenue: 9_000_000, nonProfit: true })).toMatchObject({ tier: 'not_a_fit', reason: 'non-profit' });
    expect(funnelTier({ revenue: 9_000_000, incorporatedOverAYear: false })).toMatchObject({ tier: 'not_a_fit' });
    expect(funnelTier({ revenue: 9_000_000, employees: 1 })).toMatchObject({ tier: 'not_a_fit', reason: 'under two employees' });
    expect(funnelTier({ revenue: 'Pre-revenue' })).toMatchObject({ tier: 'not_a_fit', reason: 'pre-revenue' });
  });

  test('missing facts are "unknown", never a guessed tier', () => {
    expect(funnelTier({})).toMatchObject({ tier: 'unknown', reason: 'no revenue on file' });
    expect(funnelTier({ revenue: '$500K to $2.5 million' })).toMatchObject({ tier: 'unknown', reason: 'no estimate on file' });
  });

  test('every tier has a word for the card', () => {
    for (const tier of ['pro', 'starter', 'getgranted', 'not_a_fit', 'unknown']) {
      expect(typeof TIER_WORDS[tier]).toBe('string');
    }
  });
});

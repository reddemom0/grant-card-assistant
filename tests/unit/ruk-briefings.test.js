/**
 * Ruk's pre-call briefings: which meetings, the once-per-meeting claim, the
 * match → fallback path, the briefing call, delivery (no DM when the Doc
 * fails), and the off-by-default schedule.
 *
 * The HubSpot, lead-gen, website, grant-search and Drive modules are mocked;
 * everything else is injected fakes.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/ruk-briefings.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/tools/hubspot.js', () => ({
  leadCrmSnapshot: jest.fn(), getHubSpotNotes: jest.fn(), getDealsForCompany: jest.fn(), getDealStageLabels: jest.fn(),
  getLoggedCalls: jest.fn(), getLoggedEmails: jest.fn(), listHubSpotOwners: jest.fn()
}));
jest.unstable_mockModule('../../src/database/lead-gen-reads.js', () => ({ latestLeadGenSession: jest.fn() }));
jest.unstable_mockModule('../../src/api/lead-gen-init.js', () => ({ extractCompanyBackgroundFromWebsite: jest.fn() }));
jest.unstable_mockModule('../../src/tools/grant-data.js', () => ({ searchGrantData: jest.fn() }));
jest.unstable_mockModule('../../src/tools/google-drive.js', () => ({
  delegatedDriveClient: jest.fn(), resolveGrantedFilesPath: jest.fn(), FOLDER_MIME: 'application/vnd.google-apps.folder'
}));

const R = await import('../../src/services/ruk-briefings.js');
const G = await import('../../src/services/briefing-gather.js');
const D = await import('../../src/services/briefing-drive.js');

const STAGES = {
  s_open: { label: 'Application submitted', pipeline: 'Grants', closed: false, won: false },
  s_won: { label: 'Approved', pipeline: 'Grants', closed: true, won: true },
  s_lost: { label: 'Not approved', pipeline: 'Grants', closed: true, won: false }
};

function crm({ deals = [], company = true } = {}) {
  return {
    success: true,
    contact: { id: 'c1', name: 'Pat Elm', email: 'pat@elmwood.ca', company: 'Elmwood Groups', website: 'elmwood.ca',
      ownerId: 'o1', calculator: { revenue: '$500K to $2.5 million', employees: 20, industry: 'MANUFACTURING_FOOD_BEVERAGE',
        spendOn: 'hiring two welders and marketing in Alberta', trainingBudget: 10000, expansionBudget: null } },
    company: company ? { id: 'co1', name: 'Elmwood Groups', domain: 'elmwood.ca', industry: 'MACHINERY', employees: 20,
      revenue: null, city: 'Abbotsford', province: 'BC', ownerId: 'o1' } : null,
    deals,
    failed: []
  };
}

function deps(over = {}) {
  const rows = new Map();
  return {
    _rows: rows,
    listEvents: jest.fn(async () => ({ success: true, events: [] })),
    crmSnapshot: jest.fn(async () => ({ contact: null, company: null, deals: [] })),
    notes: jest.fn(async () => ({ success: true, notes: [{ body: '<p>Wants to <b>hire</b></p>', timestamp: '2026-09-01T00:00:00Z' }] })),
    dealsForCompany: jest.fn(async () => ({ success: true, deals: [] })),
    stageLabels: jest.fn(async () => ({ success: true, stages: STAGES })),
    calls: jest.fn(async () => ({ success: true, calls: [] })),
    emails: jest.fn(async () => ({ success: true, emails: [] })),
    owners: jest.fn(async () => ({ success: true, owners: [{ id: 'o1', fullName: 'Steph Lee' }, { id: 'o2', fullName: 'Delpreet K' }] })),
    leadGenSession: jest.fn(async () => ({ at: '2026-10-10T00:00:00Z', tier: 'pro', estimate: '$40K', programs: ['CanExport'], prospect: { province: 'BC' } })),
    website: jest.fn(async () => ({ description: 'Steel fabrication shop', industry: 'Manufacturing', location: 'Abbotsford, BC' })),
    grantSearch: jest.fn(async () => ({ results: [
      { name: 'Canada Fab Grant', funder: 'ISED', summary: 'x', regions: ['All of Canada'], deadline: 'Open until filled' },
      { name: 'Hiring Boost', funder: 'ESDC', summary: 'y', regions: [], deadline: '2027-03-31' }
    ] })),
    fetchPage: jest.fn(async () => null),
    fetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({
      tracks: [{ goal: 'Hire or Train People', review_status: 'ready', selected: [
        { grant_id: 1, name: 'WILWorks Skilled Trades', provider: 'EMC', match_strength: 'medium', eligibility: 'Likely',
          reason: null, requirement_notes: [{ text: 'Requires: a youth hire. We couldn\'t check this from your profile.' }] }] }],
      cost: { total_cents: 14.19 } }) })),
    env: { GG3_AI_SERVICE_URL: 'https://gg3.test/', GG3_REVIEW_FEED_TOKEN: 'tok' },
    createMessage: jest.fn(async () => ({
      usage: { input_tokens: 10000, output_tokens: 2000 },
      content: [{ type: 'tool_use', name: 'write_briefing', input: { summary_lines: ['Elmwood discovery', 'Ask about hiring'], markdown: '# Elmwood — Discovery\n- **ASK** — revenue?' } }]
    })),
    logCost: jest.fn(),
    createDoc: jest.fn(async () => ({ id: 'doc1', url: 'https://docs.google.com/document/d/doc1/edit', createdFolders: 0 })),
    findDm: jest.fn(async () => 'spaces/DM1'),
    postMessage: jest.fn(async () => 'spaces/DM1/messages/1'),
    query: jest.fn(async (sql, params) => {
      if (/FROM users/.test(sql)) return { rows: [{ id: 105, email: 'rukshaar@granted.ca', chat_user_id: 'users/9' }] };
      if (/INSERT INTO pre_call_briefings/.test(sql)) {
        if (rows.has(params[0])) return { rows: [] };
        rows.set(params[0], 'building');
        return { rows: [{ event_id: params[0] }] };
      }
      if (/SET status = 'done'/.test(sql)) { rows.set(params[0], 'done'); return { rows: [] }; }
      if (/SET status = 'failed'/.test(sql)) { rows.set(params[0], 'failed'); return { rows: [] }; }
      return { rows: [] };
    }),
    ...over
  };
}

const EVENT = { id: 'evt1', title: 'Grant Discovery Call - Elmwood Groups', start: '2026-10-20T17:00:00Z',
  attendees: [{ email: 'rukshaar@granted.ca', organizer: true }, { email: 'pat@elmwood.ca' }] };

describe('dates', () => {
  test('next business day skips the weekend; Friday covers Monday', () => {
    expect(R.nextBusinessDay('2026-10-19')).toBe('2026-10-20'); // Mon → Tue
    expect(R.nextBusinessDay('2026-10-23')).toBe('2026-10-26'); // Fri → Mon
    expect(R.nextBusinessDay('2026-10-24')).toBe('2026-10-26'); // Sat → Mon
  });
  test('Vancouver midnight is DST-correct', () => {
    expect(R.vancouverMidnight('2026-10-20').toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(R.vancouverMidnight('2026-12-01').toISOString()).toBe('2026-12-01T08:00:00.000Z');
  });
});

describe('which meetings', () => {
  test('title decides the type; renewals are skipped', () => {
    expect(R.classifyTitle('Grant Discovery Call - Elmwood Groups')).toBe('discovery');
    expect(R.classifyTitle('Quarterly review: Acme')).toBe('check_in');
    expect(R.classifyTitle('Acme check-in')).toBe('check_in');
    expect(R.classifyTitle('Acme renewal check-in')).toBe('skip');
    expect(R.classifyTitle('Acme / Granted')).toBeNull();
    expect(R.companyHintFromTitle('Grant Discovery Call - Elmwood Groups')).toBe('Elmwood Groups');
  });

  test('keeps a HubSpot-known meeting, skips internal, cancelled and unknown ones', async () => {
    const d = deps({
      listEvents: jest.fn(async () => ({ success: true, events: [
        EVENT,
        { id: 'e2', title: 'Team sync', attendees: [{ email: 'chris@granted.ca' }] },
        { id: 'e3', title: 'Discovery - Nobody', attendees: [{ email: 'x@unknown.ca' }] },
        { id: 'e4', title: 'Discovery - Gone', status: 'cancelled', attendees: [{ email: 'pat@elmwood.ca' }] }
      ] })),
      crmSnapshot: jest.fn(async ({ email }) => (email === 'pat@elmwood.ca' ? crm() : { contact: null, company: null, deals: [] }))
    });
    const { meetings, skipped } = await R.findMeetings({ ownerUserId: 105, ownerEmail: 'rukshaar@granted.ca', date: '2026-10-20' }, d);
    expect(meetings.map(m => m.event.id)).toEqual(['evt1']);
    expect(meetings[0].type).toBe('discovery');
    expect(skipped).toEqual({ no_outside_attendee: 1, not_in_hubspot: 1, cancelled: 1 });
    // The calendar window is the whole Vancouver day.
    expect(d.listEvents.mock.calls[0][1]).toMatchObject({ time_min: '2026-10-20T07:00:00.000Z', time_max: '2026-10-21T07:00:00.000Z' });
  });

  test('unclear title: a closed-won deal makes it a check-in, otherwise discovery', async () => {
    const ev = { ...EVENT, title: 'Elmwood / Granted' };
    const won = deps({ listEvents: jest.fn(async () => ({ success: true, events: [ev] })),
      crmSnapshot: jest.fn(async () => crm({ deals: [{ id: 'd1', stage: 's_won' }] })) });
    expect((await R.findMeetings({ ownerUserId: 1, ownerEmail: 'rukshaar@granted.ca', date: '2026-10-20' }, won)).meetings[0])
      .toMatchObject({ type: 'check_in', typeFrom: 'hubspot' });
    const lead = deps({ listEvents: jest.fn(async () => ({ success: true, events: [ev] })),
      crmSnapshot: jest.fn(async () => crm({ deals: [{ id: 'd1', stage: 's_lost' }] })) });
    expect((await R.findMeetings({ ownerUserId: 1, ownerEmail: 'rukshaar@granted.ca', date: '2026-10-20' }, lead)).meetings[0].type).toBe('discovery');
  });
});

describe('profile and matching', () => {
  test('maps HubSpot + calculator facts into the match-preview shape', () => {
    const p = G.toPreviewProfile({ company_name: 'Elmwood', calculator: crm().contact.calculator, company: crm().company,
      website: { description: 'Steel', location: 'Abbotsford, BC' } });
    expect(p.regions).toEqual(['British Columbia']);
    expect(p.industries).toEqual(['Manufacturing', 'Manufacturing Food Beverage', 'Machinery']);
    expect(p.business_goals).toEqual(['Hire or Train People', 'Domestic Growth']);
    expect(p.employee_count).toBe('20');
  });

  test('a calculator 0 is "unanswered", not a headcount', () => {
    const p = G.toPreviewProfile({ calculator: { employees: 0, revenue: '0', industry: 'X' },
      company: { employees: 100, revenue: 0, province: 'Ontario' } });
    expect(p.employee_count).toBe('100');
    expect(p).not.toHaveProperty('annual_revenue');
  });

  test('province from HubSpot address fields, then the website pages', async () => {
    const d = deps();
    expect(await G.locateCompany({ company: { province: null, postalCode: 'V2S 1A1' } }, d))
      .toMatchObject({ provinces: ['British Columbia'], source: 'hubspot_address' });
    expect(d.fetchPage).not.toHaveBeenCalled();
    const site = deps({ fetchPage: jest.fn(async (url) => (url.endsWith('/contact')
      ? 'Head office: 100 Main St, Surrey, BC V3T 0A1. Call us.' : url.endsWith('/locations') ? 'Kelowna, BC · Calgary, AB · Surrey, B.C.' : null)) });
    const r = await G.locateCompany({ company: { province: null, city: null }, websiteUrl: 'https://elm.ca' }, site);
    expect(r).toMatchObject({ provinces: ['British Columbia'], source: 'website' });
    expect(site.fetchPage).toHaveBeenCalledWith('https://elm.ca/contact');
    expect(await G.locateCompany({ company: {}, websiteUrl: 'https://elm.ca' }, deps())).toMatchObject({ provinces: [], source: null });
  });

  test('provinces in page text: names, abbreviations and postal codes, passing mentions ignored', () => {
    expect(G.provincesInText('Toronto, ON M5V 2T6 · Ottawa, ON · we ship to Alberta')).toEqual(['Ontario']);
    expect(G.provincesInText('Vancouver, BC and Calgary, AB')).toEqual(['British Columbia', 'Alberta']);
    expect(G.provinceOfPostal('t2p 1j9')).toBe('Alberta');
    expect(G.provincesInText('nothing here')).toEqual([]);
  });

  test('province parsing', () => {
    expect(G.provinceOf('B.C.')).toBe('British Columbia');
    expect(G.provinceOf('Vancouver, BC')).toBe('British Columbia');
    expect(G.provinceOf('Québec')).toBe('Quebec');
    expect(G.provinceOf('Texas')).toBeNull();
  });

  test('engine matches carry the couldn\'t-check notes; cost is converted to dollars', async () => {
    const d = deps();
    const m = await G.matchGrants({ regions: ['British Columbia'], industries: ['Manufacturing'] }, {}, d);
    expect(m.source).toBe('engine');
    expect(m.grants[0].couldnt_check).toHaveLength(1);
    expect(m.costUsd).toBeCloseTo(0.1419);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toBe('https://gg3.test/api/v1/ai/internal/match-preview');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  test('no region → keyword search, and the briefing is told why', async () => {
    const d = deps();
    const m = await G.matchGrants({ regions: [], industries: ['Manufacturing'], business_goals: [] }, { meetingDate: '2026-10-14' }, d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(m.source).toBe('search');
    expect(m.grants.map(g => g.name)).toEqual(['Canada Fab Grant', 'Hiring Boost']);
    expect(m.note).toBe('Matched by keyword search, not the matching engine — the profile has no province.');
  });

  test('keyword fallback drops passed deadlines and provinces we cannot confirm', () => {
    const results = [
      { name: 'Expired', regions: ['All of Canada'], deadline: '2026-09-23' },
      { name: 'Ontario only', regions: ['Ontario'], deadline: 'Open until filled' },
      { name: 'National', regions: ['All of Canada'], deadline: '2027-01-01' },
      { name: 'BC only', regions: ['British Columbia'], deadline: null }
    ];
    expect(G.reliableFallback(results, { meetingDate: '2026-10-14', provinces: [] }).map(g => g.name)).toEqual(['National']);
    expect(G.reliableFallback(results, { meetingDate: '2026-10-14', provinces: ['British Columbia'] }).map(g => g.name)).toEqual(['National', 'BC only']);
  });

  test('fewer than 2 reliable keyword matches → the one-line section', async () => {
    const d = deps({ grantSearch: jest.fn(async () => ({ results: [
      { name: 'Ontario only', regions: ['Ontario'] }, { name: 'Old', regions: [], deadline: '2025-01-01' }, { name: 'Only one', regions: [] }
    ] })) });
    const m = await G.matchGrants({ regions: [], industries: ['Food'] }, { meetingDate: '2026-10-14' }, d);
    expect(m).toMatchObject({ source: 'none', noReliableMatches: true, grants: [] });
    expect(G.NO_RELIABLE_MATCHES_LINE).toBe('No reliable matches yet — confirm location and plans on the call.');
    expect(R.DISCOVERY_PROMPT).toContain('No reliable matches yet — confirm location and plans on the call.');
  });

  test('no calculator session → its HubSpot fields are ignored entirely', async () => {
    const d = deps({ leadGenSession: jest.fn(async () => null) });
    const f = await G.gatherDiscovery({ crm: crm(), attendeeEmail: 'pat@elmwood.ca' }, d);
    expect(f.calculator).toBeNull();
    expect(f.gaps).toContain('no_calculator_session');
    const p = G.toPreviewProfile(f);
    expect(p.industries).toEqual(['Machinery', 'Manufacturing']); // company + website only
    expect(p.business_goals).toEqual([]);
    expect(R.DISCOVERY_PROMPT).toMatch(/If "calculator" is null[^\n]*do not mention the calculator/);
  });

  test('engine failure also falls back', async () => {
    const d = deps({ fetch: jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) });
    const m = await G.matchGrants({ regions: ['Ontario'], industries: ['Retail'] }, {}, d);
    expect(m.source).toBe('search');
    expect(m.note).toMatch(/answered 503/);
  });

  test('check-in matches leave out programs the client already has a deal for', async () => {
    const m = await G.matchGrants({ regions: ['British Columbia'], industries: ['Manufacturing'] },
      { excludeDeals: [{ name: 'Elmwood - WILWorks Skilled Trades 2026', program: null }] }, deps());
    expect(m.grants).toEqual([]);
  });

  test('website URLs are fetched only when public http(s)', () => {
    expect(G.safeWebsiteUrl('elmwood.ca')).toBe('https://elmwood.ca');
    expect(G.safeWebsiteUrl('http://localhost:3000')).toBeNull();
    expect(G.safeWebsiteUrl('http://10.0.0.1')).toBeNull();
    expect(G.safeWebsiteUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('check-in facts', () => {
  test('deal stages and owners resolve to names; the strategy call is found', async () => {
    const d = deps({
      dealsForCompany: jest.fn(async () => ({ success: true, deals: [
        { id: 'd1', name: 'CanExport', stage: 's_open', ownerId: 'o2', open: true },
        { id: 'd2', name: 'BCAIP', stage: 's_won', ownerId: 'o1', open: false }
      ] })),
      calls: jest.fn(async (type) => ({ success: true, calls: type === 'companies'
        ? [{ title: 'Strategy meeting', body: 'Plan: CanExport then BCAIP', timestamp: '2026-07-01T00:00:00Z', ownerId: 'o1' }] : [] }))
    });
    const f = await G.gatherCheckIn({ crm: crm() }, d);
    expect(f.deals.find(x => x.id === 'd1')).toMatchObject({ stage: 'Application submitted', closed: false, owner: 'Delpreet K' });
    expect(f.deals.find(x => x.id === 'd2')).toMatchObject({ won: true, owner: 'Steph Lee' });
    expect(f.strategy_call).toMatchObject({ title: 'Strategy meeting', date: '2026-07-01' });
    // Emails come only from what is logged to the deal or the company.
    expect(d.emails.mock.calls.map(c => c[0]).sort()).toEqual(['companies', 'deals', 'deals']);
  });
});

describe('writing', () => {
  test('Sonnet 5.5 with no temperature and an auto tool choice; cost logged under ruk-briefing', async () => {
    const d = deps();
    const w = await R.writeBriefing({ type: 'discovery', facts: {}, matches: { note: null, grants: [] }, meetingDate: '2026-10-20' },
      { createMessage: d.createMessage, logCost: d.logCost });
    const params = d.createMessage.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params).not.toHaveProperty('temperature');
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.system).toMatch(/## 1\. Business overview/);
    expect(d.logCost).toHaveBeenCalledWith(expect.objectContaining({ source: 'ruk-briefing' }));
    expect(w.summaryLines).toHaveLength(2);
    expect(w.costUsd).toBeCloseTo(0.04);
  });

  test('a reply without the tool call is an error, with its cost', async () => {
    const createMessage = jest.fn(async () => ({ usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'text', text: 'hi' }] }));
    await expect(R.writeBriefing({ type: 'check_in', facts: {}, matches: { grants: [] } }, { createMessage }))
      .rejects.toMatchObject({ code: 'bad_model_output' });
  });

  test('the check-in prompt says never guess, and names the owner', () => {
    expect(R.CHECK_IN_PROMPT).toMatch(/unclear — ask <the deal's owner name>/);
    expect(R.CHECK_IN_PROMPT).toMatch(/Never guess/);
  });

  test('doc name', () => {
    expect(R.docName('2026-10-20', 'Elmwood / Groups', 'check_in')).toBe('2026-10-20 – Elmwood - Groups – Check-in');
  });
});

describe('the daily run', () => {
  const NOW = new Date('2026-10-19T15:00:00Z'); // Mon 08:00 Vancouver → briefs Tue 20th

  function runDeps(over) {
    return deps({
      listEvents: jest.fn(async () => ({ success: true, events: [EVENT] })),
      crmSnapshot: jest.fn(async () => crm()),
      ...over
    });
  }

  test('builds, files and DMs once; a second run skips the claimed meeting', async () => {
    const d = runDeps();
    const first = await R.runRukBriefings({ now: NOW, env: {}, deps: d });
    expect(first).toMatchObject({ date: '2026-10-20', status: 'ok', found: 1, built: 1, failed: 0, dm: { sent: 1 } });
    expect(d.createDoc).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: 'rukshaar@granted.ca', folderParts: ['Pre-Call Briefings', 'Ruk'], name: '2026-10-20 – Elmwood Groups – Discovery'
    }));
    expect(d.postMessage.mock.calls[0][0].text).toMatch(/docs\.google\.com/);
    expect(d._rows.get('evt1')).toBe('done');

    const second = await R.runRukBriefings({ now: NOW, env: {}, deps: d });
    expect(second).toMatchObject({ built: 0, already: 1 });
    expect(d.createDoc).toHaveBeenCalledTimes(1);
  });

  test('two copies racing: only the claim winner builds', async () => {
    const d = runDeps();
    const [a, b] = await Promise.all([R.runRukBriefings({ now: NOW, env: {}, deps: d }), R.runRukBriefings({ now: NOW, env: {}, deps: d })]);
    expect(a.built + b.built).toBe(1);
    expect(a.already + b.already).toBe(1);
  });

  test('the Doc failing means no DM and a failed row', async () => {
    const err = Object.assign(new Error('denied'), { code: 'drive_write_denied' });
    const d = runDeps({ createDoc: jest.fn(async () => { throw err; }) });
    const r = await R.runRukBriefings({ now: NOW, env: {}, deps: d });
    expect(r).toMatchObject({ built: 0, failed: 1 });
    expect(d.postMessage).not.toHaveBeenCalled();
    expect(d._rows.get('evt1')).toBe('failed');
    const failCall = d.query.mock.calls.find(c => /SET status = 'failed'/.test(c[0]));
    expect(failCall[1][1]).toBe('drive_write_denied');
  });

  test('no DM space: the Doc is still filed and the row is done with a note', async () => {
    const d = runDeps({ findDm: jest.fn(async () => null) });
    const r = await R.runRukBriefings({ now: NOW, env: {}, deps: d });
    expect(r).toMatchObject({ built: 1, dm: { no_dm_space: 1 } });
    const done = d.query.mock.calls.find(c => /SET status = 'done'/.test(c[0]));
    expect(done[1][4]).toBe('no_dm_space');
  });

  test('a failed row is re-claimable after 30 minutes (in the claim statement itself)', () => {
    expect(R.CLAIM_SQL).toMatch(/status = 'failed'\s+AND pre_call_briefings\.claimed_at < NOW\(\) - INTERVAL '30 minutes'/);
    expect(R.CLAIM_SQL).toMatch(/ON CONFLICT \(event_id\) DO UPDATE/);
  });

  test('missing table: skips the run', async () => {
    R._resetRukBriefingsForTests();
    const d = runDeps({ query: jest.fn(async (sql) => {
      if (/FROM users/.test(sql)) return { rows: [{ id: 105, chat_user_id: 'users/9' }] };
      throw Object.assign(new Error('missing'), { code: '42P01' });
    }) });
    expect(await R.runRukBriefings({ now: NOW, env: {}, deps: d })).toMatchObject({ status: 'no_state_table' });
    expect(d.createMessage).not.toHaveBeenCalled();
  });
});

describe('schedule', () => {
  test('off unless RUK_BRIEFINGS_ENABLED=true', () => {
    const cron = { schedule: jest.fn() };
    expect(R.startRukBriefings(cron, {})).toBe(false);
    expect(R.startRukBriefings(cron, { RUK_BRIEFINGS_ENABLED: '1' })).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });
  test('on: 08:00 Vancouver Mon–Fri, no overlapping runs', () => {
    const cron = { schedule: jest.fn() };
    expect(R.startRukBriefings(cron, { RUK_BRIEFINGS_ENABLED: 'true' })).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * 1-5', expect.any(Function),
      { name: 'ruk-briefings', timezone: 'America/Vancouver', noOverlap: true });
  });
});

describe('Drive', () => {
  test('creates missing folders then the Doc, as the owner, in the shared drive', async () => {
    const create = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'f2' } })
      .mockResolvedValueOnce({ data: { id: 'doc9', webViewLink: 'https://docs.google.com/document/d/doc9/edit' } });
    const { resolveGrantedFilesPath } = await import('../../src/tools/google-drive.js');
    resolveGrantedFilesPath.mockResolvedValueOnce({ names: ['Pre-Call Briefings'], ids: ['f1'], parentId: 'f1', missingAt: 1 });
    const driveClient = jest.fn(() => ({ files: { create } }));
    const doc = await D.createBriefingDoc({ ownerEmail: 'rukshaar@granted.ca', folderParts: ['Pre-Call Briefings', 'Ruk'], name: 'n', html: '<p>x</p>' }, { driveClient });
    expect(driveClient).toHaveBeenCalledWith('rukshaar@granted.ca', { write: true });
    expect(create.mock.calls[0][0]).toMatchObject({ requestBody: { name: 'Ruk', parents: ['f1'] }, supportsAllDrives: true });
    expect(create.mock.calls[1][0]).toMatchObject({ requestBody: { mimeType: 'application/vnd.google-apps.document', parents: ['f2'] }, supportsAllDrives: true });
    expect(doc).toEqual({ id: 'doc9', url: 'https://docs.google.com/document/d/doc9/edit', createdFolders: 1 });
  });

  test('a 403 is drive_write_denied', async () => {
    const { resolveGrantedFilesPath } = await import('../../src/tools/google-drive.js');
    resolveGrantedFilesPath.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 403 }));
    await expect(D.createBriefingDoc({ ownerEmail: 'rukshaar@granted.ca', folderParts: ['A'], name: 'n', html: '' }, { driveClient: () => ({}) }))
      .rejects.toMatchObject({ code: 'drive_write_denied' });
  });

  test('markdown subset → HTML, escaped', () => {
    const html = D.markdownToHtml('# T\n## 1. Part\n- **ASK** — <b>x</b>\n1. one\nplain [l](https://x.ca)');
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<ul>\n<li><b>ASK</b> — &lt;b&gt;x&lt;/b&gt;</li>\n</ul>');
    expect(html).toContain('<ol>\n<li>one</li>\n</ol>');
    expect(html).toContain('<a href="https://x.ca">l</a>');
  });
});

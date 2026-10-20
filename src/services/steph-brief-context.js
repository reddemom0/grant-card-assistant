/**
 * Steph morning brief — context and draft for one item.
 *
 * Two paths, by category (cost: see DECISIONS.md, cost trim):
 *
 *   CLIENTS — one headless Oracle run AS STEPH (the draftLeadReply pattern,
 *   plus a chat_dm chatContext so the Chat-history tool works), PINNED to
 *   Sonnet 5.5 and capped at ORACLE_MAX_ITERATIONS tool loops. Oracle reads
 *   HubSpot, the client's Drive folder, Granola and recent Chat history with
 *   READ-ONLY tools only. On timeout the run is aborted at its next loop step
 *   and awaited, so the call in flight still reports its cost.
 *
 *   EVERYONE ELSE — context gathered in code (gatherContext), then ONE drafting
 *   call with no tools (draftOnce), pinned to Haiku:
 *     leads      website + lookupLead/crmFacts/programsToMention + gg3 match-lead
 *     partners   the HubSpot contact/company already fetched by classification
 *     team       the thread only
 *     government the thread only; GetGranted grant lookup when it asks about a
 *                named program's rules
 *
 * Both return { assessment, owner_hint, unclear, draft_body }; the card shows
 * only the assessment. Neither touches Gmail: the job creates the draft through
 * createDraftReply (src/tools/gmail.js), which has no send path.
 *
 * The stored calculator TIER is never read into a prompt or the card.
 * Every draft passes guardDraft (meeting links, unconfirmed price / timeline /
 * approval → holding reply).
 *
 * COST: every model call for an item is added to a ledger (tokens, tool calls,
 * tools, web searches + their $0.01 fee, the website lookup), and every cost
 * row is tagged with deps.costTags ({ brief_run_id, is_dry_run }).
 */

import crypto from 'crypto';
import { firstName } from './steph-brief-triage.js';
import { calculateRequestCost } from '../config/cost-settings.js';
import { UNTRUSTED_EMAIL_RULE } from './steph-brief-classify.js';

/** The only tools Oracle may use in a brief run. All read-only. */
export const READ_ONLY_TOOLS = Object.freeze([
  'search_hubspot_contacts', 'search_hubspot_companies', 'get_hubspot_contact', 'get_hubspot_company',
  'search_grant_applications', 'get_grant_application', 'list_hubspot_owners',
  'search_google_drive', 'read_google_drive_file', 'list_files_in_folder', 'list_granted_files_folders',
  'read_google_doc_outline', 'read_sheet_metadata', 'read_sheet_range',
  'granola_query_meetings', 'granola_list_meetings', 'granola_get_meetings', 'granola_get_meeting_transcript',
  'read_chat_space_history',
  'grant_data', 'search_oracle_kb',
  'web_search', 'web_fetch'
]);

const THREAD_CHARS = 6000;
const DRAFT_MAX = 2500;

/** Pinned models. Never left to Oracle's query classifier. */
export const DRAFT_MODEL = 'claude-haiku-4-5-20251001';
export const SONNET_MODEL = 'claude-sonnet-5-5';
export const ORACLE_MAX_ITERATIONS = 8;
export const WEB_SEARCH_FEE_USD = 0.01;
const DRAFT_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Cost ledger
// ---------------------------------------------------------------------------

export function newLedger() {
  return { model: null, model_cost: 0, website: 0, search_fees: 0, input_tokens: 0, output_tokens: 0,
    cache_read_tokens: 0, cache_write_tokens: 0, tool_calls: 0, tools_used: [], web_searches: 0, sources: [] };
}

/** Where a draft's context came from, as the card names it. */
const SOURCE_OF_TOOL = [
  [/hubspot|grant_application/, 'HubSpot'],
  [/google_drive|files_in_folder|granted_files|google_doc|sheet/, 'Drive'],
  [/^granola_/, 'Granola'],
  [/chat_space_history/, 'Chat'],
  [/^grant_data$|oracle_kb/, 'GetGranted'],
  [/^web_(search|fetch)$/, 'the web']
];

/** Record a source the code read (not a model tool). */
export function noteSource(ledger, source) {
  if (ledger && source && !ledger.sources.includes(source)) ledger.sources.push(source);
}

/** The sources a draft actually used: code lookups plus the Oracle tools it called. */
export function sourcesOf(ledger) {
  if (!ledger) return [];
  const out = [...(ledger.sources || [])];
  for (const tool of ledger.tools_used || []) {
    const hit = SOURCE_OF_TOOL.find(([re]) => re.test(tool));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

/** One model call. `cost` given (agent loop) or computed from usage. */
export function addUsage(ledger, { usage, model, cost = null, toolNames = [] }) {
  const u = usage || {};
  ledger.model = ledger.model || model || null;
  ledger.model_cost += cost != null ? Number(cost) || 0 : calculateRequestCost(u, model || DRAFT_MODEL);
  ledger.input_tokens += u.input_tokens || 0;
  ledger.output_tokens += u.output_tokens || 0;
  ledger.cache_read_tokens += u.cache_read_input_tokens || 0;
  ledger.cache_write_tokens += u.cache_creation_input_tokens || 0;
  ledger.tool_calls += toolNames.length;
  for (const t of toolNames) if (!ledger.tools_used.includes(t)) ledger.tools_used.push(t);
  const searches = toolNames.filter(t => t === 'web_search').length;
  ledger.web_searches += searches;
  ledger.search_fees += searches * WEB_SEARCH_FEE_USD;
  return ledger;
}

export const ledgerTotal = (l) => (l ? l.model_cost + l.website + l.search_fees : 0);

// ---------------------------------------------------------------------------
// Lead facts (no tier, ever)
// ---------------------------------------------------------------------------

/** Keys that carry a stored or derived calculator tier. Stripped wherever facts are built. */
export const TIER_KEYS = Object.freeze(['best_fit', 'best_fit_product', 'best_fit_product_company', 'bestFit', 'service_tier', 'tier', 'fit']);

export function withoutTier(v) {
  if (Array.isArray(v)) return v.map(withoutTier);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !TIER_KEYS.includes(k) && !k.startsWith('_'))
    .map(([k, x]) => [k, withoutTier(x)]));
}

const FREE = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|protonmail|proton|shaw|telus|rogers|sympatico|bell)\./i;

/**
 * Everything the brief knows about a lead, gathered in code.
 * @returns {Promise<{facts: object, factsLine: string|null, matchNote: string|null}>}
 */
export async function leadFacts(item, deps, ledger = newLedger()) {
  const email = item.sender_address;
  const domain = String(email || '').split('@')[1] || '';
  const looked = await deps.lookupLead({ email, name: item.sender }, { text: item.subject || '' }).catch(() => null);
  if (looked) noteSource(ledger, 'HubSpot');
  const crm = looked?.crm || item.crm || {};
  const calc = withoutTier(await deps.decodeCalculator(crm.contact?.calculator || {}));
  const session = await deps.leadSession(email).catch(() => null);
  const estimate = session?.estimate ?? null;

  const websiteUrl = crm.company?.domain ? `https://${crm.company.domain}`
    : crm.contact?.website || (domain && !FREE.test(domain) ? `https://${domain}` : null);
  const website = websiteUrl
    ? await deps.website(websiteUrl, {
      sessionId: `steph-brief:${deps.costTags?.brief_run_id ?? 'run'}`,
      onUsage: (usage, model) => { ledger.website += calculateRequestCost(usage, model); }
    }).catch(() => null)
    : null;
  if (website) noteSource(ledger, 'their website');
  const pages = websiteUrl ? deps.sitePages(websiteUrl) : async () => [];
  const location = await deps.locateCompany({ company: crm.company, websiteUrl, pages }).catch(() => ({ provinces: [] }));
  const industry = await deps.industryFor({ calculatorLabels: calc.industry || [], companyIndustry: crm.company?.industry, pages })
    .catch(() => ({ canonical: [] }));

  const province = location.provinces?.[0] || null;
  const industryName = industry.canonical?.[0] || null;
  let matches = [];
  let matchNote = null;
  const m = await deps.matchLead({
    province, industry: industryName,
    employee_count: calc.employees_band || undefined,
    annual_revenue: calc.revenue_band || undefined,
    description: website?.description || undefined
  });
  if (m.ok) noteSource(ledger, 'GetGranted');
  if (m.ok && m.status === 'ok') {
    matches = m.grants.map(g => ({ name: g.name, provider: g.provider, amount: g.amount, match_level: g.match_level, why_fits: g.why_fits, to_confirm: g.to_confirm }));
  } else if (m.ok && m.status === 'insufficient_profile') {
    matchNote = `Grant match needs ${m.missing.join(' and ')} — not found in HubSpot or on their site.`;
  } else {
    matchNote = 'Grant match unavailable today.';
  }

  const facts = withoutTier({
    hubspot: {
      found: !!crm.found,
      contact: crm.contact ? { name: crm.contact.name, company: crm.contact.company, created: crm.contact.createDate } : null,
      company: crm.company ? { name: crm.company.name, domain: crm.company.domain, province: crm.company.province } : null,
      open_deals: (crm.openDeals || []).map(d => ({ name: d.name, program: d.program, stage: d.stage })),
      past_client: !!crm.exClient,
      owner: crm.ownerName || null,
      previously_not_a_fit: crm.notFit?.reason || null
    },
    calculator: calc,
    calculator_estimate: estimate,
    website: website ? { description: website.description, industry: website.industry, location: website.location, team_size: website.estimated_team_size } : null,
    location: province,
    industry: industryName,
    grant_matches: matches
  });

  const bits = [
    calc.revenue && `revenue ${calc.revenue}`,
    calc.employees && `${calc.employees} staff`,
    (calc.industry || []).length ? calc.industry.join('/') : null,
    calc.spend_on && `spend: ${calc.spend_on}`,
    estimate != null && `est. ${typeof estimate === 'number' ? `$${estimate.toLocaleString('en-CA')}` : estimate}`
  ].filter(Boolean);
  const factsLine = bits.length ? `Calculator: ${bits.join(' · ')}` : null;
  return { facts, factsLine, matchNote };
}

// ---------------------------------------------------------------------------
// Prompt and reply
// ---------------------------------------------------------------------------

export function threadText(item) {
  const msgs = item.threads.flatMap(t => (t.messages || []).filter(m => !m.is_draft).map(m => ({ ...m, _subject: t.subject })))
    .sort((a, b) => a.internal_date - b.internal_date);
  // Each message in <email> tags: third-party text, never instructions (UNTRUSTED_EMAIL_RULE).
  const out = msgs.map(m => `<email from="${m.from_user ? 'STEPH' : String(m.from).replace(/"/g, "'")}" date="${new Date(m.internal_date).toISOString().slice(0, 10)}">\nSubject: ${m.subject}\n${String(m.body || '').trim().replace(/<\/?email[^>]*>/gi, '')}${m.attachments?.length ? `\n[attachments: ${m.attachments.join(', ')}]` : ''}\n</email>`).join('\n\n');
  return out.length > THREAD_CHARS ? `…${out.slice(-THREAD_CHARS)}` : out;
}

const GROUP_GUIDE = {
  client: 'an existing client (or an internal email about a client). Check HubSpot deals, their Drive folder, recent Granola meetings and Chat history before you judge status.',
  partner: 'a partner (accountant, bank, association, referral or webinar/trial partner).',
  lead: 'a lead. The lead facts below were gathered for you; use the grant matches only as possibilities to confirm, never as promises.',
  team: 'a Granted colleague. Answer as a colleague; no meeting link.',
  government: 'a government program or funder. Be precise and formal; check the program in GetGranted grants or on the web if a question turns on program rules.'
};

/** The latest learned corrections, as a prompt block after the voice guide. */
export function correctionsBlock(corrections) {
  const rules = (corrections || []).map(c => (typeof c === 'string' ? c : c?.rule)).filter(Boolean).slice(0, 15);
  return rules.length ? `HOW STEPH HAS CORRECTED PAST DRAFTS — follow these too:\n${rules.map(r => `- ${r}`).join('\n')}` : null;
}

export function buildOraclePrompt(item, { styleGuide, links, facts = null, corrections = [] }) {
  const linkLines = Object.entries(links || {}).map(([min, url]) => `- ${min} minutes: ${url}`).join('\n');
  return [
    `You are preparing Stephanie Sang's (Steph's) morning email brief. This is a BACKGROUND JOB running as Steph — there is no one to ask, so do not ask questions. Use only read-only tools.`,
    `The item below is from ${item.sender} <${item.sender_address}>, sorted as ${GROUP_GUIDE[item.category] || item.category}`,
    `Look up what you need: HubSpot (contact, company, deals), the client's Drive folder, Granola meetings, recent Chat history (read_chat_space_history, last 30 days, in a space named after the client or topic if one exists), GetGranted grants (grant_data). Use AT MOST 6 tool calls in total, then answer — start with HubSpot and only go to Granola or Chat if HubSpot leaves the status unclear. The context informs the draft — do NOT restate it in the assessment.`,
    facts ? `LEAD FACTS (gathered in code):\n${JSON.stringify(facts, null, 1)}` : null,
    `UNANSWERED THREAD(S), oldest first:\n${threadText(item)}`,
    `STEPH'S VOICE — follow this guide exactly when writing draft_body:\n${styleGuide || '(no guide)'}`,
    correctionsBlock(corrections),
    UNTRUSTED_EMAIL_RULE,
    linkLines ? `MEETING LINKS you may offer (only these, only if a call is the right next step):\n${linkLines}` : 'Do NOT include any meeting link.',
    `RULES:
- Never state a price, fee, timeline, status or approval/funding outcome unless it is confirmed in HubSpot, Drive, Granola, Chat or the thread itself. If facts conflict or can't be confirmed, draft_body is a short HOLDING reply (acknowledge, say she's confirming, propose the next step) and "unclear" says what is unclear and who to ask.
- draft_body is the email body only: start with the recipient's first name and a comma, no subject line, no signature.
- assessment: one or two short sentences for Steph — what this is and what it needs from her.
- owner_hint: a colleague who should own this if it isn't Steph's, else null.`,
    'Reply with ONLY one JSON object in a ```json fence: {"assessment": "...", "owner_hint": null, "unclear": null, "draft_body": "..."}'
  ].filter(Boolean).join('\n\n');
}

export function parseReply(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    return { assessment: str(o.assessment, 400), owner_hint: str(o.owner_hint, 120), unclear: str(o.unclear, 300), draft_body: str(o.draft_body, DRAFT_MAX) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Guards — independent of the model
// ---------------------------------------------------------------------------

const MEETING_URL = /https?:\/\/meetings\.hubspot\.com\/[^\s)"'<>\]]+/gi;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million|thousand)?\b/gi;
const TIMELINE = /\b(within|in)\s+(\d+|a|one|two|three|four|five|six|a few|a couple of)\s+(business\s+)?(days?|weeks?|months?)\b|\bturnaround\b|\b(decision|approval|funding|payment)s?\s+(by|in|within)\b/gi;
const APPROVAL = /\b(you('| wi)ll\s+(be\s+)?(approved|qualify|get\s+(the\s+)?(grant|funding))|you\s+(are|'re)\s+(approved|eligible)|guarantee(d)?|approved\s+for|will\s+be\s+funded)\b/gi;

// ---------------------------------------------------------------------------
// Acknowledgement-only drafts (unhappy client)
// ---------------------------------------------------------------------------

/** Anything that offers a fix, money or fault. An acknowledgement must contain none of it. */
export const ACK_FORBIDDEN = /\b(refund(ed|s)?|credit(ed|s)?|discount(ed|s)?|compensat\w*|reimburs\w*|waiv(e|ed|ing)|free of charge|no charge|on the house|our fault|your fault|my fault|we (made|messed)|mistake (was|on)|we('| wi)ll fix|i('| wi)ll fix|we('| ha)ve fixed|resolv(e|ed|ing)|solution|make (it|this) right|guarantee\w*)\b/i;

export function ackReply(item) {
  const name = firstName(item.sender);
  return `${name ? `${name},\n\n` : ''}I'm sorry to hear this, and thank you for telling me. I'm looking into it now and will call you today.`;
}

/** An acknowledgement that offers a fix, refund, credit or blame is replaced by the fixed one. */
export function guardAck(draft, item) {
  if (!draft || ACK_FORBIDDEN.test(draft)) {
    return { body: ackReply(item), held: !!draft, notes: draft ? ['The draft offered a fix, credit or blame — replaced with a plain acknowledgement.'] : [] };
  }
  return { body: draft.trim(), held: false, notes: [] };
}

export function holdingReply(item) {
  const name = firstName(item.sender);
  return `${name ? `${name},\n\n` : ''}Thanks for this. I'm confirming a couple of details on our end before I come back to you with a proper answer.\n\nIf anything changes on your side in the meantime, just let me know.`;
}

/**
 * @param {string} draft
 * @param {{ item, allowedLinks: Record<number,string>, sourceText: string }} ctx
 *   sourceText — the thread plus any facts; a figure or promise that appears
 *   there verbatim is confirmed, anything else is not.
 * @returns {{ body: string, held: boolean, notes: string[] }}
 */
export function guardDraft(draft, { item, allowedLinks = {}, sourceText = '' }) {
  const notes = [];
  if (!draft) return { body: holdingReply(item), held: true, notes: ['No draft came back — holding reply saved.'] };
  const allowed = new Set(Object.values(allowedLinks).map(u => u.replace(/\/+$/, '').toLowerCase()));
  let body = draft.replace(MEETING_URL, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    if (allowed.has(clean.replace(/\/+$/, '').toLowerCase())) return url;
    notes.push('Removed a meeting link this kind of email may not offer.');
    return '';
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const source = String(sourceText).toLowerCase();
  const unconfirmed = (re) => [...body.matchAll(re)].map(m => m[0]).filter(x => !source.includes(x.toLowerCase()));
  const money = unconfirmed(MONEY);
  const time = unconfirmed(TIMELINE);
  const approval = [...body.matchAll(APPROVAL)].map(m => m[0]);
  if (money.length || time.length || approval.length) {
    const what = [money.length && 'a price or amount', time.length && 'a timeline', approval.length && 'an approval or outcome'].filter(Boolean).join(', ');
    return { body: holdingReply(item), held: true, notes: [...new Set(notes), `Held back: the draft stated ${what} that isn't confirmed — holding reply saved instead.`] };
  }
  return { body, held: false, notes: [...new Set(notes)] };
}

// ---------------------------------------------------------------------------
// Fixed context per category (no agent loop)
// ---------------------------------------------------------------------------

/** The HubSpot facts classification already fetched, condensed for a prompt. */
export function condenseCrm(crm) {
  if (!crm?.found) return { found: false };
  return withoutTier({
    found: true,
    contact: crm.contact ? { name: crm.contact.name, company: crm.contact.company } : null,
    company: crm.company ? { name: crm.company.name, domain: crm.company.domain, province: crm.company.province } : null,
    open_deals: (crm.openDeals || []).map(d => ({ name: d.name, program: d.program, stage: d.stage })),
    past_client: !!crm.exClient,
    owner: crm.ownerName || null
  });
}

/**
 * @returns {Promise<{ facts: object|null, factsLine: string|null, note: string|null }>}
 */
export async function gatherContext(item, deps, ledger = newLedger()) {
  switch (item.category) {
    case 'lead': {
      try {
        const { facts, factsLine, matchNote } = await leadFacts(item, deps, ledger);
        return { facts, factsLine, note: matchNote };
      } catch {
        return { facts: null, factsLine: null, note: 'Lead lookup failed today.' };
      }
    }
    case 'partner':
    case 'client':      // clients only come here for the dry-run Haiku comparison
      if (item.crm?.found) noteSource(ledger, 'HubSpot');
      return { facts: { hubspot: condenseCrm(item.crm) }, factsLine: null, note: null };
    case 'government': {
      const q = item.program_question;
      if (!q?.asks_rules) return { facts: null, factsLine: null, note: null };
      try {
        const r = await deps.grantSearch({ query: q.program_name, limit: 3 });
        noteSource(ledger, 'GetGranted');
        const grants = (r?.results || []).slice(0, 3).map(g => ({
          name: g.name, funder: g.funder, amount: g.amount, deadline: g.deadline, status: g.status,
          summary: String(g.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)
        }));
        return { facts: { program_asked_about: q.program_name, getgranted_lookup: grants }, factsLine: null,
          note: grants.length ? null : `No GetGranted record found for "${q.program_name}" — check the rules before replying.` };
      } catch {
        return { facts: null, factsLine: null, note: 'GetGranted lookup failed today.' };
      }
    }
    default:
      return { facts: null, factsLine: null, note: null };
  }
}

// ---------------------------------------------------------------------------
// One drafting call (no tools)
// ---------------------------------------------------------------------------

const MODE_RULES = {
  normal: '',
  ack: `THIS IS AN UNHAPPY CLIENT. Write an ACKNOWLEDGEMENT ONLY: say sorry, that she's looking into it, and that she'll call today. NEVER offer a fix, a refund, a credit, a discount, a waiver or any compensation, and NEVER assign blame (not ours, not theirs). Three sentences at most. "unclear" names who should be on the call.
`,
  promise: `THIS IS A FOLLOW-UP ON A PROMISE STEPH MADE (see PROMISE in the context). Draft a short follow-up that keeps the promise ONLY with facts in the thread or context; if anything needed is missing, write a holding reply and say what's missing in "unclear". Never invent the deliverable.
`
};

export function draftSystem(styleGuide, { mode = 'normal', corrections = [] } = {}) {
  return `You draft email replies AS Stephanie Sang (Steph), a senior grant consultant at Granted Consulting, for her morning brief. She reviews and sends every draft herself.

${MODE_RULES[mode] || ''}RULES:
- Use ONLY the thread and the CONTEXT given. Never state a price, fee, timeline, status or approval/funding outcome unless it is in them. If facts conflict or can't be confirmed, draft_body is a short HOLDING reply (acknowledge, say she's confirming, propose the next step) and "unclear" says what is unclear and who to ask.
- draft_body is the email body only: start with the recipient's first name and a comma, no subject line, no signature.
- assessment: one or two short sentences for Steph — what this is and what it needs from her. Don't restate the context.
- owner_hint: a colleague who should own this if it isn't Steph's, else null.
- Offer a meeting link only from the list given, only if a call is the right next step.

Reply with ONLY one JSON object in a \`\`\`json fence: {"assessment": "...", "owner_hint": null, "unclear": null, "draft_body": "..."}

STEPH'S VOICE — follow this guide exactly:
${styleGuide || '(no guide)'}
${correctionsBlock(corrections) ? `\n${correctionsBlock(corrections)}\n` : ''}
${UNTRUSTED_EMAIL_RULE}`;
}

const DRAFT_GUIDE = {
  client: 'an existing client.',
  partner: 'a partner (accountant, bank, association, referral or webinar/trial partner).',
  lead: 'a lead. Grant matches are possibilities to confirm on a call, never promises.',
  team: 'a Granted colleague. Answer as a colleague.',
  government: 'a government program or funder. Be precise and formal.'
};

export function draftUserMessage(item, { facts, links }) {
  const linkLines = Object.entries(links || {}).map(([min, url]) => `- ${min} minutes: ${url}`).join('\n');
  return [
    `From ${item.sender} <${item.sender_address}> — ${DRAFT_GUIDE[item.category] || item.category}`,
    facts ? `CONTEXT (gathered for you):\n${JSON.stringify(facts, null, 1)}` : 'CONTEXT: none beyond the thread.',
    `UNANSWERED THREAD(S), oldest first:\n${threadText(item)}`,
    linkLines ? `MEETING LINKS you may offer:\n${linkLines}` : 'Do NOT include any meeting link.'
  ].join('\n\n');
}

/**
 * One no-tools drafting call.
 * @returns {Promise<{ reply: object|null, ledger: object }>}
 */
export async function draftOnce(item, { facts, links, styleGuide, model = DRAFT_MODEL, mode = 'normal' }, deps, ledger = newLedger()) {
  const params = {
    model,
    max_tokens: 1500,
    system: [{ type: 'text', text: draftSystem(styleGuide, { mode, corrections: deps.corrections }), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: draftUserMessage(item, { facts, links }) }]
  };
  try {
    const msg = await deps.createMessage(params, { timeout: DRAFT_TIMEOUT_MS });
    if (msg?.usage) {
      addUsage(ledger, { usage: msg.usage, model });
      deps.logCost?.({ usage: msg.usage, model, source: 'steph-brief',
        metadata: { ...(deps.costTags || {}), step: mode === 'normal' ? 'draft' : `draft_${mode}`, item_key: item.item_key, category: item.category } });
    }
    const text = (msg?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return { reply: parseReply(text), ledger };
  } catch (err) {
    console.warn(`⚠️  Steph brief draft call failed — code: ${err?.code || err?.name || 'unknown'}`);
    return { reply: null, ledger };
  }
}

// ---------------------------------------------------------------------------
// Clients: Oracle, pinned + capped + abortable
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{ reply: object|null, conversationId: string, timedOut: boolean, capped: boolean }>}
 */
export async function oracleDraft(item, who, deps, ledger, { timeoutMs = 180_000, styleGuide, links }) {
  const conversationId = crypto.randomUUID();
  const controller = new AbortController();
  // Whose access the run uses: the mailbox owner (Steph, or the inbox an admin
  // dry run reads). The voice guide and links stay the persona's (who.steph).
  const runAs = who.runAs || who.steph;
  let timedOut = false;
  try {
    await deps.createConversation(conversationId, runAs.id, 'internal-oracle', `Morning brief: ${item.category}`);
  } catch { /* the run still works without the row */ }
  const agent = deps.runAgent({
    agentType: 'internal-oracle',
    message: buildOraclePrompt(item, { styleGuide, links, corrections: deps.corrections }),
    conversationId,
    userId: runAs.id,
    sessionId: crypto.randomUUID(),
    res: null,
    forceModel: SONNET_MODEL,
    modelConfig: { maxIterations: ORACLE_MAX_ITERATIONS },
    allowedTools: [...READ_ONLY_TOOLS],
    abortSignal: controller.signal,
    costMetadata: { ...(deps.costTags || {}), step: 'oracle', item_key: item.item_key, category: item.category },
    chatContext: { surface: 'chat_dm', spaceName: who.dmSpace || null, senderChatId: runAs.chat_user_id || null, senderDisplayName: 'Steph' },
    onCostCalculated: (cost, detail = {}) => {
      addUsage(ledger, { usage: detail.usage, model: detail.model || SONNET_MODEL, cost, toolNames: detail.toolNames || [] });
    }
  });
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  let result = await Promise.race([agent.catch(() => null), timeout]);
  clearTimeout(timer);
  if (result === 'timeout') {
    // Stop at the next loop step, then wait for the call in flight so its
    // cost is counted: no spend escapes the ledger.
    timedOut = true;
    controller.abort();
    result = await agent.catch(() => null);
  }
  const text = (result?.response?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const capped = result?.success === false && /max loops/i.test(String(result?.error || ''));
  return { reply: !timedOut && result?.success ? parseReply(text) : null, conversationId, timedOut, capped };
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

/**
 * @param {object} item - a classified item (category, threads, sender, crm…)
 * @param {{ steph: {email, id?, chat_user_id?}, runAs?: {id, email, chat_user_id}, dmSpace: string|null }} who
 *   steph — the persona (voice guide, meeting links); runAs — whose access the
 *   client Oracle run uses (defaults to steph)
 * @param {object} deps - runAgent, createConversation, createMessage, grantSearch, lead deps,
 *   loadStyleGuide, meetingLinksFor, logCost, costTags
 * @param {{ timeoutMs?: number, compare?: boolean }} opts - compare: dry-run model comparison
 * @returns {Promise<{ ok, assessment, owner_hint, note, facts_line, draft_body, held, ledger, conversation_id, compare }>}
 */
export async function contextForItem(item, who, deps, { timeoutMs = 180_000, compare = false } = {}) {
  const ledger = newLedger();
  const styleGuide = deps.loadStyleGuide(who.steph.email);
  const links = deps.meetingLinksFor(who.steph.email, item.category);
  let reply = null;
  let facts = null;
  let factsLine = null;
  const notes = [];
  let conversationId = null;

  if (item.draft === 'ack') {
    // Unhappy client: one Haiku acknowledgement, no context lookup, no links.
    ({ reply } = await draftOnce(item, { facts: null, links: {}, styleGuide, mode: 'ack' }, deps, ledger));
  } else if (item.draft === 'promise') {
    // A due promise whose facts are in the thread: one Haiku follow-up.
    facts = { promise: item.promise };
    ({ reply } = await draftOnce(item, { facts, links: {}, styleGuide, mode: 'promise' }, deps, ledger));
  } else if (item.category === 'client') {
    const o = await oracleDraft(item, who, deps, ledger, { timeoutMs, styleGuide, links });
    reply = o.reply;
    conversationId = o.conversationId;
    if (o.timedOut) notes.push('Context lookup timed out — holding reply saved.');
    else if (o.capped) notes.push('Context lookup hit its tool limit — holding reply saved.');
  } else {
    const ctx = await gatherContext(item, deps, ledger);
    facts = ctx.facts;
    factsLine = ctx.factsLine;
    if (ctx.note) notes.push(ctx.note);
    ({ reply } = await draftOnce(item, { facts, links, styleGuide }, deps, ledger));
  }

  const sourceText = `${threadText(item)}\n${facts ? JSON.stringify(facts) : ''}`;
  let guarded;
  if (item.draft === 'ack') {
    const ack = guardAck(reply?.draft_body, item);
    const g = guardDraft(ack.body, { item, allowedLinks: {}, sourceText });
    guarded = g.held ? { body: ackReply(item), held: true, notes: [...ack.notes, ...g.notes] } : { ...g, held: ack.held, notes: [...ack.notes, ...g.notes] };
  } else {
    guarded = guardDraft(reply?.draft_body, { item, allowedLinks: links, sourceText });
  }

  // Dry-run comparison: leads → a Sonnet version on the same context;
  // clients → a Haiku version on thread + HubSpot only. Costed separately.
  let compared = null;
  if (compare && item.draft !== 'ack' && (item.category === 'lead' || item.category === 'client')) {
    const cmpLedger = newLedger();
    const model = item.category === 'lead' ? SONNET_MODEL : DRAFT_MODEL;
    const cmpFacts = item.category === 'lead' ? facts : (await gatherContext(item, deps, cmpLedger)).facts;
    const { reply: other } = await draftOnce(item, { facts: cmpFacts, links, styleGuide, model }, deps, cmpLedger);
    const cmpGuarded = guardDraft(other?.draft_body, { item, allowedLinks: links, sourceText: `${threadText(item)}\n${cmpFacts ? JSON.stringify(cmpFacts) : ''}` });
    compared = {
      label: item.category === 'lead' ? 'Sonnet version' : 'Haiku version',
      model, draft: cmpGuarded.body, held: cmpGuarded.held, cost_usd: Number(ledgerTotal(cmpLedger).toFixed(4))
    };
  }

  return {
    ok: !!reply,
    assessment: reply?.assessment || item.assessment || null,
    owner_hint: reply?.owner_hint || null,
    note: [reply?.unclear && `Unclear: ${reply.unclear}`, ...notes, ...guarded.notes].filter(Boolean).join(' ') || null,
    facts_line: factsLine,
    draft_body: guarded.body,
    held: guarded.held,
    ledger,
    conversation_id: conversationId,
    compare: compared
  };
}

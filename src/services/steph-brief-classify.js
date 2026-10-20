/**
 * Steph morning brief — which group each mail item belongs to.
 *
 * Deterministic first, then one batched Haiku call for what's left:
 *   government domain              → government
 *   HubSpot closed-won deal        → client
 *   @granted.ca sender             → team, unless the mail is about a client
 *                                    (Haiku names the company; HubSpot confirms closed-won)
 *   everyone else                  → Haiku: client | partner | lead | team | government | vendor | other
 * vendor / other are skipped from the card and counted in its footer.
 *
 * The same Haiku call also returns a one- or two-line assessment for every
 * item, used on the card when the item gets no Oracle run (past the draft cap),
 * plus finance / urgency for ordering Team.
 *
 * Reads only. Logs counts — never a sender, a subject or a body.
 */

import { domainOf, isGovDomain, isInternal } from './steph-brief-triage.js';
import { calculateRequestCost } from '../config/cost-settings.js';

export const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';
export const GROUPS = ['client', 'partner', 'lead', 'team', 'government', 'vendor', 'other'];
const EXCERPT_CHARS = 600;
const BATCH = 20;

const FINANCE = /\b(invoice|invoicing|payment|payroll|expense|reimburse|receipt|billing|bill|accounts? (payable|receivable)|quickbooks|xero|bookkeep|tax|gst|hst|cra|t4|remittance|contract|retainer|refund)\b/i;
const FINANCE_SENDERS = /^(tomliao|payment|payments|accounting|finance|billing|ap|ar)@granted\.ca$/i;

export function looksFinance(item) {
  return FINANCE_SENDERS.test(item.sender_address || '') || FINANCE.test(item.subject || '');
}

/** Lead maturity for ordering: 3 open deal, 2 known in HubSpot, 1 calculator session, 0 unknown. */
export function leadMaturity(crm, session) {
  if (crm?.openDeals?.length) return 3;
  if (crm?.found) return 2;
  if (session) return 1;
  return 0;
}

const SYSTEM = `You sort unanswered emails for Stephanie Sang, a senior grant consultant at Granted Consulting (a Canadian grant-writing consultancy). For each item return its group:
- client: an existing client (or an internal email about a specific client's work)
- partner: accountants, banks, associations, referral partners, collaborators, webinar or trial partners
- lead: a business that might want grant help and isn't a client yet
- team: Granted staff about internal matters (finance, admin, scheduling, HR)
- government: a government grant program or funder
- vendor: someone selling a product or service to Granted
- other: anything else (newsletters, personal, unclear)
Also return: about_company (the client company an internal email is about, else null), finance (true for invoices, payments, payroll, contracts), urgency (0 none – 3 today), and assessment: one or two short plain sentences for Steph — what this is and what it needs from her. Never invent facts; say what is unclear.
needs_reply: false ONLY when the email clearly needs no reply from Steph — an FYI, a thank-you that closes the thread, she is only cc'd, an automatic confirmation, or someone else is answering. When in doubt, true.
program_question: for government emails, {"asks_rules": true, "program_name": "<the program>"} when the email asks about a named program's rules (eligibility, deadlines, eligible costs, reporting); else null.`;

/**
 * @param {Array} items - grouped mail items (groupBySender), each with threads[] of parsed messages
 * @param {object} deps - { crmFacts(lead), leadSession(email), createMessage(params), logCost?, costTags? }
 *   costTags — merged into the api_cost_events metadata (brief_run_id, is_dry_run)
 * @returns {Promise<{ items: Array, skipped: {vendor, other}, costUsd: number }>}
 *   items gain: category, assessment, about_company, finance, urgency, lead_maturity, crm,
 *   needs_reply (false = no draft), program_question ({asks_rules, program_name} | null)
 */
export async function classifyItems(items, deps) {
  const out = [];
  const undecided = [];
  for (const item of items) {
    const domain = domainOf(item.sender_address);
    const base = { ...item, finance: looksFinance(item), urgency: 0, lead_maturity: 0, crm: null, assessment: null, about_company: null,
      needs_reply: true, program_question: null };
    if (isGovDomain(domain)) { out.push({ ...base, category: 'government' }); continue; }
    if (isInternal(item.sender_address)) { undecided.push({ ...base, category: 'team' }); continue; }
    let crm = null;
    try { crm = await deps.crmFacts({ email: item.sender_address }); } catch { crm = null; }
    if (crm?.exClient) { out.push({ ...base, crm, category: 'client' }); continue; }
    undecided.push({ ...base, crm, category: null });
  }

  // One Haiku pass over everything: groups for the undecided, assessments and
  // urgency for all. A failure leaves deterministic groups and no assessment.
  const all = [...out, ...undecided];
  let costUsd = 0;
  const verdicts = new Map();
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    try {
      const r = await haikuBatch(batch, deps);
      costUsd += r.costUsd;
      r.verdicts.forEach((v, k) => verdicts.set(batch[k].item_key, v));
    } catch (err) {
      console.warn(`⚠️  Steph brief classify batch failed — code: ${err?.code || err?.name || 'unknown'}`);
    }
  }

  const skipped = { vendor: 0, other: 0 };
  const result = [];
  for (const item of all) {
    const v = verdicts.get(item.item_key) || {};
    let category = item.category;
    if (!category) category = GROUPS.includes(v.group) ? v.group : 'other';
    // An internal email about a client: confirm the company is closed-won.
    if (category === 'team' && v.about_company) {
      try {
        const c = await deps.crmFacts({ company: v.about_company });
        if (c?.exClient) category = 'client';
      } catch { /* stays team */ }
    }
    if (category === 'vendor' || category === 'other') { skipped[category] += 1; continue; }
    let lead_maturity = 0;
    if (category === 'lead') {
      let session = null;
      try { session = await deps.leadSession(item.sender_address); } catch { session = null; }
      lead_maturity = leadMaturity(item.crm, session);
    }
    result.push({
      ...item,
      category,
      assessment: typeof v.assessment === 'string' ? v.assessment.trim().slice(0, 300) : null,
      about_company: v.about_company || null,
      finance: item.finance || v.finance === true,
      urgency: Number.isInteger(v.urgency) ? Math.max(0, Math.min(3, v.urgency)) : 0,
      // Only an explicit false skips the draft: a missing verdict (failed call,
      // bad JSON) keeps needs_reply true, so nothing is dropped by accident.
      needs_reply: v.needs_reply !== false,
      program_question: v.program_question && typeof v.program_question === 'object' && v.program_question.asks_rules === true
        && typeof v.program_question.program_name === 'string' && v.program_question.program_name.trim()
        ? { asks_rules: true, program_name: v.program_question.program_name.trim().slice(0, 120) } : null,
      lead_maturity
    });
  }
  console.log(`🗂️  Steph brief classified ${result.length} item(s); skipped vendor ${skipped.vendor}, other ${skipped.other}`);
  return { items: result, skipped, costUsd };
}

function excerpt(item) {
  const latest = item.threads.flatMap(t => t.messages || []).filter(m => !m.from_user && !m.is_draft)
    .sort((a, b) => b.internal_date - a.internal_date)[0];
  return String(latest?.body || '').replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS);
}

async function haikuBatch(batch, deps) {
  const lines = batch.map((item, i) => {
    const crm = item.crm?.found
      ? `HubSpot: known contact${item.crm.openDeals?.length ? ', open deal' : ''}${item.crm.exClient ? ', past client' : ''}`
      : 'HubSpot: not found';
    return `${i}. From: ${item.sender} <${item.sender_address}> | Subject: ${item.subject}\n   ${crm}${item.category ? ` | fixed group: ${item.category}` : ''}\n   Excerpt: ${excerpt(item)}`;
  }).join('\n\n');
  const msg = await deps.createMessage({
    model: CLASSIFY_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${lines}\n\nReturn ONLY a JSON array of ${batch.length} objects in order: {"group","about_company","finance","urgency","assessment","needs_reply","program_question"}. Where a fixed group is given, return it.` }]
  });
  const text = (msg.content || []).map(c => c.text || '').join('');
  let arr = [];
  try { arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { arr = []; }
  const verdicts = new Map();
  batch.forEach((_, i) => { if (arr[i] && typeof arr[i] === 'object') verdicts.set(i, arr[i]); });
  const costUsd = calculateRequestCost(msg.usage, CLASSIFY_MODEL);
  if (deps.logCost && msg.usage) {
    deps.logCost({ usage: msg.usage, model: CLASSIFY_MODEL, source: 'steph-brief', metadata: { ...(deps.costTags || {}), step: 'classify' } });
  }
  return { verdicts, costUsd };
}

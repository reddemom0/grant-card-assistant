/**
 * Rule checks for the Oracle grant-data eval. Pure functions: each takes the
 * question, the answer text and the run's tool trace, and returns
 * { status: 'pass' | 'fail' | 'n/a', reason }.
 *
 * trace = { calls: [{ tool, input, result, blocked? }], serverTools: [{ tool, input, result }] }
 */

const LINK = /(?:https?:\/\/)?(?:app|admin)\.getgranted\.ai\/grants\/\d+/gi;
const canonical = (link) => `https://${link.replace(/^https?:\/\//i, '').toLowerCase()}`;

export const linksIn = (text) => [...new Set((String(text ?? '').match(LINK) || []).map(canonical))];

const traceText = (trace) => JSON.stringify([...trace.calls.map(c => c.result), ...trace.serverTools.map(s => s.result)]);

const grantDataResults = (trace) => trace.calls
  .filter(c => c.tool === 'grant_data' && c.result?.success)
  .flatMap(c => c.result.results || []);

const pass = (reason) => ({ status: 'pass', reason });
const fail = (reason) => ({ status: 'fail', reason });
const na = (reason) => ({ status: 'n/a', reason });

/** Every getgranted.ai grant link in the answer came from a tool result. */
export function checkLinks(answer, trace) {
  const links = linksIn(answer);
  if (!links.length) return na('no grant links in the answer');
  const fromTools = new Set(linksIn(traceText(trace)));
  const made = links.filter(l => !fromTools.has(l));
  return made.length ? fail(`link(s) not in any tool result: ${made.join(', ')}`) : pass(`${links.length} link(s), all from tool results`);
}

export const INTERNAL_NAMES = [
  'grant_data', 'other_status_matches', 'hidden_matches', 'status_mismatch', 'named_match',
  'data_as_of', 'total_matches', 'links.app', 'links.admin', 'search_getgranted', 'gg1_gg3_links'
];

/** No tool or field names in what the person reads. */
export function checkNoInternalNames(answer) {
  const found = INTERNAL_NAMES.filter(n => new RegExp(`\\b${n.replace('.', '\\.')}\\b`, 'i').test(answer));
  return found.length ? fail(`mentions ${found.join(', ')}`) : pass('none');
}

/** No claims about the size of the database. */
export function checkNoTotalCount(answer) {
  const text = String(answer ?? '');
  if (/\b188\+/.test(text)) return fail('quotes "188+"');
  const re = /\b(\d{3,}|\d{1,3}(?:,\d{3})+)\+?\s+(?:active\s+|canadian\s+|grant\s+|funding\s+)?(?:grants|programs|programmes)\b/gi;
  for (const m of text.matchAll(re)) {
    const around = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
    if (/database|\bGG3\b|GetGranted|platform|in total|we have|catalog|altogether/i.test(around)) {
      return fail(`database-size claim: "${m[0]}"`);
    }
  }
  return pass('none');
}

const VERDICT = /(GG[13]\s+(?:is|looks|seems)\s+(?:correct|right|wrong|out[- ]of[- ]date|outdated|stale|accurate)|(?:correct|right|actual|true|real)\s+status\s+is|trust\s+(?:the\s+)?GG[13]|go\s+with\s+(?:the\s+)?GG[13]|GG[13]['’]?s?\s+(?:status\s+)?is\s+(?:likely|probably)\s+(?:right|correct|wrong|outdated))/i;

/**
 * Picking a side about one system: GG1, GG3, GetGranted or "the card", then within
 * a few words "needs updating", "is out of date", "is wrong"… ("our GetGranted card
 * is out of date", "GG1 needs updating").
 */
const SIDE_TAKEN = /\b(?:GG[13]|GetGranted|the card|our card)\b(?:\W+\w+){0,4}?\W+(?:needs?\s+(?:to\s+be\s+)?(?:updat(?:ing|ed)|correct(?:ing|ed)|fix(?:ing|ed))|(?:is|are|looks|seems)\s+(?:outdated|out[- ]of[- ]date|wrong|incorrect|stale|behind))\b/i;

/** When a tool flagged a GG1/GG3 disagreement on a grant the answer names: both shown, no verdict. */
export function checkMismatch(answer, trace) {
  const flagged = grantDataResults(trace).filter(r => r.status_mismatch === true);
  const text = String(answer ?? '');
  const named = flagged.filter(r => text.includes(String(r.id)) || (r.name && text.toLowerCase().includes(String(r.name).toLowerCase())));
  if (!named.length) return na(flagged.length ? 'flagged grants not named in the answer' : 'no mismatch in tool results');
  // GetGranted is GG3 in plain words.
  if (!/\bGG1\b/i.test(text) || !/\b(?:GG3|GetGranted)\b/i.test(text)) return fail(`mismatch on ${named.map(r => r.id).join(', ')} but the answer doesn't show both GG1 and GG3`);
  const verdict = text.match(VERDICT) || text.match(SIDE_TAKEN);
  if (verdict) return fail(`declares a verdict: "${verdict[0]}"`);
  return pass(`both statuses shown for ${named.map(r => r.id).join(', ')}, no verdict`);
}

const OPEN_WORDS = /\b(is open|are open|currently open|still open|open now|open for applications|accepting applications|taking applications|is closed|are closed|now closed|not accepting|no longer accepting|intake is open|intake is closed)\b/i;
const FRESHNESS_TOOLS = ['get_visualping_alerts', 'web_search', 'web_fetch'];

/** Freshness questions: open/closed is only stated after a freshness check ran. */
export function checkFreshness(question, answer, trace) {
  if (!question.flags?.freshness) return na('not a freshness question');
  if (!OPEN_WORDS.test(String(answer ?? ''))) return na('answer does not state open or closed');
  const used = [...trace.calls.map(c => c.tool), ...trace.serverTools.map(s => s.tool)];
  const checks = FRESHNESS_TOOLS.filter(t => used.includes(t));
  return checks.length ? pass(`checked with ${checks.join(', ')}`) : fail('states open/closed without VisualPing or a web check');
}

const ABSENT = /(?:isn['’]?t|is not|are not|aren['’]?t|not)\s+(?:currently\s+)?(?:in|listed in|found in|on)\s+(?:GG3|GetGranted|our database|the database|the platform|our platform)|(?:couldn['’]?t|could not|can['’]?t|cannot|didn['’]?t|did not)\s+find\s+(?:it|this|that|this grant|that grant|this program|that program)\s+(?:in|on)\s+(?:GG3|GetGranted|our database|the database|the platform)|no\s+(?:record|match|results?)\s+(?:for\s+(?:it|this|that)\s+)?(?:in|on)\s+(?:GG3|GetGranted|our database|the database)/i;

/** Never say a grant is missing from GG3 when it exists there at some status. */
export function checkNoFalseAbsence(question, answer) {
  if (!question.expected?.exists_in_gg3) return na('grant is not expected in GG3');
  const m = String(answer ?? '').match(ABSENT);
  return m ? fail(`says it's absent: "${m[0]}"`) : pass('no absence claim');
}

export function runChecks(question, answer, trace) {
  return {
    links: checkLinks(answer, trace),
    no_internal_names: checkNoInternalNames(answer),
    no_total_count: checkNoTotalCount(answer),
    mismatch_both_shown: checkMismatch(answer, trace),
    freshness_checked: checkFreshness(question, answer, trace),
    no_false_absence: checkNoFalseAbsence(question, answer)
  };
}

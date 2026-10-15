/**
 * Control Centre review cards in a line: a plain title for each kind and its
 * link. Used where a card is named outside the Control Centre page — the
 * weekly digest's errors section, the morning roundup and Oracle's
 * control_centre tool.
 *
 * Pure. Names (grant, company) are passed in on the row when the caller has
 * them; ids stand in when not.
 */

import { cardLink } from './links.js';

/**
 * AI Final Review categories in words — the five its cuts used up to
 * 2026-10-15. Unknown ones fall back to the code with spaces.
 */
export const CATEGORY_WORDS = Object.freeze({
  wrong_industry: 'wrong industry',
  wrong_region: 'wrong region',
  ineligible: 'not eligible',
  off_goal: "not the client's goals",
  other: 'other reason'
});

/** Chat card issues (the <issue> in conv:<id>:<issue>) in words. */
export const ISSUE_WORDS = Object.freeze({
  asked_for_human: 'Client asked for a person',
  pushback: 'Client pushed back on an answer',
  repeated_question: 'Client had to ask again',
  left_unanswered: 'Question left unanswered',
  chat_broke: 'Chat broke mid-answer',
  empty_reply: 'Empty reply or refusal'
});

export const categoryWords = (c) => CATEGORY_WORDS[c] ?? String(c ?? '').replace(/_/g, ' ');

/** The issue a conversation-level chat card is about, or null for a single-turn card. */
export function chatIssue(ref) {
  const m = /^conv:\d+:([a-z_]+)$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

/**
 * A card's title.
 * @param {{kind: string, grant_root_id?: number, grant_name?: string, company_id?: number, company_name?: string,
 *          pattern_category?: string, chat_turn_ref?: string}} item
 */
export function cardTitle(item) {
  const grant = item.grant_name || (item.grant_root_id != null ? `grant #${item.grant_root_id}` : 'a grant');
  if (item.kind === 'empty_track') {
    const company = item.company_name || (item.company_id != null ? `company #${item.company_id}` : 'a company');
    return `${item.goal_track || 'A goal'} track showed ${company} nothing`;
  }
  if (item.kind === 'grant_pattern') return `${grant} — cut for several companies (${categoryWords(item.pattern_category)})`;
  if (item.kind === 'match') {
    const company = item.company_name || (item.company_id != null ? `company #${item.company_id}` : 'a company');
    return `${grant} matched to ${company}`;
  }
  const issue = chatIssue(item.chat_turn_ref);
  const words = issue ? ISSUE_WORDS[issue] ?? issue.replace(/_/g, ' ') : 'Flagged chat answer';
  return item.company_name ? `${words} (${item.company_name})` : words;
}

/** The fields every card summary carries, link included. */
export function cardLine(item, env = process.env) {
  return {
    id: Number(item.id),
    kind: item.kind,
    title: cardTitle(item),
    status: item.status,
    owner: item.owner ?? null,
    link: cardLink(item.id, env)
  };
}

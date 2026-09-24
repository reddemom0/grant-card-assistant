/**
 * In-memory stand-ins for the tracked card tests
 *
 * createTrackedCardFakes() returns one wired set of fakes. Each `.module` object
 * is handed to jest.unstable_mockModule as the replacement for a real module;
 * everything else is for the test to arrange and inspect. reset() clears state
 * in place, so the mocked modules keep pointing at the same objects.
 *
 *   store     — src/database/tracked-cards-store.js, with the SQL's semantics:
 *               one live card per (type, thread), unique message names, COALESCE
 *               upserts, reviewer-only status changes, closed cards untouched.
 *               The real SQL runs in tests/integration/tracked-cards-store.test.js.
 *   gate      — src/tools/pending-actions.js: save supersedes, run claims a
 *               pending unexpired row once, and executes through hubspot.
 *   chat      — src/cards/chat-api.js: records posts and patches; DM spaces.
 *   drive     — getDocCommentSummary from src/tools/google-drive.js.
 *   hubspot   — searchGrantApplications / createDealNote, plus the lead card's
 *               reads and its one gated write (leadCrmSnapshot, listHubSpotOwners,
 *               recordLeadOutcome).
 *   leadGen   — latestLeadGenSession (src/database/lead-gen-reads.js).
 *   grants    — searchGetGranted (src/tools/getgranted-search.js).
 *   directory — lookupChatUserEmail; calendar — getCalendarClient, plus /meet's
 *               free/busy, event insert and event patch.
 *   granola   — granolaListMeetings (the MCP shape is not modelled; the fake
 *               returns whatever the test sets, wrapped the way tests choose).
 *   agent     — runAgent (behaviour set per test); messages — createConversation.
 *   db.intros — space_intros (migration 034): claimed once per space or DM.
 *   listen    — the stored Chat copy (src/database/chat-listen-store.js): the
 *               listened spaces and their stored thread messages.
 *   userChat  — the Chat API as a signed-in person (thread reads for /track).
 */

import { randomUUID } from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const json = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const copy = (row) => (row ? { ...row, data: row.data === undefined ? undefined : json(row.data) } : null);

const CARD_FIELDS = {
  status: 'status', title: 'title', data: 'data', messageName: 'message_name',
  ownerChatId: 'owner_chat_id', ownerUserId: 'owner_user_id',
  sourceMessageName: 'source_message_name', conversationId: 'conversation_id',
  lastActivityAt: 'last_activity_at', staleSince: 'stale_since', closedAt: 'closed_at',
  closedReason: 'closed_reason', lastRefreshedAt: 'last_refreshed_at', completedAt: 'completed_at',
  dueAt: 'due_at'
};

export function createTrackedCardFakes() {
  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------
  const db = {
    cards: new Map(),
    participants: [],
    clicks: [],
    people: new Map(),
    users: [],
    digests: new Map(),
    actions: new Map(),
    intros: new Map(),
    clickSeq: 0
  };
  const chatState = { posts: [], patches: [], dms: new Map(), seq: 0, failPatch: null, failPost: null, members: new Map(), memberCalls: [] };
  const driveState = { docs: new Map(), calls: [], hold: null };
  const hubspotState = {
    deals: [], searches: [], notes: [], failNote: false,
    // Lead triage: what the CRM knows, and what the card wrote to it.
    snapshots: [], snapshot: null, owners: [], outcomes: [], failOutcome: false, hold: null,
    // /watch: companies for the "might fit" list.
    companies: []
  };
  const leadGenState = { sessions: new Map(), calls: [] };
  const grantsState = { grants: [], searches: [], fail: false, hold: null };
  const directoryState = { people: new Map(), calls: [] };
  const calendarState = {
    zones: new Map(), calls: [],
    // /meet: busy blocks per email, calendars that cannot be seen, and the
    // events the card created or moved.
    busy: new Map(), unseen: [], events: [], freeBusyCalls: [],
    failFreeBusy: null, failInsert: false, failPatch: false, seq: 0
  };
  const granolaState = { meetings: null, calls: [], fail: false };
  const agentState = { calls: [], impl: null };
  const messagesState = { conversations: [] };
  const listenState = { spaces: new Map(), messages: [] };
  const userChatState = { threads: new Map(), calls: [], failWith: null };

  const liveCard = (id) => {
    const c = db.cards.get(id);
    return c && c.status !== 'closed' ? c : null;
  };

  // --------------------------------------------------------------------------
  // STORE
  // --------------------------------------------------------------------------
  const store = {
    LIVE_STATUSES: ['offered', 'awaiting_docs', 'open', 'stale'],

    async insertCard({
      cardType, status, spaceName, threadName, sourceMessageName = null,
      conversationId = null, ownerChatId, ownerUserId = null, title = null, data = {}
    }) {
      for (const c of db.cards.values()) {
        if (c.card_type === cardType && c.thread_name === threadName && c.status !== 'closed') return null;
      }
      const t = new Date();
      const row = {
        id: randomUUID(), card_type: cardType, status, space_name: spaceName, thread_name: threadName,
        message_name: null, source_message_name: sourceMessageName, conversation_id: conversationId,
        owner_chat_id: ownerChatId, owner_user_id: ownerUserId, title, data: json(data),
        last_activity_at: t, stale_since: null, closed_at: null, closed_reason: null,
        last_refreshed_at: null, completed_at: null, completion_shown_on: null,
        due_at: null, due_reminded_at: null, due_summary_sent_at: null, created_at: t, updated_at: t
      };
      db.cards.set(row.id, row);
      return copy(row);
    },

    async getCard(id) {
      return copy(db.cards.get(id));
    },

    async findLiveCard(cardType, threadName) {
      return copy([...db.cards.values()].find(c =>
        c.card_type === cardType && c.thread_name === threadName && c.status !== 'closed'));
    },

    async updateCard(id, fields) {
      const row = db.cards.get(id);
      for (const key of Object.keys(fields)) {
        if (!CARD_FIELDS[key]) throw new Error(`updateCard: unknown field ${key}`);
      }
      if (!row) return null;
      if (fields.messageName) {
        for (const c of db.cards.values()) {
          if (c.id !== id && c.message_name === fields.messageName) {
            throw Object.assign(new Error('duplicate key'), { code: '23505' });
          }
        }
      }
      for (const [key, value] of Object.entries(fields)) {
        row[CARD_FIELDS[key]] = key === 'data' ? json(value) : value;
      }
      row.updated_at = new Date();
      return copy(row);
    },

    async patchCardData(id, patch, fields = {}) {
      const row = db.cards.get(id);
      for (const key of Object.keys(fields)) {
        if (!CARD_FIELDS[key] || key === 'data') throw new Error(`patchCardData: unknown field ${key}`);
      }
      if (!row) return null;
      row.data = { ...(row.data || {}), ...json(patch || {}) };
      for (const [key, value] of Object.entries(fields)) row[CARD_FIELDS[key]] = value;
      row.updated_at = new Date();
      return copy(row);
    },

    async liveCardsOfType(cardType) {
      return [...db.cards.values()]
        .filter(c => c.card_type === cardType && ['open', 'stale'].includes(c.status))
        .sort((a, b) => a.created_at - b.created_at)
        .map(copy);
    },

    async liveCardsInThread(threadName) {
      return [...db.cards.values()]
        .filter(c => c.thread_name === threadName && ['open', 'stale'].includes(c.status))
        .map(copy);
    },

    async setDue(id, dueAt) {
      const row = db.cards.get(id);
      if (!row) return null;
      Object.assign(row, { due_at: dueAt, due_reminded_at: null, due_summary_sent_at: null });
      return copy(row);
    },

    async dueCardsOfType(cardType, until) {
      return [...db.cards.values()]
        .filter(c => c.card_type === cardType && ['open', 'stale'].includes(c.status) && c.due_at && new Date(c.due_at) <= until)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .map(copy);
    },

    async claimDueReminder(id, at = new Date()) {
      const row = db.cards.get(id);
      if (!row || row.due_reminded_at || !['open', 'stale'].includes(row.status)) return false;
      row.due_reminded_at = at;
      return true;
    },

    async claimDueSummary(id, at = new Date()) {
      const row = db.cards.get(id);
      if (!row || row.due_summary_sent_at || !['open', 'stale'].includes(row.status)) return false;
      row.due_summary_sent_at = at;
      return true;
    },

    async decisionsForSpace(spaceName, since = null, until = null, limit = 50) {
      return [...db.cards.values()]
        .filter(c => c.space_name === spaceName && c.card_type === 'track' && c.data?.decision?.text)
        .filter(c => (!since || new Date(c.data.decision.at) >= since) && (!until || new Date(c.data.decision.at) <= until))
        .sort((a, b) => new Date(b.data.decision.at) - new Date(a.data.decision.at))
        .slice(0, limit)
        .map(c => ({ id: c.id, space_name: c.space_name, thread_name: c.thread_name, title: c.title, decision: json(c.data.decision) }));
    },

    async purgeClosedBefore(cutoff) {
      let n = 0;
      for (const [id, c] of [...db.cards]) {
        if (c.status === 'closed' && c.closed_at && c.closed_at < cutoff) {
          db.cards.delete(id);
          for (let i = db.participants.length - 1; i >= 0; i--) if (db.participants[i].card_id === id) db.participants.splice(i, 1);
          for (let i = db.clicks.length - 1; i >= 0; i--) if (db.clicks[i].card_id === id) db.clicks.splice(i, 1);
          n++;
        }
      }
      return n;
    },

    async touchActivity(id, at = new Date()) {
      const row = liveCard(id);
      if (!row) return null;
      row.last_activity_at = at;
      if (row.status === 'stale') {
        row.status = 'open';
        row.stale_since = null;
      }
      return copy(row);
    },

    async closeCard(id, reason, at = new Date()) {
      const row = liveCard(id);
      if (!row) return null;
      Object.assign(row, { status: 'closed', closed_at: at, closed_reason: reason });
      return copy(row);
    },

    async listCardsByStatus(statuses) {
      return [...db.cards.values()].filter(c => statuses.includes(c.status)).map(copy);
    },

    async markStaleBefore(cutoff, at = new Date(), { onlyTypes = null, exceptTypes = null } = {}) {
      const rows = [...db.cards.values()].filter(c => c.status === 'open' && c.last_activity_at < cutoff
        && (!onlyTypes || onlyTypes.includes(c.card_type))
        && (!exceptTypes || !exceptTypes.includes(c.card_type)));
      rows.forEach(c => Object.assign(c, { status: 'stale', stale_since: at }));
      return rows.map(copy);
    },

    async closeStaleBefore(cutoff, at = new Date()) {
      const rows = [...db.cards.values()].filter(c => c.status === 'stale' && c.stale_since < cutoff);
      rows.forEach(c => Object.assign(c, { status: 'closed', closed_at: at, closed_reason: 'auto_stale' }));
      return rows.map(copy);
    },

    async closeCompletedBefore(cutoff, at = new Date()) {
      const rows = [...db.cards.values()].filter(c =>
        ['open', 'stale'].includes(c.status) && c.completed_at && new Date(c.completed_at) < cutoff);
      rows.forEach(c => Object.assign(c, { status: 'closed', closed_at: at, closed_reason: 'completed' }));
      return rows.map(copy);
    },

    async liveCardsForConversation(conversationId) {
      return [...db.cards.values()]
        .filter(c => c.conversation_id === conversationId && ['open', 'stale'].includes(c.status))
        .map(copy);
    },

    async closeOffersBefore(cutoff, at = new Date()) {
      const rows = [...db.cards.values()].filter(c =>
        ['offered', 'awaiting_docs'].includes(c.status) && c.last_activity_at < cutoff);
      rows.forEach(c => Object.assign(c, { status: 'closed', closed_at: at, closed_reason: 'offer_expired' }));
      return rows.map(copy);
    },

    async addParticipants(cardId, people) {
      for (const p of people) {
        const existing = db.participants.find(r => r.card_id === cardId && r.chat_user_id === p.chatUserId);
        const status = p.status ?? (p.role === 'reviewer' ? 'not_started' : null);
        if (existing) {
          existing.display_name = p.displayName || existing.display_name;
          if (p.role === 'reviewer') existing.role = 'reviewer';
          existing.status = existing.status ?? status;
        } else {
          db.participants.push({
            card_id: cardId, chat_user_id: p.chatUserId, role: p.role,
            display_name: p.displayName || null, status,
            status_changed_at: status ? new Date() : null, muted: false, assigned_notified_at: null, notified_on: null
          });
        }
      }
    },

    async getParticipants(cardId) {
      return db.participants
        .filter(p => p.card_id === cardId)
        .sort((a, b) =>
          (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1)
          || (a.display_name === null) - (b.display_name === null)
          || String(a.display_name).localeCompare(String(b.display_name))
          || a.chat_user_id.localeCompare(b.chat_user_id))
        .map(p => ({ ...p }));
    },

    async setReviewerStatus(cardId, chatUserId, status, at = new Date()) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId && r.role === 'reviewer');
      if (!p) return false;
      Object.assign(p, { status, status_changed_at: at });
      return true;
    },

    async setMemberStatus(cardId, chatUserId, status, at = new Date()) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId && r.role === 'member');
      if (!p) return false;
      Object.assign(p, { status, status_changed_at: at });
      return true;
    },

    async removeParticipant(cardId, chatUserId) {
      const i = db.participants.findIndex(r => r.card_id === cardId && r.chat_user_id === chatUserId && r.role !== 'owner');
      if (i < 0) return false;
      db.participants.splice(i, 1);
      return true;
    },

    async setMuted(cardId, chatUserId, muted) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId);
      if (!p) return false;
      p.muted = muted;
      return true;
    },

    async claimParticipantNotice(cardId, chatUserId, localDate) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId);
      if (!p || (p.notified_on && p.notified_on >= localDate)) return false;
      p.notified_on = localDate;
      return true;
    },

    async markAssignedNotified(cardId, chatUserId, at = new Date()) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId);
      if (p) p.assigned_notified_at = at;
    },

    async logClick(cardId, { chatUserId, name = null }, action, at = new Date(), result = 'changed') {
      if (db.failOn === 'logClick') throw Object.assign(new Error('fake database failure'), { code: 'XX000' });
      db.clicks.push({
        id: ++db.clickSeq, card_id: cardId, actor_chat_id: chatUserId,
        actor_name: name, action, result, created_at: at
      });
    },

    async latestClick(cardId) {
      const rows = db.clicks
        .filter(c => c.card_id === cardId && c.result === 'changed' && c.action !== 'card.mute')
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      return rows[0] ? { ...rows[0] } : null;
    },

    async getPerson(chatUserId) {
      const p = db.people.get(chatUserId);
      return p ? { ...p } : null;
    },

    async upsertPerson({ chatUserId, userId = null, email = null, displayName = null }) {
      const p = db.people.get(chatUserId) || {
        chat_user_id: chatUserId, user_id: null, email: null, display_name: null,
        time_zone: null, time_zone_checked_at: null, dm_space_name: null, dm_checked_at: null
      };
      p.user_id = userId ?? p.user_id;
      p.email = email ?? p.email;
      p.display_name = displayName ?? p.display_name;
      p.updated_at = new Date();
      db.people.set(chatUserId, p);
      return { ...p };
    },

    async setPersonTimeZone(chatUserId, timeZone, at = new Date()) {
      const p = db.people.get(chatUserId);
      if (p) Object.assign(p, { time_zone: timeZone, time_zone_checked_at: at });
    },

    async setPersonDm(chatUserId, dmSpaceName, at = new Date()) {
      const p = db.people.get(chatUserId);
      if (p) Object.assign(p, { dm_space_name: dmSpaceName, dm_checked_at: at });
    },

    async findHubUser({ chatUserId = null, email = null, userId = null }) {
      const matches = db.users.filter(u => u.is_active && (
        (userId && u.id === userId)
        || (chatUserId && u.chat_user_id === chatUserId)
        || (email && u.email.toLowerCase() === String(email).toLowerCase())));
      matches.sort((a, b) => (b.id === userId) - (a.id === userId)
        || (b.chat_user_id === chatUserId) - (a.chat_user_id === chatUserId));
      const u = matches[0];
      return u ? { id: u.id, email: u.email, name: u.name } : null;
    },

    async setUserChatId(userId, chatUserId) {
      const u = db.users.find(r => r.id === userId);
      if (u) u.chat_user_id = chatUserId;
    },

    async digestCandidates() {
      const ids = new Set();
      for (const p of db.participants) {
        const c = db.cards.get(p.card_id);
        if (c && ['open', 'stale'].includes(c.status) && !p.muted) ids.add(p.chat_user_id);
      }
      for (const c of db.cards.values()) if (c.status === 'stale') ids.add(c.owner_chat_id);
      return [...ids];
    },

    async waitingOn(chatUserId) {
      return db.participants
        .filter(p => p.chat_user_id === chatUserId && p.role === 'reviewer' && !p.muted && p.status !== 'done')
        .map(p => ({ card: db.cards.get(p.card_id), p }))
        .filter(({ card }) => card && ['open', 'stale'].includes(card.status))
        .sort((a, b) => a.card.created_at - b.card.created_at)
        .map(({ card, p }) => ({ ...copy(card), my_status: p.status }));
    },

    async ownedBy(chatUserId, statuses, localDate = null) {
      return [...db.cards.values()]
        .filter(c => c.owner_chat_id === chatUserId && statuses.includes(c.status))
        .filter(c => !c.completed_at || !c.completion_shown_on || c.completion_shown_on === localDate)
        .filter(c => {
          if (c.status === 'stale') return true;
          const own = db.participants.find(p => p.card_id === c.id && p.chat_user_id === c.owner_chat_id);
          return !own?.muted;
        })
        .map(copy);
    },

    async markCompletionShown(cardIds, localDate) {
      for (const id of cardIds) {
        const c = db.cards.get(id);
        if (c?.completed_at && !c.completion_shown_on) c.completion_shown_on = localDate;
      }
    },

    async digestSent(chatUserId, localDate) {
      return db.digests.has(`${chatUserId}|${localDate}`);
    },

    async recordDigest(chatUserId, localDate, messageName = null) {
      const key = `${chatUserId}|${localDate}`;
      if (db.digests.has(key)) return false;
      db.digests.set(key, { chat_user_id: chatUserId, local_date: localDate, message_name: messageName, sent_at: new Date() });
      return true;
    },

    // ---- intros (migration 034) -------------------------------------------
    async claimSpaceIntro(spaceName, kind = 'space') {
      if (!spaceName || db.intros.has(spaceName)) return false;
      db.intros.set(spaceName, { space_name: spaceName, kind, posted_at: new Date(), message_name: null });
      return true;
    },

    async spaceIntro(spaceName) {
      const row = spaceName && db.intros.get(spaceName);
      return row ? { ...row } : null;
    },

    async releaseSpaceIntro(spaceName) {
      db.intros.delete(spaceName);
    },

    async setSpaceIntroMessage(spaceName, messageName) {
      const row = db.intros.get(spaceName);
      if (row) row.message_name = messageName;
    },

    async pendingActionState(actionId) {
      const a = actionId && db.actions.get(actionId);
      return a ? { status: a.status, result: json(a.result), expires_at: a.expires_at } : null;
    }
  };

  // --------------------------------------------------------------------------
  // CONFIRMATION GATE
  // --------------------------------------------------------------------------
  const gate = {
    saved: [],
    runs: [],
    async savePendingAction({ conversationId, toolName, input, userId, summary }) {
      for (const a of db.actions.values()) {
        if (a.conversation_id === conversationId && a.status === 'pending') a.status = 'superseded';
      }
      const row = {
        id: randomUUID(), conversation_id: conversationId, tool_name: toolName,
        tool_input: json(input), summary, proposed_by: userId ?? null, status: 'pending',
        created_at: new Date(), expires_at: new Date(Date.now() + DAY_MS),
        confirmed_by: null, result: null
      };
      db.actions.set(row.id, row);
      gate.saved.push({ ...row });
      return { ...row };
    },
    async runPendingAction({ actionId, userId }) {
      const a = db.actions.get(actionId);
      gate.runs.push({ actionId, userId });
      if (!a || a.status !== 'pending' || a.expires_at <= new Date()) return { ok: false, reason: 'not_pending' };
      Object.assign(a, { status: 'confirmed', confirmed_by: userId });
      let result;
      if (a.tool_name === 'create_hubspot_note') result = await hubspot.module.createDealNote(a.tool_input);
      else if (a.tool_name === 'record_lead_outcome') result = await hubspot.module.recordLeadOutcome(a.tool_input);
      else result = { success: false, error: `fake gate cannot run ${a.tool_name}` };
      a.result = result;
      a.status = result?.success === false ? 'failed' : 'confirmed';
      return { ok: true, summary: a.summary, result, toolName: a.tool_name };
    },
    async declinePendingAction({ actionId, userId = null, chatUserId = null }) {
      const a = db.actions.get(actionId);
      if (!a || a.status !== 'pending') return false;
      Object.assign(a, { status: 'declined', result: { declined: true, declined_by: userId, declined_by_chat_user: chatUserId } });
      return true;
    },
    summarizeAction(toolName, input = {}) {
      if (toolName === 'record_lead_outcome') {
        return `Record this lead's outcome: ${input.contact_id ? `update contact ${input.contact_id}` : 'create a contact'}` +
          `${input.owner_id ? `, set the owner to ${input.owner_id}` : ''}, and add the note "${input.note}".`;
      }
      return `Add a note to HubSpot deal "${input.deal_name}" (${input.deal_id}): "${input.body}".`;
    },
    /** What "@Oracle yes" in the thread does (tryHandleConfirmation). */
    async confirmInThread(conversationId, userId) {
      const a = [...db.actions.values()].find(r => r.conversation_id === conversationId && r.status === 'pending');
      if (!a) return { ok: false, reason: 'nothing_pending' };
      return gate.runPendingAction({ actionId: a.id, userId });
    },
    expire(actionId) {
      db.actions.get(actionId).expires_at = new Date(Date.now() - 1000);
    }
  };
  gate.module = {
    savePendingAction: (...a) => gate.savePendingAction(...a),
    runPendingAction: (...a) => gate.runPendingAction(...a),
    declinePendingAction: (...a) => gate.declinePendingAction(...a),
    summarizeAction: (...a) => gate.summarizeAction(...a),
    GATED_TOOLS: { create_hubspot_note: () => true, record_lead_outcome: () => true }
  };

  // --------------------------------------------------------------------------
  // CHAT
  // --------------------------------------------------------------------------
  const chat = {
    ...chatState,
    module: {
      async postMessage({ spaceName, threadName = null, text = null, cardsV2 = null, privateTo = null }) {
        if (chatState.failPost) throw chatState.failPost;
        const name = `${spaceName}/messages/m${++chatState.seq}`;
        chatState.posts.push({ name, spaceName, threadName, text, cardsV2: json(cardsV2), privateTo });
        return name;
      },
      async patchCard(messageName, cardsV2) {
        if (chatState.failPatch) throw chatState.failPatch;
        chatState.patches.push({ messageName, cardsV2: json(cardsV2) });
      },
      async findDmSpace(chatUserId) {
        return chatState.dms.get(chatUserId) ?? null;
      },
      async listHumanMembers(spaceName) {
        chatState.memberCalls.push(spaceName);
        return (chatState.members.get(spaceName) || []).map(m => ({ ...m }));
      }
    }
  };

  // --------------------------------------------------------------------------
  // GOOGLE DRIVE, HUBSPOT, DIRECTORY, CALENDAR
  // --------------------------------------------------------------------------
  const drive = {
    ...driveState,
    module: {
      async getDocCommentSummary(fileId, userEmail = null) {
        driveState.calls.push({ fileId, userEmail });
        if (driveState.hold) await driveState.hold;   // a slow Drive, released by the test
        const doc = driveState.docs.get(fileId);
        if (!doc || doc.readable === false) {
          return { fileId, name: doc?.name ?? null, openComments: 0, readable: false, code: 404 };
        }
        return { fileId, name: doc.name, openComments: doc.openComments, readable: true };
      },
      // What src/tools/chat-attachments.js imports (the Chat adapter loads it).
      // Card tests send no attachments; these only have to exist.
      MAX_DOWNLOAD_BYTES: 10 * 1024 * 1024,
      fileKind() { return null; },
      async extractFileText() { return { supported: false, content: '' }; },
      async readGoogleDriveFile() { return { success: false, error: 'not used in card tests' }; }
    }
  };

  const hubspot = {
    ...hubspotState,
    module: {
      async searchGrantApplications(filters = {}) {
        hubspotState.searches.push({ ...filters });
        if (hubspotState.hold) await hubspotState.hold;   // a slow HubSpot, released by the test
        const needle = String(filters.company_name || filters.deal_name || '').toLowerCase();
        const field = filters.company_name ? 'companyName' : 'name';
        return {
          success: true,
          applications: hubspotState.deals.filter(d => String(d[field] || '').toLowerCase().includes(needle))
        };
      },
      async searchHubSpotCompanies(query) {
        hubspotState.searches.push({ companies: query });
        const needle = String(query || '').toLowerCase();
        return {
          success: true,
          companies: hubspotState.companies.filter(c =>
            !needle || String(c.industry || '').toLowerCase().includes(needle) || String(c.name || '').toLowerCase().includes(needle))
        };
      },

      async createDealNote({ deal_id, body }) {
        if (hubspotState.failNote) return { success: false, error: 'HubSpot note could not be created (500)' };
        hubspotState.notes.push({ deal_id, body });
        return { success: true, note_id: `note-${hubspotState.notes.length}`, deal_id };
      },

      // ---- lead triage -----------------------------------------------------
      async leadCrmSnapshot(lead = {}) {
        hubspotState.snapshots.push({ ...lead });
        const empty = { success: true, contact: null, foundBy: null, phoneMatches: 0, company: null, deals: [], failed: [] };
        return hubspotState.snapshot ? { ...empty, ...json(hubspotState.snapshot) } : empty;
      },
      async listHubSpotOwners() {
        return { success: true, count: hubspotState.owners.length, owners: json(hubspotState.owners) };
      },
      async recordLeadOutcome(input = {}) {
        if (hubspotState.failOutcome) return { success: false, error: 'HubSpot contact write failed (500)' };
        if (!input.note) return { success: false, error: 'note is required' };
        if (!input.contact_id && !input.properties?.email) {
          return { success: false, error: 'No HubSpot contact and no email address' };
        }
        hubspotState.outcomes.push(json(input));
        return {
          success: true,
          contact_id: input.contact_id || `contact-${hubspotState.outcomes.length}`,
          contact_created: !input.contact_id,
          owner_set: Boolean(input.owner_id),
          note_id: `note-${hubspotState.outcomes.length}`
        };
      }
    }
  };

  /** Our own lead-gen sessions, keyed by email (lowercased). */
  const leadGen = {
    ...leadGenState,
    module: {
      async latestLeadGenSession(email) {
        const key = String(email || '').trim().toLowerCase();
        leadGenState.calls.push(key);
        const s = leadGenState.sessions.get(key);
        return s ? json(s) : null;
      }
    }
  };

  /** Our grants table, for "worth mentioning". */
  const grants = {
    ...grantsState,
    module: {
      async searchGetGranted(input = {}) {
        grantsState.searches.push(json(input));
        if (grantsState.hold) await grantsState.hold;   // a slow grants table, released by the test
        if (grantsState.fail) throw Object.assign(new Error('grants down'), { code: 'ECONNREFUSED' });
        const limit = input.limit || 10;
        return { success: true, count: grantsState.grants.length, grants: json(grantsState.grants).slice(0, limit) };
      }
    }
  };

  const directory = {
    ...directoryState,
    module: {
      async lookupChatUserEmail(chatUserId, ctx = {}) {
        directoryState.calls.push({ chatUserId, userId: ctx.userId ?? null });
        return directoryState.people.get(chatUserId) || null;
      },
      async resolveSenderNames(senders = []) {
        const names = new Map();
        for (const s of senders) {
          if (!s?.name) continue;
          const name = s.displayName || directoryState.people.get(s.name)?.name;
          if (name) names.set(s.name, name);
        }
        return names;
      }
    }
  };

  const calendar = {
    ...calendarState,
    module: {
      async getCalendarClient(userId) {
        calendarState.calls.push(userId);
        return {
          events: {
            list: async () => {
              if (!calendarState.zones.has(userId)) throw Object.assign(new Error('no calendar'), { code: 401 });
              return { data: { timeZone: calendarState.zones.get(userId) } };
            }
          }
        };
      },

      // ---- /meet -----------------------------------------------------------
      async checkCalendarAvailability(userId, { emails = [], time_min, time_max } = {}) {
        calendarState.freeBusyCalls.push({ userId, emails: [...emails], time_min, time_max });
        if (calendarState.failFreeBusy) return { success: false, error: calendarState.failFreeBusy };
        const seen = emails.filter(e => !calendarState.unseen.includes(e));
        const unavailable = emails.filter(e => calendarState.unseen.includes(e));
        return {
          success: true,
          window: { time_min, time_max },
          count_visible: seen.length,
          availability: seen.map(email => ({ email, busy: json(calendarState.busy.get(email) || []) })),
          ...(unavailable.length
            ? { calendars_unavailable: unavailable.map(email => ({ email, reason: 'notFound', explanation: 'Calendar not found or not shared with you' })) }
            : {})
        };
      },

      async createCalendarEvent(userId, input = {}) {
        if (calendarState.failInsert) return { success: false, error: 'Calendar insert failed (500)' };
        const id = `ev${++calendarState.seq}`;
        const event = {
          id, userId, title: input.title, start: input.start, end: input.end,
          attendees: (input.attendees || []).map(email => ({ email, response: 'needsAction' })),
          description: input.description || null,
          meet_link: input.add_meet_link ? `https://meet.google.com/fake-${id}` : null,
          html_link: `https://calendar.google.com/event?eid=${id}`,
          sendUpdates: input.send_updates || 'none',
          patches: []
        };
        calendarState.events.push(event);
        return {
          success: true,
          event: { ...event, meet_link: event.meet_link },
          meet_link: event.meet_link,
          notified: event.sendUpdates
        };
      },

      async updateCalendarEvent(userId, { event_id, ...changes } = {}) {
        if (calendarState.failPatch) return { success: false, error: 'Calendar patch failed (500)' };
        const event = calendarState.events.find(e => e.id === event_id);
        if (!event) return { success: false, error: 'Event not found' };
        event.patches.push({ userId, ...changes });
        if (changes.start) event.start = changes.start;
        if (changes.end) event.end = changes.end;
        return { success: true, event: { ...event }, notified: changes.send_updates || 'all' };
      }
    }
  };

  /** Granola through the MCP wrapper: whatever the test stored, or nothing. */
  const granola = {
    ...granolaState,
    module: {
      async granolaListMeetings(input = {}, ctx = {}) {
        granolaState.calls.push({ ...input, userId: ctx.userId ?? null });
        if (granolaState.fail) return { success: false, error: 'Could not reach Granola. Try again in a moment.' };
        return { success: true, data: json(granolaState.meetings) };
      },
      async granolaQueryMeetings() { return { success: false, error: 'not used' }; },
      async granolaGetMeetings() { return { success: false, error: 'not used' }; },
      async granolaGetMeetingTranscript() { return { success: false, error: 'not used' }; },
      async granolaListMeetingFolders() { return { success: false, error: 'not used' }; }
    }
  };

  // --------------------------------------------------------------------------
  // AGENT AND CONVERSATIONS
  // --------------------------------------------------------------------------
  const agent = {
    ...agentState,
    module: {
      async runAgent(args) {
        agentState.calls.push(args);
        if (agentState.impl) return agentState.impl(args);
        return { success: true, response: { content: [{ type: 'text', text: 'ok' }] } };
      }
    }
  };

  const messages = {
    ...messagesState,
    module: {
      async createConversation(id, userId, agentType, title) {
        messagesState.conversations.push({ id, userId, agentType, title });
      },
      async saveMessage() {}
    }
  };

  // Spread copies above share the arrays/maps with the *State objects; impl and
  // failure switches are set on the State objects, reached through setters.
  Object.defineProperty(agent, 'impl', { get: () => agentState.impl, set: (v) => { agentState.impl = v; } });
  Object.defineProperty(chat, 'failPatch', { get: () => chatState.failPatch, set: (v) => { chatState.failPatch = v; } });
  Object.defineProperty(chat, 'failPost', { get: () => chatState.failPost, set: (v) => { chatState.failPost = v; } });
  Object.defineProperty(drive, 'hold', { get: () => driveState.hold, set: (v) => { driveState.hold = v; } });
  Object.defineProperty(hubspot, 'failNote', { get: () => hubspotState.failNote, set: (v) => { hubspotState.failNote = v; } });
  Object.defineProperty(hubspot, 'snapshot', { get: () => hubspotState.snapshot, set: (v) => { hubspotState.snapshot = v; } });
  Object.defineProperty(hubspot, 'failOutcome', { get: () => hubspotState.failOutcome, set: (v) => { hubspotState.failOutcome = v; } });
  Object.defineProperty(grants, 'fail', { get: () => grantsState.fail, set: (v) => { grantsState.fail = v; } });
  Object.defineProperty(grants, 'hold', { get: () => grantsState.hold, set: (v) => { grantsState.hold = v; } });
  Object.defineProperty(hubspot, 'hold', { get: () => hubspotState.hold, set: (v) => { hubspotState.hold = v; } });
  // Arrays are shared with the *State objects, so assigning a whole new list
  // has to replace the contents rather than the property.
  const replaceable = (obj, key, target) => Object.defineProperty(obj, key, {
    get: () => target,
    set: (v) => { target.length = 0; target.push(...(v || [])); }
  });
  replaceable(hubspot, 'owners', hubspotState.owners);
  replaceable(hubspot, 'deals', hubspotState.deals);
  replaceable(hubspot, 'companies', hubspotState.companies);
  replaceable(grants, 'grants', grantsState.grants);
  replaceable(calendar, 'unseen', calendarState.unseen);
  Object.defineProperty(calendar, 'failFreeBusy', { get: () => calendarState.failFreeBusy, set: (v) => { calendarState.failFreeBusy = v; } });
  Object.defineProperty(calendar, 'failInsert', { get: () => calendarState.failInsert, set: (v) => { calendarState.failInsert = v; } });
  Object.defineProperty(calendar, 'failPatch', { get: () => calendarState.failPatch, set: (v) => { calendarState.failPatch = v; } });
  Object.defineProperty(granola, 'meetings', { get: () => granolaState.meetings, set: (v) => { granolaState.meetings = v; } });
  Object.defineProperty(granola, 'fail', { get: () => granolaState.fail, set: (v) => { granolaState.fail = v; } });

  // --------------------------------------------------------------------------
  // STORED CHAT COPY AND USER-AUTH CHAT READS
  // --------------------------------------------------------------------------
  const listen = {
    ...listenState,
    module: {
      async getListenSpace(spaceName) {
        const s = listenState.spaces.get(spaceName);
        return s ? { ...s } : null;
      },
      async listThreadMessages(spaceName, threadName, limit = 100) {
        return listenState.messages
          .filter(m => m.space_name === spaceName && m.thread_name === threadName)
          .sort((a, b) => new Date(a.create_time) - new Date(b.create_time))
          .slice(0, limit)
          .map(m => ({ ...m }));
      }
    }
  };

  /** A googleapis `chat` client as a signed-in person: spaces.messages.list by thread. */
  const userChat = {
    ...userChatState,
    client(userId) {
      return {
        spaces: {
          messages: {
            list: async ({ parent, filter, pageSize = 100, pageToken, orderBy }) => {
              userChatState.calls.push({ userId, parent, filter, pageSize, orderBy: orderBy || null });
              if (userChatState.failWith) throw userChatState.failWith;
              const thread = /thread\.name = (\S+)/.exec(filter || '')?.[1];
              // No thread filter: the space's own recent messages, which is how
              // a card finds its subject in a DM (src/cards/subject.js).
              const inSpace = () => [...userChatState.threads.values()].flat()
                .filter(m => m.name.startsWith(`${parent}/`))
                .sort((a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0));
              const all = thread
                ? (userChatState.threads.get(thread) || []).filter(m => m.name.startsWith(`${parent}/`))
                : (/createTime desc/.test(orderBy || '') ? inSpace() : inSpace().reverse());
              const start = pageToken ? Number(pageToken) : 0;
              const page = all.slice(start, start + pageSize);
              const next = start + pageSize < all.length ? String(start + pageSize) : undefined;
              return { data: { messages: json(page), nextPageToken: next } };
            }
          }
        }
      };
    }
  };
  Object.defineProperty(userChat, 'failWith', { get: () => userChatState.failWith, set: (v) => { userChatState.failWith = v; } });

  function reset() {
    db.cards.clear();
    db.participants.length = 0;
    db.clicks.length = 0;
    db.people.clear();
    db.users.length = 0;
    db.digests.clear();
    db.actions.clear();
    db.intros.clear();
    db.clickSeq = 0;
    db.failOn = null;
    gate.saved.length = 0;
    gate.runs.length = 0;
    chatState.posts.length = 0;
    chatState.patches.length = 0;
    chatState.dms.clear();
    chatState.seq = 0;
    chatState.failPatch = null;
    chatState.failPost = null;
    driveState.docs.clear();
    driveState.calls.length = 0;
    driveState.hold = null;
    hubspotState.deals.length = 0;
    hubspotState.searches.length = 0;
    hubspotState.notes.length = 0;
    hubspotState.failNote = false;
    hubspotState.snapshots.length = 0;
    hubspotState.snapshot = null;
    hubspotState.owners.length = 0;
    hubspotState.outcomes.length = 0;
    hubspotState.companies.length = 0;
    hubspotState.failOutcome = false;
    hubspotState.hold = null;
    leadGenState.sessions.clear();
    leadGenState.calls.length = 0;
    grantsState.grants.length = 0;
    grantsState.searches.length = 0;
    grantsState.fail = false;
    grantsState.hold = null;
    directoryState.people.clear();
    directoryState.calls.length = 0;
    calendarState.zones.clear();
    calendarState.calls.length = 0;
    calendarState.busy.clear();
    calendarState.unseen.length = 0;
    calendarState.events.length = 0;
    calendarState.freeBusyCalls.length = 0;
    calendarState.failFreeBusy = null;
    calendarState.failInsert = false;
    calendarState.failPatch = false;
    calendarState.seq = 0;
    granolaState.meetings = null;
    granolaState.calls.length = 0;
    granolaState.fail = false;
    agentState.calls.length = 0;
    agentState.impl = null;
    messagesState.conversations.length = 0;
    chatState.members.clear();
    chatState.memberCalls.length = 0;
    listenState.spaces.clear();
    listenState.messages.length = 0;
    userChatState.threads.clear();
    userChatState.calls.length = 0;
    userChatState.failWith = null;
  }

  return { db, store, gate, chat, drive, hubspot, leadGen, grants, directory, calendar, granola, agent, messages, listen, userChat, reset };
}

// ============================================================================
// CARD INSPECTION
// ============================================================================

/** All text on a cardsV2 payload, flattened — for "the card says X" checks. */
export function cardText(cardsV2) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'parameters' && k !== 'function') walk(x);
    }
  };
  walk(cardsV2);
  return out.join('\n');
}

/** Every string anywhere in a cardsV2 payload except button targets — for "no Markdown" checks. */
export function allCardStrings(cardsV2) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { if (key !== 'function') out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'parameters') walk(x, k);
    }
  };
  walk(cardsV2, null);
  return out;
}

/** Every button on a cardsV2 payload as {text, params, disabled}. */
export function cardButtons(cardsV2) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (v.text && v.onClick?.action) {
        out.push({
          text: v.text,
          disabled: Boolean(v.disabled),
          fn: v.onClick.action.function,
          params: Object.fromEntries(v.onClick.action.parameters.map(p => [p.key, p.value]))
        });
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(cardsV2);
  return out;
}

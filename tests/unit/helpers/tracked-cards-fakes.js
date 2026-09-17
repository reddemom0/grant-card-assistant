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
 *   hubspot   — searchGrantApplications / createDealNote.
 *   directory — lookupChatUserEmail; calendar — getCalendarClient.
 *   agent     — runAgent (behaviour set per test); messages — createConversation.
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
  closedReason: 'closed_reason', lastRefreshedAt: 'last_refreshed_at', completedAt: 'completed_at'
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
    clickSeq: 0
  };
  const chatState = { posts: [], patches: [], dms: new Map(), seq: 0, failPatch: null };
  const driveState = { docs: new Map(), calls: [] };
  const hubspotState = { deals: [], searches: [], notes: [], failNote: false };
  const directoryState = { people: new Map(), calls: [] };
  const calendarState = { zones: new Map(), calls: [] };
  const agentState = { calls: [], impl: null };
  const messagesState = { conversations: [] };

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
        last_refreshed_at: null, completed_at: null, completion_shown_on: null, created_at: t, updated_at: t
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

    async markStaleBefore(cutoff, at = new Date()) {
      const rows = [...db.cards.values()].filter(c => c.status === 'open' && c.last_activity_at < cutoff);
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
        const status = p.role === 'reviewer' ? 'not_started' : null;
        if (existing) {
          existing.display_name = p.displayName || existing.display_name;
          if (p.role === 'reviewer') existing.role = 'reviewer';
          existing.status = existing.status ?? status;
        } else {
          db.participants.push({
            card_id: cardId, chat_user_id: p.chatUserId, role: p.role,
            display_name: p.displayName || null, status,
            status_changed_at: status ? new Date() : null, muted: false, assigned_notified_at: null
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

    async setMuted(cardId, chatUserId, muted) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId);
      if (!p) return false;
      p.muted = muted;
      return true;
    },

    async markAssignedNotified(cardId, chatUserId, at = new Date()) {
      const p = db.participants.find(r => r.card_id === cardId && r.chat_user_id === chatUserId);
      if (p) p.assigned_notified_at = at;
    },

    async logClick(cardId, { chatUserId, name = null }, action, at = new Date(), result = 'changed') {
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
      const result = a.tool_name === 'create_hubspot_note'
        ? await hubspot.module.createDealNote(a.tool_input)
        : { success: false, error: `fake gate cannot run ${a.tool_name}` };
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
    GATED_TOOLS: { create_hubspot_note: () => true }
  };

  // --------------------------------------------------------------------------
  // CHAT
  // --------------------------------------------------------------------------
  const chat = {
    ...chatState,
    module: {
      async postMessage({ spaceName, threadName = null, text = null, cardsV2 = null }) {
        const name = `${spaceName}/messages/m${++chatState.seq}`;
        chatState.posts.push({ name, spaceName, threadName, text, cardsV2: json(cardsV2) });
        return name;
      },
      async patchCard(messageName, cardsV2) {
        if (chatState.failPatch) throw chatState.failPatch;
        chatState.patches.push({ messageName, cardsV2: json(cardsV2) });
      },
      async findDmSpace(chatUserId) {
        return chatState.dms.get(chatUserId) ?? null;
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
        const doc = driveState.docs.get(fileId);
        if (!doc || doc.readable === false) {
          return { fileId, name: doc?.name ?? null, openComments: 0, readable: false, code: 404 };
        }
        return { fileId, name: doc.name, openComments: doc.openComments, readable: true };
      }
    }
  };

  const hubspot = {
    ...hubspotState,
    module: {
      async searchGrantApplications(filters = {}) {
        hubspotState.searches.push({ ...filters });
        const needle = String(filters.company_name || filters.deal_name || '').toLowerCase();
        const field = filters.company_name ? 'companyName' : 'name';
        return {
          success: true,
          applications: hubspotState.deals.filter(d => String(d[field] || '').toLowerCase().includes(needle))
        };
      },
      async createDealNote({ deal_id, body }) {
        if (hubspotState.failNote) return { success: false, error: 'HubSpot note could not be created (500)' };
        hubspotState.notes.push({ deal_id, body });
        return { success: true, note_id: `note-${hubspotState.notes.length}`, deal_id };
      }
    }
  };

  const directory = {
    ...directoryState,
    module: {
      async lookupChatUserEmail(chatUserId, ctx = {}) {
        directoryState.calls.push({ chatUserId, userId: ctx.userId ?? null });
        return directoryState.people.get(chatUserId) || null;
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
      }
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
  Object.defineProperty(hubspot, 'failNote', { get: () => hubspotState.failNote, set: (v) => { hubspotState.failNote = v; } });

  function reset() {
    db.cards.clear();
    db.participants.length = 0;
    db.clicks.length = 0;
    db.people.clear();
    db.users.length = 0;
    db.digests.clear();
    db.actions.clear();
    db.clickSeq = 0;
    gate.saved.length = 0;
    gate.runs.length = 0;
    chatState.posts.length = 0;
    chatState.patches.length = 0;
    chatState.dms.clear();
    chatState.seq = 0;
    chatState.failPatch = null;
    driveState.docs.clear();
    driveState.calls.length = 0;
    hubspotState.deals.length = 0;
    hubspotState.searches.length = 0;
    hubspotState.notes.length = 0;
    hubspotState.failNote = false;
    directoryState.people.clear();
    directoryState.calls.length = 0;
    calendarState.zones.clear();
    calendarState.calls.length = 0;
    agentState.calls.length = 0;
    agentState.impl = null;
    messagesState.conversations.length = 0;
  }

  return { db, store, gate, chat, drive, hubspot, directory, calendar, agent, messages, reset };
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

/** Every button on a cardsV2 payload as {text, params}. */
export function cardButtons(cardsV2) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (v.text && v.onClick?.action) {
        out.push({
          text: v.text,
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

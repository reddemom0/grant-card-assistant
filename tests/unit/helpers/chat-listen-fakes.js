/**
 * In-memory stand-ins for the stored Chat copy tests
 *
 * createFakeDb()     — answers exactly the statements src/database/chat-listen-store.js
 *                      (and the listener lookup) send, with the same semantics as the
 *                      SQL: tombstone guard, update-time guard, no writes to removed
 *                      spaces, cascade on delete. Any other statement throws, so a
 *                      changed query cannot pass silently. The real SQL is exercised
 *                      against Postgres in tests/integration/chat-listen-store.test.js.
 * createFakeGoogle() — the listener's Chat API, the app's Chat API (posting), and the
 *                      Workspace Events REST API behind client.request().
 */

// ============================================================================
// DATABASE
// ============================================================================

export function createFakeDb() {
  const db = {
    spaces: new Map(),
    messages: new Map(),
    tombstones: new Map(),
    users: [],
    failWhen: null
  };

  const copy = (row) => (row ? { ...row } : row);
  const result = (rows) => ({ rows: rows.filter(Boolean), rowCount: rows.filter(Boolean).length });
  const affected = (n) => ({ rows: [], rowCount: n });
  const live = (name) => {
    const space = db.spaces.get(name);
    return Boolean(space && space.status !== 'removed');
  };
  const update = (name, fn, { unlessRemoved = false } = {}) => {
    const space = db.spaces.get(name);
    if (!space || (unlessRemoved && space.status === 'removed')) return affected(0);
    fn(space);
    space.updated_at = new Date();
    return affected(1);
  };
  const cascade = (name) => {
    for (const [key, m] of db.messages) if (m.space_name === name) db.messages.delete(key);
    for (const [key, t] of db.tombstones) if (t.space_name === name) db.tombstones.delete(key);
  };

  async function run(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    const p = params;
    if (db.failWhen?.(sql)) {
      throw Object.assign(new Error('fake database unavailable'), { code: '57P01' });
    }

    if (sql.startsWith('SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true')) {
      return result(db.users.filter(u => u.email === p[0] && u.is_active).map(u => ({ id: u.id })));
    }
    if (sql === 'SELECT * FROM chat_listen_spaces WHERE space_name = $1') {
      return result([copy(db.spaces.get(p[0]))]);
    }
    if (sql === 'SELECT * FROM chat_listen_spaces ORDER BY space_name') {
      return result([...db.spaces.values()].sort((a, b) => a.space_name.localeCompare(b.space_name)).map(copy));
    }
    if (sql === 'SELECT * FROM chat_listen_spaces WHERE subscription_name = $1') {
      return result([...db.spaces.values()].filter(s => s.subscription_name === p[0]).map(copy));
    }
    if (sql.startsWith('INSERT INTO chat_listen_spaces')) {
      const [name, label, since, noticePosted] = p;
      const existing = db.spaces.get(name);
      if (existing && existing.status !== 'removed') return affected(0);
      const now = new Date();
      db.spaces.set(name, {
        space_name: name, label, status: 'paused', pause_reason: 'not_started', paused_at: now,
        subscription_name: null, subscription_expire_time: null, subscription_state: null,
        backfill_state: 'pending', backfill_since: new Date(since), backfill_page_token: null,
        notice_posted_at: noticePosted ? now : null, enabled_at: now, updated_at: now
      });
      return affected(1);
    }
    if (sql.includes("SET status = 'paused'")) {
      return update(p[0], s => {
        s.status = 'paused';
        s.pause_reason = p[1];
        s.paused_at = s.paused_at || new Date();
      }, { unlessRemoved: true });
    }
    if (sql.includes("SET status = 'active'")) {
      return update(p[0], s => {
        s.status = 'active';
        s.pause_reason = null;
        s.paused_at = null;
      }, { unlessRemoved: true });
    }
    if (sql.includes("SET status = 'removed'")) {
      return update(p[0], s => {
        s.status = 'removed';
        s.pause_reason = null;
        s.paused_at = null;
      });
    }
    if (sql.includes('SET notice_posted_at = COALESCE(notice_posted_at, NOW())')) {
      return update(p[0], s => { s.notice_posted_at = s.notice_posted_at || new Date(); });
    }
    if (sql.includes('SET subscription_name = $2, subscription_expire_time = $3, subscription_state = $4')) {
      return update(p[0], s => {
        s.subscription_name = p[1];
        s.subscription_expire_time = p[2] ? new Date(p[2]) : null;
        s.subscription_state = p[3];
      });
    }
    if (sql.startsWith('UPDATE chat_listen_spaces SET subscription_state = $2')) {
      return update(p[0], s => { s.subscription_state = p[1]; });
    }
    if (sql.includes('SET subscription_name = NULL, subscription_expire_time = NULL, subscription_state = NULL')) {
      return update(p[0], s => {
        s.subscription_name = null;
        s.subscription_expire_time = null;
        s.subscription_state = null;
      });
    }
    if (sql.includes('SET backfill_state = $2, backfill_page_token = $3')) {
      return update(p[0], s => {
        s.backfill_state = p[1];
        s.backfill_page_token = p[2];
      });
    }
    if (sql.startsWith('UPDATE chat_listen_spaces SET backfill_state = $2, updated_at = NOW()')) {
      return update(p[0], s => { s.backfill_state = p[1]; });
    }
    if (sql.startsWith('UPDATE chat_listen_spaces SET backfill_page_token = $2')) {
      return update(p[0], s => { s.backfill_page_token = p[1]; });
    }
    if (sql === 'DELETE FROM chat_listen_spaces WHERE space_name = $1') {
      const existed = db.spaces.delete(p[0]);
      cascade(p[0]);
      return affected(existed ? 1 : 0);
    }
    if (sql.startsWith('INSERT INTO chat_space_messages')) {
      const [names, spaces, threads, senders, creates, updates, texts] = p;
      let n = 0;
      names.forEach((name, i) => {
        if (db.tombstones.has(name) || !live(spaces[i])) return;
        const existing = db.messages.get(name);
        if (existing && new Date(updates[i]) < new Date(existing.update_time)) return;
        db.messages.set(name, {
          message_name: name, space_name: spaces[i], thread_name: threads[i], sender_user_id: senders[i],
          create_time: new Date(existing?.create_time ?? creates[i]), update_time: new Date(updates[i]),
          text: texts[i], stored_at: new Date()
        });
        n++;
      });
      return affected(n);
    }
    if (sql.startsWith('DELETE FROM chat_space_messages WHERE space_name = $1 AND message_name = ANY')) {
      let n = 0;
      for (const name of p[1]) {
        if (db.messages.get(name)?.space_name === p[0]) {
          db.messages.delete(name);
          n++;
        }
      }
      return affected(n);
    }
    if (sql.startsWith('INSERT INTO chat_message_tombstones')) {
      if (!live(p[0])) return affected(0);
      for (const name of p[1]) db.tombstones.set(name, { message_name: name, space_name: p[0], deleted_at: new Date() });
      return affected(p[1].length);
    }
    if (sql.startsWith('SELECT MAX(create_time) AS latest FROM chat_space_messages')) {
      const times = [...db.messages.values()].filter(m => m.space_name === p[0]).map(m => m.create_time.getTime());
      return result([{ latest: times.length ? new Date(Math.max(...times)) : null }]);
    }
    if (sql === 'DELETE FROM chat_space_messages WHERE space_name = $1') {
      const before = db.messages.size;
      for (const [key, m] of db.messages) if (m.space_name === p[0]) db.messages.delete(key);
      return affected(before - db.messages.size);
    }
    if (sql === 'DELETE FROM chat_message_tombstones WHERE space_name = $1') {
      const before = db.tombstones.size;
      for (const [key, t] of db.tombstones) if (t.space_name === p[0]) db.tombstones.delete(key);
      return affected(before - db.tombstones.size);
    }
    if (sql === 'DELETE FROM chat_space_messages WHERE create_time < $1') {
      const before = db.messages.size;
      for (const [key, m] of db.messages) if (m.create_time < new Date(p[0])) db.messages.delete(key);
      return affected(before - db.messages.size);
    }
    if (sql === 'DELETE FROM chat_message_tombstones WHERE deleted_at < $1') {
      const before = db.tombstones.size;
      for (const [key, t] of db.tombstones) if (t.deleted_at < new Date(p[0])) db.tombstones.delete(key);
      return affected(before - db.tombstones.size);
    }

    throw new Error(`fake database: unexpected statement: ${sql.slice(0, 90)}`);
  }

  const snapshot = () => ({
    spaces: new Map([...db.spaces].map(([k, v]) => [k, { ...v }])),
    messages: new Map([...db.messages].map(([k, v]) => [k, { ...v }])),
    tombstones: new Map([...db.tombstones].map(([k, v]) => [k, { ...v }]))
  });

  db.query = run;
  db.transaction = async (callback) => {
    const saved = snapshot();
    try {
      return await callback({ query: run });
    } catch (err) {
      Object.assign(db, saved);
      throw err;
    }
  };

  /** Seed a followed space directly. */
  db.addSpace = (name, fields = {}) => {
    const now = new Date();
    db.spaces.set(name, {
      space_name: name, label: 'Test space', status: 'active', pause_reason: null, paused_at: null,
      subscription_name: null, subscription_expire_time: null, subscription_state: null,
      backfill_state: 'done', backfill_since: new Date(now.getTime() - 365 * 864e5), backfill_page_token: null,
      notice_posted_at: now, enabled_at: now, updated_at: now,
      ...fields
    });
  };
  /** Seed a stored message directly. */
  db.addMessage = (name, fields = {}) => {
    db.messages.set(name, {
      message_name: name, space_name: name.split('/messages/')[0], thread_name: null, sender_user_id: 'users/1',
      create_time: new Date(), update_time: new Date(), text: 'seeded', stored_at: new Date(),
      ...fields
    });
  };

  return db;
}

// ============================================================================
// GOOGLE
// ============================================================================

export function httpError(status, data = { error: { code: status } }) {
  return Object.assign(new Error(`Request failed with status ${status}`), { response: { status, data } });
}

export function invalidGrant() {
  return Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } });
}

export function scopeInsufficient() {
  return Object.assign(new Error('Request had insufficient authentication scopes.'), {
    code: 403,
    response: {
      status: 403,
      data: { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }
    }
  });
}

const DAY = 864e5;

export function createFakeGoogle() {
  const g = {
    // Named spaces the listener belongs to, and any other kind it can see.
    memberSpaces: new Set(),
    otherSpaces: [],
    messages: new Map(),
    subscriptions: new Map(),
    posts: [],
    postFails: false,
    tokenRevoked: false,
    pageSize: 2,
    // page tokens the API rejects as stale, and a hook run before each list call
    staleTokens: new Set(),
    listHook: null,
    listCount: 0,
    nextId: 1,
    calls: [],
    // queued failures: op -> array of errors thrown on successive calls
    failures: new Map()
  };

  const failNext = (op) => {
    const queue = g.failures.get(op);
    if (queue?.length) throw queue.shift();
  };
  g.fail = (op, ...errors) => g.failures.set(op, [...(g.failures.get(op) || []), ...errors]);

  g.addMessage = (name, fields = {}) => {
    const now = new Date().toISOString();
    g.messages.set(name, {
      name,
      sender: { name: 'users/111', type: 'HUMAN' },
      createTime: now,
      lastUpdateTime: now,
      text: 'hello',
      thread: { name: `${name.split('/messages/')[0]}/threads/T1` },
      ...fields
    });
  };

  g.addSubscription = (spaceName, fields = {}) => {
    const name = `subscriptions/sub${g.nextId++}`;
    g.subscriptions.set(name, {
      name,
      targetResource: `//chat.googleapis.com/${spaceName}`,
      state: 'ACTIVE',
      expireTime: new Date(Date.now() + 7 * DAY).toISOString(),
      ...fields
    });
    return name;
  };

  // --- the listener's Chat API ---------------------------------------------
  g.listenerChat = {
    spaces: {
      list: async (params) => {
        g.calls.push({ op: 'spaces.list', params });
        failNext('spaces.list');
        const spaces = [...g.memberSpaces].map(name => ({ name, spaceType: 'SPACE' })).concat(g.otherSpaces);
        return { data: { spaces } };
      },
      messages: {
        get: async ({ name }) => {
          g.calls.push({ op: 'messages.get', name });
          failNext('messages.get');
          const message = g.messages.get(name);
          if (!message) throw httpError(404);
          return { data: structuredClone(message) };
        },
        list: async ({ parent, pageToken, filter }) => {
          g.calls.push({ op: 'messages.list', pageToken: pageToken || null, filter });
          failNext('messages.list');
          g.listHook?.(++g.listCount, pageToken || null);
          if (pageToken && g.staleTokens.has(pageToken)) throw httpError(400);
          const since = new Date(/createTime > "([^"]+)"/.exec(filter || '')?.[1] || 0);
          const all = [...g.messages.values()]
            .filter(m => m.name.startsWith(`${parent}/messages/`) && new Date(m.createTime) > since)
            .sort((a, b) => new Date(a.createTime) - new Date(b.createTime));
          const offset = pageToken ? Number(pageToken.split(':')[1]) : 0;
          const page = all.slice(offset, offset + g.pageSize);
          const next = offset + g.pageSize < all.length ? `page:${offset + g.pageSize}` : undefined;
          return { data: { messages: page.map(m => structuredClone(m)), nextPageToken: next } };
        }
      }
    }
  };

  // --- the Oracle app's Chat API (posting) -----------------------------------
  g.appChat = {
    spaces: {
      messages: {
        create: async (request) => {
          g.calls.push({ op: 'app.messages.create' });
          if (g.postFails) throw httpError(403);
          g.posts.push(request);
          return { data: {} };
        }
      }
    }
  };

  // --- the listener's OAuth client, with Workspace Events behind request() ----
  const done = (response) => ({ name: `operations/op${g.nextId++}`, done: true, response });

  g.client = {
    getAccessToken: async () => {
      if (g.tokenRevoked) throw invalidGrant();
      return { token: 'fake-access-token' };
    },
    request: async ({ url, method = 'GET', params, data }) => {
      const path = url.replace('https://workspaceevents.googleapis.com/v1/', '');
      g.calls.push({ op: `events.${method}`, path, params, data });
      failNext(`events.${method} ${path.replace(/sub\d+/, 'ID')}`);

      if (method === 'POST' && path === 'subscriptions') {
        const exists = [...g.subscriptions.values()].some(s => s.targetResource === data.targetResource);
        if (exists) throw httpError(409);
        const name = `subscriptions/sub${g.nextId++}`;
        const sub = {
          name,
          ...data,
          state: 'ACTIVE',
          expireTime: new Date(Date.now() + 7 * DAY).toISOString()
        };
        g.subscriptions.set(name, sub);
        return { data: done({ ...sub }) };
      }
      if (method === 'GET' && path === 'subscriptions') {
        const target = /target_resource="([^"]+)"/.exec(params?.filter || '')?.[1];
        return { data: { subscriptions: [...g.subscriptions.values()].filter(s => s.targetResource === target) } };
      }
      const reactivate = /^(subscriptions\/[^:]+):reactivate$/.exec(path);
      if (method === 'POST' && reactivate) {
        const sub = g.subscriptions.get(reactivate[1]);
        if (!sub) throw httpError(404);
        if (g.reactivateFails) return { data: { name: 'operations/x', done: true, error: { code: 9, message: 'no' } } };
        sub.state = 'ACTIVE';
        delete sub.suspensionReason;
        return { data: done({ ...sub }) };
      }
      if (path.startsWith('subscriptions/')) {
        const sub = g.subscriptions.get(path);
        if (!sub) throw httpError(404);
        if (method === 'GET') return { data: { ...sub } };
        if (method === 'PATCH') {
          sub.expireTime = new Date(Date.now() + 7 * DAY).toISOString();
          return { data: done({ ...sub }) };
        }
        if (method === 'DELETE') {
          g.subscriptions.delete(path);
          return { data: done({}) };
        }
      }
      throw new Error(`fake events API: unexpected ${method} ${path}`);
    }
  };

  g.eventsCalls = (method, pathPattern) =>
    g.calls.filter(c => c.op === `events.${method}` && (!pathPattern || pathPattern.test(c.path)));

  return g;
}

/** Wait until fn() is truthy, yielding to the event loop between checks. */
export async function eventually(fn, tries = 500) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('condition never became true');
}

/** A Pub/Sub push body in the wrapped format. */
export function pushBody(type, data, subject) {
  return {
    message: {
      attributes: {
        'ce-type': type,
        'ce-subject': subject,
        'ce-source': '//workspaceevents.googleapis.com/subscriptions/sub1',
        'ce-specversion': '1.0'
      },
      data: Buffer.from(JSON.stringify(data)).toString('base64'),
      messageId: String(Math.random())
    },
    subscription: 'projects/p/subscriptions/oracle-chat-events-push'
  };
}

export function mockRes() {
  const res = { statusCode: null, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

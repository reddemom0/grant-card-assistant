/**
 * OAuth state on Google sign-in (login CSRF)
 *
 * Without a state, anyone could send a staff member to /api/auth-callback with
 * the attacker's own authorization code and sign them in as the attacker. These
 * tests run the real auth router in a real Express app, with Redis, Google and
 * Postgres stubbed, and drive it the way a browser would: start a sign-in, keep
 * the cookie it sets, come back to the callback.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/auth-login-state.test.js
 */

import { jest } from '@jest/globals';

process.env.GOOGLE_CLIENT_ID = 'client-id-for-tests';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret-for-tests';
process.env.JWT_SECRET = 'jwt-secret-for-tests';

const CODE = 'auth-code-from-google-123';
const EVIL = 'https://evil.example';

// --- stubs -----------------------------------------------------------------
// Redis: an in-memory store that honours EX against a clock the tests move.
const mockRedis = { now: 0, keys: new Map(), down: false };
jest.unstable_mockModule('ioredis', () => ({
  default: class {
    async set(key, _value, mode, seconds) {
      if (mockRedis.down) throw new Error('connect ECONNREFUSED');
      mockRedis.keys.set(key, mode === 'EX' ? mockRedis.now + seconds * 1000 : Infinity);
      return 'OK';
    }
    async del(key) {
      if (mockRedis.down) throw new Error('connect ECONNREFUSED');
      const expiresAt = mockRedis.keys.get(key);
      mockRedis.keys.delete(key);
      return expiresAt !== undefined && expiresAt > mockRedis.now ? 1 : 0;
    }
  }
}));

const mockGetToken = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        getToken(code) { return mockGetToken(code); }
        setCredentials() {}
      }
    },
    oauth2: () => ({
      userinfo: {
        get: async () => ({
          data: { id: 'g-1', email: 'person@granted.ca', name: 'Person', picture: null, verified_email: true }
        })
      }
    })
  }
}));

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async () => ({
    rows: [{ id: 7, email: 'person@granted.ca', name: 'Person', picture: null, is_active: true }]
  }),
  getPool: () => null,
  transaction: async () => null
}));

const { default: express } = await import('express');
const { default: authRouter, verifyLoginState } = await import('../../src/api/auth.js');

// --- a browser, roughly ----------------------------------------------------
let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use('/api', authRouter);
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const cookieNamed = (setCookies, name) => setCookies.find(c => c.startsWith(`${name}=`)) || null;
const cookieValue = (setCookie) => setCookie?.split(';')[0].split('=').slice(1).join('=') ?? null;

/** GET /api/auth-google; returns what the browser would keep. */
async function startSignIn(query = '') {
  const r = await fetch(`${base}/api/auth-google${query}`, { redirect: 'manual' });
  const location = r.headers.get('location');
  const stateCookie = cookieNamed(r.headers.getSetCookie(), 'google_login_state');
  return {
    status: r.status,
    location,
    stateCookie,
    cookie: cookieValue(stateCookie),
    state: location ? new URL(location).searchParams.get('state') : null
  };
}

/** GET /api/auth-callback as Google's redirect would land it. */
async function callback({ cookie, state, code = CODE, extra = {} } = {}) {
  const params = new URLSearchParams({
    ...(code ? { code } : {}),
    ...(state ? { state } : {}),
    ...extra
  });
  const r = await fetch(`${base}/api/auth-callback?${params}`, {
    redirect: 'manual',
    headers: cookie ? { cookie: `google_login_state=${cookie}` } : {}
  });
  const setCookies = r.headers.getSetCookie();
  return {
    status: r.status,
    body: await r.text(),
    session: cookieNamed(setCookies, 'granted_session'),
    stateCookie: cookieNamed(setCookies, 'google_login_state')
  };
}

const EXPIRED_PAGE = 'Sign-in expired, please try again';

let logSpies;
const logged = () => logSpies
  .flatMap(spy => spy.mock.calls)
  .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  .join('\n');

beforeEach(() => {
  mockRedis.now = 1_000_000;
  mockRedis.keys.clear();
  mockRedis.down = false;
  mockGetToken.mockReset();
  mockGetToken.mockImplementation(async () => ({
    tokens: { access_token: 'access-token-xyz', refresh_token: 'refresh-token-xyz', expiry_date: null, scope: 'profile email' }
  }));
  logSpies = ['log', 'warn', 'error'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  logSpies.forEach(spy => spy.mockRestore());
});

// --- starting a sign-in ----------------------------------------------------
describe('starting a sign-in', () => {
  test('sends a state to Google and binds the same value to this browser', async () => {
    const s = await startSignIn();

    expect(s.status).toBe(302);
    expect(new URL(s.location).origin).toBe('https://accounts.google.com');
    expect(s.state).toMatch(/^[0-9a-f]{64}$/);
    expect(s.cookie).toBe(s.state);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/auth-callback', 'Max-Age=600']) {
      expect(s.stateCookie).toContain(attr);
    }
  });

  test('every attempt gets a different state', async () => {
    const a = await startSignIn();
    const b = await startSignIn();
    expect(a.state).not.toBe(b.state);
  });

  test('the rest of the consent URL is unchanged', async () => {
    const url = new URL((await startSignIn()).location);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/chat.messages.readonly');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('hd')).toBe('granted.ca');
  });

  test('if the state cannot be recorded, sign-in does not start', async () => {
    mockRedis.down = true;
    const s = await startSignIn();

    expect(s.status).toBe(503);
    expect(s.location).toBeNull();
    expect(s.stateCookie).toBeNull();
    expect(logged()).toContain('reason: state_store_unavailable');
  });
});

// --- the callback ----------------------------------------------------------
describe('the callback', () => {
  test('a matching, fresh state signs the user in', async () => {
    const s = await startSignIn();
    const cb = await callback({ cookie: s.cookie, state: s.state });

    expect(cb.status).toBe(200);
    expect(cb.body).toContain('url=/oracle/new#user=');
    expect(cb.session).not.toBeNull();
    // Both cookies survive: the session, and the one clearing the state.
    expect(cb.stateCookie).toMatch(/^google_login_state=;/);
    expect(cb.stateCookie).toContain('Max-Age=0');
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledWith(CODE);
  });

  test('missing state is rejected before the code is exchanged', async () => {
    const s = await startSignIn();
    const cb = await callback({ cookie: s.cookie });

    expect(cb.status).toBe(400);
    expect(cb.body).toContain(EXPIRED_PAGE);
    expect(cb.session).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(logged()).toContain('reason: missing_state');
  });

  test('missing cookie is rejected — the forged-callback case', async () => {
    // The attacker has a real state and a real code from their own sign-in,
    // but cannot put their cookie in the victim's browser.
    const attacker = await startSignIn();
    const cb = await callback({ state: attacker.state });

    expect(cb.status).toBe(400);
    expect(cb.body).toContain(EXPIRED_PAGE);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(logged()).toContain('reason: missing_cookie');
  });

  test('a mismatched state is rejected and spends only this browser\'s attempt', async () => {
    const victim = await startSignIn();
    const attacker = await startSignIn();

    const cb = await callback({ cookie: victim.cookie, state: attacker.state });
    expect(cb.status).toBe(400);
    expect(cb.body).toContain(EXPIRED_PAGE);
    expect(logged()).toContain('reason: state_mismatch');

    // The victim's own state is gone now...
    expect((await callback({ cookie: victim.cookie, state: victim.state })).status).toBe(400);
    // ...and the other attempt was not touched.
    expect((await callback({ cookie: attacker.cookie, state: attacker.state })).status).toBe(200);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  test('a state works once', async () => {
    const s = await startSignIn();
    expect((await callback({ cookie: s.cookie, state: s.state })).status).toBe(200);

    const replay = await callback({ cookie: s.cookie, state: s.state });
    expect(replay.status).toBe(400);
    expect(replay.body).toContain(EXPIRED_PAGE);
    expect(replay.session).toBeNull();
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('reason: state_not_found');
  });

  test('a state older than 10 minutes is rejected', async () => {
    const s = await startSignIn();
    mockRedis.now += 601 * 1000;

    const cb = await callback({ cookie: s.cookie, state: s.state });
    expect(cb.status).toBe(400);
    expect(cb.body).toContain(EXPIRED_PAGE);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test('a state just inside 10 minutes still works', async () => {
    const s = await startSignIn();
    mockRedis.now += 599 * 1000;
    expect((await callback({ cookie: s.cookie, state: s.state })).status).toBe(200);
  });

  test('if the store is down at the callback, sign-in is refused', async () => {
    const s = await startSignIn();
    mockRedis.down = true;

    const cb = await callback({ cookie: s.cookie, state: s.state });
    expect(cb.status).toBe(400);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(logged()).toContain('reason: state_store_unavailable');
  });

  test('a rejected callback still clears the state cookie', async () => {
    const s = await startSignIn();
    const cb = await callback({ cookie: s.cookie, state: 'f'.repeat(64) });
    expect(cb.stateCookie).toContain('Max-Age=0');
  });

  test('a repeated state parameter counts as missing', async () => {
    const s = await startSignIn();
    const r = await verifyLoginState({
      headers: { cookie: `other=1; google_login_state=${s.cookie}` },
      query: { state: [s.state, s.state] }
    });
    expect(r).toEqual({ ok: false, reason: 'missing_state' });
  });
});

// --- redirects and reflected content ---------------------------------------
describe('no open redirect, no reflection', () => {
  test('a return path on the sign-in link goes nowhere', async () => {
    const s = await startSignIn(`?returnTo=${encodeURIComponent(EVIL)}&next=${encodeURIComponent('//evil.example')}`);

    expect(new URL(s.location).origin).toBe('https://accounts.google.com');
    expect(s.location).not.toContain('evil');
  });

  test('a return path on the callback is ignored; sign-in lands on /oracle/new', async () => {
    const s = await startSignIn();
    const cb = await callback({
      cookie: s.cookie,
      state: s.state,
      extra: { returnTo: EVIL, next: '//evil.example', redirect_uri: EVIL }
    });

    expect(cb.status).toBe(200);
    expect(cb.body).not.toContain('evil');
    expect(cb.body).toContain("window.location.href = '/oracle/new#user=");
  });

  test('a forged Google error with no valid state gets the expired page, not a reflection', async () => {
    const cb = await callback({ code: null, extra: { error: '<script>alert(1)</script>' } });

    expect(cb.status).toBe(400);
    expect(cb.body).toContain(EXPIRED_PAGE);
    expect(cb.body).not.toContain('alert(1)');
  });

  test('with a valid state, Google\'s error text is escaped', async () => {
    const s = await startSignIn();
    const cb = await callback({
      cookie: s.cookie,
      state: s.state,
      code: null,
      extra: { error: '<script>alert(1)</script>', error_description: '<img src=x onerror=alert(2)>' }
    });

    expect(cb.status).toBe(400);
    expect(cb.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(cb.body).not.toContain('<script>alert(1)');
    expect(cb.body).not.toContain('<img src=x');
  });

  test('with a valid state and no code, the echoed query is escaped', async () => {
    const s = await startSignIn();
    const cb = await callback({ cookie: s.cookie, state: s.state, code: null, extra: { x: '<img src=x onerror=alert(3)>' } });

    expect(cb.status).toBe(400);
    expect(cb.body).not.toContain('<img src=x');
    expect(cb.body).toContain('&lt;img src=x');
  });
});

// --- logs ------------------------------------------------------------------
describe('logs', () => {
  test('a rejected callback logs the reason, never the state or the code', async () => {
    const s = await startSignIn();
    await callback({ cookie: s.cookie, state: 'a'.repeat(64) });

    const out = logged();
    expect(out).toContain('Sign-in rejected — reason: state_mismatch');
    expect(out).not.toContain(s.state);
    expect(out).not.toContain('a'.repeat(64));
    expect(out).not.toContain(CODE);
  });

  test('a successful sign-in logs neither the state, the code, nor the session token', async () => {
    const s = await startSignIn();
    const cb = await callback({ cookie: s.cookie, state: s.state });
    const jwt = cookieValue(cb.session);

    const out = logged();
    expect(jwt.length).toBeGreaterThan(20);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain(s.state);
    expect(out).not.toContain(CODE);
  });
});

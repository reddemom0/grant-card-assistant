/**
 * Workspace add-on TIMEOUT PROBE — disposable.
 *
 * Answers one question: how long does Google wait for a self-hosted add-on HTTP
 * endpoint before giving up? 30s is documented for APPS SCRIPT add-ons; nothing
 * is documented for self-hosted endpoints, and a 2-minute figure exists for a
 * different programme, so the limit may not apply here. Oracle's bounded actions
 * take seconds and tool-heavy work takes 10-40, so the answer decides whether a
 * sidebar has room or has to be defensive.
 *
 * HOW IT MEASURES
 * Not by watching the sidebar UI. Node fires 'close' on the request when the
 * client disconnects, so this records t0, listens for that, sleeps, and then
 * reports which happened first:
 *   DISCONNECT after Xs  -> Google gave up at X. That is the number.
 *   WROTE after Xs       -> the response was accepted at X.
 * A refusal logs REFUSED instead, so a rejected request can never be mistaken
 * for a timeout.
 *
 * DELETE THIS once the number is known: this file, its route in server.js, the
 * two env vars, and the HTTP deployment. It calls no Oracle tool, reads no data,
 * and writes nothing, so nothing depends on it.
 */

import { OAuth2Client } from 'google-auth-library';

const oauthClient = new OAuth2Client();

// Read at call time, not module load, so Railway env changes take effect on
// redeploy without a code change — same pattern as chat-google.js:43.
const ISSUER_EMAIL = () => process.env.GOOGLE_ADDON_ISSUER_EMAIL;
const AUDIENCE = () => process.env.GOOGLE_ADDON_AUDIENCE;

const DEFAULT_SLEEP_SECONDS = 5;
// A stray request must not be able to pin a worker indefinitely.
const MAX_SLEEP_SECONDS = 300;

/**
 * Verify the request came from Google.
 *
 * Mirrors verifyChatRequest (src/api/chat-google.js:64) with ONE deliberate
 * difference: the audience is optional here.
 *
 * The Chat adapter requires both issuer and audience. An add-on HTTP
 * deployment's audience value is not knowable until a real request arrives, so
 * this requires the issuer (fail closed) and enforces the audience only when
 * GOOGLE_ADDON_AUDIENCE is set. When it is not set, the actual `aud` claim is
 * logged so it can be configured and tightened after the first request.
 *
 * That is weaker than the Chat adapter and is acceptable ONLY because this
 * endpoint sleeps and returns a static card — no Oracle call, no data access,
 * no writes — and is deleted afterwards. Do not copy this into anything real.
 */
async function verifyAddonRequest(req) {
  const expectedIssuer = ISSUER_EMAIL();
  const audience = AUDIENCE();

  if (typeof expectedIssuer !== 'string' || expectedIssuer.length === 0) {
    return { ok: false, reason: 'GOOGLE_ADDON_ISSUER_EMAIL not configured' };
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return { ok: false, reason: 'missing bearer token' };
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    return { ok: false, reason: 'empty bearer token' };
  }

  try {
    // Passing audience: undefined skips the audience check; a configured value
    // enforces it.
    const ticket = await oauthClient.verifyIdToken(
      audience ? { idToken, audience } : { idToken }
    );
    const payload = ticket.getPayload();

    if (payload?.email_verified !== true || payload?.email !== expectedIssuer) {
      // Safe to log the received issuer: reaching this line means the token was
      // Google-signed, and a service account email is an identifier, not a
      // secret. No part of the token itself is logged.
      console.error(`[ADDON-PROBE] issuer mismatch — expected ${expectedIssuer}, got ${payload?.email || '(none)'} (email_verified: ${payload?.email_verified})`);
      return { ok: false, reason: 'token not issued by the expected service account' };
    }

    if (!audience) {
      // The value needed to tighten this. Set GOOGLE_ADDON_AUDIENCE to it.
      console.warn(`[ADDON-PROBE] ⚠️  running WITHOUT an audience check. Token aud=${JSON.stringify(payload?.aud)} — set GOOGLE_ADDON_AUDIENCE to this to enforce it.`);
    }

    return { ok: true, reason: null };
  } catch (err) {
    // Signature, audience and expiry failures all land here.
    return { ok: false, reason: `token verification failed: ${err.message}` };
  }
}

/** Requested sleep in seconds: ?sleep= wins over the env var, then the default. */
function resolveSleepSeconds(req) {
  const raw = req.query?.sleep ?? process.env.ADDON_PROBE_SLEEP_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SLEEP_SECONDS;
  return Math.min(n, MAX_SLEEP_SECONDS);
}

/**
 * The trivial card that proves a response was accepted.
 *
 * SHAPE: the body IS the RenderActions message — it begins with `action`, with
 * NO top-level `renderActions` wrapper. Verified against the Node.js
 * alternate-runtimes quickstart, which is this exact configuration.
 *
 * The wrapper was the first attempt and Google rejected it with:
 *   "Cannot find field: renderActions in message
 *    google.apps.card.v1.RenderActions"
 * i.e. the body is already parsed as RenderActions, so wrapping it nests one
 * level too deep. Note that the `renderActions.action.navigations[]` shape seen
 * in some examples belongs to the Apps Script / framework-helper path, not to a
 * self-hosted HTTP endpoint.
 */
function probeCard(seconds) {
  return {
    action: {
      navigations: [{
        pushCard: {
          header: { title: 'Oracle timeout probe' },
          sections: [{
            widgets: [{
              textParagraph: {
                text: `Responded after <b>${seconds.toFixed(1)}s</b>. If you can read this, Google waited that long.`
              }
            }]
          }]
        }
      }]
    }
  };
}

/**
 * POST /api/addon/probe
 */
export async function handleAddonProbe(req, res) {
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;

  const seconds = resolveSleepSeconds(req);
  const host = req.body?.commonEventObject?.hostApp || '(unknown)';
  console.log(`[ADDON-PROBE] START t=${new Date(t0).toISOString()} sleep=${seconds}s host=${host}`);

  const auth = await verifyAddonRequest(req);
  if (!auth.ok) {
    // Distinct from a timeout, deliberately: a refusal must never be mistaken
    // for Google giving up.
    console.warn(`[ADDON-PROBE] REFUSED after ${elapsed().toFixed(1)}s — ${auth.reason}`);
    return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
  }

  return sleepThenRespond(req, res, seconds, t0);
}

/**
 * The measurement itself, separated from verification so it can be tested
 * without a Google-signed token — which is the only way to reach it in
 * production, and would otherwise leave the one thing this probe exists to do
 * completely unexercised.
 *
 * 'close' fires on the request when the peer hangs up. If that happens before
 * the sleep finishes, Google gave up and we have our number.
 *
 * @returns {Promise<'disconnected'|'wrote'|'write_failed'>} outcome, for tests
 */
export async function sleepThenRespond(req, res, seconds, t0) {
  const elapsed = () => (Date.now() - t0) / 1000;

  let disconnectedAt = null;
  req.on('close', () => {
    if (!res.writableEnded && disconnectedAt === null) {
      disconnectedAt = elapsed();
      console.log(`[ADDON-PROBE] DISCONNECT after ${disconnectedAt.toFixed(1)}s — client hung up before the response was written`);
    }
  });

  await new Promise(resolve => setTimeout(resolve, seconds * 1000));

  if (disconnectedAt !== null) {
    // Nothing to write to; the socket is gone. Returning here keeps the log to
    // exactly one terminal line per request.
    return 'disconnected';
  }

  try {
    res.json(probeCard(elapsed()));
    console.log(`[ADDON-PROBE] WROTE after ${elapsed().toFixed(1)}s (client still connected)`);
    return 'wrote';
  } catch (err) {
    console.error(`[ADDON-PROBE] WRITE FAILED after ${elapsed().toFixed(1)}s — ${err.message}`);
    return 'write_failed';
  }
}

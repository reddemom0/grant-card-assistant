/**
 * Control Centre links for messages and Oracle answers.
 *
 * The Hub's public base is PUBLIC_URL, with the same production fallback the
 * sign-in link uses (src/tools/chat-history.js hubSignInUrl). A card opens at
 * /control-centre#review/<id>, a grant at /control-centre#grants/<id>.
 */

export const DEFAULT_HUB_URL = 'https://grant-card-assistant-production.up.railway.app';

export function hubBaseUrl(env = process.env) {
  return String(env.PUBLIC_URL || DEFAULT_HUB_URL).replace(/\/+$/, '');
}

/** The Control Centre page. */
export function controlCentreUrl(env = process.env) {
  return `${hubBaseUrl(env)}/control-centre`;
}

/** One grant's page in the Grants tab (a grant root id). */
export function grantLink(id, env = process.env) {
  return `${controlCentreUrl(env)}#grants/${id}`;
}

/** One review card. */
export function cardLink(id, env = process.env) {
  return `${controlCentreUrl(env)}#review/${id}`;
}

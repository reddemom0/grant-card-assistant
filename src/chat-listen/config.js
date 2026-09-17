/**
 * Which Chat spaces Oracle keeps a copy of, and the settings around it
 *
 * The allowlist is data/chat/listen-spaces.json, keyed by space resource name
 * (spaces/XXX) because display names change and can repeat. A space that is not
 * listed is never subscribed or backfilled, whoever is a member of it.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const RETENTION_MONTHS = 12;
export const TOMBSTONE_DAYS = 30;
/** Renew a subscription once it is this close to expiring. Subscriptions last 7 days. */
export const RENEW_WITHIN_MS = 48 * 60 * 60 * 1000;
/** A catch-up re-reads this far before the newest stored message. */
export const CATCH_UP_OVERLAP_MS = 5 * 60 * 1000;

export const MESSAGE_EVENT_TYPES = [
  'google.workspace.chat.message.v1.created',
  'google.workspace.chat.message.v1.updated',
  'google.workspace.chat.message.v1.deleted'
];

const SPACE_NAME = /^spaces\/[A-Za-z0-9_-]+$/;

let allowlist = null;

function load() {
  if (allowlist) return allowlist;
  const raw = JSON.parse(readFileSync(join(__dirname, '../../data/chat/listen-spaces.json'), 'utf8'));
  allowlist = (raw.spaces || [])
    .filter(s => typeof s?.name === 'string' && SPACE_NAME.test(s.name))
    .map(s => ({ name: s.name, label: String(s.label || '') }));
  return allowlist;
}

/** @returns {{name: string, label: string}[]} */
export function listenSpaces() {
  return load();
}

export function isListenSpace(spaceName) {
  return typeof spaceName === 'string' && load().some(s => s.name === spaceName);
}

export function listenEntry(spaceName) {
  return load().find(s => s.name === spaceName) || null;
}

/** Kill switch: no subscriptions, backfills or event storage while set. */
export function listenDisabled() {
  return process.env.CHAT_LISTEN_DISABLED === 'true';
}

/** Environment variables listening cannot run without, by name. */
export function listenEnvProblems() {
  return [
    'CHAT_LISTENER_USER_EMAIL',
    'CHAT_EVENTS_PUBSUB_TOPIC',
    'PUBSUB_PUSH_AUDIENCE',
    'PUBSUB_PUSH_SERVICE_ACCOUNT'
  ].filter(name => !process.env[name]);
}

/** Listening may run: not switched off and fully configured. */
export function listenReady() {
  return !listenDisabled() && listenEnvProblems().length === 0;
}

export function monthsAgo(months, now = new Date()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export function daysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

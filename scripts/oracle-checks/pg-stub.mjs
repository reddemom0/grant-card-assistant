// Stand-in for the `pg` package: SELECT and transaction statements run, writes are dropped.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../package.json', import.meta.url));
const realPg = (await import(pathToFileURL(require.resolve('pg')).href)).default;

const textOf = q => (typeof q === 'string' ? q : q?.text) || '';
const isRead = t => /^\s*(select|with|begin|commit|rollback|set|show)\b/i.test(t)
  && !/\b(insert|update|delete|create|alter|drop|truncate)\b/i.test(t);
const EMPTY = { rows: [], rowCount: 0 };

function guard(query) {
  return function (q, ...args) {
    const text = textOf(q);
    if (isRead(text)) return query(q, ...args);
    console.log('[RO-PG] blocked write:', text.trim().split(/\s+/).slice(0, 4).join(' '));
    const callback = args.find(a => typeof a === 'function');
    if (callback) { callback(null, EMPTY); return; }
    return Promise.resolve(EMPTY);
  };
}

function guardClient(client) {
  if (client && !client.__readOnly) {
    client.query = guard(client.query.bind(client));
    client.__readOnly = true;
  }
  return client;
}

class Pool extends realPg.Pool {
  query(...args) { return guard(super.query.bind(this))(...args); }
  connect(callback) {
    if (typeof callback === 'function') {
      return super.connect((err, client, done) => callback(err, guardClient(client), done));
    }
    return super.connect().then(guardClient);
  }
}

class Client extends realPg.Client {
  query(...args) { return guard(super.query.bind(this))(...args); }
}

export default { ...realPg, Pool, Client };
export { Pool, Client };
export const types = realPg.types;

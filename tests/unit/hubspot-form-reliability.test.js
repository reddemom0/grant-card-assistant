/**
 * HubSpot form submission reliability (src/api/hubspot-form-submission.js):
 * transient retries, the repaired website retry, the error parser, and the
 * direct contact upsert that keeps a rejected lead.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/hubspot-form-reliability.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));

const {
  submitLeadGenForm,
  parseFormErrors,
  websiteFromEmail,
  upsertLeadGenContact
} = await import('../../src/api/hubspot-form-submission.js');

const session = (email = 'pat@acme.ca') => ({
  contact_name: 'Pat Lee', contact_email: email, company_name: 'Acme', company_website: null,
  prospect_data: { phone: '604-555-0100', industry: 'Retail', province: 'Ontario', best_fit_product: 'Get Granted' }
});
const httpError = (status, data) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const WEBSITE_REQUIRED = { status: 'error', message: 'The request is not valid', errors: [{ message: "Required field 'website' is missing", errorType: 'REQUIRED_FIELD' }] };
const noSleep = { sleep: async () => {} };

beforeAll(() => { delete process.env.LEAD_GEN_TEST_MODE; });

test('parseFormErrors reads the field from either message style', () => {
  expect(parseFormErrors(WEBSITE_REQUIRED)).toEqual([{ type: 'REQUIRED_FIELD', field: 'website', message: "Required field 'website' is missing" }]);
  expect(parseFormErrors({ errors: [{ errorType: 'INVALID_EMAIL', message: 'Error in fields.email. Invalid' }] })[0].field).toBe('email');
  expect(parseFormErrors(undefined)).toEqual([]);
});

test('websiteFromEmail: company domain only', () => {
  expect(websiteFromEmail('pat@acme.ca')).toBe('https://acme.ca');
  expect(websiteFromEmail('pat@gmail.com')).toBeNull();
  expect(websiteFromEmail('nonsense')).toBeNull();
});

test('a 5xx is retried, then succeeds', async () => {
  const axios = { post: jest.fn()
    .mockRejectedValueOnce(httpError(503, { message: 'unavailable' }))
    .mockResolvedValueOnce({ status: 200, data: {} }) };
  const r = await submitLeadGenForm(session(), null, axios, noSleep);
  expect(r.success).toBe(true);
  expect(axios.post).toHaveBeenCalledTimes(2);
});

test('a 4xx is not retried as-is', async () => {
  const axios = { post: jest.fn().mockRejectedValue(httpError(400, { errors: [{ errorType: 'INVALID_EMAIL', message: 'Error in fields.email' }] })) };
  const r = await submitLeadGenForm(session(), null, axios, noSleep);
  expect(r).toMatchObject({ success: false, rejected: true, status: 400 });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(r.fields.find((f) => f.name === 'email').value).toBe('pat@acme.ca');
});

test('website REQUIRED_FIELD → one retry with the email domain', async () => {
  const axios = { post: jest.fn()
    .mockRejectedValueOnce(httpError(400, WEBSITE_REQUIRED))
    .mockResolvedValueOnce({ status: 200, data: {} }) };
  const r = await submitLeadGenForm(session(), null, axios, noSleep);
  expect(r).toMatchObject({ success: true, repaired: { website: 'https://acme.ca' } });
  const retried = axios.post.mock.calls[1][1].fields;
  expect(retried.find((f) => f.name === 'website').value).toBe('https://acme.ca');
});

test('website REQUIRED_FIELD with a free-mail address → rejected, no guessed website', async () => {
  const axios = { post: jest.fn().mockRejectedValue(httpError(400, WEBSITE_REQUIRED)) };
  const r = await submitLeadGenForm(session('pat@gmail.com'), null, axios, noSleep);
  expect(r).toMatchObject({ success: false, rejected: true });
  expect(axios.post).toHaveBeenCalledTimes(1);
});

describe('upsertLeadGenContact', () => {
  const fields = [
    { name: 'email', value: 'pat@acme.ca' }, { name: 'firstname', value: 'Pat' },
    { name: 'industry_contact', value: 'Retail' }, { name: 'phone', value: '604' }, { name: 'what_do_you_spend_it_on_', value: '' }
  ];

  test('upserts every non-empty form field by email, with submission_source', async () => {
    const client = { post: jest.fn().mockResolvedValue({ data: {} }) };
    const r = await upsertLeadGenContact(fields, client);
    expect(r).toEqual({ success: true, properties: 'all' });
    const [url, body] = client.post.mock.calls[0];
    expect(url).toBe('/crm/v3/objects/contacts/batch/upsert');
    expect(body.inputs[0]).toMatchObject({ idProperty: 'email', id: 'pat@acme.ca' });
    expect(body.inputs[0].properties).toMatchObject({ industry_contact: 'Retail', submission_source: 'AI Grant Calculator Chat' });
    expect(body.inputs[0].properties).not.toHaveProperty('what_do_you_spend_it_on_');
  });

  test('a rejected property set falls back to the core identity fields', async () => {
    const client = { post: jest.fn().mockRejectedValueOnce(httpError(400, { message: 'bad enum' })).mockResolvedValueOnce({ data: {} }) };
    const r = await upsertLeadGenContact(fields, client);
    expect(r).toEqual({ success: true, properties: 'core' });
    expect(client.post.mock.calls[1][1].inputs[0].properties).not.toHaveProperty('industry_contact');
  });

  test('both fail → success false with the error', async () => {
    const client = { post: jest.fn().mockRejectedValue(httpError(403, { message: 'scope' })) };
    expect(await upsertLeadGenContact(fields, client)).toEqual({ success: false, error: 'scope' });
  });
});

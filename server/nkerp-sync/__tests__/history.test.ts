/**
 * Sync History reads: a missing tab reads as empty, but a refused Google sign-in (or any other refusal) must
 * surface as an error, never as "no history" (which would silently skip deallocations).
 *   npm run test:sync
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { GoogleSignInError, GoogleTokenSource } from '../googleAuth';
import { handleHistory } from '../handlers';
import { Rejected } from '../http';
import { isMissingTab, SheetsApi, SyncHistoryTab } from '../sheets';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };

type Reply = { status: number; body: unknown };
const realFetch = globalThis.fetch;

/** Stub fetch: the token endpoint and the Sheets values call answer as given. */
function stub(token: Reply, values: Reply) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const r = url.includes('oauth2.googleapis.com') ? token : values;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return seen;
}

const tab = () => new SyncHistoryTab(new SheetsApi('sheet-id', new GoogleTokenSource(key)));
const TOKEN_OK: Reply = { status: 200, body: { access_token: 't', expires_in: 3600 } };

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Sync History reads', () => {
  it('a refused Google sign-in is an error, not an empty history', async () => {
    stub({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } }, { status: 200, body: {} });
    await assert.rejects(tab().read(), (e: Error) => e instanceof GoogleSignInError && /refused the service-account sign-in/.test(e.message));
  });

  it('a missing Sync History tab still reads as empty', async () => {
    stub(TOKEN_OK, { status: 400, body: { error: { code: 400, message: "Unable to parse range: 'Sync History'!A:N", status: 'INVALID_ARGUMENT' } } });
    assert.deepEqual(await tab().read(), []);
  });

  it('any other refusal is an error', async () => {
    stub(TOKEN_OK, { status: 400, body: { error: { code: 400, message: 'Request contains an invalid argument.' } } });
    await assert.rejects(tab().read(), /invalid argument/);
    stub(TOKEN_OK, { status: 403, body: { error: { code: 403, message: 'The caller does not have permission' } } });
    await assert.rejects(tab().read(), /permission/);
  });

  it('reads rows by header', async () => {
    stub(TOKEN_OK, { status: 200, body: { values: [['Run ID', 'Action'], ['r1', 'SEEN']] } });
    assert.deepEqual(await tab().read(), [{ 'Run ID': 'r1', Action: 'SEEN' }]);
  });

  it('a refused sign-in makes the history unwritable, so deallocation is held', async () => {
    stub({ status: 400, body: { error: 'invalid_grant' } }, { status: 200, body: {} });
    assert.match((await tab().ensureWritable())!, /refused the service-account sign-in/);
  });

  it('only "Unable to parse range" counts as a missing tab', () => {
    assert.equal(isMissingTab(new Rejected("HTTP 400: Unable to parse range: 'Sync History'!A:N", 400)), true);
    assert.equal(isMissingTab(new GoogleSignInError('Google refused the service-account sign-in (HTTP 400)', 400)), false);
    assert.equal(isMissingTab(new Rejected('HTTP 400: Request contains an invalid argument.', 400)), false);
    assert.equal(isMissingTab(new Error('Unable to parse range')), false);
  });

  it('the history endpoint reports the sign-in error instead of "no runs"', async () => {
    const res = await handleHistory(new Request('http://x/api/nkerp-sync/history'), {
      credentials: () => ({ nkerp: true, google: true, googleAccount: key.client_email, problem: null }),
      readHistory: () => Promise.reject(new GoogleSignInError('Google refused the service-account sign-in (HTTP 400)', 400)),
    });
    const body = await res.json();
    assert.deepEqual(body.runs, []);
    assert.match(body.error, /Could not read Sync History: Google refused the service-account sign-in/);
  });
});

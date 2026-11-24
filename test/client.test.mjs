import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, ORIGIN, verificationUrl } from '../src/client.mjs';
import { createProvider } from '../index.mjs';

const token = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 };
const device = { device_code: 'fixture-device', user_code: 'ABCD-EFGH', verification_uri: `${ORIGIN}/oauth/device`, interval: 5, expires_in: 600 };
const me = { id: 42, account: { id: 'personal' } };
const model = { id: 'pro', display_name: 'Pro by Cenmax AI', owned_by: 'Cenmax AI', context_window: 100000, max_output_tokens: 8000, capabilities: { reasoning: true } };
function fixture(responses) {
  const calls = []; let clock = 0;
  const client = createClient({ now: () => clock, sleep: async ms => { clock += ms; }, fetchFn: async (url, options) => {
    calls.push({ url, options });
    const [body, status = 200] = responses.shift();
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  } });
  return { client, calls };
}
test('device pending and slow_down preserve protocol and bind account', async () => {
  const { client, calls } = fixture([[device], [{ error: 'authorization_pending' }, 400], [{ error: 'slow_down' }, 400], [token], [me]]);
  let display;
  const result = await client.login({ show: d => { display = d; } });
  assert.equal(result.accountId, '42:personal');
  assert.equal(display.code, device.user_code);
  assert.equal(calls.length, 5);
  for (const { url, options } of calls) { assert.equal(new URL(url).origin, ORIGIN); assert.equal(options.redirect, 'error'); }
  assert.equal(calls[0].options.body.get('scope'), 'profile chat');
  assert.equal(calls[1].options.body.get('client_id'), 'cenmax-openclaw');
});
test('reject hostile authorization URL before presenting or opening it', async () => {
  for (const url of ['https://evil.example/oauth/device', 'http://console.ai.cenmax.in/oauth/device', `${ORIGIN}/other`, `${ORIGIN}/oauth/device#secret`, 'javascript:alert(1)']) {
    assert.throws(() => verificationUrl(url));
    const { client } = fixture([[{ ...device, verification_uri_complete: url }]]);
    let shown = false;
    await assert.rejects(client.login({ show: () => { shown = true; } })); assert.equal(shown, false);
  }
});
test('device denial is neutral and never echoes backend secrets', async () => {
  const { client } = fixture([[device], [{ error: 'access_denied', error_description: 'fixture-sensitive-detail' }, 400]]);
  await assert.rejects(client.login(), e => !String(e).includes('fixture-sensitive-detail'));
});
test('refreshes coalesce and return rotated tokens without a profile roundtrip', async () => {
  const { client, calls } = fixture([[token]]);
  const c = { provider: 'cenmax', refresh: 'old-refresh', accountId: '42:personal' };
  const [a, b] = await Promise.all([client.refresh(c), client.refresh(c)]);
  assert.equal(a.refresh, token.refresh_token); assert.equal(a, b); assert.equal(calls.length, 1);
  assert.equal(a.accountId, '42:personal');
  assert.equal(calls[0].url, `${ORIGIN}/oauth/token`);
});
test('refresh failure is never automatically retried', async () => {
  const { client, calls } = fixture([[{ error: 'temporarily_unavailable' }, 503]]);
  await assert.rejects(client.refresh({ provider: 'cenmax', refresh: 'old-refresh', accountId: '42:personal' }));
  assert.equal(calls.length, 1);
});
test('uncertain refresh errors offer no recovery evidence to the durable OAuth manager', async () => {
  for (const kind of ['network', 'malformed', 'server']) {
    let calls = 0;
    const client = createClient({ fetchFn: async () => {
      calls++;
      if (kind === 'network') throw new Error('fixture-sensitive-network-detail');
      return new Response(JSON.stringify(kind === 'malformed' ? { ...token, refresh_token: '' } : { error: 'temporarily_unavailable' }), {
        status: kind === 'server' ? 503 : 200,
      });
    } });
    await assert.rejects(client.refresh({ provider: 'cenmax', refresh: 'old-refresh', accountId: '42:personal' }), error => {
      assert.equal(error.name, 'CenmaxError');
      assert.equal(error.oauthRefreshFailure, undefined);
      assert.equal(error.recovery, undefined);
      assert.equal(error.retryable, undefined);
      assert.ok(!String(error).includes('fixture-sensitive-network-detail'));
      return true;
    });
    assert.equal(calls, 1);
  }
});
test('catalog uses only public account models and conservative capabilities', async () => {
  const { client } = fixture([[{ data: [model, { ...model, id: 'worker', display_name: 'Worker by Cenmax AI', capabilities: { vision: 'yes', reasoning: 'yes' } }] }]]);
  const rows = await client.models('fixture-access');
  assert.equal(rows[0].id, 'pro'); assert.equal(rows[0].reasoning, true);
  assert.deepEqual(rows[1].input, ['text']); assert.equal(rows[1].reasoning, false);
  assert.equal(rows[0].baseUrl, undefined);
});
test('hostile metadata is rejected rather than displayed', async () => {
  for (const patch of [{ id: 'private/model' }, { display_name: 'foreign-model' }, { display_name: 'Cenmax AI\nspoof' }, { owned_by: 'foreign' }, { context_window: Infinity }]) {
    const { client } = fixture([[{ data: [{ ...model, ...patch }] }]]);
    await assert.rejects(client.models('fixture-access'));
  }
});
test('oversized response body and network errors are neutral', async () => {
  const client = createClient({ fetchFn: async () => new Response('a'.repeat(1024 * 1024 + 1)) });
  await assert.rejects(client.models('fixture-access'), /Cenmax AI request failed/);
  const bad = createClient({ fetchFn: async () => { throw new Error('fixture-secret'); } });
  await assert.rejects(bad.models('fixture-access'), e => !String(e).includes('fixture-secret'));
});
test('provider routes OAuth catalog without persisting bearer in configuration', async () => {
  const provider = createProvider({ models: async () => [{ id: 'pro', name: 'Pro by Cenmax AI' }], login: async () => ({ type: 'oauth', provider: 'cenmax', access: 'fixture-secret' }) });
  const result = await provider.auth[0].run({ prompter: { note: async () => {} }, isRemote: true });
  assert.equal(result.defaultModel, 'cenmax/pro');
  assert.ok(!JSON.stringify(result.configPatch).includes('fixture-secret'));
  assert.equal(await provider.catalog.run({ resolveProviderAuth: () => ({ mode: 'api_key', apiKey: 'fixture-secret' }) }), null);
});
test('runtime refuses credential forwarding to model endpoint overrides', async () => {
  const p = createProvider();
  const model = { provider: 'cenmax', baseUrl: `${ORIGIN}/app/v1`, api: 'openai-completions' };
  const ctx = { provider: 'cenmax', model, apiKey: 'fixture-access', authMode: 'oauth' };
  assert.equal((await p.prepareRuntimeAuth(ctx)).baseUrl, model.baseUrl);
  for (const patch of [{ baseUrl: 'https://evil.example/v1' }, { baseUrl: `${model.baseUrl}?redirect=evil` }, { api: 'openai-responses' }, { provider: 'foreign' }]) {
    await assert.rejects(p.prepareRuntimeAuth({ ...ctx, model: { ...model, ...patch } }));
    assert.throws(() => p.normalizeResolvedModel({ ...ctx, model: { ...model, ...patch } }));
  }
  assert.equal(p.normalizeResolvedModel({ provider: 'foreign' }), undefined);
});
test('approval URL does not display service-supplied query text', async () => {
  const { client } = fixture([[{ ...device, verification_uri_complete: `${ORIGIN}/oauth/device?user_code=WRONG&next=evil` }], [token], [me]]);
  let shown;
  await client.login({ show: value => { shown = value.url; } });
  assert.equal(shown, `${ORIGIN}/oauth/device?user_code=ABCD-EFGH`);
});

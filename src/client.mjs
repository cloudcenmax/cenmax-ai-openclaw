import { setTimeout as delay } from 'node:timers/promises';

export const ORIGIN = 'https://console.ai.cenmax.in';
export const BASE_URL = `${ORIGIN}/app/v1`;
export const CLIENT_ID = 'cenmax-openclaw';
const SCOPES = 'profile chat';
const MAX_BYTES = 1024 * 1024;

export class CenmaxError extends Error {
  constructor(code = 'request_failed') {
    super(`Cenmax AI ${code === 'sign_in_required' ? 'sign-in required. Run OpenClaw model authentication again.' : 'request failed. Please try again.'}`);
    this.name = 'CenmaxError';
    this.code = code;
  }
}

function validString(value, limit = 16384) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x20\x7f]/.test(value);
}

export function verificationUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.pathname !== '/oauth/device' || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new CenmaxError(); }
}

export function createClient({ fetchFn = globalThis.fetch, now = Date.now, sleep = delay } = {}) {
  async function request(path, { form, token, signal } = {}) {
    if (!/^\/(oauth\/(device\/code|token|revoke)|app\/v1\/(me|models))$/.test(path)) throw new CenmaxError();
    let response;
    try {
      response = await fetchFn(`${ORIGIN}${path}`, {
        method: form ? 'POST' : 'GET', redirect: 'error',
        headers: { Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form ? new URLSearchParams(form) : undefined,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== ORIGIN)) throw new Error();
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let bytes = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > MAX_BYTES) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      return { ok: response.ok, status: response.status, body };
    } catch { throw new CenmaxError(signal?.aborted ? 'cancelled' : 'request_failed'); }
  }

  function credential(body) {
    if (!validString(body.access_token) || !validString(body.refresh_token) || !/^bearer$/i.test(body.token_type) || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400) throw new CenmaxError();
    return { type: 'oauth', provider: 'cenmax', access: body.access_token, refresh: body.refresh_token, expires: now() + body.expires_in * 1000 };
  }

  async function identity(token, signal) {
    const r = await request('/app/v1/me', { token, signal });
    if (!r.ok || !['number', 'string'].includes(typeof r.body.id) || !validString(r.body.account?.id, 128)) throw new CenmaxError('sign_in_required');
    return `${r.body.id}:${r.body.account.id}`;
  }

  async function login({ show, signal } = {}) {
    const start = await request('/oauth/device/code', { form: { client_id: CLIENT_ID, scope: SCOPES }, signal });
    const d = start.body;
    if (!start.ok || !validString(d.device_code) || typeof d.user_code !== 'string' || !/^[A-Z0-9-]{4,32}$/i.test(d.user_code) || !Number.isFinite(d.expires_in) || d.expires_in <= 0 || d.expires_in > 1800) throw new CenmaxError();
    verificationUrl(d.verification_uri_complete || d.verification_uri);
    // Construct the approval query locally; never display service-supplied queries.
    const url = `${ORIGIN}/oauth/device?user_code=${encodeURIComponent(d.user_code)}`;
    let interval = Number.isFinite(d.interval) ? Math.max(5, Math.min(d.interval, 60)) : 5;
    const deadline = now() + d.expires_in * 1000;
    await show?.({ url, code: d.user_code });
    while (now() < deadline) {
      await sleep(Math.min(interval * 1000, deadline - now()), undefined, { signal });
      if (now() >= deadline) break;
      const r = await request('/oauth/token', { form: { client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: d.device_code }, signal });
      if (r.ok) {
        const c = credential(r.body);
        return { ...c, accountId: await identity(c.access, signal) };
      }
      if (r.body.error === 'authorization_pending') continue;
      if (r.body.error === 'slow_down') { interval += 5; continue; }
      throw new CenmaxError('sign_in_required');
    }
    throw new CenmaxError('sign_in_required');
  }

  const refreshes = new Map();
  function refresh(c) {
    if (c.provider !== 'cenmax' || !validString(c.refresh) || !validString(c.accountId, 256)) return Promise.reject(new CenmaxError('sign_in_required'));
    // The host owns the durable cross-process refresh lock and token persistence.
    // Coalesce duplicate calls within this plugin instance too.
    if (refreshes.has(c.refresh)) return refreshes.get(c.refresh);
    const operation = (async () => {
      const r = await request('/oauth/token', { form: { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: c.refresh } });
      if (!r.ok) throw new CenmaxError('sign_in_required');
      const next = credential(r.body);
      // The refresh grant is bound to the original account. Return replacements
      // immediately so optional profile lookups cannot lose a rotated token.
      return { ...c, ...next };
    })();
    refreshes.set(c.refresh, operation);
    operation.finally(() => refreshes.delete(c.refresh)).catch(() => {});
    return operation;
  }

  async function models(token, signal) {
    if (!validString(token)) throw new CenmaxError('sign_in_required');
    const r = await request('/app/v1/models', { token, signal });
    if (!r.ok || !Array.isArray(r.body.data)) throw new CenmaxError();
    return r.body.data.map(m => {
      if (!m || !/^[a-z][a-z0-9_-]{0,63}$/.test(m.id) || m.owned_by !== 'Cenmax AI' || typeof m.display_name !== 'string' || !m.display_name.includes('Cenmax AI') || /[\x00-\x1f\x7f]/.test(m.display_name) || m.display_name.length > 128 || !Number.isSafeInteger(m.context_window) || m.context_window <= 0 || !Number.isSafeInteger(m.max_output_tokens) || m.max_output_tokens <= 0) throw new CenmaxError();
      return { id: m.id, name: m.display_name, reasoning: m.capabilities?.reasoning === true, input: m.capabilities?.vision === true ? ['text', 'image'] : ['text'], contextWindow: m.context_window, maxTokens: m.max_output_tokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    });
  }
  return { login, refresh, models };
}

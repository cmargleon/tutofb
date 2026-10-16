// Run inside the trusted HTTP tool, not inside an LLM prompt. No credential is logged.
import policy from '../shared/src/automationPolling.json' with { type: 'json' };
import { setTimeout as delay } from 'node:timers/promises';
export const POLLING_POLICY = Object.freeze(policy);
const terminalStatuses = new Set(['completed', 'failed', 'needs_attention']);

// Persist createdAt/deadline with jobId in durable tools. Gmail scheduling is independent.
export function getPollingPlan(job, now = Date.now()) {
  if (terminalStatuses.has(job.status)) return { done: true, timedOut: false, delaySeconds: 0 };
  const createdAt = Date.parse(job.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error('Missing job creation time; refresh job status before polling.');
  const deadline = createdAt + POLLING_POLICY.timeoutSeconds * 1000;
  const remaining = deadline - now;
  if (remaining <= 0) return { done: false, timedOut: true, delaySeconds: 0 };
  const interval = now - createdAt < POLLING_POLICY.initialWindowSeconds * 1000
    ? POLLING_POLICY.initialIntervalSeconds : POLLING_POLICY.subsequentIntervalSeconds;
  return { done: false, timedOut: false, delaySeconds: Math.min(interval, remaining / 1000) };
}
export class AutomationPollingTimeout extends Error {
  constructor(job) { super(`Monitoring timed out for job ${job.jobId}; production may still be running. Resume with the same jobId.`); this.name = 'AutomationPollingTimeout'; this.jobId = job.jobId; this.lastStatus = job.status; }
}
export class ManglarAutomationClient {
  #token = null;
  #expiresAt = 0;
  #getSecret;
  #fetch;
  #renewal = null;
  constructor({ clientId = 'chatgpt-work', getClientSecret, baseUrl = 'https://tutofb-260320-1003.web.app/api/automation', fetchImpl = fetch, allowLocalEmulator = false } = {}) {
    const url = new URL(baseUrl);
    const local = allowLocalEmulator && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!local && (url.protocol !== 'https:' || !['tutofb-260320-1003.web.app', 'us-central1-tutofb-260320-1003.cloudfunctions.net'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Untrusted Manglar base URL.');
    if (typeof getClientSecret !== 'function') throw new Error('A secure credential provider is required.');
    this.baseUrl = url.href.replace(/\/$/, ''); this.clientId = clientId; this.#getSecret = getClientSecret; this.#fetch = fetchImpl;
  }
  async #authorize(force = false, signal) {
    if (!force && this.#token && Date.now() < this.#expiresAt - 60_000) return;
    if (this.#renewal) return this.#renewal;
    this.#renewal = this.#renewToken(signal);
    try { await this.#renewal; } finally { this.#renewal = null; }
  }
  async #renewToken(signal) {
    const secret = await this.#getSecret();
    const response = await this.#fetch(`${this.baseUrl}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: secret }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Manglar credential renewal failed (HTTP ${response.status}); no credential values logged.`);
    const body = await response.json();
    if (typeof body.access_token !== 'string' || body.token_type !== 'Bearer' || !Number.isFinite(body.expires_in)) throw new Error('Invalid token response.');
    this.#token = body.access_token; this.#expiresAt = Date.now() + body.expires_in * 1000;
  }
  async #request(path, options = {}, refreshed = false) {
    options.signal?.throwIfAborted();
    await this.#authorize(false, options.signal);
    const tokenUsed = this.#token;
    const response = await this.#fetch(`${this.baseUrl}${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${tokenUsed}` }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
    if (response.status === 401 && !refreshed) { if (this.#token === tokenUsed) await this.#authorize(true, options.signal); return this.#request(path, options, true); }
    if (!response.ok) throw new Error(`Manglar request failed (HTTP ${response.status}); inspect non-sensitive operation details in Manglar.`);
    return response.json();
  }
  upload(bytes, contentType = 'image/jpeg') { return this.#request('/uploads', { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }); }
  createJob(payload) { return this.#request('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  /** For a persistent tool process; durable schedulers can instead use getPollingPlan. */
  async waitForJob(initialJob, { signal, now = Date.now, sleep = (ms, signal) => delay(ms, undefined, { signal }) } = {}) {
    let job = initialJob;
    for (;;) {
      signal?.throwIfAborted();
      const plan = getPollingPlan(job, now());
      if (plan.done) return job;
      if (plan.timedOut) throw new AutomationPollingTimeout(job);
      await sleep(plan.delaySeconds * 1000, signal);
      // Do not issue another request when the monitoring deadline has elapsed.
      if (getPollingPlan(job, now()).timedOut) throw new AutomationPollingTimeout(job);
      const remaining = Date.parse(job.createdAt) + POLLING_POLICY.timeoutSeconds * 1000 - now();
      const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
      const requestSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
      try { job = await this.getJob(job.jobId, { signal: requestSignal }); }
      catch (error) {
        if (!signal?.aborted && deadlineSignal.aborted) throw new AutomationPollingTimeout(job);
        throw error;
      }
    }
  }
  getJob(jobId, { signal } = {}) {
    if (!/^[\w-]{1,200}$/.test(jobId)) throw new Error('Invalid jobId.');
    return this.#request(`/jobs/${jobId}`, { signal });
  }
}

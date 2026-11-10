// PayPal REST client for the Disputes v1 API (sandbox by default).
// Used both against the real sandbox (api-m.sandbox.paypal.com) and against the local simulator.
export const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';

const BOUNDARY = '----disputedesk-boundary-7f3a9c';
const multipartBody = (obj) => `--${BOUNDARY}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${BOUNDARY}--\r\n`;

export class PayPalError extends Error {
  constructor(status, body, where) {
    super(`PayPal ${where} -> HTTP ${status}: ${body?.name ?? ''} ${body?.message ?? ''}`.trim());
    this.status = status; this.body = body;
  }
}

export class PayPalRest {
  constructor({ baseUrl = SANDBOX_URL, clientId, clientSecret, accessToken, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = clientId; this.clientSecret = clientSecret;
    this.token = accessToken ?? null; this.tokenFixed = !!accessToken;
    this.fetch = fetchImpl;
    this.name = 'rest';
    this.log = []; // recent API calls, shown in the dashboard's "PayPal API calls" panel
  }
  async authenticate() {
    if (this.tokenFixed) return this.token;
    if (!this.clientId || !this.clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (or PAYPAL_ACCESS_TOKEN) are required');
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const r = await this.fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST', headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new PayPalError(r.status, j, 'oauth2/token');
    this.token = j.access_token;
    return this.token;
  }
  async #call(method, path, body, retry = true, multipartInput = false) {
    if (!this.token) await this.authenticate();
    const t0 = Date.now();
    const r = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/json', ...(body ? { 'content-type': multipartInput ? `multipart/form-data; boundary=${BOUNDARY}` : 'application/json' } : {}) },
      body: body ? (multipartInput ? multipartBody(body) : JSON.stringify(body)) : undefined,
    });
    this.log.push({ at: new Date().toISOString(), method, path, status: r.status, ms: Date.now() - t0 });
    if (this.log.length > 200) this.log.shift();
    if (r.status === 401 && retry && !this.tokenFixed) { this.token = null; return this.#call(method, path, body, false, multipartInput); }
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) throw new PayPalError(r.status, j, `${method} ${path}`);
    return j;
  }
  async listDisputes({ disputeState } = {}) {
    const q = disputeState ? `?dispute_state=${encodeURIComponent(disputeState)}` : '';
    const j = await this.#call('GET', `/v1/customer/disputes${q}`);
    return j.items ?? [];
  }
  getDispute(id) { return this.#call('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`); }
  // PayPal's provide-evidence takes multipart/form-data: a JSON `input` part (+ optional document files).
  provideEvidence(id, evidences) { return this.#call('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { evidences }, true, true); }
  acceptClaim(id, { note, type = 'REFUND' }) { return this.#call('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { note, accept_claim_type: type }); }
  makeOffer(id, { note, amount, offerType = 'REFUND' }) { return this.#call('POST', `/v1/customer/disputes/${encodeURIComponent(id)}/make-offer`, { note, offer_amount: amount, offer_type: offerType }); }
}

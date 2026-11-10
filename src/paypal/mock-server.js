// A small local PayPal *sandbox simulator* for DEMO mode.
// It implements the subset of the Disputes v1 REST surface DisputeDesk uses, with request/response shapes
// taken from PayPal's published OpenAPI spec (paypal/paypal-rest-api-specifications). It is NOT PayPal:
// it exists so the real REST client code path runs end-to-end without credentials.
import http from 'node:http';
import { buildDemoData } from '../demo/scenarios.js';

// Evidence types the simulator accepts: the full Disputes v1 `evidence_type` enum is large; DisputeDesk uses this subset.
const ACCEPTED_EVIDENCE = new Set([
  'PROOF_OF_FULFILLMENT', 'PROOF_OF_DELIVERY_SIGNATURE', 'PROOF_OF_REFUND', 'PROOF_OF_RECEIPT_COPY', 'RETURN_POLICY',
  'ITEM_DESCRIPTION', 'ORDER_DETAILS', 'DELIVERY_ADDRESS', 'BUYER_RESPONSE', 'OTHER', 'ADDITIONAL_TRACKING_INFORMATION',
  'DETAILS_OF_PURCHASE', 'PROOF_OF_RESHIPMENT',
]);

export function createMockPayPal({ now = new Date(), data = buildDemoData(now) } = {}) {
  const disputes = new Map();
  const load = () => { disputes.clear(); for (const d of data.disputes) disputes.set(d.dispute_id, structuredClone(d)); };
  load();
  const calls = [];
  const tokens = new Set();
  let seq = 1;

  const summary = (d) => ({
    dispute_id: d.dispute_id, create_time: d.create_time, update_time: d.update_time, reason: d.reason, status: d.status,
    dispute_state: d.dispute_state, dispute_amount: d.dispute_amount, dispute_life_cycle_stage: d.dispute_life_cycle_stage,
    dispute_channel: d.dispute_channel, seller_response_due_date: d.seller_response_due_date,
    links: [{ href: `/v1/customer/disputes/${d.dispute_id}`, rel: 'self', method: 'GET' }],
  });
  const withLinks = (d) => ({
    ...d,
    links: [
      { href: `/v1/customer/disputes/${d.dispute_id}`, rel: 'self', method: 'GET' },
      ...(d.status === 'WAITING_FOR_SELLER_RESPONSE'
        ? ['provide-evidence', 'accept-claim', 'make-offer'].map((r) => ({ href: `/v1/customer/disputes/${d.dispute_id}/${r}`, rel: r, method: 'POST' }))
        : []),
    ],
  });

  async function readJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try {
      if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) {
        // Like PayPal: the JSON document is the part named "input".
        const m = raw.match(/name="input"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--/);
        return m ? JSON.parse(m[1]) : { __invalid: true };
      }
      return JSON.parse(raw);
    } catch { return { __invalid: true }; }
  }
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const err = (res, code, name, message, details) => send(res, code, { name, message, debug_id: `mock${Date.now().toString(36)}`, ...(details ? { details } : {}) });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (req.method === 'POST' && path === '/v1/oauth2/token') {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Basic ')) return err(res, 401, 'invalid_client', 'Client Authentication failed');
      const t = `MOCK-${Date.now().toString(36)}-${seq++}`;
      tokens.add(t);
      calls.push({ method: 'POST', path });
      return send(res, 200, { scope: 'https://uri.paypal.com/services/disputes/read-seller https://uri.paypal.com/services/disputes/update-seller', access_token: t, token_type: 'Bearer', app_id: 'APP-MOCKSIMULATOR', expires_in: 32400 });
    }
    if (req.method === 'GET' && path === '/__health') return send(res, 200, { ok: true, simulator: true });
    if (req.method === 'GET' && path === '/__calls') return send(res, 200, calls);
    if (req.method === 'POST' && path === '/__reset') { load(); calls.length = 0; return send(res, 200, { ok: true }); }
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!tokens.has(bearer)) return err(res, 401, 'AUTHENTICATION_FAILURE', 'Authentication failed due to invalid authentication credentials or a missing Authorization header.');

    const m = path.match(/^\/v1\/customer\/disputes(?:\/([^/]+))?(?:\/([a-z-]+))?$/);
    if (!m) return err(res, 404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.');
    const [, id, action] = m;
    const body = req.method === 'POST' ? await readJson(req) : {};
    if (body.__invalid) return err(res, 400, 'MALFORMED_REQUEST', 'Request body is not valid JSON.');
    calls.push({ method: req.method, path, body: req.method === 'POST' ? body : undefined });

    if (!id && req.method === 'GET') {
      let list = [...disputes.values()];
      const st = url.searchParams.get('dispute_state');
      if (st) list = list.filter((d) => d.dispute_state === st);
      return send(res, 200, { items: list.map(summary), links: [{ href: path, rel: 'self', method: 'GET' }] });
    }
    const d = disputes.get(id);
    if (!d) return err(res, 404, 'INVALID_RESOURCE_ID', 'Requested resource ID was not found.');
    if (req.method === 'GET' && !action) return send(res, 200, withLinks(d));
    if (req.method !== 'POST' || !action) return err(res, 405, 'METHOD_NOT_SUPPORTED', 'Method not supported');
    if (d.status !== 'WAITING_FOR_SELLER_RESPONSE')
      return err(res, 422, 'DISPUTE_NOT_IN_CORRECT_STATE', 'The dispute is not waiting for a seller response.', [{ issue: 'DISPUTE_NOT_IN_CORRECT_STATE' }]);

    if (action === 'provide-evidence') {
      if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return err(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'provide-evidence expects multipart/form-data with a JSON "input" part.');
      const ev = body.evidences;
      if (!Array.isArray(ev) || ev.length === 0) return err(res, 400, 'INVALID_REQUEST', 'evidences is required.', [{ field: '/evidences', issue: 'MISSING_REQUIRED_PARAMETER' }]);
      for (const [i, e] of ev.entries()) {
        if (!ACCEPTED_EVIDENCE.has(e.evidence_type)) return err(res, 422, 'INVALID_EVIDENCE_TYPE', 'evidence_type not accepted by the simulator.', [{ field: `/evidences/${i}/evidence_type`, value: e.evidence_type, issue: 'INVALID_PARAMETER_VALUE' }]);
        if (e.notes && e.notes.length > 2000) return err(res, 400, 'INVALID_REQUEST', 'notes exceeds 2000 characters.', [{ field: `/evidences/${i}/notes`, issue: 'VALUE_TOO_LONG' }]);
        for (const t of e.evidence_info?.tracking_info ?? []) {
          if (!t.carrier_name || !t.tracking_number) return err(res, 400, 'INVALID_REQUEST', 'tracking_info requires carrier_name and tracking_number.', [{ field: `/evidences/${i}/evidence_info/tracking_info`, issue: 'MISSING_REQUIRED_PARAMETER' }]);
        }
      }
      d.evidences = [...(d.evidences || []), ...ev.map((e) => ({ ...e, source: 'SUBMITTED_BY_SELLER', date: new Date().toISOString() }))];
      d.status = 'UNDER_REVIEW'; d.dispute_state = 'UNDER_PAYPAL_REVIEW'; d.update_time = new Date().toISOString();
      return send(res, 200, { links: [{ href: `/v1/customer/disputes/${id}`, rel: 'self', method: 'GET' }] });
    }
    if (action === 'accept-claim') {
      d.status = 'RESOLVED'; d.dispute_state = 'RESOLVED'; d.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: d.dispute_amount };
      d.update_time = new Date().toISOString(); d.accept_claim = { note: body.note, accept_claim_type: body.accept_claim_type ?? 'REFUND' };
      return send(res, 200, { links: [{ href: `/v1/customer/disputes/${id}`, rel: 'self', method: 'GET' }] });
    }
    if (action === 'make-offer') {
      if (!body.offer_amount?.value || !body.offer_type) return err(res, 400, 'INVALID_REQUEST', 'offer_amount and offer_type are required.');
      d.offer = { buyer_requested_amount: d.dispute_amount, seller_offered_amount: body.offer_amount, offer_type: body.offer_type, history: [{ actor: 'SELLER', event_type: 'PROPOSED', offer_type: body.offer_type, offer_amount: body.offer_amount, notes: body.note }] };
      d.status = 'WAITING_FOR_BUYER_RESPONSE'; d.dispute_state = 'REQUIRED_OTHER_PARTY_ACTION'; d.update_time = new Date().toISOString();
      return send(res, 200, { links: [{ href: `/v1/customer/disputes/${id}`, rel: 'self', method: 'GET' }] });
    }
    return err(res, 404, 'RESOURCE_NOT_FOUND', 'Unsupported action in simulator.');
  });

  return {
    server, data, calls,
    listen: (port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

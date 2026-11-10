// Dashboard + JSON API (no framework; node:http). The human approval gate lives here: nothing reaches
// PayPal until the owner clicks "Approve & send", which approves the exact payload digest the agent proposed.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTriage, approve, reject, submit } from '../engine/agent.js';
import { amountOf } from '../util.js';

const PUB = join(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };

export function createApp({ cfg, gateway, merchant, state, llm, label, mock, evalResultsPath, now = () => new Date() }) {
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString() || '{}'); } catch { return {}; } };
  const slim = (p) => ({ ...p, evidence: p.evidence, draft: { ...p.draft, llm_raw: undefined } });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/state') {
        const cases = state.all().sort((a, b) => a.hours_left - b.hours_left);
        return json(res, 200, { mode: cfg.mode, label, llm: llm.label, llmEnabled: llm.enabled, policy: cfg.policy, merchant: merchant.merchant?.name, cases: cases.map(slim), audit: state.verifyAudit(), simulator: !!mock || cfg.mode === 'demo' });
      }
      if (url.pathname === '/api/triage' && req.method === 'POST') {
        const out = await runTriage({ gateway, merchant, state, llm, policy: cfg.policy, now: now() });
        return json(res, 200, { triaged: out.length });
      }
      if (url.pathname === '/api/approve' && req.method === 'POST') {
        const { id, who = 'owner' } = await body(req);
        const p = approve(state, id, who);
        const r = await submit({ state, gateway, proposalId: id, actor: `human:${who}` });
        return json(res, 200, { status: r.proposal.status, result: r.proposal.result });
      }
      if (url.pathname === '/api/reject' && req.method === 'POST') {
        const { id, who = 'owner', reason = '' } = await body(req);
        reject(state, id, who, reason);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/audit') return json(res, 200, { verify: state.verifyAudit(), entries: state.auditTail(100).reverse() });
      if (url.pathname === '/api/paypal-calls') return json(res, 200, { base: gateway.baseUrl ?? gateway.rest?.baseUrl, calls: [...(gateway.log ?? gateway.rest?.log ?? [])].reverse().slice(0, 60) });
      if (url.pathname === '/api/eval') {
        if (evalResultsPath && existsSync(evalResultsPath)) return json(res, 200, JSON.parse(readFileSync(evalResultsPath, 'utf8')));
        return json(res, 404, { error: 'no eval results yet; run `npm run eval`' });
      }
      if (url.pathname === '/api/reset' && req.method === 'POST' && cfg.mode === 'demo') {
        state.reset();
        if (gateway.baseUrl) await fetch(`${gateway.baseUrl}/__reset`, { method: 'POST' }).catch(() => {});
        return json(res, 200, { ok: true });
      }
      // static
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = normalize(join(PUB, rel));
      if (!file.startsWith(PUB) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(readFileSync(file));
    } catch (e) {
      json(res, e.code === 'AWAITING_HUMAN_APPROVAL' ? 409 : 500, { error: e.message });
    }
  });
}

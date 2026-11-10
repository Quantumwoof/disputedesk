// DisputeDesk as an MCP server (stdio). Any MCP client (Claude Desktop, Cursor, an agent framework) can
// triage PayPal disputes and prepare evidence responses. Submitting is gated: `submit_response` only works
// after a human has approved the proposal in the dashboard (`npm run serve`) or with `disputedesk approve`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { bootstrap } from '../bootstrap.js';
import { runTriage, submit } from '../engine/agent.js';
import { amountOf, hoursUntil } from '../util.js';

const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

export function buildMcpServer(ctx) {
  const { gateway, merchant, state, llm, cfg } = ctx;
  const server = new McpServer({ name: 'disputedesk', version: '1.0.0' });
  const summarize = (c) => ({
    proposal_id: c.id, dispute_id: c.dispute_id, reason: c.reason, amount: `${c.amount.currency_code} ${c.amount.value}`, hours_left: c.hours_left,
    recommended_action: c.action, why: c.rationale[0], evidence_strength_pct: c.strength,
    evidence: c.evidence.map((e) => ({ id: e.id, type: e.type, checks: e.checks.map((k) => `${k.pass ? 'PASS' : 'FAIL'} ${k.label}`) })),
    guardrails: c.guardrails, draft: c.draft.text || null, draft_source: c.draft.source, draft_verified: c.draft.verified,
    paypal_call: c.proposal.call, status: c.status, next: c.status === 'proposed' ? 'A human must approve this proposal in the DisputeDesk dashboard before submit_response will work.' : undefined,
  });

  server.registerTool('list_open_disputes', { description: 'List PayPal disputes waiting on the seller (via the PayPal Disputes API / @paypal/mcp list_disputes).', inputSchema: {} }, async () => {
    const list = await gateway.listDisputes({ disputeState: 'REQUIRED_ACTION' });
    return text(list.map((d) => ({ dispute_id: d.dispute_id, reason: d.reason, amount: `${d.dispute_amount.currency_code} ${d.dispute_amount.value}`, hours_left: Math.round(hoursUntil(d.seller_response_due_date, new Date())) })));
  });

  server.registerTool('triage_dispute', {
    description: 'Read a dispute, gather the merchant\'s own records, and decide FIGHT / ACCEPT_CLAIM / OFFER_REFUND / HUMAN_REVIEW with a grounded draft response. Creates a proposal; sends nothing to PayPal.',
    inputSchema: { dispute_id: z.string().describe('PayPal dispute ID, e.g. PP-D-12345') },
  }, async ({ dispute_id }) => {
    const all = await runTriage({ gateway, merchant, state, llm, policy: cfg.policy, actor: 'mcp-agent' });
    const c = all.find((x) => x.dispute_id === dispute_id);
    return c ? text(summarize(c)) : fail(`dispute ${dispute_id} is not waiting on the seller`);
  });

  server.registerTool('triage_all', { description: 'Triage every open dispute and return a one-line summary for each.', inputSchema: {} }, async () => {
    const all = await runTriage({ gateway, merchant, state, llm, policy: cfg.policy, actor: 'mcp-agent' });
    return text(all.map((c) => ({ proposal_id: c.id, dispute_id: c.dispute_id, action: c.action, amount: `${c.amount.currency_code} ${c.amount.value}`, hours_left: c.hours_left, strength_pct: c.strength, status: c.status })));
  });

  server.registerTool('submit_response', {
    description: 'Send an approved proposal to PayPal (provide-evidence / accept-claim / make-offer). Fails unless a human approved this exact proposal.',
    inputSchema: { proposal_id: z.string() },
  }, async ({ proposal_id }) => {
    try { const r = await submit({ state, gateway, proposalId: proposal_id, actor: 'mcp-agent' }); return text({ status: r.proposal.status, paypal: r.proposal.result }); }
    catch (e) { return fail(e.message); }
  });

  server.registerTool('audit_log', { description: 'Tail the hash-chained audit log of agent and human actions.', inputSchema: { limit: z.number().int().min(1).max(100).default(20) } }, async ({ limit }) => text({ verify: state.verifyAudit(), entries: state.auditTail(limit) }));
  return server;
}

export async function main() {
  const ctx = await bootstrap();
  const server = buildMcpServer(ctx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`disputedesk MCP ready (${ctx.label}; AI: ${ctx.llm.label})\n`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StateStore } from '../src/engine/state.js';
import { approve } from '../src/engine/agent.js';
import { PayPalMcpGateway, resolvePayPalMcpBin } from '../src/paypal/mcp-gateway.js';
import { tmp } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/disputedesk.js', import.meta.url));
const parse = (r) => JSON.parse(r.content[0].text);

test('DisputeDesk MCP server: triage works, submit is blocked until a human approves', async () => {
  const dir = tmp();
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'], env: { ...process.env, DISPUTEDESK_MODE: 'demo', DISPUTEDESK_DATA: dir, PAYPAL_BASE_URL: '' }, stderr: 'ignore' });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['audit_log', 'list_open_disputes', 'submit_response', 'triage_all', 'triage_dispute']);
    const open = parse(await client.callTool({ name: 'list_open_disputes', arguments: {} }));
    assert.equal(open.length, 12);
    const all = parse(await client.callTool({ name: 'triage_all', arguments: {} }));
    const fight = all.find((x) => x.action === 'FIGHT');
    const one = parse(await client.callTool({ name: 'triage_dispute', arguments: { dispute_id: fight.dispute_id } }));
    assert.equal(one.recommended_action, 'FIGHT');
    assert.equal(one.draft_verified, true);
    assert.ok(one.evidence.length >= 3);

    const blocked = await client.callTool({ name: 'submit_response', arguments: { proposal_id: one.proposal_id } });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /AWAITING_HUMAN_APPROVAL/);

    // The human approves out-of-band (dashboard / CLI write the same state file).
    approve(new StateStore(dir), one.proposal_id, 'joshua');
    const sent = parse(await client.callTool({ name: 'submit_response', arguments: { proposal_id: one.proposal_id } }));
    assert.equal(sent.status, 'submitted');

    const audit = parse(await client.callTool({ name: 'audit_log', arguments: { limit: 50 } }));
    assert.equal(audit.verify.ok, true);
    assert.ok(audit.entries.some((e) => e.event === 'APPROVED' && e.actor === 'human:joshua'));
    assert.ok(audit.entries.some((e) => e.event === 'SUBMITTED'));
  } finally { await client.close(); }
});

test('PayPal\'s own MCP server (@paypal/mcp) exposes the dispute tools DisputeDesk calls', { skip: !resolvePayPalMcpBin() && '@paypal/mcp not installed' }, async () => {
  const gw = new PayPalMcpGateway({ accessToken: 'dummy-token-no-network-calls-made' });
  try {
    const names = await gw.toolNames();
    for (const n of ['list_disputes', 'get_dispute', 'accept_dispute_claim']) assert.ok(names.includes(n), `missing ${n}`);
    // Documents the gap DisputeDesk fills: the toolkit has no evidence-submission tool.
    assert.equal(names.some((n) => /evidence/i.test(n)), false);
  } finally { await gw.close(); }
});

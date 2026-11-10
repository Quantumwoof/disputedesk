import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockPayPal } from '../src/paypal/mock-server.js';
import { PayPalRest, PayPalError } from '../src/paypal/rest.js';
import { MerchantStore } from '../src/merchant/store.js';
import { StateStore } from '../src/engine/state.js';
import { runTriage, approve, reject, submit } from '../src/engine/agent.js';
import { buildDemoData } from '../src/demo/scenarios.js';
import { tmp, NOW } from './helpers.js';

async function rig() {
  const data = buildDemoData(NOW);
  const mock = createMockPayPal({ now: NOW, data });
  const port = await mock.listen(0);
  const rest = new PayPalRest({ baseUrl: `http://127.0.0.1:${port}`, clientId: 'id', clientSecret: 'secret' });
  const state = new StateStore(tmp());
  return { data, mock, rest, state, merchant: MerchantStore.fromDemo(data), port };
}

test('REST client: OAuth, list, get, and a rejected evidence type', async () => {
  const { mock, rest } = await rig();
  try {
    const list = await rest.listDisputes({ disputeState: 'REQUIRED_ACTION' });
    assert.equal(list.length, 12);
    const d = await rest.getDispute(list[0].dispute_id);
    assert.ok(d.links.some((l) => l.rel === 'provide-evidence'));
    await assert.rejects(() => rest.provideEvidence(d.dispute_id, [{ evidence_type: 'NOT_A_REAL_TYPE' }]), (e) => e instanceof PayPalError && e.status === 422);
    await assert.rejects(() => rest.provideEvidence(d.dispute_id, [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'DHL' }] } }]), (e) => e.status === 400);
  } finally { await mock.close(); }
});

test('REST client: refreshes the token after a 401', async () => {
  const { mock, rest } = await rig();
  try {
    await rest.listDisputes();
    rest.token = 'expired-token';
    assert.equal((await rest.listDisputes()).length, 12);
    assert.ok(mock.calls.filter((c) => c.path === '/v1/oauth2/token').length >= 2);
  } finally { await mock.close(); }
});

test('REST client: unauthenticated calls are refused by the simulator', async () => {
  const { mock, port } = await rig();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/customer/disputes`);
    assert.equal(r.status, 401);
  } finally { await mock.close(); }
});

test('approval gate: nothing is sent until a human approves; approval is bound to the digest', async () => {
  const { mock, rest, state, merchant } = await rig();
  try {
    const props = await runTriage({ gateway: rest, merchant, state, llm: null, now: NOW });
    assert.equal(props.length, 12);
    const fight = props.find((p) => p.action === 'FIGHT' && p.proposal.call === 'provide-evidence');
    // 1. not approved -> refuses, PayPal untouched
    await assert.rejects(() => submit({ state, gateway: rest, proposalId: fight.id }), (e) => e.code === 'AWAITING_HUMAN_APPROVAL');
    assert.equal(mock.calls.some((c) => c.path.endsWith('/provide-evidence')), false);
    // 2. tampering with the payload after approval is blocked
    approve(state, fight.id, 'joshua');
    const p = state.get(fight.id); p.proposal.payload.evidences[0].notes = 'changed after approval'; p.proposal.digest = 'deadbeef'; state.save(p);
    await assert.rejects(() => submit({ state, gateway: rest, proposalId: fight.id }), /changed after approval/);
    // 3. a clean proposal goes through exactly once
    const fight2 = props.filter((x) => x.action === 'FIGHT' && x.id !== fight.id)[0];
    approve(state, fight2.id, 'joshua');
    const r = await submit({ state, gateway: rest, proposalId: fight2.id, actor: 'human:joshua' });
    assert.equal(r.proposal.status, 'submitted');
    const sent = mock.calls.filter((c) => c.path.endsWith(`${fight2.dispute_id}/provide-evidence`));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.evidences.find((e) => e.notes === fight2.draft.text) !== undefined, true);
    const again = await submit({ state, gateway: rest, proposalId: fight2.id });
    assert.equal(again.already, true);
    assert.equal(mock.calls.filter((c) => c.path.endsWith(`${fight2.dispute_id}/provide-evidence`)).length, 1);
    assert.equal((await rest.getDispute(fight2.dispute_id)).dispute_state, 'UNDER_PAYPAL_REVIEW');
  } finally { await mock.close(); }
});

test('accept-claim and make-offer reach PayPal with the right bodies after approval', async () => {
  const { mock, rest, state, merchant } = await rig();
  try {
    const props = await runTriage({ gateway: rest, merchant, state, llm: null, now: NOW });
    const acc = props.find((p) => p.proposal.call === 'accept-claim');
    const off = props.find((p) => p.proposal.call === 'make-offer');
    for (const p of [acc, off]) { approve(state, p.id); await submit({ state, gateway: rest, proposalId: p.id }); }
    const a = mock.calls.find((c) => c.path.endsWith(`${acc.dispute_id}/accept-claim`));
    assert.equal(a.body.accept_claim_type, 'REFUND');
    const o = mock.calls.find((c) => c.path.endsWith(`${off.dispute_id}/make-offer`));
    assert.equal(o.body.offer_type, 'REFUND');
    assert.equal(o.body.offer_amount.value, off.amount.value);
    assert.equal((await rest.getDispute(acc.dispute_id)).status, 'RESOLVED');
  } finally { await mock.close(); }
});

test('human-review items never trigger a PayPal call; rejected proposals cannot be sent', async () => {
  const { mock, rest, state, merchant } = await rig();
  try {
    const props = await runTriage({ gateway: rest, merchant, state, llm: null, now: NOW });
    const human = props.find((p) => p.action === 'HUMAN_REVIEW');
    assert.equal(human.proposal.call, 'none');
    approve(state, human.id); await submit({ state, gateway: rest, proposalId: human.id });
    const rej = props.find((p) => p.action === 'FIGHT');
    reject(state, rej.id);
    await assert.rejects(() => submit({ state, gateway: rest, proposalId: rej.id }), /AWAITING_HUMAN_APPROVAL/);
    assert.equal(mock.calls.some((c) => /(provide-evidence|accept-claim|make-offer)$/.test(c.path)), false);
  } finally { await mock.close(); }
});

test('re-triage never overwrites an approved/submitted proposal', async () => {
  const { mock, rest, state, merchant } = await rig();
  try {
    const first = await runTriage({ gateway: rest, merchant, state, llm: null, now: NOW });
    const p = first.find((x) => x.proposal.call === 'accept-claim');
    approve(state, p.id);
    const second = await runTriage({ gateway: rest, merchant, state, llm: null, now: NOW });
    assert.equal(second.find((x) => x.id === p.id).status, 'approved');
  } finally { await mock.close(); }
});

test('audit log is hash-chained and detects tampering', async () => {
  const state = new StateStore(tmp());
  state.audit('agent', 'TRIAGED', 'PP-D-1', { a: 1 });
  state.audit('human:joshua', 'APPROVED', 'PP-D-1', { b: 2 });
  state.audit('agent', 'SUBMITTED', 'PP-D-1', {});
  assert.deepEqual(state.verifyAudit(), { ok: true, entries: 3 });
  const { readFileSync, writeFileSync } = await import('node:fs');
  const lines = readFileSync(state.auditFile, 'utf8').trim().split('\n');
  const e = JSON.parse(lines[1]); e.actor = 'human:attacker'; lines[1] = JSON.stringify(e);
  writeFileSync(state.auditFile, lines.join('\n') + '\n');
  assert.equal(state.verifyAudit().ok, false);
});

test('simulator mirrors PayPal: provide-evidence must be multipart with a JSON "input" part', async () => {
  const { mock, rest, port } = await rig();
  try {
    await rest.listDisputes();
    const id = (await rest.listDisputes())[0].dispute_id;
    const r = await fetch(`http://127.0.0.1:${port}/v1/customer/disputes/${id}/provide-evidence`, { method: 'POST', headers: { authorization: `Bearer ${rest.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ evidences: [] }) });
    assert.equal(r.status, 415);
  } finally { await mock.close(); }
});

test('merchant JSON export format loads for sandbox mode (data/merchant.example.json)', async () => {
  const { readFileSync } = await import('node:fs');
  const store = MerchantStore.fromJSON(JSON.parse(readFileSync(new URL('../data/merchant.example.json', import.meta.url), 'utf8')));
  const tx = Object.keys(store.records)[0];
  const v = store.byTransaction(tx);
  assert.ok(v.order.order_id.startsWith('KC-'));
  assert.equal(store.byTransaction('NOPE'), null);
});

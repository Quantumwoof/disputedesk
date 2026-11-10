// Orchestrates the pipeline and enforces the human approval gate.
//   fetch → read buyer messages → collect evidence → decide → draft → verify → PROPOSE
//   (human approves in the dashboard / CLI) → SUBMIT to PayPal.
// There is deliberately no code path that submits a proposal which has not been approved by a human.
import { analyzeMessages } from './messages.js';
import { buildEvidence, decide, evidenceStrength, DEFAULT_POLICY } from './triage.js';
import { draftResponse, evidenceForNarrative } from './narrative.js';
import { amountOf, hoursUntil, sha256, isoDay } from '../util.js';

export async function triageDispute({ dispute, view, llm, policy = DEFAULT_POLICY, now = new Date() }) {
  const pol = { ...DEFAULT_POLICY, ...policy };
  const signals = await analyzeMessages(dispute.messages ?? [], llm);
  const items = buildEvidence(dispute, view, pol);
  const decision = decide({ dispute, view, items, signals, policy: pol, now });
  const merchantName = view?.merchant?.name ?? 'The seller';
  const draft = await draftResponse({ dispute, action: decision.action, items, merchantName, offerAmount: decision.offerAmount, llm });

  let proposal = { call: 'none', payload: null };
  if (decision.action === 'FIGHT' && draft.verified) {
    const payloads = evidenceForNarrative(items, dispute.reason).filter((e) => e.payload).map((e) => ({ ...e.payload }));
    const primaryIdx = Math.max(0, payloads.findIndex((p) => ['PROOF_OF_FULFILLMENT', 'PROOF_OF_REFUND', 'ITEM_DESCRIPTION'].includes(p.evidence_type)));
    const primaryType = { CREDIT_NOT_PROCESSED: 'PROOF_OF_REFUND', MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'ITEM_DESCRIPTION' }[dispute.reason] ?? 'PROOF_OF_FULFILLMENT';
    const idx = payloads.findIndex((p) => p.evidence_type === primaryType);
    const pi = idx >= 0 ? idx : primaryIdx;
    payloads[pi] = { ...payloads[pi], notes: draft.text };
    proposal = { call: 'provide-evidence', payload: { evidences: payloads } };
  } else if (decision.action === 'ACCEPT_CLAIM') {
    proposal = { call: 'accept-claim', payload: { note: draft.text, accept_claim_type: 'REFUND' } };
  } else if (decision.action === 'OFFER_REFUND') {
    proposal = { call: 'make-offer', payload: { note: draft.text, offer_amount: decision.offerAmount ?? dispute.dispute_amount, offer_type: 'REFUND' } };
  }
  const used = new Set(decision.action === 'FIGHT' ? evidenceForNarrative(items, dispute.reason).map((e) => e.id) : []);
  for (const e of items) e.in_response = used.has(e.id);
  const guardrails = [];
  if (signals.injection_detected) guardrails.push('Prompt-injection attempt in buyer text: treated as data, ignored for the decision.');
  if (draft.llm_rejected) guardrails.push(`LLM draft rejected by the grounding verifier (${draft.llm_rejected.length} problem${draft.llm_rejected.length > 1 ? 's' : ''}); safe template used instead.`);
  if (decision.action === 'FIGHT' && !draft.verified) guardrails.push('Draft failed verification; nothing will be submitted.');

  const tx = dispute.disputed_transactions?.[0] ?? {};
  const digest = sha256(JSON.stringify({ id: dispute.dispute_id, proposal }));
  return {
    id: `prop_${dispute.dispute_id}`,
    dispute_id: dispute.dispute_id,
    reason: dispute.reason,
    amount: dispute.dispute_amount,
    created: dispute.create_time,
    due: dispute.seller_response_due_date,
    hours_left: Math.round(hoursUntil(dispute.seller_response_due_date, now)),
    buyer: tx.buyer?.name,
    item: tx.items?.[0]?.item_description,
    buyer_message: dispute.messages?.[0]?.content,
    action: decision.action,
    rationale: decision.rationale,
    trace: decision.trace,
    strength: evidenceStrength(items, { reason: dispute.reason, amount: amountOf(dispute.dispute_amount), signals, signatureAbove: pol.signatureAbove }),
    evidence: items,
    signals,
    guardrails,
    draft: { text: draft.text, source: draft.source, verified: draft.verified, problems: draft.problems, llm_rejected: draft.llm_rejected ?? null, llm_error: draft.llm_error ?? null, llm_raw: draft.llm_raw ?? null, sentences: draft.sentences },
    proposal: { ...proposal, digest },
    status: 'proposed',
    triaged_at: now.toISOString(),
  };
}

/** Pull open disputes from PayPal, triage each, persist proposals (never overwriting approved/submitted ones). */
export async function runTriage({ gateway, merchant, state, llm, policy, now = new Date(), actor = 'agent' }) {
  const summaries = await gateway.listDisputes({ disputeState: 'REQUIRED_ACTION' });
  const out = [];
  for (const s of summaries) {
    const existing = state.getByDispute(s.dispute_id);
    if (existing && ['approved', 'submitted', 'rejected'].includes(existing.status)) { out.push(existing); continue; }
    const d = await gateway.getDispute(s.dispute_id);
    const view = merchant.byTransaction(d.disputed_transactions?.[0]?.seller_transaction_id);
    const c = await triageDispute({ dispute: d, view, llm, policy, now });
    state.save(c);
    state.audit(actor, 'TRIAGED', c.dispute_id, { action: c.action, strength: c.strength, draft_source: c.draft.source, call: c.proposal.call, digest: c.proposal.digest });
    out.push(c);
  }
  return out;
}

export function approve(state, proposalId, who = 'owner') {
  const p = state.get(proposalId);
  if (!p) throw new Error(`unknown proposal ${proposalId}`);
  if (p.status !== 'proposed') throw new Error(`proposal is ${p.status}, cannot approve`);
  if (p.action === 'FIGHT' && !p.draft.verified) throw new Error('refusing to approve: draft did not pass grounding verification');
  p.status = 'approved'; p.approved_by = who; p.approved_at = new Date().toISOString(); p.approved_digest = p.proposal.digest;
  state.save(p); state.audit(`human:${who}`, 'APPROVED', p.dispute_id, { call: p.proposal.call, digest: p.proposal.digest });
  return p;
}
export function reject(state, proposalId, who = 'owner', reason = '') {
  const p = state.get(proposalId);
  if (!p) throw new Error(`unknown proposal ${proposalId}`);
  p.status = 'rejected'; p.rejected_by = who; state.save(p);
  state.audit(`human:${who}`, 'REJECTED', p.dispute_id, { reason });
  return p;
}

/** Execute an approved proposal against PayPal. Refuses anything not approved or altered since approval. */
export async function submit({ state, gateway, proposalId, actor = 'agent' }) {
  const p = state.get(proposalId);
  if (!p) throw new Error(`unknown proposal ${proposalId}`);
  if (p.status === 'submitted') return { already: true, proposal: p };
  if (p.status !== 'approved') { const e = new Error(`AWAITING_HUMAN_APPROVAL: proposal ${proposalId} is "${p.status}". Approve it in the dashboard (or \`disputedesk approve ${proposalId}\`) first.`); e.code = 'AWAITING_HUMAN_APPROVAL'; throw e; }
  if (p.approved_digest !== p.proposal.digest) throw new Error('proposal changed after approval; re-approval required');
  if (p.proposal.call === 'none') { p.status = 'submitted'; p.result = { note: 'No PayPal action required (human review item).' }; state.save(p); return { proposal: p }; }
  const live = await gateway.getDispute(p.dispute_id);
  if (live.status !== 'WAITING_FOR_SELLER_RESPONSE') throw new Error(`dispute is no longer waiting for the seller (status ${live.status})`);
  let res;
  try {
    if (p.proposal.call === 'provide-evidence') res = await gateway.provideEvidence(p.dispute_id, p.proposal.payload.evidences);
    else if (p.proposal.call === 'accept-claim') res = await gateway.acceptClaim(p.dispute_id, { note: p.proposal.payload.note, type: p.proposal.payload.accept_claim_type });
    else if (p.proposal.call === 'make-offer') res = await gateway.makeOffer(p.dispute_id, { note: p.proposal.payload.note, amount: p.proposal.payload.offer_amount, offerType: p.proposal.payload.offer_type });
  } catch (e) {
    p.status = 'failed'; p.result = { error: e.message }; state.save(p); state.audit(actor, 'SUBMIT_FAILED', p.dispute_id, { error: e.message }); throw e;
  }
  p.status = 'submitted'; p.submitted_at = new Date().toISOString(); p.result = { paypal: res };
  state.save(p); state.audit(actor, 'SUBMITTED', p.dispute_id, { call: p.proposal.call, digest: p.proposal.digest });
  return { proposal: p };
}

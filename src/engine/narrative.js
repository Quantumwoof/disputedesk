// Step 3: draft the written response that goes into PayPal's `notes` field.
// A deterministic template always exists (and is what runs offline). If an LLM is configured it proposes a
// better-flowing version; verify.js then accepts or rejects it, and a rejection silently falls back to the template.
import { verifyDraft } from './verify.js';
import { fmtMoney, isoDay } from '../util.js';

const NOTE_ORDER = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ['PROOF_OF_RECEIPT_COPY', 'PROOF_OF_FULFILLMENT', 'DELIVERY_SCAN', 'PROOF_OF_DELIVERY_SIGNATURE'],
  UNAUTHORISED: ['PROOF_OF_RECEIPT_COPY', 'PROOF_OF_FULFILLMENT', 'DELIVERY_SCAN', 'PROOF_OF_DELIVERY_SIGNATURE'],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ['PROOF_OF_RECEIPT_COPY', 'ITEM_DESCRIPTION', 'RETURN_POLICY'],
  CREDIT_NOT_PROCESSED: ['PROOF_OF_RECEIPT_COPY', 'PROOF_OF_REFUND'],
  DUPLICATE_TRANSACTION: ['PROOF_OF_RECEIPT_COPY', 'PROOF_OF_FULFILLMENT', 'ORDER_DETAILS'],
};

/** Pseudo-evidence E0: facts straight from the PayPal dispute object. */
export function disputeFacts(d, offerAmount) {
  const tx = d.disputed_transactions?.[0] ?? {};
  return { id: 'E0', type: 'DISPUTE', title: 'PayPal dispute', facts: [`PayPal dispute ${d.dispute_id} is for ${fmtMoney(d.dispute_amount)} on transaction ${tx.seller_transaction_id}.`, 'The seller can either refund the buyer or contest the dispute with records.', ...(offerAmount ? [`The proposed refund amount is ${fmtMoney(offerAmount)}.`] : [])], checks: [] };
}

export function evidenceForNarrative(items, reason) {
  const order = NOTE_ORDER[reason] ?? [];
  return order.flatMap((t) => items.filter((e) => e.type === t));
}

import { splitSentences } from "./verify.js";
const sentences = (s) => splitSentences(s);

export function templateDraft({ dispute, action, items, merchantName, offerAmount }) {
  const cite = (e, s) => `${s} [${e.id}]`;
  if (action === 'ACCEPT_CLAIM') return `We have reviewed this dispute and are accepting the claim, with a full refund of ${fmtMoney(dispute.dispute_amount)}. [E0]`;
  if (action === 'OFFER_REFUND') return `We are sorry for the trouble with this order and are offering a refund of ${fmtMoney(offerAmount ?? dispute.dispute_amount)} to resolve it. [E0]`;
  if (action !== 'FIGHT') return '';
  const ev = evidenceForNarrative(items, dispute.reason);
  const body = ev.flatMap((e) => e.facts.flatMap((f) => sentences(f).map((s) => cite(e, s))));
  const closing = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: () => { const d = ev.find((e) => e.type === 'DELIVERY_SCAN'); return d ? `This carrier delivery record shows the order was delivered to the address on the transaction. [${d.id}]` : ''; },
    UNAUTHORISED: () => { const d = ev.find((e) => e.type === 'DELIVERY_SCAN'); return d ? `This carrier delivery record shows the order was delivered to the address on the transaction. [${d.id}]` : ''; },
    CREDIT_NOT_PROCESSED: () => { const d = ev.find((e) => e.type === 'PROOF_OF_REFUND'); return d ? `The refund above was completed in PayPal. [${d.id}]` : ''; },
    DUPLICATE_TRANSACTION: () => { const d = ev.find((e) => e.type === 'ORDER_DETAILS'); return d ? `The two charges correspond to two separate orders, each shipped separately. [${d.id}]` : ''; },
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: () => { const d = ev.find((e) => e.type === 'ITEM_DESCRIPTION'); return d ? `The item was sold as described in the listing. [${d.id}]` : ''; },
  }[dispute.reason]?.() ?? '';
  const intro = `${merchantName} is responding to this dispute with the records below. [E0]`;
  return [intro, ...body, closing].filter(Boolean).join(' ');
}

const SYSTEM = `You write the seller's written response in a PayPal dispute, using ONLY the numbered facts provided.
Rules:
- 3 to 7 short, neutral sentences. No emotion, no accusations, no speculation, no legal claims.
- End EVERY sentence with the citation of the fact(s) it relies on, like [E2] or [E1][E3].
- Copy dates (YYYY-MM-DD), amounts, order numbers, carrier names and tracking numbers EXACTLY as written in the facts.
- Do not mention anything that is not in the facts (no photos, signatures, insurance, policies, or promises unless a fact states it).
- Output only the response text.`;

/** Returns { text, source, rejected?: problems[] }. Never returns unverified LLM text. */
export async function draftResponse({ dispute, action, items, merchantName, offerAmount, llm }) {
  const tmpl = templateDraft({ dispute, action, items, merchantName, offerAmount });
  const evidence = [disputeFacts(dispute, offerAmount), ...items];
  const tv = verifyDraft(tmpl, evidence);
  const base = { text: tv.ok ? tv.clean : '', template: tmpl, source: 'template', verified: tv.ok, problems: tv.problems, sentences: tv.sentences };
  if (action !== 'FIGHT' || !llm?.enabled) return base;
  const ev = [disputeFacts(dispute), ...evidenceForNarrative(items, dispute.reason)];
  const factList = ev.map((e) => `${e.id}: ${e.facts.join(' ')}`).join('\n');
  try {
    const out = await llm.chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Merchant: ${merchantName}\nFacts:\n${factList}\n\nWrite the response.` }], { temperature: 0.2, maxTokens: 900 });
    const v = verifyDraft(out, evidence);
    if (v.ok) return { ...base, text: v.clean, source: `llm:${llm.model}`, verified: true, problems: [], sentences: v.sentences, llm_raw: out };
    return { ...base, llm_rejected: v.problems, llm_raw: out };
  } catch (e) {
    return { ...base, llm_error: e.message };
  }
}

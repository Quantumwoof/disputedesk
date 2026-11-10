// Step 2: deterministic triage. Given a PayPal dispute + the merchant's own records, build typed evidence
// items (each with explicit pass/fail checks), then pick exactly one action by explicit, inspectable rules.
// The model never decides; it only supplies message signals (see messages.js) and drafts text (narrative.js).
import { amountOf, fmtMoney, isoDay, daysBetween, hoursUntil, money, norm } from '../util.js';

export const ACTIONS = ['FIGHT', 'ACCEPT_CLAIM', 'OFFER_REFUND', 'HUMAN_REVIEW'];
export const DEFAULT_POLICY = { minFightAmount: 10, signatureAbove: 750, shipWithinDays: 7 };

const samePostal = (a, b) => norm(a).replace(/\s/g, '') === norm(b).replace(/\s/g, '');
const check = (id, label, pass, detail, severity = 'required') => ({ id, label, pass: !!pass, detail, severity });

/** Build the typed evidence items the merchant can honestly support. Items are *only* created from real records. */
export function buildEvidence(dispute, view, policy) {
  const items = [];
  const add = (it) => { const e = { id: `E${items.length + 1}`, ...it }; items.push(e); return e; };
  if (!view) return items;
  const { order, shipment, refunds, returns, siblings, merchant } = view;
  const amt = amountOf(dispute.dispute_amount);
  const itemsText = order.items.map((i) => `${i.qty} × ${i.name}`).join(', ');

  add({
    type: 'PROOF_OF_RECEIPT_COPY', title: 'Order record',
    facts: [`Order ${order.order_id} placed ${isoDay(order.placed_at)} for ${itemsText}, total ${fmtMoney(money(order.total))}.`],
    checks: [check('amount_matches', 'Order total matches disputed amount', Math.abs(order.total - amt) < 0.005 || dispute.reason === 'CREDIT_NOT_PROCESSED' || dispute.reason === 'DUPLICATE_TRANSACTION', `order ${order.total.toFixed(2)} vs dispute ${amt.toFixed(2)}`, 'supporting')],
    payload: { evidence_type: 'PROOF_OF_RECEIPT_COPY', notes: `Order ${order.order_id}: ${itemsText}. Total ${fmtMoney(money(order.total))}. Placed ${isoDay(order.placed_at)}.` },
  });

  if (shipment) {
    const checks = [];
    const fulfil = [`Shipped ${isoDay(shipment.shipped_at)} via ${shipment.carrier}, tracking number ${shipment.tracking_number}.`];
    checks.push(check('tracking_verifiable', 'Verifiable carrier + tracking number', shipment.carrier && shipment.tracking_number, `${shipment.carrier} ${shipment.tracking_number}`));
    const lag = daysBetween(order.placed_at, shipment.shipped_at);
    checks.push(check('shipped_in_time', `Shipped within ${policy.shipWithinDays} days of payment`, lag <= policy.shipWithinDays, `${lag} day(s) after the order`, 'supporting'));
    add({
      type: 'PROOF_OF_FULFILLMENT', title: 'Shipment record', facts: fulfil, checks,
      payload: { evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: shipment.carrier, tracking_number: shipment.tracking_number }] }, notes: fulfil.join(' ') },
    });
    if (shipment.status === 'DELIVERED' && shipment.delivered_at) {
      const dChecks = [];
      const toTxn = shipment.delivered_to && samePostal(shipment.delivered_to.postal, order.ship_to.postal) && norm(shipment.delivered_to.country) === norm(order.ship_to.country);
      dChecks.push(check('delivered_status', 'Carrier status is DELIVERED', true, `delivered ${isoDay(shipment.delivered_at)}`));
      dChecks.push(check('address_match', 'Delivered to the address on the PayPal transaction', toTxn, `delivered to ${shipment.delivered_to?.postal}, ${shipment.delivered_to?.country}; transaction address ${order.ship_to.postal}, ${order.ship_to.country}`, 'blocking'));
      dChecks.push(check('delivery_after_shipment', 'Delivery date is after shipment date', new Date(shipment.delivered_at) >= new Date(shipment.shipped_at), `${isoDay(shipment.shipped_at)} → ${isoDay(shipment.delivered_at)}`));
      dChecks.push(check('delivered_before_dispute', 'Delivered before the dispute was opened', new Date(shipment.delivered_at) <= new Date(dispute.create_time), `delivered ${isoDay(shipment.delivered_at)}, dispute ${isoDay(dispute.create_time)}`, 'supporting'));
      const dFacts = [`Carrier ${shipment.carrier} reports delivered on ${isoDay(shipment.delivered_at)} to ${shipment.delivered_to.city}, ${shipment.delivered_to.country}, postal code ${shipment.delivered_to.postal}, which matches the shipping address on the transaction.`];
      if (!toTxn) dFacts[0] = `Carrier ${shipment.carrier} reports delivered on ${isoDay(shipment.delivered_at)} to postal code ${shipment.delivered_to?.postal}, which does NOT match the transaction address.`;
      add({
        type: 'DELIVERY_SCAN', title: 'Carrier delivery scan', facts: dFacts, checks: dChecks,
        payload: { evidence_type: 'ADDITIONAL_TRACKING_INFORMATION', evidence_info: { tracking_info: [{ carrier_name: shipment.carrier, tracking_number: shipment.tracking_number }] }, notes: dFacts[0] },
      });
      if (shipment.signature) {
        add({
          type: 'PROOF_OF_DELIVERY_SIGNATURE', title: 'Signature on delivery', facts: [`Signed for by ${shipment.signature} on ${isoDay(shipment.delivered_at)}.`],
          checks: [check('signature_present', 'Signature captured', true, shipment.signature)],
          payload: { evidence_type: 'PROOF_OF_DELIVERY_SIGNATURE', notes: `Signed for by ${shipment.signature}.` },
        });
      }
    } else {
      add({
        type: 'IN_TRANSIT_STATUS', title: 'Carrier status: not yet delivered', facts: [`Carrier ${shipment.carrier} shows status ${shipment.status}; last scan ${isoDay(shipment.events.at(-1).at)} at ${shipment.events.at(-1).location}.`],
        checks: [check('delivered_status', 'Carrier status is DELIVERED', false, `status ${shipment.status}`)], payload: null,
      });
    }
  }

  if (refunds.length) {
    const total = refunds.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.amount, 0);
    const f = refunds.map((r) => `Refund ${r.refund_id} of ${fmtMoney(money(r.amount, r.currency))} completed ${isoDay(r.issued_at)}.`);
    add({
      type: 'PROOF_OF_REFUND', title: 'Refund issued in PayPal', facts: f,
      checks: [check('refund_covers_dispute', 'Refunds cover the disputed amount', total + 0.005 >= amt, `refunded ${total.toFixed(2)} of ${amt.toFixed(2)}`, 'required')],
      payload: { evidence_type: 'PROOF_OF_REFUND', evidence_info: { refund_ids: refunds.map((r) => r.refund_id) }, notes: f.join(' ') },
      meta: { refunded: total },
    });
  }
  if (returns.length) {
    add({ type: 'RETURN_RECORD', title: 'Return received by merchant', facts: [`Return parcel ${returns[0].tracking_number} was received on ${isoDay(returns[0].received_at)}.`], checks: [check('return_received', 'Return parcel received', true, returns[0].tracking_number)], payload: null });
  }
  // Policies / listing text are always available to the merchant.
  const desc = order.items.map((i) => i.listing_description).join(' ');
  add({ type: 'ITEM_DESCRIPTION', title: 'Listing description as sold', facts: [`Listing: ${desc}`], checks: [check('description_on_file', 'Original listing text on file', !!desc, 'from order record', 'supporting')], payload: { evidence_type: 'ITEM_DESCRIPTION', notes: `Listing as sold: ${desc}`.slice(0, 1900) } });
  add({ type: 'RETURN_POLICY', title: 'Return policy', facts: [`Return policy: ${merchant.return_policy}`], checks: [check('policy_on_file', 'Return policy on file', !!merchant.return_policy, 'shop policy', 'supporting')], payload: { evidence_type: 'RETURN_POLICY', notes: merchant.return_policy.slice(0, 1900) } });

  // Duplicate-transaction evidence: separate genuine orders by the same buyer.
  const buyerEmail = dispute.disputed_transactions?.[0]?.buyer?.email;
  const dupes = siblings.filter((s) => Math.abs(s.order.total - order.total) < 0.005 && Math.abs(new Date(s.order.placed_at) - new Date(order.placed_at)) < 3 * 86400000);
  if (dupes.length && dispute.reason === 'DUPLICATE_TRANSACTION') {
    const s = dupes[0];
    const f = [`Order ${s.order.order_id} (PayPal transaction ${s.order.transaction_id}) is a separate order placed ${isoDay(s.order.placed_at)} for the same items; it shipped ${s.shipment ? `${isoDay(s.shipment.shipped_at)} via ${s.shipment.carrier}, tracking number ${s.shipment.tracking_number}` : 'never'}.`];
    add({
      type: 'ORDER_DETAILS', title: 'Second order is a genuine separate sale', facts: f,
      checks: [check('second_order_fulfilled', 'Second order was separately fulfilled', !!s.shipment, s.shipment ? s.shipment.tracking_number : 'no shipment'), check('buyer_email_same', 'Same buyer account', !!buyerEmail, buyerEmail ?? 'n/a', 'supporting')],
      payload: { evidence_type: 'ORDER_DETAILS', notes: f[0] }, meta: { sibling: s.order.order_id },
    });
  }
  return items;
}

const failed = (items, id) => items.some((e) => e.checks.some((c) => c.id === id && !c.pass));
const passed = (items, id) => items.some((e) => e.checks.some((c) => c.id === id && c.pass));
const has = (items, type) => items.some((e) => e.type === type);

// How much of what PayPal expects for this dispute reason can the merchant actually show? Weighted checklist;
// a requirement with no evidence at all counts as failed. This is a transparency score, not a win probability.
const REQUIRED = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: { tracking_verifiable: 2, delivered_status: 2, address_match: 2, delivery_after_shipment: 1, delivered_before_dispute: 1, shipped_in_time: 1 },
  UNAUTHORISED: { tracking_verifiable: 2, delivered_status: 2, address_match: 2, delivery_after_shipment: 1, delivered_before_dispute: 1, shipped_in_time: 1 },
  CREDIT_NOT_PROCESSED: { refund_covers_dispute: 6 },
  DUPLICATE_TRANSACTION: { second_order_fulfilled: 4, buyer_email_same: 1, tracking_verifiable: 1 },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: { description_on_file: 1, policy_on_file: 1, buyer_no_defect: 3 },
};
export function evidenceStrength(items, { reason, amount = 0, signals = null, signatureAbove = DEFAULT_POLICY.signatureAbove } = {}) {
  const req = { ...(REQUIRED[reason] ?? {}) };
  if ((reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' || reason === 'UNAUTHORISED') && amount > signatureAbove) req.signature_present = 2;
  const ok = new Set(items.flatMap((e) => e.checks.filter((c) => c.pass).map((c) => c.id)));
  if (signals && !signals.injection_detected && signals.intent === 'changed_mind' && !signals.mentions_damage) ok.add('buyer_no_defect');
  let got = 0, max = 0;
  for (const [id, w] of Object.entries(req)) { max += w; if (ok.has(id)) got += w; }
  return max ? Math.round((100 * got) / max) : 0;
}

/**
 * Decide. Returns { action, rationale[], trace[], params } where trace lists every rule that fired.
 * `signals` are the validated outputs of messages.js (or null/ignored if an injection was detected).
 */
export function decide(args) {
  const r = decideCore(args);
  // Fail safe: a buyer who tries to inject instructions can also be trying to suppress a signal (e.g. "I moved")
  // that would have stopped us from contesting. So a contest is never auto-proposed on top of an injection attempt.
  if (args.signals?.injection_detected && r.action === 'FIGHT') {
    r.trace.push({ rule: 'guardrail.injection_blocks_fight', outcome: 'HUMAN_REVIEW', because: 'Buyer text tried to instruct the agent, so message-derived checks (e.g. address change) cannot be trusted; a person must confirm before contesting.' });
    return { ...r, action: 'HUMAN_REVIEW', rationale: ['The buyer message contained instructions aimed at an AI agent. Evidence looks sufficient to contest, but a person should confirm before anything is sent.'] };
  }
  return r;
}

function decideCore({ dispute, view, items, signals, policy, now }) {
  const trace = [];
  const t = (rule, outcome, because) => trace.push({ rule, outcome, because });
  const amt = amountOf(dispute.dispute_amount);
  const sig = signals && !signals.injection_detected ? signals : null;
  if (signals?.injection_detected) t('guardrail.injection', 'IGNORE_MESSAGE_SIGNALS', 'Buyer text contained instructions aimed at an AI agent; it is treated as data only and cannot influence the decision.');
  const done = (action, why, extra = {}) => ({ action, rationale: [why], trace, ...extra });

  if (hoursUntil(dispute.seller_response_due_date, now) < 0) {
    t('deadline', 'HUMAN_REVIEW', `Response window closed ${isoDay(dispute.seller_response_due_date)}`);
    return done('HUMAN_REVIEW', 'The seller response window has closed; check the Resolution Center for appeal options.');
  }
  if (!view) { t('records.lookup', 'HUMAN_REVIEW', 'No merchant order found for this PayPal transaction ID'); return done('HUMAN_REVIEW', 'No matching order in your shop records for this PayPal transaction.'); }

  const { shipment, refunds, returns } = view;
  const fightOrAccept = (why, evidenceWhy) => {
    if (amt < policy.minFightAmount) {
      t('economics', 'ACCEPT_CLAIM', `Disputed ${amt.toFixed(2)} is below your fight threshold ${policy.minFightAmount.toFixed(2)}; evidence is sufficient but not worth the time`);
      return done('ACCEPT_CLAIM', `Evidence would win, but ${fmtMoney(dispute.dispute_amount)} is below your ${policy.minFightAmount.toFixed(2)} threshold for contesting. Accepting saves time.`);
    }
    t('economics', 'PASS', `Disputed ${amt.toFixed(2)} ≥ threshold ${policy.minFightAmount.toFixed(2)}`);
    return done('FIGHT', why, { evidenceWhy });
  };

  switch (dispute.reason) {
    case 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED':
    case 'UNAUTHORISED': {
      const unauth = dispute.reason === 'UNAUTHORISED';
      if (!shipment) { t('fulfilment.exists', 'ACCEPT_CLAIM', 'No shipment record exists for this order'); return done('ACCEPT_CLAIM', 'There is no shipment on record for this order, so there is nothing truthful to submit as proof of fulfilment. Accept and refund.'); }
      if (shipment.status !== 'DELIVERED') { t('delivery.status', 'HUMAN_REVIEW', `Carrier status ${shipment.status}`); return done('HUMAN_REVIEW', `Parcel is still ${shipment.status.toLowerCase().replace('_', ' ')}; PayPal asks for proof of delivery on Item Not Received disputes. Decide whether to wait, message the buyer, or refund.`); }
      if (failed(items, 'address_match')) { t('delivery.address', 'ACCEPT_CLAIM', 'Delivery address does not match the PayPal transaction address (Seller Protection requires a match)'); return done('ACCEPT_CLAIM', 'The carrier delivered to a different address than the one on the PayPal transaction, so the delivery proof would not qualify. Accept and refund.'); }
      if (failed(items, 'delivery_after_shipment')) { t('delivery.dates', 'HUMAN_REVIEW', 'Delivery date precedes ship date'); return done('HUMAN_REVIEW', 'Carrier dates are inconsistent (delivered before shipped); verify with the carrier before submitting.'); }
      t('delivery.address', 'PASS', 'Delivered to the transaction address');
      if (amt > policy.signatureAbove && !has(items, 'PROOF_OF_DELIVERY_SIGNATURE')) { t('delivery.signature', 'HUMAN_REVIEW', `Amount ${amt.toFixed(2)} exceeds ${policy.signatureAbove} and there is no signature on file`); return done('HUMAN_REVIEW', `Over ${policy.signatureAbove}, PayPal may require a delivery signature and none is on file. Ask the carrier for a signature record before responding.`); }
      if (sig?.mentions_address_change) { t('buyer.address_change', 'HUMAN_REVIEW', 'Buyer says the address changed / was redirected, which can void Seller Protection'); return done('HUMAN_REVIEW', 'Delivery matches the transaction address, but the buyer says they moved or asked for redirection. Review before contesting.'); }
      const ok = unauth ? 'Unauthorised-transaction claim with carrier proof of delivery to the transaction address.' : 'Carrier shows delivered to the address on the transaction before the dispute opened; evidence is complete.';
      if (sig?.admits_receipt) t('buyer.admits_receipt', 'SUPPORTS_FIGHT', 'Buyer message indicates they have the goods');
      return fightOrAccept(ok);
    }
    case 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED': {
      // PayPal Seller Protection does not cover "significantly not as described", so this is a judgement call, not a proof exercise.
      if (!sig) { t('buyer.signals', 'HUMAN_REVIEW', 'No usable buyer-message signals'); return done('HUMAN_REVIEW', 'Cannot tell from the buyer message whether this is damage or a change of mind; review manually.'); }
      if (sig.mentions_damage || sig.intent === 'damaged') {
        t('snad.damage', 'OFFER_REFUND', 'Buyer reports damage; your own policy refunds items damaged in transit');
        return done('OFFER_REFUND', 'Buyer reports the item arrived damaged and your return policy refunds damaged-in-transit items in full. Offering a refund avoids an escalation you would likely lose.', { offerAmount: dispute.dispute_amount });
      }
      if (sig.intent === 'changed_mind' && !sig.mentions_damage) {
        t('snad.changed_mind', 'FIGHT', 'Buyer describes a change of mind with no defect; listing text and return policy are on file');
        return fightOrAccept('Buyer concedes the item is as described and only changed their mind; the listing text and return policy address this.');
      }
      t('snad.unclear', 'HUMAN_REVIEW', `Intent ${sig.intent}`); return done('HUMAN_REVIEW', 'The claim is not clearly damage or change-of-mind; review manually.');
    }
    case 'CREDIT_NOT_PROCESSED': {
      const refunded = refunds.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.amount, 0);
      if (refunded + 0.005 >= amt && refunded > 0) { t('refund.covers', 'FIGHT', `Refunds of ${refunded.toFixed(2)} cover the ${amt.toFixed(2)} dispute`); return fightOrAccept('A refund covering the full disputed amount was already issued in PayPal; the refund ID is the proof.'); }
      if (refunded > 0) {
        const rest = +(amt - refunded).toFixed(2);
        t('refund.partial', 'OFFER_REFUND', `Only ${refunded.toFixed(2)} of ${amt.toFixed(2)} was refunded`);
        return done('OFFER_REFUND', `Only part of the amount was refunded (${refunded.toFixed(2)} of ${amt.toFixed(2)}). Offer the remaining ${rest.toFixed(2)}.`, { offerAmount: money(rest, dispute.dispute_amount.currency_code) });
      }
      if (returns.length) { t('refund.missing', 'ACCEPT_CLAIM', 'Return received but no refund recorded'); return done('ACCEPT_CLAIM', 'The return was received but no refund was ever sent. The buyer is right; accept and refund.'); }
      t('refund.unknown', 'HUMAN_REVIEW', 'No refund and no return on record'); return done('HUMAN_REVIEW', 'No refund and no return are on record; check whether a refund was promised.');
    }
    case 'DUPLICATE_TRANSACTION': {
      if (has(items, 'ORDER_DETAILS') && passed(items, 'second_order_fulfilled')) { t('dup.second_order', 'FIGHT', 'A second genuine order exists for the same amount and was separately fulfilled'); return fightOrAccept('Both charges map to two separate orders, each shipped with its own tracking number.'); }
      t('dup.single', 'ACCEPT_CLAIM', 'Only one order exists for the buyer in this window'); return done('ACCEPT_CLAIM', 'There is only one order behind these two charges, so the buyer was charged twice. Accept and refund the duplicate.');
    }
    default:
      t('playbook', 'HUMAN_REVIEW', `No playbook for reason ${dispute.reason}`);
      return done('HUMAN_REVIEW', `No automated playbook for dispute reason ${dispute.reason}.`);
  }
}

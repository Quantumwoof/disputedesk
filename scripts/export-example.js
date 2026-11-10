// Writes data/merchant.example.json: the shape MERCHANT_DATA expects, with two synthetic records.
import { writeFileSync } from 'node:fs';
import { buildScenario, MERCHANT } from '../src/demo/scenarios.js';
const now = new Date('2026-11-10T09:00:00Z');
const records = {};
for (const [t, s] of [['inr_delivered_match', 1], ['cnp_refund_issued', 2]]) {
  const sc = buildScenario(t, s, now);
  for (const o of sc.record.orders) records[o.transaction_id] = sc.record;
}
writeFileSync('data/merchant.example.json', JSON.stringify({ _comment: 'Synthetic example. Key = PayPal seller_transaction_id. Replace with an export from your shop.', merchant: MERCHANT, records }, null, 2));

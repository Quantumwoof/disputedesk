import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MerchantStore } from '../src/merchant/store.js';
import { buildScenario } from '../src/demo/scenarios.js';

export const NOW = new Date('2026-11-10T09:00:00Z');
export const tmp = () => mkdtempSync(join(tmpdir(), 'dd-'));
export function scenario(type, seed = 1, opts) {
  const s = buildScenario(type, seed, NOW, opts);
  const store = new MerchantStore(Object.fromEntries(s.record.orders.map((o) => [o.transaction_id, s.record])), s.record.merchant);
  return { ...s, view: store.byTransaction(s.dispute.disputed_transactions[0].seller_transaction_id), store };
}
/** A fake OpenAI-compatible fetch that returns `reply` (string or fn(prompt)) as the assistant message. */
export function fakeFetch(reply) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const content = typeof reply === 'function' ? reply(body.messages) : reply;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
}

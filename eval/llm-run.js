// Real-model evaluation (needs network). Free & keyless by default:  LLM_PROVIDER=pollinations node eval/llm-run.js
// Any OpenAI-compatible endpoint works: LLM_PROVIDER=openai-compatible LLM_BASE_URL=... LLM_MODEL=... [LLM_API_KEY=...]
// Writes eval/results/llm-run.json and prints a summary. Numbers in the README/SUBMISSION come from this file.
import { writeFileSync } from 'node:fs';
import { LLM } from '../src/engine/llm.js';
import { ALL_MESSAGES } from '../src/demo/messages.js';
import { analyzeMessages, heuristicSignals } from '../src/engine/messages.js';
import { buildBenchmark, storeFor, NOW } from './run.js';
import { triageDispute } from '../src/engine/agent.js';

const provider = process.env.LLM_PROVIDER ?? 'pollinations';
const llm = new LLM({ provider, baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL, timeoutMs: 90000, retries: 3 });
console.log('model:', llm.label);
const started = new Date();

// ---- A. message signals: LLM vs heuristic on hand-labelled messages
const fields = ['intent', 'admits_receipt', 'mentions_damage', 'mentions_address_change'];
const tally = { llm: Object.fromEntries(fields.map((f) => [f, 0])), heuristic: Object.fromEntries(fields.map((f) => [f, 0])) };
let llmUsed = 0, fellBack = 0, injCaught = 0, injTotal = 0;
const msgRows = [];
for (const m of ALL_MESSAGES) {
  const h = heuristicSignals([m.text]);
  const a = await analyzeMessages([{ posted_by: 'BUYER', content: m.text }], llm);
  const fromLlm = a.source.startsWith('llm');
  if (fromLlm) llmUsed++; else fellBack++;
  // For injection messages the safe behaviour is to flag it; scored separately.
  if (m.gold.injection) { injTotal++; if (a.injection_detected) injCaught++; continue; }
  for (const f of fields) {
    if (a[f] === m.gold[f]) tally.llm[f]++;
    if (h[f] === m.gold[f]) tally.heuristic[f]++;
  }
  msgRows.push({ text: m.text.slice(0, 80), gold: m.gold, llm: fromLlm ? a : null, heuristic: h });
}
const nScored = ALL_MESSAGES.filter((m) => !m.gold.injection).length;
const pct = (x) => +((100 * x) / nScored).toFixed(1);
const signals = { n_scored: nScored, llm_responses_used: llmUsed, fell_back_to_heuristic: fellBack, injection_flagged: `${injCaught}/${injTotal}`, llm_accuracy_pct: Object.fromEntries(fields.map((f) => [f, pct(tally.llm[f])])), heuristic_accuracy_pct: Object.fromEntries(fields.map((f) => [f, pct(tally.heuristic[f])])) };
console.log('signals', JSON.stringify(signals));

// ---- B. narrative drafting on every FIGHT case of the benchmark (one seed per situation + the rest)
const cases = buildBenchmark();
const rows = [];
let accepted = 0, rejected = 0, errored = 0, total = 0;
const problemKinds = {};
for (const c of cases) {
  const view = storeFor(c).byTransaction(c.dispute.disputed_transactions[0].seller_transaction_id);
  const offline = await triageDispute({ dispute: c.dispute, view, llm: null, now: NOW });
  if (offline.action !== 'FIGHT') continue;
  const t = await triageDispute({ dispute: c.dispute, view, llm, now: NOW });
  total++;
  const d = t.draft;
  if (d.source.startsWith('llm')) accepted++; else if (d.llm_rejected) { rejected++; for (const p of d.llm_rejected) { const k = p.split(' ')[0] + ' ' + (p.split(' ')[1] ?? ''); problemKinds[k] = (problemKinds[k] ?? 0) + 1; } } else errored++;
  rows.push({ dispute: c.dispute.dispute_id, type: c.type, source: d.source, final_text: d.text, llm_raw: d.llm_raw ?? null, llm_rejected: d.llm_rejected ?? null, llm_error: d.llm_error ?? null });
  process.stdout.write(d.source.startsWith('llm') ? '+' : d.llm_rejected ? 'x' : '!');
}
console.log();
const narrative = { fight_cases: total, llm_draft_accepted_first_try: accepted, llm_draft_rejected_by_verifier: rejected, llm_unavailable_or_error: errored, rejection_problem_kinds: problemKinds };
console.log('narrative', JSON.stringify(narrative));

const out = { model: llm.label, started: started.toISOString(), finished: new Date().toISOString(), llm_calls: llm.stats.calls, llm_failed_calls: llm.stats.failures, signals, narrative, message_rows: msgRows, draft_rows: rows };
writeFileSync(new URL('./results/llm-run.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('wrote eval/results/llm-run.json');

#!/usr/bin/env node
import { bootstrap } from '../src/bootstrap.js';
import { createApp } from '../src/web/server.js';
import { createMockPayPal } from '../src/paypal/mock-server.js';
import { buildDemoData } from '../src/demo/scenarios.js';
import { demoNow } from '../src/bootstrap.js';
import { runTriage, approve, reject, submit } from '../src/engine/agent.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [cmd = 'demo', ...args] = process.argv.slice(2);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function serve() {
  const ctx = await bootstrap();
  const app = createApp({ ...ctx, evalResultsPath: join(root, 'eval/results/latest.json') });
  app.listen(ctx.cfg.port, () => {
    console.log(`\n  DisputeDesk dashboard  http://localhost:${ctx.cfg.port}`);
    console.log(`  PayPal:  ${ctx.label}  (${ctx.baseUrl})`);
    console.log(`  AI:      ${ctx.llm.label}${ctx.llm.enabled ? '' : '   (set LLM_PROVIDER=pollinations for a free, keyless model)'}\n`);
  });
}

switch (cmd) {
  case 'demo':
  case 'serve':
    if (cmd === 'demo') process.env.DISPUTEDESK_MODE ??= 'demo';
    await serve();
    break;
  case 'mock': {
    const m = createMockPayPal({ now: demoNow(), data: buildDemoData(demoNow()) });
    const port = await m.listen(Number(process.env.MOCK_PORT ?? 4010));
    console.log(`PayPal sandbox SIMULATOR (not PayPal) on http://127.0.0.1:${port}`);
    break;
  }
  case 'triage': {
    const ctx = await bootstrap();
    const out = await runTriage({ ...ctx, policy: ctx.cfg.policy });
    console.log(`${pad('DISPUTE', 12)}${pad('REASON', 38)}${pad('AMOUNT', 12)}${pad('DUE', 7)}${pad('ACTION', 14)}EVIDENCE`);
    for (const c of out.sort((a, b) => a.hours_left - b.hours_left)) console.log(`${pad(c.dispute_id, 12)}${pad(c.reason, 38)}${pad(c.amount.value, 12)}${pad(c.hours_left + 'h', 7)}${pad(c.action, 14)}${c.strength}%  ${c.draft.source}`);
    process.exit(0);
  }
  case 'approve': {
    const ctx = await bootstrap();
    const p = approve(ctx.state, args[0], process.env.USER ?? 'owner');
    if (args.includes('--send')) { const r = await submit({ ...ctx, proposalId: args[0], actor: 'human:cli' }); console.log('sent:', r.proposal.status); } else console.log(`approved ${p.id}. Send it with: submit ${p.id} (or --send)`);
    process.exit(0);
  }
  case 'reject': { const ctx = await bootstrap(); reject(ctx.state, args[0]); console.log('rejected'); process.exit(0); }
  case 'mcp': { const { main } = await import('../src/mcp/server.js'); await main(); break; }
  default:
    console.log('usage: disputedesk [demo|serve|mock|triage|approve <id> [--send]|reject <id>|mcp]');
}

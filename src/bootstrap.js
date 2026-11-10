// Wires config → gateway, merchant store, state store and LLM. Shared by the CLI, dashboard and MCP server.
import { readFileSync } from 'node:fs';
import { loadConfig, createGateway } from './config.js';
import { MerchantStore } from './merchant/store.js';
import { buildDemoData } from './demo/scenarios.js';
import { StateStore } from './engine/state.js';
import { LLM } from './engine/llm.js';

/** Demo data is generated relative to the start of today (UTC) so every process agrees on dates. */
export function demoNow(now = new Date()) { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; }

export async function bootstrap(env = process.env) {
  const cfg = loadConfig(env);
  const data = cfg.mode === 'demo' ? buildDemoData(demoNow()) : null;
  const { gateway, mock, baseUrl, label } = await createGateway(cfg, { now: demoNow(), data });
  let merchant;
  if (cfg.mode === 'demo') merchant = MerchantStore.fromDemo(data);
  else {
    if (!env.MERCHANT_DATA) throw new Error('Sandbox/live mode needs MERCHANT_DATA=<path to merchant JSON export>; see README "Connect your shop".');
    merchant = MerchantStore.fromJSON(JSON.parse(readFileSync(env.MERCHANT_DATA, 'utf8')));
  }
  const state = new StateStore(cfg.dataDir);
  const llm = new LLM(cfg.llm);
  return { cfg, gateway, mock, baseUrl, label, merchant, state, llm };
}

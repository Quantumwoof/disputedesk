// Live-sandbox smoke test: proves the REST client works against a real PayPal sandbox (or the local simulator).
//   PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npm run sandbox:check
//   npm run sandbox:check -- --simulator        # self-test against the bundled simulator, no credentials
// Read-only: OAuth token, list disputes, get one dispute. It never sends evidence, accepts a claim or makes an offer.
import { PayPalRest, SANDBOX_URL } from '../src/paypal/rest.js';
import { createMockPayPal } from '../src/paypal/mock-server.js';
import { buildDemoData } from '../src/demo/scenarios.js';
import { fileURLToPath } from 'node:url';

export async function sandboxCheck(rest, out = console.log) {
  const steps = [];
  const step = async (name, fn) => {
    try { const detail = await fn(); steps.push({ name, ok: true, detail }); out(`  ✔ ${name}: ${detail}`); return true; }
    catch (e) { steps.push({ name, ok: false, detail: e.message }); out(`  ✘ ${name}: ${e.message}`); return false; }
  };
  out(`PayPal endpoint: ${rest.baseUrl}`);
  let list = [];
  if (!(await step('OAuth2 client-credentials token', async () => { await rest.authenticate(); return 'token issued'; }))) return steps;
  await step('GET /v1/customer/disputes', async () => { list = await rest.listDisputes(); return `${list.length} dispute(s): ${list.slice(0, 5).map((d) => `${d.dispute_id} ${d.status ?? ''}`.trim()).join(', ') || 'none yet (create one as the sandbox buyer, see docs/GO_LIVE.md)'}`; });
  if (list.length) await step(`GET /v1/customer/disputes/${list[0].dispute_id}`, async () => { const d = await rest.getDispute(list[0].dispute_id); return `reason ${d.reason}, status ${d.status}, ${d.links?.length ?? 0} action link(s)`; });
  return steps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sim = process.argv.includes('--simulator');
  let mock = null, rest;
  if (sim) {
    mock = createMockPayPal({ now: new Date(), data: buildDemoData(new Date()) });
    rest = new PayPalRest({ baseUrl: `http://127.0.0.1:${await mock.listen(0)}`, clientId: 'demo-client-id', clientSecret: 'demo-client-secret' });
    console.log('SIMULATOR self-test (this is not PayPal):');
  } else {
    const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PAYPAL_ACCESS_TOKEN: accessToken, PAYPAL_BASE_URL: baseUrl = SANDBOX_URL } = process.env;
    if (!(id && secret) && !accessToken) { console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox Merchant app), or run with --simulator. See docs/GO_LIVE.md.'); process.exit(2); }
    rest = new PayPalRest({ baseUrl, clientId: id, clientSecret: secret, accessToken });
  }
  const steps = await sandboxCheck(rest);
  await mock?.close();
  process.exit(steps.every((s) => s.ok) && steps.length >= 2 ? 0 : 1);
}

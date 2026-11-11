import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from '../src/bootstrap.js';
import { createApp } from '../src/web/server.js';
import { tmp } from './helpers.js';

test('dashboard API: triage → approve sends to the simulator; reject sends nothing; static files served', async () => {
  const ctx = await bootstrap({ DISPUTEDESK_MODE: 'demo', DISPUTEDESK_DATA: tmp(), PAYPAL_BASE_URL: '' });
  const app = createApp({ ...ctx });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (p, b = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    assert.match(await (await fetch(base + '/')).text(), /DisputeDesk/);
    assert.equal((await fetch(base + '/vendor/ag-grid-community.min.js')).status, 200);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /id="chips"/); assert.match(html, /id="btn-csv"/); assert.match(html, /id="qf"/); // AG Grid toolbar: decision filter, quick filter, CSV export
    const js = await (await fetch(base + '/app.js')).text();
    for (const f of ['isExternalFilterPresent', 'pinnedBottomRowData', 'exportDataAsCsv', 'quickFilterText', 'rowClassRules', 'enableCellChangeFlash', 'applyColumnState']) assert.ok(js.includes(f), f + ' used by the grid');
    assert.equal((await fetch(base + '/../package.json')).status, 404);
    assert.equal((await post('/api/triage')).body.triaged, 12);
    const st = await (await fetch(base + '/api/state')).json();
    assert.equal(st.mode, 'demo'); assert.equal(st.cases.length, 12);
    const fight = st.cases.find((c) => c.action === 'FIGHT'); const rej = st.cases.filter((c) => c.action === 'FIGHT')[1];
    assert.equal((await post('/api/reject', { id: rej.id })).status, 200);
    const ok = await post('/api/approve', { id: fight.id, who: 'joshua' });
    assert.equal(ok.body.status, 'submitted');
    const calls = await (await fetch(base + '/api/paypal-calls')).json();
    assert.ok(calls.calls.some((c) => c.method === 'POST' && c.path.endsWith(`${fight.dispute_id}/provide-evidence`) && c.status === 200));
    assert.equal(calls.calls.some((c) => c.path.includes(rej.dispute_id) && c.method === 'POST'), false);
    const audit = await (await fetch(base + '/api/audit')).json();
    assert.equal(audit.verify.ok, true);
    // cannot approve twice
    assert.equal((await post('/api/approve', { id: fight.id })).status, 500);
  } finally { app.close(); await ctx.mock?.close(); }
});

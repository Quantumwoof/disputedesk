/* DisputeDesk dashboard: AG Grid queue + case detail + human approval gate. Vanilla JS, no build step. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (m) => `${m.currency_code} ${Number(m.value).toFixed(2)}`;
const REASON = { MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received', UNAUTHORISED: 'Unauthorised', MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described', CREDIT_NOT_PROCESSED: 'Credit not processed', DUPLICATE_TRANSACTION: 'Duplicate charge' };
const ACTION = { FIGHT: 'Fight', ACCEPT_CLAIM: 'Accept & refund', OFFER_REFUND: 'Offer refund', HUMAN_REVIEW: 'Needs you' };
let S = null, grid = null, selected = null, tab = 'why', drawerTab = 'calls';

async function api(path, opts) {
  const r = await fetch(path, opts && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function hoursText(h) { if (h < 0) return 'overdue'; if (h < 48) return `${h}h`; return `${Math.round(h / 24)}d`; }

function renderHeader() {
  const m = $('#mode'); m.textContent = S.label; m.className = 'badge ' + (S.mode === 'demo' ? 'demo' : 'live');
  const l = $('#llm'); l.textContent = 'AI: ' + S.llm; l.className = 'badge ' + (S.llmEnabled ? 'ai' : '');
  const a = $('#auditb'); a.textContent = S.audit.ok ? `audit chain ✓ ${S.audit.entries} entries` : 'audit chain BROKEN'; a.className = 'badge ' + (S.audit.ok ? 'ok' : 'bad');
}

function renderKpis() {
  const open = S.cases.filter((c) => !['submitted', 'rejected'].includes(c.status));
  const atStake = open.reduce((s, c) => s + Number(c.amount.value), 0);
  const by = (a) => open.filter((c) => c.action === a);
  const soon = open.length ? Math.min(...open.map((c) => c.hours_left)) : null;
  const sum = (arr) => arr.reduce((s, c) => s + Number(c.amount.value), 0);
  $('#kpis').innerHTML = [
    ['Open disputes', open.length, `${S.cases.length - open.length} resolved by you`],
    ['At stake', `$${atStake.toFixed(2)}`, 'disputed amount, open cases'],
    ['Soonest deadline', soon == null ? '–' : hoursText(soon), 'PayPal: respond within 10 days'],
    ['Agent recommends fight', by('FIGHT').length, `$${sum(by('FIGHT')).toFixed(2)} defensible with evidence`],
    ['Needs your judgement', by('HUMAN_REVIEW').length, `${by('ACCEPT_CLAIM').length} accept · ${by('OFFER_REFUND').length} offer`],
  ].map(([a, b, c]) => `<div class="kpi"><small>${a}</small><b>${b}</b><br><span>${c}</span></div>`).join('');
}

function gridCols() {
  return [
    { headerName: 'Due', field: 'hours_left', width: 74, sort: 'asc', cellRenderer: (p) => `<span class="${p.value < 24 ? 'urgent' : p.value < 72 ? 'soon' : ''}">${hoursText(p.value)}</span>` },
    { headerName: 'Dispute', field: 'dispute_id', width: 108 },
    { headerName: 'Buyer', field: 'buyer', flex: 1, minWidth: 110 },
    { headerName: 'Reason', field: 'reason', flex: 1, minWidth: 120, valueFormatter: (p) => REASON[p.value] ?? p.value },
    { headerName: 'Amount', field: 'amount', width: 92, valueGetter: (p) => Number(p.data.amount.value), valueFormatter: (p) => `$${p.value.toFixed(2)}`, type: 'rightAligned' },
    { headerName: 'Agent says', field: 'action', width: 128, cellRenderer: (p) => `<span class="pill ${p.value}">${ACTION[p.value]}</span>` },
    { headerName: 'Evidence', field: 'strength', width: 96, cellRenderer: (p) => `<div style="display:flex;align-items:center;gap:6px;height:100%"><div style="flex:1;height:6px;background:#223052;border-radius:3px"><div style="width:${p.value}%;height:6px;border-radius:3px;background:${p.value > 70 ? '#2ecc8f' : p.value > 40 ? '#ffc24b' : '#ff6b6b'}"></div></div><span style="font-size:11px;color:#8fa0c4">${p.value}%</span></div>` },
    { headerName: 'Status', field: 'status', width: 100, valueFormatter: (p) => ({ proposed: 'awaiting you', approved: 'approved', submitted: 'sent ✓', rejected: 'rejected', failed: 'failed' }[p.value] ?? p.value) },
  ];
}

function renderGrid() {
  if (!grid) {
    grid = agGrid.createGrid($('#grid'), {
      theme: agGrid.themeQuartz.withPart(agGrid.colorSchemeDark).withParams({ backgroundColor: '#111a2e', headerBackgroundColor: '#16213a', borderColor: '#223052', fontSize: 13, accentColor: '#009cde' }),
      columnDefs: gridCols(), rowData: S.cases, rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
      getRowId: (p) => p.data.id, defaultColDef: { sortable: true, resizable: true }, animateRows: true,
      onRowSelected: (e) => { if (e.node.isSelected() && selected !== e.data.id) { selected = e.data.id; tab = 'why'; renderDetail(); } },
      overlayNoRowsTemplate: '<span style="color:#8fa0c4">No cases yet. Click "Run agent triage".</span>',
    });
  } else grid.setGridOption('rowData', S.cases);
  $('#queue-sub').textContent = `${S.merchant ?? ''} · sorted by deadline`;
  if (selected) grid.forEachNode((n) => { if (n.data.id === selected) n.setSelected(true, false, 'api'); });
}

function renderDetail() {
  const c = S.cases.find((x) => x.id === selected);
  const el = $('#detail');
  if (!c) return;
  const done = c.status === 'submitted', rejected = c.status === 'rejected';
  const callLabel = { 'provide-evidence': 'Send evidence to PayPal', 'accept-claim': 'Accept claim & refund', 'make-offer': 'Send refund offer', none: 'Mark as reviewed' }[c.proposal.call];
  el.innerHTML = `
  <div class="d-head">
    <span class="pill ${c.action}">${ACTION[c.action]}</span> <span class="muted">· ${c.dispute_id} · ${esc(REASON[c.reason] ?? c.reason)} · ${money(c.amount)}</span>
    <h3>${esc(c.item ?? '')} <span class="muted">— ${esc(c.buyer ?? '')}</span></h3>
    <p>${esc(c.rationale[0])}</p>
  </div>
  <div class="tabs">${[['why', 'Why'], ['evidence', `Evidence (${c.evidence.length})`], ['draft', 'Response draft'], ['call', 'PayPal call']].map(([k, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <div class="pane">${paneHtml(c)}</div>
  <div class="bar">
    ${done ? `<span class="done">✔ Sent to PayPal · ${esc(c.proposal.call)}</span>` : rejected ? '<span class="muted">Rejected by you; nothing was sent.</span>' : `
      <span class="note">${c.action === 'HUMAN_REVIEW' ? 'The agent will not act on this one.' : 'Nothing leaves this machine until you approve. Approval is bound to this exact payload (digest ' + c.proposal.digest.slice(0, 8) + ').'}</span>
      <button class="stop" id="btn-reject">Reject</button>
      <button class="go" id="btn-approve" ${c.action === 'FIGHT' && !c.draft.verified ? 'disabled' : ''}>${c.action === 'HUMAN_REVIEW' ? 'Mark reviewed' : 'Approve &amp; ' + callLabel.toLowerCase()}</button>`}
  </div>`;
  el.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; renderDetail(); }));
  const ap = $('#btn-approve'); if (ap) ap.onclick = async () => { ap.disabled = true; ap.textContent = 'Sending…'; try { await api('/api/approve', { id: c.id }); } catch (e) { alert(e.message); } await refresh(); };
  const rj = $('#btn-reject'); if (rj) rj.onclick = async () => { await api('/api/reject', { id: c.id }); await refresh(); };
}

function paneHtml(c) {
  if (tab === 'why') {
    const s = c.signals;
    return `
      <h4>Buyer said (untrusted text, treated as data)</h4>
      <div class="msg">${esc(c.buyer_message ?? '–')}</div>
      <h4>What the AI read from it <span class="muted">(${esc(s.source)})</span></h4>
      <div>${[`intent: ${s.intent}`].map((x) => `<span class="chip">${esc(x)}</span>`).join('')}
        ${[['admits_receipt', 'admits receipt'], ['mentions_damage', 'reports damage'], ['mentions_address_change', 'address changed']].map(([k, n]) => `<span class="chip ${s[k] ? 'on' : ''}">${n}: ${s[k] ? 'yes' : 'no'}</span>`).join('')}
        <span class="chip ${s.injection_detected ? 'bad' : ''}">injection attempt: ${s.injection_detected ? 'YES' : 'no'}</span></div>
      ${c.guardrails.length ? `<h4>Guardrails that fired</h4>${c.guardrails.map((g) => `<div class="rule"><code>guardrail</code><span>${esc(g)}</span></div>`).join('')}` : ''}
      <h4>Rules that decided (deterministic, no model)</h4>
      ${c.trace.map((t) => `<div class="rule"><code>${esc(t.rule)}</code><span><b>${esc(t.outcome)}</b></span><em>${esc(t.because)}</em></div>`).join('')}`;
  }
  if (tab === 'evidence') {
    return c.evidence.map((e) => `<div class="ev"><header><b>${e.id} · ${esc(e.title)}</b><span>${e.in_response ? '<b style="color:#2ecc8f">in response</b> · ' : 'on file · '}${esc(e.type)}</span></header>
      <p>${e.facts.map(esc).join(' ')}</p>
      ${e.checks.map((k) => `<div class="chk"><i class="${k.pass ? 'ok-i' : 'no-i'}">${k.pass ? '✔' : '✘'}</i><span>${esc(k.label)} <span class="d">· ${esc(k.detail)}</span></span></div>`).join('')}<div style="height:6px"></div></div>`).join('') || '<p class="muted">No merchant record was found for this transaction.</p>';
  }
  if (tab === 'draft') {
    const d = c.draft;
    if (!d.text) return `<p class="muted">No response is drafted for this action.</p>`;
    const ok = d.verified;
    return `<div class="verify"><span class="${ok ? 'good' : 'bad'}"><b>${ok ? '✔ Grounding check passed' : '✘ Grounding check failed'}</b></span><span class="muted">· ${d.sentences.length} sentences, every figure traced to evidence</span></div>
      <div class="draft">${d.sentences.map((s) => `<div class="s">${esc(s.text)}${s.cites.map((x) => `<sup title="Evidence ${x}">[${x}]</sup>`).join('')}</div>`).join('')}</div>
      <h4>Written by</h4><span class="chip ${d.source.startsWith('llm') ? 'on' : ''}">${esc(d.source === 'template' ? 'deterministic template' : d.source)}</span>
      ${d.llm_rejected ? `<h4>LLM draft rejected — why</h4>${d.llm_rejected.map((p) => `<div class="rule"><code>verifier</code><span>${esc(p)}</span></div>`).join('')}` : ''}
      ${d.llm_error ? `<div class="rule"><code>llm</code><span>${esc(d.llm_error)}; template used.</span></div>` : ''}`;
  }
  const p = c.proposal;
  return `<h4>Exact call that will be made on approval</h4><pre>${esc(p.call === 'none' ? '(no PayPal call)' : `POST /v1/customer/disputes/${c.dispute_id}/${p.call}\n\n${JSON.stringify(p.payload, null, 2)}`)}</pre>
    ${c.status === 'submitted' ? `<h4>PayPal response</h4><pre>${esc(JSON.stringify(c.result?.paypal ?? c.result, null, 2))}</pre>` : ''}`;
}

async function renderDrawer() {
  const b = $('#drawer-body');
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === drawerTab));
  if (drawerTab === 'calls') {
    const j = await api('/api/paypal-calls');
    b.innerHTML = `<div class="muted" style="margin-bottom:6px">Real HTTP calls made by the PayPal client to <code>${esc(j.base)}</code></div><table><tr><th>time</th><th>method</th><th>path</th><th>status</th><th>ms</th></tr>${j.calls.map((c) => `<tr><td>${c.at.slice(11, 19)}</td><td class="m-${c.method}">${c.method}</td><td>${esc(c.path)}</td><td class="${c.status < 300 ? 'st-ok' : 'st-err'}">${c.status}</td><td>${c.ms}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No calls yet</td></tr>'}</table>`;
  } else if (drawerTab === 'audit') {
    const j = await api('/api/audit');
    b.innerHTML = `<div class="muted" style="margin-bottom:6px">Hash-chained: ${j.verify.ok ? '✔ chain verified' : '✘ chain broken at entry ' + j.verify.brokenAt}</div><table><tr><th>time</th><th>actor</th><th>event</th><th>dispute</th><th>hash</th></tr>${j.entries.map((e) => `<tr><td>${e.ts.slice(11, 19)}</td><td>${esc(e.actor)}</td><td><b>${esc(e.event)}</b></td><td>${esc(e.dispute_id)}</td><td class="muted">${e.hash.slice(0, 10)}…</td></tr>`).join('')}</table>`;
  } else {
    try {
      const r = await api('/api/eval');
      b.innerHTML = evalHtml(r);
    } catch { b.innerHTML = '<span class="muted">Run <code>npm run eval</code> to generate the benchmark.</span>'; }
  }
}
function evalHtml(r) {
  const rows = r.systems.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${s.correct}/${r.n}</td><td>${s.accuracy_pct}%</td><td>${s.unsupported_submissions}</td><td>${s.ungrounded_drafts}</td><td>$${s.wrongly_conceded_usd.toFixed(2)}</td><td>$${s.wrongly_contested_usd.toFixed(2)}</td></tr>`).join('');
  return `<div class="muted" style="margin-bottom:6px">${esc(r.description)}</div><table><tr><th>system</th><th>correct</th><th>accuracy</th><th>unsupported submissions</th><th>ungrounded drafts</th><th>wrongly conceded</th><th>wrongly contested</th></tr>${rows}</table><div class="muted" style="margin-top:8px">${esc(r.caveat)}</div>`;
}

async function refresh() {
  S = await api('/api/state');
  renderHeader(); renderKpis(); renderGrid(); if (selected) renderDetail(); renderDrawer();
}
$('#btn-triage').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Triaging…'; try { await api('/api/triage', {}); } catch (x) { alert(x.message); } e.target.disabled = false; e.target.textContent = 'Run agent triage'; await refresh(); };
$('#btn-reset').onclick = async () => { await api('/api/reset', {}); selected = null; $('#detail').innerHTML = '<div class="empty"><h3>Select a dispute</h3></div>'; await refresh(); };
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => { drawerTab = b.dataset.tab; renderDrawer(); }));
const hash = () => location.hash.replace('#', '').split('/');
(async () => {
  await refresh();
  if (!S.cases.length) { await api('/api/triage', {}); await refresh(); }
  const [hid, htab] = hash();
  if (hid) { const c = S.cases.find((x) => x.dispute_id === hid); if (c) { selected = c.id; tab = htab || 'why'; renderDetail(); renderGrid(); } }
})();

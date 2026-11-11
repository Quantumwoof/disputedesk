BASE = """<html><head><meta charset=utf-8><style>
*{box-sizing:border-box}body{margin:0;width:1600px;height:810px;background:radial-gradient(1200px 600px at 20% 0%,#16294d 0%,#0b1224 60%);color:#e8eefc;font-family:Inter,'DejaVu Sans',sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 110px}
.logo{display:inline-flex;width:64px;height:64px;border-radius:16px;background:#009cde;align-items:center;justify-content:center;font-weight:800;font-size:38px;margin-right:22px}
h1{font-size:84px;margin:0;letter-spacing:-1px}h2{font-size:44px;margin:26px 0 0;font-weight:600;color:#9fd8f5;line-height:1.2}
.row{display:flex;align-items:center}.tag{margin-top:40px;font-size:26px;color:#9fb0d3;line-height:1.5}
.pill{display:inline-block;padding:8px 18px;border-radius:999px;border:1px solid #5a4a1f;color:#ffc24b;font-size:24px;margin-top:34px;margin-right:12px}
.pill.b{border-color:#1f5a7a;color:#7fd0ff}
table{border-collapse:collapse;width:100%;font-size:27px;margin-top:22px}td,th{padding:11px 16px;text-align:left;border-bottom:1px solid #223052}th{color:#8fa0c4;font-weight:600;font-size:22px;text-transform:uppercase;letter-spacing:1px}
.big{font-size:40px;font-weight:700;color:#2ecc8f}.red{color:#ff8a8a}.mut{color:#8fa0c4;font-size:22px}
h3{font-size:52px;margin:0 0 6px}
</style></head><body>"""
TITLE = BASE + """<div class=row><span class=logo>D</span><h1>DisputeDesk</h1></div>
<h2>PayPal disputes in, verified evidence out</h2>
<div class=tag>An AI agent + MCP server for small merchants. Models propose; deterministic checks decide;<br>a human approves the exact payload before anything reaches PayPal.</div>
<div><span class=pill>DEMO · local PayPal sandbox simulator — not live PayPal</span><span class="pill b">PayPal AI Hackathon · solo build</span></div></body></html>"""
RESULTS = BASE + """<h3>Results <span class=mut style="font-size:26px">— all produced by code in the repo; one run each</span></h3>
<table><tr><th>Test</th><th>Result</th></tr>
<tr><td>72 seeded disputes, offline <span class=mut>(consistency check: labels written with the rules)</span></td><td><span class=big>72/72</span> <span class=mut>· 0 unsupported submissions · fight-all 24/72 · accept-all 28/72</span></td></tr>
<tr><td>Prompt-injection test: hostile text appended to 68 disputes</td><td><span class=big>0 of 68</span> <span class=mut>· changed the automatic action (28 sent to human review)</span></td></tr>
<tr><td>Verifier red-team</td><td><span class=big>24/24</span> <span class=mut>· valid drafts accepted, every corruption rejected</span></td></tr>
<tr><td>Free LLM (gpt-oss-20b): buyer intent, 32 msgs</td><td><span class=big>90.6%</span> <span class=mut>· vs 75.0% offline heuristic</span></td></tr>
<tr><td>Free LLM drafts, 24 fights</td><td><span class=big>19/24</span> <span class=mut>· passed verifier first try · 3 rejected &amp; replaced · 2 LLM unavailable</span></td></tr>
</table>
<div class=tag style="margin-top:26px;font-size:24px">Not yet verified: a live PayPal sandbox round-trip (needs sandbox Client ID/Secret). Demo shown on the local simulator.</div></body></html>"""
END = BASE + """<div class=row><span class=logo>D</span><h1>DisputeDesk</h1></div>
<h2>github.com/Quantumwoof/disputedesk</h2>
<div class=tag>MIT · runs with zero secrets: <b style="color:#e8eefc">npm install &amp;&amp; npm run demo</b><br>Disputes API · @paypal/mcp · own MCP server · AG Grid Community · 29 tests</div></body></html>"""

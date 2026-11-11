# Demo video script (as recorded: 2:32, under the 3:00 limit)

File: [`docs/demo.mp4`](demo.mp4) (1920×1080, H.264/AAC, captions burned in; [`demo.srt`](demo.srt) for YouTube closed captions) · thumbnail: [`demo-thumbnail.png`](demo-thumbnail.png) · how it was made: [`video/README.md`](video/README.md).

Everything on screen is real output of this repo. The video is labelled as the **local PayPal sandbox simulator** (banner `DEMO · local PayPal simulator`); no live PayPal sandbox run exists yet, and the video says so.

| Time | On screen | Narration (summary; full text in `docs/video/narration.py`) |
|---|---|---|
| 0:01–0:16 | Title slide: DEMO label | Problem hook: small merchants lose disputes they could win, 10-day window, agent + MCP server that never submits what it can't prove |
| 0:16–0:29 | Dashboard, empty queue, banner; click **Run agent triage** | Demo mode = local simulator, no secrets; twelve disputes waiting |
| 0:29–0:47 | Queue fills; AG Grid decision chips (Fight 5 · Accept 4 · Offer 1 · Needs you 2), quick filter, Export CSV | Reads each dispute and buyer message, gathers evidence from the shop's records, recommends an action |
| 0:47–1:03 | Free-LLM instance (badge `AI: pollinations:openai`); open **PP-D-96035** → *Why* | Rules decide, not the model: FedEx delivered to Denver 80202 = transaction address |
| 1:03–1:12 | *Evidence* tab (E1–E5) | Order, tracking number, carrier delivery scan, each with checks |
| 1:12–1:24 | *Response draft*: green **Grounding check passed**, `[E#]` citations | Model drafts; verifier requires citations and literal matches; failed drafts are thrown away |
| 1:24–1:42 | **PP-D-64479** *Why*: hostile buyer text, `injection attempt: YES`, guardrail | Buyer text is data; records decide (no shipment → accept); 0 of 68 attacks got a different automatic action |
| 1:42–2:02 | *PayPal call* tab → **Approve** → API-call drawer (`POST …/provide-evidence` 200) → *Audit log* | Human approval bound to payload hash; multipart provide-evidence; hash-chained audit; MCP server; PayPal MCP has no evidence tool so REST |
| 2:02–2:27 | Results slide | 72/72 consistency check (labels are mine), baselines, injection 0/68, verifier 24/24, LLM 90.6% vs 75.0%, drafts 19/24 first try, 3 rejected; live sandbox not yet verified |
| 2:27–2:32 | End card | Repo URL, `npm install && npm run demo`, MIT |

Notes: no win-rate claim is made; the benchmark is described as a consistency check; the free-LLM scenes use a queue triaged beforehand because the anonymous free tier is slow (the narration says so).

# Devpost submission — DisputeDesk (paste-ready)

Each section below maps to a Devpost field. Character limits noted where Devpost enforces one. Everything stated here is reproducible from this repo (`npm test`, `npm run eval`, `eval/results/`).

**Before pasting:** replace `VIDEO_URL` with the public YouTube link once uploaded, and update "Honest status" if a live sandbox round-trip has been done.

---

## Project name
DisputeDesk

## Elevator pitch / tagline (60 characters max)
PayPal disputes in, verified evidence out

*Longer alternative (about 20 words):* PayPal disputes in, verified evidence out — an AI agent and MCP server that only submits responses it can prove.

## Try it out (links)
* Code (MIT): https://github.com/Quantumwoof/disputedesk
* Demo video: https://youtu.be/TraSILcnjWk (also in the repo as `docs/demo.mp4`, 2:32, captioned)
* Run locally, no secrets, no account: `git clone https://github.com/Quantumwoof/disputedesk && cd disputedesk && npm install && npm run demo` → http://localhost:4000
* Optional free hosting config: `render.yaml`

---

## About the project

### The problem
A PayPal seller has **10 days** to respond to an opened dispute; with no response the case is resolved in the buyer's favour ([PayPal Seller Protection](https://www.paypal.com/us/webapps/mpp/security/seller-protection)). To win an *item not received* case the evidence must show a carrier delivery scan **to the address on the transaction**; *significantly not as described* is excluded from Seller Protection. For a one-to-five-person shop with no dispute team, that is a tedious lookup (order, tracking, scan, address, refunds) under a deadline, and the two expensive mistakes are opposites: fighting a case with no defence, and conceding one that could have been won. Putting an LLM in the loop adds a third: a fluent response claiming "signed for" or "insured" that the records don't support.

### Inspiration
I wanted an agent that *acts* through PayPal's real APIs, where the model is useful but never trusted. The Hackathon's own brief asks for agents that actually transact, not just recommend, and for a merchant a wrong submission is worse than none.

### What it does
DisputeDesk reads open disputes from the PayPal Disputes API (or PayPal's own MCP server) and the buyer's messages, pulls the evidence PayPal needs from the shop's records (order, shipment, carrier delivery scan, delivered-to address vs. transaction address, refunds, returns), and recommends **fight / accept / offer a refund / ask a human**, with the rule trace. For fights it drafts the response, and a **grounding verifier** checks that every sentence cites evidence and every date, amount, order/tracking number and claim word ("signed", "insured"…) is supported by that evidence. A human approves the exact payload (bound to a SHA-256 digest) before DisputeDesk calls `provide-evidence`, `accept-claim` or `make-offer`. A dashboard, a CLI and an MCP server share the same state and the same approval gate, and every step is written to a hash-chained audit log.

### How I built it
1. **PayPal Disputes API v1 client** (`src/paypal/rest.js`): OAuth2 client credentials with 401 refresh, list, get, **multipart `provide-evidence`** with a JSON `input` part as PayPal documents, `accept-claim`, `make-offer`.
2. **PayPal's `@paypal/mcp` server** (`src/paypal/mcp-gateway.js`): spawned over stdio; `list_disputes`, `get_dispute`, `accept_dispute_claim`. It has no provide-evidence or make-offer tool, so those two go through REST (documented gap).
3. **DisputeDesk's own MCP server** (`src/mcp/server.js`): `list_open_disputes`, `triage_dispute`, `triage_all`, `submit_response`, `audit_log`; `submit_response` refuses until a human has approved.
4. **Models propose, deterministic checks decide.** The LLM does two jobs only: reading buyer text into a fixed JSON schema and drafting prose. Output is used only if schema-valid or verifier-clean; otherwise a deterministic fallback runs. The action itself is chosen by rules.
5. **Untrusted buyer text:** schema-only extraction plus a regex injection veto; a detected injection can never produce an automatic FIGHT.
6. **Free everywhere:** works offline; a free keyless model (Pollinations, gpt-oss-20b) or any OpenAI-compatible endpoint plugs in. Demo mode runs a **local PayPal sandbox simulator** built from PayPal's OpenAPI spec so the real REST client runs with no credentials.
7. **Dashboard:** AG Grid Community queue (see below), case detail with *Why / Evidence / Response draft / PayPal call* tabs, approval bar, API-call, audit-log and benchmark drawer.

Stack: Node.js (ESM), MCP TypeScript SDK, zod, AG Grid Community 36.3, `node:test` (29 tests).

### Challenges
* **Making "grounded" mechanical:** sentence-level `[E#]` citations plus literal-match checks for numbers, dates and IDs, decimal-aware sentence splitting, and a stem-aware claim lexicon.
* **Evaluating honestly:** my own benchmark found 4 prompt-injection cases where an appended attack flipped HUMAN_REVIEW to FIGHT. I fixed the engine and added a regression test rather than rewording the metric.
* **PayPal tooling gaps:** the Agent Toolkit exposes list/get/accept for disputes but nothing to provide evidence or make an offer, and its `note` regex rejects spaces.
* **Free-tier LLMs:** in the real run 149 of 229 HTTP calls failed or were retried (rate limits, HTTP 400/402/429). The pipeline falls back to the deterministic path, which is part of what is tested.
* **No live sandbox round-trip yet** — see "Honest status".

### Accomplishments (all produced by code in the repo)
* **Offline benchmark, 72 seeded disputes:** 72/72 expected decisions, 0 unsupported submissions, versus 24/72 (fight everything), 28/72 (accept everything), 40/72 ("fight if tracking exists and ≥ $10"). *The labels were written by me alongside the rules, so this is a consistency / regression check, not a real-world win rate.*
* **Prompt-injection test:** a hostile instruction appended to 68 disputes' buyer messages; **0 of 68** got the attacker a different automatic action; 28 were downgraded to human review.
* **Verifier red-team:** 24/24 valid drafts accepted; every deliberate corruption (changed date, altered tracking digit, invented signature/insurance claim, fabricated amount, stripped or invented citation) rejected. These are synthetic corruptions, not real hallucinations.
* **Real free-LLM run** (gpt-oss-20b via Pollinations, one run, 10 Nov 2026): buyer-message intent **90.6% vs 75.0%** for the offline heuristic (32 labelled messages). Of 24 fight drafts, **19 passed the verifier first try, 3 were rejected by the verifier** (unsupported claim words, an ID not in the evidence) **and replaced by the template**, and 2 fell back because the anonymous free tier returned errors. Small model, small synthetic set: indicative, not a benchmark.
* Zero-secret demo, 29 passing tests, PayPal MCP + own MCP server, tamper-evident audit log, a read-only `npm run sandbox:check` for the moment sandbox credentials are available.

### What I learned
Putting the model behind a verifier and a human gate is cheaper than trying to make the model trustworthy, and an evaluation is only worth something if it can fail. Mine did, and the fix is in the repo.

### What's next
Run the live sandbox round-trip (OAuth → list → provide-evidence against a real sandbox dispute); Shopify/WooCommerce adapters instead of the JSON merchant export; evidence-type mapping per `REQUESTED_FROM_SELLER` item; carrier-API lookups; a `CUSTOMER.DISPUTE.CREATED` webhook trigger; evaluation on real, anonymised dispute outcomes.

---

## Built with (tags)
nodejs · paypal · paypal-disputes-api · paypal-mcp · model-context-protocol · ai-agent · ag-grid · zod · pollinations · gpt-oss · render

## Tools used and how (for the "required APIs / AI" field)
* **PayPal:** Disputes API v1 (list, get, provide-evidence multipart, accept-claim, make-offer) via REST; `@paypal/mcp` 1.8.1 for list/get/accept via PayPal's MCP server. Responses are only ever sent after a human approves the exact payload.
* **AI:** a free LLM (gpt-oss-20b, Pollinations; any OpenAI-compatible endpoint works) reads buyer messages into a fixed schema and drafts prose. A deterministic verifier gates every draft; the model never chooses the action, never sees approval state and cannot call PayPal.
* **MCP:** DisputeDesk is also an MCP server so any MCP client can triage and (after human approval) submit.
* **AG Grid Community** powers the queue (see below).

## Sponsor prize: AG Grid
The queue is the product's main working surface, built on AG Grid Community 36.3 (MIT, free): sorting and pinned column, custom cell renderers (deadline urgency, decision pills, evidence bars), an **external filter** driven by decision chips with live counts, quick filter and number column filter, a **pinned bottom row** with live total at stake for the current filter, row-class rules for cases due in under 24 hours, **cell-change flash** when an approval is sent, row selection driving the detail panel, **CSV export** of the filtered/sorted queue, persisted column state, and a dark theme via the Theming API. Code: `src/web/public/app.js`; feature table in the README.

## Honest status (put this in the description or notes field)
* The video and the demo run on a **local PayPal sandbox simulator** (shape-compatible with PayPal's OpenAPI spec), not on PayPal. The banner says `DEMO · local PayPal simulator` throughout.
* The REST client and `@paypal/mcp` integration are implemented and tested against the simulator and (for tool discovery) the real `@paypal/mcp` package; **a live PayPal sandbox round-trip has not been performed yet.** `docs/GO_LIVE.md` lists exactly what was and was not verified.
* The benchmark labels are author-written (consistency check). DisputeDesk has not been evaluated on real PayPal disputes.

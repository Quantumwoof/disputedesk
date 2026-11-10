# Devpost submission copy — DisputeDesk

**Project name:** DisputeDesk

**Tagline:** PayPal disputes in, verified evidence out — an AI agent and MCP server that only submits responses it can prove.

**Repo:** https://github.com/Quantumwoof/disputedesk · **License:** MIT · **Demo mode needs no secrets:** `npm install && npm run demo`

## Inspiration
Merchants get ten days to answer a PayPal dispute or the buyer wins by default. The work is tedious (find the order, the tracking scan, compare addresses, write it up), and the two costly mistakes are opposites: fighting a case with no defence, and conceding one you could have won. Adding an LLM makes a third mistake possible — a fluent response claiming "signed for" or "insured" that the records don't support. I wanted an agent where the model is useful but is never trusted.

## What it does
DisputeDesk reads open disputes from the PayPal Disputes API (or PayPal's own MCP server), reads the buyer's messages, pulls the evidence PayPal needs from the shop's records (order, shipment, carrier delivery scan, delivered-to address vs. the transaction address, refunds, returns), and recommends **fight / accept / offer a refund / ask a human**. For fights it drafts the response, then a **grounding verifier** checks every sentence cites evidence and every date, amount, order/tracking number and claim word is supported by that evidence. A human approves the exact payload (bound to a SHA-256 digest) before DisputeDesk calls `provide-evidence`, `accept-claim` or `make-offer`. A dashboard, a CLI and an MCP server share the same state and the same approval gate; every step goes into a hash-chained audit log.

## How I built it
* **PayPal:** Disputes API v1 client (OAuth2, multipart `provide-evidence` with a JSON `input` part as documented, accept-claim, make-offer); **PayPal's `@paypal/mcp` server** over stdio for `list_disputes` / `get_dispute` / `accept_dispute_claim`; and DisputeDesk's own **MCP server** (`list_open_disputes`, `triage_dispute`, `triage_all`, `submit_response`, `audit_log`).
* **Design rule — models propose, deterministic checks decide.** LLM output is only accepted if it fits a fixed JSON schema (buyer-message reading) or passes the verifier (drafting); otherwise a deterministic fallback runs. The decision itself never involves a model.
* **Untrusted buyer text:** schema-only extraction plus a regex injection veto; a detected injection can never produce an automatic FIGHT.
* **Free everywhere:** works offline; a free keyless model (Pollinations) or any OpenAI-compatible endpoint can be plugged in. Demo mode runs a local PayPal sandbox simulator built from PayPal's OpenAPI spec so the real REST client runs without credentials.
* Node.js (ESM), MCP TypeScript SDK, zod, AG Grid Community for the queue UI, `node:test` (28 tests).

## Challenges
* **Making "grounded" mechanical.** Sentence-level `[E#]` citations plus literal-match checks for numbers/dates/IDs; decimal-aware sentence splitting; a stem-aware claim lexicon.
* **Evaluating honestly.** My own benchmark found 4 prompt-injection cases where an appended attack flipped HUMAN_REVIEW to FIGHT; I fixed the engine and added a regression test rather than rewording the metric.
* **PayPal tooling gaps.** The Agent Toolkit exposes list/get/accept for disputes but nothing to *provide evidence* or *make an offer*, and its `note` regex rejects spaces — so those two operations use REST and the gap is documented.
* **No live credentials.** I did not use a PayPal sandbox account; live mode is implemented against the documented API but unverified (see below).

## Accomplishments
* Offline benchmark (72 seeded disputes): correct on 72/72 with 0 unsupported submissions, versus 24/72 (fight everything) and 28/72 (accept everything). *Labels were written by me with the rules — a regression check, not a real-world win rate.*
* Prompt-injection test: 68 attacked disputes, 0 got the attacker a different automatic action.
* Verifier red-team: 24/24 valid drafts accepted, every deliberate corruption rejected.
* Real free-LLM run (gpt-oss-20b via Pollinations): buyer-message intent 90.6% vs. 75.0% for the offline heuristic; of 24 drafted responses, 19 passed the verifier first try and the verifier rejected 3 (unsupported claim words, an ID not in the evidence) — replaced by the template. 2 more fell back because the anonymous free tier returned errors.
* Zero-secret demo, 28 passing tests, MCP server + PayPal's MCP server, tamper-evident audit log.

## What I learned
Putting the model behind a verifier and a human gate is cheaper than trying to make the model trustworthy, and the evaluation is only worth anything if it can fail — mine did.

## What's next
Verify against a live PayPal sandbox; adapters for Shopify/WooCommerce; evidence-type mapping per `REQUESTED_FROM_SELLER` item; carrier-API lookups for tracking; a PayPal webhook (`CUSTOMER.DISPUTE.CREATED`) trigger; evaluation on real, anonymised dispute outcomes.

## Built with
Node.js · PayPal Disputes API · PayPal MCP server (`@paypal/mcp`) · Model Context Protocol SDK · zod · AG Grid Community · Pollinations (free LLM) · Render (optional free hosting)

## Honest status (for the "tools and AI usage" field)
Live vs demo: demo mode uses a local simulator, not PayPal. The real `@paypal/mcp` server is started and its tools called in tests, but no real PayPal sandbox round-trip has been performed. AI is used to read buyer messages (schema-constrained) and to draft prose (verifier-gated); it never decides or submits.

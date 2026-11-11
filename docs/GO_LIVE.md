# Going from DEMO to the real PayPal sandbox

DEMO mode (default) talks to a local PayPal **simulator** so everything runs with zero secrets. Live sandbox mode uses the exact same code against `https://api-m.sandbox.paypal.com`. Nothing about the engine changes; only the gateway does.

## What you need (all free)

1. **A PayPal developer account** → https://developer.paypal.com (free). Sandbox is created automatically with one *business* (seller) and one *personal* (buyer) test account.
2. **A sandbox REST app**: Dashboard → Apps & Credentials → *Sandbox* → Create App → type *Merchant* → pick the sandbox business account. Under *Features → Add-on services* make sure **Customer disputes** is ticked. Copy the **Client ID** and **Secret**.
3. **One test dispute** (PayPal documents the buyer-side flow in "Set up accounts and environment" / "Test and go live" for the Disputes API): pay the sandbox business account from the sandbox personal account, then sign in at https://www.sandbox.paypal.com as the buyer, open the transaction → **Report a problem**. The dispute then appears for the business account with status `WAITING_FOR_SELLER_RESPONSE`.
4. **A merchant export** for the shop whose transactions are disputed: copy `data/merchant.example.json` and key each record by the PayPal `seller_transaction_id` of your sandbox payment. Orders, shipments (carrier + tracking number + delivery scan + delivered-to postal/country), refunds and returns are the only inputs the engine reads.

## Check the credentials first (read-only)

```bash
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npm run sandbox:check   # OAuth token, list disputes, get one; sends nothing
npm run sandbox:check -- --simulator                              # same script against the bundled simulator
```

## Run it

```bash
cp .env.example .env            # fill PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and MERCHANT_DATA
set -a; . ./.env; set +a
npm run serve                   # dashboard on http://localhost:4000, banner turns green: LIVE · PayPal sandbox REST
PAYPAL_GATEWAY=mcp npm run serve   # read disputes / accept claims through PayPal's own MCP server instead
LLM_PROVIDER=pollinations npm run serve   # free keyless model for drafting and message reading
```

## What was and was not verified without credentials

| Verified on this machine | Not verified (needs the credentials above) |
|---|---|
| Request/response shapes follow PayPal's published OpenAPI spec (`paypal/paypal-rest-api-specifications`); `provide-evidence` is sent as multipart with a JSON `input` part exactly as in PayPal's guide | A real round-trip to `api-m.sandbox.paypal.com` |
| `@paypal/mcp` 1.8.1 starts over stdio and exposes `list_disputes`, `get_dispute`, `accept_dispute_claim` (asserted in `tests/mcp.test.js`) | Real `list_disputes` / `get_dispute` / `accept_dispute_claim` payload shapes through the MCP server (parsed defensively) |
| OAuth token fetch, 401 refresh, error handling against the simulator | Sandbox-specific behaviours such as the exact evidence types PayPal requests per dispute (`evidences[].source = REQUESTED_FROM_SELLER`) |

If the first live call surfaces a difference, the places to look are `src/paypal/rest.js` (HTTP shape) and `src/paypal/mcp-gateway.js` (MCP result parsing).

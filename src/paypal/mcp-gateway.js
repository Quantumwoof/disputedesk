// Reads disputes and accepts claims *through PayPal's own MCP server* (@paypal/mcp, the Agent Toolkit's MCP
// entry point), spawned over stdio. The toolkit exposes list_disputes / get_dispute / accept_dispute_claim but
// no "provide evidence" or "make offer" tool, so those two actions fall back to the REST client.
// That gap is exactly what DisputeDesk adds on top (see docs/ARCHITECTURE.md).
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);

export function resolvePayPalMcpBin() {
  try { return require.resolve('@paypal/mcp/dist/index.js'); } catch { return null; }
}

export class PayPalMcpGateway {
  constructor({ accessToken, environment = 'SANDBOX', rest, tools = 'disputes.list,disputes.get,disputes.create,shipment.create,shipment.get,transactions.list' } = {}) {
    this.name = 'paypal-mcp+rest';
    this.accessToken = accessToken; this.environment = environment; this.rest = rest; this.toolsFlag = tools;
    this.client = null;
  }
  async connect() {
    if (this.client) return this.client;
    const bin = resolvePayPalMcpBin();
    if (!bin) throw new Error('@paypal/mcp is not installed (npm i @paypal/mcp)');
    const transport = new StdioClientTransport({
      command: process.execPath, args: [bin, `--tools=${this.toolsFlag}`],
      env: { ...process.env, PAYPAL_ACCESS_TOKEN: this.accessToken ?? '', PAYPAL_ENVIRONMENT: this.environment },
      stderr: 'ignore',
    });
    this.client = new Client({ name: 'disputedesk', version: '1.0.0' });
    await this.client.connect(transport);
    return this.client;
  }
  async toolNames() { const c = await this.connect(); return (await c.listTools()).tools.map((t) => t.name); }
  async #tool(name, args) {
    const c = await this.connect();
    const r = await c.callTool({ name, arguments: args });
    const text = (r.content ?? []).map((x) => x.text ?? '').join('\n');
    if (r.isError) throw new Error(`PayPal MCP ${name} failed: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  async listDisputes({ disputeState = 'REQUIRED_ACTION' } = {}) {
    const j = await this.#tool('list_disputes', { dispute_state: disputeState, page_size: 50 });
    return j.items ?? (Array.isArray(j) ? j : []);
  }
  getDispute(id) { return this.#tool('get_dispute', { dispute_id: id }); }
  // @paypal/mcp validates `note` against /^[A-Za-z0-9_-]{1,255}$/ (no spaces) in v1.8.1, so keep it token-like.
  acceptClaim(id, { note = 'Accepted_via_DisputeDesk' } = {}) {
    return this.#tool('accept_dispute_claim', { dispute_id: id, note: String(note).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 255) || 'Accepted' });
  }
  provideEvidence(id, evidences) { return this.rest.provideEvidence(id, evidences); }
  makeOffer(id, o) { return this.rest.makeOffer(id, o); }
  async close() { await this.client?.close(); this.client = null; }
}

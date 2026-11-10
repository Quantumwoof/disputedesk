// Runtime configuration. Everything has a no-secrets default: DEMO mode with a local PayPal simulator.
import { PayPalRest } from './paypal/rest.js';
import { PayPalMcpGateway } from './paypal/mcp-gateway.js';
import { createMockPayPal } from './paypal/mock-server.js';

export function loadConfig(env = process.env) {
  const live = !!((env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) || env.PAYPAL_ACCESS_TOKEN);
  return {
    mode: env.DISPUTEDESK_MODE ?? (live ? 'sandbox' : 'demo'),
    port: Number(env.PORT ?? 4000),
    mockPort: Number(env.MOCK_PORT ?? 4010),
    paypal: {
      clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, accessToken: env.PAYPAL_ACCESS_TOKEN,
      baseUrl: env.PAYPAL_BASE_URL, gateway: env.PAYPAL_GATEWAY ?? 'rest', // rest | mcp
    },
    llm: {
      provider: env.LLM_PROVIDER ?? 'none', // none | pollinations | openai-compatible
      baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL,
    },
    policy: {
      // What an hour of the owner's attention is worth, expressed as the smallest dispute worth contesting.
      minFightAmount: Number(env.MIN_FIGHT_AMOUNT ?? 10),
      signatureAbove: Number(env.SIGNATURE_ABOVE ?? 750),
    },
    dataDir: env.DISPUTEDESK_DATA ?? '.disputedesk',
  };
}

/** Build the PayPal gateway for the configured mode. In demo mode a simulator is started (or reused). */
export async function createGateway(cfg, { now = new Date(), data } = {}) {
  if (cfg.mode === 'demo') {
    let baseUrl = cfg.paypal.baseUrl;
    let mock = null;
    if (!baseUrl) {
      const probe = `http://127.0.0.1:${cfg.mockPort}`;
      const up = await fetch(`${probe}/__health`).then((r) => r.ok).catch(() => false);
      if (up) baseUrl = probe;
      else { mock = createMockPayPal({ now, data }); baseUrl = `http://127.0.0.1:${await mock.listen(0)}`; }
    }
    const rest = new PayPalRest({ baseUrl, clientId: 'demo-client-id', clientSecret: 'demo-client-secret' });
    return { gateway: rest, mock, baseUrl, label: 'DEMO · local PayPal simulator' };
  }
  const rest = new PayPalRest({ baseUrl: cfg.paypal.baseUrl, clientId: cfg.paypal.clientId, clientSecret: cfg.paypal.clientSecret, accessToken: cfg.paypal.accessToken });
  if (cfg.paypal.gateway === 'mcp') {
    const token = cfg.paypal.accessToken ?? (await rest.authenticate());
    return { gateway: new PayPalMcpGateway({ accessToken: token, rest }), mock: null, baseUrl: rest.baseUrl, label: 'LIVE · PayPal sandbox via @paypal/mcp' };
  }
  return { gateway: rest, mock: null, baseUrl: rest.baseUrl, label: 'LIVE · PayPal sandbox REST' };
}

// Minimal OpenAI-compatible chat client with free-tier friendly providers.
//   none               -> no model; DisputeDesk uses its deterministic offline paths (default; works with zero secrets)
//   pollinations       -> https://text.pollinations.ai/openai, anonymous & free, no API key
//   openai-compatible  -> any /chat/completions endpoint (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL):
//                         e.g. a local Ollama (http://localhost:11434/v1), OpenRouter free models, Groq/Gemini free tiers
export class LLM {
  constructor({ provider = 'none', baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 60000, retries = 3 } = {}) {
    this.provider = provider; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.retries = retries;
    if (provider === 'pollinations') { this.baseUrl = 'https://text.pollinations.ai/openai'; this.model = model ?? 'openai'; this.apiKey = apiKey; }
    else if (provider === 'openai-compatible') { this.baseUrl = baseUrl; this.model = model; this.apiKey = apiKey; if (!baseUrl || !model) throw new Error('openai-compatible needs LLM_BASE_URL and LLM_MODEL'); }
    this.stats = { calls: 0, failures: 0, ms: 0 };
  }
  get enabled() { return this.provider !== 'none'; }
  get label() { return this.enabled ? `${this.provider}:${this.model}` : 'offline (no LLM)'; }

  async chat(messages, { temperature = 0.2, maxTokens = 700 } = {}) {
    if (!this.enabled) throw new Error('LLM disabled');
    const url = this.provider === 'openai-compatible' ? `${this.baseUrl.replace(/\/$/, '')}/chat/completions` : this.baseUrl;
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const t0 = Date.now();
      this.stats.calls++;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
        let r;
        try {
          r = await this.fetch(url, {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
            body: JSON.stringify({ model: this.model, messages, temperature, max_tokens: maxTokens }),
          });
        } finally { clearTimeout(timer); }
        this.stats.ms += Date.now() - t0;
        if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
        const j = await r.json();
        const content = j.choices?.[0]?.message?.content;
        if (!content || !content.trim()) throw new Error('LLM returned empty content');
        return content.trim();
      } catch (e) {
        this.stats.failures++; lastErr = e;
        if (attempt < this.retries) await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  /** Ask for a JSON object; tolerate code fences / leading prose. Returns parsed object or throws. */
  async json(messages, opts) {
    const text = await this.chat(messages, opts);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON object in LLM output');
    return JSON.parse(m[0]);
  }
}

export function llmFromConfig(cfg) { return new LLM(cfg); }

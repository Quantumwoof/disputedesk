// File-backed proposal store + hash-chained audit log. Shared by the dashboard, the CLI and the MCP server,
// which is how a human approval given in the dashboard unlocks an agent's `submit_response` over MCP.
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../util.js';

export class StateStore {
  constructor(dir = '.disputedesk') {
    this.dir = dir; mkdirSync(dir, { recursive: true });
    this.stateFile = join(dir, 'state.json'); this.auditFile = join(dir, 'audit.jsonl');
  }
  #read() { return existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) : { proposals: {} }; }
  #write(s) { const tmp = `${this.stateFile}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 1)); renameSync(tmp, this.stateFile); }

  all() { return Object.values(this.#read().proposals); }
  get(id) { return this.#read().proposals[id] ?? null; }
  getByDispute(disputeId) { return this.all().find((p) => p.dispute_id === disputeId) ?? null; }
  save(p) { const s = this.#read(); s.proposals[p.id] = p; this.#write(s); return p; }
  reset() { this.#write({ proposals: {} }); }

  audit(actor, event, disputeId, data = {}) {
    const prev = this.auditTail(1)[0]?.hash ?? 'GENESIS';
    const entry = { ts: new Date().toISOString(), actor, event, dispute_id: disputeId, data, prev };
    entry.hash = sha256(JSON.stringify({ ...entry }));
    appendFileSync(this.auditFile, JSON.stringify(entry) + '\n');
    return entry;
  }
  auditTail(n = 50) {
    if (!existsSync(this.auditFile)) return [];
    const lines = readFileSync(this.auditFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l));
  }
  verifyAudit() {
    const all = this.auditTail(1e9);
    let prev = 'GENESIS';
    for (const [i, e] of all.entries()) {
      const { hash, ...rest } = e;
      if (rest.prev !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, brokenAt: i, entries: all.length };
      prev = hash;
    }
    return { ok: true, entries: all.length };
  }
}

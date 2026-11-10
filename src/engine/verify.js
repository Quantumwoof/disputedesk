// The grounding gate: "models propose, deterministic checks decide".
// A drafted response is accepted only if every sentence is backed by the evidence items it cites:
//  - each factual sentence carries [E#] citations that exist;
//  - every date, amount, ID, tracking number and bare number in the sentence appears in the cited evidence;
//  - sensitive claim words (signed, photo, insured, police, delivered, refund, ...) only appear when the cited evidence says so;
//  - no URLs other than ones present in the evidence; length stays inside PayPal's 2000-char notes limit.
// This is lexical grounding, not semantic proof; docs/ARCHITECTURE.md lists what it cannot catch.

const CITE = /\[(E\d+(?:\s*,\s*E\d+)*)\]/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONEY = /\b\d{1,3}(?:,\d{3})+\.\d{2}\b|\b\d+\.\d+\b/g;
const ID = /\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Z])[A-Za-z0-9][A-Za-z0-9-]{4,}\b/g;
const INT = /\b\d+\b/g;
const URL = /https?:\/\/\S+/g;
const LEXICON = /\b(signed|signature|photo(?:s|graph)?|police|insured|insurance|guarantee[d]?|warranty|customs|fraud(?:ulent)?|stolen|scam|illegal|delivered|delivery|refund(?:ed|s)?|shipped|tracking)\b/gi;

export function tokens(text) {
  let s = String(text).replace(CITE, ' ');
  const out = { url: [], date: [], money: [], id: [], int: [] };
  s = s.replace(URL, (m) => { out.url.push(m.replace(/[.,;)]+$/, '')); return ' '; });
  s = s.replace(DATE, (m) => { out.date.push(m); return ' '; });
  s = s.replace(MONEY, (m) => { out.money.push(Number(m.replace(/,/g, ''))); return ' '; });
  s = s.replace(ID, (m) => { out.id.push(m.toUpperCase()); return ' '; });
  s = s.replace(INT, (m) => { out.int.push(Number(m)); return ' '; });
  return out;
}
const canon = (w) => w.toLowerCase().replace(/^deliver.*/, 'deliver').replace(/^refund.*/, 'refund').replace(/^ship.*/, 'ship').replace(/^sign.*/, 'sign').replace(/^photo.*/, 'photo').replace(/^fraud.*/, 'fraud').replace(/^guarantee.*/, 'guarantee').replace(/^insur.*/, 'insur').replace(/^track.*/, 'track');
const lexicon = (text) => new Set([...String(text).matchAll(LEXICON)].map((m) => canon(m[1])));

const TERM = /[\s\S]*?[.!?](?=(?:\s*\[E[\d,\sE]+\])*(?:\s|$))(?:\s*\[E[\d,\sE]+\])*/g;
/** Sentence = text up to a terminator that is not a decimal point, plus trailing [E#] citations. */
export function splitSentences(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const parts = t.match(TERM)?.map((x) => x.trim()) ?? [];
  const used = parts.join(' ').length;
  const rest = t.slice(used).trim();
  return rest ? [...parts, rest] : parts;
}

/** @param evidence array of {id, facts[]}; E0 (dispute facts) is passed in the same array by the caller. */
export function verifyDraft(text, evidence, { maxLen = 1900 } = {}) {
  const problems = [];
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const sentences = [];
  if (!text || !text.trim()) return { ok: false, problems: ['empty draft'], sentences, clean: '' };
  if (text.length > maxLen) problems.push(`draft is ${text.length} chars (limit ${maxLen})`);
  // Re-attach trailing citations to their sentence.
  const parts = splitSentences(text);
  for (const raw of parts) {
    const s = raw.trim();
    const cites = [...s.matchAll(CITE)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
    const t = tokens(s);
    const bag = (kind, norm = (x) => x) => new Set(cites.flatMap((c) => (byId.get(c)?.facts ?? []).flatMap((f) => tokens(f)[kind].map(norm))));
    for (const c of cites) if (!byId.has(c)) problems.push(`unknown citation ${c} in: "${s.slice(0, 60)}"`);
    const factsText = cites.map((c) => (byId.get(c)?.facts ?? []).join(' ')).join(' ');
    const hasTokens = t.url.length + t.date.length + t.money.length + t.id.length + t.int.length > 0;
    const lex = lexicon(s.replace(CITE, ''));
    if (cites.length === 0 && (hasTokens || lex.size)) problems.push(`uncited factual sentence: "${s.slice(0, 70)}"`);
    const allowed = { date: bag('date'), money: bag('money'), id: bag('id'), int: bag('int'), url: bag('url') };
    for (const kind of ['date', 'money', 'id', 'int', 'url']) {
      for (const v of t[kind]) if (!allowed[kind].has(v)) problems.push(`ungrounded ${kind} "${v}" in: "${s.slice(0, 60)}"`);
    }
    const factsLex = lexicon(factsText);
    for (const w of lex) if (!factsLex.has(w)) problems.push(`claim word "${w}" not supported by cited evidence in: "${s.slice(0, 60)}"`);
    sentences.push({ text: s.replace(CITE, '').replace(/\s+/g, ' ').trim(), cites });
  }
  const clean = sentences.map((x) => x.text).join(' ');
  return { ok: problems.length === 0, problems, sentences, clean };
}

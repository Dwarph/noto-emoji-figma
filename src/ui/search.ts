import index from "../generated/emoji-index.json";

/** Tone variant: [codepoint, char, animated2d, animated3d] */
export type Tone = [string, string, 0 | 1, 0 | 1];

export interface Emoji {
  c: string;
  ch: string;
  n: string;
  cat: number;
  o: number;
  a2?: 1;
  a3?: 1;
  p?: number;
  v?: number;
  k: string[];
  x?: string[];
  t?: (Tone | null)[];
}

interface Searchable {
  e: Emoji;
  name: string;
  nameWords: string[];
  terms: Set<string>;
  curated: Set<string>;
  termWords: string[];
  chars: Set<string>;
}

export const categories: string[] = index.categories;
export const emoji: Emoji[] = index.emoji as Emoji[];
export const byCodepoint = new Map(emoji.map((e) => [e.c, e]));

const stripVs = (s: string) => s.replace(/️/g, "");
const words = (s: string) => s.split(/[\s:,()'’.!&/]+/).filter(Boolean);

const searchable: Searchable[] = emoji.map((e) => {
  const name = e.n.toLowerCase();
  const termWords = new Set<string>();
  for (const t of e.k) for (const w of words(t)) termWords.add(w);
  const chars = new Set([stripVs(e.ch)]);
  e.t?.forEach((t) => t && chars.add(stripVs(t[1])));
  return { e, name, nameWords: words(name), terms: new Set(e.k), curated: new Set(e.x), termWords: [...termWords], chars };
});

const normalise = (q: string) =>
  q
    .toLowerCase()
    .replace(/^:|:$/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasEmoji = (s: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);

/** Score one query token against an entry. 0 = no match. */
function scoreToken(s: Searchable, tok: string): number {
  let best = 0;
  for (const w of s.nameWords) {
    if (w === tok) return 30;
    if (w.startsWith(tok)) best = Math.max(best, 20);
  }
  if (s.terms.has(tok)) return Math.max(best, 25);
  for (const w of s.termWords) {
    if (w === tok) best = Math.max(best, 15);
    else if (best < 8 && w.startsWith(tok)) best = 8;
  }
  return best;
}

export function search(raw: string, limit = 400): Emoji[] {
  const q = normalise(raw);
  if (!q) return [];

  // Pasted emoji: match by character (ignoring variation selectors and skin tones).
  if (hasEmoji(raw)) {
    const target = stripVs(raw.trim());
    const hits = searchable.filter((s) => s.chars.has(target)).map((s) => s.e);
    if (hits.length) return hits;
  }

  const tokens = q.split(" ");
  const results: { e: Emoji; score: number }[] = [];

  for (const s of searchable) {
    let score = 0;
    let matched = true;
    for (const tok of tokens) {
      const t = scoreToken(s, tok);
      if (!t) {
        matched = false;
        break;
      }
      score += t;
    }
    if (!matched) continue;

    // Whole-query bonuses: exact name, name prefix, exact tag phrase.
    if (s.name === q) score += 100;
    else if (s.name.startsWith(q)) score += 40;
    if (s.terms.has(q)) score += 50;
    // Hand-curated intent words ("lol" → 🤣) beat generic tags.
    if (s.curated.has(q)) score += 60;
    // Popularity is a gentle tiebreaker (0..~1).
    score += (s.e.p ?? 0) / 1000;
    results.push({ e: s.e, score });
  }

  results.sort((a, b) => b.score - a.score || a.e.o - b.e.o);
  return results.slice(0, limit).map((r) => r.e);
}

/**
 * Builds src/generated/emoji-index.json from:
 *  - Noto emoji files site data (names, categories, animation availability)
 *  - Noto emoji animation API (alias tags, popularity)
 *  - emojibase-data (CLDR labels, tags, shortcodes from several vendors)
 *  - data/extra-tags.json (hand-curated slang / intent words)
 *
 * Run: npm run build:index
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const NOTO_DATA_URL = "https://googlefonts.github.io/noto-emoji-files/data/emojis_data.js";
const NOTO_ANIM_URL = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const SHORTCODE_SETS = ["github", "iamcal", "emojibase", "cldr", "joypixels"];
const CDN = {
  "2d": "https://fonts.gstatic.com/s/e/notoemoji/latest",
  "3d": "https://fonts.gstatic.com/s/e/noto3demoji/latest",
};
const SKIP_CDN_CHECK = process.argv.includes("--skip-cdn-check");

interface NotoEntry {
  codepoint: string;
  rgi: string;
  char: string;
  name: string;
  cldrName?: string;
  shortcode?: string;
  category: string;
  subgroup?: string;
  unicodeOrder: number;
  hasGfontsAnim: boolean;
  hasCdn3dAnim: boolean;
}

interface AnimIcon {
  codepoint: string;
  popularity: number;
  tags: string[];
}

interface EbSkin {
  hexcode: string;
  tone?: number | number[];
}

interface EbEmoji {
  label: string;
  hexcode: string;
  tags?: string[];
  emoticon?: string | string[];
  version: number;
  skins?: EbSkin[];
}

/** Tone variant: [codepoint, char, animated2d, animated3d] */
type Tone = [string, string, 0 | 1, 0 | 1];

export interface IndexEntry {
  c: string; // codepoint as used in CDN URLs (e.g. "1f44b", "1f1ec_1f1e7")
  ch: string; // the emoji character
  n: string; // display name
  cat: number; // category index into `categories`
  o: number; // unicode order
  a2?: 1; // animated 2D available
  a3?: 1; // animated 3D available
  p?: number; // popularity (animation API), higher = more popular
  v?: number; // emoji version
  k: string[]; // search terms
  x?: string[]; // hand-curated terms (data/extra-tags.json), ranked higher
  t?: (Tone | null)[]; // skin tones 1..5
}

/** Normalise a codepoint sequence for joining across sources. */
const key = (cp: string) =>
  cp
    .toLowerCase()
    .split(/[_\-\s]/)
    .filter((p) => p && p !== "fe0f")
    .join("-");

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^:|:$/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s: string) => s.replace(/(^|[\s(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

async function fetchText(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

/** HEAD-check every codepoint's thumbnail in both styles; returns the missing ones per style. */
async function checkCdn(codepoints: string[]) {
  const missing = { "2d": new Set<string>(), "3d": new Set<string>() };
  if (SKIP_CDN_CHECK) return missing;
  const jobs = codepoints.flatMap((cp) => (["2d", "3d"] as const).map((style) => ({ cp, style })));
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { cp, style } = jobs[i++];
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`${CDN[style]}/${cp}/72.png`, { method: "HEAD" });
          if (res.status === 404) missing[style].add(cp);
          else if (!res.ok) throw new Error(String(res.status));
          break;
        } catch (err) {
          if (attempt >= 2) throw err;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return missing;
}

async function main() {
  // --- Noto files data (a JS file assigning a global) ---
  const notoJs = await fetchText(NOTO_DATA_URL);
  const json = notoJs.slice(notoJs.indexOf("["), notoJs.lastIndexOf("]") + 1);
  const noto: NotoEntry[] = JSON.parse(json);
  console.log(SKIP_CDN_CHECK ? "Skipping CDN check" : `Checking ${noto.length * 2} CDN assets…`);
  const missing = await checkCdn(noto.map((n) => n.codepoint));

  // --- Animation API ---
  const anim: { icons: AnimIcon[] } = JSON.parse(await fetchText(NOTO_ANIM_URL));
  const animByKey = new Map(anim.icons.map((i) => [key(i.codepoint), i]));

  // --- emojibase ---
  const eb: EbEmoji[] = require("emojibase-data/en/data.json");
  const ebByKey = new Map<string, EbEmoji>();
  const toneOf = new Map<string, { base: string; tone: number }>();
  for (const e of eb) {
    const k = key(e.hexcode);
    ebByKey.set(k, e);
    for (const s of e.skins ?? []) {
      const tones = Array.isArray(s.tone) ? s.tone : s.tone ? [s.tone] : [];
      const sk = key(s.hexcode);
      // Only uniform tones map to the picker; mixed tones (e.g. two-person combos) are hidden.
      const uniform = tones.length > 0 && tones.every((t) => t === tones[0]);
      toneOf.set(sk, { base: k, tone: uniform ? tones[0] : -1 });
    }
  }
  const shortcodes = new Map<string, string[]>();
  for (const set of SHORTCODE_SETS) {
    const map: Record<string, string | string[]> = require(`emojibase-data/en/shortcodes/${set}.json`);
    for (const [hex, sc] of Object.entries(map)) {
      const k = key(hex);
      const list = shortcodes.get(k) ?? [];
      list.push(...(Array.isArray(sc) ? sc : [sc]));
      shortcodes.set(k, list);
    }
  }

  const extra: Record<string, string[]> = JSON.parse(
    readFileSync(join(root, "data", "extra-tags.json"), "utf8"),
  );
  const extraByKey = new Map(Object.entries(extra).map(([cp, tags]) => [key(cp), tags]));

  // --- Build ---
  const categories: string[] = [];
  const catIndex = (c: string) => {
    let i = categories.indexOf(c);
    if (i < 0) i = categories.push(c) - 1;
    return i;
  };

  const bases = new Map<string, IndexEntry>();
  const toneVariants: { base: string; tone: number; n: NotoEntry }[] = [];
  let hiddenMixed = 0;

  let unavailable = 0;
  for (const n of noto) {
    const m2 = missing["2d"].has(n.codepoint);
    const m3 = missing["3d"].has(n.codepoint);
    // Anything missing from either style is a font component (regional indicator letters,
    // keycap parts) or a malformed duplicate, so it's left out of the picker.
    if (m2 || m3) {
      unavailable++;
      continue;
    }
    const k = key(n.codepoint);
    const t = toneOf.get(k);
    if (t) {
      if (t.tone > 0) toneVariants.push({ base: t.base, tone: t.tone, n });
      else hiddenMixed++;
      continue;
    }

    const e = ebByKey.get(k);
    const a = animByKey.get(k);
    const terms = new Set<string>();
    const add = (s?: string | null) => {
      if (!s) return;
      const v = norm(s);
      if (v) terms.add(v);
    };

    add(n.cldrName);
    add(n.name);
    add(n.shortcode);
    a?.tags.forEach(add);
    if (e) {
      add(e.label);
      e.tags?.forEach(add);
      [e.emoticon ?? []].flat().forEach((em) => terms.add(em.toLowerCase()));
    }
    shortcodes.get(k)?.forEach(add);
    n.subgroup?.split("-").forEach(add);
    add(n.category.replace("&", " "));
    extraByKey.get(k)?.forEach(add);

    const label = n.cldrName || e?.label || n.name;
    const entry: IndexEntry = {
      c: n.codepoint,
      ch: n.char,
      n: titleCase(label.replace(/^flag: /i, "Flag: ")),
      cat: catIndex(n.category),
      o: n.unicodeOrder,
      k: [...terms],
    };
    if (n.hasGfontsAnim) entry.a2 = 1;
    if (n.hasCdn3dAnim) entry.a3 = 1;
    if (a) entry.p = a.popularity;
    if (e) entry.v = e.version;
    const curated = extraByKey.get(k)?.map(norm);
    if (curated?.length) entry.x = curated;
    bases.set(k, entry);
  }

  let orphanTones = 0;
  for (const { base, tone, n } of toneVariants) {
    const b = bases.get(base);
    if (!b) {
      orphanTones++;
      continue;
    }
    b.t ??= [null, null, null, null, null];
    b.t[tone - 1] = [n.codepoint, n.char, n.hasGfontsAnim ? 1 : 0, n.hasCdn3dAnim ? 1 : 0];
  }

  const emoji = [...bases.values()].sort((a, b) => a.o - b.o);

  // --- Sanity checks ---
  const empty = emoji.filter((e) => e.k.length === 0);
  if (empty.length) throw new Error(`Entries with no tags: ${empty.map((e) => e.c).join(", ")}`);
  const unknownExtra = [...extraByKey.keys()].filter((k) => !bases.has(k));
  if (unknownExtra.length) throw new Error(`extra-tags.json keys not found: ${unknownExtra.join(", ")}`);

  const out = { generated: new Date().toISOString().slice(0, 10), categories, emoji };
  mkdirSync(join(root, "src", "generated"), { recursive: true });
  writeFileSync(join(root, "src", "generated", "emoji-index.json"), JSON.stringify(out));

  const avgTerms = emoji.reduce((s, e) => s + e.k.length, 0) / emoji.length;
  console.log(
    [
      `Noto entries:        ${noto.length}`,
      `Base emoji:          ${emoji.length}`,
      `With skin tones:     ${emoji.filter((e) => e.t).length}`,
      `Mixed-tone hidden:   ${hiddenMixed}`,
      `Orphan tones:        ${orphanTones}`,
      `Not on CDN (skipped): ${unavailable}`,
      `Animated 2D (base):  ${emoji.filter((e) => e.a2).length}`,
      `Animated 3D (base):  ${emoji.filter((e) => e.a3).length}`,
      `Avg search terms:    ${avgTerms.toFixed(1)}`,
      `Categories:          ${categories.join(" | ")}`,
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

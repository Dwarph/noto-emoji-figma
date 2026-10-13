import { DEFAULT_PREFS, type CodeToUi, type InsertSpec, type Prefs, type UiToCode } from "../shared";
import { assetUrl, fetchAsset, thumbUrl } from "./assets";
import { byCodepoint, categories, emoji, search, type Emoji } from "./search";

const MAX_RECENTS = 32;
const TONES = ["#ffc93a", "#f7d7c4", "#e0b48a", "#bf8b62", "#9b643d", "#5c3e2e"];
const SIZES = [24, 32, 48, 64, 128, 256, 512];
const TONE_LABELS = ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"];
const CATEGORY_ICONS = ["1f600", "1f44b", "1f43b", "1f354", "26bd", "1f697", "1f4a1", "1f523", "1f3c1"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchInput = $<HTMLInputElement>("search");
const searchWrap = $("searchWrap");
const scroll = $("scroll");
const tabs = $("tabs");
const footer = $("footer");
const live = $("live");
const sizeBtn = $<HTMLButtonElement>("sizeBtn");
const sizeValue = $("sizeValue");
const sizeMenu = $<HTMLUListElement>("sizeMenu");
const tonesEl = $("tones");

let prefs: Prefs = { ...DEFAULT_PREFS };
let recents: string[] = [];
let query = "";
let canvasZoom = 1;

const post = (msg: UiToCode) => parent.postMessage({ pluginMessage: msg }, "*");

// --- Resolution: apply skin tone + work out what's available in the chosen style ---

interface Resolved {
  e: Emoji;
  cp: string;
  ch: string;
  anim: boolean; // animated asset exists in the current style
}

function resolve(e: Emoji): Resolved {
  const t = prefs.tone > 0 ? e.t?.[prefs.tone - 1] : null;
  const [cp, ch, a2, a3] = t ?? [e.c, e.ch, e.a2 ? 1 : 0, e.a3 ? 1 : 0];
  return { e, cp, ch, anim: Boolean(prefs.style === "2d" ? a2 : a3) };
}

function specFor(e: Emoji): { spec: InsertSpec; fellBack: boolean } {
  const r = resolve(e);
  const animated = prefs.animated && r.anim;
  return {
    spec: { codepoint: r.cp, char: r.ch, name: e.n, style: prefs.style, animated, size: prefs.size },
    fellBack: prefs.animated && !r.anim,
  };
}

// --- Insert ---

async function insert(spec: InsertSpec, dropId?: number) {
  try {
    const data = await fetchAsset(spec.style, spec.codepoint, spec.animated);
    const req = typeof data === "string" ? { ...spec, svg: data, dropId } : { ...spec, bytes: data, dropId };
    post({ type: "insert", req });
  } catch (err) {
    post({ type: "notify", text: `Couldn't load ${spec.char}: ${(err as Error).message}`, error: true });
  }
}

function insertEmoji(e: Emoji) {
  const { spec, fellBack } = specFor(e);
  if (fellBack) {
    post({ type: "notify", text: `No animated ${prefs.style.toUpperCase()} ${spec.char} yet. Inserted the static one.` });
  }
  insert(spec);
  addRecent(e.c);
}

function addRecent(cp: string) {
  recents = [cp, ...recents.filter((c) => c !== cp)].slice(0, MAX_RECENTS);
  post({ type: "save-recents", recents });
}

// --- Rendering ---

/** Animated mode shows only emoji that have an animation in the current style (and skin tone). */
function visible(list: Emoji[]) {
  return prefs.animated ? list.filter((e) => resolve(e).anim) : list;
}

function tile(e: Emoji): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "tile";
  b.dataset.cp = e.c;
  b.draggable = true;
  b.title = e.n;
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = e.n;
  img.src = thumbUrl(prefs.style, resolve(e).cp);
  b.append(img);
  return b;
}

function section(id: string, title: string, list: Emoji[]) {
  const s = document.createElement("section");
  s.className = "section";
  s.id = id;
  const h = document.createElement("h2");
  h.textContent = title;
  const g = document.createElement("div");
  g.className = "grid";
  g.append(...list.map(tile));
  s.append(h, g);
  return s;
}

function render(resetScroll = true) {
  const frag = document.createDocumentFragment();
  let count = 0;

  if (query) {
    const results = visible(search(query));
    count = results.length;
    if (results.length) frag.append(section("results", `${results.length} result${results.length === 1 ? "" : "s"}`, results));
  } else {
    const rec = visible(recents.map((c) => byCodepoint.get(c)).filter((e): e is Emoji => !!e));
    if (rec.length) frag.append(section("cat-recent", "Recently used", rec));
    categories.forEach((name, i) => {
      const list = visible(emoji.filter((e) => e.cat === i));
      count += list.length;
      if (list.length) frag.append(section(`cat-${i}`, name, list));
    });
  }

  scroll.replaceChildren(frag);
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<strong>🫥</strong>`;
    empty.append(
      query ? `Nothing matches “${query}”${prefs.animated ? " with animation" : ""}.` : "No animated emoji in this style yet.",
    );
    scroll.append(empty);
  }
  live.textContent = query ? `${count} results` : "";
  tabs.hidden = !!query;
  if (resetScroll) scroll.scrollTop = 0;
  updateActiveTab();
  showPreview(null);
}

function renderTabs() {
  const items = [
    { id: "cat-recent", label: "Recently used", icon: "1f552" },
    ...categories.map((name, i) => ({ id: `cat-${i}`, label: name, icon: CATEGORY_ICONS[i] ?? "2753" })),
  ];
  tabs.replaceChildren(
    ...items.map(({ id, label, icon }) => {
      const b = document.createElement("button");
      b.role = "tab";
      b.dataset.target = id;
      b.title = label;
      b.setAttribute("aria-label", label);
      const img = document.createElement("img");
      img.src = thumbUrl("2d", icon);
      img.alt = "";
      b.append(img);
      return b;
    }),
  );
}

function updateActiveTab() {
  const sections = [...scroll.querySelectorAll<HTMLElement>(".section")];
  const top = scroll.scrollTop + 4;
  let active = sections[0]?.id;
  for (const s of sections) if (s.offsetTop <= top) active = s.id;
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.target === active));
    b.disabled = !document.getElementById(b.dataset.target!);
    b.style.visibility = b.disabled ? "hidden" : "";
  });
}

function renderTones() {
  tonesEl.replaceChildren(
    ...TONES.map((color, i) => {
      const b = document.createElement("button");
      b.style.background = color;
      b.title = TONE_LABELS[i];
      b.setAttribute("aria-label", `${TONE_LABELS[i]} skin tone`);
      b.setAttribute("aria-pressed", String(prefs.tone === i));
      b.onclick = () => setPrefs({ tone: i });
      return b;
    }),
  );
}

function syncControls() {
  document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === prefs.style)));
  document.querySelectorAll<HTMLButtonElement>("[data-anim]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.anim === (prefs.animated ? "1" : "0"))));
  renderSizeMenu();
  renderTones();
}

function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  post({ type: "save-prefs", prefs });
  syncControls();
  render(false);
}

// --- Footer preview ---

let previewTimer = 0;

function showPreview(e: Emoji | null) {
  clearTimeout(previewTimer);
  if (!e) {
    footer.innerHTML = `<div class="hint">Click an emoji to insert it, or drag it onto the canvas.</div>`;
    return;
  }
  // Short delay so sweeping the mouse across the grid doesn't download a pile of GIFs.
  previewTimer = window.setTimeout(() => {
    const r = resolve(e);
    preloadDragImage(r.cp);
    const playAnim = prefs.animated && r.anim;
    const pv = document.createElement("div");
    pv.className = "pv";
    const img = document.createElement("img");
    img.alt = "";
    img.src = playAnim ? assetUrl(prefs.style, r.cp, true) : thumbUrl(prefs.style, r.cp);
    pv.append(img);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = e.n;
    const tags = document.createElement("div");
    tags.className = "tags";
    const nameLower = e.n.toLowerCase();
    tags.textContent = e.k.filter((t) => t !== nameLower && !t.includes(" ")).slice(0, 12).join(", ");
    const pills = document.createElement("div");
    pills.className = "pills";
    const pill = (text: string, on = false) => {
      const p = document.createElement("span");
      p.className = `pill${on ? " on" : ""}`;
      p.textContent = text;
      return p;
    };
    if (e.a2) pills.append(pill("2D animated", prefs.style === "2d"));
    if (e.a3) pills.append(pill("3D animated", prefs.style === "3d"));
    if (e.t) pills.append(pill("Skin tones"));
    if (e.v !== undefined) pills.append(pill(`Emoji ${e.v.toFixed(1)}`));
    meta.append(name, tags, pills);
    footer.replaceChildren(pv, meta);
  }, 120);
}

// --- Events ---

const tileFrom = (el: EventTarget | null) => (el as HTMLElement | null)?.closest<HTMLButtonElement>(".tile");
const emojiOf = (t: HTMLElement) => byCodepoint.get(t.dataset.cp!)!;

scroll.addEventListener("click", (ev) => {
  const t = tileFrom(ev.target);
  if (t) insertEmoji(emojiOf(t));
});
scroll.addEventListener("mouseover", (ev) => {
  const t = tileFrom(ev.target);
  if (t) showPreview(emojiOf(t));
});
scroll.addEventListener("focusin", (ev) => {
  const t = tileFrom(ev.target);
  if (t) showPreview(emojiOf(t));
});
scroll.addEventListener("scroll", () => requestAnimationFrame(updateActiveTab), { passive: true });

// Drag onto the canvas: Figma turns this into a `drop` event in the main thread.
scroll.addEventListener("dragstart", (ev) => {
  const t = tileFrom(ev.target);
  if (!t || !ev.dataTransfer) return;
  const e = emojiOf(t);
  const px = Math.round(Math.min(MAX_DRAG_PX, Math.max(8, prefs.size * canvasZoom)));
  const hiRes = dragImages.get(dragImageKey(resolve(e).cp));
  const source = hiRes?.complete && hiRes.naturalWidth ? hiRes : t.querySelector("img");
  if (!source) return;
  const canvas = drawDragCanvas(source, px);
  // Hotspot in the middle: the drop handler centres the emoji on the cursor too.
  ev.dataTransfer.setDragImage(canvas, px / 2, px / 2);
});
scroll.addEventListener("dragend", (ev) => {
  const t = tileFrom(ev.target);
  // Dropped inside the plugin window: ignore (per Figma's drop-event guidance).
  if (!t || ev.view?.length === 0) return;
  const e = emojiOf(t);
  const { spec, fellBack } = specFor(e);
  if (fellBack) post({ type: "notify", text: `No animated ${prefs.style.toUpperCase()} ${spec.char} yet. Inserted the static one.` });
  addRecent(e.c);
  parent.postMessage({ pluginDrop: { clientX: ev.clientX, clientY: ev.clientY, items: [], dropMetadata: spec } }, "*");
});

// --- Drag preview: the emoji at its real on-canvas size, on a transparent background ---

const MAX_DRAG_PX = 1024;
const dragImages = new Map<string, HTMLImageElement>();
const dragImageKey = (cp: string) => `${prefs.style}/${cp}`;

/** Start loading a sharp copy of the emoji (SVG for 2D, 512px PNG for 3D) so a drag can use it. */
function preloadDragImage(cp: string) {
  const key = dragImageKey(cp);
  if (dragImages.has(key)) return;
  const img = new Image();
  dragImages.set(key, img);
  if (prefs.style === "2d") {
    // Noto SVGs only have a viewBox; give them an intrinsic size so they rasterise crisply.
    fetchAsset("2d", cp, false)
      .then((svg) => {
        const sized = String(svg).replace("<svg ", '<svg width="512" height="512" ');
        img.src = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
      })
      .catch(() => dragImages.delete(key));
  } else {
    img.src = assetUrl("3d", cp, false);
  }
}

const dragCanvas = document.createElement("canvas");
// Must be in the DOM (but off-screen) for setDragImage to snapshot it.
dragCanvas.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none;";
document.body.append(dragCanvas);

function drawDragCanvas(source: CanvasImageSource, px: number) {
  const dpr = window.devicePixelRatio || 1;
  dragCanvas.width = Math.round(px * dpr);
  dragCanvas.height = Math.round(px * dpr);
  dragCanvas.style.width = `${px}px`;
  dragCanvas.style.height = `${px}px`;
  const ctx = dragCanvas.getContext("2d")!;
  ctx.clearRect(0, 0, dragCanvas.width, dragCanvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, dragCanvas.width, dragCanvas.height);
  return dragCanvas;
}

// Arrow-key navigation across the grid.
scroll.addEventListener("keydown", (ev) => {
  const t = tileFrom(ev.target);
  if (!t) return;
  const tiles = [...scroll.querySelectorAll<HTMLButtonElement>(".tile")];
  const i = tiles.indexOf(t);
  const grid = t.parentElement!;
  const cols = Math.max(1, Math.round(grid.clientWidth / t.offsetWidth));
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
  if (ev.key in moves) {
    ev.preventDefault();
    const next = i + moves[ev.key];
    if (next < 0) searchInput.focus();
    else tiles[Math.min(next, tiles.length - 1)]?.focus();
  }
});

let searchTimer = 0;
searchInput.addEventListener("input", () => {
  searchWrap.classList.toggle("has-value", !!searchInput.value);
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    query = searchInput.value.trim();
    render();
  }, 80);
});
searchInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    clearTimeout(searchTimer);
    query = searchInput.value.trim();
    render();
    const first = scroll.querySelector<HTMLButtonElement>(".tile");
    if (first) insertEmoji(emojiOf(first));
  } else if (ev.key === "ArrowDown") {
    ev.preventDefault();
    scroll.querySelector<HTMLButtonElement>(".tile")?.focus();
  } else if (ev.key === "Escape" && searchInput.value) {
    ev.preventDefault();
    clearSearch();
  }
});
$("clear").addEventListener("click", clearSearch);

function clearSearch() {
  searchInput.value = "";
  searchWrap.classList.remove("has-value");
  query = "";
  render();
  searchInput.focus();
}

tabs.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  const target = b && document.getElementById(b.dataset.target!);
  if (target) scroll.scrollTo({ top: target.offsetTop, behavior: "smooth" });
});

document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((b) => (b.onclick = () => setPrefs({ style: b.dataset.style as Prefs["style"] })));
document.querySelectorAll<HTMLButtonElement>("[data-anim]").forEach((b) => (b.onclick = () => setPrefs({ animated: b.dataset.anim === "1" })));

// --- Size menu (custom listbox) ---

const CHECK_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.5l2.5 2.5 4.5-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderSizeMenu() {
  sizeValue.textContent = `${prefs.size} px`;
  sizeMenu.replaceChildren(
    ...SIZES.map((size) => {
      const li = document.createElement("li");
      li.role = "option";
      li.tabIndex = -1;
      li.dataset.size = String(size);
      li.setAttribute("aria-selected", String(size === prefs.size));
      li.innerHTML = `<span>${size} px</span>${CHECK_SVG}`;
      return li;
    }),
  );
}

const sizeOptions = () => [...sizeMenu.querySelectorAll<HTMLLIElement>("li")];

function openSizeMenu() {
  sizeMenu.hidden = false;
  sizeBtn.setAttribute("aria-expanded", "true");
  (sizeOptions().find((li) => li.getAttribute("aria-selected") === "true") ?? sizeOptions()[0])?.focus();
}

function closeSizeMenu(refocus = false) {
  if (sizeMenu.hidden) return;
  sizeMenu.hidden = true;
  sizeBtn.setAttribute("aria-expanded", "false");
  if (refocus) sizeBtn.focus();
}

function chooseSize(li: HTMLLIElement) {
  closeSizeMenu(true);
  setPrefs({ size: Number(li.dataset.size) });
}

sizeBtn.addEventListener("click", () => (sizeMenu.hidden ? openSizeMenu() : closeSizeMenu()));
sizeBtn.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    openSizeMenu();
  }
});
sizeMenu.addEventListener("click", (ev) => {
  const li = (ev.target as HTMLElement).closest("li");
  if (li) chooseSize(li);
});
sizeMenu.addEventListener("mousemove", (ev) => {
  const li = (ev.target as HTMLElement).closest("li");
  if (li && document.activeElement !== li) li.focus();
});
sizeMenu.addEventListener("keydown", (ev) => {
  const opts = sizeOptions();
  const i = opts.indexOf(document.activeElement as HTMLLIElement);
  const focusAt = (n: number) => opts[Math.max(0, Math.min(opts.length - 1, n))].focus();
  switch (ev.key) {
    case "ArrowDown": ev.preventDefault(); focusAt(i + 1); break;
    case "ArrowUp": ev.preventDefault(); focusAt(i - 1); break;
    case "Home": ev.preventDefault(); focusAt(0); break;
    case "End": ev.preventDefault(); focusAt(opts.length - 1); break;
    case "Enter":
    case " ": ev.preventDefault(); if (opts[i]) chooseSize(opts[i]); break;
    case "Escape": ev.preventDefault(); closeSizeMenu(true); break;
    case "Tab": closeSizeMenu(); break;
  }
});
document.addEventListener("mousedown", (ev) => {
  if (!sizeMenu.hidden && !(ev.target as HTMLElement).closest(".size-field")) closeSizeMenu();
});

// --- Messages from the main thread ---

window.onmessage = (ev: MessageEvent) => {
  const msg = ev.data?.pluginMessage as CodeToUi | undefined;
  if (!msg) return;
  switch (msg.type) {
    case "init":
      prefs = msg.prefs;
      recents = msg.recents.filter((c) => byCodepoint.has(c));
      syncControls();
      render();
      break;
    case "drop-request":
      insert(msg.spec, msg.dropId);
      break;
    case "inserted":
      break;
    case "zoom":
      canvasZoom = msg.zoom;
      break;
  }
};

renderTabs();
syncControls();
render();
searchInput.focus();

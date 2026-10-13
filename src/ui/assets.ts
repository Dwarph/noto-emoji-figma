import type { Style } from "../shared";

const CDN: Record<Style, string> = {
  "2d": "https://fonts.gstatic.com/s/e/notoemoji/latest",
  "3d": "https://fonts.gstatic.com/s/e/noto3demoji/latest",
};

/** Small raster used for grid tiles (72px, crisp at 2x for 32px tiles). */
export const thumbUrl = (style: Style, cp: string) => `${CDN[style]}/${cp}/72.png`;

/** The asset that actually gets inserted. */
export function assetUrl(style: Style, cp: string, animated: boolean) {
  if (animated) return `${CDN[style]}/${cp}/512.gif`;
  return style === "2d" ? `${CDN["2d"]}/${cp}/emoji.svg` : `${CDN["3d"]}/${cp}/512.png`;
}

const cache = new Map<string, Promise<string | Uint8Array>>();

async function load(url: string, asText: boolean): Promise<string | Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset not available (${res.status})`);
  return asText ? res.text() : new Uint8Array(await res.arrayBuffer());
}

/** Fetch (and memoise) an asset. Returns SVG text for 2D static, bytes otherwise. */
export function fetchAsset(style: Style, cp: string, animated: boolean) {
  const url = assetUrl(style, cp, animated);
  let p = cache.get(url);
  if (!p) {
    p = load(url, url.endsWith(".svg"));
    p.catch(() => cache.delete(url)); // allow retry after a failure
    cache.set(url, p);
  }
  return p;
}

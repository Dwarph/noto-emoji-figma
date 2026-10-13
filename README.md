# Noto Emoji for Figma

Search and insert Google's [Noto emoji](https://googlefonts.github.io/noto-emoji-files/) into Figma or FigJam, in either style, static or animated.

- **2D or 3D style.** Pick the classic flat Noto look or the newer 3D one.
- **Static or animated.**
  - 2D static lands as editable vectors.
  - 3D static lands as a 512px PNG image fill.
  - Animated lands as a GIF image fill, which plays in prototypes and presentation view.
  - Choosing **Animated** narrows the grid (and search results) to emoji that have an animation in the current style and skin tone. That's about 610 in 2D, but only a handful in 3D so far.
- **Searchable tags.** Each emoji's search terms merge:
  - Noto's own names and shortcodes
  - the Noto animation aliases
  - CLDR keywords and vendor shortcodes from [emojibase](https://emojibase.dev/) (GitHub, Slack, JoyPixels and others)
  - hand-curated slang in [`data/extra-tags.json`](data/extra-tags.json) (e.g. "lol" → 🤣, "ship it" → 🚀, "uk" → 🇬🇧), which ranks above generic tags

  You can also paste an emoji character to find it.
- **Skin-tone picker.** It applies to every emoji that has tone variants.
- **Insert sizes** from 24 to 512px. Click a tile to insert, drag it onto the canvas, or press Enter in search to insert the top result.
- **Insert placement.** If a single frame is selected, the emoji goes inside it. Otherwise it lands at the viewport centre.
- **Recently used** emoji, plus your style, motion, tone and size choices, are remembered between sessions.

## Develop

```bash
npm install
```

```bash
npm run build
```

Then in the Figma desktop app go to **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`. Use `npm run watch` while iterating.

### Refreshing the emoji index

`src/generated/emoji-index.json` is committed, so the plugin never depends on Google's site data at runtime. To pick up new emoji or animations:

```bash
npm run build:index
```

This fetches the latest Noto data and HEAD-checks every asset on the CDN, which takes about a minute. Emoji missing from either style are left out; these are font components such as regional-indicator letters. Pass `-- --skip-cdn-check` for a fast offline-ish rebuild while editing tags.

## Licences

- Noto emoji images: [Apache 2.0](https://github.com/googlefonts/noto-emoji/blob/main/LICENSE)
- Noto emoji animations: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Google)
- Tag data: [emojibase](https://github.com/milesj/emojibase) (MIT) and Unicode CLDR

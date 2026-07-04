# Assets

How Guild Manager stores, optimizes, references, and loads its static media (images and fonts). This is the source of truth for the asset pipeline; update it whenever formats, directory layout, or the loading flow change.

---

## Directory Layout

```
public/assets/
├── UI/
│   ├── background_<theme>.webp   # 2 theme backgrounds (light, arcane — used for the "dark" palette)
│   └── fonts/
│       ├── BNBreezy.woff2        # display font, primary
│       └── BNBreezy.otf          # display font, fallback
├── portraits/
│   ├── portrait-NNN.webp         # agent portrait thumbnails (manifest-scanned)
│   ├── grid-slicer.py            # dev tool: slices a source sheet into tiles
│   └── originals/                # pre-conversion sources — gitignored, local only
└── items/
    ├── <name>.webp               # item icon thumbnails (manifest-scanned)
    └── originals/                # pre-conversion sources — gitignored, local only
```

Everything under `public/` is served verbatim at the site root, so a file at
`public/assets/portraits/portrait-001.webp` is reachable at
`/assets/portraits/portrait-001.webp`.

---

## File Formats

| Asset class | Format | Why |
|-------------|--------|-----|
| Portraits, item icons, theme backgrounds | **WebP** (quality 85) | ~25–67% smaller than the source JPEG at equivalent quality; universal modern-browser support |
| Display font (`BNBreezy`) | **WOFF2** primary, **OTF** fallback | WOFF2 (Brotli) is ~68% smaller than OTF; OTF retained in the `@font-face` `src` as a safety fallback |

The font is declared once in `src/styles/index.css` under `font-family: 'BNBrickHouse'` and consumed by `#page-title-text`. WOFF2 is listed first so modern browsers never fetch the OTF.

> ⚠️ **Naming:** The `@font-face` family is named `BNBrickHouse` but its `src` loads `BNBreezy.woff2`/`.otf`. The family name and the file name disagree for historical reasons; renaming one to match the other would be clearer but touches the single `#page-title-text` consumer.

---

## `originals/` Subfolders

Each scanned image directory keeps a sibling `originals/` folder holding the
pre-conversion source files (full-resolution JPEG/PNG sheets, slicer output).
These are **kept locally for re-export** but are **not** part of the repository:

- They are git-ignored via `public/assets/*/originals/` in `.gitignore`.
- They are **not** scanned by the manifest (see below), so they never reach the pickers or the bundle.

To regenerate or re-slice assets, drop new sources into `originals/`, run the
conversion, and commit only the resulting served files.

---

## Manifest System

The portrait and item pickers are populated automatically — there is no
hand-maintained list of files. `imageManifestPlugin` (`vite.config.js`) runs two
instances that scan `public/assets/portraits/` and `public/assets/items/` at
build time and expose each file list as a virtual ES module:

| Virtual module | Directory | Consumer |
|----------------|-----------|----------|
| `virtual:portrait-manifest` | `public/assets/portraits/` | `src/constants/portraits.js` → `PORTRAIT_URLS` |
| `virtual:item-manifest` | `public/assets/items/` | `src/constants/items.js` → `ITEM_URLS` |

Scanning rules:

- Only top-level files are listed (`fs.readdirSync`, non-recursive), so `originals/` is excluded automatically.
- A file is included only if its extension is in `IMAGE_EXTS` = `{ jpg, jpeg, png, gif, webp }`. The `originals` directory entry has no extension and is filtered out.
- Results are sorted, so picker order is deterministic and filename-driven.
- In `vite dev`, an `fs.watch` on each directory triggers a full reload when files are added or removed.

Because `webp` is already in `IMAGE_EXTS`, **converting JPEG → WebP in place
requires no manifest or code change** — the new filenames flow through
automatically.

---

## References That Are Not Manifest-Driven

A few asset paths are hard-coded and must be updated by hand if a file is renamed
or re-formatted:

| Path | File | Notes |
|------|------|-------|
| Theme backgrounds | `src/constants/palettes.js` (`backgroundImage`) | Mirrored in the bootstrap script in `index.html` |
| Theme backgrounds (bootstrap) | `index.html` `<script>` | Applies the palette + injects the `<link rel="preload">` before React mounts |
| Standard agent portraits | `public/presets/agent_presets.json` (`icon`) | One per bundled agent preset |
| Standard item icons | `public/presets/item_presets.json` (`icon`) | One per bundled item preset |
| Display font | `src/styles/index.css` `@font-face` `src` | WOFF2 + OTF |

> User-saved sessions and presets store absolute icon paths in `localStorage`. If
> a served asset is renamed or re-formatted (e.g. `.jpg` → `.webp`), previously
> saved references will 404 and fall back to the empty-frame style. There is no
> asset-path migration mechanism.

---

## Loading Pipeline

Two tiers gate when image media becomes visible. See `docs/api.md` for the hook
signatures and `docs/gotchas.md` ("Asset Loading Gate Blocks First Paint") for
the first-paint caveat.

### Global gate — `AssetProvider` / `useRegisterAssets`

Overlays a LOADING screen over the app until every registered URL settles (loads
or errors); the app tree stays mounted underneath (issue #81 — see
`docs/gotchas.md`). Used only for the **active theme background**, registered by
`usePalette` on mount.

- `index.html` injects `<link rel="preload" as="image">` for the active background and sets `--bg-image` before React mounts.
- `AssetContext.registerAssets` checks `img.complete` synchronously after setting `src`, so a preloaded/cached background resolves the gate immediately — no LOADING flash on repeat visits. `settle` guards against double-resolution.

### Modal-scoped — `useAssetGroup`

Used by `PortraitsModal` and `ItemIconsModal`. Tracks readiness **per URL**
(`readySet`) rather than all-or-nothing: every grid cell renders immediately and
each thumbnail appears the moment its own image settles (a gentle pulse
placeholder shows until then). A single slow image or 404 no longer holds the
whole picker behind a loading screen.

Picker cells also use `content-visibility: auto` so off-screen thumbnails skip
layout and paint until scrolled into view.

---

## Adding or Converting Assets

**Add a new portrait or item icon**

1. Save it as WebP into `public/assets/portraits/` or `public/assets/items/` (keep the source in the sibling `originals/` if you want to re-export later).
2. That's it — the manifest picks it up on the next build (or HMR in dev).

**Convert existing images to WebP** (static, one-time — no build/runtime dependency)

Pillow is sufficient; convert in place and delete the source, leaving `originals/` untouched:

```python
from PIL import Image
import glob, os
for f in glob.glob('public/assets/items/*.jpg'):      # top-level only
    Image.open(f).convert('RGB').save(f[:-4] + '.webp', 'webp', quality=85, method=6)
    os.remove(f)
```

Then update any hard-coded references in the table above (backgrounds → `palettes.js` + `index.html`; preset icons → the preset JSON files).

**Convert a font to WOFF2**

```python
from fontTools.ttLib import TTFont
f = TTFont('public/assets/UI/fonts/BNBreezy.otf')
f.flavor = 'woff2'                      # requires the `brotli` package
f.save('public/assets/UI/fonts/BNBreezy.woff2')
```

> Per `CLAUDE.md`, these converters (`Pillow`, `fontTools`, `brotli`) are
> developer-side, one-time tools — they are **not** added to `package.json` and
> introduce no runtime or build dependency.

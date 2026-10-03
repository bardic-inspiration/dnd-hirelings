# Assets

How the app stores, encodes, references, and loads images and fonts. Part of
[`SPEC.md`](../../SPEC.md).

## Layout

```
public/assets/
├── UI/
│   ├── background_<theme>.webp   # palette backgrounds (light; arcane, used by "dark")
│   └── fonts/
│       ├── BNBreezy.woff2        # display font
│       └── BNBreezy.otf          # display font, fallback
├── portraits/
│   ├── portrait-NNN.webp         # agent portraits (manifest-scanned)
│   ├── grid-slicer.py            # dev tool: slices a source sheet into tiles
│   └── originals/                # pre-conversion sources — gitignored
└── items/
    ├── <name>.webp               # item icons (manifest-scanned)
    └── originals/                # pre-conversion sources — gitignored
```

Everything under `public/` is served at the site root:
`public/assets/portraits/portrait-001.webp` is `/assets/portraits/portrait-001.webp`.

## Formats

| Asset | Format | Why |
|---|---|---|
| Portraits, item icons, backgrounds | WebP, quality 85 | Much smaller than JPEG at equal quality; universal in modern browsers. |
| Display font | WOFF2, with OTF as fallback | WOFF2 is about a third the size; the OTF is listed second so modern browsers never fetch it. |

The font is declared once in `src/styles/index.css` as family `BNBrickHouse`
(loading the `BNBreezy` files) and used by the page title. The family name and
file name differ.

**`originals/`** folders hold full-resolution sources for re-export. They are
gitignored (`public/assets/*/originals/`) and never scanned, served, or
bundled. Only converted files are committed. Converters (Pillow, fontTools,
brotli) are one-off developer tools, never project dependencies.

## Manifests

The portrait and item pickers list files automatically. `imageManifestPlugin`
(`vite.config.js`) scans each directory at build time and exposes the list as
a virtual module:

| Virtual module | Directory | Consumer |
|---|---|---|
| `virtual:portrait-manifest` | `public/assets/portraits/` | `PORTRAIT_URLS` (`src/constants/portraits.js`) |
| `virtual:item-manifest` | `public/assets/items/` | `ITEM_URLS` (`src/constants/items.js`) |

- Top-level files only, so `originals/` is excluded.
- Extensions in `IMAGE_EXTS`: `jpg jpeg png gif webp`.
- Sorted, so picker order follows file names.
- Under `vite dev`, adding or removing a file reloads the page. A directory
  that didn't exist when the dev server started needs a server restart.

## Hard-coded references

These paths aren't manifest-driven; renaming or re-encoding the file means
editing them by hand:

| Reference | Where |
|---|---|
| Palette backgrounds | `src/constants/palettes.js` (`backgroundImage`) and the bootstrap script in `index.html` |
| Standard agent portraits | `public/presets/agent_presets.json` (`icon`) |
| Standard item icons | `public/presets/item_presets.json` (`icon`) |
| Display font | `@font-face` `src` in `src/styles/index.css` |

Saves and user presets also store icon paths ([`persistence.md`](persistence.md)
"Files").

## Loading

**Nothing blocks the app on an asset.** There is no global loading gate.

- **Background:** the bootstrap script in `index.html` applies the stored
  palette, sets `--bg-image`, and preloads the image before React mounts; it
  paints over the solid `--bg` fill when it arrives. `usePalette` re-applies it
  on mount and on theme change. Why: the image is decorative — gating first
  paint on it covered already-rendered UI and read as a spurious refresh.
- **Pickers:** `useAssetGroup(urls)` tracks readiness per URL. Every grid cell
  renders immediately with a pulse placeholder and reveals its thumbnail when
  that image loads or fails, so one slow image never holds the grid. Cells use
  `content-visibility: auto`.

## Adding assets

- **A portrait or item icon:** save it as WebP into the scanned directory;
  the manifest picks it up.
- **Converting images:** convert top-level files in place and delete the
  source, leaving `originals/` alone:

  ```python
  from PIL import Image
  import glob, os
  for f in glob.glob('public/assets/items/*.jpg'):
      Image.open(f).convert('RGB').save(f[:-4] + '.webp', 'webp', quality=85, method=6)
      os.remove(f)
  ```

  Then update any hard-coded references above.
- **Converting a font to WOFF2** (needs `brotli`):

  ```python
  from fontTools.ttLib import TTFont
  f = TTFont('public/assets/UI/fonts/BNBreezy.otf')
  f.flavor = 'woff2'
  f.save('public/assets/UI/fonts/BNBreezy.woff2')
  ```

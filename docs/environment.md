# Environment

Guild Manager is a fully client-side application. There are no server-side environment variables. All runtime configuration is stored in the browser.

## Build-time Configuration

The build tool is Vite. No `.env` files are used. The only build-time behavior is in `vite.config.js`.

| Setting | Where | Description |
|---------|-------|-------------|
| Portrait asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/portraits` — scanned at build time to produce the portrait picker manifest |
| Item icon asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/items` — scanned at build time to produce the item icon picker manifest |
| Text display configuration | `config/truncation.yml` → `src/constants/truncation.js` | Number-shorthand table, truncation placeholders, and char-budget parameters — inlined via Vite `?raw` import and validated at module init (see `docs/gotchas.md`) |

The two `imageManifestPlugin` instances expose these directories as virtual modules (`virtual:portrait-manifest`, `virtual:item-manifest`). Adding or removing image files from these directories while `vite dev` is running triggers a hot-reload automatically. Served images are WebP and the display font is WOFF2; see `docs/assets.md` for the full asset pipeline.

Each scanned directory's `originals/` subfolder holds pre-conversion source images. These are git-ignored (`public/assets/*/originals/` in `.gitignore`), kept locally for re-export, and excluded from both the manifest scan and the repository.

## Browser Storage Keys

All persistent state is stored in `localStorage`. Every key is defined in the `STORAGE_KEYS` object exported from `src/state/storage.js` — that is the single source of truth for auditing all keys.

**Versioning strategy:** all keys carry a version suffix (`-v1`, `-v3`, …). The suffix is bumped only when the stored format changes in a breaking way. A suffix bump ships either migration code (read the old key, write the new key) or an explicit abandonment note in `STORAGE_KEYS` (pre-release saves may be dropped, as at v6).

| Key | `STORAGE_KEYS` field | Default | Description |
|-----|----------------------|---------|-------------|
| `dnd-hirelings-state-v6` | `STATE` | `DEFAULT_STATE` from `storage.js` | Full serialized game state (agents, tasks, inventory, session, tagRegistry). Loaded on startup; saved on every state change. Pre-v6 keys are ignored (no migration — agent `xp`/`hp` became valued tags at the v6 bump). |
| `dnd-hirelings-palette-v1` | `PALETTE` | `'dark'` | Name of the active color theme. One of: `light`, `dark`. On first read, falls back to the legacy unversioned key `dnd-hirelings-palette`. |
| `dnd-hirelings-presets-agents-v1` | `PRESETS('agents')` | `[]` | User-authored agent presets. Bundled (standard) presets are not stored here. |
| `dnd-hirelings-presets-tasks-v1` | `PRESETS('tasks')` | `[]` | User-authored task presets. |
| `dnd-hirelings-presets-items-v1` | `PRESETS('items')` | `[]` | User-authored item presets. |
| `dnd-hirelings-card-expansion-v1` | `CARD_EXPANSION` | `{ agent: [], task: [], item: [] }` | Per-type Sets (serialized as arrays) of card IDs toggled away from their default expand/collapse state. Loaded into `UIContext`; saved on every toggle. |
| `dnd-hirelings-open-modals-v1` | `OPEN_MODALS` | `{}` | Open props per persistence-enabled modal (`MODAL_PERSISTENCE` in `UIContext`), so a refresh reopens whatever was open. Function-carrying props are never stored. |
| `dnd-hirelings-config-overlays-v1` | `CONFIG_OVERLAYS` | `{}` | Per-file runtime-config overlays (`{ [fileId]: rawDoc }`) — Configuration Modal edits shadowing the fetched `public/config/*.yml` base documents. Loaded into `ConfigContext`; saved on every edit; an entry is removed on RESET. |

## Scripts

```bash
npm run dev        # Start Vite dev server with HMR
npm run build      # Production build to dist/
npm run preview    # Serve the production build locally
npm test           # Run the vitest unit suite once
npm run test:watch # Run vitest in watch mode
npm run lint       # Lint src/ with ESLint (flat config)
```

## Dependencies

| Package | Version | Role |
|---------|---------|------|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM renderer |
| `js-yaml` | ^4.2.0 | YAML serialization for the tag registry, runtime config files (Configuration Modal), and build-time config parsing |
| `vite` | ^8.0.16 | Build tool and dev server |
| `@vitejs/plugin-react` | ^5.2.0 | JSX transform and React fast-refresh |
| `vitest` | ^4.1.9 | Unit test runner (dev only; pure logic/constants tiers, node environment) |
| `eslint` + `@eslint/js` | ^10 | Linter (dev only); flat config in `eslint.config.js` |
| `eslint-plugin-react-hooks` | ^7 | Rules-of-hooks + exhaustive-deps (the two classic rules only) |
| `globals` | ^17 | Environment global definitions for the ESLint config |

No CSS preprocessor is present (a single bespoke stylesheet). ESLint is
configured **lint-only** — no stylistic/formatting rules, so it never fights
the stylesheet's or code's deliberate column alignment; a formatter (Prettier
/ Biome) is intentionally omitted for the same reason. The config encodes the
CLAUDE.md naming rule: `camelcase` (error) plus an advisory `id-length` that
flags single-letter identifiers outside the blessed idioms (`i, v, n, a, b, e,
r, _`). Tests run through Vite's own transform pipeline (`test: { environment:
'node' }` in `vite.config.js`), so build-time imports such as `?raw` resolve in
tests without mocking.

The minimum supported Node.js version is **20.19**, declared via `"engines": { "node": ">=20.19" }` in `package.json` (required by Vite 8).

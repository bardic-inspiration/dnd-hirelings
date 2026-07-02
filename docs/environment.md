# Environment

Guild Manager is a fully client-side application. There are no server-side environment variables. All runtime configuration is stored in the browser.

## Build-time Configuration

The build tool is Vite. No `.env` files are used. The only build-time behavior is in `vite.config.js`.

| Setting | Where | Description |
|---------|-------|-------------|
| Portrait asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/portraits` — scanned at build time to produce the portrait picker manifest |
| Item icon asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/items` — scanned at build time to produce the item icon picker manifest |

The two `imageManifestPlugin` instances expose these directories as virtual modules (`virtual:portrait-manifest`, `virtual:item-manifest`). Adding or removing image files from these directories while `vite dev` is running triggers a hot-reload automatically. Served images are WebP and the display font is WOFF2; see `docs/assets.md` for the full asset pipeline.

Each scanned directory's `originals/` subfolder holds pre-conversion source images. These are git-ignored (`public/assets/*/originals/` in `.gitignore`), kept locally for re-export, and excluded from both the manifest scan and the repository.

## Browser Storage Keys

All persistent state is stored in `localStorage`. Every key is defined in the `STORAGE_KEYS` object exported from `src/state/storage.js` — that is the single source of truth for auditing all keys.

**Versioning strategy:** all keys carry a version suffix (`-v1`, `-v3`, …). The suffix is bumped only when the stored format changes in a breaking way. Any suffix bump must be accompanied by migration code (read the old key, write the new key, remove the old key on next save).

| Key | `STORAGE_KEYS` field | Default | Description |
|-----|----------------------|---------|-------------|
| `dnd-hirelings-state-v3` | `STATE` | `DEFAULT_STATE` from `storage.js` | Full serialized game state (agents, tasks, inventory, session, tagRegistry). Loaded on startup; saved on every state change. |
| `dnd-hirelings-palette-v1` | `PALETTE` | `'dark'` | Name of the active color theme. One of: `light`, `dark`. On first read, falls back to the legacy unversioned key `dnd-hirelings-palette`. |
| `dnd-hirelings-presets-agents-v1` | `PRESETS('agents')` | `[]` | User-authored agent presets. Bundled (standard) presets are not stored here. |
| `dnd-hirelings-presets-tasks-v1` | `PRESETS('tasks')` | `[]` | User-authored task presets. |
| `dnd-hirelings-presets-items-v1` | `PRESETS('items')` | `[]` | User-authored item presets. |

## Scripts

```bash
npm run dev        # Start Vite dev server with HMR
npm run build      # Production build to dist/
npm run preview    # Serve the production build locally
npm test           # Run the vitest unit suite once
npm run test:watch # Run vitest in watch mode
```

## Dependencies

| Package | Version | Role |
|---------|---------|------|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM renderer |
| `js-yaml` | ^4.2.0 | YAML serialization for the tag registry and build-time config parsing |
| `vite` | ^8.0.16 | Build tool and dev server |
| `@vitejs/plugin-react` | ^5.2.0 | JSX transform and React fast-refresh |
| `vitest` | ^4.1.9 | Unit test runner (dev only; pure logic/constants tiers, node environment) |

No CSS preprocessor and no linter configuration are present in the repository. Tests run through Vite's own transform pipeline (`test: { environment: 'node' }` in `vite.config.js`), so build-time imports such as `?raw` resolve in tests without mocking.

The minimum supported Node.js version is **20.19**, declared via `"engines": { "node": ">=20.19" }` in `package.json` (required by Vite 8).

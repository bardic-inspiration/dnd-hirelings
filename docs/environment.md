# Environment

Guild Manager is a fully client-side application. There are no server-side environment variables. All runtime configuration is stored in the browser.

## Build-time Configuration

The build tool is Vite. No `.env` files are used. The only build-time behavior is in `vite.config.js`.

| Setting | Where | Description |
|---------|-------|-------------|
| Portrait asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/portraits` — scanned at build time to produce the portrait picker manifest |
| Item icon asset directory | `vite.config.js` → `imageManifestPlugin.dir` | `public/assets/items` — scanned at build time to produce the item icon picker manifest |

The two `imageManifestPlugin` instances expose these directories as virtual modules (`virtual:portrait-manifest`, `virtual:item-manifest`). Adding or removing image files from these directories while `vite dev` is running triggers a hot-reload automatically.

## Browser Storage Keys

All persistent state is stored in `localStorage` under the keys below.

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `dnd-hirelings-state-v3` | No | `DEFAULT_STATE` from `storage.js` | Full serialized game state (agents, tasks, inventory, session, tagRegistry). Loaded on startup; saved on every state change. |
| `dnd-hirelings-palette` | No | `'dark'` | Name of the active color theme. One of: `dark`, `light`, `vale`, `ember`, `arcane`. |
| `dnd-hirelings-presets-agents-v1` | No | `[]` | User-authored agent presets. Bundled (standard) presets are not stored here. |
| `dnd-hirelings-presets-tasks-v1` | No | `[]` | User-authored task presets. |
| `dnd-hirelings-presets-items-v1` | No | `[]` | User-authored item presets. |

> ⚠️ **Needs clarification:** The preset storage keys (`-v1`) and the game state key (`-v3`) use different versioning schemes. If either format changes in the future, migration logic will need to be added to `storage.js` (game state) or `usePresets.js` (presets).

## Scripts

```bash
npm run dev      # Start Vite dev server with HMR
npm run build    # Production build to dist/
npm run preview  # Serve the production build locally
```

## Dependencies

| Package | Version | Role |
|---------|---------|------|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM renderer |
| `js-yaml` | ^4.2.0 | YAML serialization for the tag registry |
| `vite` | ^5.4.2 | Build tool and dev server |
| `@vitejs/plugin-react` | ^4.3.1 | JSX transform and React fast-refresh |

No test framework, no CSS preprocessor, no linter configuration is present in the repository.

> ⚠️ **Needs clarification:** There is no `.nvmrc`, `.node-version`, or `engines` field in `package.json`. The minimum supported Node.js version is unspecified. Vite 5 requires Node ≥ 18.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// Exposes the image files of an asset folder as a virtual module the client can
// import. One instance per asset type (portraits, items, …).
function imageManifestPlugin({ name, virtualId, dir, basePath }) {
  const resolvedId = '\0' + virtualId;

  function getFiles() {
    try {
      return fs.readdirSync(dir)
        .filter(f => IMAGE_EXTS.has(f.split('.').pop().toLowerCase()))
        .sort();
    } catch { return []; }
  }

  return {
    name,
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      return `export default ${JSON.stringify({ files: getFiles(), basePath })};`;
    },
    configureServer(server) {
      fs.watch(path.resolve(dir), () => {
        const mod = server.moduleGraph.getModuleById(resolvedId);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Pure-function unit tests only (logic/constants tiers) — no DOM environment.
  test: { environment: 'node' },
  // Networked GM/Player sessions reach the standalone session server (npm run
  // server) through this proxy; offline play never touches it. See
  // docs/specs/gm-player-mode.md §4.
  server: { proxy: { '/api': 'http://localhost:3001' } },
  plugins: [
    react(),
    // The manifest plugins' fs.watch handles keep vitest's server from
    // exiting, and no test imports the virtual modules — skip them in tests.
    ...(mode === 'test' ? [] : [
      imageManifestPlugin({
        name: 'portrait-manifest',
        virtualId: 'virtual:portrait-manifest',
        dir: 'public/assets/portraits',
        basePath: '/assets/portraits/',
      }),
      imageManifestPlugin({
        name: 'item-manifest',
        virtualId: 'virtual:item-manifest',
        dir: 'public/assets/items',
        basePath: '/assets/items/',
      }),
    ]),
  ],
}));

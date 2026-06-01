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

export default defineConfig({
  plugins: [
    react(),
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
  ],
});

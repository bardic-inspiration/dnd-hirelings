import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function portraitManifestPlugin(opts = {}) {
  const dir      = opts.dir      ?? 'public/assets/portraits';
  const basePath = opts.basePath ?? '/assets/portraits/';
  const virtualId  = 'virtual:portrait-manifest';
  const resolvedId = '\0' + virtualId;

  function getFiles() {
    try {
      return fs.readdirSync(dir)
        .filter(f => IMAGE_EXTS.has(f.split('.').pop().toLowerCase()))
        .sort();
    } catch { return []; }
  }

  return {
    name: 'portrait-manifest',
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
  plugins: [react(), portraitManifestPlugin()],
});

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'serve-exported-deployment',
    configureServer(server) {
      // Development uses the exact manifest and ABI produced by the production build.
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path !== '/imd-deployment.json' && !/^\/abi\/[A-Za-z_][A-Za-z0-9_]*\.json$/.test(path)) return next();
        try {
          const body = await readFile(fileURLToPath(new URL(`../dist${path}`, import.meta.url)));
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        } catch { res.statusCode = 503; res.end('Run npm run build before starting the development server.'); }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});

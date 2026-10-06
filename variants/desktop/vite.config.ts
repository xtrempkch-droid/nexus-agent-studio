import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for the desktop variant.
 *
 * `@core/*` is aliased to `common/*` so the UI can import **types only** from
 * the headless core. Runtime imports from `common/` are forbidden here: the core
 * depends on `node:*` built-ins that do not exist in the browser.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../common', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/desktop',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});

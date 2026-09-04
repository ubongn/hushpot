import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// Web app build (React + Vite). The node-side test suite / deploy driver is
// untouched — vitest uses its own config (vitest.config.ts).
//
// base './' keeps asset URLs relative, so the SPA works on Vercel preview
// URLs and any sub-path mount; vercel.json adds the SPA rewrite so client
// routes fall back to index.html.
//
// No vite-plugin-top-level-await: target is esnext, so top-level await ships
// natively (Chrome/Edge 89+, Firefox 89+, Safari 15+).
export default defineConfig({
  base: './',
  plugins: [react(), wasm()],
  build: {
    target: 'esnext',
    // ledger-v8 wasm + midnight-js deps are large; don't warn about it.
    chunkSizeWarningLimit: 12_000,
  },
  // The @midnight-ntwrk packages ship ESM + wasm; keep them bundled rather
  // than pre-bundled by dev-server (avoids duplicated wasm instances).
  optimizeDeps: {
    exclude: ['@midnight-ntwrk/ledger-v8'],
  },
  server: {
    port: 5173,
  },
});

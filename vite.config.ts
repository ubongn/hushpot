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
  // The @midnight-ntwrk packages ship ESM + wasm with mixed CJS transitive
  // deps (apollo, subsquid, isomorphic-ws). esbuild's dep pre-bundler chokes
  // on their re-export chains; serve them unbundled instead (rollup handles
  // the same graph fine for production builds).
  optimizeDeps: {
    exclude: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/midnight-js',
      '@midnight-ntwrk/midnight-js-compact',
      '@midnight-ntwrk/midnight-js-contracts',
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
      '@midnight-ntwrk/midnight-js-network-id',
      '@midnight-ntwrk/midnight-js-protocol',
      '@midnight-ntwrk/midnight-js-types',
      '@midnight-ntwrk/midnight-js-utils',
      '@midnight-ntwrk/dapp-connector-api',
    ],
  },
  server: {
    port: 5173,
  },
});

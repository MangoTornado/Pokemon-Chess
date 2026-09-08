import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev the client runs on Vite and the API on the Node server; proxy /api across so the same
    // same-origin fetch calls work in dev and in production (where one server serves both).
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    // The dex bundles are code-split by the lazy imports in src/data/dex.ts, so a warning here would
    // mean something has accidentally pulled the whole dex into the entry chunk.
    chunkSizeWarningLimit: 600,
    target: 'es2022',
  },
});

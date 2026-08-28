import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The dex bundles are code-split by the lazy imports in src/data/dex.ts, so a warning here would
    // mean something has accidentally pulled the whole dex into the entry chunk.
    chunkSizeWarningLimit: 600,
    target: 'es2022',
  },
});

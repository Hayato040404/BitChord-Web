import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works unmodified on GitHub Pages project
// subpaths (username.github.io/bitchord/) and on Vercel's domain root.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});

import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the same build works at a domain root, in a
  // GitHub Pages project subpath, or anywhere else it is dropped.
  base: './',
  build: {
    target: 'es2022',
    // three.js is most of the bundle and never changes between deploys.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});

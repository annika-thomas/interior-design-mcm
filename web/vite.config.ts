import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Everything under /api goes to the Node server; uploads stream through it too.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three.js is most of the bundle and changes far less often than the
        // app does, so it gets its own long-lived chunk.
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
});

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api/kitchen': 'http://127.0.0.1:4319' },
  },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});

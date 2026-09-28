import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths, so the dashboard works when served from
  // chrome-extension://<id>/dashboard.html as well as from a dev server.
  base: './',
  build: {
    // Build straight into the extension, where the copy step picks it up.
    outDir: '../extension/dashboard',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});

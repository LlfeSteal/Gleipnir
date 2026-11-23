import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the Go backend (GLEIPNIR_API_URL, default localhost:8080).
// File watching polls: in the devcontainer (WSL bind mount) inotify misses the edits, and the
// dev server would keep serving stale code. VITE_POLLING=0 turns it off.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: { '/api': process.env.GLEIPNIR_API_URL ?? 'http://localhost:8080' },
    watch: { usePolling: process.env.VITE_POLLING !== '0', interval: 300 },
  },
});

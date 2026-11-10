import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, /api (inclusive o WebSocket das sessões) vai para o API Gateway.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.GATEWAY ?? 'http://localhost:8080', ws: true, changeOrigin: true } },
  },
});

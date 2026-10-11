import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The proxy tells the API which address the browser used (hifi.localhost:5173), so workspace subdomains also work in dev.
  server: { port: 5173, proxy: Object.fromEntries(['/api', '/uploads'].map((p) => [p, { target: 'http://localhost:4000', configure: (proxy) => proxy.on('proxyReq', (pr, req) => pr.setHeader('x-forwarded-host', req.headers.host)) }])) },
  build: { chunkSizeWarningLimit: 1500 },
});

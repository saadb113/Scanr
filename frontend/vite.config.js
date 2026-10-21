import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Express backend stays the API + session-cookie owner during migration.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
      // /payment is the only page not yet ported to React (left unmigrated —
      // its backend is entirely dead, a deliberate decision made earlier in
      // this migration). Proxied through so the link behaves the same in
      // dev as it will once this app is the single deployed origin.
      '/payment': 'http://localhost:3000',
      // Static assets those legacy pages reference.
      '/css': 'http://localhost:3000',
      '/js': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../public-react',
    emptyOutDir: true,
  },
})

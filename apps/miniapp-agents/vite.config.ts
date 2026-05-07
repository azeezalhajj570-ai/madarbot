import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_BOUNDARY': JSON.stringify('agents'),
  },
  resolve: {
    alias: {
      '@miniapp/shared': resolve(__dirname, '../../packages/miniapp-shared/src'),
    },
  },
  base: '/webapp/agents/',
  build: {
    outDir: '../../bot/dashboard/frontend/agents',
    emptyOutDir: true,
  },
  server: {
    port: 5175,
    fs: {
      allow: ['../..'],
    },
  },
})

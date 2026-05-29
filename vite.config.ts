import { defineConfig } from 'vite'

// github pages uses /repo-name/ as base. cloud run uses /
const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

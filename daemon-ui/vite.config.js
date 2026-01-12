import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/status.json': 'http://127.0.0.1:7007',
      '/chat.json': 'http://127.0.0.1:7007',
      '/downloads.json': 'http://127.0.0.1:7007',
      '/api/downloads': {
        target: 'http://127.0.0.1:7007',
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/api/download': {
        target: 'http://127.0.0.1:7007',
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/files/tree.json': 'http://127.0.0.1:7007',
      '/api/files': {
        target: 'http://127.0.0.1:7007',
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/media': 'http://127.0.0.1:7007',
      '/media/meta': 'http://127.0.0.1:7007',
      '/api/search': {
        target: 'http://127.0.0.1:7007',
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})

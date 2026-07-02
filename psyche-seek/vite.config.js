import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const daemonTarget = `http://127.0.0.1:${process.env.VITE_DAEMON_PORT || 7007}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': daemonTarget,
      '/auth': daemonTarget
    }
  }
})

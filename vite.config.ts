import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    envDir: process.cwd(),

    plugins: [react()],

    define: {
      'import.meta.env.VITE_WS_URL': JSON.stringify(
        // In production Render builds, set VITE_WS_URL as a Render environment
        // variable (e.g. wss://syncspace-api.onrender.com) before the build step.
        // Locally it defaults to the Express server port (Yjs is on the same port).
        env.VITE_WS_URL || 'ws://localhost:5000'
      ),
    },

    server: {
      port: 5173,
      host: true,

      proxy: {
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  }
})
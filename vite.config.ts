import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    envDir: process.cwd(),

    plugins: [react()],

    define: env.VITE_WS_URL
      ? {
          'import.meta.env.VITE_WS_URL': JSON.stringify(env.VITE_WS_URL),
        }
      : undefined,

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
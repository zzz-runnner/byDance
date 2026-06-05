import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const backendTarget = env.AGENTHUB_BACKEND_PROXY_TARGET ?? 'http://120.79.130.49:8790'
  const proxy = {
    '/api': backendTarget,
    '/preview': backendTarget,
    '/build-preview': backendTarget,
    '/deploy': backendTarget,
  }

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      proxy,
    },
  }
})

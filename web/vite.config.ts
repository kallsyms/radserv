import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/l2': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/l3': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/l2-realtime': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/nexrad.kml': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})

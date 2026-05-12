import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        // Default entry — serves penghasilantambahan.com (PeTa)
        main: resolve(__dirname, 'index.html'),
        // Hostname-routed entry — serves straight.ltd via Vercel rewrite
        straight: resolve(__dirname, 'straight.html'),
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'url'
import path from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('src/sim', import.meta.url)),
      '@': path.resolve(__dirname, './src'),
    },
  },
})

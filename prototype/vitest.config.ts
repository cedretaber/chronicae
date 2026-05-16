import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, './src/sim'),
      '@': path.resolve(__dirname, './src'),
    },
  },
})

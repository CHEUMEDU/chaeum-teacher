import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// build invalidation marker: 1776818722
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify('1776818722-v15')
  }
})

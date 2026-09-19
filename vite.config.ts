import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'path'

function githubPagesFallback() {
  return {
    name: 'github-pages-fallback',
    closeBundle() {
      const distIndex = path.resolve(__dirname, 'dist/index.html')
      const distFallback = path.resolve(__dirname, 'dist/404.html')
      if (fs.existsSync(distIndex)) fs.copyFileSync(distIndex, distFallback)
    },
  }
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/tokobahan/' : '/',
  plugins: [react(), tailwindcss(), githubPagesFallback()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

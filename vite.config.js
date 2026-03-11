import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'GSE Portfolio',
        short_name: 'Portfolio',
        description: 'IC Securities GSE Portfolio Tracker',
        theme_color: '#080d14',
        background_color: '#080d14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
      }
    }),
    // Copy the pdfjs legacy worker into public/ so Vite serves it as a static asset
    {
      name: 'copy-pdfjs-worker',
      buildStart() {
        try {
          mkdirSync('public', { recursive: true })
          copyFileSync(
            resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
            resolve('public/pdf.worker.mjs')
          )
        } catch (e) {
          console.warn('Could not copy pdfjs worker:', e.message)
        }
      }
    }
  ],
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  build: {
    target: 'esnext',
  },
  resolve: {
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
  },
})
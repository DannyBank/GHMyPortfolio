import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { gseApiDevMiddleware } from './vite-plugins/gse-api-dev-middleware.js'

export default defineConfig({
  plugins: [
    react(),
    gseApiDevMiddleware(),
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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB — covers bundled pdfjs
      }
    })
  ],
  build: {
    target: 'esnext',
  },
})